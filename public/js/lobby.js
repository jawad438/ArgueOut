/* lobby.js - matchmaking lobby with Socket.io + Firebase */

// -- Image compression -----------------------------------------
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

// -- Toast -----------------------------------------------------
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

// -- Compass helpers -------------------------------------------
function getQuadrantInfo(px, py) {
  if (Math.sqrt(px * px + py * py) < 0.3) {
    return { label: 'Centrist', color: '#8b5cf6', badge: 'badge-purple' };
  }
  const econ   = px >= 0 ? 'Right' : 'Left';
  const social = py >= 0 ? 'Authoritarian' : 'Libertarian';
  const map = {
    'Authoritarian-Left':  { label: 'Auth-Left',  color: '#ef4444', badge: 'badge-red'   },
    'Authoritarian-Right': { label: 'Auth-Right', color: '#3b82f6', badge: 'badge-blue'  },
    'Libertarian-Left':    { label: 'Lib-Left',   color: '#22c55e', badge: 'badge-green' },
    'Libertarian-Right':   { label: 'Lib-Right',  color: '#f59e0b', badge: 'badge-amber' },
  };
  return map[`${social}-${econ}`] || { label: 'Centrist', color: '#8b5cf6', badge: 'badge-purple' };
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

// -- Avatar helpers --------------------------------------------
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

// -- Profile UI ------------------------------------------------
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

  // Strip skeleton placeholders now that real data is ready
  ['navAvatar', 'navUsername', 'profileAvatar', 'profileName', 'profileUsername', 'bioText', 'profileCountry'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('skel');
      el.style.removeProperty('width');
      el.style.removeProperty('height');
      el.style.removeProperty('display');
      el.style.removeProperty('border-radius');
    }
  });

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

  // Country in sidebar
  const profileCountry   = document.getElementById('profileCountry');
  const countryDisplayRow = document.getElementById('countryDisplayRow');
  if (profileCountry && countryDisplayRow) {
    if (profile.country) {
      const flag = (typeof countryFlag === 'function') ? countryFlag(profile.country) : '';
      profileCountry.textContent     = flag + profile.country;
      profileCountry.style.color     = 'var(--text-2)';
      profileCountry.style.fontStyle = 'normal';
      profileCountry.dataset.raw     = profile.country;
    } else {
      profileCountry.textContent     = 'No country set';
      profileCountry.style.color     = 'var(--text-3)';
      profileCountry.style.fontStyle = 'italic';
      profileCountry.dataset.raw     = '';
    }
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

// -- Helpers ---------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// -- Account management ----------------------------------------
const ACCOUNTS_KEY = 'ao-accounts';

function getAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]'); } catch { return []; }
}

