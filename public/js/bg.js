/* bg.js — particle constellation background, runs on every page */
(function () {
  const canvas = document.createElement('canvas');
  canvas.id = 'bgCanvas';
  Object.assign(canvas.style, {
    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: 0, opacity: '1'
  });
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d');
  let W, H, particles, mouse = { x: -9999, y: -9999 };

  // Colour palette  (purple / blue / red tones)
  const COLOURS = ['#8b5cf6', '#6366f1', '#3b82f6', '#ef4444', '#a78bfa', '#818cf8'];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    initParticles();
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function initParticles() {
    const count = Math.floor((W * H) / 12000);   // density scales with screen
    particles = Array.from({ length: count }, () => ({
      x:   rand(0, W), y: rand(0, H),
      vx:  rand(-0.18, 0.18), vy: rand(-0.18, 0.18),
      r:   rand(1, 2.4),
      col: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      a:   rand(0.3, 0.85)
    }));
  }

  const CONNECT_DIST = 130;
  const MOUSE_DIST   = 160;

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // ── Glowing orbs ────────────────────────────────────────────
    const orbs = [
      { x: W * 0.15, y: H * 0.20, r: 340, col: 'rgba(139,92,246,0.07)'  },
      { x: W * 0.80, y: H * 0.15, r: 280, col: 'rgba(59,130,246,0.06)'  },
      { x: W * 0.85, y: H * 0.78, r: 320, col: 'rgba(99,102,241,0.065)' },
      { x: W * 0.12, y: H * 0.80, r: 260, col: 'rgba(139,92,246,0.05)'  },
      { x: W * 0.50, y: H * 0.50, r: 200, col: 'rgba(239,68,68,0.035)'  },
    ];
    orbs.forEach(o => {
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
      g.addColorStop(0, o.col);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
    });

    // ── Subtle grid ──────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.018)';
    ctx.lineWidth   = 1;
    const gridStep  = 80;
    for (let x = 0; x < W; x += gridStep) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += gridStep) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // ── Particles + connections ──────────────────────────────────
    particles.forEach(p => {
      // Move
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;

      // Mouse repulsion (gentle)
      const mdx = p.x - mouse.x, mdy = p.y - mouse.y;
      const md  = Math.sqrt(mdx * mdx + mdy * mdy);
      if (md < MOUSE_DIST) {
        const force = (MOUSE_DIST - md) / MOUSE_DIST * 0.4;
        p.x += (mdx / md) * force;
        p.y += (mdy / md) * force;
      }

      // Draw particle
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.col;
      ctx.globalAlpha = p.a;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // ── Connection lines ─────────────────────────────────────────
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECT_DIST) {
          const alpha = (1 - dist / CONNECT_DIST) * 0.18;
          ctx.strokeStyle = `rgba(139,92,246,${alpha})`;
          ctx.lineWidth   = 0.8;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize',    resize);
  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });

  resize();
  draw();
})();
