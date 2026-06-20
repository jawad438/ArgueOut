/* debate.js — WebRTC video + Socket.io chat + Firebase Storage images */

// ── Room context ──────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const roomId = params.get('room') || localStorage.getItem('debateRoomId');
if (!roomId) { window.location.href = '/lobby.html'; }

let opponent = null;
try { opponent = JSON.parse(localStorage.getItem('debateOpponent')); } catch {}

let currentUsername  = localStorage.getItem('username') || 'You';
let currentIdToken   = null;

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const colors = { success: 'var(--green)', error: 'var(--red)', info: 'var(--purple)' };
  const icons  = { success: '✓', error: '✕', info: 'ℹ' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon" style="color:${colors[type]}">${icons[type]}</span> ${msg}`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

function addSystemMsg(text) {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'chat-system-msg';
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function getPositionTag(px, py) {
  if (px === undefined || py === undefined) return '';
  return `${py >= 0 ? 'Auth' : 'Lib'}-${px >= 0 ? 'R' : 'L'}`;
}

// ── Timer ─────────────────────────────────────────────────────
let timerInterval = null, secondsElapsed = 0;

function startTimer() {
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const m = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
    const s = String(secondsElapsed % 60).padStart(2, '0');
    const el = document.getElementById('timerDisplay');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

// ── Opponent / Self UI ────────────────────────────────────────
function populateOpponentUI() {
  if (!opponent) return;
  const initial = (opponent.username || 'O')[0].toUpperCase();
  const tag     = getPositionTag(opponent.politicalX, opponent.politicalY);

  const opLabel  = document.getElementById('opponentLabel');
  const opTag    = document.getElementById('opponentPositionTag');
  const opPHAv   = document.getElementById('opponentPlaceholderAvatar');
  const opPHName = document.getElementById('opponentPlaceholderName');
  const opInfo   = document.getElementById('opponentInfo');

  if (opLabel)  opLabel.textContent  = opponent.username;
  if (opTag)    opTag.textContent    = tag ? ` · ${tag}` : '';
  if (opPHAv)   opPHAv.textContent   = initial;
  if (opPHName) opPHName.textContent = opponent.username;
  if (opInfo) {
    opInfo.innerHTML = `
      <span style="font-weight:600;color:var(--text-1)">${escapeHtml(currentUsername)}</span>
      <span style="margin:0 12px;color:var(--text-3)">vs</span>
      <span style="font-weight:600;color:#60a5fa">${escapeHtml(opponent.username)}</span>
    `;
  }
}

function populateSelfUI(profile) {
  const selfLabel = document.getElementById('selfLabel');
  const selfPHAv  = document.getElementById('selfPlaceholderAvatar');
  const selfTag   = document.getElementById('selfPositionTag');
  const selfPHN   = document.getElementById('selfPlaceholderName');
  const initial   = currentUsername[0].toUpperCase();

  if (selfLabel) selfLabel.textContent = currentUsername;
  if (selfPHAv)  selfPHAv.textContent  = initial;
  if (selfPHN)   selfPHN.textContent   = currentUsername;

  if (profile && selfTag) {
    const tag = getPositionTag(profile.politicalX, profile.politicalY);
    selfTag.textContent = tag ? ` · ${tag}` : '';
  }

  // Show avatar if available
  const avatarUrl = profile?.avatarUrl || localStorage.getItem('avatarDataUrl');
  if (avatarUrl) {
    const selfAv = document.getElementById('selfPlaceholderAvatar');
    if (selfAv) selfAv.innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="You">`;
  }
}

// ── WebRTC ────────────────────────────────────────────────────
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

let peerConn = null, localStream = null;
let micEnabled = true, camEnabled = true;

async function getLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const selfVideo = document.getElementById('selfVideo');
    if (selfVideo) selfVideo.srcObject = localStream;
    document.getElementById('selfNoCam')?.classList.remove('active');
    return localStream;
  } catch {
    showToast('Could not access camera/mic. Continuing with chat only.', 'info');
    addSystemMsg('Camera/mic not available — text chat still works.');
    return null;
  }
}

function createPeerConnection() {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('webrtc-ice', { roomId, candidate });
  };

  pc.ontrack = ({ streams }) => {
    const opponentVideo = document.getElementById('opponentVideo');
    const noCam         = document.getElementById('opponentNoCam');
    const connTxt       = document.getElementById('connectingText');
    if (opponentVideo && streams[0]) {
      opponentVideo.srcObject = streams[0];
      if (noCam)   noCam.style.display   = 'none';
      if (connTxt) connTxt.style.display = 'none';
      startTimer();
      addSystemMsg('Video connected — debate started!');
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed')       addSystemMsg('Connection failed. Try refreshing.');
    if (pc.iceConnectionState === 'disconnected') addSystemMsg('Opponent connection lost.');
  };

  if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  return pc;
}

async function startAsInitiator() {
  peerConn = createPeerConnection();
  const offer = await peerConn.createOffer();
  await peerConn.setLocalDescription(offer);
  socket.emit('webrtc-offer', { roomId, offer });
  addSystemMsg('Offer sent — waiting for opponent...');
}

async function handleOffer(offer) {
  peerConn = createPeerConnection();
  await peerConn.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConn.createAnswer();
  await peerConn.setLocalDescription(answer);
  socket.emit('webrtc-answer', { roomId, answer });
  addSystemMsg('Answer sent — establishing connection...');
}

// ── Socket (delayed until Firebase Auth ready) ────────────────
const socket = io({ autoConnect: false });

socket.on('connect', () => {
  if (currentIdToken) socket.emit('authenticate', { idToken: currentIdToken });
});

socket.on('authenticated', () => {
  socket.emit('join-debate-room', { idToken: currentIdToken, roomId });
});

socket.on('auth-error', ({ error }) => {
  showToast(error, 'error');
  setTimeout(() => { window.location.href = '/login.html'; }, 1500);
});

socket.on('room-not-found', () => {
  showToast('Room not found — returning to lobby.', 'error');
  setTimeout(() => { window.location.href = '/lobby.html'; }, 2000);
});

socket.on('waiting-for-opponent', () => {
  addSystemMsg('Waiting for opponent to connect...');
});

socket.on('start-webrtc', async ({ isInitiator, opponent: opp }) => {
  if (opp && !opponent) { opponent = opp; populateOpponentUI(); }
  const connTxt = document.getElementById('connectingText');
  if (connTxt) connTxt.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Establishing video...';
  addSystemMsg('Both connected — starting video handshake...');

  await getLocalMedia();
  if (isInitiator) await startAsInitiator();
});

socket.on('webrtc-offer',  async ({ offer })    => { if (!peerConn) await getLocalMedia(); await handleOffer(offer); });
socket.on('webrtc-answer', async ({ answer })   => { if (peerConn) await peerConn.setRemoteDescription(new RTCSessionDescription(answer)); });
socket.on('webrtc-ice',    async ({ candidate }) => { if (peerConn) { try { await peerConn.addIceCandidate(new RTCIceCandidate(candidate)); } catch {} } });

// ── Chat images (base64 → ObjectURL, expire on debate end) ───

const tempImageUrls = new Map(); // imageId → objectURL

function generateImageId() {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function revokeAllTempImages() {
  tempImageUrls.forEach(url => URL.revokeObjectURL(url));
  tempImageUrls.clear();
}

function markAllImagesExpired() {
  revokeAllTempImages();
  document.querySelectorAll('.chat-img-msg').forEach(img => {
    const parent = img.parentElement;
    if (parent) {
      img.remove();
      const expired = document.createElement('div');
      expired.style.cssText = 'font-size:0.78rem;color:var(--text-3);font-style:italic;padding:4px';
      expired.textContent = '[Image expired]';
      parent.prepend(expired);
    }
  });
}

// ── Chat messages ─────────────────────────────────────────────
socket.on('chat-message', ({ from, username: fromUser, message, timestamp, imageData, imageId, imageName }) => {
  const isMine = (fromUser === currentUsername);

  if (imageData) {
    addChatImage(fromUser, imageData, imageName || 'image', timestamp, isMine, imageId);
  } else {
    addChatMessage(fromUser, message, timestamp, isMine);
  }

  const sidebar = document.getElementById('chatSidebar');
  const badge   = document.getElementById('chatBadge');
  if (sidebar && sidebar.style.display === 'none' && badge) badge.style.display = 'block';
});

function addChatMessage(fromUser, message, timestamp, isMine) {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div  = document.createElement('div');
  div.className = `chat-msg ${isMine ? 'mine' : 'theirs'}`;
  div.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-author">${escapeHtml(fromUser)}</span>
      <span class="chat-msg-time">${time}</span>
    </div>
    <div class="chat-msg-bubble">${escapeHtml(message)}</div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function addChatImage(fromUser, imageData, imageName, timestamp, isMine, imageId) {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Convert base64 to ObjectURL (in-memory, revoked on debate end)
  let objUrl = imageData;
  try {
    const byteStr = atob(imageData.split(',')[1] || imageData);
    const mime    = imageData.match(/data:([^;]+);/)?.[1] || 'image/jpeg';
    const ab      = new ArrayBuffer(byteStr.length);
    const ia      = new Uint8Array(ab);
    for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
    objUrl = URL.createObjectURL(new Blob([ab], { type: mime }));
    if (imageId) tempImageUrls.set(imageId, objUrl);
  } catch {}

  const div = document.createElement('div');
  div.className = `chat-msg ${isMine ? 'mine' : 'theirs'}`;
  div.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-author">${escapeHtml(fromUser)}</span>
      <span class="chat-msg-time">${time}</span>
    </div>
    <div class="chat-msg-bubble" style="padding:6px">
      <img src="${objUrl}" alt="${escapeHtml(imageName)}" class="chat-img-msg"
           onclick="window.open(this.src,'_blank')" title="Click to open full size" />
      <div style="font-size:0.7rem;color:var(--text-3);margin-top:4px;padding:0 4px">
        ⏳ Expires when debate ends
      </div>
    </div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Debate ended ──────────────────────────────────────────────
socket.on('debate-ended', ({ reason }) => {
  clearInterval(timerInterval);
  if (peerConn) peerConn.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());

  markAllImagesExpired();

  const overlay  = document.getElementById('endedOverlay');
  const reasonEl = document.getElementById('endedReason');
  if (overlay)  overlay.classList.add('active');
  if (reasonEl) {
    reasonEl.textContent = reason === 'disconnect'
      ? 'Your opponent disconnected.'
      : 'The debate has concluded. Well argued!';
  }
});

// ── Controls ──────────────────────────────────────────────────
const muteBtn = document.getElementById('muteBtn');
const camBtn  = document.getElementById('camBtn');
const endBtn  = document.getElementById('endBtn');

if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    if (!localStream) return;
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(t => { t.enabled = micEnabled; });
    muteBtn.classList.toggle('active', !micEnabled);
    muteBtn.title = micEnabled ? 'Mute microphone' : 'Unmute microphone';
    showToast(micEnabled ? 'Microphone on' : 'Microphone muted', 'info');
  });
}

if (camBtn) {
  camBtn.addEventListener('click', () => {
    if (!localStream) return;
    camEnabled = !camEnabled;
    localStream.getVideoTracks().forEach(t => { t.enabled = camEnabled; });
    document.getElementById('selfNoCam')?.classList.toggle('active', !camEnabled);
    camBtn.classList.toggle('active', !camEnabled);
    camBtn.title = camEnabled ? 'Turn off camera' : 'Turn on camera';
  });
}

if (endBtn) {
  endBtn.addEventListener('click', () => {
    if (!confirm('End the debate?')) return;
    socket.emit('end-debate', { roomId });
  });
}

// ── Chat sidebar ──────────────────────────────────────────────
const chatToggle = document.getElementById('chatToggleBtn');
const chatSide   = document.getElementById('chatSidebar');
const closeChat  = document.getElementById('closeChatBtn');
const chatBadge  = document.getElementById('chatBadge');

if (chatToggle) {
  chatToggle.addEventListener('click', () => {
    if (!chatSide) return;
    const isHidden = chatSide.style.display === 'none';
    chatSide.style.display = isHidden ? 'flex' : 'none';
    if (isHidden && chatBadge) chatBadge.style.display = 'none';
    chatToggle.classList.toggle('active', isHidden);
  });
}
if (closeChat) {
  closeChat.addEventListener('click', () => {
    if (chatSide) chatSide.style.display = 'none';
    if (chatToggle) chatToggle.classList.remove('active');
  });
}

// ── Chat image upload (base64 via socket) ────────────────────
const chatImgBtn   = document.getElementById('chatImgBtn');
const chatImgInput = document.getElementById('chatImgInput');

if (chatImgBtn) chatImgBtn.addEventListener('click', () => chatImgInput?.click());

if (chatImgInput) {
  chatImgInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast('Image must be under 8 MB.', 'error'); return; }

    const reader = new FileReader();
    reader.onload = ev => {
      const imageData = ev.target.result;
      const imageId   = generateImageId();

      // Render own image immediately (before socket round-trip)
      addChatImage(currentUsername, imageData, file.name, new Date().toISOString(), true, imageId);

      // Relay base64 to opponent via server
      socket.emit('chat-message', { roomId, imageData, imageId, imageName: file.name, message: '' });
    };
    reader.readAsDataURL(file);
    chatImgInput.value = '';
  });
}

// ── Chat send ─────────────────────────────────────────────────
const chatInput = document.getElementById('chatInput');
const sendBtn   = document.getElementById('sendBtn');

function sendMessage() {
  const msg = chatInput?.value.trim();
  if (!msg) return;
  socket.emit('chat-message', { roomId, message: msg });
  chatInput.value = '';
  chatInput.style.height = 'auto';
}

if (sendBtn)   sendBtn.addEventListener('click', sendMessage);
if (chatInput) {
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
  });
}

// ── Firebase Auth → populate UI → connect socket ──────────────
populateOpponentUI();

auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = '/login.html'; return; }

  currentUsername = localStorage.getItem('username') || user.displayName || 'You';

  try {
    const doc = await firestoreDb.collection('users').doc(user.uid).get();
    if (doc.exists) populateSelfUI(doc.data());
  } catch {}

  currentIdToken = await user.getIdToken();
  if (!socket.connected) socket.connect();
});
