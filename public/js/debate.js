/* debate.js - WebRTC video + Socket.io chat + Firebase Storage images */

// -- Room context ----------------------------------------------
const params = new URLSearchParams(location.search);
const roomId = params.get('room') || localStorage.getItem('debateRoomId');
if (!roomId) { window.location.href = '/lobby'; }

let opponent = null;
try { opponent = JSON.parse(localStorage.getItem('debateOpponent')); } catch {}

const debateQuestion = localStorage.getItem('debateQuestion') || null;

let currentUsername  = localStorage.getItem('username') || 'You';
let currentIdToken   = null;

// -- Small inline icons (used in dynamically-built spectator/highlight UI) --
const ICON_STAR  = '<svg style="width:12px;height:12px;vertical-align:-1px" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const ICON_ZAP   = '<svg style="width:12px;height:12px;vertical-align:-1px" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
const ICON_BAN    = '<svg style="width:12px;height:12px;vertical-align:-1px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
const ICON_CHECK = '<svg style="width:12px;height:12px;vertical-align:-1px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_X     = '<svg style="width:12px;height:12px;vertical-align:-1px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// -- Toast -----------------------------------------------------
function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const colors = { success: 'var(--green)', error: 'var(--red)', info: 'var(--purple)' };
  const icons  = {
    success: '<svg style="width:13px;height:13px;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg style="width:13px;height:13px;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info:    '<svg style="width:13px;height:13px;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
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

// -- Timer -----------------------------------------------------
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

// -- Speaking detection (VAD) ----------------------------------
let selfVAD = null;
let opponentVAD = null;

function startVAD(stream, panelId, cssClass) {
  try {
    const ctx      = new AudioContext();
    const src      = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let speaking = false;
    const id = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += (data[i] - 128) ** 2;
      const rms = Math.sqrt(sum / data.length);
      const now = rms > 8;
      if (now !== speaking) {
        speaking = now;
        document.getElementById(panelId)?.classList.toggle(cssClass, speaking);
      }
    }, 80);
    return { stop() { clearInterval(id); ctx.close().catch(() => {}); } };
  } catch { return null; }
}

