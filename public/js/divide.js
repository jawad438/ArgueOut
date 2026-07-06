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

function getQuadrantInfo(px, py) {
  if (Math.sqrt(px * px + py * py) < 0.3) return { label: 'Centrist', badge: 'badge-purple' };
  const econ   = px >= 0 ? 'Right' : 'Left';
  const social = py >= 0 ? 'Authoritarian' : 'Libertarian';
  const map = {
    'Authoritarian-Left':  { label: 'Auth-Left',  badge: 'badge-red'   },
    'Authoritarian-Right': { label: 'Auth-Right', badge: 'badge-blue'  },
    'Libertarian-Left':    { label: 'Lib-Left',   badge: 'badge-green' },
    'Libertarian-Right':   { label: 'Lib-Right',  badge: 'badge-amber' },
  };
  return map[`${social}-${econ}`] || { label: 'Centrist', badge: 'badge-purple' };
}

// -- Recommend-then-send challenge flow ----------------------------------
// Clicking "Challenge a debater" no longer fires a challenge immediately —
// the server picks a candidate and sends it back as a recommendation the
// challenger reviews first, and can either send or reroll ("find another")
// before anything is actually created/sent to the other person.
let currentRecommendation = null; // { pollId, opponent }
let recommendExcludeIds = [];

function renderRecommendationCard(pollId, opponent) {
  currentRecommendation = { pollId, opponent };
  const card = document.getElementById('divideRecCard');
  const av   = document.getElementById('divideRecAvatar');
  if (av) {
    if (opponent.avatarUrl) { av.style.backgroundImage = `url(${opponent.avatarUrl})`; av.style.backgroundSize = 'cover'; av.textContent = ''; }
    else { av.style.backgroundImage = ''; av.textContent = (opponent.name || opponent.username || '?')[0].toUpperCase(); }
  }
  const nameEl = document.getElementById('divideRecName');
  const userEl = document.getElementById('divideRecUsername');
  const tagsEl = document.getElementById('divideRecTags');
  const label  = document.getElementById('divideRecLabel');
  const reason = document.getElementById('divideRecReason');
  const actions = document.getElementById('divideRecActions');
  if (label)  label.textContent  = 'Recommended opponent';
  if (reason) reason.textContent = 'Send them a challenge, or find someone else who voted differently.';
  if (actions) actions.style.display = 'flex';
  if (nameEl) nameEl.textContent = opponent.name || opponent.username;
  if (userEl) userEl.textContent = '@' + opponent.username;
  if (tagsEl) {
    const info = getQuadrantInfo(opponent.politicalX, opponent.politicalY);
    tagsEl.innerHTML = `<span class="suggest-tag">${escapeHtml(info.label)}</span>`;
  }
  if (card) { card.style.display = 'block'; card.classList.remove('suggest-hiding'); card.classList.add('suggest-visible'); }
}

function resetChallengeButton(pollId) {
  const btn = document.getElementById(`challengeBtn-${pollId}`);
  if (btn) { btn.disabled = false; btn.textContent = 'Challenge a debater'; }
}

socket.on('divide-recommendation', ({ pollId, opponent }) => {
  pendingRecommendPollId = null;
  renderRecommendationCard(pollId, opponent);
});

function sendRecommendedChallenge() {
  if (!currentRecommendation) return;
  const actions = document.getElementById('divideRecActions');
  if (actions) actions.style.display = 'none';
  const reason = document.getElementById('divideRecReason');
  if (reason) reason.textContent = 'Sending…';
  socket.emit('divide-send-challenge', { pollId: currentRecommendation.pollId, targetUserId: currentRecommendation.opponent.userId });
}

function findAnotherRecommendation() {
  if (!currentRecommendation) return;
  recommendExcludeIds.push(currentRecommendation.opponent.userId);
  const reason = document.getElementById('divideRecReason');
  if (reason) reason.textContent = 'Finding someone else…';
  pendingRecommendPollId = currentRecommendation.pollId;
  socket.emit('divide-recommend', { pollId: currentRecommendation.pollId, excludeUserIds: recommendExcludeIds });
  setTimeout(() => {
    if (pendingRecommendPollId === currentRecommendation?.pollId) { pendingRecommendPollId = null; dismissRecommendation(); }
  }, 6000);
}

function dismissRecommendation() {
  const pollId = currentRecommendation?.pollId;
  document.getElementById('divideRecCard').style.display = 'none';
  currentRecommendation = null;
  recommendExcludeIds = [];
  if (pollId) resetChallengeButton(pollId);
}

