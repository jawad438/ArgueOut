/* debug-overlay.js — on-device diagnostic log for the ArgueOut app.

   Captures console output, errors, page lifecycle, visibility changes and a
   render heartbeat (detects when the WebView stops painting and for how long),
   persists them to localStorage so the log survives a freeze/navigation, and
   shows a floating panel with a Copy button so the log can be shared.

   Activates only in the Android app (window.AndroidAuth present) or when the
   URL has ?debug=1 or localStorage 'ao-debug' === '1'. Normal web users see
   nothing. Safe to leave in; remove the <script> include to disable. */
(function () {
  var enabled =
    (typeof window.AndroidAuth !== 'undefined') ||
    /[?&]debug=1/.test(location.search) ||
    (function () { try { return localStorage.getItem('ao-debug') === '1'; } catch (e) { return false; } })();
  if (!enabled) return;
  if (window.__AO_DEBUG_OVERLAY__) return;       // don't double-install
  window.__AO_DEBUG_OVERLAY__ = true;

  var KEY = 'ao-debug-log';
  var MAX = 400;                                  // ring-buffer cap
  var t0  = (window.performance && performance.now) ? performance.now() : Date.now();

  function now() { return ((window.performance && performance.now) ? performance.now() : Date.now()); }
  function clock() {
    var d = new Date();
    function p(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function save(arr) { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {} }

  var buf = load();

  function add(tag, msg) {
    var line = clock() + ' +' + Math.round(now() - t0) + 'ms [' + tag + '] ' + msg;
    buf.push(line);
    if (buf.length > MAX) buf = buf.slice(buf.length - MAX);
    save(buf);
    // Forward to native logcat too, if the app exposes a logger.
    try { if (window.AndroidLog && window.AndroidLog.log) window.AndroidLog.log(line); } catch (e) {}
    render();
    return line;
  }

  // ── capture console ───────────────────────────────────────────
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (m) {
    var orig = console[m] ? console[m].bind(console) : function () {};
    console[m] = function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        try { parts.push(typeof a === 'string' ? a : JSON.stringify(a)); }
        catch (e) { parts.push(String(a)); }
      }
      add(m.toUpperCase(), parts.join(' '));
      orig.apply(null, arguments);
    };
  });

  // ── capture errors ────────────────────────────────────────────
  window.addEventListener('error', function (e) {
    if (e && e.message) add('JS-ERROR', e.message + ' @ ' + (e.filename || '?') + ':' + (e.lineno || '?'));
    else if (e && e.target && e.target.src) add('LOAD-ERROR', 'failed to load ' + e.target.src);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    add('PROMISE-REJECT', (r && (r.message || r.toString && r.toString())) || String(r));
  });

  // ── lifecycle + visibility ────────────────────────────────────
  add('INIT', 'url=' + location.href);
  add('INIT', 'theme=' + (document.documentElement.getAttribute('data-theme') || 'system') +
              ' visibility=' + document.visibilityState +
              ' AndroidApp=' + (typeof window.AndroidAuth !== 'undefined'));
  try {
    add('INIT', 'sw.controller=' + (navigator.serviceWorker && navigator.serviceWorker.controller ? 'yes' : 'none'));
  } catch (e) {}

  document.addEventListener('visibilitychange', function () {
    add('VISIBILITY', document.visibilityState + ' (hidden=' + document.hidden + ')');
  });
  window.addEventListener('pageshow',   function (e) { add('PAGESHOW', 'persisted=' + e.persisted); });
  window.addEventListener('pagehide',   function (e) { add('PAGEHIDE', 'persisted=' + e.persisted); });
  window.addEventListener('focus',      function ()  { add('FOCUS', 'window focused'); });
  window.addEventListener('blur',       function ()  { add('BLUR', 'window blurred'); });
  document.addEventListener('freeze',   function ()  { add('LIFECYCLE', 'freeze (page frozen by OS)'); });
  document.addEventListener('resume',   function ()  { add('LIFECYCLE', 'resume (page resumed by OS)'); });
  document.addEventListener('DOMContentLoaded', function () { add('DOM', 'DOMContentLoaded'); });
  window.addEventListener('load', function () { add('DOM', 'window load (everything fetched)'); });

  // ── paint timing ──────────────────────────────────────────────
  try {
    if (window.PerformanceObserver) {
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          add('PAINT', e.name + ' at ' + Math.round(e.startTime) + 'ms');
        });
      }).observe({ type: 'paint', buffered: true });
    }
  } catch (e) {}

  // ── render heartbeat: detect when the screen stops painting ───
  // requestAnimationFrame only fires when the WebView is actually compositing
  // frames. If it stops while the page is visible, the screen is frozen (not
  // painting) even though JS keeps running. We log any gap > 600ms so the
  // freeze and its duration show up clearly in the log.
  var lastFrame = now();
  var lastBeat  = now();
  var frames    = 0;
  function tick() {
    var n = now();
    var dt = n - lastFrame;
    if (dt > 600) {
      add('RENDER-STALL', 'no frames for ' + Math.round(dt) + 'ms while visibility=' +
          document.visibilityState + (document.visibilityState === 'visible'
            ? '  <-- SCREEN FROZEN (visible but not painting)' : '  (backgrounded, normal)'));
    }
    lastFrame = n;
    frames++;
    if (n - lastBeat > 3000) {                    // periodic "still alive" beat
      add('HEARTBEAT', frames + ' frames in last 3s (rendering ok)');
      frames = 0; lastBeat = n;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ── UI ────────────────────────────────────────────────────────
  function el(tag, css, text) {
    var e = document.createElement(tag);
    e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  var Z = '2147483647';
  var btn = el('button',
    'position:fixed;left:8px;bottom:8px;z-index:' + Z + ';width:44px;height:44px;border-radius:50%;' +
    'background:#111;color:#0f0;border:2px solid #0f0;font:700 18px monospace;opacity:0.85;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.6);padding:0', '🐞');
  var panel = el('div',
    'position:fixed;inset:0 0 auto 0;height:55vh;z-index:' + Z + ';background:#0b0b0b;color:#d6ffd6;' +
    'font:11px/1.45 monospace;display:none;flex-direction:column;border-bottom:2px solid #0f0');
  var bar = el('div',
    'display:flex;gap:6px;padding:6px;background:#000;border-bottom:1px solid #0f0;flex:0 0 auto');
  function mk(label, bg) {
    return el('button', 'flex:1;padding:7px 4px;background:' + bg + ';color:#fff;border:none;' +
      'border-radius:5px;font:700 12px monospace', label);
  }
  var bCopy = mk('Copy', '#2563eb'), bShare = mk('Share', '#16a34a'),
      bClear = mk('Clear', '#b91c1c'), bClose = mk('Close', '#444');
  bar.appendChild(bCopy); bar.appendChild(bShare); bar.appendChild(bClear); bar.appendChild(bClose);
  var out = el('div', 'flex:1;overflow:auto;padding:6px 8px;white-space:pre-wrap;word-break:break-word');
  panel.appendChild(bar); panel.appendChild(out);

  function text() { return buf.join('\n'); }
  function render() {
    if (!panel || panel.style.display === 'none') return;   // UI not built yet, or hidden
    out.textContent = text();
  }
  function open()  { panel.style.display = 'flex'; out.textContent = text(); out.scrollTop = out.scrollHeight; }
  function close() { panel.style.display = 'none'; }

  btn.addEventListener('click', function () { panel.style.display === 'none' ? open() : close(); });
  bClose.addEventListener('click', close);
  bClear.addEventListener('click', function () { buf = []; save(buf); out.textContent = ''; add('INIT', 'log cleared'); });
  bCopy.addEventListener('click', function () {
    var s = text();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = s;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(function () { bCopy.textContent = 'Copied!'; setTimeout(function () { bCopy.textContent = 'Copy'; }, 1200); }, fallback);
    } else { fallback(); bCopy.textContent = 'Copied!'; setTimeout(function () { bCopy.textContent = 'Copy'; }, 1200); }
  });
  bShare.addEventListener('click', function () {
    if (navigator.share) navigator.share({ title: 'ArgueOut debug log', text: text() }).catch(function () {});
    else bCopy.click();
  });

  function mount() {
    if (!document.body) { setTimeout(mount, 50); return; }
    document.body.appendChild(btn);
    document.body.appendChild(panel);
  }
  mount();
})();