// -- Opponent / Self UI ----------------------------------------
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
  if (opTag)    opTag.textContent    = tag ? ` Â· ${tag}` : '';
  if (opPHAv) {
    opPHAv.classList.remove('skel');
    opPHAv.style.removeProperty('border-radius');
    opPHAv.textContent = initial;
  }
  if (opPHName) {
    opPHName.classList.remove('skel');
    ['width','height','margin-top','border-radius'].forEach(p => opPHName.style.removeProperty(p));
    opPHName.textContent = opponent.username;
  }
  const ctEl = document.getElementById('connectingText');
  if (ctEl) {
    ctEl.classList.remove('skel');
    ['width','height','margin-top','border-radius'].forEach(p => ctEl.style.removeProperty(p));
  }
  if (opInfo) {
    opInfo.classList.remove('skel');
    ['width','height','display','border-radius'].forEach(p => opInfo.style.removeProperty(p));
    opInfo.innerHTML = `
      <span style="font-weight:600;color:var(--text-1)">${escapeHtml(currentUsername)}</span>
      <span style="margin:0 12px;color:var(--text-3)">vs</span>
      <span style="font-weight:600;color:#60a5fa">${escapeHtml(opponent.username)}</span>
    `;
  }

  // Show debate spark question if this debate came from a challenge with a question
  if (debateQuestion) {
    const banner = document.getElementById('sparkBanner');
    const qEl    = document.getElementById('sparkQuestion');
    const qv     = document.getElementById('questionView');
    if (banner && qEl) {
      qEl.textContent = debateQuestion;
      if (qv) qv.style.display = 'flex';
      banner.style.display = 'flex';
    }
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
    selfTag.textContent = tag ? ` Â· ${tag}` : '';
  }

  // Show avatar if available
  const avatarUrl = profile?.avatarUrl || localStorage.getItem('avatarDataUrl');
  if (avatarUrl) {
    const selfAv = document.getElementById('selfPlaceholderAvatar');
    if (selfAv) selfAv.innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="You">`;
  }
}

// -- WebRTC ----------------------------------------------------
// STUN alone fails behind symmetric NAT (common on mobile data, some
// routers/school networks) with no fallback. Open Relay Project's free
// public TURN servers act as a relay fallback for those connections.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

let peerConn = null, localStream = null, rawMicStream = null;
// Remote ICE candidates can arrive (over the same socket) before the offer/
// answer round-trip finishes setting the remote description - e.g. the
// answerer starts trickling candidates right after setLocalDescription,
// which can beat the 'webrtc-answer' socket message to the initiator under
// load. addIceCandidate() before a remote description exists silently fails
// on some browsers, dropping that candidate and intermittently breaking the
// connection. Queue candidates that arrive too early and flush them once
// the remote description is set.
let pendingIceCandidates = [];
let micEnabled = true, camEnabled = true;
let myTurnMuted = false;
let localMediaPromise = null;
let currentFacingMode = 'user';

async function ensureLocalMedia() {
  if (localStream) return localStream;
  if (!localMediaPromise) localMediaPromise = getLocalMedia();
  return localMediaPromise;
}

// -- RNNoise noise suppression ---------------------------------
let rnnoiseModule    = null;
let rnnoiseState     = null;
let rnnoiseInPtr     = 0;
let rnnoiseOutPtr    = 0;
let rnnoiseAudioCtx  = null;
let rnnoiseProcessor = null;

const RNNOISE_FRAME = 480;

async function applyRNNoise(rawStream) {
  const factory = window.createRNNWasmModule;
  if (typeof factory !== 'function') throw new Error('RNNoise not loaded');
  const moduleConfig = { locateFile: f => '/js/' + f };
  const readyPromise = factory(moduleConfig);  // factory() mutates moduleConfig and returns moduleConfig.ready (a Promise)
  await readyPromise;                          // wait for WASM to compile and bind all _rnnoise_* functions
  rnnoiseModule = moduleConfig;               // moduleConfig IS the module — _rnnoise_create etc are now attached

  rnnoiseState  = rnnoiseModule._rnnoise_create(0);
  rnnoiseInPtr  = rnnoiseModule._malloc(RNNOISE_FRAME * 4);
  rnnoiseOutPtr = rnnoiseModule._malloc(RNNOISE_FRAME * 4);

  rnnoiseAudioCtx = new AudioContext({ sampleRate: 48000 });
  const src  = rnnoiseAudioCtx.createMediaStreamSource(rawStream);
  const dest = rnnoiseAudioCtx.createMediaStreamDestination();

  // Typed-array ring buffers - no GC pressure during audio callbacks
  const IN_CAP  = RNNOISE_FRAME * 20;
  const OUT_CAP = RNNOISE_FRAME * 20;
  const inBuf   = new Float32Array(IN_CAP);
  const outBuf  = new Float32Array(OUT_CAP);
  let inFill = 0, outFill = 0, outRead = 0;
  // VAD gate: hold speech open for ~60 ms after last voiced frame so word endings aren't clipped
  const HOLD_FRAMES = 6;
  let speechHold = 0;

  rnnoiseProcessor = rnnoiseAudioCtx.createScriptProcessor(4096, 1, 1);
  rnnoiseProcessor.onaudioprocess = (e) => {
    const input  = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);

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
      // _rnnoise_process_frame returns VAD probability 0–1; gate output on it
      const vad = rnnoiseModule._rnnoise_process_frame(rnnoiseState, rnnoiseOutPtr, rnnoiseInPtr);
      if (vad > 0.5) speechHold = HOLD_FRAMES; else if (speechHold > 0) speechHold--;
      const pass  = speechHold > 0;
      const space = OUT_CAP - outFill;
      const copy  = Math.min(RNNOISE_FRAME, space);
      for (let i = 0; i < copy; i++) outBuf[outFill + i] = pass ? h[oo + i] / 32768 : 0;
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


async function getLocalMedia() {
  try {
    rawMicStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' } },
      audio: { echoCancellation: true, autoGainControl: true, noiseSuppression: false, sampleRate: 48000 }
    });
    const selfVideo = document.getElementById('selfVideo');

    try {
      localStream = await applyRNNoise(rawMicStream);
    } catch (err) {
      console.warn('RNNoise unavailable:', err);
      localStream = rawMicStream;
    }

    if (selfVideo) selfVideo.srcObject = localStream;
    document.getElementById('selfNoCam')?.classList.remove('active');

    selfVAD?.stop();
    selfVAD = startVAD(rawMicStream, 'selfPanel', 'speaking-self');

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

    // Add new track - respects current camEnabled state
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

// "Establishing video..." had no way out if the opponent's track never
// arrived (camera permission denied on their end, ICE/TURN negotiation
// failure, etc.) - it just spun forever with no explanation. This bounds
// it to a fixed wait and falls back to a clear, actionable message.
let videoConnectTimer = null;

function clearVideoConnectTimer() {
  if (videoConnectTimer) { clearTimeout(videoConnectTimer); videoConnectTimer = null; }
}

function showVideoConnectIssue(message) {
  const connTxt = document.getElementById('connectingText');
  if (!connTxt) return;
  connTxt.innerHTML =
    `<span style="display:block;margin-bottom:6px">${message}</span>` +
    `<button class="btn btn-sm btn-ghost" onclick="location.reload()" style="padding:4px 12px">Retry</button>`;
}

function armVideoConnectTimer() {
  clearVideoConnectTimer();
  videoConnectTimer = setTimeout(() => {
    showVideoConnectIssue('Taking longer than expected to connect video. You can still use chat.');
  }, 20000);
}

async function flushPendingIceCandidates() {
  const queued = pendingIceCandidates;
  pendingIceCandidates = [];
  for (const candidate of queued) {
    try { await peerConn.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  }
}

function createPeerConnection() {
  // NOTE: do not clear pendingIceCandidates here - candidates can arrive (and
  // get queued by the 'webrtc-ice' handler above) before this function ever
  // runs, while this side is still waiting on getUserMedia. Wiping the queue
  // on peerConn creation would throw those away right before they're needed.
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('webrtc-ice', { roomId, candidate });
  };

  pc.ontrack = ({ streams }) => {
    clearVideoConnectTimer();
    const opponentVideo = document.getElementById('opponentVideo');
    const noCam         = document.getElementById('opponentNoCam');
    const connTxt       = document.getElementById('connectingText');
    if (opponentVideo && streams[0]) {
      opponentVideo.srcObject = streams[0];
      if (noCam)   noCam.style.display   = 'none';
      if (connTxt) connTxt.style.display = 'none';
      startTimer();
      opponentVAD?.stop();
      opponentVAD = startVAD(streams[0], 'opponentPanel', 'speaking-opponent');
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') {
      showToast('Connection failed. Try refreshing.', 'error');
      clearVideoConnectTimer();
      showVideoConnectIssue('Couldn’t connect your opponent’s video. You can still use chat.');
    }
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
  await flushPendingIceCandidates();
  const answer = await peerConn.createAnswer();
  await peerConn.setLocalDescription(answer);
  socket.emit('webrtc-answer', { roomId, answer });
}

// -- Socket (delayed until Firebase Auth ready) ----------------
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
  // opponent not yet connected - video placeholder visible
});

socket.on('start-webrtc', async ({ isInitiator, opponent: opp }) => {
  if (opp && !opponent) { opponent = opp; populateOpponentUI(); }
  const connTxt = document.getElementById('connectingText');
  if (connTxt) connTxt.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Establishing video...';
  armVideoConnectTimer();

  await ensureLocalMedia();
  if (isInitiator) await startAsInitiator();

  // If no question yet, show request-a-topic bar now that both are connected
  if (!debateQuestion) {
    const banner = document.getElementById('sparkBanner');
    const rtv    = document.getElementById('requestTopicView');
    if (banner && rtv) { rtv.style.display = 'flex'; banner.style.display = 'flex'; }
  }
});

socket.on('webrtc-offer',  async ({ offer })    => { if (!peerConn) await ensureLocalMedia(); await handleOffer(offer); });
socket.on('webrtc-answer', async ({ answer })   => {
  if (!peerConn) return;
  await peerConn.setRemoteDescription(new RTCSessionDescription(answer));
  await flushPendingIceCandidates();
});
socket.on('webrtc-ice', async ({ candidate }) => {
  // peerConn may not exist yet at all - e.g. this side is still awaiting a
  // first-time getUserMedia permission prompt while the other side's ICE
  // candidates are already trickling in. Queue in that case too (not just
  // once peerConn exists but lacks a remote description), otherwise these
  // candidates are lost forever and never make it into flushPendingIceCandidates().
  if (!peerConn || !peerConn.remoteDescription || !peerConn.remoteDescription.type) {
    pendingIceCandidates.push(candidate);
    return;
  }
  try { await peerConn.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
});

// -- Chat images (base64 -> ObjectURL, expire on debate end) ---

const tempImageUrls = new Map(); // imageId -> objectURL

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

// -- Chat messages ---------------------------------------------
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
    <div class="chat-msg-bubble">${linkifyText(message)}</div>
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
           onclick="openLightbox(this.src)" title="Click to expand" />
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

function linkifyText(str) {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  return str.split(urlRe).map((part, i) => {
    if (i % 2 === 1) {
      const escaped = escapeHtml(part);
      return `<a href="${escaped}" target="_blank" rel="noopener noreferrer" class="chat-link">${escaped}</a>`;
    }
    return escapeHtml(part);
  }).join('');
}

function openLightbox(src) {
  const lb  = document.getElementById('imgLightbox');
  const img = document.getElementById('imgLightboxImg');
  if (!lb || !img) return;
  img.src = src;
  lb.style.display = 'flex';
}

function closeLightbox() {
  const lb = document.getElementById('imgLightbox');
  if (lb) lb.style.display = 'none';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeLightbox();
});

// -- Question controls -----------------------------------------
let mySkipped           = false;
let suggestSent         = false;
let questionRequestSent = false;

function requestQuestion() {
  if (questionRequestSent) return;
  questionRequestSent = true;
  const btn    = document.getElementById('requestTopicBtn');
  const status = document.getElementById('requestTopicStatus');
  if (btn)    { btn.textContent = 'Requested!'; btn.disabled = true; }
  if (status) status.textContent = 'Waiting for your opponent to also request...';
  socket.emit('request-question', { roomId });
}

function declineQuestion() {
  if (mySkipped) return;
  mySkipped = true;
  const btn = document.getElementById('sparkSkipBtn');
  if (btn) { btn.textContent = 'Skipped'; btn.disabled = true; }
  socket.emit('decline-question', { roomId });
}

function toggleSuggestInput() {
  const bar = document.getElementById('sparkSuggestBar');
  if (!bar) return;
  const opening = bar.style.display === 'none';
  bar.style.display = opening ? 'flex' : 'none';
  if (opening) document.getElementById('sparkSuggestInput')?.focus();
}

function closeSuggestInput() {
  const bar = document.getElementById('sparkSuggestBar');
  if (bar) bar.style.display = 'none';
}

// Off by default: your opponent gets your exact wording. Toggle on to let
// the AI rework it into a sharper debate question instead.
let aiEnhanceMode = false;
function toggleAiEnhance() {
  aiEnhanceMode = !aiEnhanceMode;
  const btn = document.getElementById('sparkAiEnhanceToggle');
  if (btn) btn.classList.toggle('active', aiEnhanceMode);
}

function sendSuggestion() {
  const input = document.getElementById('sparkSuggestInput');
  const text  = (input?.value || '').trim();
  if (!text) return;
  socket.emit('suggest-question', { roomId, suggestion: text, mode: aiEnhanceMode ? 'ai' : 'asis' });
  input.value = '';
  closeSuggestInput();
  suggestSent = true;
  const btn = document.getElementById('sparkSuggestBtn');
  if (btn) { btn.textContent = 'Sent'; btn.disabled = true; }
  showToast('Suggestion sent to your opponent.', 'info');
}

function respondSuggestion(accepted) {
  socket.emit('respond-suggestion', { roomId, accepted });
  const panel = document.getElementById('suggestionPanel');
  if (panel) panel.style.display = 'none';
}

document.getElementById('sparkSuggestInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendSuggestion();
});

socket.on('question-generating', () => {
  const rtv    = document.getElementById('requestTopicView');
  const status = document.getElementById('requestTopicStatus');
  const reqBtn = document.getElementById('requestTopicBtn');
  const qEl    = document.getElementById('sparkQuestion');
  const skip   = document.getElementById('sparkSkipBtn');
  if (rtv && rtv.style.display !== 'none') {
    if (status) status.textContent = 'Finding a topic...';
    if (reqBtn) reqBtn.style.display = 'none';
  } else {
    if (qEl)  qEl.textContent = 'Finding a new topic...';
    if (skip) { skip.textContent = '...'; skip.disabled = true; }
  }
});

socket.on('question-updated', ({ question, error }) => {
  const banner = document.getElementById('sparkBanner');
  const rtv    = document.getElementById('requestTopicView');
  const qv     = document.getElementById('questionView');
  const qEl    = document.getElementById('sparkQuestion');
  const skip   = document.getElementById('sparkSkipBtn');
  const sug    = document.getElementById('sparkSuggestBtn');
  if (rtv) rtv.style.display = 'none';
  if (qv)  qv.style.display = 'flex';
  if (banner) banner.style.display = 'flex';
  if (error) {
    if (qEl) { qEl.textContent = error; qEl.style.color = '#f87171'; qEl.style.fontStyle = 'italic'; }
  } else {
    if (qEl) { qEl.textContent = question; qEl.style.color = ''; qEl.style.fontStyle = ''; }
    localStorage.setItem('debateQuestion', question);
  }
  if (skip)  { skip.textContent = 'Skip'; skip.disabled = false; }
  if (sug)   { sug.textContent = 'Suggest'; sug.disabled = false; }
  mySkipped           = false;
  suggestSent         = false;
  questionRequestSent = false;
  aiEnhanceMode       = false;
  const aiToggle = document.getElementById('sparkAiEnhanceToggle');
  if (aiToggle) aiToggle.classList.remove('active');
  closeSuggestInput();
});

socket.on('suggestion-received', ({ suggestion, fromUsername, mode }) => {
  const panel = document.getElementById('suggestionPanel');
  const text  = document.getElementById('suggestionPanelText');
  if (text) {
    text.textContent = mode === 'ai'
      ? `${fromUsername} wants to AI-enhance this into a topic: "${suggestion}"`
      : `${fromUsername} suggests: "${suggestion}"`;
  }
  if (panel) panel.style.display = 'block';
  setTimeout(() => {
    const p = document.getElementById('suggestionPanel');
    if (p && p.style.display !== 'none') respondSuggestion(false);
  }, 60000);
});

socket.on('suggestion-rejected', () => {
  suggestSent = false;
  const btn = document.getElementById('sparkSuggestBtn');
  if (btn) { btn.textContent = 'Suggest'; btn.disabled = false; }
  showToast('Your topic suggestion was passed on.', 'info');
});

socket.on('question-requested', ({ fromUsername }) => {
  const status = document.getElementById('requestTopicStatus');
  const btn    = document.getElementById('requestTopicBtn');
  if (status) status.textContent = `${fromUsername} wants a topic - request one too!`;
  if (btn && !questionRequestSent) btn.classList.add('pulse-anim');
});

// -- Debate ended ----------------------------------------------
// Shared by both the normal end (debate-ended) and the judged end
// (judging-in-progress) - only which overlay gets shown afterward differs.
function teardownDebateMedia() {
  localStorage.removeItem('debateQuestion');
  clearInterval(timerInterval);
  clearInterval(turnCountdownInterval);
  selfVAD?.stop();   selfVAD = null;
  opponentVAD?.stop(); opponentVAD = null;
  document.getElementById('turnBanner')?.style && (document.getElementById('turnBanner').style.display = 'none');
  if (peerConn) peerConn.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (rawMicStream && rawMicStream !== localStream) rawMicStream.getTracks().forEach(t => t.stop());
  if (rnnoiseState && rnnoiseModule) { rnnoiseModule._rnnoise_destroy(rnnoiseState); rnnoiseState = null; }
  if (rnnoiseAudioCtx) { rnnoiseAudioCtx.close().catch(() => {}); rnnoiseAudioCtx = null; }
  markAllImagesExpired();
}

socket.on('debate-ended', ({ reason }) => {
  teardownDebateMedia();
  const overlay  = document.getElementById('endedOverlay');
  const reasonEl = document.getElementById('endedReason');
  if (overlay)  overlay.classList.add('active');
  if (reasonEl) {
    reasonEl.textContent = reason === 'disconnect'
      ? 'Your opponent disconnected.'
      : 'The debate has concluded. Well argued!';
  }
});

// -- Judge Mode --------------------------------------------------
let currentJudgeUsername = null;

function updateJudgeButtonUI() {
  const label = document.getElementById('judgeBtnLabel');
  const btn   = document.getElementById('judgeBtn');
  if (!label || !btn) return;
  if (currentJudgeUsername) {
    label.textContent = 'Judging';
    btn.title = `${currentJudgeUsername} is judging - tap to vote to remove`;
  } else {
    label.textContent = 'Judge';
    btn.title = 'Request a judge';
  }
}

function openJudgePanel() {
  const modal = document.getElementById('judgePanelModal');
  const reqView = document.getElementById('judgePanelRequestView');
  const attView = document.getElementById('judgePanelAttachedView');
  if (!modal) return;
  modal.style.display = 'flex';
  if (currentJudgeUsername) {
    reqView.style.display = 'none';
    attView.style.display = 'block';
    document.getElementById('judgePanelAttachedName').textContent = '@' + currentJudgeUsername;
  } else {
    reqView.style.display = 'block';
    attView.style.display = 'none';
    const list = document.getElementById('judgePanelList');
    if (list) list.innerHTML = '<div style="text-align:center;padding:16px;font-size:0.85rem;color:var(--text-3)" id="judgePanelLoading">Looking for judges…</div>';
    socket.emit('get-available-judges', { roomId });
  }
}

function closeJudgePanel() {
  const modal = document.getElementById('judgePanelModal');
  if (modal) modal.style.display = 'none';
}

function requestJudge(judgeUserId, judgeUsername) {
  socket.emit('request-judge', { roomId, judgeUserId });
  showToast(`Request sent to @${judgeUsername}`, 'info');
  closeJudgePanel();
}

socket.on('available-judges-list', ({ judges }) => {
  const list = document.getElementById('judgePanelList');
  if (!list) return;
  if (!judges || !judges.length) {
    list.innerHTML = '<div style="text-align:center;padding:16px;font-size:0.85rem;color:var(--text-3)">No judges are available right now.</div>';
    return;
  }
  list.innerHTML = judges.map(j => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:10px">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--purple);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;flex-shrink:0;overflow:hidden">${j.avatarUrl ? `<img src="${j.avatarUrl}" style="width:100%;height:100%;object-fit:cover">` : (j.username || '?')[0].toUpperCase()}</div>
      <div style="flex:1;font-size:0.88rem;font-weight:600">@${j.username}</div>
      <button class="btn btn-primary btn-sm" style="display:inline-flex;align-items:center;gap:5px" onclick="requestJudge('${j.userId}', '${j.username.replace(/'/g, "\\'")}')">
        <svg style="width:12px;height:12px;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Request
      </button>
    </div>
  `).join('');
});

