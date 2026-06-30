/* spectate.js — spectator view of a live debate */

const params = new URLSearchParams(location.search);
const roomId = params.get('room');
if (!roomId) { window.location.href = '/debates'; }

const socket = io({ autoConnect: false });

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const ICON_STAR = '<svg style="width:12px;height:12px;vertical-align:-1px" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

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

// ── WebRTC: receive debater streams ─────────────────────────
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];
const debaterPeerConns = new Map(); // debaterSocketId → RTCPeerConnection
const debaterSlots     = [null, null]; // socketId occupying slot 0 and 1

function showDebaterStream(socketId, username, stream) {
  let idx = debaterSlots.indexOf(socketId);
  if (idx === -1) {
    idx = debaterSlots.indexOf(null);
    if (idx === -1) idx = 0;
    debaterSlots[idx] = socketId;
  }
  const n = idx + 1;
  const video       = document.getElementById(`specVideo${n}`);
  const placeholder = document.getElementById(`specVideoPlaceholder${n}`);
  const label       = document.getElementById(`specVideoLabel${n}`);
  const initials    = document.getElementById(`specVideoInitials${n}`);
  if (video) { video.srcObject = stream; video.style.display = 'block'; video.play().catch(() => {}); }
  if (placeholder) placeholder.style.display = 'none';
  if (label)    label.textContent    = `@${username}`;
  if (initials) initials.textContent = username ? username[0].toUpperCase() : '?';
}

// ── Current user ─────────────────────────────────────────────
let currentUsername = null;
let currentSpecId   = null;

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
const commentMap     = new Map(); // commentId -> element
const spectatorNames = new Set(); // for @mention autocomplete

function renderWithMentions(text) {
  return esc(text).replace(/@([\w][\w-]*)/g, (_, name) => {
    const isSelf = currentUsername && name.toLowerCase() === currentUsername.toLowerCase();
    return `<span class="spec-mention${isSelf ? ' spec-mention-self' : ''}">@${name}</span>`;
  });
}

