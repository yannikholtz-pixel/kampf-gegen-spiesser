const socket = io();

const $ = (sel) => document.querySelector(sel);
const screens = {
  login: $('#screen-login'),
  lobby: $('#screen-lobby'),
  game: $('#screen-game'),
};

let state = null;
let selectedAvatar = localStorage.getItem('cah_avatar') || 'spiesser';
let lastRevealedIndex = 0;
let lastState = null;

// --- Avatare ---
const AVATARS = [
  { id: 'spiesser', emoji: '🤡', label: 'Spießer' },
  { id: 'querdenker', emoji: '😈', label: 'Querdenker' },
  { id: 'schwiegermutter', emoji: '👵', label: 'Schwiegermutter' },
  { id: 'stammtischopa', emoji: '👴', label: 'Stammtisch-Opa' },
  { id: 'onkel-manfred', emoji: '🥴', label: 'Onkel Manfred' },
  { id: 'bwler', emoji: '🤓', label: 'BWLer' },
  { id: 'sparschwein', emoji: '🐷', label: 'Sparschwein' },
  { id: 'troll', emoji: '💩', label: 'Online-Troll' },
  { id: 'trinkkumpel', emoji: '🍻', label: 'Trinkkumpel' },
  { id: 'bratwurst', emoji: '🌭', label: 'Bratwurst-Heini' },
  { id: 'romeo', emoji: '🍆', label: 'Romeo' },
  { id: 'hottie', emoji: '🍑', label: 'Hottie' },
  { id: 'mama-aldi', emoji: '🤰', label: 'Mama bei Aldi' },
  { id: 'reichsbuerger', emoji: '👽', label: 'Reichsbürger' },
  { id: 'influencer', emoji: '🤖', label: 'Influencer' },
  { id: 'esoterikerin', emoji: '🔮', label: 'Esoterikerin' },
  { id: 'schuetzenkoenig', emoji: '🤠', label: 'Schützenkönig' },
  { id: 'ex', emoji: '👻', label: 'Ex-Beziehung' },
  { id: 'beerdiger', emoji: '💀', label: 'Beerdigungsstalker' },
  { id: 'moechtegern', emoji: '👑', label: 'Möchtegern' },
  { id: 'yogi', emoji: '🦄', label: 'Yogi auf MDMA' },
  { id: 'beamte', emoji: '🐌', label: 'Beamtin' },
  { id: 'wg-katze', emoji: '🐈‍⬛', label: 'WG-Katze' },
  { id: 'immohai', emoji: '🦈', label: 'Immobilienhai' },
  { id: 'babyface', emoji: '👶', label: 'Babyface' },
];
const avatarById = Object.fromEntries(AVATARS.map(a => [a.id, a]));

function getAvatar(id) {
  return avatarById[id] || AVATARS[0];
}

// --- Audio ---
let _audioCtx = null;
let muted = localStorage.getItem('cah_muted') === '1';

