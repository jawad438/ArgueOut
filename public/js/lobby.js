/* lobby.js — matchmaking lobby with Socket.io + Firebase */

// ── Image compression ─────────────────────────────────────────
function compressAvatar(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const SIZE   = 96;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx    = canvas.getContext('2d');
      const s      = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, SIZE, SIZE);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const colors = { success: 'var(--green)', error: 'var(--red)', info: 'var(--purple)' };
  const icons  = { success: '✓', error: '✕', info: 'ℹ' };
  const toast  = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon" style="color:${colors[type]}">${icons[type]}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

// ── Compass helpers ───────────────────────────────────────────
function getQuadrantInfo(px, py) {
  const econ   = px >= 0 ? 'Right' : 'Left';
  const social = py >= 0 ? 'Authoritarian' : 'Libertarian';
  const map = {
    'Authoritarian-Left':  { label: 'Auth-Left',  color: '#ef4444', badge: 'badge-red'   },
    'Authoritarian-Right': { label: 'Auth-Right', color: '#3b82f6', badge: 'badge-blue'  },
    'Libertarian-Left':    { label: 'Lib-Left',   color: '#22c55e', badge: 'badge-green' },
    'Libertarian-Right':   { label: 'Lib-Right',  color: '#f59e0b', badge: 'badge-amber' },
  };
  return map[`${social}-${econ}`] || { label: 'Centre', color: '#8b5cf6', badge: 'badge-purple' };
}

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

