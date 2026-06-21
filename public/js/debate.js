/* debate.js — WebRTC video + Socket.io chat + Firebase Storage images */

// ── Room context ──────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const roomId = params.get('room') || localStorage.getItem('debateRoomId');
if (!roomId) { window.location.href = '/lobby'; }

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

let peerConn = null, localStream = null, rawMicStream = null;
let micEnabled = true, camEnabled = true;
let localMediaPromise = null;
let currentFacingMode = 'user';

async function ensureLocalMedia() {
  if (localStream) return localStream;
  if (!localMediaPromise) localMediaPromise = getLocalMedia();
  return localMediaPromise;
}

// ── RNNoise noise suppression ─────────────────────────────────
let rnnoiseModule    = null;
let rnnoiseState     = null;
let rnnoiseInPtr     = 0;
let rnnoiseOutPtr    = 0;
let rnnoiseAudioCtx  = null;
let rnnoiseProcessor = null;
let noiseEnabled     = true;

const RNNOISE_FRAME = 480;

async function applyRNNoise(rawStream) {
  const factory = window.createRNNWasmModule;
  if (typeof factory !== 'function') throw new Error('RNNoise not loaded');
  rnnoiseModule = await factory({ locateFile: f => '/js/' + f });

  rnnoiseState  = rnnoiseModule._rnnoise_create(0);
  rnnoiseInPtr  = rnnoiseModule._malloc(RNNOISE_FRAME * 4);
  rnnoiseOutPtr = rnnoiseModule._malloc(RNNOISE_FRAME * 4);

  rnnoiseAudioCtx = new AudioContext({ sampleRate: 48000 });
  const src  = rnnoiseAudioCtx.createMediaStreamSource(rawStream);
  const dest = rnnoiseAudioCtx.createMediaStreamDestination();

  // Typed-array ring buffers — no GC pressure during audio callbacks
  const IN_CAP  = RNNOISE_FRAME * 20;
  const OUT_CAP = RNNOISE_FRAME * 20;
  const inBuf   = new Float32Array(IN_CAP);
  const outBuf  = new Float32Array(OUT_CAP);
  let inFill = 0, outFill = 0, outRead = 0;

  rnnoiseProcessor = rnnoiseAudioCtx.createScriptProcessor(4096, 1, 1);
  rnnoiseProcessor.onaudioprocess = (e) => {
    const input  = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);

    if (!noiseEnabled) {
      output.set(input);
      inFill = outFill = outRead = 0;
      return;
    }

    // Accumulate input
    const take = Math.min(input.length, IN_CAP - inFill);
    inBuf.set(input.subarray(0, take), inFill);
    inFill += take;

    // Process full RNNoise frames
    const h   = rnnoiseModule.HEAPF32;
    const io  = rnnoiseInPtr  >> 2;
    const oo  = rnnoiseOutPtr >> 2;
    let start = 0;
    while (start + RNNOISE_FRAME <= inFill) {
      for (let i = 0; i < RNNOISE_FRAME; i++) h[io + i] = inBuf[start + i] * 32768;
      rnnoiseModule._rnnoise_process_frame(rnnoiseState, rnnoiseOutPtr, rnnoiseInPtr);
      const space = OUT_CAP - outFill;
      const copy  = Math.min(RNNOISE_FRAME, space);
      for (let i = 0; i < copy; i++) outBuf[outFill + i] = h[oo + i] / 32768;
      outFill += copy;
      start   += RNNOISE_FRAME;
    }
    // Compact input buffer
    if (start > 0) { inBuf.copyWithin(0, start, inFill); inFill -= start; }

    // Drain output buffer into Web Audio output
    for (let i = 0; i < output.length; i++) {
      output[i] = outRead < outFill ? outBuf[outRead++] : 0;
    }
    // Compact output buffer periodically to avoid index drift
    if (outRead >= RNNOISE_FRAME) {
      outBuf.copyWithin(0, outRead, outFill);
      outFill -= outRead;
      outRead  = 0;
    }
  };

  src.connect(rnnoiseProcessor);
  rnnoiseProcessor.connect(dest);

  return new MediaStream([
    ...rawStream.getVideoTracks(),
    ...dest.stream.getAudioTracks()
  ]);
}

function updateNSBtn() {
  const btn = document.getElementById('nsBtn');
  const lbl = document.getElementById('nsLabel');
  if (!btn) return;
  const available = !!rnnoiseModule;
  btn.disabled = !available;
  // .active (purple) = NS is currently OFF
  btn.classList.toggle('active', available && !noiseEnabled);
  btn.title = !available
    ? 'Noise suppression unavailable'
    : noiseEnabled ? 'Noise suppression: ON — click to disable' : 'Noise suppression: OFF — click to enable';
  if (lbl) lbl.textContent = !available ? 'NS' : noiseEnabled ? 'NS: ON' : 'NS: OFF';
}