function getAudio() {
  if (muted) return null;
  if (!_audioCtx) {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return null; }
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.08) {
  const ctx = getAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function soundCardFlip() {
  playTone(900, 0.04, 'square', 0.05);
  setTimeout(() => playTone(1400, 0.08, 'sine', 0.04), 30);
}
function soundSubmit() {
  playTone(440, 0.08, 'triangle', 0.07);
  setTimeout(() => playTone(660, 0.12, 'sine', 0.06), 70);
}
function soundVote() {
  playTone(800, 0.06, 'triangle', 0.06);
}
function soundWin() {
  playTone(523, 0.13, 'sine', 0.08);
  setTimeout(() => playTone(659, 0.13, 'sine', 0.08), 90);
  setTimeout(() => playTone(784, 0.28, 'sine', 0.09), 180);
}
function soundTie() {
  playTone(440, 0.15, 'triangle', 0.06);
  setTimeout(() => playTone(370, 0.25, 'triangle', 0.06), 130);
}
function soundJoin() {
  playTone(660, 0.08, 'sine', 0.05);
  setTimeout(() => playTone(880, 0.1, 'sine', 0.05), 60);
}

// --- Speech ---
let currentUtterance = null;
let _voices = [];
let _selectedVoice = null;
let _userVoiceId = localStorage.getItem('cah_voice') || null;

function voiceScore(v) {
  const n = (v.name || '').toLowerCase();
  let s = 0;
  // Azure Neural via Edge/Windows — top tier
  if (n.includes('natural')) s += 200;
  if (n.includes('online')) s += 100;
  // Apple's premium / enhanced voices
  if (n.includes('premium') || n.includes('enhanced')) s += 80;
  // Modern neural variants
  if (n.includes('neural') || n.includes('wavenet')) s += 70;
  // Google-branded — usually fine
  if (n.includes('google')) s += 40;
  // Apple German names
  if (/(anna|petra|markus|reed|martin|viktoria)/.test(n)) s += 20;
  // Cloud-backed (non-local) usually better
  if (v.localService === false) s += 15;
  // Prefer de-DE over de-AT, de-CH
  if (v.lang === 'de-DE') s += 10;
  else if (v.lang && v.lang.toLowerCase().startsWith('de')) s += 5;
  return s;
}

function pickBestGermanVoice(voices) {
  const german = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('de'));
  if (german.length === 0) return voices[0] || null;
  german.sort((a, b) => voiceScore(b) - voiceScore(a));
  return german[0];
}

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const update = () => {
    _voices = speechSynthesis.getVoices();
    if (!_voices.length) return false;
    // Apply user choice if it still exists
    if (_userVoiceId) {
      const found = _voices.find(v => v.voiceURI === _userVoiceId || v.name === _userVoiceId);
      if (found) { _selectedVoice = found; populateVoicePicker(); return true; }
    }
    _selectedVoice = pickBestGermanVoice(_voices);
    populateVoicePicker();
    return true;
  };
  if (!update()) {
    speechSynthesis.onvoiceschanged = update;
  }
}

function populateVoicePicker() {
  const sel = document.getElementById('voice-select');
  if (!sel) return;
  const german = _voices
    .filter(v => v.lang && v.lang.toLowerCase().startsWith('de'))
    .sort((a, b) => voiceScore(b) - voiceScore(a));
  if (german.length === 0) {
    sel.innerHTML = '<option>(keine deutschen Stimmen verfügbar)</option>';
    return;
  }
  sel.innerHTML = '';
  for (const v of german) {
    const opt = document.createElement('option');
    opt.value = v.voiceURI || v.name;
    let label = v.name;
    // Hint quality
    const n = v.name.toLowerCase();
    if (n.includes('natural') || n.includes('neural') || n.includes('premium')) label += ' ★';
    else if (n.includes('google') || n.includes('online')) label += ' ✓';
    opt.textContent = label;
    if (_selectedVoice && (v.voiceURI === _selectedVoice.voiceURI || v.name === _selectedVoice.name)) {
      opt.selected = true;
    }
    sel.appendChild(opt);
  }
}

function speak(text, btn) {
  if (!('speechSynthesis' in window)) return;
  if (currentUtterance) {
    speechSynthesis.cancel();
    document.querySelectorAll('.speak-btn.speaking').forEach(b => b.classList.remove('speaking'));
    currentUtterance = null;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  if (_selectedVoice) u.voice = _selectedVoice;
  // Slightly slower & natural pitch = less robotic
  u.rate = 0.96;
  u.pitch = 1.0;
  u.volume = 1.0;
  if (btn) {
    btn.classList.add('speaking');
    u.onend = u.onerror = () => btn.classList.remove('speaking');
  }
  currentUtterance = u;
  speechSynthesis.speak(u);
}

// Load voices on init
loadVoices();

function combinedText(blackText, white) {
  if (!blackText) return '';
  if (!white) return blackText.replace(/__/g, '');
  if (blackText.includes('__')) return blackText.replace('__', white);
  return blackText + ' ' + white;
}

// --- Confetti ---
function confetti(count = 110) {
  const colors = ['#ff5c5c', '#ffb800', '#5dd17f', '#5c8dff', '#ff80ab', '#ffffff', '#ff3b3b'];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = (6 + Math.random() * 8) + 'px';
    piece.style.height = (8 + Math.random() * 14) + 'px';
    piece.style.animationDelay = Math.random() * 0.5 + 's';
    piece.style.animationDuration = (2.4 + Math.random() * 2.2) + 's';
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 5000);
  }
}