// ── Avatar helpers ────────────────────────────────────────────
function applyAvatar(avatarUrl, initial) {
  const navAvatar  = document.getElementById('navAvatar');
  const profAvatar = document.getElementById('profileAvatar');
  const imgHtml    = `<img src="${avatarUrl}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;

  if (avatarUrl) {
    if (navAvatar)  navAvatar.innerHTML  = imgHtml;
    if (profAvatar) profAvatar.innerHTML = imgHtml;
  } else {
    if (navAvatar)  navAvatar.textContent  = initial;
    if (profAvatar) profAvatar.textContent = initial;
  }
}

// ── Profile UI ────────────────────────────────────────────────
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function updateProfileUI(profile) {
  const initial = (profile.username || 'U')[0].toUpperCase();

  const navUname     = document.getElementById('navUsername');
  const profName     = document.getElementById('profileName');
  const profUsername = document.getElementById('profileUsername');
  const profTags     = document.getElementById('profileTags');
  const posBadge     = document.getElementById('positionBadge');

  if (navUname)     navUname.textContent     = profile.username;
  if (profName)     profName.textContent     = profile.name || profile.username;
  if (profUsername) profUsername.textContent = `@${profile.username}`;

  // Show display rows (they may be hidden from a previous edit session)
  const nameDisplayRow     = document.getElementById('nameDisplayRow');
  const usernameDisplayRow = document.getElementById('usernameDisplayRow');
  if (nameDisplayRow)     nameDisplayRow.style.display     = 'flex';
  if (usernameDisplayRow) usernameDisplayRow.style.display = 'flex';

  const savedAvatar = profile.avatarUrl || localStorage.getItem('avatarDataUrl');
  applyAvatar(savedAvatar, initial);

  if (profTags) {
    profTags.innerHTML = '';
    const tags = [];
    if (profile.age)                                         tags.push(profile.age + ' yrs');
    if (profile.gender   && profile.gender   !== 'prefer_not_to_say') tags.push(capitalize(profile.gender.replace('_', ' ')));
    if (profile.religion && profile.religion !== 'prefer_not_to_say') tags.push(capitalize(profile.religion));
    tags.forEach(t => {
      const span = document.createElement('span');
      span.className = 'profile-tag';
      span.textContent = t;
      profTags.appendChild(span);
    });
  }

  // Bio
  const bioText = document.getElementById('bioText');
  if (bioText) {
    if (profile.bio) {
      bioText.textContent   = profile.bio;
      bioText.style.color   = 'var(--text-2)';
      bioText.style.fontStyle = 'normal';
    } else {
      bioText.textContent   = 'Add a bio...';
      bioText.style.color   = 'var(--text-3)';
      bioText.style.fontStyle = 'italic';
    }
  }

  if (posBadge) {
    const info = getQuadrantInfo(profile.politicalX || 0, profile.politicalY || 0);
    posBadge.innerHTML = `<span class="badge ${info.badge}">${info.label}</span>`;
  }

  const miniCanvas = document.getElementById('miniCompass');
  if (miniCanvas) drawMiniCompass(miniCanvas, profile.politicalX || 0, profile.politicalY || 0);
}

// ── Helpers ───────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Socket.io (delayed connect until Firebase Auth ready) ─────
const socket = io({ autoConnect: false });
let inQueue       = false;
let currentIdToken = null;
let currentUserId  = null;

// ── Online directory / challenge state ────────────────────────
let onlineUsersCache   = [];
let pendingChallengeFrom = null; // { socketId, userId, username }

socket.on('connect', () => {
  if (currentIdToken) socket.emit('authenticate', { idToken: currentIdToken });
});

socket.on('authenticated', () => {
  if (new URLSearchParams(location.search).get('autoqueue') === '1') {
    history.replaceState({}, '', '/lobby');
    setTimeout(() => socket.emit('join-queue'), 300);
  }
});

socket.on('auth-error', ({ error }) => {
  showToast(error, 'error');
  auth.signOut();
  localStorage.clear();
  setTimeout(() => { window.location.href = '/login'; }, 1500);
});

socket.on('queue-joined', () => {
  inQueue = true;
  showSearching();
  showToast('Added to queue — searching for an opponent...', 'info');
});

socket.on('queue-left', () => { inQueue = false; showIdle(); });

socket.on('queue-size', ({ size }) => {
  const el = document.getElementById('queueSizeDisplay');
  if (el) el.textContent = size;
});

socket.on('match-found', ({ roomId, opponent }) => {
  inQueue = false;
  showToast(`Matched with ${opponent.username}!`, 'success');
  localStorage.setItem('debateRoomId',  roomId);
  localStorage.setItem('debateOpponent', JSON.stringify(opponent));
  setTimeout(() => { window.location.href = `/debate?room=${encodeURIComponent(roomId)}`; }, 600);
});

// ── Online users directory ────────────────────────────────────
socket.on('online-users', (users) => {
  onlineUsersCache = users;
  renderDirectory(users);
});

function renderDirectory(users) {
  const list  = document.getElementById('directoryList');
  const count = document.getElementById('onlineCount');
  if (!list) return;

  const uid    = currentUserId || localStorage.getItem('userId');
  const others = users.filter(u => u.userId !== uid);

  if (count) count.textContent = `${others.length} user${others.length !== 1 ? 's' : ''}`;

  if (others.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-3);font-size:0.85rem;padding:20px 0">No other users online</div>';
    return;
  }

  list.innerHTML = others.map(u => {
    const avatarHtml = u.avatarUrl
      ? `<img src="${escapeHtml(u.avatarUrl)}" alt="${escapeHtml(u.username)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
      : escapeHtml((u.username || 'U')[0].toUpperCase());
    const info = getQuadrantInfo(u.politicalX || 0, u.politicalY || 0);
    return `
      <div class="directory-user-row" onclick="openUserProfile('${escapeHtml(u.userId)}')">
        <div class="directory-avatar">${avatarHtml}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(u.name || u.username)}</div>
          <div style="font-size:0.75rem;color:var(--text-3)">@${escapeHtml(u.username)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0">
          <span class="badge ${info.badge}" style="font-size:0.6rem;padding:2px 6px">${info.label}</span>
          ${u.inDebate ? '<span style="font-size:0.7rem;color:var(--text-3)">In debate</span>' : '<span style="font-size:0.7rem;color:var(--green)">● Online</span>'}
        </div>
      </div>
    `;
  }).join('');
}

