/* auth.js — Firebase Auth for login.html and register.html */

// ── Account list (shared with lobby.js) ───────────────────────
function _saveAcctList({ uid, username, email, avatarUrl, isGoogle }) {
  try {
    const list = JSON.parse(localStorage.getItem('ao-accounts') || '[]');
    const idx  = list.findIndex(a => a.uid === uid);
    const rec  = { uid, username, email: email || '', avatarUrl: avatarUrl || '', isGoogle: !!isGoogle };
    if (idx >= 0) list[idx] = rec; else list.push(rec);
    localStorage.setItem('ao-accounts', JSON.stringify(list));
  } catch {}
}

// ── Utilities ─────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons  = { success: '✓', error: '✕', info: 'ℹ' };
  const colors = { success: 'var(--green)', error: 'var(--red)', info: 'var(--purple)' };
  const toast  = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon" style="color:${colors[type]}">${icons[type]}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function showError(elId, textId, msg) {
  const el = document.getElementById(elId);
  const tx = document.getElementById(textId);
  if (!el || !tx) return;
  tx.textContent = msg;
  el.style.display = 'flex';
}

function hideError(elId) {
  const el = document.getElementById(elId);
  if (el) el.style.display = 'none';
}

function setLoading(btn, loading, label = 'Please wait...') {
  btn.disabled = loading;
  if (loading) {
    btn._origText = btn.innerHTML;
    btn.innerHTML = `<div class="spinner"></div> ${label}`;
  } else {
    btn.innerHTML = btn._origText || btn.innerHTML;
  }
}

function friendlyError(code) {
  const map = {
    'auth/email-already-in-use':  'An account with this email already exists. Try signing in instead.',
    'auth/invalid-email':         'Invalid email address.',
    'auth/weak-password':         'Password too weak — use at least 6 characters.',
    'auth/user-not-found':        'Invalid username, email, or password.',
    'auth/wrong-password':        'Invalid username, email, or password.',
    'auth/invalid-credential':    'Invalid username, email, or password.',
    'auth/too-many-requests':     'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed':'Network error. Check your internet connection.',
  };
  return map[code] || `Authentication error (${code})`;
}

// Firebase Auth uses email — we map username → fake email internally
function fakeEmail(username) {
  return `${username.toLowerCase().replace(/[^a-z0-9_]/g, '')}@argueout.app`;
}

// ── Image compression (96×96 JPEG) ───────────────────────────
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

// ── Cloudflare Turnstile ──────────────────────────────────────

async function verifyCaptcha(widgetId) {
  const widget = document.getElementById(widgetId);
  if (!widget) return true; // not present on this page — skip
  const input = widget.querySelector('[name="cf-turnstile-response"]');
  const token = input?.value;
  if (!token) return false;
  try {
    const r = await fetch('/api/verify-captcha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const d = await r.json();
    return d.success === true;
  } catch {
    return false;
  }
}

function resetCaptcha() {
  if (typeof turnstile !== 'undefined') turnstile.reset();
}

// ── Google Sign-In ────────────────────────────────────────────

async function handleGoogleSignIn(btnId) {
  const btn = btnId ? document.getElementById(btnId) : null;
  if (btn) setLoading(btn, true, 'Connecting...');

  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result   = await auth.signInWithPopup(provider);
    const user     = result.user;

    const doc = await firestoreDb.collection('users').doc(user.uid).get();

    if (doc.exists) {
      const profile = doc.data();
      localStorage.setItem('username', profile.username);
      localStorage.setItem('userId',   user.uid);
      if (profile.avatarUrl) localStorage.setItem('avatarDataUrl', profile.avatarUrl);
      _saveAcctList({ uid: user.uid, username: profile.username, email: user.email || '', avatarUrl: profile.avatarUrl || user.photoURL || '', isGoogle: true });
      showToast('Welcome back!', 'success');
      setTimeout(() => {
        const next = new URLSearchParams(location.search).get('next');
        window.location.href = next || (profile.compassSet ? '/lobby' : '/compass');
      }, 600);
    } else {
      // New Google user — send them through the full register form
      sessionStorage.setItem('googleAuthPending', JSON.stringify({
        uid:         user.uid,
        displayName: user.displayName || '',
        photoURL:    user.photoURL    || '',
        email:       user.email       || ''
      }));
      if (btn) setLoading(btn, false);
      window.location.href = '/register?mode=google';
    }
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      showToast(friendlyError(err.code) || 'Google sign-in failed. Try again.', 'error');
    }
    if (btn) setLoading(btn, false);
  }
}