// --- Score animation ---
const lastScores = {};
function bumpScore(playerId) {
  const li = document.querySelector(`#scoreboard li[data-pid="${playerId}"]`);
  if (!li) return;
  const numEl = li.querySelector('.score-num');
  if (numEl) {
    numEl.classList.remove('bumped');
    void numEl.offsetWidth; // restart animation
    numEl.classList.add('bumped');
    setTimeout(() => numEl.classList.remove('bumped'), 700);

    const float = document.createElement('div');
    float.className = 'score-float';
    float.textContent = '+1';
    li.appendChild(float);
    setTimeout(() => float.remove(), 1500);
  }
}

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

// --- Mute toggle ---
function updateMuteButton() {
  const b = $('#mute-btn');
  if (!b) return;
  b.textContent = muted ? '🔇' : '🔊';
  b.classList.toggle('muted', muted);
}
$('#mute-btn').addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem('cah_muted', muted ? '1' : '0');
  updateMuteButton();
  if (!muted) playTone(660, 0.06, 'sine', 0.05);
});
updateMuteButton();

// Voice picker
const voiceSelect = document.getElementById('voice-select');
if (voiceSelect) {
  voiceSelect.addEventListener('change', () => {
    const id = voiceSelect.value;
    const found = _voices.find(v => v.voiceURI === id || v.name === id);
    if (found) {
      _selectedVoice = found;
      _userVoiceId = id;
      localStorage.setItem('cah_voice', id);
      // Demo
      speak('Hallo, so klinge ich.', null);
    }
  });
}

// --- Avatar grid ---
function renderAvatarGrid() {
  const grid = $('#avatar-grid');
  grid.innerHTML = '';
  for (const av of AVATARS) {
    const el = document.createElement('div');
    el.className = 'avatar-pick' + (av.id === selectedAvatar ? ' selected' : '');
    el.innerHTML = `<span class="em">${av.emoji}</span><span class="lb">${av.label}</span>`;
    el.addEventListener('click', () => {
      selectedAvatar = av.id;
      localStorage.setItem('cah_avatar', av.id);
      renderAvatarGrid();
      playTone(700, 0.04, 'triangle', 0.04);
    });
    grid.appendChild(el);
  }
}
renderAvatarGrid();

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
  socket.emit('create-room', { name, avatar: selectedAvatar });
});

$('#join-btn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!name) { loginError.textContent = 'Bitte Namen eingeben.'; return; }
  if (!code) { loginError.textContent = 'Bitte Raum-Code eingeben.'; return; }
  localStorage.setItem('cah_name', name);
  socket.emit('join-room', { code, name, avatar: selectedAvatar });
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

// --- Rejoin handling ---
const REJOIN_TTL_MS = 15 * 60 * 1000;

function saveLastSession(code, name, avatar) {
  try {
    localStorage.setItem('cah_last_room', JSON.stringify({ code, name, avatar, ts: Date.now() }));
  } catch (e) {}
}
function getLastSession() {
  try {
    const raw = localStorage.getItem('cah_last_room');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.code || !data.name) return null;
    if (Date.now() - (data.ts || 0) > REJOIN_TTL_MS) return null;
    return data;
  } catch (e) { return null; }
}
function clearLastSession() {
  try { localStorage.removeItem('cah_last_room'); } catch (e) {}
}

function renderRejoinArea() {
  const area = document.getElementById('rejoin-area');
  const info = document.getElementById('rejoin-info');
  const data = getLastSession();
  if (data && area) {
    const ageMin = Math.max(0, Math.round((Date.now() - data.ts) / 60000));
    info.textContent = `Letzter Raum: ${data.code} als ${data.name} (vor ${ageMin} Min)`;
    area.style.display = '';
  } else if (area) {
    area.style.display = 'none';
  }
}
renderRejoinArea();