function openUserProfile(userId) {
  const user = onlineUsersCache.find(u => u.userId === userId);
  if (!user) return;

  const content = document.getElementById('modalContent');
  if (!content) return;

  const avatarHtml = user.avatarUrl
    ? `<img src="${escapeHtml(user.avatarUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
    : escapeHtml((user.username || 'U')[0].toUpperCase());

  const info = getQuadrantInfo(user.politicalX || 0, user.politicalY || 0);
  const capitalize = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  const tags = [];
  if (user.age) tags.push(`${user.age} yrs`);
  if (user.gender   && user.gender   !== 'prefer_not_to_say') tags.push(capitalize(user.gender.replace('_', ' ')));
  if (user.religion && user.religion !== 'prefer_not_to_say') tags.push(capitalize(user.religion));
  const tagsHtml = tags.map(t => `<span class="profile-tag">${escapeHtml(t)}</span>`).join('');

  content.innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div style="width:80px;height:80px;border-radius:50%;background:var(--grad-brand);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk',sans-serif;font-size:2rem;font-weight:800;color:#fff;overflow:hidden;box-shadow:0 0 24px rgba(139,92,246,0.3)">
        ${avatarHtml}
      </div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:1.25rem;font-weight:700">${escapeHtml(user.name || user.username)}</div>
      <div style="color:var(--text-3);font-size:0.85rem;margin-bottom:12px">@${escapeHtml(user.username)}</div>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-bottom:10px">
        <span class="badge ${info.badge}">${info.label}</span>
        ${tagsHtml}
      </div>
      ${user.inDebate ? '<div style="font-size:0.8rem;color:var(--text-3);margin-top:4px">Currently in a debate</div>' : ''}
    </div>
    ${user.bio ? `<div style="font-size:0.88rem;color:var(--text-2);line-height:1.65;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:var(--r-md)">${escapeHtml(user.bio)}</div>` : ''}
  `;

  const challengeBtn = document.getElementById('challengeBtn');
  const pendingMsg   = document.getElementById('challengePendingMsg');
  if (challengeBtn) {
    challengeBtn.style.display = user.inDebate ? 'none' : 'block';
    challengeBtn.onclick = () => sendChallenge(user.userId, user.username);
  }
  if (pendingMsg) pendingMsg.style.display = 'none';

  const modal = document.getElementById('userProfileModal');
  if (modal) modal.style.display = 'flex';
}

function closeProfileModal() {
  const modal = document.getElementById('userProfileModal');
  if (modal) modal.style.display = 'none';
}

// ── Challenge system ──────────────────────────────────────────
function sendChallenge(targetUserId, targetUsername) {
  socket.emit('send-challenge', { targetUserId });
  showToast(`Challenge sent to ${targetUsername}!`, 'info');
  const challengeBtn = document.getElementById('challengeBtn');
  const pendingMsg   = document.getElementById('challengePendingMsg');
  if (challengeBtn) challengeBtn.style.display = 'none';
  if (pendingMsg)   pendingMsg.style.display   = 'block';
}

socket.on('challenge-error', ({ error }) => {
  showToast(error, 'error');
  closeProfileModal();
});

socket.on('challenge-received', ({ from }) => {
  pendingChallengeFrom = from;

  addToNotifHistory({ icon: '⚔️', text: `${from.username} challenged you to a debate!` });

  if (Notification.permission === 'granted') {
    new Notification('⚔️ ArgueOut Challenge', {
      body: `${from.username} is challenging you to a debate!`,
      icon: '/logo.png'
    });
  }

  const notifText = document.getElementById('challengeNotifText');
  if (notifText) notifText.textContent = `⚔️ ${from.username} challenged you to a debate!`;

  const panel = document.getElementById('challengeNotifPanel');
  if (panel) panel.classList.add('active');

  setTimeout(() => {
    if (panel) panel.classList.remove('active');
    pendingChallengeFrom = null;
  }, 30000);
});