socket.on('judge-request-sent', ({ judgeUsername }) => {
  showToast(`Waiting for @${judgeUsername} to accept…`, 'info');
});

socket.on('judge-request-error', ({ error }) => {
  showToast(error, 'error');
});

socket.on('judge-joined', ({ judgeUsername }) => {
  currentJudgeUsername = judgeUsername;
  updateJudgeButtonUI();
  showToast(`⚖️ @${judgeUsername} has joined to judge this debate`, 'success');
});

socket.on('judge-removed', () => {
  currentJudgeUsername = null;
  updateJudgeButtonUI();
  showToast('The judge has been removed from this debate.', 'info');
});

function proposeKickJudge() {
  socket.emit('vote-kick-judge', { roomId });
  showToast('Waiting for your opponent to confirm…', 'info');
  closeJudgePanel();
}

socket.on('kick-judge-vote-requested', ({ byUsername }) => {
  const modal = document.getElementById('kickJudgeConfirmModal');
  const text  = document.getElementById('kickJudgeConfirmText');
  if (text) text.textContent = `@${byUsername} wants to remove the judge from this debate. Do you agree?`;
  if (modal) modal.style.display = 'flex';
});

function respondKickJudge(agree) {
  const modal = document.getElementById('kickJudgeConfirmModal');
  if (modal) modal.style.display = 'none';
  if (agree) socket.emit('confirm-kick-judge', { roomId });
}