// ── Avatar preview (register page) ───────────────────────────

const avatarInput = document.getElementById('avatarInput');
const avatarRing  = document.getElementById('avatarRing');
const nameField   = document.getElementById('name');

if (avatarInput) {
  avatarInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5 MB.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const preview  = document.getElementById('avatarPreview');
      const initials = document.getElementById('avatarInitials');
      if (preview)  { preview.src = ev.target.result; preview.style.display = 'block'; }
      if (initials) initials.style.display = 'none';
      localStorage.setItem('avatarDataUrl', ev.target.result);
    };
    reader.readAsDataURL(file);
  });
}

if (nameField) {
  nameField.addEventListener('input', () => {
    const initials = document.getElementById('avatarInitials');
    const preview  = document.getElementById('avatarPreview');
    if (initials && preview?.style.display !== 'block') {
      initials.textContent = (nameField.value.trim()[0] || '?').toUpperCase();
    }
  });
}

if (avatarRing) {
  avatarRing.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); avatarInput?.click(); }
  });
}

// ── LOGIN PAGE ────────────────────────────────────────────────

const LOGIN_MAX  = 5;
const LOGIN_WAIT = 60 * 1000;

const loginForm = document.getElementById('loginForm');
if (loginForm) {
  const togglePw = document.getElementById('togglePw');
  const pwField  = document.getElementById('password');
  if (togglePw && pwField) {
    togglePw.addEventListener('click', () => {
      const isPass = pwField.type === 'password';
      pwField.type = isPass ? 'text' : 'password';
      togglePw.querySelector('svg').style.opacity = isPass ? '0.4' : '1';
    });
  }

  // Rate-limit helpers (sessionStorage — resets when tab closes, persists on refresh)
  const _attempts    = () => parseInt(sessionStorage.getItem('ao-li-a') || '0', 10);
  const _lockedUntil = () => parseInt(sessionStorage.getItem('ao-li-t') || '0', 10);
  const _resetLimit  = () => { sessionStorage.removeItem('ao-li-a'); sessionStorage.removeItem('ao-li-t'); };

  let _cdTimer = null;
  function _startCountdown() {
    if (_cdTimer) clearInterval(_cdTimer);
    const btn = document.getElementById('loginBtn');
    if (btn) btn.disabled = true;
    _cdTimer = setInterval(() => {
      const secs = Math.ceil((_lockedUntil() - Date.now()) / 1000);
      if (secs <= 0) {
        clearInterval(_cdTimer); _cdTimer = null;
        _resetLimit();
        hideError('loginError');
        const b = document.getElementById('loginBtn');
        if (b) b.disabled = false;
        return;
      }
      showError('loginError', 'loginErrorText', `Too many failed attempts. Please wait ${secs}s.`);
    }, 500);
  }

  // Restore lockout if user refreshes while locked
  if (_lockedUntil() > Date.now()) _startCountdown();
  else if (_lockedUntil() > 0)     _resetLimit();

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    hideError('loginError');

    if (_lockedUntil() > Date.now()) {
      const secs = Math.ceil((_lockedUntil() - Date.now()) / 1000);
      showError('loginError', 'loginErrorText', `Too many failed attempts. Please wait ${secs}s.`);
      return;
    }

    const input    = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const btn      = document.getElementById('loginBtn');

    if (!input || !password) {
      showError('loginError', 'loginErrorText', 'Please fill in all fields.');
      return;
    }

    setLoading(btn, true, 'Verifying...');
    const captchaOk = await verifyCaptcha('loginTurnstile');
    if (!captchaOk) {
      resetCaptcha();
      setLoading(btn, false);
      showError('loginError', 'loginErrorText', 'Please complete the CAPTCHA verification.');
      return;
    }
    setLoading(btn, true, 'Signing in...');
    try {
      // Resolve the Firebase Auth email from the input (real email or username lookup)
      let authEmail;
      if (input.includes('@')) {
        authEmail = input.toLowerCase();
      } else {
        try {
          const doc = await firestoreDb.collection('usernames').doc(input).get();
          authEmail = (doc.exists && doc.data().email) ? doc.data().email : fakeEmail(input);
        } catch {
          authEmail = fakeEmail(input);
        }
      }
      const userCred = await auth.signInWithEmailAndPassword(authEmail, password);
      const user     = userCred.user;

      const doc = await firestoreDb.collection('users').doc(user.uid).get();
      if (!doc.exists) throw Object.assign(new Error('User profile not found.'), { code: 'auth/user-not-found' });

      const profile = doc.data();
      localStorage.setItem('username', profile.username);
      localStorage.setItem('userId',   user.uid);
      if (profile.avatarUrl) localStorage.setItem('avatarDataUrl', profile.avatarUrl);
      _saveAcctList({ uid: user.uid, username: profile.username, email: authEmail, avatarUrl: profile.avatarUrl || '', isGoogle: false });

      _resetLimit(); // clear attempt counter on success
      showToast('Welcome back!', 'success');
      setTimeout(() => {
        const next = new URLSearchParams(location.search).get('next');
        window.location.href = next || (profile.compassSet ? '/lobby' : '/compass');
      }, 600);
    } catch (err) {
      resetCaptcha();
      const count = _attempts() + 1;
      if (count >= LOGIN_MAX) {
        sessionStorage.setItem('ao-li-t', String(Date.now() + LOGIN_WAIT));
        sessionStorage.setItem('ao-li-a', '0');
        showError('loginError', 'loginErrorText', 'Too many failed attempts. Please wait 60s.');
        _startCountdown();
      } else {
        sessionStorage.setItem('ao-li-a', String(count));
        const left   = LOGIN_MAX - count;
        const suffix = left === 1 ? '1 attempt left.' : `${left} attempts left.`;
        showError('loginError', 'loginErrorText', `${friendlyError(err.code || err.message)} ${suffix}`);
      }
    } finally {
      if (_lockedUntil() > Date.now()) {
        // Keep button disabled — countdown manages re-enable. Just restore text.
        btn.innerHTML = btn._origText || btn.innerHTML;
      } else {
        setLoading(btn, false);
      }
    }
  });
}