async function getLocalMedia() {
  try {
    rawMicStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' } },
      audio: { echoCancellation: true, autoGainControl: true, noiseSuppression: false, sampleRate: 48000 }
    });
    const selfVideo = document.getElementById('selfVideo');

    try {
      localStream = await applyRNNoise(rawMicStream);
      updateNSBtn();
    } catch (err) {
      console.warn('RNNoise unavailable:', err);
      localStream = rawMicStream;
      noiseEnabled = false;
      updateNSBtn();
    }

    if (selfVideo) selfVideo.srcObject = localStream;
    document.getElementById('selfNoCam')?.classList.remove('active');
    return localStream;
  } catch {
    showToast('Could not access camera/mic. Continuing with chat only.', 'info');
    return null;
  }
}

async function flipCamera() {
  const btn      = document.getElementById('flipCamBtn');
  const nextMode = currentFacingMode === 'user' ? 'environment' : 'user';
  if (btn) btn.disabled = true;

  try {
    const newVidStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: nextMode } },
      audio: false
    });
    const newTrack = newVidStream.getVideoTracks()[0];
    if (!newTrack) throw new Error('no track');

    // Collect and stop old video tracks
    const oldTracks = new Set([
      ...(rawMicStream?.getVideoTracks() || []),
      ...(localStream?.getVideoTracks()  || [])
    ]);
    rawMicStream?.getVideoTracks().forEach(t => rawMicStream.removeTrack(t));
    localStream?.getVideoTracks().forEach(t => localStream.removeTrack(t));
    oldTracks.forEach(t => t.stop());

    // Add new track — respects current camEnabled state
    newTrack.enabled = camEnabled;
    if (rawMicStream) rawMicStream.addTrack(newTrack);
    if (localStream && localStream !== rawMicStream) localStream.addTrack(newTrack);
    else if (!rawMicStream && localStream)           localStream.addTrack(newTrack);

    // Update peer connection without renegotiation
    if (peerConn) {
      const sender = peerConn.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
    }

    // Refresh self video preview
    const selfVideo = document.getElementById('selfVideo');
    if (selfVideo && localStream) selfVideo.srcObject = localStream;
    if (camEnabled) document.getElementById('selfNoCam')?.classList.remove('active');

    currentFacingMode = nextMode;
  } catch {
    showToast('Could not switch camera.', 'error');
  } finally {
    if (btn) btn.disabled = false;
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
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed')       showToast('Connection failed. Try refreshing.', 'error');
    if (pc.iceConnectionState === 'disconnected') showToast('Opponent connection lost.', 'info');
  };

  if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  return pc;
}

async function startAsInitiator() {
  peerConn = createPeerConnection();
  const offer = await peerConn.createOffer();
  await peerConn.setLocalDescription(offer);
  socket.emit('webrtc-offer', { roomId, offer });
}

async function handleOffer(offer) {
  peerConn = createPeerConnection();
  await peerConn.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConn.createAnswer();
  await peerConn.setLocalDescription(answer);
  socket.emit('webrtc-answer', { roomId, answer });
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
  setTimeout(() => { window.location.href = '/login'; }, 1500);
});

socket.on('room-not-found', () => {
  const overlay = document.getElementById('roomNotFoundOverlay');
  if (overlay) overlay.classList.add('active');
});

socket.on('waiting-for-opponent', () => {
  // opponent not yet connected — video placeholder visible
});

socket.on('start-webrtc', async ({ isInitiator, opponent: opp }) => {
  if (opp && !opponent) { opponent = opp; populateOpponentUI(); }
  const connTxt = document.getElementById('connectingText');
  if (connTxt) connTxt.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Establishing video...';

  await ensureLocalMedia();
  if (isInitiator) await startAsInitiator();
});

socket.on('webrtc-offer',  async ({ offer })    => { if (!peerConn) await ensureLocalMedia(); await handleOffer(offer); });
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
    addChatImage(fromUser, imageData, imageName || 'image', timestamp, isMine, imageId, message || '');
  } else {
    addChatMessage(fromUser, message, timestamp, isMine);
  }

  const badge = document.getElementById('chatBadge');
  if (!isChatVisible() && badge) badge.style.display = 'block';
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

function addChatImage(fromUser, imageData, imageName, timestamp, isMine, imageId, message) {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
      ${message ? `<div style="padding:6px 4px 2px;font-size:0.88rem;line-height:1.55">${escapeHtml(message)}</div>` : ''}
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
  if (rawMicStream && rawMicStream !== localStream) rawMicStream.getTracks().forEach(t => t.stop());
  if (rnnoiseState && rnnoiseModule) { rnnoiseModule._rnnoise_destroy(rnnoiseState); rnnoiseState = null; }
  if (rnnoiseAudioCtx) { rnnoiseAudioCtx.close().catch(() => {}); rnnoiseAudioCtx = null; }

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
    if (!rawMicStream && !localStream) return;
    micEnabled = !micEnabled;
    // Mute the raw mic (stops audio entering the noise suppressor)
    if (rawMicStream) rawMicStream.getAudioTracks().forEach(t => { t.enabled = micEnabled; });
    // Also mute the processed output track if it differs
    if (localStream && localStream !== rawMicStream) {
      localStream.getAudioTracks().forEach(t => { t.enabled = micEnabled; });
    }
    muteBtn.classList.toggle('active', !micEnabled);
    muteBtn.title = micEnabled ? 'Mute microphone' : 'Unmute microphone';
    showToast(micEnabled ? 'Microphone on' : 'Microphone muted', 'info');
  });
}

