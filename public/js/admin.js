/* admin.js — Admin panel logic */

function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const colors = { success:'var(--green)', error:'var(--red)', info:'var(--purple)' };
  const icons  = {
    success: '<svg style="width:13px;height:13px;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg style="width:13px;height:13px;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info:    '<svg style="width:13px;height:13px;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon" style="color:${colors[type]}">${icons[type]}</span> ${msg}`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000)  return 'just now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  if (diff < 2592000000) return `${Math.floor(diff/86400000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

const DURATIONS = [
  { label: '1 minute',  ms: 60000 },
  { label: '5 minutes', ms: 300000 },
  { label: '15 minutes',ms: 900000 },
  { label: '1 hour',    ms: 3600000 },
  { label: '6 hours',   ms: 21600000 },
  { label: '12 hours',  ms: 43200000 },
  { label: '1 day',     ms: 86400000 },
  { label: '3 days',    ms: 259200000 },
  { label: '7 days',    ms: 604800000 },
];

const REPORT_REASONS = ['Harassment','Hate speech','Threats','Spam','Inappropriate content','Other'];

const durOptions = DURATIONS.map(d =>
  `<option value="${d.ms}">${d.label}</option>`
).join('');

// Socket
const socket = io({ autoConnect: false });
let currentFilter = 'pending';
let currentAppealFilter = 'pending';
let currentPollReportFilter = 'pending';
let currentContactFilter = 'pending';
let resolvedNotifUserId = null;
let allUsersCache = [];

socket.on('connect', () => {
  auth.currentUser?.getIdToken().then(token => {
    socket.emit('authenticate', { idToken: token });
  });
});

socket.on('authenticated', () => {
  loadReports('pending');
  loadAppeals('pending');
});

socket.on('admin-new-deletion-request', ({ username }) => {
  showToast(`New deletion request from @${username || 'unknown'}`, 'error');
  const usersPane = document.getElementById('pane-users');
  if (usersPane && usersPane.classList.contains('active')) loadDeletionRequests();
});

socket.on('admin-new-appeal', ({ username, type }) => {
  const who = username ? '@' + username : 'an IP-banned visitor';
  showToast(`New ${type} appeal from ${who}`, 'info');
  loadAppeals(currentAppealFilter);
});

socket.on('admin-reports', ({ reports }) => {
  renderReports(reports);
});

socket.on('admin-poll-reports', ({ reports }) => {
  renderPollReports(reports);
});

socket.on('admin-new-contact-message', ({ subject }) => {
  showToast(`New contact message: "${subject}"`, 'info');
  const badge = document.getElementById('contactBadge');
  if (badge) { badge.style.display = ''; badge.textContent = (parseInt(badge.textContent) || 0) + 1; }
  const contactPane = document.getElementById('pane-contact');
  if (contactPane && contactPane.classList.contains('active')) loadContactMessages(currentContactFilter);
});

// Legacy search results
socket.on('admin-users', ({ users }) => {
  allUsersCache = users;
  filterUsers();
});

// All users from admin-get-all-users
socket.on('admin-all-users', ({ users }) => {
  allUsersCache = users;
  filterUsers();
});

// Rich Firebase Auth user list
socket.on('admin-firebase-users', ({ users }) => {
  allUsersCache = users;
  filterUsers();
});

socket.on('admin-action-done', ({ action, targetUserId, ip }) => {
  if (action === 'ban' || action === 'unban') {
    showToast(action === 'ban' ? 'User banned.' : 'User unbanned.', 'success');
    loadAllUsers();
  }
  if (action === 'ip-ban') {
    showToast('IP banned: ' + (ip || 'unknown') + '. User permanently removed.', 'success');
    loadAllUsers();
  }
  if (action === 'ip-ban-failed') {
    showToast('IP ban failed: user is not currently online.', 'error');
  }
  if (action === 'dismiss-report') {
    showToast('Report dismissed.', 'success');
    loadReports(currentFilter);
  }
  if (action === 'dismiss-poll-report') {
    showToast('Report dismissed.', 'success');
    loadPollReports(currentPollReportFilter);
  }
  if (action === 'notification') {
    showToast('Notification sent!', 'success');
    document.getElementById('notifMsg').value = '';
    document.getElementById('notifMsgCount').textContent = '0';
    document.getElementById('notifSendStatus').textContent = '';
    resolvedNotifUserId = null;
    document.getElementById('notifResolveStatus').textContent = '';
  }
});

// Tabs
function switchTab(name) {
  document.querySelectorAll('.admin-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  const pane = document.getElementById(`pane-${name}`);
  const tabs = document.querySelectorAll('.admin-tab');
  const tabNames = ['reports','users','appeals','notify','whitelist','divide','contact','legal'];
  if (pane) pane.classList.add('active');
  const idx = tabNames.indexOf(name);
  if (tabs[idx]) tabs[idx].classList.add('active');

  if (name === 'users') { loadAllUsers(); loadDeletionRequests(); }
  if (name === 'appeals') loadAppeals(currentAppealFilter);
  if (name === 'whitelist') loadWhitelist();
  if (name === 'divide') { resetPollOptionRows(); loadDividePolls(); loadPollReports(currentPollReportFilter); }
  if (name === 'contact') {
    const badge = document.getElementById('contactBadge');
    if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
    loadContactMessages(currentContactFilter);
  }
  if (name === 'legal') { loadLegalDoc('tos'); loadLegalDoc('privacy'); }
}

// ── Whitelist ──────────────────────────────────────────────────
async function adminToken() {
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

async function loadWhitelist() {
  document.getElementById('wlList').innerHTML = '<div class="admin-empty">Loading…</div>';
  try {
    const token = await adminToken();
    const res = await fetch('/api/admin/whitelist', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();
    renderWhitelist(data.entries || []);
  } catch {
    document.getElementById('wlList').innerHTML = '<div class="admin-empty">Error loading whitelist.</div>';
  }
}

function renderWhitelist(entries) {
  const list = document.getElementById('wlList');
  if (!entries.length) {
    list.innerHTML = '<div class="admin-empty">No whitelist links yet. Create one above.</div>';
    return;
  }
  const origin = location.origin;
  list.innerHTML = entries.map(e => `
    <div class="user-row" id="wl-row-${escapeHtml(e.username)}">
      <div class="user-row-info">
        <div class="user-row-name" style="display:flex;align-items:center;gap:8px">
          @${escapeHtml(e.username)}
          <span style="font-size:0.68rem;font-weight:700;background:rgba(139,92,246,0.12);color:var(--purple);border-radius:99px;padding:1px 8px;border:1px solid rgba(139,92,246,0.25)">WHITELIST</span>
        </div>
        <div class="user-row-sub" style="margin-top:4px">
          Created ${relTime(e.createdAt)}
          &nbsp;·&nbsp;
          <span style="font-family:monospace;font-size:0.78rem;color:var(--purple)">${origin}/whitelist/${escapeHtml(e.username)}</span>
        </div>
      </div>
      <div class="user-row-actions">
        <button class="btn btn-ghost btn-sm" onclick="copyWlLink('${escapeHtml(e.username)}')">Copy Link</button>
        <button class="btn btn-sm" style="background:rgba(239,68,68,0.1);color:var(--red);border:1px solid rgba(239,68,68,0.2)" onclick="revokeWl('${escapeHtml(e.username)}')">Revoke</button>
      </div>
    </div>
  `).join('');
}

function copyWlLink(username) {
  navigator.clipboard.writeText(location.origin + '/whitelist/' + username)
    .then(() => showToast('Link copied!', 'success'))
    .catch(() => showToast('Copy failed — try manually.', 'error'));
}

async function createWl() {
  const input = document.getElementById('wlUsernameInput');
  const username = (input?.value || '').trim();
  if (!username) return;
  const statusEl = document.getElementById('wlCreateStatus');
  statusEl.textContent = 'Creating…';
  statusEl.style.color = 'var(--text-3)';
  try {
    const token = await adminToken();
    const res = await fetch('/api/admin/whitelist', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.error || 'Error creating link.';
      statusEl.style.color = 'var(--red)';
      return;
    }
    input.value = '';
    statusEl.textContent = '';
    loadWhitelist();
    showToast('Whitelist link created!', 'success');
    // Copy the link automatically after creation
    navigator.clipboard.writeText(location.origin + '/whitelist/' + username).catch(() => {});
  } catch {
    statusEl.textContent = 'Error creating link.';
    statusEl.style.color = 'var(--red)';
  }
}

async function revokeWl(username) {
  if (!confirm(`Revoke whitelist link for @${username}?\n\nThis will remove their account and the link will stop working.`)) return;
  try {
    const token = await adminToken();
    const res = await fetch('/api/admin/whitelist/' + encodeURIComponent(username), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { const d = await res.json(); showToast(d.error || 'Error', 'error'); return; }
    showToast('@' + username + ' revoked.', 'success');
    loadWhitelist();
  } catch {
    showToast('Error revoking link.', 'error');
  }
}

function loadAllUsers() {
  document.getElementById('usersList').innerHTML = '<div class="admin-empty">Loading...</div>';
  socket.emit('admin-get-firebase-users');
}

// Reports
function loadReports(filter = 'pending') {
  currentFilter = filter;
  document.getElementById('filt-pending')?.classList.toggle('active', filter === 'pending');
  document.getElementById('filt-all')?.classList.toggle('active', filter === 'all');
  document.getElementById('reportsList').innerHTML = '<div class="admin-empty">Loading...</div>';
  socket.emit('admin-get-reports', { filter });
}

function renderReports(reports) {
  const el = document.getElementById('reportsList');
  const statPending = document.getElementById('statPending');
  const statTotal   = document.getElementById('statTotal');

  const pending = reports.filter(r => r.status === 'pending');
  [statPending, statTotal].forEach(el => {
    if (!el) return;
    el.classList.remove('skel');
    el.classList.add('gradient-text');
    ['width','height','margin-top','border-radius'].forEach(p => el.style.removeProperty(p));
  });
  if (statPending) statPending.textContent = pending.length;
  if (statTotal)   statTotal.textContent   = reports.length;

  if (!reports.length) {
    el.innerHTML = '<div class="admin-empty">No reports found.</div>';
    return;
  }

  el.innerHTML = reports.map(r => {
    const isDismissed = r.status === 'dismissed';
    return `
    <div class="report-item${isDismissed ? ' report-dismissed' : ''}">
      <div class="report-header">
        <span class="report-parties">
          <span style="color:var(--text-3)">Reporter:</span> @${escapeHtml(r.reporterUsername)}
          <span style="color:var(--text-3);margin:0 6px">&#8594;</span>
          <span style="color:var(--red)">Reported:</span> @${escapeHtml(r.reportedUsername)}
        </span>
        <div style="display:flex;gap:6px;align-items:center">
          ${r.location ? `<span class="report-loc">${escapeHtml(r.location)}</span>` : ''}
          <span class="report-meta">${relTime(r.createdAt)}</span>
          ${isDismissed ? '<span class="report-loc" style="color:var(--text-3)">dismissed</span>' : ''}
        </div>
      </div>
      <div class="report-reason">"${escapeHtml(r.reason)}"</div>
      ${!isDismissed ? `
      <div class="report-actions">
        <button class="btn btn-ghost btn-sm" onclick="dismissReport('${r.id}')">Dismiss</button>
        <div style="display:flex;gap:6px;align-items:center">
          <select class="dur-select" id="dur-${r.id}">${durOptions}</select>
          <button class="btn btn-sm" style="background:rgba(245,158,11,0.15);color:var(--amber);border:1px solid rgba(245,158,11,0.3)" onclick="timeoutFromReport('${r.id}','${escapeHtml(r.reportedId)}')">Timeout</button>
        </div>
        <button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:var(--red);border:1px solid rgba(239,68,68,0.25)" onclick="banFromReport('${escapeHtml(r.reportedId)}')">Ban</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function dismissReport(reportId) {
  socket.emit('admin-dismiss-report', { reportId });
}

function timeoutFromReport(reportId, targetUserId) {
  const sel = document.getElementById(`dur-${reportId}`);
  const durationMs = sel ? parseInt(sel.value) : 3600000;
  socket.emit('admin-ban-user', { targetUserId, durationMs });
  socket.emit('admin-dismiss-report', { reportId });
  showToast('Timeout applied.', 'success');
  setTimeout(() => loadReports(currentFilter), 500);
}

function banFromReport(targetUserId) {
  if (!confirm('Permanently ban this user?')) return;
  socket.emit('admin-ban-user', { targetUserId, durationMs: null });
  showToast('User permanently banned.', 'success');
  setTimeout(() => loadReports(currentFilter), 500);
}

// Poll reports (The Divide)
function loadPollReports(filter = 'pending') {
  currentPollReportFilter = filter;
  document.getElementById('filt-poll-pending')?.classList.toggle('active', filter === 'pending');
  document.getElementById('filt-poll-all')?.classList.toggle('active', filter === 'all');
  document.getElementById('pollReportsList').innerHTML = '<div class="admin-empty">Loading...</div>';
  socket.emit('admin-get-poll-reports', { filter });
}

function renderPollReports(reports) {
  const el = document.getElementById('pollReportsList');
  if (!reports.length) {
    el.innerHTML = '<div class="admin-empty">No poll reports found.</div>';
    return;
  }
  el.innerHTML = reports.map(r => {
    const isDismissed = r.status === 'dismissed';
    return `
    <div class="report-item${isDismissed ? ' report-dismissed' : ''}">
      <div class="report-header">
        <span class="report-parties">
          <span style="color:var(--text-3)">Reported by:</span> @${escapeHtml(r.reporterUsername)}
        </span>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="report-meta">${relTime(r.createdAt)}</span>
          ${isDismissed ? '<span class="report-loc" style="color:var(--text-3)">dismissed</span>' : ''}
        </div>
      </div>
      <div style="font-size:0.85rem;color:var(--text-2);margin-bottom:6px">"${escapeHtml(r.pollQuestion || '(poll deleted)')}"</div>
      <div class="report-reason">"${escapeHtml(r.reason)}"</div>
      ${!isDismissed ? `
      <div class="report-actions">
        <button class="btn btn-ghost btn-sm" onclick="dismissPollReport('${r.id}')">Dismiss</button>
        <button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:var(--red);border:1px solid rgba(239,68,68,0.25)" onclick="deletePollFromReport('${r.id}','${escapeHtml(r.pollId)}')">Delete Poll</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function dismissPollReport(reportId) {
  socket.emit('admin-dismiss-poll-report', { reportId });
}

async function deletePollFromReport(reportId, pollId) {
  if (!confirm('Permanently delete this poll, along with all its votes and comments? This cannot be undone.')) return;
  try {
    const token = await adminToken();
    const res = await fetch(`/api/polls/${pollId}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok && res.status !== 404) { showToast('Failed to delete poll.', 'error'); return; }
    socket.emit('admin-dismiss-poll-report', { reportId });
    showToast('Poll deleted.', 'success');
  } catch { showToast('Network error.', 'error'); }
}

// Contact messages (from the public /contact form)
async function loadContactMessages(filter = 'pending') {
  currentContactFilter = filter;
  document.getElementById('filt-contact-pending')?.classList.toggle('active', filter === 'pending');
  document.getElementById('filt-contact-all')?.classList.toggle('active', filter === 'all');
  const el = document.getElementById('contactMessagesList');
  el.innerHTML = '<div class="admin-empty">Loading...</div>';
  try {
    const token = await adminToken();
    const res = await fetch('/api/admin/contact-messages', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();
    let messages = data.messages || [];
    if (filter === 'pending') messages = messages.filter(m => m.status === 'pending');
    renderContactMessages(messages);
  } catch {
    el.innerHTML = '<div class="admin-empty">Error loading messages.</div>';
  }
}

function renderContactMessages(messages) {
  const el = document.getElementById('contactMessagesList');
  if (!messages.length) { el.innerHTML = '<div class="admin-empty">No contact messages found.</div>'; return; }
  el.innerHTML = messages.map(m => {
    const isResolved = m.status === 'resolved';
    const from = m.name || m.email ? [m.name, m.email].filter(Boolean).join(' · ') : 'Anonymous';
    const attachmentsHtml = (m.attachments || []).map(a => `
      <button class="btn btn-ghost btn-sm" onclick="viewContactAttachment('${m.id}','${a.filename}')">
        &#128206; ${escapeHtml(a.originalName)} (${(a.size / 1024).toFixed(0)} KB)
      </button>`).join('');
    return `
    <div class="report-item${isResolved ? ' report-dismissed' : ''}">
      <div class="report-header">
        <span class="report-parties">
          <span style="color:var(--text-3)">From:</span> ${escapeHtml(from)}
        </span>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="report-meta">${relTime(m.createdAt)}</span>
          ${isResolved ? '<span class="report-loc" style="color:var(--text-3)">resolved</span>' : ''}
        </div>
      </div>
      <div style="font-size:0.9rem;font-weight:600;margin-bottom:6px">${escapeHtml(m.subject)}</div>
      <div class="report-reason" style="white-space:pre-wrap">${escapeHtml(m.message)}</div>
      ${attachmentsHtml ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">${attachmentsHtml}</div>` : ''}
      ${!isResolved ? `
      <div class="report-actions">
        <button class="btn btn-ghost btn-sm" onclick="resolveContactMessage('${m.id}')">Mark resolved</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

async function resolveContactMessage(id) {
  try {
    const token = await adminToken();
    const res = await fetch(`/api/admin/contact-messages/${id}/resolve`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { showToast('Failed to resolve message.', 'error'); return; }
    showToast('Marked as resolved.', 'success');
    loadContactMessages(currentContactFilter);
  } catch { showToast('Network error.', 'error'); }
}

// Attachments require an admin bearer token, so a plain link/src can't carry
// auth — fetch it as a blob and open that instead.
async function viewContactAttachment(messageId, filename) {
  try {
    const token = await adminToken();
    const res = await fetch(`/api/admin/contact-messages/${messageId}/attachments/${filename}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { showToast('Failed to load attachment.', 'error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch { showToast('Network error.', 'error'); }
}

// Users
function filterUsers() {
  const q = (document.getElementById('userSearchInput')?.value || '').trim().toLowerCase();
  if (!q) { renderUsers(allUsersCache); return; }
  const filtered = allUsersCache.filter(u =>
    (u.username || '').toLowerCase().includes(q) ||
    (u.name || '').toLowerCase().includes(q) ||
    (u.email || '').toLowerCase().includes(q)
  );
  renderUsers(filtered);
}

function searchUsers() { filterUsers(); }

document.addEventListener('input', e => {
  if (e.target.id === 'userSearchInput') filterUsers();
  if (e.target.id === 'notifMsg') {
    document.getElementById('notifMsgCount').textContent = e.target.value.length;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'userSearchInput') filterUsers();
  if (e.key === 'Enter' && document.activeElement?.id === 'notifTo') resolveNotifUser();
});

function renderUsers(users) {
  const el = document.getElementById('usersList');
  if (!users.length) {
    el.innerHTML = '<div class="admin-empty">No users found.</div>';
    return;
  }
  el.innerHTML = users.map(u => {
    const banExpiry = u.bannedUntil ? new Date(u.bannedUntil) : null;
    const banExpired = banExpiry && banExpiry <= new Date();
    const banLabel = u.banned && !banExpired
      ? (u.ipBanned ? 'IP banned (permanent)' : (u.bannedUntil ? 'Suspended until ' + banExpiry.toLocaleString() : 'Permanently banned'))
      : null;
    const avatar = u.photoURL
      ? `<img src="${escapeHtml(u.photoURL)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'" loading="lazy">`
      : `<div style="width:36px;height:36px;border-radius:50%;background:rgba(139,92,246,0.18);display:flex;align-items:center;justify-content:center;font-size:0.9rem;font-weight:700;color:var(--purple);flex-shrink:0">${escapeHtml((u.username||'?')[0].toUpperCase())}</div>`;
    const joinDate = u.createdAt ? new Date(u.createdAt).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}) : '';
    const lastSeen = u.lastSignIn ? relTime(u.lastSignIn) : '';
    const providers = (u.providers||[]).map(p => {
      if (p === 'google.com') return '<span style="font-size:0.65rem;padding:1px 6px;border-radius:99px;background:rgba(66,133,244,0.15);color:#4285f4;border:1px solid rgba(66,133,244,0.3)">Google</span>';
      if (p === 'password') return '<span style="font-size:0.65rem;padding:1px 6px;border-radius:99px;background:rgba(255,255,255,0.07);color:var(--text-3);border:1px solid var(--border)">Email</span>';
      return '';
    }).join(' ');
    return `
    <div class="user-row" style="gap:12px">
      ${avatar}
      <div class="user-row-info" style="flex:1;min-width:0">
        <div class="user-row-name">@${escapeHtml(u.username)} ${u.isAdmin ? '<span class="admin-badge">Admin</span>' : ''} ${providers}</div>
        <div class="user-row-sub">${escapeHtml(u.name || '')} &middot; ${escapeHtml(u.email || '')}</div>
        <div style="font-size:0.72rem;color:var(--text-3);margin-top:2px">Joined ${joinDate}${lastSeen ? ' &middot; Last seen ' + lastSeen : ''}</div>
        ${banLabel ? `<div style="margin-top:4px"><span class="ban-chip">${escapeHtml(banLabel)}</span></div>` : ''}
      </div>
      <div class="user-row-actions" style="flex-shrink:0">
        ${!u.isAdmin ? `
        <select class="dur-select" id="udur-${u.uid}">${durOptions}</select>
        <button class="btn btn-sm" style="background:rgba(245,158,11,0.12);color:var(--amber);border:1px solid rgba(245,158,11,0.25)" onclick="timeoutUser('${u.uid}')">Timeout</button>
        ${!u.banned
          ? `<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:var(--red);border:1px solid rgba(239,68,68,0.25)" onclick="banUser('${u.uid}')">Ban</button>`
          : `<button class="btn btn-sm" style="background:rgba(34,197,94,0.1);color:var(--green);border:1px solid rgba(34,197,94,0.25)" onclick="unbanUser('${u.uid}')">Unban${u.ipBanned ? ' + Remove IP Ban' : ''}</button>`
        }
        <button class="btn btn-sm" style="background:rgba(239,68,68,0.08);color:var(--red);border:1px solid rgba(239,68,68,0.2)" title="IP Ban — user must be online" onclick="ipBanUser('${u.uid}','${escapeHtml(u.username)}')">IP Ban</button>
        <button class="btn btn-ghost btn-sm" onclick="prefillNotify('${u.uid}','${escapeHtml(u.username)}')">Notify</button>
        <button class="btn btn-ghost btn-sm" onclick="openAdminReport('${u.uid}','${escapeHtml(u.username)}')">Report</button>
        ` : '<span style="font-size:0.75rem;color:var(--text-3)">Admin account</span>'}
      </div>
    </div>`;
  }).join('');
}

function timeoutUser(uid) {
  const sel = document.getElementById(`udur-${uid}`);
  const durationMs = sel ? parseInt(sel.value) : 3600000;
  socket.emit('admin-ban-user', { targetUserId: uid, durationMs });
}

function banUser(uid) {
  if (!confirm('Permanently ban this user?')) return;
  socket.emit('admin-ban-user', { targetUserId: uid, durationMs: null });
}

function unbanUser(uid) {
  socket.emit('admin-unban-user', { targetUserId: uid });
}

function ipBanUser(uid, username) {
  if (!confirm(`IP ban @${username}? This permanently blocks their network.\nUser must be currently online for this to work.`)) return;
  socket.emit('admin-ip-ban', { targetUserId: uid });
}

// Admin report modal
let _reportTargetId = null, _reportTargetName = '';
function openAdminReport(uid, username) {
  _reportTargetId = uid;
  _reportTargetName = username;
  const m = document.getElementById('adminReportModal');
  if (!m) return;
  document.getElementById('adminReportTarget').textContent = '@' + username;
  document.querySelectorAll('#adminReportModal input[name="admin-reason"]').forEach(r => r.checked = false);
  document.getElementById('adminReportOtherWrap').style.display = 'none';
  document.getElementById('adminReportOther').value = '';
  m.style.display = 'flex';
}
function closeAdminReport() {
  const m = document.getElementById('adminReportModal');
  if (m) m.style.display = 'none';
  _reportTargetId = null;
}
function submitAdminReport() {
  if (!_reportTargetId) return;
  const sel = document.querySelector('#adminReportModal input[name="admin-reason"]:checked');
  if (!sel) { showToast('Select a reason.', 'error'); return; }
  let reason = sel.value;
  if (reason === 'Other') {
    reason = document.getElementById('adminReportOther').value.trim();
    if (!reason) { showToast('Describe the reason.', 'error'); return; }
  }
  socket.emit('report-user', { reportedUserId: _reportTargetId, reportedUsername: _reportTargetName, reason, location: 'admin-panel' });
  closeAdminReport();
  showToast('Report submitted.', 'success');
}

document.addEventListener('change', e => {
  if (e.target.name === 'admin-reason') {
    const otherWrap = document.getElementById('adminReportOtherWrap');
    if (otherWrap) otherWrap.style.display = e.target.value === 'Other' ? 'block' : 'none';
  }
});

// Notify
function prefillNotify(uid, username) {
  resolvedNotifUserId = uid;
  const toEl = document.getElementById('notifTo');
  if (toEl) toEl.value = username;
  const statusEl = document.getElementById('notifResolveStatus');
  if (statusEl) statusEl.textContent = `Resolved: ${username}`;
  switchTab('notify');
  document.getElementById('notifMsg')?.focus();
}

async function resolveNotifUser() {
  const rawInput = (document.getElementById('notifTo')?.value || '').trim();
  const statusEl = document.getElementById('notifResolveStatus');
  if (!rawInput) return;
  statusEl.textContent = 'Looking up...';
  statusEl.style.color = 'var(--text-3)';

  // Try exact, then lowercase (usernames are stored as-entered but typically lowercase)
  const tries = [...new Set([rawInput, rawInput.toLowerCase()])];
  let uid = null;
  for (const name of tries) {
    try {
      const doc = await firestoreDb.collection('usernames').doc(name).get();
      if (doc.exists) { uid = doc.data().uid; break; }
    } catch {}
  }

  // Fallback: search allUsersCache if loaded
  if (!uid && allUsersCache.length) {
    const q = rawInput.toLowerCase();
    const match = allUsersCache.find(u =>
      (u.username || '').toLowerCase() === q ||
      (u.email || '').toLowerCase() === q
    );
    if (match) uid = match.uid;
  }

  if (!uid) {
    statusEl.textContent = 'User not found.';
    statusEl.style.color = 'var(--red)';
    resolvedNotifUserId = null;
    return;
  }
  resolvedNotifUserId = uid;
  statusEl.textContent = 'Resolved: ' + rawInput;
  statusEl.style.color = 'var(--green)';
}

function sendNotification() {
  const msg = (document.getElementById('notifMsg')?.value || '').trim();
  const statusEl = document.getElementById('notifSendStatus');
  if (!resolvedNotifUserId) { statusEl.textContent = 'Look up a user first.'; statusEl.style.color = 'var(--red)'; return; }
  if (!msg) { statusEl.textContent = 'Message cannot be empty.'; statusEl.style.color = 'var(--red)'; return; }
  socket.emit('admin-send-notification', { targetUserId: resolvedNotifUserId, message: msg });
  statusEl.textContent = 'Sending...';
  statusEl.style.color = 'var(--text-3)';
}

// ── Deletion Requests ──────────────────────────────────────────
async function loadDeletionRequests() {
  const list  = document.getElementById('delReqList');
  const badge = document.getElementById('delReqBadge');
  if (!list) return;
  list.innerHTML = '<div class="admin-empty">Loading&hellip;</div>';
  try {
    const token = await adminToken();
    const res   = await fetch('/api/admin/deletion-requests', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) { list.innerHTML = `<div class="admin-empty">Error loading requests (${res.status}).</div>`; return; }
    const data  = await res.json();
    const reqs  = data.requests || [];
    if (badge) { badge.textContent = reqs.length; badge.style.display = reqs.length ? 'inline' : 'none'; }
    if (!reqs.length) { list.innerHTML = '<div class="admin-empty">No pending deletion requests.</div>'; return; }
    list.innerHTML = reqs.map(r => `
      <div class="user-row" id="delreq-${escapeHtml(r.uid)}" style="border-color:rgba(239,68,68,0.15)">
        <div class="user-row-info">
          <div class="user-row-name">@${escapeHtml(r.username || '(unknown)')}</div>
          <div class="user-row-sub">${escapeHtml(r.email || '')} &nbsp;·&nbsp; Requested ${relTime(r.requestedAt)}</div>
        </div>
        <div class="user-row-actions">
          <button class="btn btn-ghost btn-sm" onclick="dismissDeletionRequest('${escapeHtml(r.uid)}')">Dismiss</button>
          <button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:var(--red);border:1px solid rgba(239,68,68,0.25)"
            onclick="confirmDeleteUser('${escapeHtml(r.uid)}', '${escapeHtml(r.username || '')}')">
            Delete Permanently
          </button>
        </div>
      </div>
    `).join('');
  } catch {
    list.innerHTML = '<div class="admin-empty">Error loading requests.</div>';
  }
}

async function confirmDeleteUser(uid, username) {
  if (!confirm(`Permanently delete @${username}?\n\nThis will:\n• Remove their Firebase Auth account\n• Delete their Firestore profile\n• Free up their username\n\nThis CANNOT be undone.`)) return;
  try {
    const token = await adminToken();
    const res   = await fetch('/api/admin/deletion-requests/' + encodeURIComponent(uid), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { const d = await res.json(); showToast(d.error || 'Error', 'error'); return; }
    showToast(`@${username} permanently deleted.`, 'success');
    loadDeletionRequests();
  } catch {
    showToast('Error deleting account.', 'error');
  }
}

// ── Appeals ────────────────────────────────────────────────────
const APPEAL_TYPE_LABEL = { timeout: 'Timeout', ban: 'Ban', 'ip-ban': 'IP Ban' };

async function loadAppeals(filter = 'pending') {
  currentAppealFilter = filter;
  document.getElementById('appeal-filt-pending')?.classList.toggle('active', filter === 'pending');
  document.getElementById('appeal-filt-all')?.classList.toggle('active', filter === 'all');
  const list = document.getElementById('appealsList');
  if (list && document.getElementById('pane-appeals')?.classList.contains('active')) {
    list.innerHTML = '<div class="admin-empty">Loading&hellip;</div>';
  }
  try {
    const token = await adminToken();
    const res = await fetch('/api/admin/appeals', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) { if (list) list.innerHTML = `<div class="admin-empty">Error loading appeals (${res.status}).</div>`; return; }
    const data = await res.json();
    const appeals = (data.appeals || []).filter(a => filter === 'all' || a.status === 'pending');

    const badge = document.getElementById('appealsBadge');
    const pendingCount = (data.appeals || []).filter(a => a.status === 'pending').length;
    if (badge) { badge.textContent = pendingCount; badge.style.display = pendingCount ? 'inline' : 'none'; }

    renderAppeals(appeals);
  } catch {
    if (list) list.innerHTML = '<div class="admin-empty">Error loading appeals.</div>';
  }
}

function renderAppeals(appeals) {
  const list = document.getElementById('appealsList');
  if (!list) return;
  if (!appeals.length) {
    list.innerHTML = '<div class="admin-empty">No appeals found.</div>';
    return;
  }
  list.innerHTML = appeals.map(a => {
    const isPending = a.status === 'pending';
    const who = a.username ? '@' + escapeHtml(a.username) : `IP ${escapeHtml(a.ip || 'unknown')}`;
    return `
    <div class="report-item${!isPending ? ' report-dismissed' : ''}">
      <div class="report-header">
        <span class="report-parties">
          ${who}
          <span class="report-loc" style="margin-left:6px">${APPEAL_TYPE_LABEL[a.type] || a.type}</span>
        </span>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="report-meta">${relTime(a.createdAt)}</span>
          ${!isPending ? `<span class="report-loc" style="color:var(--text-3)">${escapeHtml(a.status)}</span>` : ''}
        </div>
      </div>
      <div class="report-reason">"${escapeHtml(a.message)}"</div>
      ${isPending ? `
      <div class="report-actions">
        <button class="btn btn-ghost btn-sm" onclick="dismissAppeal('${a.id}')">Dismiss</button>
        <button class="btn btn-sm" style="background:rgba(34,197,94,0.1);color:var(--green);border:1px solid rgba(34,197,94,0.25)" onclick="approveAppeal('${a.id}')">Approve &amp; Lift Restriction</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

async function approveAppeal(id) {
  if (!confirm('Approve this appeal and lift the restriction?')) return;
  try {
    const token = await adminToken();
    const res = await fetch('/api/admin/appeals/' + encodeURIComponent(id) + '/approve', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { const d = await res.json(); showToast(d.error || 'Error', 'error'); return; }
    showToast('Appeal approved — restriction lifted.', 'success');
    loadAppeals(currentAppealFilter);
  } catch {
    showToast('Error approving appeal.', 'error');
  }
}

async function dismissAppeal(id) {
  try {
    const token = await adminToken();
    const res = await fetch('/api/admin/appeals/' + encodeURIComponent(id) + '/dismiss', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { const d = await res.json(); showToast(d.error || 'Error', 'error'); return; }
    showToast('Appeal dismissed.', 'success');
    loadAppeals(currentAppealFilter);
  } catch {
    showToast('Error dismissing appeal.', 'error');
  }
}

async function dismissDeletionRequest(uid) {
  try {
    const token = await adminToken();
    const res   = await fetch('/api/admin/deletion-requests/' + encodeURIComponent(uid) + '/dismiss', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { const d = await res.json(); showToast(d.error || 'Error', 'error'); return; }
    showToast('Request dismissed.', 'success');
    loadDeletionRequests();
  } catch {
    showToast('Error dismissing request.', 'error');
  }
}

// Auth guard — waits for Firebase auth, sends Bearer token to verify admin status server-side
let _adminVerified = false;
auth.onAuthStateChanged(async user => {
  if (_adminVerified) return; // only run once
  if (!user) { window.location.href = '/login'; return; }
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin-me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { window.location.href = '/lobby'; return; }
    const data = await res.json();
    _adminVerified = true;
    const el = document.getElementById('adminUsername');
    if (el) el.textContent = `@${data.username}`;
    const loader = document.getElementById('adminLoadScreen');
    if (loader) { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 260); }
    socket.connect();
  } catch {
    window.location.href = '/lobby';
  }
});

// ── The Divide: poll creation + management ────────────────────
const POLL_MAX_OPTIONS = 6;

function resetPollOptionRows() {
  const list = document.getElementById('pollOptionsList');
  if (!list || list.children.length) return; // don't clobber in-progress typing on tab re-entry
  list.innerHTML = '';
  addPollOptionRow();
  addPollOptionRow();
}

function addPollOptionRow() {
  const list = document.getElementById('pollOptionsList');
  if (!list || list.children.length >= POLL_MAX_OPTIONS) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:center';
  const idx = list.children.length + 1;
  row.innerHTML =
    `<input class="form-input poll-option-input" type="text" placeholder="Option ${idx}" maxlength="120" style="flex:1">` +
    `<button type="button" class="btn btn-ghost btn-sm" onclick="this.parentElement.remove()" aria-label="Remove option">&times;</button>`;
  list.appendChild(row);
  const addBtn = document.getElementById('addPollOptionBtn');
  if (addBtn) addBtn.style.display = list.children.length >= POLL_MAX_OPTIONS ? 'none' : '';
}

async function createPoll() {
  const questionEl = document.getElementById('pollQuestionInput');
  const question = (questionEl?.value || '').trim();
  const options = [...document.querySelectorAll('.poll-option-input')]
    .map(i => i.value.trim()).filter(Boolean);
  const category = document.getElementById('pollCategorySelect')?.value || 'general';
  const tags = (document.getElementById('pollTagsInput')?.value || '')
    .split(',').map(t => t.trim()).filter(Boolean);
  const statusEl = document.getElementById('pollCreateStatus');

  if (!question) { statusEl.textContent = 'Question is required.'; statusEl.style.color = 'var(--red)'; return; }
  if (options.length < 2) { statusEl.textContent = 'Provide at least 2 options.'; statusEl.style.color = 'var(--red)'; return; }

  statusEl.textContent = 'Creating…';
  statusEl.style.color = 'var(--text-3)';
  try {
    const token = await adminToken();
    const res = await fetch('/api/polls', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, options, category, tags })
    });
    const data = await res.json();
    if (!res.ok) { statusEl.textContent = data.error || 'Error creating poll.'; statusEl.style.color = 'var(--red)'; return; }
    statusEl.textContent = 'Poll created!';
    statusEl.style.color = 'var(--green)';
    questionEl.value = '';
    document.getElementById('pollTagsInput').value = '';
    document.getElementById('pollOptionsList').innerHTML = '';
    addPollOptionRow(); addPollOptionRow();
    loadDividePolls();
    showToast('Poll created — notifications sent to the most relevant users.', 'success');
  } catch {
    statusEl.textContent = 'Network error.';
    statusEl.style.color = 'var(--red)';
  }
}

// Accepts a single poll object, an array of poll objects, or { polls: [...] }
// per file, since admins may export/hand-write JSON in any of those shapes.
function extractPollsFromJson(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.polls)) return parsed.polls;
  if (parsed && typeof parsed === 'object') return [parsed];
  return [];
}

async function bulkImportPolls() {
  const input = document.getElementById('pollBulkFileInput');
  const statusEl = document.getElementById('pollBulkStatus');
  const files = input?.files ? [...input.files] : [];
  if (!files.length) {
    statusEl.textContent = 'Choose at least one JSON file.';
    statusEl.style.color = 'var(--red)';
    return;
  }

  statusEl.textContent = 'Reading files…';
  statusEl.style.color = 'var(--text-3)';

  const polls = [];
  const parseErrors = [];
  for (const file of files) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const extracted = extractPollsFromJson(parsed);
      if (!extracted.length) parseErrors.push(`${file.name}: no polls found`);
      polls.push(...extracted);
    } catch (e) {
      parseErrors.push(`${file.name}: invalid JSON`);
    }
  }

  if (!polls.length) {
    statusEl.innerHTML = 'No valid polls to import.' +
      (parseErrors.length ? '<br>' + parseErrors.map(e => `&bull; ${e}`).join('<br>') : '');
    statusEl.style.color = 'var(--red)';
    return;
  }

  statusEl.textContent = `Importing ${polls.length} poll(s)…`;
  try {
    const token = await adminToken();
    const res = await fetch('/api/polls/bulk', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ polls })
    });
    const data = await res.json();
    if (!res.ok) { statusEl.textContent = data.error || 'Error importing polls.'; statusEl.style.color = 'var(--red)'; return; }

    const failedLines = (data.results || [])
      .filter(r => !r.ok)
      .map(r => `&bull; #${r.index + 1}${r.question ? ' (' + r.question.slice(0, 40) + ')' : ''}: ${r.error}`);
    const lines = [`Created ${data.created} of ${polls.length} poll(s).`, ...parseErrors.map(e => `&bull; ${e}`), ...failedLines];
    statusEl.innerHTML = lines.join('<br>');
    statusEl.style.color = data.failed || parseErrors.length ? 'orange' : 'var(--green)';

    if (data.created > 0) {
      input.value = '';
      loadDividePolls();
      showToast(`Imported ${data.created} poll(s).`, 'success');
    }
  } catch {
    statusEl.textContent = 'Network error.';
    statusEl.style.color = 'var(--red)';
  }
}

async function loadDividePolls() {
  const list = document.getElementById('dividePollsList');
  list.innerHTML = '<div class="admin-empty">Loading…</div>';
  try {
    const token = await adminToken();
    const res = await fetch('/api/admin/polls', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();
    renderDividePolls(data.polls || []);
  } catch {
    list.innerHTML = '<div class="admin-empty">Error loading polls.</div>';
  }
}

let selectedPollIds = new Set();

function renderDividePolls(polls) {
  const list = document.getElementById('dividePollsList');
  selectedPollIds = new Set([...selectedPollIds].filter(id => polls.some(p => p.id === id)));
  if (!polls.length) { list.innerHTML = '<div class="admin-empty">No polls yet. Create one above.</div>'; updatePollSelectionUI(); return; }
  list.innerHTML = polls.map(p => `
    <div class="user-row" id="poll-row-${p.id}" style="align-items:flex-start">
      <input type="checkbox" class="poll-select-checkbox" data-poll-id="${p.id}" ${selectedPollIds.has(p.id) ? 'checked' : ''} onchange="togglePollSelection('${p.id}', this.checked)" style="margin-top:4px;margin-right:12px" />
      <div class="user-row-info">
        <div class="user-row-name" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${escapeHtml(p.question)}
          <span style="font-size:0.65rem;font-weight:700;background:rgba(139,92,246,0.12);color:var(--purple);border-radius:99px;padding:1px 8px;border:1px solid rgba(139,92,246,0.25)">${escapeHtml(p.categoryLabel || 'General')}</span>
        </div>
        <div class="user-row-sub" style="margin-top:4px">
          ${p.options.map((o, i) => `${escapeHtml(o)} (${p.votes[i] || 0})`).join('  ·  ')}
        </div>
        <div class="user-row-sub" style="margin-top:2px">${p.totalVotes} total votes &nbsp;·&nbsp; ${p.commentCount} comments</div>
        ${(p.tags || []).length ? `<div class="user-row-sub" style="margin-top:4px">${p.tags.map(t => `<span style="background:rgba(255,255,255,0.05);border-radius:6px;padding:1px 7px;margin-right:4px;font-size:0.7rem">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        ${p.trendingUntil && p.trendingUntil > Date.now()
          ? `<div class="user-row-sub" style="margin-top:6px;display:flex;align-items:center;gap:8px;color:#f97316">
               <img src="/icons/fire.svg" alt="" style="width:12px;height:12px;vertical-align:-1px"> Trending until ${new Date(p.trendingUntil).toLocaleDateString()}
               <button class="btn btn-ghost btn-sm" style="padding:2px 10px;min-height:auto;font-size:0.72rem" onclick="clearPollTrending('${p.id}')">Clear</button>
             </div>`
          : `<div class="user-row-sub" style="margin-top:6px;display:flex;align-items:center;gap:6px">
               <input type="number" min="1" max="30" placeholder="days" id="trend-days-${p.id}" style="width:60px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px;color:var(--text-1);padding:3px 6px;font-size:0.75rem" />
               <button class="btn btn-ghost btn-sm" style="padding:2px 10px;min-height:auto;font-size:0.72rem;color:#f97316" onclick="setPollTrending('${p.id}')">Make Trending</button>
             </div>`}
      </div>
      <div class="user-row-actions">
        ${p.status === 'active'
          ? `<span class="ban-chip" style="background:rgba(34,197,94,0.12);color:var(--green);border-color:rgba(34,197,94,0.25)">ACTIVE</span>
             <button class="btn btn-sm" style="background:rgba(239,68,68,0.1);color:var(--red);border:1px solid rgba(239,68,68,0.2)" onclick="closePoll('${p.id}')">Close</button>`
          : `<span class="ban-chip">CLOSED</span>`}
        <button class="btn btn-sm" style="background:rgba(239,68,68,0.18);color:var(--red);border:1px solid rgba(239,68,68,0.35)" onclick="deletePoll('${p.id}')">Delete</button>
      </div>
    </div>
  `).join('');
  updatePollSelectionUI();
}

function togglePollSelection(pollId, checked) {
  if (checked) selectedPollIds.add(pollId); else selectedPollIds.delete(pollId);
  updatePollSelectionUI();
}

function toggleSelectAllPolls(checked) {
  document.querySelectorAll('.poll-select-checkbox').forEach(cb => {
    cb.checked = checked;
    if (checked) selectedPollIds.add(cb.dataset.pollId); else selectedPollIds.delete(cb.dataset.pollId);
  });
  updatePollSelectionUI();
}

function updatePollSelectionUI() {
  const count = selectedPollIds.size;
  const btn = document.getElementById('deleteSelectedPollsBtn');
  const countEl = document.getElementById('selectedPollCount');
  if (countEl) countEl.textContent = count;
  if (btn) btn.style.display = count ? '' : 'none';
  const total = document.querySelectorAll('.poll-select-checkbox').length;
  const selectAll = document.getElementById('pollSelectAllCheckbox');
  if (selectAll) selectAll.checked = total > 0 && count === total;
}

async function deleteSelectedPolls() {
  const ids = [...selectedPollIds];
  if (!ids.length) return;
  if (!confirm(`Permanently delete ${ids.length} poll(s), along with all their votes and comments? This cannot be undone.`)) return;
  try {
    const token = await adminToken();
    const res = await fetch('/api/polls/bulk-delete', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollIds: ids })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to delete polls.', 'error'); return; }
    showToast(`Deleted ${data.deleted} poll(s).${data.failed ? ` ${data.failed} failed.` : ''}`, data.failed ? 'info' : 'success');
    selectedPollIds.clear();
    loadDividePolls();
  } catch { showToast('Network error.', 'error'); }
}

async function closePoll(pollId) {
  if (!confirm('Close this poll? It will stop accepting votes and challenges.')) return;
  try {
    const token = await adminToken();
    const res = await fetch(`/api/polls/${pollId}/close`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { showToast('Failed to close poll.', 'error'); return; }
    showToast('Poll closed.', 'success');
    loadDividePolls();
  } catch { showToast('Network error.', 'error'); }
}

async function setPollTrending(pollId) {
  const input = document.getElementById(`trend-days-${pollId}`);
  const days = parseInt(input?.value, 10);
  if (!days || days < 1 || days > 30) { showToast('Enter a number of days (1-30).', 'error'); return; }
  try {
    const token = await adminToken();
    const res = await fetch(`/api/polls/${pollId}/trending`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to set trending.', 'error'); return; }
    showToast(`Poll trending for ${days} day(s).`, 'success');
    loadDividePolls();
  } catch { showToast('Network error.', 'error'); }
}

async function clearPollTrending(pollId) {
  try {
    const token = await adminToken();
    const res = await fetch(`/api/polls/${pollId}/trending/clear`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { showToast('Failed to clear trending.', 'error'); return; }
    showToast('Trending cleared.', 'success');
    loadDividePolls();
  } catch { showToast('Network error.', 'error'); }
}

async function deletePoll(pollId) {
  if (!confirm('Permanently delete this poll, along with all its votes and comments? This cannot be undone.')) return;
  try {
    const token = await adminToken();
    const res = await fetch(`/api/polls/${pollId}`, {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { showToast('Failed to delete poll.', 'error'); return; }
    showToast('Poll deleted.', 'success');
    loadDividePolls();
  } catch { showToast('Network error.', 'error'); }
}

// ── Legal doc editor (Terms of Service / Privacy Policy) ────────────────
// document.execCommand is deprecated but still the only zero-dependency way
// to drive a lightweight contenteditable toolbar without pulling in a full
// rich-text library — fine here since the whole editor only needs to
// survive in this admin panel's own browser, not arbitrary user input.
let legalSavedRanges = { tosEditor: null, privacyEditor: null };

document.querySelectorAll('.legal-editor-toolbar').forEach(toolbar => {
  const targetId = toolbar.dataset.target;
  toolbar.addEventListener('mousedown', () => {
    const el = document.getElementById(targetId);
    const sel = window.getSelection();
    if (el && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      legalSavedRanges[targetId] = sel.getRangeAt(0).cloneRange();
    }
  });
});

function legalRestoreAndFocus(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  if (legalSavedRanges[targetId]) sel.addRange(legalSavedRanges[targetId]);
}

function legalExec(cmd, value, targetId = 'tosEditor') {
  legalRestoreAndFocus(targetId);
  document.execCommand(cmd, false, value || null);
}

function legalMakeLink(targetId = 'tosEditor') {
  const url = prompt('Link URL:');
  if (!url) return;
  legalRestoreAndFocus(targetId);
  document.execCommand('createLink', false, url);
}

async function loadLegalDoc(type) {
  const editorId = type === 'tos' ? 'tosEditor' : 'privacyEditor';
  const updatedId = type === 'tos' ? 'tosLastUpdated' : 'privacyLastUpdated';
  try {
    const res = await fetch('/api/legal/' + type);
    const data = await res.json();
    const editor = document.getElementById(editorId);
    if (editor) editor.innerHTML = data.html || '';
    const updatedEl = document.getElementById(updatedId);
    if (updatedEl) {
      updatedEl.textContent = data.updatedAt
        ? 'Last updated: ' + new Date(data.updatedAt).toLocaleString()
        : 'Never edited from the admin panel — showing the default text';
    }
  } catch {
    showToast('Failed to load document.', 'error');
  }
}

async function saveLegalDoc(type) {
  const label = type === 'tos' ? 'Terms of Service' : 'Privacy Policy';
  if (!confirm(`Save the ${label} and notify every user that it changed?`)) return;
  const editorId = type === 'tos' ? 'tosEditor' : 'privacyEditor';
  const statusId = type === 'tos' ? 'tosSaveStatus' : 'privacySaveStatus';
  const statusEl = document.getElementById(statusId);
  const html = document.getElementById(editorId)?.innerHTML || '';
  statusEl.textContent = 'Saving…';
  statusEl.style.color = 'var(--text-3)';
  try {
    const token = await adminToken();
    const res = await fetch(`/api/admin/legal/${type}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ html })
    });
    const data = await res.json();
    if (!res.ok) { statusEl.textContent = data.error || 'Error saving.'; statusEl.style.color = 'var(--red)'; return; }
    statusEl.textContent = 'Saved — every user has been notified.';
    statusEl.style.color = 'var(--green)';
    showToast(`${label} updated and users notified.`, 'success');
    loadLegalDoc(type);
  } catch {
    statusEl.textContent = 'Network error.';
    statusEl.style.color = 'var(--red)';
  }
}