// ── REGISTER PAGE ─────────────────────────────────────────────

const step1Form = document.getElementById('step1Form');
const step2Form = document.getElementById('step2Form');
let regData = {};

if (step1Form) {
  const togglePw1 = document.getElementById('togglePw1');
  const pw1Field  = document.getElementById('password');
  if (togglePw1 && pw1Field) {
    togglePw1.addEventListener('click', () => {
      const isPass = pw1Field.type === 'password';
      pw1Field.type = isPass ? 'text' : 'password';
      togglePw1.querySelector('svg').style.opacity = isPass ? '0.4' : '1';
    });
  }

  step1Form.addEventListener('submit', async e => {
    e.preventDefault();
    hideError('step1Error');

    const name     = document.getElementById('name').value.trim();
    const username = document.getElementById('username').value.trim();
    const email    = (document.getElementById('email')?.value || '').trim();
    const password = document.getElementById('password').value;
    const confirm  = document.getElementById('confirm').value;
    const isGoogle = !!window._googlePending;

    const tosAgree = document.getElementById('tosAgree');
    if (tosAgree && !tosAgree.checked) {
      showError('step1Error', 'step1ErrorText', 'You must agree to the Terms of Service and Privacy Policy to continue.');
      return;
    }

    if (!name || !username || !email || (!isGoogle && !password)) {
      showError('step1Error', 'step1ErrorText', 'Please fill in all required fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('step1Error', 'step1ErrorText', 'Please enter a valid email address.');
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      showError('step1Error', 'step1ErrorText', 'Username: 3–20 chars, letters/numbers/underscore only.');
      return;
    }
    if (!isGoogle) {
      if (password.length < 6) {
        showError('step1Error', 'step1ErrorText', 'Password must be at least 6 characters.');
        return;
      }
      if (password !== confirm) {
        showError('step1Error', 'step1ErrorText', 'Passwords do not match.');
        return;
      }
    }

    const btn = step1Form.querySelector('button[type="submit"]');
    setLoading(btn, true, 'Checking username...');
    try {
      const usernameDoc = await firestoreDb.collection('usernames').doc(username).get();
      if (usernameDoc.exists) {
        showError('step1Error', 'step1ErrorText', 'Username already taken. Try another.');
        return;
      }
      regData = isGoogle ? { name, username, email } : { name, username, password, email };
      goToStep(2);
    } catch {
      showError('step1Error', 'step1ErrorText', 'Network error. Check your connection.');
    } finally {
      setLoading(btn, false);
    }
  });
}

// Bio char counter
const bioField    = document.getElementById('bio');
const bioCount    = document.getElementById('bioCharCount');
if (bioField && bioCount) {
  bioField.addEventListener('input', () => { bioCount.textContent = bioField.value.length; });
}

if (step2Form) {
  const backBtn = document.getElementById('backBtn');
  if (backBtn) backBtn.addEventListener('click', () => goToStep(1));

  // Cap the DOB picker: max = 18 years ago, min = 120 years ago
  (function () {
    const dobEl = document.getElementById('dob');
    if (!dobEl) return;
    const pad   = n => String(n).padStart(2, '0');
    const fmt   = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const max18 = new Date(); max18.setFullYear(max18.getFullYear() - 18);
    const min120 = new Date(); min120.setFullYear(min120.getFullYear() - 120);
    dobEl.max = fmt(max18);
    dobEl.min = fmt(min120);
  })();

  // Auto-detect country from IP on page load
  (async () => {
    try {
      const r = await fetch('/api/my-country');
      const { country } = await r.json();
      if (!country) return;
      const hiddenEl = document.getElementById('country');
      if (hiddenEl && !hiddenEl.value) {
        // Use the existing picker helper if available, otherwise set directly
        if (typeof setCountryPickerValue === 'function') {
          setCountryPickerValue('countrySearch', 'country', country);
        } else {
          hiddenEl.value = country;
          const searchEl = document.getElementById('countrySearch');
          if (searchEl) searchEl.value = country;
        }
      }
    } catch {}
  })();

  step2Form.addEventListener('submit', async e => {
    e.preventDefault();
    hideError('step2Error');

    const dob      = (document.getElementById('dob')?.value || '');
    const gender   = document.getElementById('gender').value;
    const religion = document.getElementById('religion').value;
    const bio      = (document.getElementById('bio')?.value || '').trim().slice(0, 280);

    let ageNum = null;
    if (dob) {
      const birth   = new Date(dob);
      const today   = new Date();
      let computed  = today.getFullYear() - birth.getFullYear();
      const m       = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) computed--;
      if (computed < 18) {
        showError('step2Error', 'step2ErrorText', 'You must be at least 18 years old to register.');
        return;
      }
      ageNum = computed;
    }

    const btn = document.getElementById('registerBtn');
    setLoading(btn, true, 'Verifying...');
    const captchaOk = await verifyCaptcha('registerTurnstile');
    if (!captchaOk) {
      resetCaptcha();
      setLoading(btn, false);
      showError('step2Error', 'step2ErrorText', 'Please complete the CAPTCHA verification.');
      return;
    }
    setLoading(btn, true, 'Creating account...');
    const isGoogle = !!window._googlePending;

    try {
      let uid;

      if (isGoogle) {
        // Google user already authenticated — just use their existing UID
        uid = window._googlePending.uid;
      } else {
        // Normal sign-up: create Firebase Auth user with real email
        const userCred = await auth.createUserWithEmailAndPassword(
          regData.email, regData.password
        );
        uid = userCred.user.uid;
      }

      // Avatar: Google photo URL or compressed upload
      let avatarUrl = null;
      if (isGoogle && window._googlePending.photoURL) {
        avatarUrl = window._googlePending.photoURL;
        localStorage.setItem('avatarDataUrl', avatarUrl);
      } else {
        const avatarDataUrl = localStorage.getItem('avatarDataUrl');
        if (avatarDataUrl && avatarDataUrl.startsWith('data:')) {
          try {
            avatarUrl = await compressAvatar(avatarDataUrl);
            localStorage.setItem('avatarDataUrl', avatarUrl);
          } catch {}
        }
      }

      // Write user profile + username index atomically
      const batch = firestoreDb.batch();
      const countryEl = document.getElementById('country');
      batch.set(firestoreDb.collection('users').doc(uid), {
        username:   regData.username,
        name:       regData.name,
        email:      regData.email || '',
        gender:     gender   || 'prefer_not_to_say',
        religion:   religion || 'prefer_not_to_say',
        age:        ageNum,
        dob:        dob || null,
        bio:        bio || '',
        country:    (countryEl && countryEl.value) || '',
        politicalX: 0,
        politicalY: 0,
        compassSet: false,
        avatarUrl,
        agreedToTermsAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      batch.set(firestoreDb.collection('usernames').doc(regData.username), { uid, email: regData.email || '' });
      await batch.commit();

      localStorage.setItem('username', regData.username);
      localStorage.setItem('userId',   uid);
      _saveAcctList({ uid, username: regData.username, email: regData.email || '', avatarUrl: avatarUrl || '', isGoogle: !!isGoogle });
      if (isGoogle) {
        sessionStorage.removeItem('googleAuthPending');
        window._googlePending = null;
      }

      showToast('Account created! Now set your political position.', 'success');
      setTimeout(() => {
        const next = new URLSearchParams(location.search).get('next');
        window.location.href = next ? `/compass?next=${encodeURIComponent(next)}` : '/compass';
      }, 700);
    } catch (err) {
      resetCaptcha();
      showError('step2Error', 'step2ErrorText', friendlyError(err.code || err.message));
    } finally {
      setLoading(btn, false);
    }
  });
}

function goToStep(n) {
  const s1    = document.getElementById('step1');
  const s2    = document.getElementById('step2');
  const ind1  = document.getElementById('step-ind-1');
  const ind2  = document.getElementById('step-ind-2');
  const line1 = document.getElementById('line-1');

  if (n === 2) {
    s1.style.display = 'none'; s2.style.display = 'block';
    ind1.classList.remove('active'); ind1.classList.add('done');
    ind2.classList.add('active');
    if (line1) line1.classList.add('done');
    // Re-render the Turnstile widget now that its container is visible
    setTimeout(() => {
      try { if (typeof turnstile !== 'undefined') turnstile.reset(); } catch {}
    }, 50);
  } else {
    s1.style.display = 'block'; s2.style.display = 'none';
    ind1.classList.add('active'); ind1.classList.remove('done');
    ind2.classList.remove('active');
    if (line1) line1.classList.remove('done');
  }
}

// ── Google registration mode ──────────────────────────────────
// Runs when user arrives at /register?mode=google after Google OAuth
(function initGoogleMode() {
  if (!step1Form) return; // only active on register page
  if (new URLSearchParams(location.search).get('mode') !== 'google') return;

  const pendingStr = sessionStorage.getItem('googleAuthPending');
  if (!pendingStr) { history.replaceState({}, '', '/register'); return; }

  let gd;
  try { gd = JSON.parse(pendingStr); } catch { return; }
  if (!gd?.uid) { history.replaceState({}, '', '/register'); return; }

  window._googlePending = gd;

  // Pre-fill name from Google account (user can edit it)
  const nameEl = document.getElementById('name');
  if (nameEl && gd.displayName) {
    nameEl.value = gd.displayName;
    nameEl.dispatchEvent(new Event('input')); // update avatar initials
  }

  // Pre-fill email from Google account (read-only — they can't change their Google email here)
  const emailEl = document.getElementById('email');
  if (emailEl && gd.email) {
    emailEl.value    = gd.email;
    emailEl.readOnly = true;
    emailEl.style.opacity = '0.7';
    emailEl.style.cursor  = 'not-allowed';
  }

  // Hide password fields — not needed when signed in via Google
  ['password', 'confirm'].forEach(id => {
    const group = document.getElementById(id)?.closest('.form-group');
    if (group) group.style.display = 'none';
  });
  const toggler = document.getElementById('togglePw1');
  if (toggler) toggler.style.display = 'none';

  // Pre-fill avatar with Google profile photo
  if (gd.photoURL) {
    localStorage.setItem('avatarDataUrl', gd.photoURL);
    const preview  = document.getElementById('avatarPreview');
    const initials = document.getElementById('avatarInitials');
    if (preview)  { preview.src = gd.photoURL; preview.style.display = 'block'; }
    if (initials) initials.style.display = 'none';
  }

  // Update subtitle to reflect Google context
  const sub = document.querySelector('#step1 .auth-sub');
  if (sub) sub.innerHTML = 'Step 1 of 2 &mdash; <span style="color:var(--green)">&#10003; Signed in with Google.</span> Choose your username.';
})();


