/* compass.js — interactive political compass canvas */

// ── Toast ─────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const colors = { success: 'var(--green)', error: 'var(--red)', info: 'var(--purple)' };
  const icons  = { success: '✓', error: '✕', info: 'ℹ' };
  const toast  = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon" style="color:${colors[type]}">${icons[type]}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── Canvas setup ──────────────────────────────────────────────
const canvas = document.getElementById('compassCanvas');
const ctx    = canvas.getContext('2d');
const SIZE   = canvas.width;

let posX = null, posY = null;
let isDragging = false;

function toCanvas(px, py) {
  return { cx: (px + 1) / 2 * SIZE, cy: (1 - (py + 1) / 2) * SIZE };
}

function fromCanvas(cx, cy) {
  return { px: (cx / SIZE) * 2 - 1, py: 1 - (cy / SIZE) * 2 };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Draw ──────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, SIZE, SIZE);

  const quads = [
    { x: 0,      y: 0,      w: SIZE/2, h: SIZE/2, color: 'rgba(239,68,68,0.09)'  },
    { x: SIZE/2, y: 0,      w: SIZE/2, h: SIZE/2, color: 'rgba(59,130,246,0.09)' },
    { x: 0,      y: SIZE/2, w: SIZE/2, h: SIZE/2, color: 'rgba(34,197,94,0.09)'  },
    { x: SIZE/2, y: SIZE/2, w: SIZE/2, h: SIZE/2, color: 'rgba(245,158,11,0.09)' },
  ];
  quads.forEach(q => { ctx.fillStyle = q.color; ctx.fillRect(q.x, q.y, q.w, q.h); });

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * SIZE/4, 0);    ctx.lineTo(i * SIZE/4, SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * SIZE/4);    ctx.lineTo(SIZE, i * SIZE/4); ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(SIZE/2, 0);    ctx.lineTo(SIZE/2, SIZE); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, SIZE/2);    ctx.lineTo(SIZE, SIZE/2); ctx.stroke();

  const ql = [
    { text: 'AUTH-LEFT',  cx: SIZE/4,   cy: 20,        color: 'rgba(239,68,68,0.65)'  },
    { text: 'AUTH-RIGHT', cx: 3*SIZE/4, cy: 20,        color: 'rgba(59,130,246,0.65)' },
    { text: 'LIB-LEFT',  cx: SIZE/4,   cy: SIZE - 10, color: 'rgba(34,197,94,0.65)'  },
    { text: 'LIB-RIGHT', cx: 3*SIZE/4, cy: SIZE - 10, color: 'rgba(245,158,11,0.65)' },
  ];
  ctx.font = '600 11px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ql.forEach(l => { ctx.fillStyle = l.color; ctx.fillText(l.text, l.cx, l.cy - 10); });

  if (posX !== null && posY !== null) {
    const { cx, cy } = toCanvas(posX, posY);

    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28);
    grd.addColorStop(0, 'rgba(139,92,246,0.45)');
    grd.addColorStop(1, 'rgba(139,92,246,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI * 2); ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(139,92,246,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#8b5cf6';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    ctx.strokeStyle = 'rgba(139,92,246,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(cx, 0);   ctx.lineTo(cx, SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, cy);   ctx.lineTo(SIZE, cy); ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ── Labels ────────────────────────────────────────────────────
function getQuadrantInfo(px, py) {
  const econ   = px >= 0 ? 'Right' : 'Left';
  const social = py >= 0 ? 'Authoritarian' : 'Libertarian';
  const colors = {
    'Authoritarian-Left':  { label: 'Authoritarian Left',  color: '#ef4444' },
    'Authoritarian-Right': { label: 'Authoritarian Right', color: '#3b82f6' },
    'Libertarian-Left':    { label: 'Libertarian Left',    color: '#22c55e' },
    'Libertarian-Right':   { label: 'Libertarian Right',   color: '#f59e0b' },
  };
  return colors[`${social}-${econ}`] || { label: 'Centre', color: '#8b5cf6' };
}

function updateLabels() {
  if (posX === null) return;
  const info = getQuadrantInfo(posX, posY);
  const quad = document.getElementById('quadrantLabel');
  const vals = document.getElementById('positionValues');
  if (quad) { quad.textContent = info.label; quad.style.color = info.color; }
  if (vals) {
    const econStr   = posX >= 0 ? `Right +${posX.toFixed(2)}` : `Left ${posX.toFixed(2)}`;
    const socialStr = posY >= 0 ? `Auth +${posY.toFixed(2)}`  : `Lib ${posY.toFixed(2)}`;
    vals.textContent = `Economic: ${econStr}  |  Social: ${socialStr}`;
  }
  const saveBtn = document.getElementById('saveCompassBtn');
  if (saveBtn) saveBtn.disabled = false;
  const hint = document.getElementById('clickHint');
  if (hint) hint.style.display = 'none';
}

// ── Interaction ───────────────────────────────────────────────
function handleInteraction(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = SIZE / rect.width;
  const scaleY = SIZE / rect.height;
  let clientX, clientY;
  if (e.touches) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
  else           { clientX = e.clientX;             clientY = e.clientY; }
  const cx = (clientX - rect.left) * scaleX;
  const cy = (clientY - rect.top)  * scaleY;
  const { px, py } = fromCanvas(cx, cy);
  posX = clamp(px, -1, 1);
  posY = clamp(py, -1, 1);
  draw();
  updateLabels();
}

canvas.addEventListener('mousedown',  e => { isDragging = true;  handleInteraction(e); });
canvas.addEventListener('mousemove',  e => { if (isDragging) handleInteraction(e); });
canvas.addEventListener('mouseup',    () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; });
canvas.addEventListener('touchstart', e => { e.preventDefault(); isDragging = true;  handleInteraction(e); }, { passive: false });
canvas.addEventListener('touchmove',  e => { e.preventDefault(); if (isDragging) handleInteraction(e); }, { passive: false });
canvas.addEventListener('touchend',   () => { isDragging = false; });
canvas.addEventListener('click',      handleInteraction);

// ── Firebase Auth guard + load existing position ──────────────
draw();

auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = '/login.html'; return; }

  try {
    const doc = await firestoreDb.collection('users').doc(user.uid).get();
    if (doc.exists && doc.data().compassSet) {
      posX = doc.data().politicalX;
      posY = doc.data().politicalY;
      updateLabels();
      draw();
    }
  } catch { /* no existing position — that's fine */ }
});

// ── Save button ───────────────────────────────────────────────
const saveBtn = document.getElementById('saveCompassBtn');
const errDiv  = document.getElementById('compassError');
const errText = document.getElementById('compassErrorText');

if (saveBtn) {
  saveBtn.addEventListener('click', async () => {
    if (posX === null) return;
    if (errDiv) errDiv.style.display = 'none';

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="spinner"></div> Saving...';

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in');

      await firestoreDb.collection('users').doc(user.uid).update({
        politicalX: posX,
        politicalY: posY,
        compassSet: true
      });

      showToast('Political position saved!', 'success');
      setTimeout(() => { window.location.href = '/lobby.html'; }, 700);
    } catch (err) {
      if (errDiv && errText) { errText.textContent = err.message; errDiv.style.display = 'flex'; }
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Position & Enter Lobby';
    }
  });
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.style.display = 'inline-flex';
  logoutBtn.addEventListener('click', async () => {
    await auth.signOut();
    localStorage.clear();
    window.location.href = '/';
  });
}
