/* account-switcher.js — reusable "switch / add account" dropdown + modal.
   Used on pages other than /lobby (which has its own integrated copy).
   Requires firebase-init.js (auth, firestoreDb) loaded first, and these
   elements present in the page: #acctDropdown, #acctList, #acctModal,
   #acctModalUser, #acctModalPass, #acctModalTitle, #acctModalSubmitBtn,
   #acctModalErr, #acctModalErrText. */

const ACCT_SW_KEY = 'ao-accounts';

function acctSwEscapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function acctSwGetAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCT_SW_KEY) || '[]'); } catch { return []; }
}

function acctSwSaveAccount({ uid, username, email, avatarUrl, isGoogle }) {
  const accounts = acctSwGetAccounts();
  const idx = accounts.findIndex(a => a.uid === uid);
  const rec = { uid, username, email: email || '', avatarUrl: avatarUrl || '', isGoogle: !!isGoogle };
  if (idx >= 0) accounts[idx] = rec; else accounts.push(rec);
  localStorage.setItem(ACCT_SW_KEY, JSON.stringify(accounts));
}

function acctSwRenderDropdown() {
  const list    = document.getElementById('acctList');
  if (!list) return;
  const current  = localStorage.getItem('userId') || '';
  const accounts = acctSwGetAccounts();
  list.innerHTML = '';
  accounts.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'acct-item' + (a.uid === current ? ' active' : '');
    const avatarHtml = a.avatarUrl
      ? `<img src="${acctSwEscapeHtml(a.avatarUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
      : `<span>${acctSwEscapeHtml((a.username || 'U')[0].toUpperCase())}</span>`;
    const checkSvg = a.uid === current
      ? `<svg style="width:13px;height:13px;fill:none;stroke:var(--purple);stroke-width:2.5;margin-left:auto;flex-shrink:0" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>` : '';
    btn.innerHTML = `
      <div class="acct-item-avatar">${avatarHtml}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">@${acctSwEscapeHtml(a.username)}</div>
        ${a.uid === current ? '<div style="font-size:0.7rem;color:var(--text-3)">Current</div>' : ''}
      </div>
      ${checkSvg}
    `;
    if (a.uid !== current) btn.onclick = () => acctSwInitiateSwitch(a);
    list.appendChild(btn);
  });
}

let _acctSwOpen = false;

function openAccountSwitcher() {
  const dropdown = document.getElementById('acctDropdown');
  if (!dropdown) return;
  acctSwRenderDropdown();
  if (_acctSwOpen) { dropdown.style.display = 'none'; _acctSwOpen = false; return; }
  dropdown.style.display = 'block';
  _acctSwOpen = true;
}

function closeAccountSwitcher() {
  const dropdown = document.getElementById('acctDropdown');
  if (dropdown) dropdown.style.display = 'none';
  _acctSwOpen = false;
}

let _acctSwTarget = null;

function openAddAccountModal() {
  _acctSwTarget = null;
  closeAccountSwitcher();
  const userInput = document.getElementById('acctModalUser');
  if (userInput) { userInput.readOnly = false; userInput.style.opacity = ''; userInput.value = ''; }
  document.getElementById('acctModalPass').value = '';
  document.getElementById('acctModalTitle').textContent = 'Add another account';
  document.getElementById('acctModalSubmitBtn').textContent = 'Sign In';
  document.getElementById('acctModalErr').style.display = 'none';
  document.getElementById('acctModal').style.display = 'flex';
}

function acctSwInitiateSwitch(acct) {
  _acctSwTarget = acct;
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
  const modal = document.getElementById('acctModal');
  if (modal) modal.style.display = 'none';
  _acctSwTarget = null;
  const userInput = document.getElementById('acctModalUser');
  if (userInput) { userInput.readOnly = false; userInput.style.opacity = ''; }
}

function acctSwPerformSwitch(uid, username, avatarUrl) {
  localStorage.setItem('userId', uid);
  localStorage.setItem('username', username);
  if (avatarUrl) localStorage.setItem('avatarDataUrl', avatarUrl);
  else localStorage.removeItem('avatarDataUrl');
  closeAcctModal();
  window.location.reload();
}

async function acctModalSubmit() {
  const errEl = document.getElementById('acctModalErr');
  const errTx = document.getElementById('acctModalErrText');
  const btn   = document.getElementById('acctModalSubmitBtn');
  const input = (document.getElementById('acctModalUser').value || '').trim();
  const pass  = document.getElementById('acctModalPass').value;
  errEl.style.display = 'none';

  if (!pass) { errTx.textContent = 'Please enter your password.'; errEl.style.display = 'flex'; return; }

  const origText = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<div class="spinner"></div>';

  try {
    let authEmail = _acctSwTarget?.email || '';
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

    const cred = await auth.signInWithEmailAndPassword(authEmail, pass);
    const user = cred.user;
    const doc  = await firestoreDb.collection('users').doc(user.uid).get();
    if (!doc.exists) throw new Error('Profile not found.');
    const profile = doc.data();
    acctSwSaveAccount({ uid: user.uid, username: profile.username, email: authEmail, avatarUrl: profile.avatarUrl || '', isGoogle: false });
    acctSwPerformSwitch(user.uid, profile.username, profile.avatarUrl || '');
  } catch (err) {
    const map = {
      'auth/wrong-password':     'Incorrect password.',
      'auth/user-not-found':     'Account not found.',
      'auth/invalid-credential': 'Incorrect username or password.',
      'auth/too-many-requests':  'Too many attempts. Wait a moment.',
    };
    errTx.textContent = map[err.code] || (err.message || 'Sign-in failed.');
    errEl.style.display = 'flex';
  } finally {
    btn.disabled = false; btn.textContent = origText;
  }
}

async function _acctSwFinishGoogleSignIn(result) {
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
  acctSwSaveAccount({ uid: user.uid, username: profile.username, email: user.email || '', avatarUrl: profile.avatarUrl || user.photoURL || '', isGoogle: true });
  acctSwPerformSwitch(user.uid, profile.username, profile.avatarUrl || user.photoURL || '');
}

function _acctSwWebViewContext() {
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

auth.getRedirectResult().then(result => {
  if (result && result.user && sessionStorage.getItem('ao-acctsw-google-redirect')) {
    sessionStorage.removeItem('ao-acctsw-google-redirect');
    _acctSwFinishGoogleSignIn(result).catch(() => {});
  }
}).catch(() => {});

async function acctModalGoogleSignIn() {
  const errEl = document.getElementById('acctModalErr');
  const errTx = document.getElementById('acctModalErrText');
  errEl.style.display = 'none';

  // Native Android Google Sign-In: device account picker, ID token flow
  if (typeof window.AndroidAuth !== 'undefined') {
    try {
      const r = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${firebase.app().options.apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId: 'google.com', continueUri: location.origin }) }
      );
      const d = await r.json();
      const clientId = new URL(d.authUri).searchParams.get('client_id');
      if (!clientId) throw new Error('no-client-id');

      const idToken = await new Promise((resolve, reject) => {
        window.onAndroidGoogleToken = t => { cleanup(); resolve(t); };
        window.onAndroidGoogleError = c => { cleanup(); reject(c); };
        function cleanup() { window.onAndroidGoogleToken = null; window.onAndroidGoogleError = null; }
        window.AndroidAuth.startGoogleSignIn(clientId);
      });
      const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
      const result = await auth.signInWithCredential(credential);
      await _acctSwFinishGoogleSignIn(result);
    } catch (err) {
      if (err === 'cancelled') return;
      const detail = (err && err.code) ? err.code : (typeof err === 'string' ? err : (err && err.message));
      errTx.textContent = detail ? `Google sign-in failed: ${detail}` : 'Google sign-in failed. Try again.';
      errEl.style.display = 'flex';
    }
    return;
  }

  const ctx = _acctSwWebViewContext();
  if (ctx === 'inapp') {
    errTx.textContent = 'Google sign-in isn\'t supported in this browser. Open ArgueOut in Chrome.';
    errEl.style.display = 'flex';
    return;
  }

  const provider = new firebase.auth.GoogleAuthProvider();

  if (ctx === 'standalone') {
    sessionStorage.setItem('ao-acctsw-google-redirect', '1');
    await auth.signInWithRedirect(provider);
    return;
  }

  try {
    const result = await auth.signInWithPopup(provider);
    await _acctSwFinishGoogleSignIn(result);
  } catch (err) {
    if (err.code === 'auth/popup-blocked') {
      sessionStorage.setItem('ao-acctsw-google-redirect', '1');
      await auth.signInWithRedirect(provider);
      return;
    }
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
    errTx.textContent = 'Google sign-in failed: ' + (err.message || err.code);
    errEl.style.display = 'flex';
  }
}

document.addEventListener('click', e => {
  if (!_acctSwOpen) return;
  const dd = document.getElementById('acctDropdown');
  const trigger = document.getElementById('acctSwitcherTrigger');
  if (dd && !dd.contains(e.target) && !trigger?.contains(e.target)) closeAccountSwitcher();
});
