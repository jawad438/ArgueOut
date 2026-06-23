/* admin.js — Admin panel logic */

function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const colors = { success:'var(--green)', error:'var(--red)', info:'var(--purple)' };
  const icons  = { success:'&#10003;', error:'&#10005;', info:'&#8505;' };
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
let resolvedNotifUserId = null;
let allUsersCache = [];

socket.on('connect', () => {
  auth.currentUser?.getIdToken().then(token => {
    socket.emit('authenticate', { idToken: token });
  });
});

socket.on('authenticated', () => {
  loadReports('pending');
});

socket.on('admin-reports', ({ reports }) => {
  renderReports(reports);
});

// Legacy search results
socket.on('admin-users', ({ users }) => {
  allUsersCache = users;
  renderUsers(users);
});

// All users from admin-get-all-users
socket.on('admin-all-users', ({ users }) => {
  allUsersCache = users;
  renderUsers(users);
});

// Rich Firebase Auth user list
socket.on('admin-firebase-users', ({ users }) => {
  allUsersCache = users;
  renderUsers(users);
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
  const tabNames = ['reports','users','notify'];
  if (pane) pane.classList.add('active');
  const idx = tabNames.indexOf(name);
  if (tabs[idx]) tabs[idx].classList.add('active');

  if (name === 'users') {
    loadAllUsers();
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
    const banLabel = u.banned
      ? (u.bannedUntil ? `Suspended until ${new Date(u.bannedUntil).toLocaleString()}` : 'Permanently banned')
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
          : `<button class="btn btn-sm" style="background:rgba(34,197,94,0.1);color:var(--green);border:1px solid rgba(34,197,94,0.25)" onclick="unbanUser('${u.uid}')">Unban</button>`
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
  const username = (document.getElementById('notifTo')?.value || '').trim();
  const statusEl = document.getElementById('notifResolveStatus');
  if (!username) return;
  statusEl.textContent = 'Looking up...';
  try {
    const doc = await firestoreDb.collection('usernames').doc(username).get();
    if (!doc.exists) { statusEl.textContent = 'User not found.'; resolvedNotifUserId = null; return; }
    resolvedNotifUserId = doc.data().uid;
    statusEl.textContent = `Resolved: ${username}`;
    statusEl.style.color = 'var(--green)';
  } catch {
    statusEl.textContent = 'Lookup failed.';
    resolvedNotifUserId = null;
  }
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

// Auth guard
auth.onAuthStateChanged(async user => {
  if (!user) { window.location.href = '/login'; return; }
  try {
    const doc = await firestoreDb.collection('users').doc(user.uid).get();
    if (!doc.exists || !doc.data().isAdmin) {
      window.location.href = '/lobby';
      return;
    }
    const el = document.getElementById('adminUsername');
    if (el) el.textContent = `@${doc.data().username}`;
    socket.connect();
  } catch {
    window.location.href = '/lobby';
  }
});