// A judged debate doesn't end with the normal "Debate Ended" screen - the
// debaters get a waiting screen until the judge scores it (they can leave;
// the result reaches them via push/notification either way).
socket.on('judging-in-progress', () => {
  teardownDebateMedia();
  const overlay = document.getElementById('judgeWaitingOverlay');
  if (overlay) overlay.classList.add('active');
});

// Win/lose/draw icons shown once a verdict actually lands, replacing the
// "still waiting" spinner in the same slot.
const ICON_TROPHY = '<svg style="width:100%;height:100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5H4a2 2 0 0 0 2 3.5"/><path d="M17 5h3a2 2 0 0 1-2 3.5"/></svg>';
const ICON_LOSE   = '<svg style="width:100%;height:100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
const ICON_DRAW   = '<svg style="width:100%;height:100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></svg>';

// In case the debater stayed on the waiting screen instead of exiting.
socket.on('judge-verdict', ({ message, won, draw }) => {
  const overlay = document.getElementById('judgeWaitingOverlay');
  if (overlay && overlay.classList.contains('active')) {
    const h2   = overlay.querySelector('h2');
    const p    = overlay.querySelector('p');
    const icon = document.getElementById('judgeWaitingIcon');
    if (h2) h2.textContent = 'The Verdict Is In';
    if (p)  p.textContent  = message;
    if (icon) {
      icon.style.width = '48px'; icon.style.height = '48px'; icon.style.margin = '0 auto 8px';
      if (draw) { icon.style.color = 'var(--text-3)'; icon.innerHTML = ICON_DRAW; }
      else if (won) { icon.style.color = 'var(--amber)'; icon.innerHTML = ICON_TROPHY; }
      else { icon.style.color = 'var(--red)'; icon.innerHTML = ICON_LOSE; }
    }
  } else {
    showToast(message, draw ? 'info' : (won ? 'success' : 'error'));
  }
});