function saveToAccountList({ uid, username, email, avatarUrl, isGoogle }) {
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.uid === uid);
  const rec = { uid, username, email: email || '', avatarUrl: avatarUrl || '', isGoogle: !!isGoogle };
  if (idx >= 0) accounts[idx] = rec; else accounts.push(rec);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function renderAccountDropdown() {
  const list    = document.getElementById('acctList');
  const current = currentUserId;
  const accounts = getAccounts();
  if (!list) return;
  list.innerHTML = '';
  accounts.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'acct-item' + (a.uid === current ? ' active' : '');
    const avatarHtml = a.avatarUrl
      ? `<img src="${escapeHtml(a.avatarUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
      : `<span>${escapeHtml((a.username || 'U')[0].toUpperCase())}</span>`;
    const checkSvg = a.uid === current
      ? `<svg style="width:13px;height:13px;fill:none;stroke:var(--purple);stroke-width:2.5;margin-left:auto;flex-shrink:0" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>` : '';
    btn.innerHTML = `
      <div class="acct-item-avatar">${avatarHtml}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">@${escapeHtml(a.username)}</div>
        ${a.uid === current ? '<div style="font-size:0.7rem;color:var(--text-3)">Current</div>' : ''}
      </div>
      ${checkSvg}
    `;
    if (a.uid !== current) btn.onclick = () => initiateSwitchAccount(a);
    list.appendChild(btn);
  });
}

let _acctDropdownOpen = false;

function closeThemeMenu() {
  const menu = document.getElementById('themeMenu');
  if (menu) menu.style.display = 'none';
}

window.closeAllNavDropdowns = function () {
  closeAccountSwitcher();
  closeNotifDropdown();
  closeThemeMenu();
};

function openAccountSwitcher() {
  const dropdown = document.getElementById('acctDropdown');
  if (!dropdown) return;
  renderAccountDropdown();
  if (_acctDropdownOpen) { dropdown.style.display = 'none'; _acctDropdownOpen = false; return; }
  window.closeAllNavDropdowns();
  dropdown.style.display = 'block';
  _acctDropdownOpen = true;
}

function closeAccountSwitcher() {
  const dropdown = document.getElementById('acctDropdown');
  if (dropdown) dropdown.style.display = 'none';
  _acctDropdownOpen = false;
}

let _switchTarget = null;

function openAddAccountModal() {
  _switchTarget = null;
  closeAccountSwitcher();
  const userInput = document.getElementById('acctModalUser');
  if (userInput) { userInput.readOnly = false; userInput.style.opacity = ''; userInput.value = ''; }
  document.getElementById('acctModalPass').value = '';
  document.getElementById('acctModalTitle').textContent = 'Add another account';
  document.getElementById('acctModalSubmitBtn').textContent = 'Sign In';
  document.getElementById('acctModalErr').style.display = 'none';
  document.getElementById('acctModal').style.display = 'flex';
}

function initiateSwitchAccount(acct) {
  _switchTarget = acct;
  closeAccountSwitcher();
  const userInput = document.getElementById('acctModalUser');
  if (userInput) { userInput.value = acct.username; userInput.readOnly = true; userInput.style.opacity = '0.6'; }
  document.getElementById('acctModalPass').value = '';
  document.getElementById('acctModalTitle').textContent = `Switch to @${acct.username}`;
  document.getElementById('acctModalSubmitBtn').textContent = `Switch to @${acct.username}`;
  document.getElementById('acctModalErr').style.display = 'none';
  document.getElementById('acctModal').style.display = 'flex';
}

function closeAcctModal() {
  document.getElementById('acctModal').style.display = 'none';
  _switchTarget = null;
  const userInput = document.getElementById('acctModalUser');
  if (userInput) { userInput.readOnly = false; userInput.style.opacity = ''; }
}

function _lobbyGetWebViewContext() {
  const ua = navigator.userAgent;
  if (/FBAN\/|FBAV\//.test(ua))              return 'inapp';
  if (/Instagram/.test(ua))                  return 'inapp';
  if (/Twitter\//.test(ua))                  return 'inapp';
  if (/LinkedInApp/.test(ua))               return 'inapp';
  if (/Snapchat|TikTok|musical_ly/.test(ua)) return 'inapp';
  if (/MicroMessenger/.test(ua))             return 'inapp';
  if (/Line\//.test(ua))                     return 'inapp';
  if (/Android/.test(ua) && /; wv\)/.test(ua)) return 'inapp';
  if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua)) return 'inapp';
  if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
  if (window.navigator.standalone === true) return 'standalone';
  return null;
}

async function _finishLobbyGoogleSignIn(result) {
  const user = result.user;
  const doc  = await firestoreDb.collection('users').doc(user.uid).get();
  if (!doc.exists) {
    sessionStorage.setItem('googleAuthPending', JSON.stringify({
      uid: user.uid, displayName: user.displayName || '',
      photoURL: user.photoURL || '', email: user.email || ''
    }));
    window.location.href = '/register?mode=google';
    return;
  }
  const profile = doc.data();
  saveToAccountList({ uid: user.uid, username: profile.username, email: user.email || '', avatarUrl: profile.avatarUrl || user.photoURL || '', isGoogle: true });
  performAccountSwitch(user.uid, profile.username, profile.avatarUrl || user.photoURL || '');
}

// Handle redirect result on lobby load (from WebView/PWA Google sign-in)
auth.getRedirectResult().then(result => {
  if (result && result.user && sessionStorage.getItem('ao-lobby-google-redirect')) {
    sessionStorage.removeItem('ao-lobby-google-redirect');
    _finishLobbyGoogleSignIn(result).catch(() => {});
  }
}).catch(() => {});

async function acctModalGoogleSignIn() {
  const errEl = document.getElementById('acctModalErr');
  const errTx = document.getElementById('acctModalErrText');
  errEl.style.display = 'none';

  // Native Android Google Sign-In via Google Play Services (no SHA-1 needed)
  if (typeof window.AndroidAuth !== 'undefined') {
    try {
      const accessToken = await new Promise((resolve, reject) => {
        window.onAndroidGoogleToken = t => { cleanup(); resolve(t); };
        window.onAndroidGoogleError = c => { cleanup(); reject(c); };
        function cleanup() { window.onAndroidGoogleToken = null; window.onAndroidGoogleError = null; }
        window.AndroidAuth.startGoogleSignIn();
      });
      const credential = firebase.auth.GoogleAuthProvider.credential(null, accessToken);
      const result = await auth.signInWithCredential(credential);
      await _finishLobbyGoogleSignIn(result);
    } catch (err) {
      if (err === 'cancelled') return;
      errTx.textContent = 'Google sign-in failed. Try again.';
      errEl.style.display = 'flex';
    }
    return;
  }

  const ctx = _lobbyGetWebViewContext();
  if (ctx === 'inapp') {
    errTx.textContent = 'Google sign-in isn\'t supported in this browser. Open ArgueOut in Chrome.';
    errEl.style.display = 'flex';
    return;
  }

  const provider = new firebase.auth.GoogleAuthProvider();

  if (ctx === 'standalone') {
    sessionStorage.setItem('ao-lobby-google-redirect', '1');
    await auth.signInWithRedirect(provider);
    return;
  }

  try {
    const result = await auth.signInWithPopup(provider);
    await _finishLobbyGoogleSignIn(result);
  } catch (err) {
    if (err.code === 'auth/popup-blocked') {
      sessionStorage.setItem('ao-lobby-google-redirect', '1');
      await auth.signInWithRedirect(provider);
      return;
    }
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
    errTx.textContent = 'Google sign-in failed: ' + (err.message || err.code);
    errEl.style.display = 'flex';
  }
}

async function acctModalSubmit() {
  const errEl  = document.getElementById('acctModalErr');
  const errTx  = document.getElementById('acctModalErrText');
  const btn    = document.getElementById('acctModalSubmitBtn');
  const input  = (document.getElementById('acctModalUser').value || '').trim();
  const pass   = document.getElementById('acctModalPass').value;
  errEl.style.display = 'none';

  if (!pass) { errTx.textContent = 'Please enter your password.'; errEl.style.display = 'flex'; return; }

  const origText = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<div class="spinner"></div>';

  try {
    let authEmail = _switchTarget?.email || '';
    if (!authEmail) {
      if (input.includes('@')) {
        authEmail = input;
      } else {
        try {
          const snap = await firestoreDb.collection('usernames').doc(input).get();
          authEmail = (snap.exists && snap.data().email) ? snap.data().email : `${input.toLowerCase()}@argueout.app`;
        } catch { authEmail = `${input.toLowerCase()}@argueout.app`; }
      }
    }

    const cred    = await auth.signInWithEmailAndPassword(authEmail, pass);
    const user    = cred.user;
    const doc     = await firestoreDb.collection('users').doc(user.uid).get();
    if (!doc.exists) throw new Error('Profile not found.');
    const profile = doc.data();
    saveToAccountList({ uid: user.uid, username: profile.username, email: authEmail, avatarUrl: profile.avatarUrl || '', isGoogle: false });
    performAccountSwitch(user.uid, profile.username, profile.avatarUrl || '');
  } catch (err) {
    const map = {
      'auth/wrong-password':       'Incorrect password.',
      'auth/user-not-found':       'Account not found.',
      'auth/invalid-credential':   'Incorrect username or password.',
      'auth/too-many-requests':    'Too many attempts. Wait a moment.',
    };
    errTx.textContent = map[err.code] || (err.message || 'Sign-in failed.');
    errEl.style.display = 'flex';
  } finally {
    btn.disabled = false; btn.textContent = origText;
  }
}

function performAccountSwitch(uid, username, avatarUrl) {
  localStorage.setItem('userId',   uid);
  localStorage.setItem('username', username);
  if (avatarUrl) localStorage.setItem('avatarDataUrl', avatarUrl);
  else localStorage.removeItem('avatarDataUrl');
  closeAcctModal();
  window.location.reload();
}

// -- Socket.io (delayed connect until Firebase Auth ready) -----
const socket = io({ autoConnect: false });
let inQueue       = false;
let currentIdToken = null;
let currentUserId  = null;

// -- Online directory / challenge state ------------------------
let onlineUsersCache   = [];
let pendingChallengeFrom = null; // { socketId, userId, username }

socket.on('connect', () => {
  // Always get a fresh token on connect/reconnect — avoids expired-token auth-error
  const user = typeof auth !== 'undefined' && auth.currentUser;
  if (user) {
    user.getIdToken().then(token => {
      currentIdToken = token;
      socket.emit('authenticate', { idToken: token });
    }).catch(() => {
      // Fallback to cached token if refresh fails
      if (currentIdToken) socket.emit('authenticate', { idToken: currentIdToken });
    });
  } else if (currentIdToken) {
    socket.emit('authenticate', { idToken: currentIdToken });
  }
});

socket.on('authenticated', () => {
  if (new URLSearchParams(location.search).get('autoqueue') === '1') {
    history.replaceState({}, '', '/lobby');
    setTimeout(() => socket.emit('join-queue'), 300);
  }
  // Trigger suggestion after socket is confirmed - guarantees user is in onlineUsers
  if (currentIdToken) {
    setTimeout(() => fetchSuggestedOpponent(currentIdToken), 3000);
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
  showToast('Added to queue - searching for an opponent...', 'info');
});

socket.on('queue-left', () => { inQueue = false; showIdle(); });

socket.on('queue-size', ({ size }) => {
  const el = document.getElementById('queueSizeDisplay');
  if (el) el.textContent = size;
});

socket.on('match-found', ({ roomId, opponent }) => {
  inQueue = false;
  // Peak-moment flash - gives the user a satisfying visual before redirect
  const searchCard = document.getElementById('searchCard');
  if (searchCard) searchCard.classList.add('match-found-flash');
  showToast(`Matched with ${opponent.username}!`, 'success');
  localStorage.setItem('debateRoomId',  roomId);
  localStorage.setItem('debateOpponent', JSON.stringify(opponent));
  localStorage.removeItem('debateQuestion');
  setTimeout(() => { window.location.href = `/debate?room=${encodeURIComponent(roomId)}`; }, 600);
});

// -- Online users directory ------------------------------------
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

  list.innerHTML = others.map((u, i) => {
    const avatarHtml = u.avatarUrl
      ? `<img src="${escapeHtml(u.avatarUrl)}" alt="${escapeHtml(u.username)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
      : escapeHtml((u.username || 'U')[0].toUpperCase());
    const info = getQuadrantInfo(u.politicalX || 0, u.politicalY || 0);
    const inDebateChip = u.inDebate
      ? '<span style="font-size:0.7rem;color:var(--amber)">In debate</span>'
      : '';
    return `
      <div class="directory-user-row" style="animation:dirRowEnter 280ms var(--ease-out) ${i * 45}ms both" onclick="openUserProfile('${escapeHtml(u.userId)}')">
        <div class="directory-avatar">${avatarHtml}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(u.name || u.username)}</div>
          <div style="font-size:0.75rem;color:var(--text-3)">@${escapeHtml(u.username)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          ${inDebateChip}
          <span class="badge ${info.badge}" style="font-size:0.6rem;padding:2px 6px">${info.label}</span>
          <button title="Report user" onclick="event.stopPropagation();openReportModal('${escapeHtml(u.userId)}','${escapeHtml(u.username)}','lobby')"
            style="background:none;border:none;cursor:pointer;color:rgba(239,68,68,0.4);padding:4px;display:flex;align-items:center;border-radius:4px;transition:color 150ms,background 150ms"
            onmouseenter="this.style.color='var(--red)';this.style.background='rgba(239,68,68,0.08)'"
            onmouseleave="this.style.color='rgba(239,68,68,0.4)';this.style.background='none'"
            aria-label="Report ${escapeHtml(u.username)}">
            <svg style="width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openUserProfile(userId) {
  const user = onlineUsersCache.find(u => u.userId === userId);
  if (!user) return;

  // Re-trigger entrance animation cleanly
  const upCard = document.getElementById('upCard');
  if (upCard) {
    upCard.classList.remove('entering', 'closing');
    void upCard.offsetWidth; // flush pending styles to restart animation
    upCard.classList.add('entering');
  }

  // Hero blurred background
  const upHeroBg = document.getElementById('upHeroBg');
  if (upHeroBg) {
    upHeroBg.style.backgroundImage = user.avatarUrl
      ? `url(${JSON.stringify(user.avatarUrl)})`
      : '';
  }

  // Avatar
  const upAvatar = document.getElementById('upAvatar');
  if (upAvatar) {
    upAvatar.innerHTML = user.avatarUrl
      ? `<img src="${escapeHtml(user.avatarUrl)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
      : escapeHtml((user.username || 'U')[0].toUpperCase());
  }

  // Name / username
  const upName     = document.getElementById('upName');
  const upUsername = document.getElementById('upUsername');
  if (upName)     upName.textContent     = user.name || user.username;
  if (upUsername) upUsername.textContent = `@${user.username}`;

  // Political badge + online status chip
  const info     = getQuadrantInfo(user.politicalX || 0, user.politicalY || 0);
  const upBadges = document.getElementById('upBadges');
  if (upBadges) {
    const statusChip = user.inDebate
      ? `<span class="up-status-chip in-debate">In debate</span>`
      : `<span class="up-status-chip online">Online</span>`;
    upBadges.innerHTML = `<span class="badge ${info.badge}">${escapeHtml(info.label)}</span>${statusChip}`;
  }

  // Mini compass (draw after modal is painted)
  const upCompass = document.getElementById('upCompass');
  if (upCompass) {
    setTimeout(() => drawMiniCompass(upCompass, user.politicalX || 0, user.politicalY || 0), 60);
  }

  // Bio
  const upBio = document.getElementById('upBio');
  if (upBio) {
    if (user.bio) {
      upBio.textContent   = user.bio;
      upBio.style.display = 'block';
    } else {
      upBio.style.display = 'none';
    }
  }

  // Tags (age, gender, religion)
  const _cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const tags = [];
  if (user.age)                                              tags.push(`${user.age} yrs`);
  if (user.gender   && user.gender   !== 'prefer_not_to_say') tags.push(_cap(user.gender.replace('_', ' ')));
  if (user.religion && user.religion !== 'prefer_not_to_say') tags.push(_cap(user.religion));
  const upTags = document.getElementById('upTags');
  if (upTags) upTags.innerHTML = tags.map(t => `<span class="profile-tag">${escapeHtml(t)}</span>`).join('');

  // Country row in up-card
  const upCountryRow = document.getElementById('upCountryRow');
  const upCountryEl  = document.getElementById('upCountry');
  if (upCountryRow && upCountryEl) {
    if (user.country) {
      const flag = (typeof countryFlag === 'function') ? countryFlag(user.country) : '';
      upCountryEl.textContent       = flag + escapeHtml(user.country);
      upCountryRow.style.display    = 'flex';
    } else {
      upCountryRow.style.display    = 'none';
    }
  }

  // Actions
  const challengeBtn = document.getElementById('challengeBtn');
  const pendingMsg   = document.getElementById('challengePendingMsg');
  const inDebateMsg  = document.getElementById('upInDebateMsg');
  if (pendingMsg)  pendingMsg.style.display  = 'none';
  if (inDebateMsg) inDebateMsg.style.display = 'none';
  if (challengeBtn) {
    if (user.inDebate) {
      challengeBtn.style.display = 'none';
      if (inDebateMsg) inDebateMsg.style.display = 'block';
    } else {
      challengeBtn.style.display = 'flex';
      challengeBtn.onclick = () => sendChallenge(user.userId, user.username);
    }
  }

  // Show report button (hidden for yourself)
  const reportBtn = document.getElementById('reportFromModalBtn');
  const myId = currentUserId || localStorage.getItem('userId');
  if (reportBtn) reportBtn.style.display = user.userId !== myId ? 'flex' : 'none';

  const modal = document.getElementById('userProfileModal');
  if (modal) modal.style.display = 'flex';
}