socket.on('challenge-accepted', ({ roomId, opponent }) => {
  addToNotifHistory({ icon: '✅', text: `${opponent.username} accepted your challenge!` });
  showToast(`Challenge accepted! Starting debate...`, 'success');
  localStorage.setItem('debateRoomId', roomId);
  localStorage.setItem('debateOpponent', JSON.stringify(opponent));
  setTimeout(() => { window.location.href = `/debate?room=${encodeURIComponent(roomId)}`; }, 600);
});

// ── Invite link events ────────────────────────────────────────
let currentInviteUrl = '';
let pendingInviteRoomId   = null;
let pendingInviteOpponent = null;

function joinInviteDebate() {
  if (!pendingInviteRoomId) return;
  localStorage.setItem('debateRoomId', pendingInviteRoomId);
  localStorage.setItem('debateOpponent', JSON.stringify(pendingInviteOpponent || {}));
  window.location.href = `/debate?room=${encodeURIComponent(pendingInviteRoomId)}`;
}

function dismissInviteNotif() {
  const panel = document.getElementById('inviteNotifPanel');
  if (panel) panel.classList.remove('active');
  pendingInviteRoomId   = null;
  pendingInviteOpponent = null;
}

socket.on('invite-generated', ({ url, expiresAt }) => {
  const fullUrl = window.location.origin + url;
  currentInviteUrl = fullUrl;
  const box      = document.getElementById('inviteLinkBox');
  const linkText = document.getElementById('inviteLinkText');
  const expText  = document.getElementById('inviteExpireText');
  if (box)      box.style.display      = 'block';
  if (linkText) linkText.textContent   = fullUrl;
  const mins = Math.round((expiresAt - Date.now()) / 60000);
  if (expText)  expText.textContent    = `Expires in ${mins} minute${mins !== 1 ? 's' : ''}`;
  showToast('Invite link generated! Copy and share it.', 'success');
});

socket.on('invite-accepted', ({ roomId, opponent }) => {
  pendingInviteRoomId   = roomId;
  pendingInviteOpponent = opponent;

  addToNotifHistory({ icon: '🔗', text: `${opponent.username} accepted your invite!` });

  if (Notification.permission === 'granted') {
    new Notification('🔗 ArgueOut Invite', {
      body: `${opponent.username} accepted your invite! Tap to join the debate.`,
      icon: '/logo.png'
    });
  }

  const notifText = document.getElementById('inviteNotifText');
  if (notifText) notifText.textContent = `${opponent.username} accepted your invite!`;
  const panel = document.getElementById('inviteNotifPanel');
  if (panel) panel.classList.add('active');
});

function copyInviteLink() {
  if (!currentInviteUrl) return;
  navigator.clipboard.writeText(currentInviteUrl).then(() => {
    showToast('Link copied to clipboard!', 'success');
    const btn = document.getElementById('copyInviteBtn');
    if (btn) {
      btn.innerHTML = '<svg style="width:14px;height:14px;fill:none;stroke:var(--green);stroke-width:2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        btn.innerHTML = '<svg style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      }, 2000);
    }
  }).catch(() => {
    const tmp = document.createElement('textarea');
    tmp.value = currentInviteUrl;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
    showToast('Link copied!', 'success');
  });
}

const generateInviteBtn = document.getElementById('generateInviteBtn');
if (generateInviteBtn) {
  generateInviteBtn.addEventListener('click', () => {
    const expiry = parseInt(document.getElementById('inviteExpiry')?.value || '300000');
    socket.emit('generate-invite', { expiryMs: expiry });
  });
}

socket.on('challenge-rejected', ({ byUsername }) => {
  addToNotifHistory({ icon: '❌', text: `${byUsername} declined your challenge.` });
  showToast(`${byUsername} declined your challenge.`, 'info');
  closeProfileModal();
});

// Challenge notification buttons
const acceptChallengeBtn  = document.getElementById('acceptChallengeBtn');
const rejectChallengeBtn  = document.getElementById('rejectChallengeBtn');
const dismissChallengeBtn = document.getElementById('dismissChallengeBtn');

