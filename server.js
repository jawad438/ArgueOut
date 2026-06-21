const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const fs       = require('fs');
const admin    = require('firebase-admin');

// ── Firebase Admin ────────────────────────────────────────────
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const fstore = admin.firestore();

async function verifyFirebaseToken(idToken) {
  try { return await admin.auth().verifyIdToken(idToken); }
  catch { return null; }
}

// ── Express ───────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(express.json());

// Redirect /path.html → /path (clean URLs)
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

// ── In-memory state ───────────────────────────────────────────

// socketId → { userId, username, politicalX, politicalY }
const queue = new Map();

// roomId → { users: [ { userId, username, politicalX, politicalY, socketId } ] }
const rooms = new Map();

// socketId → user info (minimal, for matchmaking/chat)
const socketUsers = new Map();

// socketId → full profile (for online directory & challenges)
const onlineUsers = new Map();

// invite token → { hostUserId, hostUsername, expiresAt }
const inviteTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [t, d] of inviteTokens) if (d.expiresAt < now) inviteTokens.delete(t);
}, 60000);

function broadcastOnlineUsers() {
  // Deduplicate by userId — keep the most recent entry (last socketId wins)
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
    bio:        u.bio || '',
    inDebate:   u.inDebate || false
  }));
  io.emit('online-users', list);
}

// ── Socket.io ─────────────────────────────────────────────────

io.on('connection', socket => {

  // ── Auth ────────────────────────────────────────────────────
  socket.on('authenticate', async ({ idToken }) => {
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
      bio:        userData.bio || '',
      inDebate:   false
    });
    broadcastOnlineUsers();

    socket.emit('authenticated', { userId: decoded.uid, username: userData.username });
  });

  // ── Matchmaking ──────────────────────────────────────────────

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

  // ── Rejoin debate room after page navigation ─────────────────

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
    } else {
      socket.emit('waiting-for-opponent');
      // If this is an invite room and the host just joined, tell the waiting guest to navigate
      if (room.guestInviteSocketId) {
        io.to(room.guestInviteSocketId).emit('invite-start', { roomId });
        room.guestInviteSocketId = null;
      }
    }
  });

  // ── WebRTC signaling ─────────────────────────────────────────

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

  // ── Chat ─────────────────────────────────────────────────────

  socket.on('chat-message', ({ roomId, message, imageData, imageId, imageName }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const me = socketUsers.get(socket.id);
    const payload = {
      from:      socket.id,
      username:  me?.username ?? 'Unknown',
      message:   String(message || '').substring(0, 500),
      timestamp: new Date().toISOString()
    };

    // Image base64 — relay to OTHER user only (sender renders their own immediately)
    if (imageData && imageId) {
      const other = room.users.find(u => u.socketId && u.socketId !== socket.id);
      if (other) {
        io.to(other.socketId).emit('chat-message', {
          ...payload,
          imageData,
          imageId,
          imageName: String(imageName || 'image').substring(0, 100)
        });
      }
      return;
    }

    io.to(roomId).emit('chat-message', payload);
  });

  // ── End debate ────────────────────────────────────────────────

  socket.on('end-debate', ({ roomId }) => closeRoom(roomId, socket.id, 'ended'));

  // ── Challenge system ─────────────────────────────────────────

  socket.on('send-challenge', ({ targetUserId }) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return;
    // Find target — prefer lobby (not-inDebate) socket
    const entries = [...onlineUsers.entries()].filter(([, u]) => u.userId === targetUserId);
    if (!entries.length) { socket.emit('challenge-error', { error: 'User is no longer online.' }); return; }
    const lobbyEntry = entries.find(([, u]) => !u.inDebate) || entries[0];
    const [targetSocketId, targetUser] = lobbyEntry;
    if (targetUser.inDebate) { socket.emit('challenge-error', { error: 'That user is currently in a debate.' }); return; }
    io.to(targetSocketId).emit('challenge-received', {
      from: { socketId: socket.id, userId: me.userId, username: me.username }
    });
  });

  socket.on('accept-challenge', ({ challengerSocketId }) => {
    const me         = onlineUsers.get(socket.id);
    const challenger = onlineUsers.get(challengerSocketId);
    if (!me || !challenger) { socket.emit('challenge-error', { error: 'Challenger is no longer online.' }); return; }

    const s1 = io.sockets.sockets.get(challengerSocketId);
    const s2 = socket;
    if (!s1 || !s2) return;

    const roomId = uuidv4();
    rooms.set(roomId, {
      users: [
        { userId: challenger.userId, username: challenger.username, politicalX: challenger.politicalX, politicalY: challenger.politicalY, socketId: null },
        { userId: me.userId,         username: me.username,         politicalX: me.politicalX,         politicalY: me.politicalY,         socketId: null }
      ]
    });

    s1.emit('challenge-accepted', { roomId, opponent: { username: me.username,         politicalX: me.politicalX,         politicalY: me.politicalY         } });
    s2.emit('challenge-accepted', { roomId, opponent: { username: challenger.username, politicalX: challenger.politicalX, politicalY: challenger.politicalY } });
  });

  // ── Invite links ─────────────────────────────────────────────

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
      guestInviteSocketId: socket.id
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

  socket.on('disconnect', () => {
    queue.delete(socket.id);
    io.emit('queue-size', { size: queue.size });

    for (const [roomId, room] of rooms) {
      if (room.users.some(u => u.socketId === socket.id)) {
        closeRoom(roomId, socket.id, 'disconnect');
        break;
      }
    }
    onlineUsers.delete(socket.id);
    socketUsers.delete(socket.id);
    broadcastOnlineUsers();
  });
});

// ── Matchmaking ───────────────────────────────────────────────

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

  // socketId starts as null — lobby sockets are NOT in the room.
  // It gets set to the debate-page socket in join-debate-room.
  // This prevents the lobby disconnect from prematurely closing the room.
  rooms.set(roomId, {
    users: [
      { ...newUser,   socketId: null },
      { ...matchUser, socketId: null }
    ]
  });

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
  broadcastOnlineUsers();
}

// ── Start ─────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  ArgueOut is running → http://localhost:${PORT}\n`);
});
