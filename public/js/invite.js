/* invite.js — handles /invite?token=... page */

const token = new URLSearchParams(location.search).get('token');

function showState(id) {
  ['loadingState','invalidState','loginPromptState','inviteState','joiningState']
    .forEach(s => { const el = document.getElementById(s); if (el) el.style.display = s === id ? 'block' : 'none'; });
}

function formatExpiry(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'Expired';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `Expires in ${m}m ${s}s` : `Expires in ${s}s`;
}

if (!token) {
  showState('invalidState');
  const msg = document.getElementById('invalidMsg');
  if (msg) msg.textContent = 'No invite token found in the URL.';
} else {
  // Check invite validity first (no auth needed)
  fetch(`/api/invite/${encodeURIComponent(token)}`)
    .then(r => r.json())
    .then(data => {
      if (!data.valid) {
        showState('invalidState');
        return;
      }
      // Update UI with host info
      ['inviteHostName','loginHostName'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = data.hostUsername;
      });
      const expireStr = formatExpiry(data.expiresAt);
      ['inviteExpireText','loginExpireText'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = expireStr;
      });

      // Live expiry countdown
      const countdown = setInterval(() => {
        const str = formatExpiry(data.expiresAt);
        ['inviteExpireText','loginExpireText'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.textContent = str;
        });
        if (data.expiresAt <= Date.now()) {
          clearInterval(countdown);
          showState('invalidState');
        }
      }, 1000);

      // Build login/register URLs with ?next= so the user returns after auth
      const nextUrl = encodeURIComponent(location.pathname + location.search);
      const loginBtn = document.getElementById('loginToAcceptBtn');
      const regBtn   = document.getElementById('registerToAcceptBtn');
      if (loginBtn) loginBtn.href = `/login?next=${nextUrl}`;
      if (regBtn)   regBtn.href   = `/register?next=${nextUrl}`;

      // Now check if user is already logged in
      auth.onAuthStateChanged(async (user) => {
        if (!user) {
          showState('loginPromptState');
          return;
        }
        showState('inviteState');
        setupSocket(user);
      });
    })
    .catch(() => showState('invalidState'));
}

let socket = null;

function setupSocket(user) {
  socket = io({ autoConnect: false });

  socket.on('connect', async () => {
    const idToken = await user.getIdToken();
    socket.emit('authenticate', { idToken });
  });

  socket.on('authenticated', () => {
    // Socket is ready — wait for user to click Accept
    const btn = document.getElementById('acceptBtn');
    if (btn) {
      btn.disabled = false;
      btn.addEventListener('click', () => {
        showState('joiningState');
        socket.emit('accept-invite', { token });
      });
    }
  });

  let pendingRoomId = null, pendingOpponent = null;

  socket.on('invite-waiting', ({ roomId, opponent }) => {
    pendingRoomId   = roomId;
    pendingOpponent = opponent;
    const title = document.getElementById('joiningTitle');
    const sub   = document.getElementById('joiningSubtitle');
    if (title) title.textContent = 'Invite Sent!';
    if (sub)   sub.textContent   = 'Waiting for the host to join...';
    showState('joiningState');
  });

  socket.on('invite-start', ({ roomId }) => {
    const rid = roomId || pendingRoomId;
    if (!rid) return;
    localStorage.setItem('debateRoomId', rid);
    localStorage.setItem('debateOpponent', JSON.stringify(pendingOpponent || {}));
    localStorage.setItem('username', user.displayName || localStorage.getItem('username') || 'You');
    window.location.href = `/debate?room=${encodeURIComponent(rid)}`;
  });

  socket.on('invite-error', ({ error }) => {
    showState('inviteState');
    const errEl = document.getElementById('inviteError');
    if (errEl) { errEl.textContent = error; errEl.style.display = 'block'; }
  });

  socket.on('auth-error', () => {
    showState('loginPromptState');
  });

  socket.connect();
}