function dismissChallengeNotif() {
  const panel = document.getElementById('challengeNotifPanel');
  if (panel) panel.classList.remove('active');
  pendingChallengeFrom = null;
}

if (acceptChallengeBtn) {
  acceptChallengeBtn.addEventListener('click', () => {
    if (!pendingChallengeFrom) return;
    socket.emit('accept-challenge', { challengerSocketId: pendingChallengeFrom.socketId });
    dismissChallengeNotif();
  });
}
if (rejectChallengeBtn) {
  rejectChallengeBtn.addEventListener('click', () => {
    if (pendingChallengeFrom) socket.emit('reject-challenge', { challengerSocketId: pendingChallengeFrom.socketId });
    dismissChallengeNotif();
  });
}
if (dismissChallengeBtn) dismissChallengeBtn.addEventListener('click', dismissChallengeNotif);

// ── UI state ──────────────────────────────────────────────────
function showSearching() {
  const idle   = document.getElementById('idleCard');
  const search = document.getElementById('searchCard');
  if (idle)   idle.style.display   = 'none';
  if (search) search.style.display = 'block';
}

function showIdle() {
  const idle   = document.getElementById('idleCard');
  const search = document.getElementById('searchCard');
  if (idle)   idle.style.display   = 'block';
  if (search) search.style.display = 'none';
}

// ── Button handlers ───────────────────────────────────────────
const findBtn   = document.getElementById('findBtn');
const cancelBtn = document.getElementById('cancelBtn');
const logoutBtn = document.getElementById('logoutBtn');

if (findBtn)   findBtn.addEventListener('click',   () => { if (!inQueue) socket.emit('join-queue'); });
if (cancelBtn) cancelBtn.addEventListener('click', () => { socket.emit('leave-queue'); });

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (inQueue) socket.emit('leave-queue');
    await auth.signOut();
    localStorage.clear();
    window.location.href = '/';
  });
}

// ── Firebase Auth → load profile → connect socket ─────────────
auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = '/login'; return; }

  try {
    const doc = await firestoreDb.collection('users').doc(user.uid).get();
    if (!doc.exists) { window.location.href = '/login'; return; }

    const profile = doc.data();
    if (!profile.compassSet) {
      showToast('Please set your political position first.', 'info');
      setTimeout(() => { window.location.href = '/compass'; }, 1500);
      return;
    }

    currentUserId = user.uid;
    updateProfileUI(profile);

    currentIdToken = await user.getIdToken();
    if (!socket.connected) socket.connect();

    // Request browser notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch {
    showToast('Could not load profile. Check your connection.', 'error');
  }
});

// ── Notification history & dropdown ──────────────────────────
let notifHistory = [];
let notifDropdownOpen = false;

function addToNotifHistory(notif) {
  notifHistory.unshift({ ...notif, time: new Date().toISOString(), read: false });
  if (notifHistory.length > 50) notifHistory.pop();
  refreshNotifBadge();
  if (notifDropdownOpen) renderNotifList();
}

function refreshNotifBadge() {
  const badge = document.getElementById('notifBadge');
  const unread = notifHistory.filter(n => !n.read).length;
  if (badge) {
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.style.display = unread > 0 ? 'flex' : 'none';
  }
}

