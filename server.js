const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path     = require('path');
const admin    = require('firebase-admin');

// ── Firebase Admin ────────────────────────────────────────────
const serviceAccount = require('./serviceAccountKey.json');
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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_, res) => res.json({ ok: true }));

// ── In-memory state ───────────────────────────────────────────

// socketId → { userId, username, politicalX, politicalY }
const queue = new Map();

// roomId → { users: [ { userId, username, politicalX, politicalY, socketId } ] }
const rooms = new Map();

// socketId → user info
const socketUsers = new Map();

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
    if (!slot)  { socket.emit('room-not-found'); return; }

    slot.socketId = socket.id;

    if (!socketUsers.has(socket.id)) {
      socketUsers.set(socket.id, {
        userId:     decoded.uid,
        username:   slot.username,
        politicalX: slot.politicalX,
        politicalY: slot.politicalY
      });
    }

    socket.join(roomId);

    const connected = room.users.filter(u => u.socketId);
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

  socket.on('disconnect', () => {
    queue.delete(socket.id);
    io.emit('queue-size', { size: queue.size });

    for (const [roomId, room] of rooms) {
      if (room.users.some(u => u.socketId === socket.id)) {
        closeRoom(roomId, socket.id, 'disconnect');
        break;
      }
    }
    socketUsers.delete(socket.id);
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

  rooms.set(roomId, {
    users: [
      { ...newUser,   socketId: newSocketId   },
      { ...matchUser, socketId: matchSocketId }
    ]
  });

  s1.join(roomId);
  s2.join(roomId);

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

  io.to(roomId).emit('debate-ended', { reason, by: bySocketId });
  io.in(roomId).socketsLeave(roomId);
  rooms.delete(roomId);
}

// ── Start ─────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  ArgueOut is running → http://localhost:${PORT}\n`);
});