socket.on('divide-challenge-sent', ({ opponent }) => {
  showToast(`Challenge sent to ${opponent.username}!`, 'success');
  const pollId = currentRecommendation?.pollId;
  document.getElementById('divideRecCard').style.display = 'none';
  currentRecommendation = null;
  recommendExcludeIds = [];
  if (pollId) resetChallengeButton(pollId);
});

socket.on('divide-challenge-error', ({ error }) => {
  showToast(error, 'error');
  // Falls back to pendingRecommendPollId for the case where this error
  // arrives before any recommendation was ever shown (e.g. "vote on this
  // poll first"), where currentRecommendation is still null.
  const pollId = currentRecommendation?.pollId || pendingRecommendPollId;
  pendingRecommendPollId = null;
  document.getElementById('divideRecCard').style.display = 'none';
  currentRecommendation = null;
  recommendExcludeIds = [];
  if (pollId) resetChallengeButton(pollId);
});
socket.on('divide-challenge-update', ({ message }) => showToast(message, 'info'));

// Fired for users the server's relevance algorithm picked out for a
// newly-created poll (see notifyRelevantUsersForNewPoll in server.js) — only
// reaches users currently connected; everyone else picks it up from their
// notification history next time they check it.
socket.on('divide-poll-notification', ({ message }) => {
  showToast(message, 'info');
  fetchPolls(); // pick up the new poll without requiring a manual refresh
});

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

// Tracks which poll is waiting on a divide-recommendation/-error reply, so
// the safety timeout below only resets the button if nothing ever came back
// (e.g. the request got lost) rather than fighting an already-open, still-
// in-progress recommendation card.
let pendingRecommendPollId = null;