const rejoinBtn = document.getElementById('rejoin-btn');
if (rejoinBtn) {
  rejoinBtn.addEventListener('click', () => {
    const data = getLastSession();
    if (!data) { renderRejoinArea(); return; }
    if (data.name) nameInput.value = data.name;
    if (data.avatar) {
      selectedAvatar = data.avatar;
      renderAvatarGrid();
    }
    loginError.textContent = '';
    socket.emit('join-room', { code: data.code, name: data.name, avatar: data.avatar || selectedAvatar });
  });
}

// --- Socket events ---
socket.on('joined', ({ code }) => {
  $('#room-code').textContent = code;
  $('#room-info').classList.remove('hidden');
  loginError.textContent = '';
  soundJoin();
  saveLastSession(code, nameInput.value.trim(), selectedAvatar);
});

socket.on('error-msg', (msg) => {
  loginError.textContent = msg;
});

socket.on('state', (s) => {
  const prev = state;
  state = s;
  triggerStateSounds(prev, s);
  render(prev);
  lastState = s;
});

function triggerStateSounds(prev, s) {
  if (!prev) return;
  if (prev.state !== s.state) {
    if (s.state === 'reveal') {
      // first card already counted by render
    } else if (s.state === 'voting') {
      playTone(330, 0.12, 'triangle', 0.05);
    } else if (s.state === 'scoring') {
      if (s.winner) {
        if (s.winner.tied || s.winner.none) soundTie();
        else { soundWin(); confetti(); }
      }
    }
  }
  // Submission revealed: play flip sound if revealedIndex increased
  if (prev.state === 'reveal' && s.state === 'reveal' && s.revealedIndex > prev.revealedIndex) {
    soundCardFlip();
  }
  if (prev.state === 'submitting' && s.state === 'reveal') {
    // first reveal starts
    soundCardFlip();
  }
  // Vote registered (your own vote)
  if (s.state === 'voting' && typeof s.yourVote === 'number' && (!prev || prev.yourVote !== s.yourVote)) {
    soundVote();
  }
}

// --- Render ---
function render(prev) {
  if (!state) return;
  if (state.state === 'lobby') {
    show('lobby');
    renderLobby();
  } else {
    show('game');
    renderGame(prev);
  }
}

