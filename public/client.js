const socket = io();

const $ = (sel) => document.querySelector(sel);
const screens = {
  login: $('#screen-login'),
  lobby: $('#screen-lobby'),
  game: $('#screen-game'),
};

let state = null;

function show(name) {
  for (const k of Object.keys(screens)) {
    screens[k].classList.toggle('hidden', k !== name);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderBlack(text, fill) {
  const safe = escapeHtml(text);
  if (safe.includes('__')) {
    if (fill !== undefined && fill !== null) {
      return safe.replace('__', `<span class="fill">${escapeHtml(fill)}</span>`);
    }
    return safe.replace('__', '<span class="fill">_____</span>');
  }
  if (fill) return safe + ' <span class="fill">' + escapeHtml(fill) + '</span>';
  return safe;
}

// --- Login ---
const nameInput = $('#name-input');
const codeInput = $('#code-input');
const loginError = $('#login-error');

const savedName = localStorage.getItem('cah_name');
if (savedName) nameInput.value = savedName;

$('#create-btn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) { loginError.textContent = 'Bitte Namen eingeben.'; return; }
  localStorage.setItem('cah_name', name);
  socket.emit('create-room', { name });
});

$('#join-btn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!name) { loginError.textContent = 'Bitte Namen eingeben.'; return; }
  if (!code) { loginError.textContent = 'Bitte Raum-Code eingeben.'; return; }
  localStorage.setItem('cah_name', name);
  socket.emit('join-room', { code, name });
});

codeInput.addEventListener('keyup', (e) => {
  if (e.key === 'Enter') $('#join-btn').click();
});
nameInput.addEventListener('keyup', (e) => {
  if (e.key === 'Enter') {
    if (codeInput.value.trim()) $('#join-btn').click();
    else $('#create-btn').click();
  }
});

$('#leave-btn').addEventListener('click', () => {
  socket.emit('leave-room');
  state = null;
  $('#room-info').classList.add('hidden');
  show('login');
});

// --- Socket events ---
socket.on('joined', ({ code }) => {
  $('#room-code').textContent = code;
  $('#room-info').classList.remove('hidden');
  loginError.textContent = '';
});

socket.on('error-msg', (msg) => {
  loginError.textContent = msg;
});

socket.on('state', (s) => {
  state = s;
  render();
});

// --- Render ---
function render() {
  if (!state) return;
  if (state.state === 'lobby') {
    show('lobby');
    renderLobby();
  } else {
    show('game');
    renderGame();
  }
}

function renderLobby() {
  $('#lobby-code').textContent = state.code;
  const ul = $('#lobby-players');
  ul.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    if (p.id === state.yourId) li.classList.add('you');
    if (!p.connected) li.classList.add('disconnected');
    li.innerHTML = `
      <span>${escapeHtml(p.name)}${p.id === state.yourId ? ' (du)' : ''}${!p.connected ? ' (weg)' : ''}</span>
      <span>${p.isHost ? '<span class="tag host">Host</span>' : ''}</span>
    `;
    ul.appendChild(li);
  }
  const me = state.players.find(p => p.id === state.yourId);
  const isHost = me && me.isHost;
  $('#lobby-host-controls').classList.toggle('hidden', !isHost);
  $('#lobby-waiting').classList.toggle('hidden', isHost);
  $('#start-btn').disabled = state.players.filter(p => p.connected).length < 2;
}

$('#start-btn').addEventListener('click', () => {
  socket.emit('start-game');
});

