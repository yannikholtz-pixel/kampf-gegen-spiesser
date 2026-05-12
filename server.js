const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cards = require('./cards');
const gm = require('./gamemaster');

const HAND_SIZE = 7;
const MIN_PLAYERS = 2;
const REVEAL_DELAY_MS = 1800;
const SCORING_DELAY_MS = 6000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms[code]);
  return code;
}

function dealHands(room) {
  for (const p of room.players) {
    while (p.hand.length < HAND_SIZE) {
      if (room.whiteDeck.length === 0) room.whiteDeck = shuffle(cards.whiteCards);
      p.hand.push(room.whiteDeck.pop());
    }
  }
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function scheduleAutoReveal(room) {
  clearRoomTimer(room);
  if (room.state !== 'reveal') return;
  room.nextActionAt = Date.now() + REVEAL_DELAY_MS;
  room.timer = setTimeout(() => {
    room.timer = null;
    if (!rooms[room.code] || room.state !== 'reveal') return;
    room.revealedIndex++;
    if (room.revealedIndex >= room.submissions.length) {
      room.state = 'voting';
      room.nextActionAt = null;
      emitState(room);
    } else {
      emitState(room);
      scheduleAutoReveal(room);
    }
  }, REVEAL_DELAY_MS);
}

function scheduleAutoNextRound(room) {
  clearRoomTimer(room);
  room.nextActionAt = Date.now() + SCORING_DELAY_MS;
  room.timer = setTimeout(() => {
    room.timer = null;
    if (!rooms[room.code] || room.state !== 'scoring') return;
    const active = room.players.filter(p => p.connected);
    if (active.length < MIN_PLAYERS) {
      room.state = 'lobby';
      room.nextActionAt = null;
      emitState(room);
      return;
    }
    startRound(room);
  }, SCORING_DELAY_MS);
}

function startRound(room) {
  clearRoomTimer(room);
  room.nextActionAt = null;
  room.gmMessage = null;
  if (room.blackDeck.length === 0) room.blackDeck = shuffle(cards.blackCards);
  room.blackCard = room.blackDeck.pop();
  room.submissions = [];
  room.revealedIndex = 0;
  room.voteCounts = {};
  room.winner = null;
  for (const p of room.players) {
    p.submission = null;
    p.vote = null;
  }
  dealHands(room);
  room.state = 'submitting';
  emitState(room);
}

function publicState(room) {
  return {
    code: room.code,
    state: room.state,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || 'clown',
      score: p.score,
      isHost: p.isHost,
      hasSubmitted: !!p.submission,
      hasVoted: typeof p.vote === 'number',
      connected: p.connected,
    })),
    blackCard: room.blackCard,
    submissions: ['reveal', 'voting', 'scoring'].includes(room.state)
      ? room.submissions.map((s, i) => ({
          index: i,
          revealed: i < room.revealedIndex || room.state !== 'reveal',
          card: (i < room.revealedIndex || room.state !== 'reveal') ? s.card : null,
          playerName: room.state === 'scoring' ? s.playerName : null,
          playerAvatar: room.state === 'scoring' ? s.playerAvatar : null,
          votes: room.state === 'scoring' ? (room.voteCounts[i] || 0) : null,
        }))
      : [],
    revealedIndex: room.revealedIndex,
    submissionCount: room.submissions ? room.submissions.length : 0,
    winner: room.winner || null,
    nextActionAt: room.nextActionAt || null,
    gmMessage: room.gmMessage || null,
  };
}

function emitState(room) {
  const base = publicState(room);
  for (const p of room.players) {
    if (!p.connected) continue;
    io.to(p.id).emit('state', {
      ...base,
      yourId: p.id,
      yourHand: p.hand,
      yourSubmission: p.submission || null,
      yourVote: typeof p.vote === 'number' ? p.vote : null,
    });
  }
}

function tallyVotes(room) {
  const counts = {};
  for (const p of room.players) {
    if (typeof p.vote === 'number') {
      counts[p.vote] = (counts[p.vote] || 0) + 1;
    }
  }
  room.voteCounts = counts;
  let maxVotes = 0;
  for (const c of Object.values(counts)) if (c > maxVotes) maxVotes = c;
  const topIndices = Object.entries(counts)
    .filter(([, c]) => c === maxVotes && c > 0)
    .map(([idx]) => parseInt(idx));
  if (topIndices.length === 1) {
    const sub = room.submissions[topIndices[0]];
    const winner = room.players.find(p => p.id === sub.playerId);
    if (winner) winner.score++;
    room.winner = {
      tied: false,
      index: topIndices[0],
      playerName: sub.playerName,
      card: sub.card,
      votes: maxVotes,
    };
  } else if (topIndices.length > 1) {
    room.winner = {
      tied: true,
      indices: topIndices,
      votes: maxVotes,
      submissions: topIndices.map(i => ({
        playerName: room.submissions[i].playerName,
        card: room.submissions[i].card,
      })),
    };
  } else {
    room.winner = { tied: false, none: true };
  }
  room.state = 'scoring';
  room.gmMessage = gm.generateMessage(room.players, room.winner);
  scheduleAutoNextRound(room);
}

function checkAllSubmitted(room) {
  const active = room.players.filter(p => p.connected);
  if (active.length < 2) return false;
  return active.every(p => p.submission);
}