function closeProfileModal() {
  const upCard = document.getElementById('upCard');
  const modal  = document.getElementById('userProfileModal');
  if (upCard && modal) {
    upCard.classList.remove('entering');
    upCard.classList.add('closing');
    setTimeout(() => {
      modal.style.display = 'none';
      upCard.classList.remove('closing');
    }, 210);
  } else if (modal) {
    modal.style.display = 'none';
  }
}

// -- Challenge system ------------------------------------------
function sendChallenge(targetUserId, targetUsername, question) {
  socket.emit('send-challenge', { targetUserId, question: question || null });
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

let pendingChallengeQuestion = null;

socket.on('challenge-received', ({ from, question }) => {
  pendingChallengeFrom     = from;
  pendingChallengeQuestion = question || null;

  const notifBody = question
    ? `${from.username} challenged you! "${question}"`
    : `${from.username} challenged you to a debate!`;
  addToNotifHistory({
    icon: '⚔️', text: notifBody, type: 'challenge',
    challengerSocketId: from.socketId
  });

  if (Notification.permission === 'granted') {
    new Notification('⚔️ ArgueOut Challenge', {
      body: question ? `${from.username}: "${question}"` : `${from.username} is challenging you to a debate!`,
      icon: '/logo.png'
    });
  }

  const notifText = document.getElementById('challengeNotifText');
  if (notifText) notifText.textContent = `⚔️ ${from.username} challenged you to a debate!`;

  const panel = document.getElementById('challengeNotifPanel');
  if (panel) panel.classList.add('active');

  setTimeout(() => {
    if (panel) panel.classList.remove('active');
    pendingChallengeFrom     = null;
    pendingChallengeQuestion = null;
  }, 30000);
});

socket.on('challenge-accepted', ({ roomId, opponent, question }) => {
  addToNotifHistory({ icon: '✅', text: `${opponent.username} accepted your challenge!` });
  showToast(`Challenge accepted! Starting debate...`, 'success');
  localStorage.setItem('debateRoomId', roomId);
  localStorage.setItem('debateOpponent', JSON.stringify(opponent));
  if (question) localStorage.setItem('debateQuestion', question);
  else          localStorage.removeItem('debateQuestion');
  setTimeout(() => { window.location.href = `/debate?room=${encodeURIComponent(roomId)}`; }, 600);
});

// -- Invite link events ----------------------------------------
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

  addToNotifHistory({ icon: '\u{1F517}', text: `${opponent.username} accepted your invite!` });

  if (Notification.permission === 'granted') {
    new Notification('\u{1F517} ArgueOut Invite', {
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
  pendingChallengeFrom     = null;
  pendingChallengeQuestion = null;
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

// -- UI state --------------------------------------------------
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

// -- Button handlers -------------------------------------------
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

// -- Firebase Auth -> load profile -> connect socket -------------
auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = '/login'; return; }

  try {
    const doc = await firestoreDb.collection('users').doc(user.uid).get();
    if (!doc.exists) { window.location.href = '/login'; return; }

    const profile = doc.data();

    // Redirect banned/timed-out users immediately (check before anything else)
    if (profile.banned) {
      const until = profile.bannedUntil?.toDate ? profile.bannedUntil.toDate() : (profile.bannedUntil ? new Date(profile.bannedUntil) : null);
      if (!until || until > new Date()) { window.location.href = "/banned"; return; }
    }

    if (!profile.compassSet) {
      showToast('Please set your political position first.', 'info');
      setTimeout(() => { window.location.href = '/compass'; }, 1500);
      return;
    }

    currentUserId = user.uid;
    updateProfileUI(profile);

    // Keep the accounts list entry fresh with latest profile data
    saveToAccountList({
      uid:       user.uid,
      username:  profile.username,
      email:     user.email || '',
      avatarUrl: profile.avatarUrl || localStorage.getItem('avatarDataUrl') || '',
      isGoogle:  (user.providerData?.[0]?.providerId === 'google.com'),
    });

    if (profile.isAdmin) {
      const adminBtn = document.getElementById('adminPanelBtn');
      if (adminBtn) adminBtn.style.display = 'flex';
    }

    // Restore persisted admin notifications from localStorage first
    loadAdminNotifsFromStorage(user.uid);

    currentIdToken = await user.getIdToken();
    if (!socket.connected) socket.connect();

    // Request browser notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Suggestion is triggered in socket.on('authenticated') once the socket is confirmed
  } catch {
    showToast('Could not load profile. Check your connection.', 'error');
  }
});

// -- Smart opponent suggestion ---------------------------------
let suggestUserId   = null;
let suggestUsername = null;
let suggestQuestion = null;

function _suggKey() { return 'ao_sugg_' + (currentUserId || localStorage.getItem('userId') || ''); }
function getSuggestedIds() {
  try { return new Set(JSON.parse(localStorage.getItem(_suggKey()) || '[]')); } catch { return new Set(); }
}
function recordSuggested(userId) {
  try {
    const s = getSuggestedIds(); s.add(userId);
    localStorage.setItem(_suggKey(), JSON.stringify([...s]));
  } catch {}
}

async function fetchSuggestedOpponent(token) {
  if (inQueue) return;
  try {
    const res  = await fetch('/api/suggest-opponent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token, seenUserIds: [...getSuggestedIds()] })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('[ArgueOut] suggest-opponent failed:', res.status, body.error || '');
      return;
    }
    const data = await res.json();
    if (!data.username) { console.warn('[ArgueOut] suggest-opponent: no username in response', data); return; }
    showSuggestCard(data);
  } catch (e) { console.warn('[ArgueOut] suggest-opponent error:', e); }
}

function showSuggestCard(data) {
  const card = document.getElementById('suggestCard');
  if (!card) return;

  suggestUserId   = data.userId;
  suggestUsername = data.username;
  suggestQuestion = data.question || null;
  recordSuggested(data.userId);

  const _name = data.name || data.username;
  const _reason = data.reason || 'completely different worldview';
  const _notifText = data.question
    ? `You should debate ${_name} - ${_reason}. ${data.question}`
    : `You should debate ${_name} - ${_reason}.`;
  addToNotifHistory({
    icon: '\u{1F4A1}', text: _notifText, type: 'suggest',
    userId: data.userId, username: data.username, question: data.question || null
  });

  // Avatar
  const av = document.getElementById('suggestAvatar');
  if (av) {
    if (data.avatarUrl) {
      av.style.backgroundImage = `url(${data.avatarUrl})`;
      av.style.backgroundSize  = 'cover';
      av.textContent = '';
    } else {
      av.style.backgroundImage = '';
      av.textContent = (data.name || data.username || '?')[0].toUpperCase();
    }
  }

  const nameEl = document.getElementById('suggestName');
  const userEl = document.getElementById('suggestUsername');
  const tagsEl = document.getElementById('suggestTags');
  const rsn    = document.getElementById('suggestReason');
  const qEl    = document.getElementById('suggestQuestion');

  if (nameEl) nameEl.textContent = data.name || data.username;
  if (userEl) userEl.textContent = '@' + data.username;

  if (tagsEl) {
    tagsEl.innerHTML = (data.tags || []).map(t =>
      `<span class="suggest-tag">${escapeHtml(t)}</span>`
    ).join('');
  }

  if (rsn)  rsn.textContent  = data.reason   || '';
  if (qEl)  qEl.textContent  = data.question || '';

  card.classList.remove('suggest-hiding');
  card.classList.add('suggest-visible');
}

function hideSuggestCard() {
  const card = document.getElementById('suggestCard');
  if (!card) return;
  card.classList.remove('suggest-visible');
  card.classList.add('suggest-hiding');
  setTimeout(() => { card.classList.remove('suggest-hiding'); }, 260);
  suggestUserId   = null;
  suggestUsername = null;
  suggestQuestion = null;
}

document.addEventListener('DOMContentLoaded', function () {
  const closeBtn     = document.getElementById('suggestClose');
  const dismissBtn   = document.getElementById('suggestDismissBtn');
  const challengeBtn = document.getElementById('suggestChallengeBtn');

  if (closeBtn)     closeBtn.addEventListener('click', hideSuggestCard);
  if (dismissBtn)   dismissBtn.addEventListener('click', hideSuggestCard);
  if (challengeBtn) challengeBtn.addEventListener('click', function () {
    if (suggestUserId) {
      sendChallenge(suggestUserId, suggestUsername || '', suggestQuestion);
    }
    hideSuggestCard();
  });
});

// -- Notification history & dropdown --------------------------
let notifHistory = [];
let notifDropdownOpen = false;
let _adminNotifStorageKey = null;

function saveAdminNotifsToStorage(uid) {
  if (!uid) return;
  const key = 'ao_admin_notifs_' + uid;
  const adminNotifs = notifHistory.filter(n => n.fromAdmin);
  try { localStorage.setItem(key, JSON.stringify(adminNotifs)); } catch {}
}

function loadAdminNotifsFromStorage(uid) {
  if (!uid) return;
  _adminNotifStorageKey = 'ao_admin_notifs_' + uid;
  try {
    const raw = localStorage.getItem(_adminNotifStorageKey);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return;
    saved.forEach(n => {
      notifHistory.push({ ...n, read: true });
    });
    refreshNotifBadge();
  } catch {}
}

function addToNotifHistory(notif) {
  notifHistory.unshift({ ...notif, time: new Date().toISOString(), read: false });
  if (notifHistory.length > 50) notifHistory.pop();
  refreshNotifBadge();
  if (notifDropdownOpen) renderNotifList();
  if (notif.fromAdmin) {
    const storageKey = _adminNotifStorageKey || (currentUserId ? 'ao_admin_notifs_' + currentUserId : null);
    if (storageKey) {
      try {
        const adminNotifs = notifHistory.filter(n => n.fromAdmin);
        localStorage.setItem(storageKey, JSON.stringify(adminNotifs));
      } catch {}
    }
  }
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
  list.innerHTML = notifHistory.map((n, i) => {
    const timeStr = new Date(n.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let actionHtml = '';
    if (n.type === 'challenge') {
      const isPending = pendingChallengeFrom && pendingChallengeFrom.socketId === n.challengerSocketId;
      if (isPending) {
        actionHtml = `<div class="notif-item-actions">
          <button class="notif-action-btn notif-action-accept" onclick="notifAcceptChallenge(event)">Accept</button>
          <button class="notif-action-btn notif-action-decline" onclick="notifDeclineChallenge(event)">Decline</button>
        </div>`;
      }
    } else if (n.type === 'suggest' && n.userId) {
      actionHtml = `<div class="notif-item-actions">
        <button class="notif-action-btn notif-action-challenge" onclick="notifChallengeSuggest(event,${i})">Challenge</button>
      </div>`;
    }
    const iconHtml = n.fromAdmin
      ? '<span style="font-size:0.62rem;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(139,92,246,0.2);color:var(--purple);letter-spacing:0.04em">ADMIN</span>'
      : (n.icon ? escapeHtml(n.icon) : '');
    return `<div class="notif-item${n.read ? '' : ' unread'}">
      <span class="notif-item-icon">${iconHtml}</span>
      <div class="notif-item-body">
        <div class="notif-item-text">${escapeHtml(n.text || '')}</div>
        <div class="notif-item-time">${timeStr}</div>
        ${actionHtml}
      </div>
    </div>`;
  }).join('');
}

function notifChallengeSuggest(e, idx) {
  e.stopPropagation();
  const n = notifHistory[idx];
  if (!n || !n.userId) return;
  sendChallenge(n.userId, n.username || '', n.question || null);
  closeNotifDropdown();
}

function notifAcceptChallenge(e) {
  e.stopPropagation();
  if (!pendingChallengeFrom) return;
  socket.emit('accept-challenge', { challengerSocketId: pendingChallengeFrom.socketId });
  dismissChallengeNotif();
  closeNotifDropdown();
}

function notifDeclineChallenge(e) {
  e.stopPropagation();
  if (pendingChallengeFrom) socket.emit('reject-challenge', { challengerSocketId: pendingChallengeFrom.socketId });
  dismissChallengeNotif();
  closeNotifDropdown();
}

function openNotifDropdown() {
  const dropdown = document.getElementById('notifDropdown');
  if (!dropdown) return;
  window.closeAllNavDropdowns();
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
  if (_adminNotifStorageKey) {
    try { localStorage.removeItem(_adminNotifStorageKey); } catch {}
  }
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
  if (_acctDropdownOpen) {
    const acctDd   = document.getElementById('acctDropdown');
    const navUser  = document.querySelector('.nav-user');
    if (acctDd && !acctDd.contains(e.target) && !navUser?.contains(e.target)) {
      closeAccountSwitcher();
    }
  }
  if (!notifDropdownOpen) return;
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown && !dropdown.contains(e.target) && !notifBtn?.contains(e.target)) {
    closeNotifDropdown();
  }
});