function addSpectatorComment(payload) {
  const list = document.getElementById('specComments');
  if (!list) return;
  spectatorNames.add(payload.username);

  const div = document.createElement('div');
  div.className = 'spec-comment';
  div.dataset.id = payload.id;
  div.innerHTML = `
    <div class="spec-comment-header">
      <span class="spec-comment-author">@${esc(payload.username)}</span>
      <span class="spec-comment-time">${fmtTime(payload.timestamp)}</span>
    </div>
    <div class="spec-comment-body">${renderWithMentions(payload.message)}</div>
  `;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
  commentMap.set(payload.id, div);

  // Mobile badge
  if (typeof window._specSheetShowBadge === 'function') window._specSheetShowBadge();

  // Mention notification
  if (currentUsername && payload.username !== currentUsername) {
    const mentionPattern = new RegExp('@' + currentUsername.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i');
    if (mentionPattern.test(payload.message)) {
      showToast(`@${payload.username} mentioned you`, 'info');
      div.classList.add('spec-comment-mentioned');
    }
  }
}

// ── Golden highlight animation ───────────────────────────────
let hlToastTimer = null;

function highlightComment(commentId, username, message, highlightedBy) {
  const el = commentMap.get(commentId);
  if (el) {
    el.classList.remove('highlighted', 'highlighted-persist');
    void el.offsetWidth;
    el.classList.add('highlighted');
    const header = el.querySelector('.spec-comment-header');
    if (header && !header.querySelector('.spec-comment-highlight-tag')) {
      const tag = document.createElement('span');
      tag.className = 'spec-comment-highlight-tag';
      tag.innerHTML = ICON_STAR + ' Highlighted';
      header.appendChild(tag);
    }
    setTimeout(() => {
      el.classList.remove('highlighted');
      el.classList.add('highlighted-persist');
    }, 1500);
  }
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
    <div class="spec-hl-label"><span class="spec-hl-star">${ICON_STAR}</span> Highlighted Question</div>
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

// ── @Mention autocomplete ────────────────────────────────────
const specInput   = document.getElementById('specInput');
const specSendBtn = document.getElementById('specSendBtn');

let mentionStart = -1;

function checkMentionTrigger() {
  if (!specInput) return;
  const val    = specInput.value;
  const cursor = specInput.selectionStart;
  const before = val.slice(0, cursor);
  const atIdx  = before.lastIndexOf('@');
  if (atIdx === -1 || (atIdx > 0 && /\w/.test(before[atIdx - 1]))) {
    closeMentionDropdown(); return;
  }
  const query = before.slice(atIdx + 1);
  if (/\s/.test(query)) { closeMentionDropdown(); return; }
  mentionStart = atIdx;
  const matches = [...spectatorNames].filter(
    n => n.toLowerCase().startsWith(query.toLowerCase()) && n !== currentUsername
  );
  if (matches.length) showMentionDropdown(matches);
  else closeMentionDropdown();
}

function showMentionDropdown(names) {
  let dd = document.getElementById('specMentionDropdown');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'specMentionDropdown';
    dd.className = 'spec-mention-dropdown';
    document.getElementById('specSide')?.appendChild(dd);
  }
  dd.innerHTML = names.slice(0, 5).map(n =>
    `<button class="spec-mention-item" data-name="${esc(n)}">@${esc(n)}</button>`
  ).join('');
  dd.style.display = 'block';
  dd.querySelectorAll('.spec-mention-item').forEach(btn =>
    btn.addEventListener('mousedown', e => { e.preventDefault(); insertMention(btn.dataset.name); })
  );
}

function closeMentionDropdown() {
  const dd = document.getElementById('specMentionDropdown');
  if (dd) dd.style.display = 'none';
  mentionStart = -1;
}

function insertMention(name) {
  if (!specInput) return;
  const val    = specInput.value;
  const before = val.slice(0, mentionStart);
  const after  = val.slice(specInput.selectionStart);
  specInput.value = before + '@' + name + ' ' + after;
  specInput.focus();
  const pos = mentionStart + name.length + 2;
  specInput.setSelectionRange(pos, pos);
  closeMentionDropdown();
}

// ── Comment input ────────────────────────────────────────────
function sendComment() {
  const msg = specInput?.value.trim();
  if (!msg) return;
  socket.emit('spectator-comment', { roomId, message: msg });
  specInput.value = '';
  specInput.style.height = 'auto';
  closeMentionDropdown();
}

if (specSendBtn) specSendBtn.addEventListener('click', sendComment);
if (specInput) {
  specInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMentionDropdown(); return; }
    const dd = document.getElementById('specMentionDropdown');
    if (dd && dd.style.display !== 'none') {
      const items = [...dd.querySelectorAll('.spec-mention-item')];
      if (e.key === 'ArrowDown') { e.preventDefault(); items[0]?.focus(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); }
  });
  specInput.addEventListener('input', () => {
    specInput.style.height = 'auto';
    specInput.style.height = Math.min(specInput.scrollHeight, 100) + 'px';
    checkMentionTrigger();
  });
  specInput.addEventListener('blur', () => setTimeout(closeMentionDropdown, 150));
}

// ── Show debate UI once joined ───────────────────────────────
function showDebateUI(data) {
  document.getElementById('specConnecting').style.display = 'none';
  document.getElementById('specMain').style.display = 'flex';
  document.getElementById('specSide').style.display = 'flex';

  currentUsername = data.currentUsername || null;
  currentSpecId   = data.currentSpecId   || null;

  const topicEl = document.getElementById('specTopic');
  if (topicEl) {
    topicEl.innerHTML = '';
    if (data.question) {
      topicEl.textContent = data.question;
    } else {
      topicEl.innerHTML = '<span class="spec-topic-placeholder">No topic set yet</span>';
    }
  }

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

  if (data.users?.length === 2) {
    const [u1, u2] = data.users;
    const l1 = document.getElementById('specVideoLabel1');
    const l2 = document.getElementById('specVideoLabel2');
    const i1 = document.getElementById('specVideoInitials1');
    const i2 = document.getElementById('specVideoInitials2');
    if (l1) l1.textContent = `@${u1.username}`;
    if (l2) l2.textContent = `@${u2.username}`;
    if (i1) i1.textContent = u1.username ? u1.username[0].toUpperCase() : '?';
    if (i2) i2.textContent = u2.username ? u2.username[0].toUpperCase() : '?';
  }

  updateSpectatorCount(data.spectatorCount || 0);
  if (currentUsername) spectatorNames.add(currentUsername);
}