// -- Spectator panel -------------------------------------------
const specPanel      = document.getElementById('specPanel');
const specToggleBtn  = document.getElementById('specToggleBtn');
const closeSpecPanel = document.getElementById('closeSpecPanel');
const specPanelComments = document.getElementById('specPanelComments');
const specPanelCount = document.getElementById('specPanelCount');
const specCountLabel = document.getElementById('specCountLabel');
const specBadge      = document.getElementById('specBadge');

let specPanelOpen = false;
let specUnread    = 0;

function openSpecPanel() {
  if (!specPanel) return;
  // On mobile, dismiss chat first so they don't stack
  if (window.innerWidth <= 1024) {
    const chatSidebar = document.getElementById('chatSidebar');
    if (chatSidebar) chatSidebar.classList.remove('mobile-visible');
  }
  specPanel.classList.add('open');
  specPanelOpen = true;
  specUnread = 0;
  if (specBadge) specBadge.style.display = 'none';
  if (specToggleBtn) specToggleBtn.classList.add('active');
}
function closeSpecPanel_() {
  if (!specPanel) return;
  specPanel.classList.remove('open');
  specPanelOpen = false;
  if (specToggleBtn) specToggleBtn.classList.remove('active');
}
if (specToggleBtn) specToggleBtn.addEventListener('click', () => specPanelOpen ? closeSpecPanel_() : openSpecPanel());
if (closeSpecPanel) closeSpecPanel.addEventListener('click', closeSpecPanel_);

const specCommentMap = new Map(); // commentId -> element