// -- Bio edit --------------------------------------------------
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
    const token = await user.getIdToken();
    const r = await fetch('/api/profile/bio', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ bio: newBio }) });
    if (!r.ok) throw new Error('Failed');
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

// -- Name edit --------------------------------------------------
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
    const token = await user.getIdToken();
    const r = await fetch('/api/profile/name', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ name: newName }) });
    if (!r.ok) throw new Error('Failed');
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

// -- Username edit ----------------------------------------------
function startUsernameEdit() {
  const usernameEl = document.getElementById('profileUsername');
  const current    = (usernameEl?.textContent || '').replace(/^@/, '');
  document.getElementById('usernameDisplayRow').style.display = 'none';
  document.getElementById('usernameEditRow').style.display    = 'block';
  const input = document.getElementById('usernameInput');
  if (input) { input.value = current; input.focus(); }
  // Show password field only for password-based accounts
  const user = auth.currentUser;
  const isPasswordAccount = user && user.email && user.email.endsWith('@argueout.app');
  const pwRow = document.getElementById('usernamePasswordRow');
  if (pwRow) pwRow.style.display = isPasswordAccount ? 'block' : 'none';
}

function cancelUsernameEdit() {
  document.getElementById('usernameDisplayRow').style.display = 'flex';
  document.getElementById('usernameEditRow').style.display    = 'none';
  const pwInput = document.getElementById('usernamePasswordInput');
  if (pwInput) pwInput.value = '';
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
    showToast('Username: 3-20 chars, letters/numbers/underscore only.', 'error');
    return;
  }
  if (newUsername === oldUsername) { cancelUsernameEdit(); return; }

  // Password accounts must confirm with current password before changing username
  const isPasswordAccount = user.email && user.email.endsWith('@argueout.app');
  if (isPasswordAccount) {
    const pwInput = document.getElementById('usernamePasswordInput');
    const pw = pwInput ? pwInput.value : '';
    if (!pw) { showToast('Enter your current password to confirm.', 'error'); pwInput && pwInput.focus(); return; }
    try {
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, pw);
      await user.reauthenticateWithCredential(credential);
    } catch {
      showToast('Incorrect password.', 'error');
      const pwInput2 = document.getElementById('usernamePasswordInput');
      if (pwInput2) { pwInput2.value = ''; pwInput2.focus(); }
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const token = await user.getIdToken();
    const r = await fetch('/api/profile/username', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ username: newUsername, oldUsername }) });
    if (r.status === 409) { showToast('Username already taken. Try another.', 'error'); return; }
    if (!r.ok) throw new Error('Failed');

    localStorage.setItem('username', newUsername);
    const usernameEl = document.getElementById('profileUsername');
    const navUname   = document.getElementById('navUsername');
    if (usernameEl) usernameEl.textContent = `@${newUsername}`;
    if (navUname)   navUname.textContent   = newUsername;
    cancelUsernameEdit();
    showToast('Username updated!', 'success');
  } catch {
    showToast('Could not update username. Try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// -- Country edit ---------------------------------------------
function startCountryEdit() {
  const display = document.getElementById('countryDisplayRow');
  const edit    = document.getElementById('countryEditRow');
  if (!display || !edit) return;
  display.style.display = 'none';
  edit.style.display    = 'block';

  // Pre-fill with current value
  const current = document.getElementById('profileCountry');
  if (current && typeof setCountryPickerValue === 'function') {
    const name = current.dataset.raw || '';
    setCountryPickerValue('sidebarCountrySearch', 'sidebarCountry', name);
  }
  const inp = document.getElementById('sidebarCountrySearch');
  if (inp) setTimeout(() => inp.focus(), 50);
}

function cancelCountryEdit() {
  document.getElementById('countryDisplayRow').style.display = 'flex';
  document.getElementById('countryEditRow').style.display    = 'none';
}

async function saveCountry() {
  const btn  = document.getElementById('saveCountryBtn');
  const val  = (document.getElementById('sidebarCountry') || {}).value || '';
  const user = firebase.auth().currentUser;
  if (!user) return;

  btn.disabled    = true;
  btn.textContent = 'Saving...';
  try {
    const token = await user.getIdToken();
    const r = await fetch('/api/profile/country', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ country: val }) });
    if (!r.ok) throw new Error('Failed');
    if (socket) socket.emit('update-country', { country: val });

    const profileCountry = document.getElementById('profileCountry');
    if (profileCountry) {
      if (val) {
        const flag = (typeof countryFlag === 'function') ? countryFlag(val) : '';
        profileCountry.textContent   = flag + val;
        profileCountry.style.color   = 'var(--text-2)';
        profileCountry.style.fontStyle = 'normal';
        profileCountry.dataset.raw   = val;
      } else {
        profileCountry.textContent   = 'No country set';
        profileCountry.style.color   = 'var(--text-3)';
        profileCountry.style.fontStyle = 'italic';
        profileCountry.dataset.raw   = '';
      }
    }
    cancelCountryEdit();
    showToast('Country updated.', 'success');
  } catch {
    showToast('Could not update country. Try again.', 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Save';
  }
}

