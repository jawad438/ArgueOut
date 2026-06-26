/* spectate.js — spectator view of a live debate */

const params = new URLSearchParams(location.search);
const roomId = params.get('room');
if (!roomId) { window.location.href = '/debates'; }

const socket = io({ autoConnect: false });

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function posTag(x, y) {
  return (y >= 0 ? 'Auth' : 'Lib') + '-' + (x >= 0 ? 'R' : 'L');
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

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

// ── Debate chat (read-only) ──────────────────────────────────
function addDebateMessage(username, message, timestamp) {
  const feed = document.getElementById('specDebateChat');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = 'spec-msg';
  div.innerHTML = `
    <div class="spec-msg-header">
      <span class="spec-msg-author">@${esc(username)}</span>
      <span class="spec-msg-time">${fmtTime(timestamp)}</span>
    </div>
    <div class="spec-msg-body">${esc(message)}</div>
  `;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

// ── Spectator comments ───────────────────────────────────────
const commentMap = new Map(); // commentId -> element

function addSpectatorComment(payload) {
  const list = document.getElementById('specComments');
  if (!list) return;
  const div = document.createElement('div');
  div.className = 'spec-comment';
  div.dataset.id = payload.id;
  div.innerHTML = `
    <div class="spec-comment-header">
      <span class="spec-comment-author">@${esc(payload.username)}</span>
      <span class="spec-comment-time">${fmtTime(payload.timestamp)}</span>
    </div>
    <div class="spec-comment-body">${esc(payload.message)}</div>
  `;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
  commentMap.set(payload.id, div);
}

// ── Golden highlight animation ───────────────────────────────
let hlToastTimer = null;

function highlightComment(commentId, username, message, highlightedBy) {
  // 1. Animate the comment in the list
  const el = commentMap.get(commentId);
  if (el) {
    el.classList.remove('highlighted', 'highlighted-persist');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('highlighted');

    // Add "Highlighted" tag to header if not already there
    const header = el.querySelector('.spec-comment-header');
    if (header && !header.querySelector('.spec-comment-highlight-tag')) {
      const tag = document.createElement('span');
      tag.className = 'spec-comment-highlight-tag';
      tag.textContent = '⭐ Highlighted';
      header.appendChild(tag);
    }

    // After burst animation ends, switch to slow shimmer
    setTimeout(() => {
      el.classList.remove('highlighted');
      el.classList.add('highlighted-persist');
    }, 1500);
  }

  // 2. Show floating toast overlay
  showHighlightToast(username, message, highlightedBy);
}

function showHighlightToast(username, message, highlightedBy) {
  const overlay = document.getElementById('specHighlightOverlay');
  if (!overlay) return;

  if (hlToastTimer) { clearTimeout(hlToastTimer); hlToastTimer = null; }

  const existing = overlay.querySelector('.spec-hl-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'spec-hl-toast';
  toast.innerHTML = `
    <div class="spec-hl-label">
      <span class="spec-hl-star">⭐</span> Highlighted Question
    </div>
    <div class="spec-hl-author">@${esc(username)}</div>
    <div class="spec-hl-message">${esc(message)}</div>
    <div class="spec-hl-by">Highlighted by @${esc(highlightedBy)}</div>
  `;
  overlay.appendChild(toast);

  hlToastTimer = setTimeout(() => {
    toast.classList.add('ao-toast-fade-out');
    setTimeout(() => toast.remove(), 420);
    hlToastTimer = null;
  }, 6000);
}

// ── Spectator comment input ──────────────────────────────────
const specInput   = document.getElementById('specInput');
const specSendBtn = document.getElementById('specSendBtn');

function sendComment() {
  const msg = specInput?.value.trim();
  if (!msg) return;
  socket.emit('spectator-comment', { roomId, message: msg });
  specInput.value = '';
  specInput.style.height = 'auto';
}

if (specSendBtn) specSendBtn.addEventListener('click', sendComment);
if (specInput) {
  specInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); }
  });
  specInput.addEventListener('input', () => {
    specInput.style.height = 'auto';
    specInput.style.height = Math.min(specInput.scrollHeight, 100) + 'px';
  });
}