function renderNotifList() {
  const list = document.getElementById('notifList');
  if (!list) return;
  if (notifHistory.length === 0) {
    list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
    return;
  }
  list.innerHTML = notifHistory.map(n => {
    const timeStr = new Date(n.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="notif-item${n.read ? '' : ' unread'}">
      <span class="notif-item-icon">${n.icon || '🔔'}</span>
      <div class="notif-item-body">
        <div class="notif-item-text">${escapeHtml(n.text)}</div>
        <div class="notif-item-time">${timeStr}</div>
      </div>
    </div>`;
  }).join('');
}

function openNotifDropdown() {
  const dropdown = document.getElementById('notifDropdown');
  if (!dropdown) return;
  notifDropdownOpen = true;
  notifHistory.forEach(n => { n.read = true; });
  refreshNotifBadge();
  renderNotifList();
  dropdown.style.display = 'flex';
}

function closeNotifDropdown() {
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown) dropdown.style.display = 'none';
  notifDropdownOpen = false;
}

function clearNotifications() {
  notifHistory = [];
  refreshNotifBadge();
  renderNotifList();
}

const notifBtn = document.getElementById('notifBtn');
if (notifBtn) {
  notifBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (notifDropdownOpen) {
      closeNotifDropdown();
    } else {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      openNotifDropdown();
    }
  });
}

document.addEventListener('click', e => {
  if (!notifDropdownOpen) return;
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown && !dropdown.contains(e.target) && !notifBtn?.contains(e.target)) {
    closeNotifDropdown();
  }
});

// ── Bio edit ──────────────────────────────────────────────────
function startBioEdit() {
  const bioDisplay  = document.getElementById('bioDisplay');
  const bioEdit     = document.getElementById('bioEdit');
  const bioInput    = document.getElementById('bioInput');
  const bioText     = document.getElementById('bioText');
  const bioEditCount = document.getElementById('bioEditCount');
  if (!bioDisplay || !bioEdit || !bioInput) return;

  const current = (bioText?.style.fontStyle === 'italic') ? '' : (bioText?.textContent || '');
  bioInput.value = current;
  if (bioEditCount) bioEditCount.textContent = current.length;
  bioDisplay.style.display = 'none';
  bioEdit.style.display    = 'block';
  bioInput.focus();
}

function cancelBioEdit() {
  document.getElementById('bioDisplay').style.display = 'block';
  document.getElementById('bioEdit').style.display    = 'none';
}

async function saveBio() {
  const bioInput  = document.getElementById('bioInput');
  const saveBtn   = document.getElementById('saveBioBtn');
  const bioText   = document.getElementById('bioText');
  const user      = auth.currentUser;
  if (!bioInput || !user) return;

  const newBio = bioInput.value.trim().slice(0, 280);
  saveBtn.disabled  = true;
  saveBtn.textContent = 'Saving...';

  try {
    await firestoreDb.collection('users').doc(user.uid).update({ bio: newBio });
    if (bioText) {
      if (newBio) {
        bioText.textContent   = newBio;
        bioText.style.color   = 'var(--text-2)';
        bioText.style.fontStyle = 'normal';
      } else {
        bioText.textContent   = 'Add a bio...';
        bioText.style.color   = 'var(--text-3)';
        bioText.style.fontStyle = 'italic';
      }
    }
    cancelBioEdit();
    showToast('Bio updated!', 'success');
  } catch {
    showToast('Could not save bio. Try again.', 'error');
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save';
  }
}

// Bio char counter (live)
document.addEventListener('input', e => {
  if (e.target.id === 'bioInput') {
    const el = document.getElementById('bioEditCount');
    if (el) el.textContent = e.target.value.length;
  }
});

// ── Name edit ──────────────────────────────────────────────────
function startNameEdit() {
  const nameEl = document.getElementById('profileName');
  document.getElementById('nameDisplayRow').style.display = 'none';
  document.getElementById('nameEditRow').style.display    = 'block';
  const input = document.getElementById('nameInput');
  if (input) { input.value = nameEl?.textContent || ''; input.focus(); }
}

function cancelNameEdit() {
  document.getElementById('nameDisplayRow').style.display = 'flex';
  document.getElementById('nameEditRow').style.display    = 'none';
}

async function saveName() {
  const input = document.getElementById('nameInput');
  const btn   = document.getElementById('saveNameBtn');
  const user  = auth.currentUser;
  if (!input || !user) return;

  const newName = input.value.trim();
  if (!newName) { showToast('Name cannot be empty.', 'error'); return; }

  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    await firestoreDb.collection('users').doc(user.uid).update({ name: newName });
    const nameEl = document.getElementById('profileName');
    if (nameEl) nameEl.textContent = newName;
    cancelNameEdit();
    showToast('Name updated!', 'success');
  } catch {
    showToast('Could not update name. Try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ── Username edit ──────────────────────────────────────────────
function startUsernameEdit() {
  const usernameEl = document.getElementById('profileUsername');
  const current    = (usernameEl?.textContent || '').replace(/^@/, '');
  document.getElementById('usernameDisplayRow').style.display = 'none';
  document.getElementById('usernameEditRow').style.display    = 'block';
  const input = document.getElementById('usernameInput');
  if (input) { input.value = current; input.focus(); }
}

function cancelUsernameEdit() {
  document.getElementById('usernameDisplayRow').style.display = 'flex';
  document.getElementById('usernameEditRow').style.display    = 'none';
}

async function saveUsername() {
  const input = document.getElementById('usernameInput');
  const btn   = document.getElementById('saveUsernameBtn');
  const user  = auth.currentUser;
  if (!input || !user) return;

  const newUsername = input.value.trim();
  const oldUsername = localStorage.getItem('username') || '';

  if (!newUsername) { showToast('Username cannot be empty.', 'error'); return; }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(newUsername)) {
    showToast('Username: 3–20 chars, letters/numbers/underscore only.', 'error');
    return;
  }
  if (newUsername === oldUsername) { cancelUsernameEdit(); return; }

  btn.disabled = true;
  btn.textContent = 'Checking...';
  try {
    const existing = await firestoreDb.collection('usernames').doc(newUsername).get();
    if (existing.exists) {
      showToast('Username already taken. Try another.', 'error');
      return;
    }

    btn.textContent = 'Saving...';

    // Password-based accounts use username@argueout.app as Firebase Auth email — keep it in sync
    const isPasswordAccount = user.email && user.email.endsWith('@argueout.app');
    if (isPasswordAccount) {
      await user.updateEmail(`${newUsername.toLowerCase().replace(/[^a-z0-9_]/g, '')}@argueout.app`);
    }

    const batch = firestoreDb.batch();
    batch.update(firestoreDb.collection('users').doc(user.uid), { username: newUsername });
    if (oldUsername) batch.delete(firestoreDb.collection('usernames').doc(oldUsername));
    batch.set(firestoreDb.collection('usernames').doc(newUsername), { uid: user.uid });
    await batch.commit();

    localStorage.setItem('username', newUsername);
    const usernameEl = document.getElementById('profileUsername');
    const navUname   = document.getElementById('navUsername');
    if (usernameEl) usernameEl.textContent = `@${newUsername}`;
    if (navUname)   navUname.textContent   = newUsername;
    cancelUsernameEdit();
    showToast('Username updated!', 'success');
  } catch (err) {
    if (err.code === 'auth/requires-recent-login') {
      showToast('Please sign out and sign back in to change your username.', 'error');
    } else {
      showToast('Could not update username. Try again.', 'error');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ── Profile picture change ────────────────────────────────────
const profilePicInput = document.getElementById('profilePicInput');
const profilePicWrap  = document.getElementById('profilePicWrap');
const avatarHover     = document.getElementById('avatarHover');

if (profilePicWrap) {
  profilePicWrap.addEventListener('mouseenter', () => { if (avatarHover) avatarHover.style.opacity = '1'; });
  profilePicWrap.addEventListener('mouseleave', () => { if (avatarHover) avatarHover.style.opacity = '0'; });
}

if (profilePicInput) {
  profilePicInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('Image must be under 10 MB.', 'error'); return; }

    const user    = auth.currentUser;
    const initial = (localStorage.getItem('username') || 'U')[0].toUpperCase();

    const reader = new FileReader();
    reader.onload = async ev => {
      applyAvatar(ev.target.result, initial); // immediate preview
      try {
        const compressed = await compressAvatar(ev.target.result);
        await firestoreDb.collection('users').doc(user.uid).update({ avatarUrl: compressed });
        localStorage.setItem('avatarDataUrl', compressed);
        applyAvatar(compressed, initial);
        showToast('Profile picture updated!', 'success');
      } catch {
        showToast('Could not save picture. Try again.', 'error');
      }
    };
    reader.readAsDataURL(file);
  });
}