// -- Profile picture change ------------------------------------
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
        const token = await user.getIdToken();
        const r = await fetch('/api/profile/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ avatarUrl: compressed }) });
        if (!r.ok) throw new Error('Failed');
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

// -- Ban + admin notification handlers ------------------------
socket.on('account-banned', ({ message, until }) => {
  // Redirect to /banned — that page shows local-timezone countdown
  window.location.href = '/banned';
});

socket.on('admin-notification', ({ message }) => {
  addToNotifHistory({ icon: null, text: message, type: 'admin', fromAdmin: true });
  showToast('You have a new message.', 'info');
  if (Notification.permission === 'granted') {
    new Notification('ArgueOut - New Message', { body: message, icon: '/logo.png' });
  }
});

// Pending messages delivered on socket auth (offline delivery via Firestore)
socket.on('admin-notifications-pending', ({ messages }) => {
  if (!Array.isArray(messages) || !messages.length) return;
  messages.forEach(message => {
    if (!notifHistory.some(n => n.fromAdmin && n.text === message)) {
      addToNotifHistory({ icon: null, text: message, type: 'admin', fromAdmin: true });
    }
  });
  const count = messages.length;
  showToast(count === 1 ? 'You have a pending message.' : `You have ${count} pending messages.`, 'info');
});

// -- Report modal (lobby) --------------------------------------
let _reportTargetId  = null;
let _reportTargetName = null;

function openReportModal(userId, username, location) {
  _reportTargetId   = userId;
  _reportTargetName = username;
  _reportLocation   = location || 'lobby';
  const modal = document.getElementById('reportModal');
  const card  = document.getElementById('reportCard');
  const nameEl = document.getElementById('reportTargetName');
  const errEl  = document.getElementById('reportModalError');
  const otherWrap = document.getElementById('reportOtherWrap');
  if (nameEl)    nameEl.textContent    = `@${username}`;
  if (errEl)     errEl.style.display   = 'none';
  if (otherWrap) otherWrap.style.display = 'none';
  document.querySelectorAll('input[name="reportReason"]').forEach(r => { r.checked = false; });
  if (card) { card.classList.remove('entering', 'closing'); void card.offsetWidth; card.classList.add('entering'); }
  if (modal) modal.style.display = 'flex';
}

function closeReportModal() {
  const modal = document.getElementById('reportModal');
  const card  = document.getElementById('reportCard');
  if (card && modal) {
    card.classList.remove('entering');
    card.classList.add('closing');
    setTimeout(() => { modal.style.display = 'none'; card.classList.remove('closing'); }, 210);
  } else if (modal) {
    modal.style.display = 'none';
  }
  _reportTargetId   = null;
  _reportTargetName = null;
}

function reportFromModal() {
  const user = onlineUsersCache.find(u => {
    const modal = document.getElementById('userProfileModal');
    const nameEl = document.getElementById('upUsername');
    return nameEl && u.username === (nameEl.textContent || '').replace(/^@/, '');
  });
  if (!user) return;
  closeProfileModal();
  openReportModal(user.userId, user.username, 'lobby');
}

function submitReport() {
  const selected = document.querySelector('input[name="reportReason"]:checked');
  const errEl    = document.getElementById('reportModalError');
  const otherWrap = document.getElementById('reportOtherWrap');
  if (!selected) {
    errEl.textContent = 'Please select a reason.';
    errEl.style.display = 'block';
    return;
  }
  let reason = selected.value;
  if (reason === '__other__') {
    const custom = (document.getElementById('reportOtherInput')?.value || '').trim();
    if (!custom) {
      errEl.textContent = 'Please describe the reason.';
      errEl.style.display = 'block';
      return;
    }
    reason = custom;
  }
  const btn = document.getElementById('submitReportBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  socket.emit('report-user', {
    reportedUserId:   _reportTargetId,
    reportedUsername: _reportTargetName,
    reason,
    location: _reportLocation || 'lobby'
  });
  socket.once('report-sent', () => {
    closeReportModal();
    showToast('Report submitted. Thank you.', 'success');
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Report'; }
  });
}

