/* judge.js — The Bench: judge scoring page for a debate that just ended */

const params = new URLSearchParams(location.search);
const roomId = params.get('room');
if (!roomId) { window.location.href = '/debates'; }

const socket = io({ autoConnect: false });

function showToast(msg, type) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast toast-' + (type || 'info');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

// The Bench Scoring Model - weights must sum to 1.
const CATEGORIES = [
  { key: 'argumentQuality', label: 'Argument Quality', weight: 0.30, desc: 'Logic, evidence, coherence' },
  { key: 'responsiveness',  label: 'Responsiveness',   weight: 0.25, desc: "Did they actually address their opponent's points?" },
  { key: 'persuasion',      label: 'Persuasion',        weight: 0.25, desc: 'How well did they move the needle on the question?' },
  { key: 'delivery',        label: 'Delivery',          weight: 0.20, desc: 'Clarity, engagement, confidence' }
];

const scores = { a: {}, b: {} };

function weightedAvg(side) {
  return CATEGORIES.reduce((sum, cat) => sum + cat.weight * (scores[side][cat.key] || 5), 0);
}

function buildCats(side) {
  const container = document.getElementById(side === 'a' ? 'benchCatsA' : 'benchCatsB');
  container.innerHTML = CATEGORIES.map(cat => `
    <div class="bench-cat">
      <div class="bench-cat-label">
        <span>${cat.label}</span>
        <span class="bench-cat-weight">${Math.round(cat.weight * 100)}%</span>
      </div>
      <div class="bench-cat-desc">${cat.desc}</div>
      <input type="range" class="bench-slider" min="1" max="10" step="1" value="5"
             data-side="${side}" data-cat="${cat.key}" oninput="onSliderInput(this)">
      <div class="bench-slider-value" id="benchVal-${side}-${cat.key}">5 / 10</div>
    </div>
  `).join('');
  CATEGORIES.forEach(cat => { scores[side][cat.key] = 5; });
}

function onSliderInput(el) {
  const side = el.dataset.side, cat = el.dataset.cat;
  scores[side][cat] = Number(el.value);
  document.getElementById(`benchVal-${side}-${cat}`).textContent = `${el.value} / 10`;
  updateAvg(side);
}

function updateAvg(side) {
  const avg = weightedAvg(side);
  document.getElementById(side === 'a' ? 'benchAvgA' : 'benchAvgB').textContent =
    `Weighted average: ${avg.toFixed(1)} / 10`;
}

function showError(message) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('errorText').textContent = message;
  document.getElementById('errorState').style.display = 'block';
}

socket.on('judge-session-joined', ({ question, debaterA, debaterB }) => {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('benchQuestion').textContent = question || 'No topic recorded';
  document.getElementById('benchNameA').textContent = '@' + debaterA.username;
  document.getElementById('benchNameB').textContent = '@' + debaterB.username;
  buildCats('a'); buildCats('b');
  updateAvg('a'); updateAvg('b');
  document.getElementById('benchForm').style.display = 'block';
});

socket.on('judge-session-error', ({ error }) => {
  showError(error || "This debate isn't available to judge.");
});

socket.on('judge-scores-submitted', () => {
  document.getElementById('benchForm').style.display = 'none';
  document.getElementById('doneState').style.display = 'block';
});

function submitScores() {
  const btn = document.getElementById('submitScoresBtn');
  btn.disabled = true;
  socket.emit('submit-judge-scores', { roomId, scores });
}

function connectAndJoin(idToken) {
  if (!socket.connected) {
    socket.connect();
    socket.once('connect', () => {
      socket.emit('authenticate', { idToken });
      socket.once('authenticated', () => socket.emit('join-judge-session', { roomId }));
    });
  } else {
    socket.emit('join-judge-session', { roomId });
  }
}

auth.onAuthStateChanged(async user => {
  if (!user) { window.location.href = '/login'; return; }
  let idToken = null;
  try { idToken = await user.getIdToken(); } catch {}
  connectAndJoin(idToken);
});