function addSpecComment(payload) {
  const empty = document.getElementById('specPanelEmpty');
  if (empty) empty.style.display = 'none';

  const div = document.createElement('div');
  div.className = 'spec-panel-comment';
  div.dataset.id = payload.id;
  const time = new Date(payload.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sid  = escapeHtml(payload.specId || '');
  const uname = escapeHtml(payload.username);
  div.innerHTML = `
    <div class="spec-panel-comment-header">
      <span class="spec-panel-comment-author">@${uname}</span>
      <span class="spec-panel-comment-time">${time}</span>
    </div>
    <div class="spec-panel-comment-body">${escapeHtml(payload.message)}</div>
    <div class="spec-panel-comment-actions">
      <button class="spec-panel-hl-btn" onclick="highlightSpecComment('${escapeHtml(payload.id)}','${uname}',this)">${ICON_STAR} Highlight</button>
      <button class="spec-panel-kick-btn" onclick="kickSpectator('${sid}','${uname}',this)">${ICON_ZAP} Kick</button>
      <button class="spec-panel-ban-btn" onclick="banSpectator('${sid}','${uname}',this)">${ICON_BAN} Ban</button>
    </div>
  `;
  if (specPanelComments) {
    specPanelComments.appendChild(div);
    specPanelComments.scrollTop = specPanelComments.scrollHeight;
  }
  specCommentMap.set(payload.id, div);

  if (!specPanelOpen) {
    specUnread++;
    if (specBadge) specBadge.style.display = 'block';
  }
}

function kickSpectator(specId, username, btn) {
  if (!specId || !confirm(`Remove @${username} from watching this debate?`)) return;
  socket.emit('kick-spectator', { roomId, specId });
  const row = btn?.closest('.spec-panel-comment-actions');
  if (row) row.querySelectorAll('button').forEach(b => { b.disabled = true; b.style.opacity = '0.4'; });
}

function banSpectator(specId, username, btn) {
  if (!specId || !confirm(`Ban @${username} from watching this debate?\nThey won't be able to rejoin.`)) return;
  socket.emit('ban-spectator', { roomId, specId });
  const row = btn?.closest('.spec-panel-comment-actions');
  if (row) row.querySelectorAll('button').forEach(b => { b.disabled = true; b.style.opacity = '0.4'; });
}

let _activeHlCommentId = null;
let _activeHlBtn       = null;

function highlightSpecComment(commentId, username, btn) {
  const el = specCommentMap.get(commentId);
  const body = el?.querySelector('.spec-panel-comment-body');
  const message = body?.textContent || '';

  // Clicking the same comment again → unhighlight it
  if (_activeHlCommentId === commentId) {
    socket.emit('unhighlight-comment', { roomId, commentId });
    return;
  }

  // Revert previous highlight button
  if (_activeHlBtn) { _activeHlBtn.innerHTML = ICON_STAR + ' Highlight'; _activeHlBtn.disabled = false; _activeHlBtn.style.opacity = ''; }

  socket.emit('highlight-comment', { roomId, commentId, username, message });
  if (btn) { btn.innerHTML = ICON_CHECK + ' Unhighlight'; btn.disabled = false; btn.style.opacity = ''; }
  _activeHlCommentId = commentId;
  _activeHlBtn       = btn;
}

let hlOverlayTimer = null;
function showDebateHlToast(username, message, highlightedBy) {
  const overlay = document.getElementById('debateHlOverlay');
  if (!overlay) return;
  if (hlOverlayTimer) { clearTimeout(hlOverlayTimer); hlOverlayTimer = null; }
  const prev = overlay.querySelector('.debate-hl-toast');
  if (prev) prev.remove();

  const toast = document.createElement('div');
  toast.className = 'debate-hl-toast';
  toast.innerHTML = `
    <button class="debate-hl-dismiss" onclick="dismissHlToast()" title="Dismiss">${ICON_X}</button>
    <div class="debate-hl-label"><span class="debate-hl-star">${ICON_STAR}</span> Spectator Question</div>
    <div class="debate-hl-author">@${escapeHtml(username)}</div>
    <div class="debate-hl-message">${escapeHtml(message)}</div>
    ${highlightedBy ? `<div class="debate-hl-by">Highlighted by @${escapeHtml(highlightedBy)}</div>` : ''}
  `;
  overlay.appendChild(toast);

  hlOverlayTimer = setTimeout(() => dismissHlToast(), 10000);
}

function dismissHlToast() {
  if (hlOverlayTimer) { clearTimeout(hlOverlayTimer); hlOverlayTimer = null; }
  const overlay = document.getElementById('debateHlOverlay');
  const toast = overlay?.querySelector('.debate-hl-toast');
  if (toast) {
    toast.classList.add('ao-hl-fade-out');
    setTimeout(() => toast.remove(), 420);
  }
}

socket.on('spectator-count', ({ count }) => {
  const label = count > 0 ? count + ' watching' : 'Spectators';
  if (specCountLabel) specCountLabel.textContent = label;
  if (specPanelCount) specPanelCount.textContent = count + ' watching';
  if (specBadge && !specPanelOpen && count > 0) specBadge.style.display = 'block';
});

socket.on('spectator-comment', payload => {
  addSpecComment(payload);
});

socket.on('comment-highlighted', ({ commentId, username, message, highlightedBy }) => {
  const el = specCommentMap.get(commentId);
  if (el) {
    el.classList.remove('highlighted', 'highlighted-persist');
    void el.offsetWidth;
    el.classList.add('highlighted');
    const header = el.querySelector('.spec-panel-comment-header');
    if (header && !header.querySelector('.hl-tag')) {
      const tag = document.createElement('span');
      tag.className = 'hl-tag';
      tag.innerHTML = ICON_STAR + ' Highlighted';
      header.appendChild(tag);
    }
    setTimeout(() => { el.classList.remove('highlighted'); el.classList.add('highlighted-persist'); }, 1500);
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  showDebateHlToast(username, message, highlightedBy);
});

socket.on('comment-unhighlighted', ({ commentId }) => {
  const el = specCommentMap.get(commentId);
  if (el) {
    el.classList.remove('highlighted', 'highlighted-persist');
    el.querySelector('.hl-tag')?.remove();
  }
  dismissHlToast();
  if (_activeHlCommentId === commentId) {
    if (_activeHlBtn) { _activeHlBtn.innerHTML = ICON_STAR + ' Highlight'; _activeHlBtn.disabled = false; _activeHlBtn.style.opacity = ''; }
    _activeHlCommentId = null;
    _activeHlBtn = null;
  }
});

// -- Controls --------------------------------------------------
const muteBtn = document.getElementById('muteBtn');
const camBtn  = document.getElementById('camBtn');
const endBtn  = document.getElementById('endBtn');

if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    if (!rawMicStream && !localStream) return;
    if (myTurnMuted && micEnabled) {
      showToast("It's not your turn — wait to unmute.", 'info');
      return;
    }
    micEnabled = !micEnabled;
    if (rawMicStream) rawMicStream.getAudioTracks().forEach(t => { t.enabled = micEnabled && !myTurnMuted; });
    if (localStream && localStream !== rawMicStream) {
      localStream.getAudioTracks().forEach(t => { t.enabled = micEnabled && !myTurnMuted; });
    }
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

const flipCamBtn = document.getElementById('flipCamBtn');
if (flipCamBtn) flipCamBtn.addEventListener('click', flipCamera);

if (endBtn) {
  endBtn.addEventListener('click', () => {
    socket.emit('end-debate', { roomId });
  });
}

window.addEventListener('beforeunload', () => {
  // volatile emit only — the 30-second server grace period handles brief disconnects
  // (sendBeacon was removed because it caused premature debate termination on mobile)
  if (roomId) socket.volatile.emit('end-debate', { roomId });
});

// -- Chat sidebar ----------------------------------------------
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

// -- Chat image attachment (staged before send) ---------------
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

// -- Chat send -------------------------------------------------
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

// -- Firebase Auth -> populate UI -> connect socket --------------
populateOpponentUI();

auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = '/login'; return; }

  currentUsername = localStorage.getItem('username') || user.displayName || 'You';

  try {
    const doc = await firestoreDb.collection('users').doc(user.uid).get();
    if (doc.exists) populateSelfUI(doc.data());
    // Redirect if banned
    if (doc.exists) {
      const pd = doc.data();
      if (pd.banned) {
        const until = pd.bannedUntil?.toDate ? pd.bannedUntil.toDate() : (pd.bannedUntil ? new Date(pd.bannedUntil) : null);
        if (!until || until > new Date()) { window.location.href = "/banned"; return; }
      }
    }
  } catch {}

  currentIdToken = await user.getIdToken();
  if (!socket.connected) socket.connect();
});

// -- Ban handler -----------------------------------------------
socket.on('account-banned', ({ message, until }) => {
  window.location.href = '/banned';
});

// -- Report (debate) -------------------------------------------
let _reportOpponentId   = null;
let _reportOpponentName = null;

function openDebateReport() {
  _reportOpponentId   = opponent?.userId || null;
  _reportOpponentName = opponent?.username || 'Opponent';
  const modal  = document.getElementById('reportModal');
  const nameEl = document.getElementById('reportTargetName');
  const errEl  = document.getElementById('reportModalError');
  const otherWrap = document.getElementById('reportOtherWrap');
  if (nameEl)    nameEl.textContent      = `@${_reportOpponentName}`;
  if (errEl)     errEl.style.display     = 'none';
  if (otherWrap) otherWrap.style.display = 'none';
  document.querySelectorAll('input[name="reportReason"]').forEach(r => { r.checked = false; });
  if (modal) modal.style.display = 'flex';
}

