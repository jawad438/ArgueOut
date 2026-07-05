/* divide.js — The Divide: poll voting, opposite-side challenges, threaded
   comments with reactions. */

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const colors = { success: 'var(--green)', error: 'var(--red)', info: 'var(--purple)' };
  const icons  = {
    success: '<svg style="width:13px;height:13px;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg style="width:13px;height:13px;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info:    '<svg style="width:13px;height:13px;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  const toast  = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon" style="color:${colors[type]}">${icons[type]}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// Reaction icons — deliberately plain line-art SVGs (matching the app's icon
// style everywhere else) standing in for the three reaction concepts rather
// than raw emoji: a target for "an argument that lands", a raised hand for
// "gives me pause", a map pin for "cite your source".
const REACTION_META = [
  {
    key: 'sharp', label: 'Sharp',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>'
  },
  {
    key: 'fairPoint', label: 'Fair point',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11.5V7a2 2 0 0 0-4 0v4"/><path d="M14 11V5a2 2 0 0 0-4 0v6.5"/><path d="M10 11.5V7a2 2 0 0 0-4 0v7"/><path d="M18 9a2 2 0 0 1 4 0v5a8 8 0 0 1-8 8h-1.5c-2.5 0-4-.8-5.5-2.3l-3-3a2 2 0 0 1 2.8-2.9L8 15"/></svg>'
  },
  {
    key: 'sourceNeeded', label: 'Source needed',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 6.5-9 12-9 12s-9-5.5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'
  }
];

const OPTION_COLORS = ['var(--red)', 'var(--blue)', 'var(--green)', 'var(--amber)', 'var(--purple)', '#06b6d4'];
const MAX_VISUAL_REPLY_DEPTH = 4;

let currentIdToken = null;
let currentUserId  = null;
let pollsCache      = {};   // pollId -> poll object
let commentsCache   = {};   // pollId -> flat comment array
let openCommentPolls = new Set();
let activeDivideChallenge = null; // { challengeId, expiresAt }
let divideCountdownTimer  = null;

const socket = io({ autoConnect: false });

socket.on('connect', () => {
  const user = typeof auth !== 'undefined' && auth.currentUser;
  if (user) {
    user.getIdToken().then(token => {
      currentIdToken = token;
      socket.emit('authenticate', { idToken: token });
    }).catch(() => { if (currentIdToken) socket.emit('authenticate', { idToken: currentIdToken }); });
  } else if (currentIdToken) {
    socket.emit('authenticate', { idToken: currentIdToken });
  }
});

socket.on('authenticated', () => { fetchPolls(); });
socket.on('auth-error', ({ error }) => { showToast(error, 'error'); });

// -- Divide challenge real-time flow ------------------------------------

socket.on('divide-challenge-sent', ({ challengedUsername }) => {
  showToast(`Challenge sent to ${challengedUsername}!`, 'success');
});
socket.on('divide-challenge-error', ({ error }) => showToast(error, 'error'));
socket.on('divide-challenge-update', ({ message }) => showToast(message, 'info'));

socket.on('divide-challenge-received', (payload) => {
  activeDivideChallenge = payload;
  const textEl = document.getElementById('divideChallengeText');
  if (textEl) textEl.textContent = `${payload.challengerUsername} challenged you to debate "${payload.question}"`;
  const panel = document.getElementById('divideChallengeNotif');
  if (panel) panel.classList.add('active');
  startDivideCountdown(payload.expiresAt);
});

socket.on('divide-challenge-accepted', ({ roomId, opponent, question }) => {
  showToast('Challenge accepted! Starting debate...', 'success');
  localStorage.setItem('debateRoomId', roomId);
  localStorage.setItem('debateOpponent', JSON.stringify(opponent));
  if (question) localStorage.setItem('debateQuestion', question); else localStorage.removeItem('debateQuestion');
  setTimeout(() => { window.location.href = `/debate?room=${encodeURIComponent(roomId)}`; }, 600);
});

function startDivideCountdown(expiresAt) {
  clearInterval(divideCountdownTimer);
  function tick() {
    const secsLeft = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    const el = document.getElementById('divideChallengeCountdown');
    if (el) el.textContent = `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, '0')}`;
    if (secsLeft <= 0) {
      clearInterval(divideCountdownTimer);
      document.getElementById('divideChallengeNotif')?.classList.remove('active');
    }
  }
  tick();
  divideCountdownTimer = setInterval(tick, 1000);
}

function acceptDivideChallenge() {
  if (!activeDivideChallenge) return;
  socket.emit('divide-challenge-accept', { challengeId: activeDivideChallenge.challengeId });
  document.getElementById('divideChallengeNotif')?.classList.remove('active');
}
function declineDivideChallenge() {
  if (!activeDivideChallenge) return;
  socket.emit('divide-challenge-decline', { challengeId: activeDivideChallenge.challengeId });
  document.getElementById('divideChallengeNotif')?.classList.remove('active');
  clearInterval(divideCountdownTimer);
  activeDivideChallenge = null;
}

function triggerChallenge(pollId) {
  const btn = document.getElementById(`challengeBtn-${pollId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Finding opponent…'; }
  socket.emit('divide-challenge', { pollId });
  setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = 'Challenge a debater'; } }, 2500);
}

// -- Poll fetch/render ----------------------------------------------------

async function fetchPolls() {
  try {
    const res = await fetch('/api/polls', { headers: { 'Authorization': 'Bearer ' + currentIdToken } });
    if (!res.ok) throw new Error();
    const data = await res.json();
    (data.polls || []).forEach(p => { pollsCache[p.id] = p; });
    renderPolls(data.polls || []);
  } catch {
    document.getElementById('pollsList').innerHTML =
      '<div class="divide-empty">Could not load polls. <button class="btn btn-ghost btn-sm" onclick="fetchPolls()">Retry</button></div>';
  }
}

function renderPolls(polls) {
  const list = document.getElementById('pollsList');
  if (!polls.length) {
    list.innerHTML = `<div class="divide-empty">
      <svg style="width:48px;height:48px;fill:none;stroke:currentColor;stroke-width:1.5" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <h2 style="font-size:1.05rem;font-weight:700;color:var(--text-2);margin-bottom:6px">No polls yet</h2>
      <p style="font-size:0.85rem">Check back soon — new questions post regularly.</p>
    </div>`;
    return;
  }
  list.innerHTML = polls.map(renderPollCard).join('');
}

function renderPollCard(poll) {
  const myVote = poll.myVote;
  const hasVoted = myVote != null;
  const optionsHtml = poll.options.map((opt, i) => {
    const pct = poll.totalVotes ? Math.round((poll.votes[i] / poll.totalVotes) * 100) : 0;
    const color = OPTION_COLORS[i % OPTION_COLORS.length];
    const online = (poll.onlineCounts && poll.onlineCounts[i]) || 0;
    return `
      <button class="poll-option-btn ${myVote === i ? 'voted-mine' : ''}" ${hasVoted ? 'disabled' : ''}
        onclick="voteOnPoll('${poll.id}', ${i})">
        ${hasVoted ? `<span class="poll-option-fill" style="width:${pct}%;background:${color}"></span>` : ''}
        <span class="poll-option-label">
          <span>${escapeHtml(opt)}</span>
          ${hasVoted ? `<span class="poll-option-pct">${pct}%</span>` : ''}
        </span>
        ${hasVoted ? `<div class="poll-option-online">${online} online who voted this</div>` : ''}
      </button>`;
  }).join('');

  const canChallenge = hasVoted && poll.status === 'active';
  const opened = openCommentPolls.has(poll.id);

  return `
    <div class="poll-card" id="poll-${poll.id}">
      <div class="poll-question">${escapeHtml(poll.question)}</div>
      <div class="poll-options">${optionsHtml}</div>
      <div class="poll-meta">
        <span>${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'}</span>
        <span>${poll.commentCount || 0} comment${poll.commentCount === 1 ? '' : 's'}</span>
      </div>
      <div class="poll-actions">
        ${canChallenge
          ? `<button class="btn btn-primary btn-sm" id="challengeBtn-${poll.id}" onclick="triggerChallenge('${poll.id}')">Challenge a debater</button>`
          : (hasVoted ? '' : `<span style="font-size:0.8rem;color:var(--text-3)">Vote to unlock challenges</span>`)}
        <button class="btn btn-ghost btn-sm" onclick="toggleComments('${poll.id}')">${opened ? 'Hide discussion' : 'Discuss'}</button>
      </div>
      <div class="poll-comments-section ${opened ? 'open' : ''}" id="comments-${poll.id}">
        <div class="comment-composer">
          <textarea id="composer-${poll.id}" placeholder="Add to the discussion…" maxlength="500"></textarea>
          <button class="btn btn-primary btn-sm" onclick="submitComment('${poll.id}', null)" style="flex-shrink:0;align-self:flex-end">Post</button>
        </div>
        <div class="comment-list" id="commentList-${poll.id}">
          <div class="comments-empty">Loading…</div>
        </div>
      </div>
    </div>`;
}

async function voteOnPoll(pollId, optionIndex) {
  try {
    const res = await fetch(`/api/polls/${pollId}/vote`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + currentIdToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionIndex })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Could not vote.', 'error'); return; }
    pollsCache[pollId].myVote = optionIndex;
    pollsCache[pollId].votes = data.votes;
    pollsCache[pollId].totalVotes = data.votes.reduce((a, b) => a + b, 0);
    document.getElementById(`poll-${pollId}`).outerHTML = renderPollCard(pollsCache[pollId]);
    if (openCommentPolls.has(pollId)) fetchComments(pollId);
  } catch { showToast('Network error.', 'error'); }
}

socket.on('poll-vote-update', ({ pollId, votes, totalVotes }) => {
  const poll = pollsCache[pollId];
  if (!poll) return;
  poll.votes = votes;
  poll.totalVotes = totalVotes;
  const el = document.getElementById(`poll-${pollId}`);
  if (el) el.outerHTML = renderPollCard(poll);
});

// -- Comments: fetch, thread, render --------------------------------------

function toggleComments(pollId) {
  const section = document.getElementById(`comments-${pollId}`);
  if (!section) return;
  const opening = !section.classList.contains('open');
  section.classList.toggle('open', opening);
  if (opening) {
    openCommentPolls.add(pollId);
    if (!commentsCache[pollId]) fetchComments(pollId);
  } else {
    openCommentPolls.delete(pollId);
  }
  const btn = document.querySelector(`#poll-${pollId} .poll-actions .btn-ghost`);
  if (btn) btn.textContent = opening ? 'Hide discussion' : 'Discuss';
}

async function fetchComments(pollId) {
  try {
    const res = await fetch(`/api/polls/${pollId}/comments`, { headers: { 'Authorization': 'Bearer ' + currentIdToken } });
    const data = await res.json();
    commentsCache[pollId] = data.comments || [];
    renderCommentTree(pollId);
  } catch {
    const list = document.getElementById(`commentList-${pollId}`);
    if (list) list.innerHTML = '<div class="comments-empty">Could not load comments.</div>';
  }
}

function buildCommentTree(flat) {
  const byId = new Map();
  flat.forEach(c => byId.set(c.id, { ...c, children: [] }));
  const roots = [];
  byId.forEach(node => {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
    else roots.push(node);
  });
  return roots;
}

function renderCommentTree(pollId) {
  const list = document.getElementById(`commentList-${pollId}`);
  if (!list) return;
  const flat = commentsCache[pollId] || [];
  if (!flat.length) { list.innerHTML = '<div class="comments-empty">No comments yet — start the discussion.</div>'; return; }
  const tree = buildCommentTree(flat);
  list.innerHTML = tree.map(node => renderComment(pollId, node, 0)).join('');
}

function renderComment(pollId, node, depth) {
  const visualDepth = Math.min(depth, MAX_VISUAL_REPLY_DEPTH);
  const avatarHtml = node.authorAvatarUrl
    ? `<img src="${escapeHtml(node.authorAvatarUrl)}" alt="">`
    : escapeHtml((node.authorUsername || 'U')[0].toUpperCase());

  const reactionsHtml = REACTION_META.map(r => {
    const count = (node.reactions && node.reactions[r.key]) || 0;
    const active = node.myReactions && node.myReactions[r.key];
    return `
      <button class="reaction-btn ${active ? 'active' : ''}" title="${r.label}" onclick="toggleReaction('${pollId}', '${node.id}', '${r.key}')">
        ${r.icon}<span>${count > 0 ? count : ''}</span>
      </button>`;
  }).join('');

  const childrenHtml = node.children.length
    ? `<div class="comment-replies">${node.children.map(c => renderComment(pollId, c, depth + 1)).join('')}</div>`
    : '';

  return `
    <div class="comment-item ${depth > 0 ? 'is-reply' : ''}" style="margin-left:${visualDepth * 16}px" id="comment-${node.id}">
      <div class="comment-avatar">${avatarHtml}</div>
      <div class="comment-body">
        <span class="comment-author">${escapeHtml(node.authorUsername)}</span><span class="comment-time">${timeAgo(node.createdAt)}</span>
        <div class="comment-text">${escapeHtml(node.text)}</div>
        <div class="comment-actions">
          ${reactionsHtml}
          <button class="reply-btn" onclick="toggleReplyComposer('${node.id}')">Reply</button>
        </div>
        <div class="reply-composer" id="replyComposer-${node.id}">
          <textarea id="replyInput-${node.id}" placeholder="Write a reply…" maxlength="500"></textarea>
          <button class="btn btn-primary btn-sm" onclick="submitComment('${pollId}', '${node.id}')" style="flex-shrink:0;align-self:flex-end">Reply</button>
        </div>
        ${childrenHtml}
      </div>
    </div>`;
}

function toggleReplyComposer(commentId) {
  document.querySelectorAll('.reply-composer.open').forEach(el => {
    if (el.id !== `replyComposer-${commentId}`) el.classList.remove('open');
  });
  document.getElementById(`replyComposer-${commentId}`)?.classList.toggle('open');
}

async function submitComment(pollId, parentId) {
  const inputId = parentId ? `replyInput-${parentId}` : `composer-${pollId}`;
  const input = document.getElementById(inputId);
  const text = (input?.value || '').trim();
  if (!text) return;
  try {
    const res = await fetch(`/api/polls/${pollId}/comments`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + currentIdToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, parentId })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Could not post comment.', 'error'); return; }
    input.value = '';
    if (parentId) document.getElementById(`replyComposer-${parentId}`)?.classList.remove('open');
    if (!commentsCache[pollId]) commentsCache[pollId] = [];
    if (!commentsCache[pollId].some(c => c.id === data.comment.id)) commentsCache[pollId].push(data.comment);
    renderCommentTree(pollId);
    if (pollsCache[pollId]) pollsCache[pollId].commentCount = (pollsCache[pollId].commentCount || 0) + 1;
  } catch { showToast('Network error.', 'error'); }
}

socket.on('poll-comment-new', ({ pollId, comment }) => {
  if (!commentsCache[pollId]) return; // hasn't been fetched/opened yet — nothing to patch
  if (commentsCache[pollId].some(c => c.id === comment.id)) return;
  commentsCache[pollId].push(comment);
  if (openCommentPolls.has(pollId)) renderCommentTree(pollId);
  if (pollsCache[pollId]) pollsCache[pollId].commentCount = (pollsCache[pollId].commentCount || 0) + 1;
});

async function toggleReaction(pollId, commentId, type) {
  try {
    const res = await fetch(`/api/polls/${pollId}/comments/${commentId}/react`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + currentIdToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const data = await res.json();
    if (!res.ok) return;
    const list = commentsCache[pollId] || [];
    const node = list.find(c => c.id === commentId);
    if (node) {
      node.reactions = data.reactions;
      node.myReactions = node.myReactions || {};
      node.myReactions[type] = data.active;
    }
    renderCommentTree(pollId);
  } catch {}
}

socket.on('poll-comment-reaction', ({ pollId, commentId, reactions }) => {
  const list = commentsCache[pollId];
  if (!list) return;
  const node = list.find(c => c.id === commentId);
  if (!node) return;
  node.reactions = reactions;
  if (openCommentPolls.has(pollId)) renderCommentTree(pollId);
});

// -- Bootstrap: Firebase auth -> profile checks -> connect socket ---------

auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = '/login'; return; }
  try {
    const doc = await firestoreDb.collection('users').doc(user.uid).get();
    if (!doc.exists) { window.location.href = '/login'; return; }
    const profile = doc.data();
    if (profile.banned) {
      const until = profile.bannedUntil?.toDate ? profile.bannedUntil.toDate() : (profile.bannedUntil ? new Date(profile.bannedUntil) : null);
      if (!until || until > new Date()) { window.location.href = '/banned'; return; }
    }
    if (!profile.compassSet) {
      showToast('Please set your political position first.', 'info');
      setTimeout(() => { window.location.href = '/compass'; }, 1500);
      return;
    }
    currentUserId = user.uid;
    currentIdToken = await user.getIdToken();
    if (!socket.connected) socket.connect();
  } catch {
    showToast('Could not load profile. Check your connection.', 'error');
  }
});
