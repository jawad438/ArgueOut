require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');
const fs         = require('fs');
const admin      = require('firebase-admin');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

// -- Firebase Admin --------------------------------------------
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const fstore = admin.firestore();

// Cookie parser (no extra dep)
function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  header.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  });
  return cookies;
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (xff ? xff.split(',')[0] : req.socket?.remoteAddress || '').trim();
}

// IP ban cache — reloads from Firestore every 60 s
const bannedIpSet = new Set();
async function loadBannedIps() {
  try {
    const snap = await fstore.collection('banned_ips').get();
    bannedIpSet.clear();
    snap.docs.forEach(d => bannedIpSet.add(d.id));
  } catch {}
}
loadBannedIps();
setInterval(loadBannedIps, 60000);

async function verifyFirebaseToken(idToken) {
  try { return await admin.auth().verifyIdToken(idToken); }
  catch { return null; }
}

// -- Admin provisioning ----------------------------------------
(async function provisionAdmin() {
  const ADMIN_EMAIL    = 'admin@argueout.app';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) { console.log('[admin] ADMIN_PASSWORD not set - skipping provisioning'); return; }
  try {
    const doc = await fstore.collection('usernames').doc('admin').get();
    if (doc.exists) return; // already set up
    let uid;
    try {
      const rec = await admin.auth().getUserByEmail(ADMIN_EMAIL);
      uid = rec.uid;
    } catch {
      const rec = await admin.auth().createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, displayName: 'Admin' });
      uid = rec.uid;
    }
    const batch = fstore.batch();
    batch.set(fstore.collection('users').doc(uid), {
      username: 'admin', name: 'Admin', email: ADMIN_EMAIL,
      isAdmin: true, politicalX: 0, politicalY: 0, compassSet: true,
      avatarUrl: null, createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    batch.set(fstore.collection('usernames').doc('admin'), { uid, email: ADMIN_EMAIL });
    await batch.commit();
    console.log('[admin] admin account provisioned ✓');
  } catch (err) {
    console.error('[admin] provisioning error:', err.message);
  }
})();

// -- Input validation helpers ----------------------------------
function safeStr(val, maxLen = 200) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}
function safeId(val) {
  if (typeof val !== 'string') return null;
  // Firestore doc IDs: printable non-slash chars, 1-128 length
  if (val.length < 1 || val.length > 128 || /[/\x00]/.test(val)) return null;
  return val;
}
function safeInt(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.floor(n);
}

// -- Socket.io event rate limiting -----------------------------
// Map: socketId -> Map<eventName, { count, resetAt }>
const _socketRates = new Map();
function socketAllow(socketId, event, maxPerMinute) {
  const now = Date.now();
  if (!_socketRates.has(socketId)) _socketRates.set(socketId, new Map());
  const m = _socketRates.get(socketId);
  if (!m.has(event)) m.set(event, { count: 0, resetAt: now + 60000 });
  const r = m.get(event);
  if (now > r.resetAt) { r.count = 0; r.resetAt = now + 60000; }
  r.count++;
  return r.count <= maxPerMinute;
}
function socketCleanup(socketId) { _socketRates.delete(socketId); }

// -- Express ---------------------------------------------------
const app    = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null; // null = allow all (dev mode)

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS || '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Security headers via helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://www.gstatic.com', 'https://cdn.socket.io', 'https://apis.google.com', 'https://challenges.cloudflare.com'],
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:        ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc:         ["'self'", 'data:', 'https:', 'blob:'],
      mediaSrc:       ["'self'", 'blob:'],
      connectSrc:     ["'self'", 'wss:', 'ws:', 'https://*.googleapis.com', 'https://*.firebaseapp.com', 'https://www.gstatic.com', 'https://openrouter.ai', 'https://ip-api.com', 'https://challenges.cloudflare.com'],
      scriptSrcAttr:  ["'unsafe-inline'"],
      frameSrc:       ["https://argueout.firebaseapp.com", 'https://challenges.cloudflare.com'],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // required for WebRTC getUserMedia
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // required for Firebase signInWithPopup (keeps window.opener for auth relay)
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, // less restrictive than no-referrer; lets crawlers/analytics see referral chains
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 63072000, includeSubDomains: true, preload: true }
    : false,
}));

// Additional headers not covered by default helmet config
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=*, microphone=*, geolocation=()');
  // Explicitly allow public-page indexing — overrides any host-level noindex header
  // (e.g. Render.com free tier may inject X-Robots-Tag: noindex on .onrender.com subdomains)
  if (!req.path.startsWith('/api') && !req.path.startsWith('/admin')) {
    res.setHeader('X-Robots-Tag', 'index, follow');
  }
  next();
});

// Rate limiting — API routes only. Static assets, page loads, and the
// socket.io polling handshake must never count against this — a single
// page load pulls down dozens of files (css/js/images/fonts), so applying
// this globally was exhausting the budget after just a few page reloads.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => getClientIp(req),
  message: { error: 'Too many requests. Please slow down.' },
  skip: req => !req.path.startsWith('/api') || req.path === '/api/health'
});
app.use(globalLimiter);

// Tighter limit on sensitive API endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: req => getClientIp(req),
  message: { error: 'Too many requests to this endpoint.' }
});

app.use(express.json({ limit: '64kb' })); // cap request body size

// Block IP-banned clients from all HTTP pages — except the appeal endpoint,
// so a banned visitor can still send the admin a short appeal message.
app.use((req, res, next) => {
  const ip = getClientIp(req);
  if (ip && bannedIpSet.has(ip) && req.path !== '/api/appeal-ip' && req.path !== '/api/appeal-ip/status') {
    return res.status(403).sendFile(path.join(__dirname, 'public', 'ip-banned.html'));
  }
  next();
});

// Admin session endpoint — call this before navigating to /admin
app.post('/api/admin-auth', strictLimiter, async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken || typeof idToken !== 'string' || idToken.length > 4096)
      return res.status(400).json({ error: 'No token' });
    const decoded = await admin.auth().verifyIdToken(idToken);
    const doc = await fstore.collection('users').doc(decoded.uid).get();
    if (!doc.exists || !doc.data().isAdmin) return res.status(403).json({ error: 'Not admin' });
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', 'admin_sess=' + idToken + '; HttpOnly; SameSite=Strict; Max-Age=3600; Path=/' + secure);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin-auth]', err.message);
    res.status(401).json({ error: 'Unauthorized' }); // don't leak internal error
  }
});

// /api/admin-me — verify Firebase Bearer token and return admin user info
app.get('/api/admin-me', async (req, res) => {
  const auth_header = req.headers.authorization || '';
  const idToken = auth_header.startsWith('Bearer ') ? auth_header.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const doc = await fstore.collection('users').doc(decoded.uid).get();
    if (!doc.exists || !doc.data().isAdmin) return res.status(403).json({ error: 'Not admin' });
    res.json({ username: doc.data().username, uid: decoded.uid });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// -- Whitelist: sign-in-less temp accounts --------------------------------------
const WL_FILE = path.join(__dirname, 'data', 'whitelist.json');
function loadWhitelist() {
  try { if (fs.existsSync(WL_FILE)) return JSON.parse(fs.readFileSync(WL_FILE, 'utf8')); } catch {}
  return {};
}
function saveWhitelist(d) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  fs.writeFileSync(WL_FILE, JSON.stringify(d, null, 2));
}
async function verifyAdminBearer(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(t);
    const doc = await fstore.collection('users').doc(decoded.uid).get();
    return (doc.exists && doc.data().isAdmin) ? decoded : null;
  } catch { return null; }
}

app.get('/api/admin/whitelist', async (req, res) => {
  if (!await verifyAdminBearer(req)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ entries: Object.values(loadWhitelist()) });
});