function updateSpectatorCount(n) {
  const el = document.getElementById('specCount');
  if (el) el.textContent = n > 0 ? n : '';
}

// ── Branch (side) debate ─────────────────────────────────────
let currentBranchId = null;

function startBranch() {
  if (currentBranchId) { switchToTab('branch'); return; }
  socket.emit('start-branch', { roomId });
}

function joinBranch(branchId) {
  socket.emit('join-branch', { branchId });
  hideBranchInvite();
}

function hideBranchInvite() {
  const inv = document.getElementById('specBranchInvite');
  if (inv) inv.remove();
}

function switchToTab(tab) {
  const specTab   = document.getElementById('tabSpectators');
  const branchTab = document.getElementById('tabBranch');
  const specPane  = document.getElementById('specComments');
  const branchPane = document.getElementById('specBranchPane');
  const inputWrap = document.getElementById('specInputWrap');
  const branchInputWrap = document.getElementById('specBranchInputWrap');

  if (tab === 'branch') {
    if (specTab)   specTab.classList.remove('active');
    if (branchTab) branchTab.classList.add('active');
    if (specPane)  specPane.style.display = 'none';
    if (branchPane) branchPane.style.display = 'flex';
    if (inputWrap) inputWrap.style.display = 'none';
    if (branchInputWrap) branchInputWrap.style.display = 'flex';
  } else {
    if (specTab)   specTab.classList.add('active');
    if (branchTab) branchTab.classList.remove('active');
    if (specPane)  specPane.style.display = 'flex';
    if (branchPane) branchPane.style.display = 'none';
    if (inputWrap) inputWrap.style.display = 'flex';
    if (branchInputWrap) branchInputWrap.style.display = 'none';
  }
}

function openBranchPanel(data) {
  currentBranchId = data.branchId;
  const branchTab = document.getElementById('tabBranch');
  if (branchTab) branchTab.style.display = 'inline-flex';

  const topicEl = document.getElementById('specBranchTopic');
  if (topicEl) topicEl.textContent = data.question || 'Side Discussion';

  const membersEl = document.getElementById('specBranchMembers');
  if (membersEl) membersEl.textContent = (data.members || []).map(n => '@' + n).join(', ');

  switchToTab('branch');
}

function addBranchMessage(payload) {
  const list = document.getElementById('specBranchMessages');
  if (!list) return;
  const div = document.createElement('div');
  div.className = 'spec-comment';
  div.innerHTML = `
    <div class="spec-comment-header">
      <span class="spec-comment-author" style="color:var(--purple)">@${esc(payload.username)}</span>
      <span class="spec-comment-time">${fmtTime(payload.timestamp)}</span>
    </div>
    <div class="spec-comment-body">${renderWithMentions(payload.message)}</div>
  `;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

function addBranchSystem(text) {
  const list = document.getElementById('specBranchMessages');
  if (!list) return;
  const div = document.createElement('div');
  div.style.cssText = 'text-align:center;font-size:0.72rem;color:var(--text-3);padding:4px 0';
  div.textContent = text;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

function sendBranchMessage() {
  const inp = document.getElementById('specBranchInput');
  const msg = inp?.value.trim();
  if (!msg || !currentBranchId) return;
  socket.emit('branch-message', { branchId: currentBranchId, message: msg });
  inp.value = '';
  inp.style.height = 'auto';
}

const branchInput = document.getElementById('specBranchInput');
const branchSendBtn = document.getElementById('specBranchSendBtn');
if (branchSendBtn) branchSendBtn.addEventListener('click', sendBranchMessage);
if (branchInput) {
  branchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBranchMessage(); }
  });
  branchInput.addEventListener('input', () => {
    branchInput.style.height = 'auto';
    branchInput.style.height = Math.min(branchInput.scrollHeight, 100) + 'px';
  });
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

