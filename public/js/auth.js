/* auth.js — Firebase Auth for login.html and register.html */

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
    'auth/email-already-in-use':  'Username already taken. Choose another.',
    'auth/invalid-email':         'Invalid username format.',
    'auth/weak-password':         'Password too weak — use at least 6 characters.',
    'auth/user-not-found':        'Invalid username or password.',
    'auth/wrong-password':        'Invalid username or password.',
    'auth/invalid-credential':    'Invalid username or password.',
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

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    hideError('loginError');

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const btn      = document.getElementById('loginBtn');

    if (!username || !password) {
      showError('loginError', 'loginErrorText', 'Please fill in all fields.');
      return;
    }

    setLoading(btn, true, 'Signing in...');
    try {
      const userCred = await auth.signInWithEmailAndPassword(fakeEmail(username), password);
      const user     = userCred.user;

      const doc = await firestoreDb.collection('users').doc(user.uid).get();
      if (!doc.exists) throw Object.assign(new Error('User profile not found.'), { code: 'auth/user-not-found' });

      const profile = doc.data();
      localStorage.setItem('username', profile.username);
      localStorage.setItem('userId',   user.uid);
      if (profile.avatarUrl) localStorage.setItem('avatarDataUrl', profile.avatarUrl);

      showToast('Welcome back!', 'success');
      setTimeout(() => {
        window.location.href = profile.compassSet ? '/lobby.html' : '/compass.html';
      }, 600);
    } catch (err) {
      showError('loginError', 'loginErrorText', friendlyError(err.code || err.message));
    } finally {
      setLoading(btn, false);
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
    const password = document.getElementById('password').value;
    const confirm  = document.getElementById('confirm').value;

    if (!name || !username || !password) {
      showError('step1Error', 'step1ErrorText', 'Please fill in all required fields.');
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      showError('step1Error', 'step1ErrorText', 'Username: 3–20 chars, letters/numbers/underscore only.');
      return;
    }
    if (password.length < 6) {
      showError('step1Error', 'step1ErrorText', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      showError('step1Error', 'step1ErrorText', 'Passwords do not match.');
      return;
    }

    const btn = step1Form.querySelector('button[type="submit"]');
    setLoading(btn, true, 'Checking username...');
    try {
      const usernameDoc = await firestoreDb.collection('usernames').doc(username).get();
      if (usernameDoc.exists) {
        showError('step1Error', 'step1ErrorText', 'Username already taken. Try another.');
        return;
      }
      regData = { name, username, password };
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

  step2Form.addEventListener('submit', async e => {
    e.preventDefault();
    hideError('step2Error');

    const age      = document.getElementById('age').value;
    const gender   = document.getElementById('gender').value;
    const religion = document.getElementById('religion').value;
    const bio      = (document.getElementById('bio')?.value || '').trim().slice(0, 280);

    const ageNum = parseInt(age);
    if (age && (isNaN(ageNum) || ageNum < 13 || ageNum > 120)) {
      showError('step2Error', 'step2ErrorText', 'Please enter a valid age (13–120).');
      return;
    }

    const btn = document.getElementById('registerBtn');
    setLoading(btn, true, 'Creating account...');

    try {
      // 1. Create Firebase Auth user
      const userCred = await auth.createUserWithEmailAndPassword(
        fakeEmail(regData.username), regData.password
      );
      const uid = userCred.user.uid;

      // 2. Compress avatar and store in Firestore (no Storage needed)
      let avatarUrl = null;
      const avatarDataUrl = localStorage.getItem('avatarDataUrl');
      if (avatarDataUrl && avatarDataUrl.startsWith('data:')) {
        try {
          avatarUrl = await compressAvatar(avatarDataUrl);
          localStorage.setItem('avatarDataUrl', avatarUrl);
        } catch {
          // avatar compression failure is non-fatal
        }
      }

      // 3. Write user profile + username index atomically
      const batch = firestoreDb.batch();
      batch.set(firestoreDb.collection('users').doc(uid), {
        username:   regData.username,
        name:       regData.name,
        gender:     gender   || 'prefer_not_to_say',
        religion:   religion || 'prefer_not_to_say',
        age:        ageNum || 18,
        bio:        bio || '',
        politicalX: 0,
        politicalY: 0,
        compassSet: false,
        avatarUrl,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      batch.set(firestoreDb.collection('usernames').doc(regData.username), { uid });
      await batch.commit();

      localStorage.setItem('username', regData.username);
      localStorage.setItem('userId',   uid);

      showToast('Account created! Now set your political position.', 'success');
      setTimeout(() => { window.location.href = '/compass.html'; }, 700);
    } catch (err) {
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
  } else {
    s1.style.display = 'block'; s2.style.display = 'none';
    ind1.classList.add('active'); ind1.classList.remove('done');
    ind2.classList.remove('active');
    if (line1) line1.classList.remove('done');
  }
}