// Show "other" input when "Other..." is selected
document.addEventListener('change', e => {
  if (e.target.name === 'reportReason') {
    const otherWrap = document.getElementById('reportOtherWrap');
    if (otherWrap) otherWrap.style.display = e.target.value === '__other__' ? 'block' : 'none';
  }

});

function openAdminPanel() {
  window.location.href = '/admin';
}

async function requestDeletion() {
  const btn      = document.getElementById('requestDeleteBtn');
  const statusEl = document.getElementById('requestDeleteStatus');
  if (!btn) return;
  const user = auth.currentUser;
  if (!user) return;
  if (!confirm('Request account deletion?\n\nYour request will be reviewed by an admin. Once approved your account and all data will be permanently removed. This cannot be undone.')) return;
  btn.disabled = true;
  statusEl.style.display = 'none';
  try {
    const token = await user.getIdToken();
    const res   = await fetch('/api/request-deletion', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
    const data  = await res.json();
    if (!res.ok) {
      statusEl.textContent   = data.error || 'Error sending request.';
      statusEl.style.color   = 'var(--red, #ef4444)';
      statusEl.style.display = 'block';
      btn.disabled = false;
      return;
    }
    btn.textContent        = 'Deletion Requested ✓';
    statusEl.textContent   = 'Your request has been sent to the admin for review.';
    statusEl.style.color   = 'var(--text-3)';
    statusEl.style.display = 'block';
  } catch {
    statusEl.textContent   = 'Network error. Please try again.';
    statusEl.style.color   = 'var(--red, #ef4444)';
    statusEl.style.display = 'block';
    btn.disabled = false;
  }
}
