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

// ── Socket.io (delayed connect until Firebase Auth ready) ─────
const socket = io({ autoConnect: false });
let inQueue  = false;
let currentIdToken = null;

socket.on('connect', () => {
  if (currentIdToken) socket.emit('authenticate', { idToken: currentIdToken });
});

socket.on('authenticated', () => {
  // confirmed — nothing else needed here
});

socket.on('auth-error', ({ error }) => {
  showToast(error, 'error');
  auth.signOut();
  localStorage.clear();
  setTimeout(() => { window.location.href = '/login.html'; }, 1500);
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
  setTimeout(() => { window.location.href = `/debate.html?room=${encodeURIComponent(roomId)}`; }, 600);
});

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
  if (!user) { window.location.href = '/login.html'; return; }

  try {
    const doc = await firestoreDb.collection('users').doc(user.uid).get();
    if (!doc.exists) { window.location.href = '/login.html'; return; }

    const profile = doc.data();
    if (!profile.compassSet) {
      showToast('Please set your political position first.', 'info');
      setTimeout(() => { window.location.href = '/compass.html'; }, 1500);
      return;
    }

    updateProfileUI(profile);

    currentIdToken = await user.getIdToken();
    if (!socket.connected) socket.connect();
  } catch {
    showToast('Could not load profile. Check your connection.', 'error');
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