function renderGame() {
  $('#room-code').textContent = state.code;
  $('#room-info').classList.remove('hidden');

  // Scoreboard
  const sb = $('#scoreboard');
  sb.innerHTML = '';
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  for (const p of sorted) {
    const li = document.createElement('li');
    if (p.id === state.yourId) li.classList.add('you');
    if (!p.connected) li.classList.add('disconnected');
    let tag = '';
    if (p.isHost) tag += '<span class="tag host">Host</span>';
    if (state.state === 'submitting' && p.hasSubmitted) tag += '<span class="tag done">Fertig</span>';
    if (state.state === 'voting' && p.hasVoted) tag += '<span class="tag done">Gewählt</span>';
    li.innerHTML = `
      <span>${escapeHtml(p.name)}${p.id === state.yourId ? ' (du)' : ''} ${tag}</span>
      <span class="score-num">${p.score}</span>
    `;
    sb.appendChild(li);
  }

  // Phase label
  const phaseText = {
    submitting: 'Karten auswählen',
    reveal: 'Karten werden aufgedeckt',
    voting: 'Stimmt ab!',
    scoring: 'Auswertung',
  }[state.state] || '';
  $('#phase-label').textContent = phaseText;

  // Black card
  const me = state.players.find(p => p.id === state.yourId);
  const isHost = me && me.isHost;

  let blackFill = null;
  if (state.state === 'scoring' && state.winner && !state.winner.tied && !state.winner.none) {
    blackFill = state.winner.card;
  }
  $('#black-card').innerHTML = renderBlack(state.blackCard || '', blackFill);

  // Status area
  const statusEl = $('#status-area');
  statusEl.innerHTML = '';
  if (state.state === 'submitting') {
    if (state.yourSubmission) {
      statusEl.innerHTML = `Du hast eingereicht: <strong>${escapeHtml(state.yourSubmission)}</strong> · Warte auf andere... <button id="undo-submit" class="ghost small">Zurücknehmen</button>`;
      const btn = $('#undo-submit');
      if (btn) btn.addEventListener('click', () => socket.emit('unsubmit-card'));
    } else {
      statusEl.innerHTML = 'Wähle eine Karte aus deiner Hand.';
    }
  } else if (state.state === 'reveal') {
    statusEl.innerHTML = `Karten werden aufgedeckt: ${state.revealedIndex} / ${state.submissionCount}`;
  } else if (state.state === 'voting') {
    if (typeof state.yourVote === 'number') {
      statusEl.innerHTML = 'Du hast abgestimmt. Warte auf andere...';
    } else {
      statusEl.innerHTML = 'Klicke auf die Karte, die du am besten findest. (Nicht die eigene.)';
    }
  } else if (state.state === 'scoring') {
    statusEl.innerHTML = '';
  }

  // Submissions area
  const subs = $('#submissions-area');
  subs.innerHTML = '';
  if (['reveal', 'voting', 'scoring'].includes(state.state)) {
    state.submissions.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'card white submission-card';
      if (!s.revealed) {
        card.classList.add('face-down');
        card.innerHTML = '';
      } else {
        card.textContent = s.card;
      }
      // Mark own submission
      const yourSub = state.submissions.find(x => x.index === s.index);
      // We don't know playerId of submission until scoring; but we can find by yourSubmission text match in voting
      if (state.state === 'voting' && state.yourSubmission && s.card === state.yourSubmission) {
        card.classList.add('your-own', 'disabled');
        const tag = document.createElement('div');
        tag.className = 'player-tag';
        tag.textContent = 'Deine';
        card.appendChild(tag);
      }
      // Selected vote
      if (state.state === 'voting' && state.yourVote === s.index) {
        card.classList.add('selected');
      }
      // Vote click
      if (state.state === 'voting' && s.revealed) {
        const isOwn = state.yourSubmission && s.card === state.yourSubmission;
        const alreadyVoted = typeof state.yourVote === 'number';
        if (!isOwn && !alreadyVoted) {
          card.addEventListener('click', () => socket.emit('vote', { index: s.index }));
        } else if (alreadyVoted && !isOwn) {
          card.classList.add('disabled');
        }
      }
      // Scoring: show player name & votes
      if (state.state === 'scoring') {
        if (s.playerName) {
          const tag = document.createElement('div');
          tag.className = 'player-tag';
          tag.textContent = s.playerName;
          card.appendChild(tag);
        }
        if (s.votes !== null && s.votes > 0) {
          const v = document.createElement('div');
          v.className = 'vote-count';
          v.textContent = s.votes + (s.votes === 1 ? ' Stimme' : ' Stimmen');
          card.appendChild(v);
        }
        if (state.winner && !state.winner.tied && state.winner.index === s.index) {
          card.classList.add('winner');
        }
        if (state.winner && state.winner.tied && state.winner.indices.includes(s.index)) {
          card.classList.add('winner');
        }
      }
      subs.appendChild(card);
    });
  }

  // Winner area
  const winnerEl = $('#winner-area');
  if (state.state === 'scoring' && state.winner) {
    winnerEl.classList.remove('hidden');
    if (state.winner.none) {
      winnerEl.innerHTML = `<h3>Niemand hat gewonnen</h3><p>Es wurde keine Stimme abgegeben.</p>`;
    } else if (state.winner.tied) {
      const names = state.winner.submissions.map(s => escapeHtml(s.playerName)).join(' & ');
      winnerEl.innerHTML = `<h3>Unentschieden!</h3><p>${names} mit je ${state.winner.votes} Stimme${state.winner.votes === 1 ? '' : 'n'}. Kein Punkt.</p>`;
    } else {
      winnerEl.innerHTML = `<h3>🏆 ${escapeHtml(state.winner.playerName)} gewinnt!</h3><p>"${escapeHtml(state.winner.card)}" – ${state.winner.votes} Stimme${state.winner.votes === 1 ? '' : 'n'} · +1 Punkt</p>`;
    }
  } else {
    winnerEl.classList.add('hidden');
  }

  // Auto-progress countdown (no host buttons anymore)
  const hc = $('#host-controls');
  hc.innerHTML = '';
  hc.classList.add('hidden');
  if (state.nextActionAt) {
    hc.classList.remove('hidden');
    const label = state.state === 'scoring' ? 'Nächste Runde in' : 'Nächste Karte in';
    hc.innerHTML = `<span class="countdown-label">${label} <span id="countdown">…</span> s</span>`;
    if (window._countdownTimer) clearInterval(window._countdownTimer);
    const tick = () => {
      const left = Math.max(0, Math.ceil((state.nextActionAt - Date.now()) / 1000));
      const el = document.getElementById('countdown');
      if (el) el.textContent = left;
      if (left <= 0 && window._countdownTimer) {
        clearInterval(window._countdownTimer);
        window._countdownTimer = null;
      }
    };
    tick();
    window._countdownTimer = setInterval(tick, 200);
  } else if (window._countdownTimer) {
    clearInterval(window._countdownTimer);
    window._countdownTimer = null;
  }

  // Hand
  const handArea = $('#hand-area');
  const hand = $('#hand');
  hand.innerHTML = '';
  if (state.state === 'submitting' && !state.yourSubmission) {
    handArea.classList.remove('hidden');
    for (const card of state.yourHand) {
      const el = document.createElement('div');
      el.className = 'card white';
      el.textContent = card;
      el.addEventListener('click', () => socket.emit('submit-card', { card }));
      hand.appendChild(el);
    }
  } else if (state.state === 'submitting' && state.yourSubmission) {
    handArea.classList.remove('hidden');
    for (const card of state.yourHand) {
      const el = document.createElement('div');
      el.className = 'card white disabled';
      el.textContent = card;
      hand.appendChild(el);
    }
  } else {
    handArea.classList.add('hidden');
  }
}