const nsBtn = document.getElementById('nsBtn');
if (nsBtn) {
  nsBtn.addEventListener('click', () => {
    if (!rnnoiseModule) return;
    noiseEnabled = !noiseEnabled;
    updateNSBtn();
    showToast(noiseEnabled ? 'Noise suppression enabled' : 'Noise suppression disabled', 'info');
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

const flipCamBtn = document.getElementById('flipCamBtn');
if (flipCamBtn) flipCamBtn.addEventListener('click', flipCamera);

if (endBtn) {
  endBtn.addEventListener('click', () => {
    socket.emit('end-debate', { roomId });
  });
}

window.addEventListener('beforeunload', () => {
  const uid = localStorage.getItem('userId');
  if (roomId) {
    socket.volatile.emit('end-debate', { roomId });
    if (uid && navigator.sendBeacon) {
      navigator.sendBeacon('/api/leave', new Blob(
        [JSON.stringify({ roomId, userId: uid })],
        { type: 'application/json' }
      ));
    }
  }
});

// ── Chat sidebar ──────────────────────────────────────────────
const chatToggle = document.getElementById('chatToggleBtn');
const chatSide   = document.getElementById('chatSidebar');
const closeChat  = document.getElementById('closeChatBtn');
const chatBadge  = document.getElementById('chatBadge');

const isMobile = () => window.innerWidth <= 1024;

function isChatVisible() {
  if (!chatSide) return false;
  return isMobile()
    ? chatSide.classList.contains('mobile-visible')
    : chatSide.style.display !== 'none';
}

const chatBackdrop = document.getElementById('chatBackdrop');

function openChat() {
  if (!chatSide) return;
  if (isMobile()) {
    chatSide.classList.add('mobile-visible');
    if (chatBackdrop) { chatBackdrop.style.display = 'block'; chatBackdrop.style.pointerEvents = 'auto'; }
  } else {
    chatSide.style.display = 'flex';
  }
  if (chatBadge) chatBadge.style.display = 'none';
  if (chatToggle) chatToggle.classList.add('active');
}

function closeChat_() {
  if (!chatSide) return;
  if (isMobile()) {
    chatSide.classList.remove('mobile-visible');
  } else {
    chatSide.style.display = 'none';
  }
  if (chatBackdrop) { chatBackdrop.style.display = 'none'; chatBackdrop.style.pointerEvents = 'none'; }
  if (chatToggle) chatToggle.classList.remove('active');
}

if (chatToggle) chatToggle.addEventListener('click', () => isChatVisible() ? closeChat_() : openChat());
if (closeChat)  closeChat.addEventListener('click',  closeChat_);

// ── Chat image attachment (staged before send) ───────────────
let pendingAttachment = null;

function showAttachmentPreview(imageData, imageName, imageId) {
  pendingAttachment = { imageData, imageName, imageId };
  const preview = document.getElementById('attachmentPreview');
  if (!preview) return;
  preview.innerHTML = `
    <img src="${imageData}" alt="attachment" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border);flex-shrink:0">
    <span class="attachment-preview-name">${escapeHtml(imageName)}</span>
    <button onclick="clearAttachment()" style="background:none;border:none;cursor:pointer;color:var(--text-3);padding:2px;display:flex;align-items:center;flex-shrink:0" aria-label="Remove attachment">
      <svg style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  preview.style.display = 'flex';
}

function clearAttachment() {
  pendingAttachment = null;
  const preview = document.getElementById('attachmentPreview');
  if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
}

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
      showAttachmentPreview(ev.target.result, file.name, generateImageId());
      chatInput?.focus();
    };
    reader.readAsDataURL(file);
    chatImgInput.value = '';
  });
}

// ── Chat send ─────────────────────────────────────────────────
const chatInput = document.getElementById('chatInput');
const sendBtn   = document.getElementById('sendBtn');

function sendMessage() {
  const msg = chatInput?.value.trim() || '';
  if (!msg && !pendingAttachment) return;

  if (pendingAttachment) {
    const { imageData, imageId, imageName } = pendingAttachment;
    addChatImage(currentUsername, imageData, imageName, new Date().toISOString(), true, imageId, msg);
    socket.emit('chat-message', { roomId, imageData, imageId, imageName, message: msg });
    clearAttachment();
  } else {
    socket.emit('chat-message', { roomId, message: msg });
  }

  if (chatInput) { chatInput.value = ''; chatInput.style.height = 'auto'; }
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
  if (!user) { window.location.href = '/login'; return; }

  currentUsername = localStorage.getItem('username') || user.displayName || 'You';

  try {
    const doc = await firestoreDb.collection('users').doc(user.uid).get();
    if (doc.exists) populateSelfUI(doc.data());
  } catch {}

  currentIdToken = await user.getIdToken();
  if (!socket.connected) socket.connect();
});