function closeReportModal() {
  const modal = document.getElementById('reportModal');
  if (modal) modal.style.display = 'none';
}

function submitReport() {
  const selected = document.querySelector('input[name="reportReason"]:checked');
  const errEl    = document.getElementById('reportModalError');
  if (!selected) {
    errEl.textContent   = 'Please select a reason.';
    errEl.style.display = 'block';
    return;
  }
  let reason = selected.value;
  if (reason === '__other__') {
    const custom = (document.getElementById('reportOtherInput')?.value || '').trim();
    if (!custom) {
      errEl.textContent   = 'Please describe the reason.';
      errEl.style.display = 'block';
      return;
    }
    reason = custom;
  }
  const btn = document.getElementById('submitReportBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  socket.emit('report-user', {
    reportedUserId:   _reportOpponentId,
    reportedUsername: _reportOpponentName,
    reason,
    location: 'debate'
  });
  socket.once('report-sent', () => {
    closeReportModal();
    showToast('Report submitted. Thank you.', 'success');
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Report'; }
  });
}

document.addEventListener('change', e => {
  if (e.target.name === 'reportReason') {
    const otherWrap = document.getElementById('reportOtherWrap');
    if (otherWrap) otherWrap.style.display = e.target.value === '__other__' ? 'block' : 'none';
  }
});

// -- Turn system -----------------------------------------------
let turnCountdownInterval = null;
let freeDebateRequested   = false;

function setTurnMute(mute) {
  myTurnMuted = mute;
  if (rawMicStream) rawMicStream.getAudioTracks().forEach(t => { t.enabled = !mute && micEnabled; });
  if (localStream && localStream !== rawMicStream) {
    localStream.getAudioTracks().forEach(t => { t.enabled = !mute && micEnabled; });
  }
}

socket.on('turn-start', ({ speakerSocketId, speakerUsername, turnNumber, duration }) => {
  const iAmSpeaker = speakerSocketId === socket.id;
  clearInterval(turnCountdownInterval);

  const banner  = document.getElementById('turnBanner');
  const label   = document.getElementById('turnSpeakerLabel');
  const cntdown = document.getElementById('turnCountdown');
  const passBtn = document.getElementById('turnPassBtn');
  const freeBtn = document.getElementById('freeDebateBtn');
  const dot     = document.getElementById('turnDot');

  const reqBtn  = document.getElementById('turnRequestBtn');

  if (banner)  banner.style.display = 'flex';
  if (label)   label.textContent    = iAmSpeaker ? 'Your turn — speak now' : `${speakerUsername} is speaking`;
  if (passBtn) passBtn.style.display  = iAmSpeaker ? 'inline-flex' : 'none';
  if (reqBtn)  { reqBtn.style.display = iAmSpeaker ? 'none' : 'inline-flex'; reqBtn.textContent = 'Request to Speak'; reqBtn.disabled = false; }
  if (freeBtn && !freeDebateRequested) { freeBtn.textContent = 'Free Debate'; freeBtn.disabled = false; }
  if (dot)     dot.style.background = iAmSpeaker ? '#3b82f6' : '#ef4444';

  document.getElementById('selfPanel')?.classList.toggle('current-speaker', iAmSpeaker);
  document.getElementById('opponentPanel')?.classList.toggle('current-speaker', !iAmSpeaker);

  setTurnMute(!iAmSpeaker);

  let secsLeft = duration;
  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (cntdown) cntdown.textContent = fmt(secsLeft);
  turnCountdownInterval = setInterval(() => {
    secsLeft = Math.max(0, secsLeft - 1);
    if (cntdown) cntdown.textContent = fmt(secsLeft);
    if (secsLeft <= 0) clearInterval(turnCountdownInterval);
  }, 1000);

  showToast(iAmSpeaker ? 'Your turn — 1 minute!' : `${speakerUsername}'s turn to speak.`, 'info');
});

socket.on('debate-mode-free', () => {
  clearInterval(turnCountdownInterval);
  if (myTurnMuted) setTurnMute(false);
  document.getElementById('selfPanel')?.classList.remove('current-speaker');
  document.getElementById('opponentPanel')?.classList.remove('current-speaker');
  const label   = document.getElementById('turnSpeakerLabel');
  const cntdown = document.getElementById('turnCountdown');
  const passBtn = document.getElementById('turnPassBtn');
  if (label)   label.textContent     = 'Free debate — speak freely';
  if (cntdown) cntdown.textContent   = '';
  if (passBtn) passBtn.style.display = 'none';
  const reqBtn2 = document.getElementById('turnRequestBtn');
  if (reqBtn2) reqBtn2.style.display = 'none';
  freeDebateRequested = false;
  showToast('Free debate! Both can speak freely now.', 'success');
  setTimeout(() => { const b = document.getElementById('turnBanner'); if (b) b.style.display = 'none'; }, 3000);
});

socket.on('free-debate-requested', ({ fromUsername }) => {
  const panel = document.getElementById('freeDebatePanel');
  const text  = document.getElementById('freeDebatePanelText');
  if (text)  text.textContent = `${fromUsername} wants to switch to free debate (no turn limits)`;
  if (panel) panel.style.display = 'block';
  setTimeout(() => {
    const p = document.getElementById('freeDebatePanel');
    if (p && p.style.display !== 'none') respondFreeDebate(false);
  }, 30000);
});

socket.on('free-debate-declined', () => {
  freeDebateRequested = false;
  const btn = document.getElementById('freeDebateBtn');
  if (btn) { btn.textContent = 'Free Debate'; btn.disabled = false; }
  showToast('Free debate request declined.', 'info');
});

const PRIVATE_BTN_ICON = '<svg style="width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-1px;margin-right:4px" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

function resetPrivateButtons(label) {
  [document.getElementById('privateDebateBtn'), document.getElementById('mobMenuPrivate')].forEach(btn => {
    if (btn) { btn.innerHTML = PRIVATE_BTN_ICON + label; btn.disabled = false; }
  });
}