// ── Show debate UI once joined ───────────────────────────────
function showDebateUI(data) {
  document.getElementById('specConnecting').style.display = 'none';
  document.getElementById('specMain').style.display = 'flex';
  document.getElementById('specSide').style.display = 'flex';

  // Topic
  const topicEl = document.getElementById('specTopic');
  if (topicEl) {
    topicEl.textContent = data.question || '';
    if (!data.question) {
      topicEl.innerHTML = '<span class="spec-topic-placeholder">No topic set yet</span>';
    }
  }

  // Debaters
  const debatersEl = document.getElementById('specDebaters');
  if (debatersEl && data.users?.length === 2) {
    const [u1, u2] = data.users;
    debatersEl.innerHTML = `
      <div class="spec-debater">
        <span class="spec-debater-name">@${esc(u1.username)}</span>
        <span class="spec-debater-pos">${posTag(u1.politicalX, u1.politicalY)}</span>
      </div>
      <span class="spec-vs">vs</span>
      <div class="spec-debater">
        <span class="spec-debater-name">@${esc(u2.username)}</span>
        <span class="spec-debater-pos">${posTag(u2.politicalX, u2.politicalY)}</span>
      </div>
    `;
  }

  updateSpectatorCount(data.spectatorCount || 0);
}

function updateSpectatorCount(n) {
  const el = document.getElementById('specCount');
  if (el) el.textContent = n + ' watching';
}

// ── Socket events ────────────────────────────────────────────
socket.on('spectate-joined', data => {
  showDebateUI(data);
});

socket.on('spectate-error', ({ error }) => {
  document.getElementById('specConnecting').innerHTML =
    `<svg style="width:40px;height:40px;fill:none;stroke:currentColor;stroke-width:1.5;opacity:0.3;stroke-linecap:round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
     <span style="color:var(--text-2)">${esc(error)}</span>
     <a href="/debates" style="color:var(--purple);font-size:0.85rem">← Back to Live Debates</a>`;
});

socket.on('chat-message', ({ username, message, timestamp }) => {
  // Debate chat from debaters (read-only for spectators)
  addDebateMessage(username, message, timestamp);
});

socket.on('spectator-comment', payload => {
  addSpectatorComment(payload);
});

socket.on('comment-highlighted', ({ commentId, username, message, highlightedBy }) => {
  highlightComment(commentId, username, message, highlightedBy);
});

socket.on('question-updated', ({ question }) => {
  if (!question) return;
  const topicEl = document.getElementById('specTopic');
  if (topicEl) topicEl.textContent = question;
});

socket.on('spectator-count', ({ count }) => {
  updateSpectatorCount(count);
});

socket.on('debate-ended', () => {
  const feed = document.getElementById('specDebateChat');
  if (feed) {
    const notice = document.createElement('div');
    notice.className = 'spec-ended-notice';
    notice.textContent = 'This debate has ended.';
    feed.appendChild(notice);
    feed.scrollTop = feed.scrollHeight;
  }
  if (specInput) specInput.disabled = true;
  if (specSendBtn) specSendBtn.disabled = true;
  showToast('This debate has ended.', 'info');
});

// ── Auth → connect ───────────────────────────────────────────
function connectAndJoin(idToken) {
  if (!socket.connected) {
    socket.connect();
    socket.once('connect', () => socket.emit('join-spectate', { roomId, idToken }));
  } else {
    socket.emit('join-spectate', { roomId, idToken });
  }
}

try {
  auth.onAuthStateChanged(async user => {
    let idToken = null;
    if (user) { try { idToken = await user.getIdToken(); } catch {} }
    connectAndJoin(idToken);
  });
} catch {
  connectAndJoin(null);
}
