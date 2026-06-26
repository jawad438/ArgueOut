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
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 63072000, includeSubDomains: true, preload: true }
    : false,
}));

// Additional headers not covered by default helmet config
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=*, microphone=*, geolocation=()');
  next();
});

// Rate limiting — global (all routes)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => getClientIp(req),
  message: { error: 'Too many requests. Please slow down.' },
  skip: req => req.path === '/api/health'
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

// Block IP-banned clients from all HTTP pages
app.use((req, res, next) => {
  const ip = getClientIp(req);
  if (ip && bannedIpSet.has(ip)) {
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

app.get('/api/debates', (req, res) => {
  const list = [];
  for (const [roomId, room] of rooms) {
    if (!room.startedAt) continue; // only list debates that have started
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
  const { idToken } = req.body || {};
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

  // Gather candidates: other online users, not in debate, not already suggested or debated
  const excluded = new Set([
    decoded.uid,
    ...(suggestedMap.get(decoded.uid) || []),
    ...(debatedMap.get(decoded.uid)   || [])
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

    // Deliver any pending (unread) admin notifications from Firestore
    try {
      const notifSnap = await fstore.collection('notifications').doc(decoded.uid)
        .collection('items').where('read', '==', false).limit(20).get();
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

    // Register this debate-page socket in the slot and Socket.io room
    slot.socketId = socket.id;
    socketUsers.set(socket.id, {
      userId:     decoded.uid,
      username:   slot.username,
      politicalX: slot.politicalX,
      politicalY: slot.politicalY
    });
    socket.join(roomId);

    const entry = onlineUsers.get(socket.id);
    if (entry) { entry.inDebate = true; broadcastOnlineUsers(); }

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
  });

  socket.on('accept-challenge', ({ challengerSocketId }) => {
    const me         = onlineUsers.get(socket.id);
    const challenger = onlineUsers.get(challengerSocketId);
    if (!me || !challenger) { socket.emit('challenge-error', { error: 'Challenger is no longer online.' }); return; }

    const s1 = io.sockets.sockets.get(challengerSocketId);
    const s2 = socket;
    if (!s1 || !s2) return;

    const question = pendingQuestions.get(challengerSocketId) || null;
    pendingQuestions.delete(challengerSocketId);

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

  socket.on('suggest-question', ({ roomId, suggestion }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const me = socketUsers.get(socket.id);
    if (!me) return;
    const clean = String(suggestion || '').trim().slice(0, 120);
    if (!clean) return;
    roomPendingSuggestion.set(roomId, { fromSocketId: socket.id, fromUsername: me.username, suggestion: clean });
    const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
    if (other) io.to(other.socketId).emit('suggestion-received', { suggestion: clean, fromUsername: me.username });
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
      if (u.socketId) io.to(u.socketId).emit('spectator-count', { count: room.spectators.length });
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
      if (room.users.some(u => u.socketId === socket.id)) {
        closeRoom(roomId, socket.id, 'disconnect');
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
    spectators:       [],
    bannedSpectators: new Set(),
    question:         null,
    startedAt:        null
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
  broadcastOnlineUsers();
}

// -- Start -----------------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  ArgueOut is running -> http://localhost:${PORT}\n`);
});