function checkAllVoted(room) {
  const active = room.players.filter(p => p.connected);
  return active.every(p => typeof p.vote === 'number');
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentPlayer = null;

  function leaveCurrent() {
    if (currentRoom && currentPlayer) {
      currentPlayer.connected = false;
      if (currentPlayer.isHost) {
        const next = currentRoom.players.find(p => p.connected && p !== currentPlayer);
        if (next) {
          currentPlayer.isHost = false;
          next.isHost = true;
        }
      }
      const room = currentRoom;
      setTimeout(() => {
        if (rooms[room.code] && rooms[room.code].players.every(p => !p.connected)) {
          delete rooms[room.code];
        }
      }, 5 * 60_000);
      emitState(currentRoom);
    }
    currentRoom = null;
    currentPlayer = null;
  }

  function attach(room, player) {
    currentRoom = room;
    currentPlayer = player;
    socket.join(room.code);
    socket.emit('joined', { code: room.code, yourId: player.id });
    emitState(room);
  }

  socket.on('create-room', ({ name, avatar }) => {
    name = (name || '').toString().trim().slice(0, 20);
    avatar = (avatar || '').toString().trim().slice(0, 30) || 'clown';
    if (!name) return socket.emit('error-msg', 'Bitte einen Namen eingeben.');
    const code = generateCode();
    const room = {
      code,
      players: [],
      state: 'lobby',
      blackDeck: shuffle(cards.blackCards),
      whiteDeck: shuffle(cards.whiteCards),
      blackCard: null,
      submissions: [],
      revealedIndex: 0,
      voteCounts: {},
      winner: null,
    };
    rooms[code] = room;
    const player = {
      id: socket.id, name, avatar, score: 0, hand: [],
      submission: null, vote: null, isHost: true, connected: true,
    };
    room.players.push(player);
    attach(room, player);
  });

  socket.on('join-room', ({ code, name, avatar }) => {
    name = (name || '').toString().trim().slice(0, 20);
    avatar = (avatar || '').toString().trim().slice(0, 30) || 'clown';
    code = (code || '').toString().trim().toUpperCase();
    if (!name) return socket.emit('error-msg', 'Bitte einen Namen eingeben.');
    const room = rooms[code];
    if (!room) return socket.emit('error-msg', 'Raum nicht gefunden.');
    const dup = room.players.find(p => p.name === name);
    if (dup) {
      if (!dup.connected) {
        dup.id = socket.id;
        dup.connected = true;
        if (avatar) dup.avatar = avatar;
        attach(room, dup);
        return;
      }
      return socket.emit('error-msg', 'Name ist schon vergeben.');
    }
    if (room.state !== 'lobby') {
      return socket.emit('error-msg', 'Spiel läuft schon. Tritt mit deinem alten Namen wieder bei oder erstelle einen neuen Raum.');
    }
    const player = {
      id: socket.id, name, avatar, score: 0, hand: [],
      submission: null, vote: null, isHost: false, connected: true,
    };
    room.players.push(player);
    attach(room, player);
  });

  socket.on('start-game', () => {
    if (!currentRoom || !currentPlayer || !currentPlayer.isHost) return;
    if (currentRoom.state !== 'lobby' && currentRoom.state !== 'scoring') return;
    const active = currentRoom.players.filter(p => p.connected);
    if (active.length < MIN_PLAYERS) {
      return socket.emit('error-msg', `Mindestens ${MIN_PLAYERS} Spieler nötig.`);
    }
    startRound(currentRoom);
  });

  socket.on('submit-card', ({ card }) => {
    if (!currentRoom || !currentPlayer) return;
    if (currentRoom.state !== 'submitting') return;
    if (currentPlayer.submission) return;
    if (!currentPlayer.hand.includes(card)) return;
    currentPlayer.submission = card;
    currentPlayer.hand = currentPlayer.hand.filter(c => c !== card);
    if (checkAllSubmitted(currentRoom)) {
      currentRoom.submissions = shuffle(
        currentRoom.players
          .filter(p => p.submission)
          .map(p => ({ playerId: p.id, playerName: p.name, playerAvatar: p.avatar || 'clown', card: p.submission }))
      );
      currentRoom.state = 'reveal';
      currentRoom.revealedIndex = 0;
      scheduleAutoReveal(currentRoom);
    }
    emitState(currentRoom);
  });

  socket.on('unsubmit-card', () => {
    if (!currentRoom || !currentPlayer) return;
    if (currentRoom.state !== 'submitting') return;
    if (!currentPlayer.submission) return;
    currentPlayer.hand.push(currentPlayer.submission);
    currentPlayer.submission = null;
    emitState(currentRoom);
  });

  socket.on('reveal-next', () => {
    if (!currentRoom || !currentPlayer || !currentPlayer.isHost) return;
    if (currentRoom.state !== 'reveal') return;
    if (currentRoom.revealedIndex < currentRoom.submissions.length) {
      currentRoom.revealedIndex++;
    }
    if (currentRoom.revealedIndex >= currentRoom.submissions.length) {
      currentRoom.state = 'voting';
    }
    emitState(currentRoom);
  });

  socket.on('vote', ({ index }) => {
    if (!currentRoom || !currentPlayer) return;
    if (currentRoom.state !== 'voting') return;
    if (typeof index !== 'number' || index < 0 || index >= currentRoom.submissions.length) return;
    const sub = currentRoom.submissions[index];
    if (sub.playerId === currentPlayer.id) return;
    currentPlayer.vote = index;
    if (checkAllVoted(currentRoom)) {
      tallyVotes(currentRoom);
    }
    emitState(currentRoom);
  });

  socket.on('next-round', () => {
    if (!currentRoom || !currentPlayer || !currentPlayer.isHost) return;
    if (currentRoom.state !== 'scoring') return;
    startRound(currentRoom);
  });

  socket.on('leave-room', () => {
    leaveCurrent();
  });

  socket.on('disconnect', () => {
    leaveCurrent();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  Niveaulos läuft!`);
  console.log(`  Lokal:    http://localhost:${PORT}`);
  const os = require('os');
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) {
        console.log(`  Im Netz:  http://${i.address}:${PORT}`);
      }
    }
  }
  console.log('');
});