socket.on('private-debate-requested', ({ fromUsername }) => {
  const panel = document.getElementById('privateDebatePanel');
  const text  = document.getElementById('privateDebatePanelText');
  if (text)  text.textContent = `${fromUsername} wants to make this debate private (no spectators)`;
  if (panel) panel.style.display = 'block';
  setTimeout(() => {
    const p = document.getElementById('privateDebatePanel');
    if (p && p.style.display !== 'none') respondPrivateDebate(false);
  }, 30000);
});

socket.on('private-debate-declined', () => {
  privateRequested = false;
  resetPrivateButtons('Go Private');
  showToast('Private debate request declined.', 'info');
});

socket.on('debate-mode-private', () => {
  privateRequested = false;
  resetPrivateButtons('Private');
  [document.getElementById('privateDebateBtn'), document.getElementById('mobMenuPrivate')].forEach(btn => {
    if (btn) btn.disabled = true;
  });
  showToast('This debate is now private — spectators can\'t join.', 'success');
});

function passTurn() {
  socket.emit('turn-pass', { roomId });
}

function requestFreeDebate() {
  if (freeDebateRequested) return;
  freeDebateRequested = true;
  socket.emit('request-free-debate', { roomId });
  showToast('Free debate request sent.', 'info');
  const btn = document.getElementById('freeDebateBtn');
  if (btn) { btn.textContent = 'Requested...'; btn.disabled = true; }
}

function respondFreeDebate(accepted) {
  socket.emit('accept-free-debate', { roomId, accepted });
  const panel = document.getElementById('freeDebatePanel');
  if (panel) panel.style.display = 'none';
}

let privateRequested = false;

function requestPrivateDebate() {
  if (privateRequested) return;
  privateRequested = true;
  socket.emit('request-private-debate', { roomId });
  showToast('Private debate request sent.', 'info');
  [document.getElementById('privateDebateBtn'), document.getElementById('mobMenuPrivate')].forEach(btn => {
    if (btn) { btn.textContent = 'Requested...'; btn.disabled = true; }
  });
}

function respondPrivateDebate(accepted) {
  socket.emit('accept-private-debate', { roomId, accepted });
  const panel = document.getElementById('privateDebatePanel');
  if (panel) panel.style.display = 'none';
}

socket.on('speak-requested', ({ fromUsername }) => {
  const panel = document.getElementById('speakRequestPanel');
  const text  = document.getElementById('speakRequestText');
  if (text)  text.textContent = `${fromUsername} wants to speak`;
  if (panel) { panel.style.display = 'block'; }
  setTimeout(() => {
    const p = document.getElementById('speakRequestPanel');
    if (p && p.style.display !== 'none') p.style.display = 'none';
  }, 15000);
});

function requestToSpeak() {
  socket.emit('request-to-speak', { roomId });
  const btn = document.getElementById('turnRequestBtn');
  if (btn) { btn.textContent = 'Requested'; btn.disabled = true; }
  showToast('Asked to speak — waiting for the other person to yield.', 'info');
}

function dismissSpeakRequest() {
  const panel = document.getElementById('speakRequestPanel');
  if (panel) panel.style.display = 'none';
}

// -- Opponent reconnecting (grace period) ----------------------
socket.on('opponent-reconnecting', () => {
  showToast('Opponent briefly disconnected — waiting up to 30 s for them to return…', 'info');
});

// -- AI matchmaking notification --------------------------------
socket.on('match-notification', ({ notification }) => {
  if (!notification) return;
  let banner = document.getElementById('matchNotifBanner');
  if (!banner) {
    if (!document.getElementById('matchNotifStyle')) {
      const s = document.createElement('style');
      s.id = 'matchNotifStyle';
      s.textContent = '@keyframes mnSlide{from{opacity:0;transform:translateX(-50%) translateY(-14px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
      document.head.appendChild(s);
    }
    banner = document.createElement('div');
    banner.id = 'matchNotifBanner';
    banner.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:500;max-width:480px;width:calc(100% - 32px);background:linear-gradient(135deg,rgba(139,92,246,0.15),rgba(109,40,217,0.1));border:1px solid rgba(139,92,246,0.35);border-radius:14px;padding:14px 44px 14px 16px;box-shadow:0 8px 28px rgba(139,92,246,0.18);font-size:0.88rem;color:var(--text-1);line-height:1.5;animation:mnSlide 0.4s cubic-bezier(0.22,1,0.36,1) forwards';
    const close = document.createElement('button');
    close.style.cssText = 'position:absolute;top:10px;right:12px;background:none;border:none;cursor:pointer;color:rgba(139,92,246,0.45);font-size:0.85rem;padding:2px 4px;line-height:1';
    close.innerHTML = ICON_X;
    close.onclick = () => banner.remove();
    banner.appendChild(close);
    document.body.appendChild(banner);
    setTimeout(() => { if (banner?.parentNode) { banner.style.transition='opacity 0.4s'; banner.style.opacity='0'; setTimeout(()=>banner?.remove(),400); } }, 9000);
  }
  const txt = document.createElement('span');
  txt.textContent = notification;
  banner.insertBefore(txt, banner.firstChild);
});

// -- Spectator video stream (WebRTC fan-out) -------------------
const specPeerConns = new Map(); // specSocketId -> RTCPeerConnection

async function createSpecStreamPeerConn(specSocketId) {
  const existing = specPeerConns.get(specSocketId);
  if (existing) { try { existing.close(); } catch {} specPeerConns.delete(specSocketId); }

  const stream = localStream || rawMicStream;
  if (!stream || !stream.getTracks().length) return;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  specPeerConns.set(specSocketId, pc);

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('spec-stream-ice', { targetSocketId: specSocketId, candidate });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') specPeerConns.delete(specSocketId);
  };

  stream.getTracks().forEach(track => pc.addTrack(track, stream));

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('spec-stream-offer', { specSocketId, offer });
  } catch {}
}

socket.on('spectator-joined-stream', async ({ specSocketId }) => {
  // Ensure we have local media before trying to stream
  const stream = localStream || rawMicStream || await ensureLocalMedia().catch(() => null);
  if (!stream) return;
  createSpecStreamPeerConn(specSocketId);
});

socket.on('spec-stream-answer', async ({ specSocketId, answer }) => {
  const pc = specPeerConns.get(specSocketId);
  if (pc) try { await pc.setRemoteDescription(new RTCSessionDescription(answer)); } catch {}
});

socket.on('spec-stream-ice', async ({ fromSocketId, candidate }) => {
  const pc = specPeerConns.get(fromSocketId);
  if (pc) try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
});
