/* admin.js — Admin panel logic */

function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const colors = { success:'var(--green)', error:'var(--red)', info:'var(--purple)' };
  const icons  = { success:'✓', error:'✕', info:'ℹ' };
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
  return `${Math.floor(diff/86400000)}d ago`;
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

const durOptions = DURATIONS.map(d =>
  `<option value="${d.ms}">${d.label}</option>`
).join('');

// ── Socket ────────────────────────────────────────────────────
const socket = io({ autoConnect: false });
let currentFilter = 'pending';
let resolvedNotifUserId = null;

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

socket.on('admin-users', ({ users }) => {
  renderUsers(users);
});

socket.on('admin-action-done', ({ action, targetUserId, reportId }) => {
  if (action === 'ban' || action === 'unban') {
    showToast(action === 'ban' ? 'User banned.' : 'User unbanned.', 'success');
    searchUsers();
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

// ── Tabs ──────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.admin-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  const pane = document.getElementById(`pane-${name}`);
  const tabs = document.querySelectorAll('.admin-tab');
  const tabNames = ['reports','users','notify'];
  if (pane) pane.classList.add('active');
  const idx = tabNames.indexOf(name);
  if (tabs[idx]) tabs[idx].classList.add('active');
}

// ── Reports ───────────────────────────────────────────────────
function loadReports(filter = 'pending') {
  currentFilter = filter;
  document.getElementById('filt-pending')?.classList.toggle('active', filter === 'pending');
  document.getElementById('filt-all')?.classList.toggle('active', filter === 'all');
  document.getElementById('reportsList').innerHTML = '<div class="admin-empty">Loading…</div>';
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
          <span style="color:var(--text-3);margin:0 6px">→</span>
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

// ── Users ─────────────────────────────────────────────────────
function searchUsers() {
  const q = (document.getElementById('userSearchInput')?.value || '').trim();
  if (!q) return;
  document.getElementById('usersList').innerHTML = '<div class="admin-empty">Searching…</div>';
  socket.emit('admin-search-users', { query: q });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'userSearchInput') searchUsers();
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
    return `
    <div class="user-row">
      <div class="user-row-info">
        <div class="user-row-name">@${escapeHtml(u.username)} ${u.isAdmin ? '<span class="admin-badge">Admin</span>' : ''}</div>
        <div class="user-row-sub">${escapeHtml(u.name || '')} · ${escapeHtml(u.email || '')}</div>
        ${banLabel ? `<div style="margin-top:4px"><span class="ban-chip">${escapeHtml(banLabel)}</span></div>` : ''}
      </div>
      <div class="user-row-actions">
        ${!u.isAdmin ? `
        <select class="dur-select" id="udur-${u.uid}">${durOptions}</select>
        <button class="btn btn-sm" style="background:rgba(245,158,11,0.12);color:var(--amber);border:1px solid rgba(245,158,11,0.25)" onclick="timeoutUser('${u.uid}')">Timeout</button>
        ${!u.banned
          ? `<button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:var(--red);border:1px solid rgba(239,68,68,0.25)" onclick="banUser('${u.uid}')">Ban</button>`
          : `<button class="btn btn-sm" style="background:rgba(34,197,94,0.1);color:var(--green);border:1px solid rgba(34,197,94,0.25)" onclick="unbanUser('${u.uid}')">Unban</button>`
        }
        <button class="btn btn-ghost btn-sm" onclick="prefillNotify('${u.uid}','${escapeHtml(u.username)}')">Notify</button>
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

// ── Notify ────────────────────────────────────────────────────
function prefillNotify(uid, username) {
  resolvedNotifUserId = uid;
  const toEl = document.getElementById('notifTo');
  if (toEl) toEl.value = username;
  const statusEl = document.getElementById('notifResolveStatus');
  if (statusEl) statusEl.textContent = `✓ Resolved: UID ${uid}`;
  switchTab('notify');
  document.getElementById('notifMsg')?.focus();
}

async function resolveNotifUser() {
  const username = (document.getElementById('notifTo')?.value || '').trim();
  const statusEl = document.getElementById('notifResolveStatus');
  if (!username) return;
  statusEl.textContent = 'Looking up…';
  try {
    const doc = await firestoreDb.collection('usernames').doc(username).get();
    if (!doc.exists) { statusEl.textContent = '✗ User not found.'; resolvedNotifUserId = null; return; }
    resolvedNotifUserId = doc.data().uid;
    statusEl.textContent = `✓ Resolved: UID ${resolvedNotifUserId}`;
    statusEl.style.color = 'var(--green)';
  } catch {
    statusEl.textContent = '✗ Lookup failed.';
    resolvedNotifUserId = null;
  }
}

function sendNotification() {
  const msg = (document.getElementById('notifMsg')?.value || '').trim();
  const statusEl = document.getElementById('notifSendStatus');
  if (!resolvedNotifUserId) { statusEl.textContent = 'Look up a user first.'; statusEl.style.color = 'var(--red)'; return; }
  if (!msg) { statusEl.textContent = 'Message cannot be empty.'; statusEl.style.color = 'var(--red)'; return; }
  socket.emit('admin-send-notification', { targetUserId: resolvedNotifUserId, message: msg });
  statusEl.textContent = 'Sending…';
  statusEl.style.color = 'var(--text-3)';
}

// Notify char counter
document.addEventListener('input', e => {
  if (e.target.id === 'notifMsg') {
    document.getElementById('notifMsgCount').textContent = e.target.value.length;
  }
});

// Enter to look up user in notify
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'notifTo') resolveNotifUser();
});

// ── Auth guard ────────────────────────────────────────────────
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