app.post('/api/admin/whitelist', async (req, res) => {
  if (!await verifyAdminBearer(req)) return res.status(403).json({ error: 'Forbidden' });
  const { username } = req.body || {};
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Invalid username (3–20 chars, letters/numbers/underscore)' });
  const existing = await fstore.collection('usernames').doc(username).get().catch(() => null);
  if (existing?.exists) return res.status(409).json({ error: 'Username already taken by a real account' });
  const wl = loadWhitelist();
  if (wl[username]) return res.status(409).json({ error: 'Whitelist entry already exists' });
  const uid = 'wl_' + username;
  wl[username] = { username, uid, createdAt: new Date().toISOString() };
  try {
    await fstore.collection('users').doc(uid).set({
      username, name: username, email: null, isGuest: true, isWhitelist: true,
      politicalX: 0, politicalY: 0, compassSet: false, avatarUrl: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await fstore.collection('usernames').doc(username).set({ uid });
  } catch (e) { console.error('[wl create]', e.message); }
  saveWhitelist(wl);
  res.json({ ok: true, entry: wl[username] });
});

app.delete('/api/admin/whitelist/:username', async (req, res) => {
  if (!await verifyAdminBearer(req)) return res.status(403).json({ error: 'Forbidden' });
  const { username } = req.params;
  const wl = loadWhitelist();
  if (!wl[username]) return res.status(404).json({ error: 'Not found' });
  const { uid } = wl[username];
  delete wl[username];
  saveWhitelist(wl);
  try { await fstore.collection('usernames').doc(username).delete(); } catch {}
  try { await fstore.collection('users').doc(uid).delete(); } catch {}
  res.json({ ok: true });
});

// Auto-signin page for whitelist links
app.get('/whitelist/:username', async (req, res) => {
  const { username } = req.params;
  const entry = loadWhitelist()[username];
  if (!entry) return res.status(404).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invalid Link — ArgueOut</title><link rel="icon" href="/favicon.png" type="image/png"><link rel="stylesheet" href="/css/style.css"></head><body><div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;text-align:center;padding:32px"><div><div style="font-size:3rem;margin-bottom:16px">🔗</div><h2 style="font-family:'Space Grotesk',sans-serif;font-size:1.4rem;font-weight:800;color:var(--text-1);margin:0 0 10px">Invalid Link</h2><p style="color:var(--text-3);margin:0 0 24px">This whitelist link doesn't exist or has been revoked.</p><a href="/" class="btn btn-primary">Go to ArgueOut</a></div></div></body></html>`);
  try {
    const token = await admin.auth().createCustomToken(entry.uid, { whitelist: true, username });
    // Ensure Firestore user doc still exists (may have been deleted externally)
    const doc = await fstore.collection('users').doc(entry.uid).get().catch(() => null);
    if (!doc?.exists) {
      await fstore.collection('users').doc(entry.uid).set({
        username, name: username, email: null, isGuest: true, isWhitelist: true,
        politicalX: 0, politicalY: 0, compassSet: false, avatarUrl: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await fstore.collection('usernames').doc(username).set({ uid: entry.uid });
    }
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Joining ArgueOut…</title>
  <link rel="icon" href="/favicon.png" type="image/png">
  <link rel="stylesheet" href="/css/style.css">
  <script>(function(){var t=localStorage.getItem('ao-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');else if(t==='light')document.documentElement.setAttribute('data-theme','light');}());</script>
  <style>
    .wl-spinner{width:44px;height:44px;border:3px solid rgba(139,92,246,0.18);border-top-color:#8b5cf6;border-radius:50%;animation:wl-spin .75s linear infinite;margin:0 auto 24px}
    @keyframes wl-spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
<div class="bg-orbs" aria-hidden="true">
  <div class="bg-orb bg-orb-1"></div><div class="bg-orb bg-orb-2"></div><div class="bg-orb bg-orb-3"></div>
</div>
<div style="min-height:100dvh;display:flex;align-items:center;justify-content:center">
  <div style="text-align:center;padding:48px 32px;max-width:380px">
    <div class="wl-spinner"></div>
    <h1 style="font-family:'Space Grotesk',sans-serif;font-size:1.5rem;font-weight:800;color:var(--text-1);margin:0 0 8px">Signing you in…</h1>
    <p style="color:var(--text-3);margin:0">Welcome, <strong style="color:var(--purple)">@${username}</strong></p>
    <div id="wlErr" style="display:none;margin-top:16px;padding:10px 14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:10px;color:#ef4444;font-size:0.85rem"></div>
  </div>
</div>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
<script src="/js/firebase-init.js"></script>
<script src="/js/bg.js"></script>
<script>
(async function() {
  try {
    await firebase.auth().signInWithCustomToken(${JSON.stringify(token)});
    window.location.href = '/lobby';
  } catch(e) {
    document.querySelector('.wl-spinner').style.display = 'none';
    const el = document.getElementById('wlErr');
    el.style.display = 'block';
    el.textContent = 'Sign-in failed: ' + (e.message || String(e));
  }
})();
</script>
</body>
</html>`);
  } catch(e) {
    console.error('[wl signin]', e.message);
    res.status(500).send('Error generating sign-in token.');
  }
});

// -- Account deletion requests --------------------------------------------------
// User submits a deletion request
app.post('/api/request-deletion', async (req, res) => {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Unauthorized' });
  let decoded;
  try { decoded = await admin.auth().verifyIdToken(t); } catch { return res.status(401).json({ error: 'Unauthorized' }); }
  try {
    const userDoc = await fstore.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    const existing = await fstore.collection('deletion_requests').doc(decoded.uid).get();
    if (existing.exists && existing.data().status === 'pending')
      return res.status(409).json({ error: 'You already have a pending deletion request' });
    const requestData = {
      uid: decoded.uid,
      username: userDoc.data().username || '',
      email: userDoc.data().email || '',
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending'
    };
    await fstore.collection('deletion_requests').doc(decoded.uid).set(requestData);
    res.json({ ok: true });

    // Notify all connected admin sockets in real-time
    try {
      const sockets = await io.fetchSockets();
      for (const s of sockets) {
        if (s.data.isAdmin) {
          s.emit('admin-new-deletion-request', {
            uid: decoded.uid,
            username: requestData.username,
            email: requestData.email,
          });
        }
      }
    } catch (notifyErr) {
      console.error('[deletion-request] notify-admins error:', notifyErr.message);
    }
  } catch (e) {
    console.error('[deletion-request]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: list pending deletion requests
app.get('/api/admin/deletion-requests', async (req, res) => {
  if (!await verifyAdminBearer(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const snap = await fstore.collection('deletion_requests').where('status', '==', 'pending').get();
    const requests = snap.docs.map(d => {
      const data = d.data();
      return { uid: d.id, username: data.username, email: data.email, requestedAt: data.requestedAt?.toDate?.()?.toISOString() || null };
    }).sort((a, b) => {
      if (!a.requestedAt) return 1;
      if (!b.requestedAt) return -1;
      return new Date(a.requestedAt) - new Date(b.requestedAt);
    });
    res.json({ requests });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: permanently delete user account
app.delete('/api/admin/deletion-requests/:uid', async (req, res) => {
  if (!await verifyAdminBearer(req)) return res.status(403).json({ error: 'Forbidden' });
  const { uid } = req.params;
  try {
    const userDoc = await fstore.collection('users').doc(uid).get().catch(() => null);
    const username = userDoc?.exists ? userDoc.data().username : null;
    try { await admin.auth().deleteUser(uid); } catch {}
    try { await fstore.collection('users').doc(uid).delete(); } catch {}
    if (username) try { await fstore.collection('usernames').doc(username).delete(); } catch {}
    try { await fstore.collection('deletion_requests').doc(uid).update({ status: 'deleted', deletedAt: admin.firestore.FieldValue.serverTimestamp() }); } catch {}
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin delete-user]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: dismiss a deletion request
app.post('/api/admin/deletion-requests/:uid/dismiss', async (req, res) => {
  if (!await verifyAdminBearer(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    await fstore.collection('deletion_requests').doc(req.params.uid).update({ status: 'dismissed' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// -- Ban / timeout / IP-ban appeals --------------------------------------------
function validAppealMessage(message) {
  const msg = typeof message === 'string' ? message.trim() : '';
  return (msg.length >= 5 && msg.length <= 200) ? msg : null;
}

async function notifyAdminsNewAppeal(payload) {
  try {
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      if (s.data.isAdmin) s.emit('admin-new-appeal', payload);
    }
  } catch (e) { console.error('[appeal] notify-admins error:', e.message); }
}

// Logged-in user (account ban or timeout) submits an appeal
app.post('/api/appeal', strictLimiter, async (req, res) => {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Unauthorized' });
  let decoded;
  try { decoded = await admin.auth().verifyIdToken(t); } catch { return res.status(401).json({ error: 'Unauthorized' }); }
  const msg = validAppealMessage(req.body?.message);
  if (!msg) return res.status(400).json({ error: 'Message must be 5–200 characters.' });
  try {
    const userDoc = await fstore.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    const u = userDoc.data();
    const bannedUntil = u.bannedUntil ? u.bannedUntil.toDate() : null;
    if (!u.banned || (bannedUntil && bannedUntil <= new Date()))
      return res.status(400).json({ error: 'Your account is not currently restricted.' });

    const existing = await fstore.collection('appeals').where('uid', '==', decoded.uid).limit(20).get();
    if (existing.docs.some(d => d.data().status === 'pending'))
      return res.status(409).json({ error: 'You already have a pending appeal.' });

    const appealData = {
      uid: decoded.uid, username: u.username || '', ip: getClientIp(req),
      type: bannedUntil ? 'timeout' : 'ban', message: msg, status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await fstore.collection('appeals').add(appealData);
    res.json({ ok: true });
    notifyAdminsNewAppeal({ username: appealData.username, type: appealData.type });
  } catch (e) {
    console.error('[appeal]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logged-in user: does a pending appeal already exist?
app.get('/api/appeal/status', async (req, res) => {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Unauthorized' });
  let decoded;
  try { decoded = await admin.auth().verifyIdToken(t); } catch { return res.status(401).json({ error: 'Unauthorized' }); }
  try {
    const snap = await fstore.collection('appeals').where('uid', '==', decoded.uid).limit(20).get();
    res.json({ pending: snap.docs.some(d => d.data().status === 'pending') });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// IP-banned: does a pending appeal already exist for this IP?
app.get('/api/appeal-ip/status', async (req, res) => {
  const ip = getClientIp(req);
  if (!ip || !bannedIpSet.has(ip)) return res.status(400).json({ error: 'Your network is not currently blocked.' });
  try {
    const snap = await fstore.collection('appeals').where('ip', '==', ip).limit(20).get();
    res.json({ pending: snap.docs.some(d => d.data().status === 'pending') });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// IP-banned (unauthenticated, can't reach any other route) submits an appeal
app.post('/api/appeal-ip', strictLimiter, async (req, res) => {
  const ip = getClientIp(req);
  if (!ip || !bannedIpSet.has(ip)) return res.status(400).json({ error: 'Your network is not currently blocked.' });
  const msg = validAppealMessage(req.body?.message);
  if (!msg) return res.status(400).json({ error: 'Message must be 5–200 characters.' });
  try {
    const existing = await fstore.collection('appeals').where('ip', '==', ip).limit(20).get();
    if (existing.docs.some(d => d.data().status === 'pending'))
      return res.status(409).json({ error: 'You already have a pending appeal.' });

    const appealData = {
      uid: null, username: null, ip, type: 'ip-ban', message: msg,
      status: 'pending', createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await fstore.collection('appeals').add(appealData);
    res.json({ ok: true });
    notifyAdminsNewAppeal({ username: null, type: 'ip-ban' });
  } catch (e) {
    console.error('[appeal-ip]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: list appeals
app.get('/api/admin/appeals', async (req, res) => {
  if (!await verifyAdminBearer(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const snap = await fstore.collection('appeals').orderBy('createdAt', 'desc').limit(150).get();
    const appeals = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id, uid: data.uid || null, username: data.username || null, ip: data.ip || null,
        type: data.type, message: data.message, status: data.status,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null
      };
    });
    res.json({ appeals });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: approve an appeal — lifts the ban/timeout/IP-ban it refers to
app.post('/api/admin/appeals/:id/approve', async (req, res) => {
  if (!await verifyAdminBearer(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const ref = fstore.collection('appeals').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    const a = doc.data();

    if (a.type === 'ip-ban') {
      if (a.ip) {
        await fstore.collection('banned_ips').doc(a.ip).delete().catch(() => {});
        bannedIpSet.delete(a.ip);
        const usnap = await fstore.collection('users').where('bannedIp', '==', a.ip).get();
        if (!usnap.empty) {
          const batch = fstore.batch();
          usnap.docs.forEach(d => batch.update(d.ref, { banned: false, bannedUntil: null, ipBanned: false, bannedIp: null }));
          await batch.commit();
        }
      }
    } else if (a.uid) {
      await fstore.collection('users').doc(a.uid).update({ banned: false, bannedUntil: null, ipBanned: false, bannedIp: null });
      try {
        const sockets = await io.fetchSockets();
        for (const s of sockets) if (s.data.userId === a.uid) s.emit('account-unbanned');
      } catch {}
    }

    await ref.update({ status: 'resolved' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin appeal approve]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: dismiss an appeal without lifting the restriction
app.post('/api/admin/appeals/:id/dismiss', async (req, res) => {
  if (!await verifyAdminBearer(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    await fstore.collection('appeals').doc(req.params.id).update({ status: 'dismissed' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// -- Profile update endpoints (Admin SDK — bypasses Firestore security rules) ----------
async function getAuthUser(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return null;
  try { return await admin.auth().verifyIdToken(t); } catch { return null; }
}

app.post('/api/profile/name', async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const name = (req.body?.name || '').trim().slice(0, 50);
  if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
  try {
    await fstore.collection('users').doc(decoded.uid).update({ name });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/profile/bio', async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const bio = typeof req.body?.bio === 'string' ? req.body.bio.trim().slice(0, 280) : '';
  try {
    await fstore.collection('users').doc(decoded.uid).update({ bio });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/profile/country', async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const country = typeof req.body?.country === 'string' ? req.body.country.trim().slice(0, 60) : '';
  try {
    await fstore.collection('users').doc(decoded.uid).update({ country });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/profile/avatar', async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const avatarUrl = req.body?.avatarUrl || '';
  if (typeof avatarUrl !== 'string' || !avatarUrl.startsWith('data:image/'))
    return res.status(400).json({ error: 'Invalid image' });
  try {
    await fstore.collection('users').doc(decoded.uid).update({ avatarUrl });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/profile/username', async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const { username, oldUsername } = req.body || {};
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Invalid username format' });
  try {
    const existing = await fstore.collection('usernames').doc(username).get();
    if (existing.exists && existing.data().uid !== decoded.uid)
      return res.status(409).json({ error: 'Username already taken' });
    const batch = fstore.batch();
    batch.update(fstore.collection('users').doc(decoded.uid), { username });
    if (oldUsername && oldUsername !== username)
      batch.delete(fstore.collection('usernames').doc(oldUsername));
    batch.set(fstore.collection('usernames').doc(username), { uid: decoded.uid });
    await batch.commit();

    // Keep Firebase Auth email in sync for password-based accounts (username@argueout.app)
    // Done server-side via Admin SDK to avoid client-side email-verification restrictions
    try {
      const authUser = await admin.auth().getUser(decoded.uid);
      if (authUser.email && authUser.email.endsWith('@argueout.app')) {
        const newEmail = `${username.toLowerCase()}@argueout.app`;
        if (authUser.email !== newEmail) {
          await admin.auth().updateUser(decoded.uid, { email: newEmail });
        }
      }
    } catch (emailErr) {
      console.warn('[profile/username] Auth email sync failed:', emailErr.message);
    }

    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// /admin — serve admin page; admin.js handles auth guard client-side via /api/admin-me
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'private', 'admin.html'));
});

// Redirect /path.html -> /path (clean URLs)
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const clean = req.path.slice(0, -5) || '/';
    const qs    = req.url.slice(req.path.length);
    return res.redirect(301, clean + qs);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve /path as /path.html for extensionless clean URLs
app.use((req, res, next) => {
  if (path.extname(req.path) || req.path === '/') return next();
  const htmlFile = path.join(__dirname, 'public', req.path + '.html');
  if (fs.existsSync(htmlFile)) return res.sendFile(htmlFile);
  next();
});

app.get('/api/health', (_, res) => res.json({ ok: true }));

/* ─────────────────────────────────────────────────────────────────
   MOBILE API  — endpoints used exclusively by the React Native app
   ───────────────────────────────────────────────────────────────── */

// Resolve username → email so Firebase signInWithEmailAndPassword can work
app.post('/api/mobile/lookup', express.json(), async (req, res) => {
  try {
    const id = (req.body?.identifier || '').trim().toLowerCase();
    if (!id) return res.status(400).json({ error: 'Missing identifier' });
    if (id.includes('@')) return res.json({ email: id });
    const doc = await fstore.collection('usernames').doc(id).get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });
    const email = doc.data().email || `${id}@argueout.local`;
    res.json({ email });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Register a new user from the mobile app (uses Admin SDK — no Firestore client needed)
app.post('/api/mobile/register', express.json(), strictLimiter, async (req, res) => {
  try {
    const { email, password, username, name, age, gender, religion, country } = req.body || {};
    if (!email || !password || !username || !name) return res.status(400).json({ error: 'Missing required fields' });
    const uname = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) return res.status(400).json({ error: 'Invalid username' });

    const exists = await fstore.collection('usernames').doc(uname).get();
    if (exists.exists) return res.status(409).json({ error: 'Username already taken' });

    const userRec = await admin.auth().createUser({ email: email.trim(), password, displayName: name.trim() });
    const uid = userRec.uid;

    const batch = fstore.batch();
    batch.set(fstore.collection('users').doc(uid), {
      username: uname, name: name.trim(), email: email.trim().toLowerCase(),
      gender: gender || 'prefer_not_to_say', religion: religion || 'prefer_not_to_say',
      age: parseInt(age) || 0, country: country || '', bio: '',
      politicalX: 0, politicalY: 0, compassSet: false, avatarUrl: null,
      agreedToTermsAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(fstore.collection('usernames').doc(uname), { uid, email: email.trim().toLowerCase() });
    await batch.commit();

    const customToken = await admin.auth().createCustomToken(uid);
    res.json({ customToken, uid, username: uname });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

// Issue a short-lived Firebase custom token so a WebView can sign in as the native user
app.post('/api/mobile/session-token', async (req, res) => {
  try {
    const decoded = await getAuthUser(req);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
    const customToken = await admin.auth().createCustomToken(decoded.uid);
    res.json({ customToken });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Get the current user's profile (for mobile lobby/profile screens)
app.get('/api/me', async (req, res) => {
  try {
    const decoded = await getAuthUser(req);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
    const doc = await fstore.collection('users').doc(decoded.uid).get();
    if (!doc.exists) return res.status(404).json({ error: 'Profile not found' });
    res.json({ uid: decoded.uid, ...doc.data() });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Notifications — read/clear via Admin SDK so client-side Firestore security
// rules (which don't cover this collection) can't block the read.
app.get('/api/notifications', async (req, res) => {
  try {
    const decoded = await getAuthUser(req);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
    const snap = await fstore.collection('notifications').doc(decoded.uid)
      .collection('items').orderBy('createdAt', 'desc').limit(50).get();
    const items = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        type: data.type || null,
        message: data.message || data.text || '',
        read: !!data.read,
        createdAt: data.createdAt ? data.createdAt.toMillis() : null,
        // Challenge-specific fields, used to render Accept/Decline on the page
        fromUserId:   data.fromUserId || null,
        fromUsername: data.fromUsername || null,
        question:     data.question || null
      };
    });
    res.json({ items });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/notifications/clear', async (req, res) => {
  try {
    const decoded = await getAuthUser(req);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
    const col = fstore.collection('notifications').doc(decoded.uid).collection('items');
    const snap = await col.get();
    const batch = fstore.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Update political compass position from mobile
app.post('/api/profile/compass', express.json(), async (req, res) => {
  try {
    const decoded = await getAuthUser(req);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
    const x = parseFloat(req.body?.x);
    const y = parseFloat(req.body?.y);
    if (isNaN(x) || isNaN(y) || x < -1 || x > 1 || y < -1 || y > 1)
      return res.status(400).json({ error: 'Invalid compass values' });
    await fstore.collection('users').doc(decoded.uid).update({ politicalX: x, politicalY: y, compassSet: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// TWA (Android APK) domain verification — fingerprint updated after first APK build
app.get('/.well-known/assetlinks.json', (_, res) => {
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.argueout.app',
      sha256_cert_fingerprints: [
        // Replace with your APK signing fingerprint after building
        // Run: keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android
        'PLACEHOLDER_REPLACE_WITH_APK_SHA256_FINGERPRINT'
      ]
    }
  }]);
});

// Public profile lookup by userId — works for offline users too (the
// existing online-users directory only carries currently-connected users'
// info, which isn't enough to view e.g. a comment author who has since
// logged off). Returns the same field set already broadcast to any logged-in
// user via 'online-users' (username, name, avatar, position, age, gender,
// religion, country, bio) — nothing more sensitive than what's already
// exposed there today.
app.get('/api/users/:userId/public-profile', async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const userId = safeId(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'Invalid user' });
  try {
    const doc = await fstore.collection('users').doc(userId).get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });
    const d = doc.data();
    res.json({
      userId,
      username: d.username,
      name: d.name || d.username,
      avatarUrl: d.avatarUrl || null,
      politicalX: d.politicalX || 0,
      politicalY: d.politicalY || 0,
      age: d.age || null,
      gender: d.gender || null,
      religion: d.religion || null,
      country: d.country || '',
      bio: d.bio || ''
    });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/debates', (req, res) => {
  const list = [];
  for (const [roomId, room] of rooms) {
    if (!room.startedAt) continue; // only list debates that have started
    if (room.private) continue; // debaters agreed to keep this one off the public list
    list.push({
      roomId,
      question:       room.question || null,
      users:          room.users.map(u => ({ username: u.username, politicalX: u.politicalX || 0, politicalY: u.politicalY || 0 })),
      spectatorCount: (room.spectators || []).length,
      startedAt:      room.startedAt
    });
  }
  res.json(list);
});

// ═══════════════════════════════════════════════════════════════════════
// THE DIVIDE — poll-based debate matchmaking
// ═══════════════════════════════════════════════════════════════════════
//
// Data model (Firestore):
//   polls/{pollId}                    { question, options:string[], votes:{"0":n,"1":n,...},
//                                        createdBy, createdAt, status:'active'|'closed' }
//                                      (commentCount is NOT stored — always read live via a
//                                       count() aggregation on the comments subcollection)
//   polls/{pollId}/votes/{userId}     { optionIndex, votedAt }  — doc ID = userId locks one vote/user
//   polls/{pollId}/comments/{id}      { text, authorId, authorUsername, authorAvatarUrl, parentId,
//                                        createdAt, reactions:{sharp,fairPoint,sourceNeeded} }
//   polls/{pollId}/comments/{id}/reactorFlags/{userId}  { sharp, fairPoint, sourceNeeded } (booleans)
//   challenges/{challengeId}          { pollId, question, challengerId, challengerUsername,
//                                        challengedId, challengedUsername, status, createdAt, expiresAt,
//                                        debateRoomId }
//
// Votes are counted via a map keyed by string index (votes.0, votes.1, ...) so
// FieldValue.increment() can update a single option's count without ever
// reading the poll first — safe under concurrent voting, same principle as
// the plan's original two-option votesA/votesB design, generalised to N options.
const DIVIDE_MAX_OPTIONS = 6;
const DIVIDE_MAX_INCOMING_PENDING = 3;
const DIVIDE_CHALLENGE_TTL_MS = 15 * 60 * 1000;
const DIVIDE_MAX_TAGS = 8;
// 'economic'/'social' map onto the two compass axes already collected at
// onboarding, so the new-poll notification algorithm below can target users
// whose compass position suggests they'd actually have an opinion — 'foreign'/
// 'culture'/'general' don't have a dedicated axis, so they fall back to
// overall engagement (how far from dead-center a user is on either axis).
const DIVIDE_CATEGORIES = {
  economic: 'Economic',
  social:   'Social',
  foreign:  'Foreign Policy',
  culture:  'Culture',
  general:  'General'
};

// commentCount is a denormalized field on the poll doc, kept in sync by
// FieldValue.increment(1) when a comment is created (comment deletion is a
// soft-delete that keeps the doc in place, so no decrement is needed). This
// used to be a live count() aggregation instead, but that meant ranking or
// paging the poll list required one extra query per poll — with this stored
// instead, the whole active-poll list can be ranked/paged from a single
// query, and only the page actually being returned needs further lookups.
function pollDocToJson(doc) {
  const d = doc.data();
  const options = Array.isArray(d.options) ? d.options : [];
  const votes = options.map((_, i) => (d.votes && d.votes[String(i)]) || 0);
  return {
    id: doc.id,
    question: d.question,
    options,
    votes,
    totalVotes: votes.reduce((a, b) => a + b, 0),
    status: d.status || 'active',
    category: d.category || 'general',
    categoryLabel: DIVIDE_CATEGORIES[d.category] || DIVIDE_CATEGORIES.general,
    tags: Array.isArray(d.tags) ? d.tags : [],
    commentCount: d.commentCount || 0,
    createdAt: d.createdAt ? d.createdAt.toMillis() : null
  };
}

// Counts of currently-online users per option, for the "N online on this side"
// UI and to know up front whether a challenge has anyone to match against.
function pollOnlineCounts(pollVoterMap, options) {
  const counts = options.map(() => 0);
  for (const u of onlineUsers.values()) {
    const idx = pollVoterMap.get(u.userId);
    if (idx != null) counts[idx]++;
  }
  return counts;
}

// Interaction score used to rank polls in both the featured strip and the
// main feed: votes + comments, so a poll people are actively arguing in
// outranks one that's merely newer. Recency is only a tie-breaker.
function pollInteractionScore(poll) {
  return poll.totalVotes + poll.commentCount;
}

function sortPollsByInteraction(polls) {
  return polls.sort((a, b) => {
    const diff = pollInteractionScore(b) - pollInteractionScore(a);
    if (diff !== 0) return diff;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

app.get('/api/polls/featured', async (req, res) => {
  try {
    const snap = await fstore.collection('polls').where('status', '==', 'active').limit(50).get();
    const polls = sortPollsByInteraction(await Promise.all(snap.docs.map(pollDocToJson))).slice(0, 3);
    res.json({ polls });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

const DIVIDE_PAGE_SIZE = 5;

app.get('/api/polls', async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  try {
    // status+createdAt would need a manual composite index, so like
    // /api/polls/featured this fetches the active set and ranks/filters it in
    // JS — that query itself is a single cheap read regardless of list size.
    // The expensive part is the per-poll votes-subcollection lookup below
    // (for onlineCounts/myVote), so that's the part actually restricted to
    // one page (DIVIDE_PAGE_SIZE) instead of running for every active poll.
    const snap = await fstore.collection('polls').where('status', '==', 'active').limit(200).get();
    let allPolls = sortPollsByInteraction(snap.docs.map(pollDocToJson));

    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase().trim() : '';
    if (category && category !== 'all') allPolls = allPolls.filter(p => p.category === category);
    if (search) allPolls = allPolls.filter(p => (p.question + ' ' + p.tags.join(' ')).toLowerCase().includes(search));

    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || DIVIDE_PAGE_SIZE));
    const pageOfPolls = allPolls.slice(offset, offset + limit);

    const polls = [];
    for (const poll of pageOfPolls) {
      const votesSnap = await fstore.collection('polls').doc(poll.id).collection('votes').limit(2000).get();
      const voterMap = new Map(); // userId -> optionIndex
      votesSnap.docs.forEach(v => voterMap.set(v.id, v.data().optionIndex));
      poll.onlineCounts = pollOnlineCounts(voterMap, poll.options);
      poll.myVote = voterMap.has(decoded.uid) ? voterMap.get(decoded.uid) : null;
      polls.push(poll);
    }
    res.json({ polls, total: allPolls.length, hasMore: offset + limit < allPolls.length });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/polls', async (req, res) => {
  const decoded = await verifyAdminBearer(req);
  if (!decoded) return res.status(403).json({ error: 'Forbidden' });
  const question = safeStr(req.body?.question, 300);
  const options = Array.isArray(req.body?.options)
    ? req.body.options.map(o => safeStr(o, 120)).filter(Boolean)
    : [];
  const category = DIVIDE_CATEGORIES[req.body?.category] ? req.body.category : 'general';
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags.map(t => safeStr(t, 30)).filter(Boolean).slice(0, DIVIDE_MAX_TAGS)
    : [];
  if (!question) return res.status(400).json({ error: 'Question is required' });
  if (options.length < 2 || options.length > DIVIDE_MAX_OPTIONS)
    return res.status(400).json({ error: `Provide 2-${DIVIDE_MAX_OPTIONS} options` });

  try {
    const votes = {};
    options.forEach((_, i) => { votes[String(i)] = 0; });
    const ref = await fstore.collection('polls').add({
      question, options, votes, status: 'active', category, tags,
      createdBy: decoded.uid, createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    notifyRelevantUsersForNewPoll(ref.id, question, category);
    res.json({ ok: true, id: ref.id });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Bulk import: accepts { polls: [ { question, options, category?, tags? }, ... ] },
// validates each entry with the same rules as the single-poll route above, and
// creates all valid ones. Per-item results are returned so a JSON file with one
// bad entry doesn't silently fail (or block) the rest of the batch.
app.post('/api/polls/bulk', async (req, res) => {
  const decoded = await verifyAdminBearer(req);
  if (!decoded) return res.status(403).json({ error: 'Forbidden' });
  const items = Array.isArray(req.body?.polls) ? req.body.polls : [];
  if (!items.length) return res.status(400).json({ error: 'No polls provided' });
  if (items.length > 200) return res.status(400).json({ error: 'Too many polls in one batch (max 200)' });

  const results = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const question = safeStr(item.question, 300);
    const options = Array.isArray(item.options)
      ? item.options.map(o => safeStr(o, 120)).filter(Boolean)
      : [];
    const category = DIVIDE_CATEGORIES[item.category] ? item.category : 'general';
    const tags = Array.isArray(item.tags)
      ? item.tags.map(t => safeStr(t, 30)).filter(Boolean).slice(0, DIVIDE_MAX_TAGS)
      : [];

    if (!question) { results.push({ index: i, ok: false, error: 'Question is required' }); continue; }
    if (options.length < 2 || options.length > DIVIDE_MAX_OPTIONS) {
      results.push({ index: i, ok: false, error: `Provide 2-${DIVIDE_MAX_OPTIONS} options`, question });
      continue;
    }

    try {
      const votes = {};
      options.forEach((_, idx) => { votes[String(idx)] = 0; });
      const ref = await fstore.collection('polls').add({
        question, options, votes, status: 'active', category, tags,
        createdBy: decoded.uid, createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      notifyRelevantUsersForNewPoll(ref.id, question, category);
      results.push({ index: i, ok: true, id: ref.id, question });
    } catch {
      results.push({ index: i, ok: false, error: 'Server error', question });
    }
  }
  res.json({ results, created: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
});

app.get('/api/admin/polls', async (req, res) => {
  if (!await verifyAdminBearer(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const snap = await fstore.collection('polls').orderBy('createdAt', 'desc').limit(100).get();
    res.json({ polls: await Promise.all(snap.docs.map(pollDocToJson)) });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/polls/:pollId/close', async (req, res) => {
  const decoded = await verifyAdminBearer(req);
  if (!decoded) return res.status(403).json({ error: 'Forbidden' });
  const pollId = safeId(req.params.pollId);
  if (!pollId) return res.status(400).json({ error: 'Invalid poll' });
  try {
    await fstore.collection('polls').doc(pollId).update({ status: 'closed' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

async function deleteCollection(collectionRef, batchSize = 200) {
  const snap = await collectionRef.limit(batchSize).get();
  if (snap.empty) return;
  const batch = fstore.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  if (snap.size >= batchSize) await deleteCollection(collectionRef, batchSize);
}

app.delete('/api/polls/:pollId', async (req, res) => {
  const decoded = await verifyAdminBearer(req);
  if (!decoded) return res.status(403).json({ error: 'Forbidden' });
  const pollId = safeId(req.params.pollId);
  if (!pollId) return res.status(400).json({ error: 'Invalid poll' });
  const pollRef = fstore.collection('polls').doc(pollId);
  try {
    const doc = await pollRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Poll not found' });
    const commentsSnap = await pollRef.collection('comments').get();
    await Promise.all(commentsSnap.docs.map(d => deleteCollection(d.ref.collection('reactorFlags'))));
    await deleteCollection(pollRef.collection('comments'));
    await deleteCollection(pollRef.collection('votes'));
    await pollRef.delete();
    io.emit('poll-deleted', { pollId });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/polls/:pollId/vote', strictLimiter, async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const pollId = safeId(req.params.pollId);
  const optionIndex = safeInt(req.body?.optionIndex, 0, DIVIDE_MAX_OPTIONS - 1);
  if (!pollId || optionIndex === null) return res.status(400).json({ error: 'Invalid request' });

  const pollRef = fstore.collection('polls').doc(pollId);
  const voteRef = pollRef.collection('votes').doc(decoded.uid);
  try {
    const [pollDoc, existingVote] = await Promise.all([pollRef.get(), voteRef.get()]);
    if (!pollDoc.exists) return res.status(404).json({ error: 'Poll not found' });
    if (pollDoc.data().status !== 'active') return res.status(400).json({ error: 'This poll is closed' });
    if (existingVote.exists) return res.status(409).json({ error: 'You already voted on this poll' });
    const options = pollDoc.data().options || [];
    if (optionIndex >= options.length) return res.status(400).json({ error: 'Invalid option' });

    const batch = fstore.batch();
    batch.set(voteRef, { optionIndex, votedAt: admin.firestore.FieldValue.serverTimestamp() });
    batch.update(pollRef, { [`votes.${optionIndex}`]: admin.firestore.FieldValue.increment(1) });
    await batch.commit();

    const updatedDoc = await pollRef.get();
    const json = pollDocToJson(updatedDoc);
    io.emit('poll-vote-update', { pollId, votes: json.votes, totalVotes: json.totalVotes });
    res.json({ ok: true, votes: json.votes });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// -- Comments (flat collection + parentId; client builds the reply tree) --

app.get('/api/polls/:pollId/comments', async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const pollId = safeId(req.params.pollId);
  if (!pollId) return res.status(400).json({ error: 'Invalid poll' });
  try {
    const snap = await fstore.collection('polls').doc(pollId).collection('comments')
      .orderBy('createdAt', 'asc').limit(500).get();
    const myReactions = {};
    await Promise.all(snap.docs.map(async d => {
      const flag = await d.ref.collection('reactorFlags').doc(decoded.uid).get();
      if (flag.exists) myReactions[d.id] = flag.data();
    }));
    const isAdmin = (await fstore.collection('users').doc(decoded.uid).get()).data()?.isAdmin === true;
    const comments = snap.docs.map(d => {
      const c = d.data();
      return {
        id: d.id,
        text: c.deleted ? '[deleted]' : c.text,
        deleted: !!c.deleted,
        authorId: c.authorId,
        authorUsername: c.authorUsername,
        authorAvatarUrl: c.authorAvatarUrl || null,
        parentId: c.parentId || null,
        createdAt: c.createdAt ? c.createdAt.toMillis() : null,
        reactions: c.reactions || { sharp: 0, fairPoint: 0, sourceNeeded: 0 },
        myReactions: myReactions[d.id] || { sharp: false, fairPoint: false, sourceNeeded: false },
        canDelete: !c.deleted && (c.authorId === decoded.uid || isAdmin)
      };
    });
    res.json({ comments, isAdmin });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/polls/:pollId/comments', strictLimiter, async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const pollId = safeId(req.params.pollId);
  const text = safeStr(req.body?.text, 500);
  const parentId = req.body?.parentId ? safeId(req.body.parentId) : null;
  if (!pollId || !text) return res.status(400).json({ error: 'Comment text is required' });

  try {
    const userDoc = await fstore.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    const u = userDoc.data();

    const pollRef = fstore.collection('polls').doc(pollId);
    const commentRef = pollRef.collection('comments').doc();
    const payload = {
      text, authorId: decoded.uid, authorUsername: u.username,
      authorAvatarUrl: u.avatarUrl || null, parentId: parentId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      reactions: { sharp: 0, fairPoint: 0, sourceNeeded: 0 }
    };
    await Promise.all([
      commentRef.set(payload),
      pollRef.update({ commentCount: admin.firestore.FieldValue.increment(1) })
    ]);

    const comment = {
      id: commentRef.id, text, deleted: false, authorId: decoded.uid, authorUsername: u.username,
      authorAvatarUrl: u.avatarUrl || null, parentId: parentId || null,
      createdAt: Date.now(), reactions: { sharp: 0, fairPoint: 0, sourceNeeded: 0 },
      myReactions: { sharp: false, fairPoint: false, sourceNeeded: false }, canDelete: true
    };
    io.emit('poll-comment-new', { pollId, comment });
    res.json({ ok: true, comment });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

const DIVIDE_REACTION_TYPES = ['sharp', 'fairPoint', 'sourceNeeded'];

app.post('/api/polls/:pollId/comments/:commentId/react', strictLimiter, async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const pollId = safeId(req.params.pollId);
  const commentId = safeId(req.params.commentId);
  const type = req.body?.type;
  if (!pollId || !commentId || !DIVIDE_REACTION_TYPES.includes(type))
    return res.status(400).json({ error: 'Invalid request' });

  const commentRef = fstore.collection('polls').doc(pollId).collection('comments').doc(commentId);
  const flagRef = commentRef.collection('reactorFlags').doc(decoded.uid);
  try {
    const result = await fstore.runTransaction(async tx => {
      const [commentDoc, flagDoc] = await Promise.all([tx.get(commentRef), tx.get(flagRef)]);
      if (!commentDoc.exists) throw new Error('not-found');
      const flags = flagDoc.exists ? flagDoc.data() : { sharp: false, fairPoint: false, sourceNeeded: false };
      const nextValue = !flags[type];
      tx.set(flagRef, { ...flags, [type]: nextValue }, { merge: true });
      tx.update(commentRef, { [`reactions.${type}`]: admin.firestore.FieldValue.increment(nextValue ? 1 : -1) });
      const reactions = commentDoc.data().reactions || { sharp: 0, fairPoint: 0, sourceNeeded: 0 };
      reactions[type] = Math.max(0, reactions[type] + (nextValue ? 1 : -1));
      return { reactions, active: nextValue };
    });
    io.emit('poll-comment-reaction', { pollId, commentId, reactions: result.reactions });
    res.json({ ok: true, reactions: result.reactions, active: result.active });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Soft-delete only — a hard delete would orphan any replies underneath a
// deleted comment (buildCommentTree on the client falls back to showing an
// orphan as a top-level comment, which reads as a random disconnected reply
// with no context). Replacing the text and keeping the doc in place keeps
// the reply thread intact, matching how every other threaded-comment UI
// (Reddit, etc.) handles this.
app.delete('/api/polls/:pollId/comments/:commentId', async (req, res) => {
  const decoded = await getAuthUser(req);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
  const pollId = safeId(req.params.pollId);
  const commentId = safeId(req.params.commentId);
  if (!pollId || !commentId) return res.status(400).json({ error: 'Invalid request' });

  const commentRef = fstore.collection('polls').doc(pollId).collection('comments').doc(commentId);
  try {
    const doc = await commentRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Comment not found' });
    const c = doc.data();
    if (c.authorId !== decoded.uid) {
      const isAdmin = (await fstore.collection('users').doc(decoded.uid).get()).data()?.isAdmin === true;
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
    }
    await commentRef.update({ deleted: true, text: '[deleted]' });
    io.emit('poll-comment-deleted', { pollId, commentId });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Cloudflare Turnstile server-side verification
app.post('/api/verify-captcha', express.json(), async (req, res) => {
  const token  = (req.body || {}).token;
  if (!token) return res.json({ success: false, error: 'missing-token' });
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return res.json({ success: true }); // skip in dev when secret not set
  try {
    const form = new URLSearchParams();
    form.append('secret',   secret);
    form.append('response', token);
    form.append('remoteip', getClientIp(req) || '');
    const r    = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form
    });
    const data = await r.json();
    res.json({ success: data.success === true });
  } catch {
    res.json({ success: false, error: 'verification-failed' });
  }
});

// Cookie-consent compliance log. Public/unauthenticated (the banner can appear
// before login), so identity is best-effort: attaches the signed-in uid when a
// valid Firebase ID token is supplied, otherwise just the client-generated
// anonId. No IP address is stored, consistent with the rest of the privacy
// policy's minimal-retention stance.
const CONSENT_VERSION = 1;
app.post('/api/consent', strictLimiter, express.json(), async (req, res) => {
  const { categories, version, timestamp, anonId, idToken } = req.body || {};
  if (!categories || typeof categories !== 'object') return res.status(400).json({ error: 'Invalid categories' });
  if (version !== CONSENT_VERSION) return res.status(400).json({ error: 'Unsupported consent version' });

  let uid = null;
  if (typeof idToken === 'string' && idToken.length <= 4096) {
    const decoded = await verifyFirebaseToken(idToken);
    if (decoded) uid = decoded.uid;
  }

  try {
    await fstore.collection('consentLogs').add({
      uid,
      anonId: typeof anonId === 'string' ? anonId.slice(0, 100) : null,
      version: CONSENT_VERSION,
      categories: {
        essential: true,
        functional: !!categories.functional,
        analytics: !!categories.analytics,
        thirdParty: !!categories.thirdParty
      },
      clientTimestamp: typeof timestamp === 'number' ? timestamp : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Returns the visitor's detected country code using ip-api.com (free tier)
app.get('/api/my-country', async (req, res) => {
  const ip = getClientIp(req);
  if (!ip || ip === '::1' || ip === '127.0.0.1') return res.json({ country: '' });
  try {
    const r = await fetch('http://ip-api.com/json/' + ip + '?fields=country');
    const d = await r.json();
    res.json({ country: d.country || '' });
  } catch {
    res.json({ country: '' });
  }
});

app.post('/api/leave', express.json(), (req, res) => {
  const { roomId, userId } = req.body || {};
  if (roomId && userId) {
    const room = rooms.get(roomId);
    if (room && room.users.some(u => u.userId === userId)) {
      const slot = room.users.find(u => u.userId === userId);
      closeRoom(roomId, slot?.socketId || null, 'disconnect');
    }
  }
  res.status(204).end();
});

app.get('/api/invite/:token', (req, res) => {
  const data = inviteTokens.get(req.params.token);
  if (!data || data.expiresAt < Date.now()) return res.json({ valid: false });
  res.json({ valid: true, hostUsername: data.hostUsername, expiresAt: data.expiresAt });
});

app.get('/favicon.ico', (_, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(path.join(__dirname, 'public', 'favicon.png'));
});

const OPENROUTER_KEY   = process.env.OPENROUTER_API_KEY;
const SUGGEST_MODEL    = 'liquid/lfm-2.5-1.2b-instruct:free';
const FALLBACK_MODEL   = 'liquid/lfm-2.5-1.2b-instruct:free';
const OR_RATE_LIMITED  = Symbol('rate-limited');

const TOPIC_AI_ERROR = 'Error creating topic question, Can be a model rate limit or a server error.';

// -- Matchmaking AI system prompt (drives topic + personalised notifications) --
const MATCHMAKING_SYSTEM = `You are the matchmaking engine for ArgueOut, a live debate platform that pairs strangers who disagree with each other on purpose. Your job has three parts:

1. Evaluate compatibility between two users based on their profiles.
2. Recommend a debate topic that captures the sharpest, most genuine point of disagreement between them.
3. Write the notification message that gets sent to each user inviting them to the debate.

## What you're given

For each of the two users, you'll receive:
- Username
- Age
- Gender
- Country
- Religion
- Beliefs (a list or description of stated opinions/positions on various topics)

## How to evaluate compatibility

Your matching priority is strength of opposing views on the same topic — not similarity, not shared interests. The best match is two users who clearly hold opposite, strongly-stated positions on a topic they've both expressed an opinion about.

When comparing two users:
- Look across all the topics/beliefs both users have expressed an opinion on.
- Identify topics where their positions are in real tension — not just "different," but actually opposed.
- Prefer topics where both users seem to hold their position with conviction (strong wording, clear stance) over topics where one or both seem lukewarm or vague.
- If users overlap on multiple topics with strong disagreement, pick the one disagreement that seems most debatable in a live format — specific and arguable, not a vague values mismatch.
- If there's no real opposition anywhere (the users mostly agree or don't have comparable beliefs on file), say so plainly rather than forcing a weak match — score it low and explain why.

Demographic fields (age, gender, country, religion) are context, not the basis for matching. Don't use them to manufacture a topic, and never frame a recommended topic as "your religion vs their religion" or similar — the topic should always come from an actual stated belief, not an inferred stereotype based on someone's background.

## Output

Return a JSON object with exactly these fields:
- score: number 0-10 (how strong and debate-worthy the opposition is)
- topic: string (the recommended debate question, phrased as a clear specific question or proposition, max 15 words)
- reason: string (one-line why this topic — what each side actually believes, max 12 words)
- notification_a: string (notification for User A, 1-2 sentences)
- notification_b: string (notification for User B, 1-2 sentences)

## Writing the notification messages

These are short push-style notifications, not emails:
- 1-2 sentences, punchy, makes the person want to tap in.
- Tease the disagreement, don't summarize it neutrally.
- Personalize using the topic, not the demographics. Never reference the other user's age, gender, religion, or country — only the topic and the fact that someone disagrees.
- Each user gets their own version, written from their side of the disagreement.
- No hedging, no "we noticed that..." or AI-sounding phrasing. Sound like a sharp, slightly provocative app notification.

## Boundaries

- Never recommend a topic that targets a person's protected characteristics. Topics must come from a stated belief/opinion, not an identity attribute itself.
- Avoid recommending topics that are dehumanizing framings dressed up as debate. If the only disagreement available is along those lines, score it low and say why.
- If a user's belief data is too sparse, don't fabricate one — say so in the reason field and give a low score.

Respond ONLY with valid JSON, no markdown fences.`;

const SUGGEST_SYSTEM = `You are ArgueOut's debate igniter. Pick the most explosive opponent pairing and write a debate question.

Selection: maximise political compass distance, then demographic contrast (age, religion, country).

Question rules - most important part:
- One direct yes/no or either/or debate question. Max 12 words.
- The kind of question that immediately splits a room - everyone has an instinctive answer and no one agrees.
- Phrase as "Is X a Y?", "Should we Z?", "Was X Y?", "Does X actually Y?", "Is X or X?"
- GOOD: "Is food a right or a privilege?", "Should we risk the meat industry to save the environment?", "Is abortion healthcare?", "Was Jesus a good person?", "Does capitalism help or hurt the poor?", "Should drugs be legal?", "Is religion doing more harm than good?", "Should borders be open?"
- BAD: "What if borders didn't exist?", "Why do we let flags define us?", "How did we end up here?" - too vague, no one can disagree cleanly

Reason: max 8 words, one punchy clause describing the contrast, no period.
Tags: 2-3 words each, name the specific clash. Examples: "God vs State", "Polar compass", "Class war", "Faith clash", "Border wars".

Respond ONLY with valid JSON, no markdown:
{
  "username": "<selected candidate username>",
  "tags": ["<tag1>", "<tag2>", "<tag3>"],
  "reason": "<max 8 words>",
  "question": "<direct debate question, max 12 words>"
}`;

const QUESTION_GEN_SYSTEM = `Generate one debate question. It must be a direct question that immediately splits a room.
Phrase as "Is X a Y?", "Should we Z?", "Was X Y?", "Does X actually Y?", "Is it X or X?"
Examples: "Is food a right or a privilege?", "Should we risk the meat industry to save the environment?", "Is abortion healthcare?", "Was Jesus a good person?", "Does capitalism help or hurt the poor?", "Should drugs be legal?", "Is religion doing more harm than good?"
One sentence, max 12 words. No hedging. No "what do you think." Respond ONLY with valid JSON: {"question": "<question here>"}`;

// -- OpenRouter shared caller ----------------------------------

async function callOpenRouterOnce(fnName, body) {
  const t0   = Date.now();
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 30000);
  try {
    console.log(`[OR:${fnName}] -> ${body.model}  max_tokens=${body.max_tokens}`);
    const res  = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://argueout.app',
        'X-Title': 'ArgueOut'
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const ms   = Date.now() - t0;
    const text = await res.text();
    console.log(`[OR:${fnName}] <- ${res.status} in ${ms}ms | ${text.slice(0, 600)}`);
    if (res.status === 429) return OR_RATE_LIMITED;
    if (!res.ok) return null;
    try { return JSON.parse(text); } catch { return null; }
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`[OR:${fnName}] ✗ ${ms}ms - ${err.name === 'AbortError' ? 'TIMEOUT (30s)' : err.message}`);
    return null;
  } finally {
    clearTimeout(tid);
  }
}

async function callOpenRouter(fnName, body) {
  const result = await callOpenRouterOnce(fnName, body);
  if (result === OR_RATE_LIMITED) {
    console.log(`[OR:${fnName}] primary rate-limited - switching to fallback model immediately`);
    const fb = await callOpenRouterOnce(`${fnName}:fb`, { ...body, model: FALLBACK_MODEL });
    return fb === OR_RATE_LIMITED ? null : fb;
  }
  return result;
}

function extractQuestion(data) {
  const raw      = (data?.choices?.[0]?.message?.content || '').trim();
  const stripped = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(stripped); } catch (_) {}
  if (!parsed) {
    const matches = [...stripped.matchAll(/\{[^{}]*"question"[^{}]*\}/gs)];
    for (let i = matches.length - 1; i >= 0; i--) {
      try { parsed = JSON.parse(matches[i][0]); break; } catch (_) {}
    }
  }
  return parsed?.question || null;
}

async function generateDebateQuestion(hint) {
  const userMsg = hint
    ? `Generate a debate question about or related to this topic: "${hint}". Use the same format - direct, divisive, answerable from opposing sides.`
    : 'Generate a debate question for two people with opposing political views.';
  const data = await callOpenRouter('genQuestion', {
    model: SUGGEST_MODEL,
    messages: [
      { role: 'system', content: QUESTION_GEN_SYSTEM },
      { role: 'user',   content: userMsg }
    ],
    temperature: 0.9,
    max_tokens: 256
  });
  return extractQuestion(data);
}

function fmtUser(u) {
  const econ   = (u.politicalX || 0) >= 0 ? 'Economic Right' : 'Economic Left';
  const social = (u.politicalY || 0) >= 0 ? 'Authoritarian'  : 'Libertarian';
  return [
    `Username: ${u.username}`,
    `Political compass: X=${(u.politicalX||0).toFixed(2)} (${econ}), Y=${(u.politicalY||0).toFixed(2)} (${social})`,
    u.age      ? `Age: ${u.age}`           : null,
    u.gender   ? `Gender: ${u.gender}`     : null,
    u.religion ? `Religion: ${u.religion}` : null,
    u.country  ? `Country: ${u.country}`   : null,
  ].filter(Boolean).join(', ');
}

function fmtUserForMatchmaking(u) {
  const econ   = (u.politicalX || 0) >= 0 ? 'Economic Right' : 'Economic Left';
  const social = (u.politicalY || 0) >= 0 ? 'Authoritarian'  : 'Libertarian';
  const lines = [
    `Username: ${u.username || 'unknown'}`,
    `Political position: ${econ}, ${social}`,
  ];
  if (u.age)                                          lines.push(`Age: ${u.age}`);
  if (u.gender   && u.gender   !== 'prefer_not_to_say') lines.push(`Gender: ${u.gender}`);
  if (u.country  && u.country.trim())                 lines.push(`Country: ${u.country}`);
  if (u.religion && u.religion !== 'prefer_not_to_say') lines.push(`Religion: ${u.religion}`);
  if (u.bio      && u.bio.trim())                     lines.push(`Beliefs: ${u.bio.trim()}`);
  return lines.join('\n');
}

async function runMatchmakingAI(user1, user2) {
  const userMsg = `Evaluate this debate pairing:\n\nUser A:\n${fmtUserForMatchmaking(user1)}\n\nUser B:\n${fmtUserForMatchmaking(user2)}`;
  const data = await callOpenRouter('matchmaking', {
    model: SUGGEST_MODEL,
    messages: [
      { role: 'system', content: MATCHMAKING_SYSTEM },
      { role: 'user',   content: userMsg }
    ],
    temperature: 0.85,
    max_tokens: 600
  });
  if (!data) return null;
  const raw      = (data?.choices?.[0]?.message?.content || '').trim();
  const stripped = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(stripped); } catch {}
  if (!parsed) {
    const ms = [...stripped.matchAll(/\{[\s\S]*?"topic"[\s\S]*?\}/g)];
    for (let i = ms.length - 1; i >= 0; i--) { try { parsed = JSON.parse(ms[i][0]); break; } catch {} }
  }
  if (parsed?.topic && parsed?.notification_a && parsed?.notification_b) return parsed;
  return null;
}

async function generateDebateQuestionForPair(user1, user2) {
  const userMsg = `Debate pair - generate the most explosive question for these exact two opponents:\n1. ${fmtUser(user1)}\n2. ${fmtUser(user2)}\n\nFocus on maximising the clash between their profiles. Output the question field only - do not pick a username.`;
  const data = await callOpenRouter('genPairQuestion', {
    model: SUGGEST_MODEL,
    messages: [
      { role: 'system', content: SUGGEST_SYSTEM },
      { role: 'user',   content: userMsg }
    ],
    temperature: 0.9,
    max_tokens: 400
  });
  return extractQuestion(data);
}

app.post('/api/suggest-opponent', strictLimiter, async (req, res) => {
  const { idToken, seenUserIds } = req.body || {};
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4096)
    return res.status(401).json({ error: 'No token' });

  const decoded = await verifyFirebaseToken(idToken);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });

  // Find current user in online map (dedup by userId)
  let currentUser = null;
  for (const u of onlineUsers.values()) {
    if (u.userId === decoded.uid) { currentUser = u; break; }
  }
  if (!currentUser) {
    console.log(`suggest-opponent: user ${decoded.uid} not in onlineUsers (${onlineUsers.size} entries)`);
    return res.status(404).json({ error: 'Not online' });
  }

  // Client sends userIds already seen in previous sessions (persisted in localStorage)
  const clientSeen = Array.isArray(seenUserIds)
    ? seenUserIds.filter(id => typeof id === 'string' && id.length < 200).slice(0, 500)
    : [];

  // Gather candidates: other online users, not in debate, not already suggested or debated
  const excluded = new Set([
    decoded.uid,
    ...(suggestedMap.get(decoded.uid) || []),
    ...(debatedMap.get(decoded.uid)   || []),
    ...clientSeen
  ]);
  const seen = new Set([decoded.uid]);
  const candidates = [];
  for (const u of onlineUsers.values()) {
    if (seen.has(u.userId) || u.inDebate || excluded.has(u.userId)) continue;
    seen.add(u.userId);
    candidates.push(u);
  }
  if (!candidates.length) {
    console.log(`suggest-opponent: no candidates for ${decoded.uid} (${onlineUsers.size} total online, ${excluded.size - 1} excluded)`);
    return res.status(404).json({ error: 'No candidates' });
  }

  // Take up to 8 for the API call
  const sample = candidates.slice(0, 8);

  const userMsg = `Viewer: ${fmtUser(currentUser)}\n\nCandidates:\n${sample.map((c, i) => `${i + 1}. ${fmtUser(c)}`).join('\n')}`;

  const data = await callOpenRouter('suggestOpponent', {
    model: SUGGEST_MODEL,
    messages: [
      { role: 'system', content: SUGGEST_SYSTEM },
      { role: 'user',   content: userMsg }
    ],
    temperature: 0.75,
    max_tokens: 400
  });

  if (!data) return res.status(500).json({ error: 'Suggestion failed' });

  const raw      = (data.choices?.[0]?.message?.content || '').trim();
  if (!raw) {
    console.error('[OR:suggestOpponent] empty content - full data:', JSON.stringify(data));
    return res.status(500).json({ error: 'No suggestion returned' });
  }

  const stripped = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(stripped); } catch (_) {}
  if (!parsed) {
    const matches = [...stripped.matchAll(/\{[^{}]*"username"[^{}]*\}/gs)];
    for (let i = matches.length - 1; i >= 0; i--) {
      try { parsed = JSON.parse(matches[i][0]); break; } catch (_) {}
    }
  }
  if (!parsed) {
    console.error('[OR:suggestOpponent] JSON parse failed. Raw:', raw);
    return res.status(500).json({ error: 'Suggestion parse failed' });
  }

  const match = sample.find(c => c.username === parsed.username) || sample[0];
  addSuggested(decoded.uid, match.userId);
  res.json({
    username:  match.username,
    userId:    match.userId,
    name:      match.name || match.username,
    avatarUrl: match.avatarUrl || null,
    tags:      parsed.tags  || [],
    reason:    parsed.reason || '',
    question:  parsed.question || ''
  });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// -- In-memory state -------------------------------------------

// socketId -> { userId, username, politicalX, politicalY }
const queue = new Map();

// roomId -> { users: [ { userId, username, politicalX, politicalY, socketId } ] }
const rooms = new Map();

// branchId -> { parentRoomId, question, members: [{socketId, username}] }
const branches = new Map();

// socketId -> user info (minimal, for matchmaking/chat)
const socketUsers = new Map();

// socketId -> full profile (for online directory & challenges)
const onlineUsers = new Map();

// invite token -> { hostUserId, hostUsername, expiresAt }
const inviteTokens = new Map();

// userId -> Set<targetUserId>  - who was suggested to whom (excluded from future suggestions)
const suggestedMap = new Map();
// userId -> Set<targetUserId>  - who debated whom (also excluded)
const debatedMap   = new Map();
// challengerSocketId -> question string  - question attached to pending challenge
const pendingQuestions = new Map();
// roomId -> Set<userId>  - who has declined the current question
const roomDeclines = new Map();
// roomId -> { fromSocketId, fromUsername, suggestion }
const roomPendingSuggestion = new Map();
// roomId -> Set<userId>  - who has requested a new question (both must agree)
const roomQuestionRequests = new Map();
// roomId -> Timeout — per-room structured-turn countdown
const roomTurnTimers = new Map();
// roomId -> Set<userId> — who has requested free-debate mode
const roomFreeRequests = new Map();
// roomId -> Set<userId> — who has requested private mode (both must agree)
const roomPrivateRequests = new Map();
// "roomId:userId" -> Timeout — grace period before closing room on disconnect
const roomDisconnectTimers = new Map();

function addSuggested(userId, targetUserId) {
  if (!suggestedMap.has(userId)) suggestedMap.set(userId, new Set());
  suggestedMap.get(userId).add(targetUserId);
}

function addDebated(userId1, userId2) {
  if (!debatedMap.has(userId1)) debatedMap.set(userId1, new Set());
  debatedMap.get(userId1).add(userId2);
  if (!debatedMap.has(userId2)) debatedMap.set(userId2, new Set());
  debatedMap.get(userId2).add(userId1);
}

function startTurn(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.turnMode !== 'structured') return;
  const speaker = room.users[room.currentSpeakerIdx];
  io.to(roomId).emit('turn-start', {
    speakerSocketId: speaker.socketId,
    speakerUsername:  speaker.username,
    turnNumber:       room.turnNumber,
    duration:         60
  });
  clearTimeout(roomTurnTimers.get(roomId));
  roomTurnTimers.set(roomId, setTimeout(() => advanceTurn(roomId), 60000));
}

function advanceTurn(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.turnMode !== 'structured') return;
  room.currentSpeakerIdx = 1 - room.currentSpeakerIdx;
  room.turnNumber++;
  startTurn(roomId);
}
setInterval(() => {
  const now = Date.now();
  for (const [t, d] of inviteTokens) if (d.expiresAt < now) inviteTokens.delete(t);

  // The Divide: sweep pending challenges past their 15-minute window. A
  // Firestore scheduled Cloud Function would run independent of this
  // process's uptime, but this app has no Functions deployment at all today
  // (firebase-admin only) — piggybacking on the keep-alive-adjacent 60s loop
  // that already exists here is the pragmatic match for the current infra.
  // Filtered by status only (a single equality filter needs no manual
  // composite index); the expiresAt < now check runs in JS afterward — an
  // .where('expiresAt','<',now) combined with the status filter would need
  // one, and this feature doesn't have enough concurrent pending challenges
  // to justify that setup step.
  fstore.collection('challenges').where('status', '==', 'pending')
    .limit(500).get().then(snap => {
      snap.docs.filter(d => d.data().expiresAt < now).forEach(d => {
        d.ref.update({ status: 'expired' }).then(() => {
          notifyDivideChallenger(
            { ...d.data(), id: d.id },
            `They may not have seen it — challenge someone new?`
          );
        }).catch(() => {});
      });
    }).catch(err => console.error('[divide-challenge sweep] error:', err.message));
}, 60000);

function broadcastOnlineUsers() {
  // Deduplicate by userId - keep the most recent entry (last socketId wins)
  const seen = new Map();
  for (const u of onlineUsers.values()) {
    const existing = seen.get(u.userId);
    // prefer inDebate=true entries so status is accurate
    if (!existing || u.inDebate) seen.set(u.userId, u);
  }
  const list = [...seen.values()].map(u => ({
    userId:     u.userId,
    username:   u.username,
    name:       u.name || u.username,
    avatarUrl:  u.avatarUrl || null,
    politicalX: u.politicalX || 0,
    politicalY: u.politicalY || 0,
    age:        u.age,
    gender:     u.gender,
    religion:   u.religion,
    country:    u.country || '',
    bio:        u.bio || '',
    inDebate:   u.inDebate || false
  }));
  io.emit('online-users', list);
}

// -- The Divide: challenge-expiry helpers (top-level so the sweep interval
// below can call them without needing a live socket connection) -----------

async function notifyDivideChallenger(challenge, message) {
  fstore.collection('notifications').doc(challenge.challengerId).collection('items').add({
    type: 'divide-challenge-update', message, read: false,
    pollId: challenge.pollId, createdAt: admin.firestore.FieldValue.serverTimestamp()
  }).catch(() => {});
  const entry = [...onlineUsers.entries()].find(([, u]) => u.userId === challenge.challengerId);
  if (entry) io.to(entry[0]).emit('divide-challenge-update', { challengeId: challenge.id, pollId: challenge.pollId, message });
}

// Expires a user's own pending INCOMING divide challenges the moment they
// enter a different debate (queue match, direct challenge, invite, etc.)
// rather than making challengers wait out the full 15-minute timer.
async function expireIncomingDivideChallengesForUser(userId) {
  try {
    const snap = await fstore.collection('challenges')
      .where('challengedId', '==', userId).where('status', '==', 'pending').limit(50).get();
    await Promise.all(snap.docs.map(async d => {
      await d.ref.update({ status: 'expired' });
      notifyDivideChallenger(
        { ...d.data(), id: d.id },
        `${d.data().challengedUsername} joined another debate before responding — challenge someone new?`
      );
    }));
  } catch (err) { console.error('[expireIncomingDivideChallengesForUser] error:', err.message); }
}

// Targeted new-poll notifications: rather than blasting every user for every
// poll, score each user's likely interest from data we actually already
// collect (their compass position) and only notify the most-relevant slice.
// - 'economic' polls -> ranked by |politicalX| (strength of economic lean)
// - 'social' polls    -> ranked by |politicalY| (strength of social lean)
// - other categories  -> ranked by overall distance from center on both axes
// (general engagement, since there's no dedicated axis for those topics)
const DIVIDE_NOTIFY_TOP_N = 30;

async function notifyRelevantUsersForNewPoll(pollId, question, category) {
  try {
    const usersSnap = await fstore.collection('users').limit(500).get();
    const scored = [];
    usersSnap.docs.forEach(doc => {
      const d = doc.data();
      if (!d.compassSet) return; // no compass position to score against
      const x = d.politicalX || 0, y = d.politicalY || 0;
      const score = category === 'economic' ? Math.abs(x)
                  : category === 'social'   ? Math.abs(y)
                  : Math.abs(x) + Math.abs(y);
      scored.push({ userId: doc.id, score });
    });
    scored.sort((a, b) => b.score - a.score);
    const targets = scored.slice(0, DIVIDE_NOTIFY_TOP_N);
    const message = `New poll: "${question}" — where do you stand?`;

    await Promise.all(targets.map(async t => {
      fstore.collection('notifications').doc(t.userId).collection('items').add({
        type: 'new-poll', message, pollId, read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
      const entry = [...onlineUsers.entries()].find(([, u]) => u.userId === t.userId);
      if (entry) io.to(entry[0]).emit('divide-poll-notification', { pollId, question, message });
    }));
  } catch (err) { console.error('[notifyRelevantUsersForNewPoll] error:', err.message); }
}

// Per-IP socket connection rate limiting (max 20 connections per IP per minute)
const _socketConnectCounts = new Map();
setInterval(() => _socketConnectCounts.clear(), 60000);

// -- Socket.io -------------------------------------------------

io.on('connection', socket => {
  const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address || '';
  socket.data.ip = clientIp;
  socket.data.isAdmin = false;
  socket.data.userId  = null;

  // IP ban check
  if (clientIp && bannedIpSet.has(clientIp)) {
    socket.emit('account-banned', { message: 'Your IP address has been banned.', until: null });
    socket.disconnect(true);
    return;
  }

  // Connection-rate limiting per IP (bot / DoS protection)
  if (clientIp) {
    const prev = _socketConnectCounts.get(clientIp) || 0;
    if (prev >= 20) {
      socket.disconnect(true);
      return;
    }
    _socketConnectCounts.set(clientIp, prev + 1);
  }

  // -- Auth ----------------------------------------------------
  socket.on('authenticate', async ({ idToken }) => {
    // Rate-limit authentication attempts (max 5 per minute per socket)
    if (!socketAllow(socket.id, 'authenticate', 5)) {
      socket.emit('auth-error', { error: 'Too many authentication attempts.' });
      return;
    }
    const decoded = await verifyFirebaseToken(idToken);
    if (!decoded) { socket.emit('auth-error', { error: 'Invalid token' }); return; }

    let userData;
    try {
      const doc = await fstore.collection('users').doc(decoded.uid).get();
      if (!doc.exists) { socket.emit('auth-error', { error: 'User not found' }); return; }
      userData = doc.data();
    } catch {
      socket.emit('auth-error', { error: 'Database error' }); return;
    }

    // -- Ban check ----------------------------------------------
    if (userData.banned) {
      const bannedUntil = userData.bannedUntil ? userData.bannedUntil.toDate() : null;
      if (!bannedUntil || bannedUntil > new Date()) {
        socket.emit('account-banned', {
          message: bannedUntil
            ? 'Your account has been temporarily suspended.'
            : 'Your account has been permanently banned.',
          until: bannedUntil ? bannedUntil.toISOString() : null
        });
        return;
      }
      // Expired ban - auto-lift
      await fstore.collection('users').doc(decoded.uid).update({ banned: false, bannedUntil: null });
    }

    // Cache auth state on the socket for fast lookups (no repeated Firestore reads)
    socket.data.userId  = decoded.uid;
    socket.data.isAdmin = userData.isAdmin === true;

    socketUsers.set(socket.id, {
      userId:     decoded.uid,
      username:   userData.username,
      politicalX: userData.politicalX || 0,
      politicalY: userData.politicalY || 0
    });

    onlineUsers.set(socket.id, {
      userId:     decoded.uid,
      username:   userData.username,
      name:       userData.name || userData.username,
      avatarUrl:  userData.avatarUrl || null,
      politicalX: userData.politicalX || 0,
      politicalY: userData.politicalY || 0,
      age:        userData.age,
      gender:     userData.gender,
      religion:   userData.religion,
      country:    userData.country || '',
      bio:        userData.bio || '',
      inDebate:   false
    });
    broadcastOnlineUsers();

    socket.emit('authenticated', { userId: decoded.uid, username: userData.username });

    // Deliver any pending (unread) admin notifications from Firestore.
    // Scoped to type=='admin' specifically — this collection now also holds
    // other notification kinds (e.g. challenges) that must NOT be relabeled
    // and surfaced through the admin-message toast/badge flow below.
    try {
      const notifSnap = await fstore.collection('notifications').doc(decoded.uid)
        .collection('items').where('read', '==', false).where('type', '==', 'admin').limit(20).get();
      if (!notifSnap.empty) {
        const batch = fstore.batch();
        const messages = [];
        notifSnap.docs.forEach(d => {
          const msg = d.data().message;
          if (msg) messages.push(msg);
          batch.update(d.ref, { read: true });
        });
        if (messages.length) socket.emit('admin-notifications-pending', { messages });
        await batch.commit();
      }
    } catch (err) {
      console.error('[auth] pending notifications error:', err.message);
    }
  });

  // -- Matchmaking ----------------------------------------------

  socket.on('join-queue', () => {
    const me = socketUsers.get(socket.id);
    if (!me || queue.has(socket.id)) return;
    queue.set(socket.id, me);
    socket.emit('queue-joined', { size: queue.size });
    io.emit('queue-size', { size: queue.size });
    attemptMatch(socket.id);
  });

  socket.on('leave-queue', () => {
    queue.delete(socket.id);
    socket.emit('queue-left');
    io.emit('queue-size', { size: queue.size });
  });

  // -- Rejoin debate room after page navigation -----------------

  socket.on('join-debate-room', async ({ idToken, roomId }) => {
    const decoded = await verifyFirebaseToken(idToken);
    if (!decoded) { socket.emit('auth-error', { error: 'Invalid token' }); return; }

    const room = rooms.get(roomId);
    if (!room) { socket.emit('room-not-found'); return; }

    const slot = room.users.find(u => u.userId === decoded.uid);
    if (!slot) { socket.emit('room-not-found'); return; }

    // Cancel any pending disconnect grace-period timer for this user
    const timerKey = `${roomId}:${decoded.uid}`;
    const pendingTimer = roomDisconnectTimers.get(timerKey);
    if (pendingTimer) { clearTimeout(pendingTimer); roomDisconnectTimers.delete(timerKey); }

    // Register this debate-page socket in the slot and Socket.io room
    slot.socketId = socket.id;
    socketUsers.set(socket.id, {
      userId:     decoded.uid,
      username:   slot.username,
      politicalX: slot.politicalX,
      politicalY: slot.politicalY
    });
    socket.join(roomId);

    // Send personalised match notification if AI has already finished
    const matchNotif = room.matchNotifications?.[decoded.uid];
    if (matchNotif) socket.emit('match-notification', { notification: matchNotif, topic: room.question });

    const entry = onlineUsers.get(socket.id);
    if (entry) { entry.inDebate = true; broadcastOnlineUsers(); expireIncomingDivideChallengesForUser(decoded.uid); }

    const connected = room.users.filter(u => u.socketId !== null);
    if (connected.length === 2) {
      const [u1, u2] = room.users;
      io.to(u1.socketId).emit('start-webrtc', {
        isInitiator: true,
        opponent: { username: u2.username, politicalX: u2.politicalX, politicalY: u2.politicalY }
      });
      io.to(u2.socketId).emit('start-webrtc', {
        isInitiator: false,
        opponent: { username: u1.username, politicalX: u1.politicalX, politicalY: u1.politicalY }
      });
      room.startedAt = Date.now();
      // Start structured turn system after a brief setup window
      room.turnMode         = 'structured';
      room.currentSpeakerIdx = Math.random() < 0.5 ? 0 : 1;
      room.turnNumber       = 1;
      setTimeout(() => startTurn(roomId), 3000);
    } else {
      socket.emit('waiting-for-opponent');
      // If this is an invite room and the host just joined, tell the waiting guest to navigate
      if (room.guestInviteSocketId) {
        io.to(room.guestInviteSocketId).emit('invite-start', { roomId });
        room.guestInviteSocketId = null;
      }
    }
  });

  // -- WebRTC signaling -----------------------------------------

  socket.on('webrtc-offer', ({ roomId, offer }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
    if (other) io.to(other.socketId).emit('webrtc-offer', { offer });
  });

  socket.on('webrtc-answer', ({ roomId, answer }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
    if (other) io.to(other.socketId).emit('webrtc-answer', { answer });
  });

  socket.on('webrtc-ice', ({ roomId, candidate }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
    if (other) io.to(other.socketId).emit('webrtc-ice', { candidate });
  });

  // -- Chat -----------------------------------------------------

  socket.on('chat-message', ({ roomId, message, imageData, imageId, imageName }) => {
    // Rate limit: max 30 chat messages per minute per socket
    if (!socketAllow(socket.id, 'chat-message', 30)) return;

    const room = rooms.get(roomId);
    if (!room) return;
    const me = socketUsers.get(socket.id);
    // Verify the sender actually belongs to this room
    if (!room.users.some(u => u.socketId === socket.id)) return;

    const payload = {
      from:      socket.id,
      username:  me?.username ?? 'Unknown',
      message:   safeStr(message, 500),
      timestamp: new Date().toISOString()
    };

    // Image base64 — validate size (max 2 MB) before relaying
    if (imageData && imageId) {
      if (typeof imageData !== 'string' || imageData.length > 2 * 1024 * 1024) return;
      const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
      if (other) {
        io.to(other.socketId).emit('chat-message', {
          ...payload,
          imageData,
          imageId:   safeStr(imageId, 64),
          imageName: safeStr(imageName || 'image', 100)
        });
      }
      return;
    }

    io.to(roomId).emit('chat-message', payload);
  });

  // -- End debate ------------------------------------------------

  socket.on('end-debate', ({ roomId }) => closeRoom(roomId, socket.id, 'ended'));

  // -- Turn system -----------------------------------------------

  socket.on('turn-pass', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.turnMode !== 'structured') return;
    if (room.users[room.currentSpeakerIdx]?.socketId !== socket.id) return;
    advanceTurn(roomId);
  });

  socket.on('request-free-debate', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const me = socketUsers.get(socket.id);
    if (!me) return;
    if (!roomFreeRequests.has(roomId)) roomFreeRequests.set(roomId, new Set());
    roomFreeRequests.get(roomId).add(me.userId);
    const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
    if (other) io.to(other.socketId).emit('free-debate-requested', { fromUsername: me.username });
  });

  socket.on('request-to-speak', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.turnMode !== 'structured') return;
    const me = socketUsers.get(socket.id);
    if (!me) return;
    if (room.users[room.currentSpeakerIdx]?.socketId === socket.id) return;
    const speaker = room.users[room.currentSpeakerIdx];
    if (speaker?.socketId) io.to(speaker.socketId).emit('speak-requested', { fromUsername: me.username });
  });

  socket.on('accept-free-debate', ({ roomId, accepted }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (!accepted) {
      const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
      if (other) io.to(other.socketId).emit('free-debate-declined');
      roomFreeRequests.delete(roomId);
      return;
    }
    room.turnMode = 'free';
    clearTimeout(roomTurnTimers.get(roomId));
    roomTurnTimers.delete(roomId);
    roomFreeRequests.delete(roomId);
    io.to(roomId).emit('debate-mode-free');
  });

  // -- Private debate (mutual agreement) -------------------------

  socket.on('request-private-debate', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.private) return;
    const me = socketUsers.get(socket.id);
    if (!me) return;
    if (!roomPrivateRequests.has(roomId)) roomPrivateRequests.set(roomId, new Set());
    roomPrivateRequests.get(roomId).add(me.userId);
    const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
    if (other) io.to(other.socketId).emit('private-debate-requested', { fromUsername: me.username });
  });

  socket.on('accept-private-debate', ({ roomId, accepted }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (!accepted) {
      const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
      if (other) io.to(other.socketId).emit('private-debate-declined');
      roomPrivateRequests.delete(roomId);
      return;
    }
    room.private = true;
    roomPrivateRequests.delete(roomId);
    // Going private is for the debaters only — remove anyone currently watching
    if (room.spectators && room.spectators.length) {
      room.spectators.forEach(spec => {
        io.to(spec.socketId).emit('spectator-kicked', { reason: 'private' });
        const targetSock = io.sockets.sockets.get(spec.socketId);
        if (targetSock) { targetSock.leave(roomId); targetSock.data.spectatingRoom = null; }
      });
      room.spectators = [];
    }
    io.to(roomId).emit('debate-mode-private');
  });

  // -- Challenge system -----------------------------------------

  socket.on('send-challenge', ({ targetUserId, question }) => {
    if (!socketAllow(socket.id, 'send-challenge', 10)) return;
    const me = onlineUsers.get(socket.id);
    if (!me) return;
    const safeTarget = safeId(targetUserId);
    if (!safeTarget) return;
    // Find target - prefer lobby (not-inDebate) socket
    const entries = [...onlineUsers.entries()].filter(([, u]) => u.userId === safeTarget);
    if (!entries.length) { socket.emit('challenge-error', { error: 'User is no longer online.' }); return; }
    const lobbyEntry = entries.find(([, u]) => !u.inDebate) || entries[0];
    const [targetSocketId, targetUser] = lobbyEntry;
    if (targetUser.inDebate) { socket.emit('challenge-error', { error: 'That user is currently in a debate.' }); return; }
    if (question) pendingQuestions.set(socket.id, String(question).slice(0, 300));
    io.to(targetSocketId).emit('challenge-received', {
      from:     { socketId: socket.id, userId: me.userId, username: me.username },
      question: question || null
    });
    // Also persist to Firestore: the in-app bell dropdown is live/in-memory
    // only, but on mobile the bell navigates to the separate /notifications
    // page instead, which reads from here. Without this write that page
    // showed "All clear" even right after a challenge actually arrived.
    const notifMsg = question
      ? `${me.username} challenged you! "${question}"`
      : `${me.username} challenged you to a debate!`;
    fstore.collection('notifications').doc(safeTarget).collection('items').add({
      type: 'challenge', message: notifMsg, read: false,
      fromUserId: me.userId, fromUsername: me.username, question: question || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.error('[send-challenge] notif persist error:', err.message));
  });

  function createDebateRoomForChallenge(challenger, me, question, s1, s2) {
    const roomId = uuidv4();
    rooms.set(roomId, {
      users: [
        { userId: challenger.userId, username: challenger.username, politicalX: challenger.politicalX, politicalY: challenger.politicalY, socketId: null },
        { userId: me.userId,         username: me.username,         politicalX: me.politicalX,         politicalY: me.politicalY,         socketId: null }
      ],
      spectators:        [],
      bannedSpectators:  new Set(),
      question:          null,
      startedAt:         null
    });
    addDebated(challenger.userId, me.userId);
    s1.emit('challenge-accepted', { roomId, question, opponent: { username: me.username,         politicalX: me.politicalX,         politicalY: me.politicalY         } });
    s2.emit('challenge-accepted', { roomId, question, opponent: { username: challenger.username, politicalX: challenger.politicalX, politicalY: challenger.politicalY } });
  }

  socket.on('accept-challenge', ({ challengerSocketId }) => {
    const me         = onlineUsers.get(socket.id);
    const challenger = onlineUsers.get(challengerSocketId);
    if (!me || !challenger) { socket.emit('challenge-error', { error: 'Challenger is no longer online.' }); return; }

    const s1 = io.sockets.sockets.get(challengerSocketId);
    const s2 = socket;
    if (!s1 || !s2) return;

    const question = pendingQuestions.get(challengerSocketId) || null;
    pendingQuestions.delete(challengerSocketId);
    createDebateRoomForChallenge(challenger, me, question, s1, s2);
  });

  // Notifications-page variant: the challenger's socketId from when the
  // challenge was sent may be long gone by the time this is acted on (the
  // whole point of persisting it is to survive across sessions), so this
  // resolves the challenger by userId instead, and takes the question
  // straight from the notification doc rather than the (possibly stale)
  // pendingQuestions map.
  socket.on('accept-challenge-by-user', ({ challengerUserId, question, notifId }) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return;
    const entry = [...onlineUsers.entries()].find(([, u]) => u.userId === challengerUserId);
    if (!entry) { socket.emit('challenge-error', { error: 'Challenger is no longer online.' }); return; }
    const [challengerSocketId, challenger] = entry;
    const s1 = io.sockets.sockets.get(challengerSocketId);
    const s2 = socket;
    if (!s1 || !s2) return;
    pendingQuestions.delete(challengerSocketId);
    createDebateRoomForChallenge(challenger, me, question ? String(question).slice(0, 300) : null, s1, s2);
    if (notifId) {
      fstore.collection('notifications').doc(me.userId).collection('items').doc(String(notifId))
        .update({ read: true }).catch(() => {});
    }
  });

  socket.on('reject-challenge-by-user', ({ challengerUserId, notifId }) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return;
    const entry = [...onlineUsers.entries()].find(([, u]) => u.userId === challengerUserId);
    if (entry) io.to(entry[0]).emit('challenge-rejected', { byUsername: me.username });
    if (notifId) {
      fstore.collection('notifications').doc(me.userId).collection('items').doc(String(notifId))
        .update({ read: true }).catch(() => {});
    }
  });

  // -- The Divide: poll-based challenge system -------------------
  // Unlike the direct challenge system above (client picks the target,
  // ephemeral in-memory pendingQuestions map, no timeout), Divide challenges
  // are server-picked (never client-selected, to prevent gaming) and persist
  // to Firestore with a 15-minute expiry so they survive across reconnects
  // and can be swept/expired even if nobody is actively connected to see it
  // happen — see the sweep job further down piggybacked on the existing
  // 60s cleanup interval.

  function createDebateRoomForDivideChallenge(userA, userB, question, s1, s2) {
    const roomId = uuidv4();
    rooms.set(roomId, {
      users: [
        { userId: userA.userId, username: userA.username, politicalX: userA.politicalX, politicalY: userA.politicalY, socketId: null },
        { userId: userB.userId, username: userB.username, politicalX: userB.politicalX, politicalY: userB.politicalY, socketId: null }
      ],
      spectators: [], bannedSpectators: new Set(), question: null, startedAt: null
    });
    addDebated(userA.userId, userB.userId);
    s1.emit('divide-challenge-accepted', { roomId, question, opponent: { username: userB.username, politicalX: userB.politicalX, politicalY: userB.politicalY } });
    s2.emit('divide-challenge-accepted', { roomId, question, opponent: { username: userA.username, politicalX: userA.politicalX, politicalY: userA.politicalY } });
    return roomId;
  }

  // Finds online users who voted differently than `challengerUserId` on this
  // poll, are not already in a debate, and aren't already sitting at the
  // incoming-pending-challenge cap. Shared by both divide-recommend (initial
  // pick, and any "find someone else" reroll) and divide-send-challenge
  // (re-validated right before actually committing, since time may have
  // passed since the candidate was first recommended and they may no longer
  // be eligible).
  async function findDivideCandidates(pollId, challengerUserId, excludeUserIds) {
    const pollRef = fstore.collection('polls').doc(pollId);
    const [pollDoc, myVoteDoc] = await Promise.all([
      pollRef.get(), pollRef.collection('votes').doc(challengerUserId).get()
    ]);
    if (!pollDoc.exists) return { error: 'Poll not found.' };
    if (!myVoteDoc.exists) return { error: 'Vote on this poll first.' };
    const myOption = myVoteDoc.data().optionIndex;

    const pendingSnap = await fstore.collection('challenges')
      .where('pollId', '==', pollId).where('status', '==', 'pending').limit(500).get();
    const incomingCounts = new Map();
    pendingSnap.docs.forEach(d => {
      const cid = d.data().challengedId;
      incomingCounts.set(cid, (incomingCounts.get(cid) || 0) + 1);
    });

    const votesSnap = await pollRef.collection('votes').limit(2000).get();
    const candidates = [];
    votesSnap.docs.forEach(v => {
      const uid = v.id;
      if (uid === challengerUserId) return;
      if (excludeUserIds && excludeUserIds.includes(uid)) return;
      if (v.data().optionIndex === myOption) return; // must have voted differently
      const onlineEntry = [...onlineUsers.values()].find(u => u.userId === uid);
      if (!onlineEntry || onlineEntry.inDebate) return;
      if ((incomingCounts.get(uid) || 0) >= DIVIDE_MAX_INCOMING_PENDING) return;
      candidates.push(onlineEntry);
    });
    return { candidates, question: pollDoc.data().question };
  }

  function opponentPayload(u) {
    return {
      userId: u.userId, username: u.username, name: u.name || u.username,
      avatarUrl: u.avatarUrl || null, politicalX: u.politicalX || 0, politicalY: u.politicalY || 0
    };
  }

  // Step 1 of 2: just picks and returns a candidate. Does NOT create a
  // challenge doc or notify anyone — the challenger reviews who got picked
  // and explicitly confirms via divide-send-challenge, or asks for someone
  // else (client resends divide-recommend with the shown candidate added to
  // excludeUserIds).
  socket.on('divide-recommend', async ({ pollId, excludeUserIds }) => {
    if (!socketAllow(socket.id, 'divide-recommend', 15)) return;
    const me = onlineUsers.get(socket.id);
    const cleanPollId = safeId(pollId);
    if (!me || !cleanPollId) return;
    try {
      const clean = Array.isArray(excludeUserIds) ? excludeUserIds.map(safeId).filter(Boolean) : [];
      const { error, candidates } = await findDivideCandidates(cleanPollId, me.userId, clean);
      if (error) { socket.emit('divide-challenge-error', { error }); return; }
      if (!candidates.length) {
        socket.emit('divide-challenge-error', { error: 'No one else available to challenge right now — try again soon.' });
        return;
      }
      const candidate = candidates[Math.floor(Math.random() * candidates.length)];
      socket.emit('divide-recommendation', { pollId: cleanPollId, opponent: opponentPayload(candidate) });
    } catch (err) {
      console.error('[divide-recommend] error:', err.message);
      socket.emit('divide-challenge-error', { error: 'Something went wrong. Try again.' });
    }
  });

  // Step 2 of 2: the challenger explicitly confirmed the recommended
  // opponent. Re-validates eligibility (they could have gone offline, joined
  // a debate, or hit the incoming cap in the time since being recommended)
  // before actually creating the persisted challenge and notifying them.
  socket.on('divide-send-challenge', async ({ pollId, targetUserId }) => {
    if (!socketAllow(socket.id, 'divide-send-challenge', 6)) return;
    const me = onlineUsers.get(socket.id);
    const cleanPollId = safeId(pollId);
    const cleanTarget = safeId(targetUserId);
    if (!me || !cleanPollId || !cleanTarget) return;

    try {
      const { error, candidates, question } = await findDivideCandidates(cleanPollId, me.userId, []);
      if (error) { socket.emit('divide-challenge-error', { error }); return; }
      const opponent = candidates.find(c => c.userId === cleanTarget);
      if (!opponent) {
        socket.emit('divide-challenge-error', { error: 'They’re no longer available — try recommending someone else.' });
        return;
      }

      const now = Date.now();
      const challengeRef = await fstore.collection('challenges').add({
        pollId: cleanPollId, question,
        challengerId: me.userId, challengerUsername: me.username,
        challengedId: opponent.userId, challengedUsername: opponent.username,
        status: 'pending', createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: now + DIVIDE_CHALLENGE_TTL_MS, debateRoomId: null
      });

      const opponentEntry = [...onlineUsers.entries()].find(([, u]) => u.userId === opponent.userId);
      const payload = {
        challengeId: challengeRef.id, pollId: cleanPollId, question,
        challengerId: me.userId, challengerUsername: me.username, expiresAt: now + DIVIDE_CHALLENGE_TTL_MS
      };
      if (opponentEntry) io.to(opponentEntry[0]).emit('divide-challenge-received', payload);
      fstore.collection('notifications').doc(opponent.userId).collection('items').add({
        type: 'divide-challenge', message: `${me.username} challenged you to debate "${question}"`,
        read: false, pollId: cleanPollId, challengeId: challengeRef.id,
        fromUserId: me.userId, fromUsername: me.username, question,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});

      socket.emit('divide-challenge-sent', { challengeId: challengeRef.id, opponent: opponentPayload(opponent) });
    } catch (err) {
      console.error('[divide-send-challenge] error:', err.message);
      socket.emit('divide-challenge-error', { error: 'Something went wrong. Try again.' });
    }
  });

  socket.on('divide-challenge-accept', async ({ challengeId }) => {
    const me = onlineUsers.get(socket.id);
    const cleanId = safeId(challengeId);
    if (!me || !cleanId) return;
    const ref = fstore.collection('challenges').doc(cleanId);
    try {
      const doc = await ref.get();
      if (!doc.exists) { socket.emit('divide-challenge-error', { error: 'This challenge no longer exists.' }); return; }
      const c = doc.data();
      if (c.challengedId !== me.userId) return;
      if (c.status !== 'pending') { socket.emit('divide-challenge-error', { error: 'This challenge is no longer available.' }); return; }
      if (c.expiresAt < Date.now()) {
        await ref.update({ status: 'expired' });
        socket.emit('divide-challenge-error', { error: 'This challenge has expired.' });
        return;
      }

      const challengerEntry = [...onlineUsers.entries()].find(([, u]) => u.userId === c.challengerId);
      if (!challengerEntry) {
        await ref.update({ status: 'expired' });
        socket.emit('divide-challenge-error', { error: 'The challenger is no longer online.' });
        return;
      }
      const s1 = io.sockets.sockets.get(challengerEntry[0]);
      const s2 = socket;
      if (!s1) { socket.emit('divide-challenge-error', { error: 'The challenger is no longer online.' }); return; }

      const roomId = createDebateRoomForDivideChallenge(challengerEntry[1], me, c.question, s1, s2);
      await ref.update({ status: 'accepted', debateRoomId: roomId });
    } catch (err) {
      console.error('[divide-challenge-accept] error:', err.message);
      socket.emit('divide-challenge-error', { error: 'Something went wrong. Try again.' });
    }
  });

  socket.on('divide-challenge-decline', async ({ challengeId }) => {
    const me = onlineUsers.get(socket.id);
    const cleanId = safeId(challengeId);
    if (!me || !cleanId) return;
    const ref = fstore.collection('challenges').doc(cleanId);
    try {
      const doc = await ref.get();
      if (!doc.exists || doc.data().challengedId !== me.userId || doc.data().status !== 'pending') return;
      await ref.update({ status: 'declined' });
      notifyDivideChallenger(
        { ...doc.data(), id: cleanId },
        `${me.username} declined your Divide challenge — try someone else?`
      );
    } catch {}
  });

  // -- Invite links ---------------------------------------------

  socket.on('generate-invite', ({ expiryMs }) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return;
    const VALID = [60000, 300000, 600000, 1200000, 1800000, 3600000];
    const ms    = VALID.includes(Number(expiryMs)) ? Number(expiryMs) : 300000;
    const token = uuidv4();
    const expiresAt = Date.now() + ms;
    inviteTokens.set(token, { hostUserId: me.userId, hostUsername: me.username, expiresAt });
    socket.emit('invite-generated', { token, url: `/invite?token=${token}`, expiresAt });
  });

  socket.on('accept-invite', ({ token }) => {
    const me   = onlineUsers.get(socket.id);
    const data = inviteTokens.get(token);
    if (!me) return;
    if (!data || data.expiresAt < Date.now()) {
      socket.emit('invite-error', { error: 'This invite link has expired or is no longer valid.' });
      return;
    }
    if (data.hostUserId === me.userId) {
      socket.emit('invite-error', { error: 'You cannot join your own invite link.' });
      return;
    }
    const hostEntry = [...onlineUsers.entries()].find(([, u]) => u.userId === data.hostUserId);
    if (!hostEntry) {
      socket.emit('invite-error', { error: `${data.hostUsername} is no longer online.` });
      return;
    }
    const [hostSocketId, hostUser] = hostEntry;
    if (hostUser.inDebate) {
      socket.emit('invite-error', { error: `${data.hostUsername} is currently in another debate.` });
      return;
    }
    inviteTokens.delete(token);
    const roomId = uuidv4();
    rooms.set(roomId, {
      users: [
        { userId: hostUser.userId, username: hostUser.username, politicalX: hostUser.politicalX, politicalY: hostUser.politicalY, socketId: null },
        { userId: me.userId,       username: me.username,       politicalX: me.politicalX,       politicalY: me.politicalY,       socketId: null }
      ],
      guestInviteSocketId: socket.id,
      spectators:          [],
      bannedSpectators:    new Set(),
      question:            null,
      startedAt:           null
    });
    const hostSock = io.sockets.sockets.get(hostSocketId);
    if (hostSock) hostSock.emit('invite-accepted', { roomId, opponent: { username: me.username, politicalX: me.politicalX, politicalY: me.politicalY } });
    // Guest waits on invite page until host joins the debate room
    socket.emit('invite-waiting', { roomId, opponent: { username: hostUser.username, politicalX: hostUser.politicalX, politicalY: hostUser.politicalY } });
  });

  socket.on('reject-challenge', ({ challengerSocketId }) => {
    const me             = onlineUsers.get(socket.id);
    const challengerSock = io.sockets.sockets.get(challengerSocketId);
    if (challengerSock && me) challengerSock.emit('challenge-rejected', { byUsername: me.username });
  });

  socket.on('update-country', ({ country }) => {
    const entry = onlineUsers.get(socket.id);
    if (entry) { entry.country = country || ''; broadcastOnlineUsers(); }
  });

  // -- In-debate question controls ------------------------------

  socket.on('request-question', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const me = socketUsers.get(socket.id);
    if (!me) return;
    if (!roomQuestionRequests.has(roomId)) roomQuestionRequests.set(roomId, new Set());
    const reqs = roomQuestionRequests.get(roomId);
    reqs.add(me.userId);
    // Tell the other person their opponent wants a topic
    const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
    if (other) io.to(other.socketId).emit('question-requested', { fromUsername: me.username });
    if (reqs.size >= 2) {
      roomQuestionRequests.delete(roomId);
      io.to(roomId).emit('question-generating');
      const profiles = room.users.map(u => {
        for (const ou of onlineUsers.values()) { if (ou.userId === u.userId) return ou; }
        return u;
      });
      generateDebateQuestionForPair(profiles[0], profiles[1]).then(question => {
        if (question && rooms.get(roomId)) rooms.get(roomId).question = question;
        io.to(roomId).emit('question-updated', question ? { question } : { error: TOPIC_AI_ERROR });
      });
    }
  });

  socket.on('decline-question', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const me = socketUsers.get(socket.id);
    if (!me) return;
    if (!roomDeclines.has(roomId)) roomDeclines.set(roomId, new Set());
    roomDeclines.get(roomId).add(me.userId);
    if (roomDeclines.get(roomId).size >= 2) {
      roomDeclines.delete(roomId);
      io.to(roomId).emit('question-generating');
      generateDebateQuestion(null).then(question => {
        if (question && rooms.get(roomId)) rooms.get(roomId).question = question;
        io.to(roomId).emit('question-updated', question ? { question } : { error: TOPIC_AI_ERROR });
      });
    }
  });

  socket.on('suggest-question', ({ roomId, suggestion, mode }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const me = socketUsers.get(socket.id);
    if (!me) return;
    const clean = String(suggestion || '').trim().slice(0, 120);
    if (!clean) return;
    const cleanMode = mode === 'ai' ? 'ai' : 'asis';
    roomPendingSuggestion.set(roomId, { fromSocketId: socket.id, fromUsername: me.username, suggestion: clean, mode: cleanMode });
    const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
    if (other) io.to(other.socketId).emit('suggestion-received', { suggestion: clean, fromUsername: me.username, mode: cleanMode });
  });

  socket.on('respond-suggestion', ({ roomId, accepted }) => {
    const room    = rooms.get(roomId);
    if (!room) return;
    const pending = roomPendingSuggestion.get(roomId);
    if (!pending) return;
    roomPendingSuggestion.delete(roomId);
    if (!accepted) {
      const fromSock = io.sockets.sockets.get(pending.fromSocketId);
      if (fromSock) fromSock.emit('suggestion-rejected');
      return;
    }
    // "As is": both debaters agreed to use the exact suggested wording —
    // set it directly, no AI round-trip needed.
    if (pending.mode === 'asis') {
      room.question = pending.suggestion;
      io.to(roomId).emit('question-updated', { question: pending.suggestion });
      return;
    }
    io.to(roomId).emit('question-generating');
    generateDebateQuestion(pending.suggestion).then(question => {
      if (question && rooms.get(roomId)) rooms.get(roomId).question = question;
      io.to(roomId).emit('question-updated', question ? { question } : { error: TOPIC_AI_ERROR });
    });
  });

  // -- Report user ----------------------------------------------
  socket.on('report-user', async ({ reportedUserId, reportedUsername, reason, location }) => {
    // Max 5 reports per minute per socket (abuse prevention)
    if (!socketAllow(socket.id, 'report-user', 5)) return;
    const me = socketUsers.get(socket.id) || onlineUsers.get(socket.id);
    const safeTarget = safeId(reportedUserId);
    if (!me || !safeTarget || !reason) return;
    // Prevent self-reporting
    if (safeTarget === me.userId) return;
    try {
      await fstore.collection('reports').add({
        reporterId:       me.userId,
        reporterUsername: me.username,
        reportedId:       safeTarget,
        reportedUsername: safeStr(reportedUsername, 50),
        reason:           safeStr(reason, 200),
        location:         safeStr(location, 50),
        status:           'pending',
        createdAt:        admin.firestore.FieldValue.serverTimestamp()
      });
      socket.emit('report-sent');
      console.log(`[report] ${me.username} -> ${reportedUsername}: "${reason}"`);
    } catch (err) {
      console.error('[report] error:', err.message);
    }
  });

  // -- Admin helpers --------------------------------------------
  function _isAdmin() {
    // Use the flag cached during authenticate — no Firestore round-trip needed
    return socket.data.isAdmin === true && socket.data.userId != null;
  }

  socket.on('admin-get-reports', async ({ filter } = {}) => {
    try {
      if (!_isAdmin()) return;
      const snap = await fstore.collection('reports').orderBy('createdAt', 'desc').limit(150).get();
      let reports = snap.docs.map(d => ({
        id: d.id, ...d.data(),
        createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null
      }));
      if (filter === 'pending') reports = reports.filter(r => r.status === 'pending');
      socket.emit('admin-reports', { reports });
    } catch (err) {
      console.error('[admin-get-reports] error:', err.message);
      socket.emit('admin-reports', { reports: [] });
    }
  });

  socket.on('admin-dismiss-report', async ({ reportId }) => {
    try {
      if (!_isAdmin()) return;
      await fstore.collection('reports').doc(reportId).update({ status: 'dismissed' });
      socket.emit('admin-action-done', { action: 'dismiss-report', reportId });
    } catch (err) { console.error('[admin-dismiss-report] error:', err.message); }
  });

  socket.on('admin-search-users', async ({ query }) => {
    try {
      if (!_isAdmin()) return;
      const q = String(query || '').trim().slice(0, 30);
      if (!q) return;
      const snap = await fstore.collection('users')
        .where('username', '>=', q).where('username', '<=', q + '')
        .limit(30).get();
      socket.emit('admin-users', {
        users: snap.docs.map(d => ({
          uid:        d.id,
          username:   d.data().username,
          name:       d.data().name,
          email:      d.data().email || '',
          banned:     d.data().banned || false,
          bannedUntil: d.data().bannedUntil?.toDate?.()?.toISOString() || null,
          isAdmin:    d.data().isAdmin || false,
          createdAt:  d.data().createdAt?.toDate?.()?.toISOString() || null
        }))
      });
    } catch (err) {
      console.error('[admin-search-users] error:', err.message);
      socket.emit('admin-users', { users: [] });
    }
  });

  socket.on('admin-get-all-users', async () => {
    try {
      if (!_isAdmin()) return;
      const snap = await fstore.collection('users').orderBy('createdAt', 'desc').limit(200).get();
      socket.emit('admin-all-users', {
        users: snap.docs.map(d => ({
          uid:        d.id,
          username:   d.data().username,
          name:       d.data().name,
          email:      d.data().email || '',
          banned:     d.data().banned || false,
          bannedUntil: d.data().bannedUntil?.toDate?.()?.toISOString() || null,
          isAdmin:    d.data().isAdmin || false,
          createdAt:  d.data().createdAt?.toDate?.()?.toISOString() || null
        }))
      });
    } catch (err) {
      console.error('[admin-get-all-users] error:', err.message);
      socket.emit('admin-all-users', { users: [] });
    }
  });

  socket.on('admin-ban-user', async ({ targetUserId, durationMs }) => {
    try {
      if (!_isAdmin()) return;
      if (!targetUserId) return;
      const banData = durationMs
        ? { banned: true, bannedUntil: admin.firestore.Timestamp.fromMillis(Date.now() + Number(durationMs)) }
        : { banned: true, bannedUntil: null };
      await fstore.collection('users').doc(targetUserId).update(banData);
      for (const [sid, u] of onlineUsers) {
        if (u.userId === targetUserId) {
          const until = durationMs ? new Date(Date.now() + Number(durationMs)).toISOString() : null;
          io.to(sid).emit('account-banned', {
            message: until ? 'Your account has been temporarily suspended.' : 'Your account has been permanently banned.',
            until
          });
        }
      }
      socket.emit('admin-action-done', { action: 'ban', targetUserId });
      console.log('[admin] ban ' + targetUserId + ' durationMs=' + (durationMs || 'permanent'));
    } catch (err) { console.error('[admin-ban-user] error:', err.message); }
  });

  socket.on('admin-unban-user', async ({ targetUserId }) => {
    try {
      if (!_isAdmin()) return;
      const userDoc = await fstore.collection('users').doc(targetUserId).get();
      const bannedIp = userDoc.exists ? userDoc.data().bannedIp : null;
      await fstore.collection('users').doc(targetUserId).update({ banned: false, bannedUntil: null, ipBanned: false, bannedIp: null });
      if (bannedIp) {
        await fstore.collection('banned_ips').doc(bannedIp).delete();
        bannedIpSet.delete(bannedIp);
      }
      socket.emit('admin-action-done', { action: 'unban', targetUserId });
      console.log('[admin] unban ' + targetUserId);
    } catch (err) { console.error('[admin-unban-user] error:', err.message); }
  });

  socket.on('admin-get-firebase-users', async () => {
    try {
      if (!_isAdmin()) return;
      // List all Firebase Auth users (paginated)
      const authUsers = [];
      let nextPageToken;
      do {
        const result = await admin.auth().listUsers(1000, nextPageToken);
        authUsers.push(...result.users);
        nextPageToken = result.pageToken;
      } while (nextPageToken);
      // Get Firestore profiles for ban status, username, avatarUrl
      const fsSnap = await fstore.collection('users').get();
      const fsMap = {};
      fsSnap.docs.forEach(d => { fsMap[d.id] = d.data(); });
      const users = authUsers
        .filter(u => fsMap[u.uid] || u.email)  // include all auth users with a profile or email
        .map(u => {
          const fs = fsMap[u.uid] || {};
          return {
            uid:        u.uid,
            username:   fs.username || u.displayName || (u.email ? u.email.split('@')[0] : ('user_' + u.uid.slice(0,6))),
            name:       fs.name || u.displayName || 'User',
            email:      u.email || '',
            photoURL:   u.photoURL || fs.avatarUrl || null,
            banned:     fs.banned || false,
            bannedUntil: fs.bannedUntil?.toDate?.()?.toISOString() || null,
            isAdmin:    fs.isAdmin || false,
            ipBanned:   fs.ipBanned || false,
            createdAt:  u.metadata.creationTime || fs.createdAt?.toDate?.()?.toISOString() || null,
            lastSignIn: u.metadata.lastSignInTime || null,
            providers:  u.providerData.map(p => p.providerId)
          };
        })
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      socket.emit('admin-firebase-users', { users });
    } catch (err) {
      console.error('[admin-get-firebase-users] error:', err.message);
      socket.emit('admin-firebase-users', { users: [] });
    }
  });

  socket.on('admin-ip-ban', async ({ targetUserId }) => {
    try {
      if (!_isAdmin()) return;
      if (!targetUserId) return;
      // Find the target user's IP from active sockets
      let targetIp = null;
      for (const [sid, u] of onlineUsers) {
        if (u.userId === targetUserId) {
          const tsock = io.sockets.sockets.get(sid);
          if (tsock?.data?.ip) { targetIp = tsock.data.ip; break; }
        }
      }
      if (!targetIp) {
        socket.emit('admin-action-done', { action: 'ip-ban-failed', message: 'User is not currently online — IP unknown.' });
        return;
      }
      await fstore.collection('banned_ips').doc(targetIp).set({
        bannedBy: socket.data?.userId || 'admin',
        targetUserId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      bannedIpSet.add(targetIp);
      await fstore.collection('users').doc(targetUserId).update({ banned: true, bannedUntil: null, ipBanned: true, bannedIp: targetIp });
      for (const [sid, u] of onlineUsers) {
        if (u.userId === targetUserId) {
          io.to(sid).emit('account-banned', { message: 'Your account has been permanently banned.', until: null });
        }
      }
      socket.emit('admin-action-done', { action: 'ip-ban', targetUserId, ip: targetIp });
      console.log('[admin] IP banned ' + targetIp + ' user=' + targetUserId);
    } catch (err) { console.error('[admin-ip-ban] error:', err.message); }
  });

  socket.on('admin-send-notification', async ({ targetUserId, message }) => {
    try {
      if (!_isAdmin()) return;
      const cleanTarget = safeId(targetUserId);
      const clean = safeStr(message, 500);
      if (!clean || !cleanTarget) return;
      await fstore.collection('notifications').doc(cleanTarget).collection('items').add({
        type: 'admin', message: clean, read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      // Emit to ALL sockets belonging to this user (multi-tab support)
      let delivered = false;
      for (const [sid, u] of onlineUsers) {
        if (u.userId === cleanTarget) {
          io.to(sid).emit('admin-notification', { message: clean });
          delivered = true;
        }
      }
      socket.emit('admin-action-done', { action: 'notification', targetUserId: cleanTarget });
      console.log(`[admin] notification sent to ${cleanTarget} (socket-delivered: ${delivered})`);
    } catch (err) { console.error('[admin-send-notification] error:', err.message); }
  });

  // -- Spectate system ------------------------------------------

  socket.on('join-spectate', async ({ roomId, idToken }) => {
    if (!socketAllow(socket.id, 'join-spectate', 3)) return;
    const room = rooms.get(roomId);
    if (!room) { socket.emit('spectate-error', { error: 'This debate has ended or does not exist.' }); return; }
    if (!room.startedAt) { socket.emit('spectate-error', { error: 'This debate has not started yet.' }); return; }
    if (room.private) { socket.emit('spectate-error', { error: 'This debate is private.' }); return; }

    let userId = null, username = 'Spectator';
    if (idToken) {
      const decoded = await verifyFirebaseToken(idToken);
      if (decoded) {
        userId = decoded.uid;
        try {
          const doc = await fstore.collection('users').doc(decoded.uid).get();
          if (doc.exists) username = doc.data().username || username;
        } catch {}
      }
    }

    if (userId && room.users.some(u => u.userId === userId)) {
      socket.emit('spectate-error', { error: 'You are a participant in this debate.' });
      return;
    }
    if (userId && room.bannedSpectators?.has(userId)) {
      socket.emit('spectate-error', { error: 'You have been removed from this debate.' });
      return;
    }

    if (!room.spectators) room.spectators = [];
    const specId = uuidv4().slice(0, 8);
    // Don't add duplicate (e.g. reconnect)
    if (!room.spectators.some(s => s.socketId === socket.id)) {
      room.spectators.push({ socketId: socket.id, userId, username, specId });
    }
    socket.join(roomId);
    socket.data.spectatingRoom = roomId;
    socket.data.specUsername = username;

    socket.emit('spectate-joined', {
      roomId,
      question:        room.question || null,
      users:           room.users.map(u => ({ username: u.username, politicalX: u.politicalX || 0, politicalY: u.politicalY || 0 })),
      spectatorCount:  room.spectators.length,
      currentUsername: username,
      currentSpecId:   specId
    });

    room.users.forEach(u => {
      if (u.socketId) {
        io.to(u.socketId).emit('spectator-count', { count: room.spectators.length });
        // Ask each debater to open a WebRTC stream connection to this spectator
        io.to(u.socketId).emit('spectator-joined-stream', { specSocketId: socket.id });
      }
    });
  });

  socket.on('spectator-comment', ({ roomId, message }) => {
    if (!socketAllow(socket.id, 'spectator-comment', 20)) return;
    const room = rooms.get(roomId);
    if (!room || !room.spectators) return;
    const spec = room.spectators.find(s => s.socketId === socket.id);
    if (!spec) return;
    const clean = safeStr(message, 300);
    if (!clean) return;
    const payload = {
      id:        uuidv4(),
      specId:    spec.specId,
      username:  spec.username,
      message:   clean,
      timestamp: new Date().toISOString()
    };
    // Broadcast to all sockets in the room (debaters + spectators)
    io.to(roomId).emit('spectator-comment', payload);
  });

  socket.on('highlight-comment', ({ roomId, commentId, username, message }) => {
    if (!socketAllow(socket.id, 'highlight-comment', 5)) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.users.some(u => u.socketId === socket.id)) return;
    const me = socketUsers.get(socket.id);
    io.to(roomId).emit('comment-highlighted', {
      commentId,
      username:      safeStr(username, 50),
      message:       safeStr(message, 300),
      highlightedBy: me?.username || 'Debater'
    });
  });

  // Debater removes the golden highlight from a comment
  socket.on('unhighlight-comment', ({ roomId, commentId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.users.some(u => u.socketId === socket.id)) return;
    io.to(roomId).emit('comment-unhighlighted', { commentId });
  });

  // ── Spectator video stream WebRTC signaling ──────────────────
  // Debater → spectator (offer/ICE) and spectator → debater (answer/ICE)
  socket.on('spec-stream-offer', ({ specSocketId, offer }) => {
    const me = socketUsers.get(socket.id);
    io.to(specSocketId).emit('spec-stream-offer', {
      debaterSocketId: socket.id,
      username: me?.username || 'Debater',
      offer
    });
  });

  socket.on('spec-stream-answer', ({ debaterSocketId, answer }) => {
    io.to(debaterSocketId).emit('spec-stream-answer', {
      specSocketId: socket.id,
      answer
    });
  });

  socket.on('spec-stream-ice', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('spec-stream-ice', {
      fromSocketId: socket.id,
      candidate
    });
  });

  socket.on('kick-spectator', ({ roomId, specId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.users.some(u => u.socketId === socket.id)) return; // debaters only
    if (!room.spectators) return;
    const spec = room.spectators.find(s => s.specId === specId);
    if (!spec) return;
    io.to(spec.socketId).emit('spectator-kicked', { reason: 'kick' });
    room.spectators = room.spectators.filter(s => s.specId !== specId);
    const targetSock = io.sockets.sockets.get(spec.socketId);
    if (targetSock) { targetSock.leave(roomId); targetSock.data.spectatingRoom = null; }
    room.users.forEach(u => {
      if (u.socketId) io.to(u.socketId).emit('spectator-count', { count: room.spectators.length });
    });
  });

  socket.on('ban-spectator', ({ roomId, specId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.users.some(u => u.socketId === socket.id)) return; // debaters only
    if (!room.spectators) return;
    const spec = room.spectators.find(s => s.specId === specId);
    if (!spec) return;
    if (spec.userId) {
      if (!room.bannedSpectators) room.bannedSpectators = new Set();
      room.bannedSpectators.add(spec.userId);
    }
    io.to(spec.socketId).emit('spectator-kicked', { reason: 'ban' });
    room.spectators = room.spectators.filter(s => s.specId !== specId);
    const targetSock = io.sockets.sockets.get(spec.socketId);
    if (targetSock) { targetSock.leave(roomId); targetSock.data.spectatingRoom = null; }
    room.users.forEach(u => {
      if (u.socketId) io.to(u.socketId).emit('spectator-count', { count: room.spectators.length });
    });
  });

  // -- Branch (side) debates ------------------------------------

  socket.on('start-branch', ({ roomId }) => {
    if (!socketAllow(socket.id, 'start-branch', 2)) return;
    const room = rooms.get(roomId);
    if (!room?.spectators) return;
    const spec = room.spectators.find(s => s.socketId === socket.id);
    if (!spec) return;
    const branchId = uuidv4();
    branches.set(branchId, {
      parentRoomId: roomId,
      question:     room.question || null,
      members:      [{ socketId: socket.id, username: spec.username }]
    });
    socket.join('branch:' + branchId);
    socket.data.branchId = branchId;
    socket.emit('branch-started', { branchId, question: room.question || null, members: [spec.username] });
    socket.to(roomId).emit('branch-invite', { branchId, initiator: spec.username, question: room.question || null });
  });

  socket.on('join-branch', ({ branchId }) => {
    if (!socketAllow(socket.id, 'join-branch', 3)) return;
    const branch = branches.get(branchId);
    if (!branch) { socket.emit('branch-error', { error: 'Side discussion not found.' }); return; }
    const parentRoom = rooms.get(branch.parentRoomId);
    const spec = parentRoom?.spectators?.find(s => s.socketId === socket.id);
    if (!spec) { socket.emit('branch-error', { error: 'You must be watching the debate to join a side discussion.' }); return; }
    if (!branch.members.some(m => m.socketId === socket.id)) {
      branch.members.push({ socketId: socket.id, username: spec.username });
    }
    socket.join('branch:' + branchId);
    socket.data.branchId = branchId;
    socket.emit('branch-joined', {
      branchId,
      question: branch.question,
      members:  branch.members.map(m => m.username)
    });
    socket.to('branch:' + branchId).emit('branch-member-joined', { username: spec.username });
  });

  socket.on('branch-message', ({ branchId, message }) => {
    if (!socketAllow(socket.id, 'branch-message', 20)) return;
    const branch = branches.get(branchId);
    if (!branch) return;
    const member = branch.members.find(m => m.socketId === socket.id);
    if (!member) return;
    const clean = safeStr(message, 300);
    if (!clean) return;
    io.to('branch:' + branchId).emit('branch-message', {
      id:        uuidv4(),
      username:  member.username,
      message:   clean,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    queue.delete(socket.id);
    io.emit('queue-size', { size: queue.size });

    // Remove from branch if in one
    if (socket.data.branchId) {
      const branch = branches.get(socket.data.branchId);
      if (branch) {
        const leaving = branch.members.find(m => m.socketId === socket.id);
        branch.members = branch.members.filter(m => m.socketId !== socket.id);
        if (branch.members.length === 0) {
          branches.delete(socket.data.branchId);
        } else if (leaving) {
          io.to('branch:' + socket.data.branchId).emit('branch-member-left', { username: leaving.username });
        }
      }
    }

    // Remove from spectator list if spectating
    if (socket.data.spectatingRoom) {
      const specRoom = rooms.get(socket.data.spectatingRoom);
      if (specRoom && specRoom.spectators) {
        specRoom.spectators = specRoom.spectators.filter(s => s.socketId !== socket.id);
        specRoom.users.forEach(u => {
          if (u.socketId) io.to(u.socketId).emit('spectator-count', { count: specRoom.spectators.length });
        });
      }
    }

    for (const [roomId, room] of rooms) {
      const slot = room.users.find(u => u.socketId === socket.id);
      if (slot) {
        // Don't close immediately — give the debater 30 s to reconnect (handles page refreshes,
        // brief mobile network hiccups, etc.)
        slot.socketId = null;
        socket.leave(roomId);
        // Notify the other debater so they can show a "reconnecting" indicator
        const other = room.users.find(u => u.socketId);
        if (other) io.to(other.socketId).emit('opponent-reconnecting', {});

        const timerKey = `${roomId}:${slot.userId}`;
        clearTimeout(roomDisconnectTimers.get(timerKey));
        roomDisconnectTimers.set(timerKey, setTimeout(() => {
          roomDisconnectTimers.delete(timerKey);
          const r = rooms.get(roomId);
          if (r) {
            const s = r.users.find(u => u.userId === slot.userId);
            if (!s?.socketId) closeRoom(roomId, null, 'disconnect');
          }
        }, 30000));
        break;
      }
    }
    onlineUsers.delete(socket.id);
    socketUsers.delete(socket.id);
    socketCleanup(socket.id); // clean up rate-limit state
    broadcastOnlineUsers();
  });
});

// -- Matchmaking -----------------------------------------------

function attemptMatch(newSocketId) {
  if (queue.size < 2) return;

  const entries  = [...queue.entries()];
  const newEntry = entries.find(([id]) => id === newSocketId);
  if (!newEntry) return;

  const [, newUser] = newEntry;
  const others = entries.filter(([id]) => id !== newSocketId);
  if (!others.length) return;

  // Most politically distant match
  let best = others[0], bestDist = -1;
  for (const entry of others) {
    const dx = (newUser.politicalX || 0) - (entry[1].politicalX || 0);
    const dy = (newUser.politicalY || 0) - (entry[1].politicalY || 0);
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d > bestDist) { bestDist = d; best = entry; }
  }

  const [matchSocketId, matchUser] = best;
  queue.delete(newSocketId);
  queue.delete(matchSocketId);
  io.emit('queue-size', { size: queue.size });

  const s1 = io.sockets.sockets.get(newSocketId);
  const s2 = io.sockets.sockets.get(matchSocketId);
  if (!s1 || !s2) return;

  const roomId = uuidv4();

  // socketId starts as null - lobby sockets are NOT in the room.
  // It gets set to the debate-page socket in join-debate-room.
  // This prevents the lobby disconnect from prematurely closing the room.
  rooms.set(roomId, {
    users: [
      { ...newUser,   socketId: null },
      { ...matchUser, socketId: null }
    ],
    spectators:          [],
    bannedSpectators:    new Set(),
    question:            null,
    matchNotifications:  {},   // userId -> personalized notification string
    startedAt:           null
  });

  addDebated(newUser.userId, matchUser.userId);

  s1.emit('match-found', {
    roomId,
    opponent: { username: matchUser.username, politicalX: matchUser.politicalX, politicalY: matchUser.politicalY }
  });
  s2.emit('match-found', {
    roomId,
    opponent: { username: newUser.username, politicalX: newUser.politicalX, politicalY: newUser.politicalY }
  });

  // Run matchmaking AI in background — sets topic + personalised notifications
  const _nSocketId = newSocketId, _mSocketId = matchSocketId;
  const _nUserId   = newUser.userId,   _mUserId   = matchUser.userId;
  ;(async () => {
    const prof1 = [...onlineUsers.values()].find(o => o.userId === _nUserId) || newUser;
    const prof2 = [...onlineUsers.values()].find(o => o.userId === _mUserId) || matchUser;
    const result = await runMatchmakingAI(prof1, prof2);
    if (!result) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (result.topic) room.question = result.topic;
    if (result.notification_a) room.matchNotifications[_nUserId] = result.notification_a;
    if (result.notification_b) room.matchNotifications[_mUserId] = result.notification_b;
  })();
}

function closeRoom(roomId, bySocketId, reason) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.users.forEach(u => {
    if (u.socketId) {
      const entry = onlineUsers.get(u.socketId);
      if (entry) entry.inDebate = false;
    }
  });

  io.to(roomId).emit('debate-ended', { reason, by: bySocketId });
  io.in(roomId).socketsLeave(roomId);
  rooms.delete(roomId);
  roomDeclines.delete(roomId);
  roomPendingSuggestion.delete(roomId);
  roomQuestionRequests.delete(roomId);
  clearTimeout(roomTurnTimers.get(roomId));
  roomTurnTimers.delete(roomId);
  roomFreeRequests.delete(roomId);
  roomPrivateRequests.delete(roomId);
  // Cancel any pending disconnect grace-period timers for this room
  for (const key of roomDisconnectTimers.keys()) {
    if (key.startsWith(roomId + ':')) {
      clearTimeout(roomDisconnectTimers.get(key));
      roomDisconnectTimers.delete(key);
    }
  }
  broadcastOnlineUsers();
}

// -- Start -----------------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  ArgueOut is running -> http://localhost:${PORT}\n`);
});