function triggerChallenge(pollId) {
  const btn = document.getElementById(`challengeBtn-${pollId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Finding opponent…'; }
  recommendExcludeIds = [];
  pendingRecommendPollId = pollId;
  socket.emit('divide-recommend', { pollId, excludeUserIds: [] });
  setTimeout(() => {
    if (pendingRecommendPollId === pollId) { pendingRecommendPollId = null; resetChallengeButton(pollId); }
  }, 6000);
}

// -- Poll fetch/render ----------------------------------------------------

let allPollIds = [];
let currentCategoryFilter = 'all';

async function fetchPolls() {
  try {
    const res = await fetch('/api/polls', { headers: { 'Authorization': 'Bearer ' + currentIdToken } });
    if (!res.ok) throw new Error();
    const data = await res.json();
    allPollIds = (data.polls || []).map(p => p.id);
    (data.polls || []).forEach(p => { pollsCache[p.id] = p; });
    applyDivideFilters();
  } catch {
    document.getElementById('pollsList').innerHTML =
      '<div class="divide-empty">Could not load polls. <button class="btn btn-ghost btn-sm" onclick="fetchPolls()">Retry</button></div>';
  }
}

function applyDivideFilters() {
  const term = (document.getElementById('divideSearchInput')?.value || '').toLowerCase().trim();
  const filtered = allPollIds
    .map(id => pollsCache[id])
    .filter(Boolean)
    .filter(p => currentCategoryFilter === 'all' || p.category === currentCategoryFilter)
    .filter(p => !term || (p.question + ' ' + (p.tags || []).join(' ')).toLowerCase().includes(term));
  renderPolls(filtered, term || currentCategoryFilter !== 'all');
}

function setCategoryFilter(cat) {
  currentCategoryFilter = cat;
  document.querySelectorAll('.divide-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === cat));
  applyDivideFilters();
}

function renderPolls(polls, isFiltered) {
  const list = document.getElementById('pollsList');
  if (!polls.length) {
    list.innerHTML = isFiltered
      ? `<div class="divide-empty">
          <h2 style="font-size:1.05rem;font-weight:700;color:var(--text-2);margin-bottom:6px">No polls match</h2>
          <p style="font-size:0.85rem">Try a different search term or category.</p>
        </div>`
      : `<div class="divide-empty">
      <svg style="width:48px;height:48px;fill:none;stroke:currentColor;stroke-width:1.5" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <h2 style="font-size:1.05rem;font-weight:700;color:var(--text-2);margin-bottom:6px">No polls yet</h2>
      <p style="font-size:0.85rem">Check back soon — new questions post regularly.</p>
    </div>`;
    return;
  }
  list.innerHTML = polls.map(renderPollCard).join('');
}

function renderPollOptions(poll, justVotedIndex) {
  const myVote = poll.myVote;
  const hasVoted = myVote != null;
  return poll.options.map((opt, i) => {
    const pct = poll.totalVotes ? Math.round((poll.votes[i] / poll.totalVotes) * 100) : 0;
    const color = OPTION_COLORS[i % OPTION_COLORS.length];
    const online = (poll.onlineCounts && poll.onlineCounts[i]) || 0;
    return `
      <button class="poll-option-btn ${myVote === i ? 'voted-mine' : ''} ${justVotedIndex === i ? 'just-voted' : ''}" ${hasVoted ? 'disabled' : ''}
        onclick="voteOnPoll('${poll.id}', ${i})">
        ${hasVoted ? `<span class="poll-option-fill" style="width:${pct}%;background:${color}"></span>` : ''}
        <span class="poll-option-label">
          <span>${escapeHtml(opt)}</span>
          ${hasVoted ? `<span class="poll-option-pct">${pct}%</span>` : ''}
        </span>
        ${hasVoted ? `<div class="poll-option-online">${online} online who voted this</div>` : ''}
      </button>`;
  }).join('');
}

// This only ever rewrites the vote bars/count — never the whole card, and
// critically never .poll-comments-section — since a live poll-vote-update
// from another user's vote used to blow away an already-open, already-
// fetched comment thread back to a "Loading…" placeholder that nothing then
// re-populated.
function updatePollVoteDisplay(pollId, justVotedIndex) {
  const poll = pollsCache[pollId];
  if (!poll) return;
  const optionsEl = document.getElementById(`pollOptions-${pollId}`);
  if (optionsEl) optionsEl.innerHTML = renderPollOptions(poll, justVotedIndex);
  const countEl = document.getElementById(`voteCountText-${pollId}`);
  if (countEl) countEl.textContent = `${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'}`;
}

function renderPollCard(poll) {
  const myVote = poll.myVote;
  const hasVoted = myVote != null;
  const canChallenge = hasVoted && poll.status === 'active';
  const opened = openCommentPolls.has(poll.id);

  const tagsHtml = (poll.tags || []).map(t => `<span class="poll-tag">#${escapeHtml(t)}</span>`).join('');

  return `
    <div class="poll-card" id="poll-${poll.id}">
      <div class="poll-card-top">
        <span class="poll-category-badge">${escapeHtml(poll.categoryLabel || 'General')}</span>
        ${tagsHtml}
      </div>
      <div class="poll-question">${escapeHtml(poll.question)}</div>
      <div class="poll-options" id="pollOptions-${poll.id}">${renderPollOptions(poll, null)}</div>
      <div class="poll-meta">
        <span id="voteCountText-${poll.id}">${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'}</span>
        <span id="commentCountText-${poll.id}">${poll.commentCount || 0} comment${poll.commentCount === 1 ? '' : 's'}</span>
      </div>
      <div class="poll-actions" id="pollActions-${poll.id}">
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
    updatePollVoteDisplay(pollId, optionIndex);
    const actionsEl = document.getElementById(`pollActions-${pollId}`);
    if (actionsEl) {
      const opened = openCommentPolls.has(pollId);
      actionsEl.innerHTML =
        `<button class="btn btn-primary btn-sm" id="challengeBtn-${pollId}" onclick="triggerChallenge('${pollId}')">Challenge a debater</button>` +
        `<button class="btn btn-ghost btn-sm" onclick="toggleComments('${pollId}')">${opened ? 'Hide discussion' : 'Discuss'}</button>`;
    }
  } catch { showToast('Network error.', 'error'); }
}

socket.on('poll-vote-update', ({ pollId, votes, totalVotes }) => {
  const poll = pollsCache[pollId];
  if (!poll) return;
  poll.votes = votes;
  poll.totalVotes = totalVotes;
  updatePollVoteDisplay(pollId, null);
});

socket.on('poll-deleted', ({ pollId }) => {
  delete pollsCache[pollId];
  delete commentsCache[pollId];
  openCommentPolls.delete(pollId);
  const card = document.getElementById(`poll-${pollId}`);
  if (card) card.remove();
  showToast('A poll was removed by an admin.', 'info');
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
  lastPoppedReaction = null; // one-shot — consumed by this render pass
}

function renderComment(pollId, node, depth) {
  const visualDepth = Math.min(depth, MAX_VISUAL_REPLY_DEPTH);
  const avatarHtml = node.authorAvatarUrl
    ? `<img src="${escapeHtml(node.authorAvatarUrl)}" alt="">`
    : escapeHtml((node.authorUsername || 'U')[0].toUpperCase());

  const reactionsHtml = REACTION_META.map(r => {
    const count = (node.reactions && node.reactions[r.key]) || 0;
    const active = node.myReactions && node.myReactions[r.key];
    const justPopped = lastPoppedReaction && lastPoppedReaction.commentId === node.id && lastPoppedReaction.type === r.key;
    return `
      <button class="reaction-btn ${active ? 'active' : ''} ${justPopped ? 'pop' : ''}" data-reaction="${r.key}" title="${r.label}" onclick="toggleReaction(this, '${pollId}', '${node.id}', '${r.key}')">
        ${r.icon}<span>${count > 0 ? count : ''}</span>
      </button>`;
  }).join('');

  const childrenHtml = node.children.length
    ? `<div class="comment-replies">${node.children.map(c => renderComment(pollId, c, depth + 1)).join('')}</div>`
    : '';

  // A deleted comment keeps its slot in the tree (so replies underneath it
  // stay properly nested) but loses reactions/reply/delete controls — there's
  // nothing left to react or reply to the actual content of.
  const actionsHtml = node.deleted ? '' : `
        <div class="comment-actions">
          ${reactionsHtml}
          <button class="reply-btn" onclick="toggleReplyComposer('${node.id}')">Reply</button>
          ${node.canDelete ? `<button class="reply-btn comment-delete-btn" onclick="deleteComment('${pollId}', '${node.id}')">Delete</button>` : ''}
        </div>
        <div class="reply-composer" id="replyComposer-${node.id}">
          <textarea id="replyInput-${node.id}" placeholder="Write a reply…" maxlength="500"></textarea>
          <button class="btn btn-primary btn-sm" onclick="submitComment('${pollId}', '${node.id}')" style="flex-shrink:0;align-self:flex-end">Reply</button>
        </div>`;

  return `
    <div class="comment-item ${depth > 0 ? 'is-reply' : ''}" style="margin-left:${visualDepth * 16}px" id="comment-${node.id}">
      <div class="comment-avatar" onclick="openDivideProfile('${node.authorId}')">${avatarHtml}</div>
      <div class="comment-body">
        <span class="comment-author" onclick="openDivideProfile('${node.authorId}')">${escapeHtml(node.authorUsername)}</span><span class="comment-time">${timeAgo(node.createdAt)}</span>
        <div class="comment-text ${node.deleted ? 'comment-deleted-text' : ''}">${escapeHtml(node.text)}</div>
        ${actionsHtml}
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
    updateCommentCountDisplay(pollId);
  } catch { showToast('Network error.', 'error'); }
}

// Always derived from the actual length of the fetched comment list, never
// hand-incremented — an incrementing counter is exactly what caused the
// count to drift from the real number in testing (showed 4 for 2 real
// comments). Only updates the poll-meta text node directly rather than
// re-rendering the whole card, so an open comment thread doesn't collapse.
function updateCommentCountDisplay(pollId) {
  const count = (commentsCache[pollId] || []).length;
  if (pollsCache[pollId]) pollsCache[pollId].commentCount = count;
  const el = document.getElementById(`commentCountText-${pollId}`);
  if (el) el.textContent = `${count} comment${count === 1 ? '' : 's'}`;
}

socket.on('poll-comment-new', ({ pollId, comment }) => {
  if (!commentsCache[pollId]) return; // hasn't been fetched/opened yet — nothing to patch
  if (commentsCache[pollId].some(c => c.id === comment.id)) return;
  commentsCache[pollId].push(comment);
  if (openCommentPolls.has(pollId)) renderCommentTree(pollId);
  updateCommentCountDisplay(pollId);
});

// renderCommentTree rebuilds the whole subtree's innerHTML each time, so a
// class added directly to the clicked <button> would just get thrown away —
// track "which button should pop" for the next render pass instead, then
// clear it once applied.
let lastPoppedReaction = null; // { commentId, type }

async function toggleReaction(btn, pollId, commentId, type) {
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
    lastPoppedReaction = { commentId, type };
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

async function deleteComment(pollId, commentId) {
  if (!confirm('Delete this comment? This can\'t be undone.')) return;
  try {
    const res = await fetch(`/api/polls/${pollId}/comments/${commentId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + currentIdToken }
    });
    if (!res.ok) { const data = await res.json().catch(() => ({})); showToast(data.error || 'Could not delete comment.', 'error'); return; }
    applyLocalCommentDelete(pollId, commentId);
  } catch { showToast('Network error.', 'error'); }
}

// Shared by the deleter's own optimistic update and the real-time broadcast
// that reaches everyone else currently viewing the same poll's comments.
function applyLocalCommentDelete(pollId, commentId) {
  const list = commentsCache[pollId];
  if (!list) return;
  const node = list.find(c => c.id === commentId);
  if (!node) return;
  node.deleted = true;
  node.text = '[deleted]';
  node.canDelete = false;
  if (openCommentPolls.has(pollId)) renderCommentTree(pollId);
}

socket.on('poll-comment-deleted', ({ pollId, commentId }) => applyLocalCommentDelete(pollId, commentId));

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

// -- Commenter profile viewer ----------------------------------------------

function drawMiniCompass(canvas, px, py) {
  const ctx  = canvas.getContext('2d');
  const SIZE = canvas.width;
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = 'rgba(239,68,68,0.09)';  ctx.fillRect(0,      0,      SIZE/2, SIZE/2);
  ctx.fillStyle = 'rgba(59,130,246,0.09)'; ctx.fillRect(SIZE/2, 0,      SIZE/2, SIZE/2);
  ctx.fillStyle = 'rgba(34,197,94,0.09)';  ctx.fillRect(0,      SIZE/2, SIZE/2, SIZE/2);
  ctx.fillStyle = 'rgba(245,158,11,0.09)'; ctx.fillRect(SIZE/2, SIZE/2, SIZE/2, SIZE/2);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(SIZE/2, 0); ctx.lineTo(SIZE/2, SIZE); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, SIZE/2); ctx.lineTo(SIZE, SIZE/2); ctx.stroke();
  const cx = (px + 1) / 2 * SIZE;
  const cy = (1 - (py + 1) / 2) * SIZE;
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18);
  grd.addColorStop(0, 'rgba(139,92,246,0.5)');
  grd.addColorStop(1, 'rgba(139,92,246,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8b5cf6';
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
}

async function openDivideProfile(userId) {
  const modal = document.getElementById('divideProfileModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const card = document.getElementById('divideProfileCard');
  if (card) {
    card.classList.remove('entering', 'closing');
    void card.offsetWidth;
    card.classList.add('entering');
  }
  try {
    const res = await fetch(`/api/users/${userId}/public-profile`, { headers: { 'Authorization': 'Bearer ' + currentIdToken } });
    if (!res.ok) { showToast('Could not load profile.', 'error'); closeDivideProfile(); return; }
    const u = await res.json();

    const heroBg = document.getElementById('dpHeroBg');
    if (heroBg) heroBg.style.backgroundImage = u.avatarUrl ? `url(${JSON.stringify(u.avatarUrl)})` : '';

    const avatar = document.getElementById('dpAvatar');
    if (avatar) {
      avatar.innerHTML = u.avatarUrl
        ? `<img src="${escapeHtml(u.avatarUrl)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
        : escapeHtml((u.username || 'U')[0].toUpperCase());
    }

    const nameEl = document.getElementById('dpName');
    const userEl = document.getElementById('dpUsername');
    if (nameEl) nameEl.textContent = u.name || u.username;
    if (userEl) userEl.textContent = '@' + u.username;

    const info = getQuadrantInfo(u.politicalX || 0, u.politicalY || 0);
    const badgesEl = document.getElementById('dpBadges');
    if (badgesEl) badgesEl.innerHTML = `<span class="badge ${info.badge}">${escapeHtml(info.label)}</span>`;

    const compass = document.getElementById('dpCompass');
    if (compass) setTimeout(() => drawMiniCompass(compass, u.politicalX || 0, u.politicalY || 0), 60);

    const bioEl = document.getElementById('dpBio');
    if (bioEl) {
      if (u.bio) { bioEl.textContent = u.bio; bioEl.style.display = 'block'; }
      else bioEl.style.display = 'none';
    }

    const _cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    const tags = [];
    if (u.age) tags.push(`${u.age} yrs`);
    if (u.gender && u.gender !== 'prefer_not_to_say') tags.push(_cap(u.gender.replace('_', ' ')));
    if (u.religion && u.religion !== 'prefer_not_to_say') tags.push(_cap(u.religion));
    const tagsEl = document.getElementById('dpTags');
    if (tagsEl) tagsEl.innerHTML = tags.map(t => `<span class="profile-tag">${escapeHtml(t)}</span>`).join('');

    const countryRow = document.getElementById('dpCountryRow');
    const countryEl  = document.getElementById('dpCountry');
    if (countryRow && countryEl) {
      if (u.country) { countryEl.textContent = u.country; countryRow.style.display = 'flex'; }
      else countryRow.style.display = 'none';
    }
  } catch {
    showToast('Could not load profile.', 'error');
  }
}

function closeDivideProfile() {
  const card = document.getElementById('divideProfileCard');
  if (card) { card.classList.remove('entering'); card.classList.add('closing'); }
  setTimeout(() => {
    const modal = document.getElementById('divideProfileModal');
    if (modal) modal.style.display = 'none';
    if (card) card.classList.remove('closing');
  }, 180);
}