socket.on('spectator-kicked', ({ reason }) => {
  socket.disconnect();
  document.body.innerHTML = `
    <div style="min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center;background:var(--bg-0)">
      <svg style="width:52px;height:52px;fill:none;stroke:${reason==='ban'?'#ef4444':'#f97316'};stroke-width:1.5;opacity:0.7" viewBox="0 0 24 24">
        ${reason === 'ban'
          ? '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>'
          : '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'}
      </svg>
      <h2 style="font-size:1.25rem;font-weight:800;color:var(--text-1);margin:0">
        ${reason === 'ban' ? 'Removed from this debate' : 'You were kicked'}
      </h2>
      <p style="font-size:0.9rem;color:var(--text-3);margin:0;max-width:300px">
        ${reason === 'ban'
          ? 'A debater has removed you and you cannot rejoin this debate.'
          : 'A debater has removed you from watching this debate.'}
      </p>
      <a href="/debates" style="margin-top:8px;padding:10px 22px;background:var(--purple);color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.9rem">Browse Other Debates</a>
    </div>`;
});

socket.on('chat-message', ({ username, message, timestamp }) => {
  addDebateMessage(username, message, timestamp);
});

socket.on('spectator-comment', payload => {
  spectatorNames.add(payload.username);
  addSpectatorComment(payload);
});

socket.on('comment-highlighted', ({ commentId, username, message, highlightedBy }) => {
  highlightComment(commentId, username, message, highlightedBy);
});

socket.on('comment-unhighlighted', ({ commentId }) => {
  const el = commentMap.get(commentId);
  if (!el) return;
  el.classList.remove('highlighted', 'highlighted-persist');
  const tag = el.querySelector('.spec-comment-highlight-tag');
  if (tag) tag.remove();
});

// ── WebRTC: receive debater video/audio ─────────────────────
socket.on('spec-stream-offer', async ({ debaterSocketId, username, offer }) => {
  const existing = debaterPeerConns.get(debaterSocketId);
  if (existing) { try { existing.close(); } catch {} }

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  debaterPeerConns.set(debaterSocketId, pc);

  pc.ontrack = ({ streams }) => {
    if (streams[0]) showDebaterStream(debaterSocketId, username, streams[0]);
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('spec-stream-ice', { targetSocketId: debaterSocketId, candidate });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      debaterPeerConns.delete(debaterSocketId);
    }
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('spec-stream-answer', { debaterSocketId, answer });
  } catch {}
});

socket.on('spec-stream-ice', async ({ fromSocketId, candidate }) => {
  const pc = debaterPeerConns.get(fromSocketId);
  if (pc) try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
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

// Branch events
socket.on('branch-started', ({ branchId, question, members }) => {
  openBranchPanel({ branchId, question, members });
  addBranchSystem('Side discussion started');
});

socket.on('branch-invite', ({ branchId, initiator, question }) => {
  // Show invite banner in spectator chat
  const list = document.getElementById('specComments');
  if (!list) return;
  const inv = document.createElement('div');
  inv.id = 'specBranchInvite';
  inv.className = 'spec-branch-invite';
  inv.innerHTML = `
    <div class="spec-branch-invite-text">
      <strong>@${esc(initiator)}</strong> started a side discussion
      ${question ? `<span style="color:var(--text-3);font-size:0.78rem"> · ${esc(question.slice(0,60))}${question.length>60?'…':''}</span>` : ''}
    </div>
    <button class="spec-branch-join-btn" onclick="joinBranch('${esc(branchId)}')">Join</button>
  `;
  list.insertBefore(inv, list.firstChild);
});

socket.on('branch-joined', ({ branchId, question, members }) => {
  openBranchPanel({ branchId, question, members });
  addBranchSystem('You joined the side discussion');
});

socket.on('branch-message', payload => {
  addBranchMessage(payload);
  // Badge on tab if not currently viewing
  const branchTab = document.getElementById('tabBranch');
  const branchPane = document.getElementById('specBranchPane');
  if (branchPane && branchPane.style.display === 'none') {
    const badge = branchTab?.querySelector('.tab-badge');
    if (badge) { badge.style.display = 'inline-flex'; badge.textContent = '•'; }
  }
});

socket.on('branch-member-joined', ({ username }) => {
  addBranchSystem(`@${username} joined`);
  const membersEl = document.getElementById('specBranchMembers');
  if (membersEl) {
    const cur = membersEl.textContent;
    membersEl.textContent = cur ? cur + ', @' + username : '@' + username;
  }
});

socket.on('branch-member-left', ({ username }) => {
  addBranchSystem(`@${username} left`);
});

socket.on('branch-error', ({ error }) => {
  showToast(error, 'error');
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