function renderLobby() {
  $('#lobby-code').textContent = state.code;
  const ul = $('#lobby-players');
  ul.innerHTML = '';
  for (const p of state.players) {
    const av = getAvatar(p.avatar);
    const li = document.createElement('li');
    if (p.id === state.yourId) li.classList.add('you');
    if (!p.connected) li.classList.add('disconnected');
    li.innerHTML = `
      <span class="p-avatar"><span class="em">${av.emoji}</span><span class="nm">${escapeHtml(p.name)}${p.id === state.yourId ? ' (du)' : ''}${!p.connected ? ' (weg)' : ''}</span></span>
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
  playTone(523, 0.1); setTimeout(() => playTone(784, 0.18), 80);
});

function renderGame(prev) {
  $('#room-code').textContent = state.code;
  $('#room-info').classList.remove('hidden');

  // Scoreboard
  const sb = $('#scoreboard');
  sb.innerHTML = '';
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const bumps = [];
  for (const p of sorted) {
    const av = getAvatar(p.avatar);
    const li = document.createElement('li');
    li.dataset.pid = p.id;
    if (p.id === state.yourId) li.classList.add('you');
    if (!p.connected) li.classList.add('disconnected');
    let tag = '';
    if (p.isHost) tag += '<span class="tag host">Host</span>';
    if (state.state === 'submitting' && p.hasSubmitted) tag += '<span class="tag done">Fertig</span>';
    if (state.state === 'voting' && p.hasVoted) tag += '<span class="tag done">Gewählt</span>';
    li.innerHTML = `
      <span class="p-avatar"><span class="em">${av.emoji}</span><span class="nm">${escapeHtml(p.name)}${p.id === state.yourId ? ' (du)' : ''} ${tag}</span></span>
      <span class="score-num">${p.score}</span>
    `;
    sb.appendChild(li);
    // Detect score increase
    const prevScore = lastScores[p.id];
    if (prevScore !== undefined && p.score > prevScore) bumps.push(p.id);
    lastScores[p.id] = p.score;
  }
  // Trigger bumps after DOM is in place
  bumps.forEach(pid => setTimeout(() => bumpScore(pid), 200));

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

      // Animate the freshly-revealed card during reveal phase
      if (state.state === 'reveal' && prev && s.revealed && s.index === state.revealedIndex - 1 && (!prev.submissions[s.index] || !prev.submissions[s.index].revealed)) {
        card.classList.add('revealing');
      }

      if (!s.revealed) {
        card.classList.add('face-down');
        card.innerHTML = '';
      } else {
        card.textContent = s.card;
      }

      // Mark own submission (during voting we know our card text)
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
          card.addEventListener('click', () => {
            card.classList.add('vote-ripple');
            setTimeout(() => card.classList.remove('vote-ripple'), 600);
            socket.emit('vote', { index: s.index });
          });
        } else if (alreadyVoted && !isOwn) {
          card.classList.add('disabled');
        }
      }

      // Scoring: show player avatar & votes
      if (state.state === 'scoring') {
        if (s.playerName) {
          const av = getAvatar(s.playerAvatar);
          const tag = document.createElement('div');
          tag.className = 'avatar-tag';
          tag.innerHTML = `<span class="em">${av.emoji}</span><span>${escapeHtml(s.playerName)}</span>`;
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
        if (state.winner && state.winner.tied && state.winner.indices && state.winner.indices.includes(s.index)) {
          card.classList.add('winner');
        }
      }

      // Speak button on revealed cards (reveal/voting/scoring)
      if (s.revealed && s.card) {
        const speakBtn = document.createElement('button');
        speakBtn.className = 'speak-btn';
        speakBtn.textContent = '🔊';
        speakBtn.title = 'Vorlesen';
        speakBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          speak(combinedText(state.blackCard, s.card), speakBtn);
        });
        card.appendChild(speakBtn);
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
      const av = getAvatar(state.players.find(p => p.name === state.winner.playerName)?.avatar);
      winnerEl.innerHTML = `<h3>🏆 ${av.emoji} ${escapeHtml(state.winner.playerName)} gewinnt!</h3><p>"${escapeHtml(state.winner.card)}" – ${state.winner.votes} Stimme${state.winner.votes === 1 ? '' : 'n'} · +1 Punkt</p>`;
    }
    // Auto-read winner sentence (only on transition into scoring)
    if (prev && prev.state !== 'scoring' && state.winner && !state.winner.none) {
      const text = state.winner.tied
        ? 'Unentschieden!'
        : combinedText(state.blackCard, state.winner.card);
      setTimeout(() => speak(text, null), 700);
    }
  } else {
    winnerEl.classList.add('hidden');
  }

  // Gamemaster message
  const gmEl = $('#gm-area');
  const gmText = gmEl.querySelector('.gm-text');
  if (state.state === 'scoring' && state.gmMessage) {
    gmEl.classList.remove('hidden');
    if (gmText.textContent !== state.gmMessage) {
      gmText.textContent = state.gmMessage;
      // Re-trigger entrance animation when message changes
      gmEl.style.animation = 'none';
      void gmEl.offsetWidth;
      gmEl.style.animation = '';
    }
    // Auto-read GM message after winner sentence (~3.5s delay)
    if (prev && prev.gmMessage !== state.gmMessage) {
      setTimeout(() => speak(state.gmMessage, null), 3500);
    }
  } else {
    gmEl.classList.add('hidden');
    gmText.textContent = '';
  }

  // Auto-progress countdown
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
      el.addEventListener('click', () => {
        el.classList.add('submit-pulse');
        soundSubmit();
        socket.emit('submit-card', { card });
      });
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
