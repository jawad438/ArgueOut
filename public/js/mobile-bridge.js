(function () {
  const mt = window.__MOBILE_CUSTOM_TOKEN;
  if (!mt) return;

  // ── 1. PLAIN BACKGROUND ──────────────────────────────────────────────────
  function injectBaseStyles() {
    var s = document.createElement('style');
    s.textContent =
      '#bgCanvas{display:none!important}' +
      'html,body{background:#05050f!important}';
    document.head.appendChild(s);
  }
  if (document.head) injectBaseStyles();
  else document.addEventListener('DOMContentLoaded', injectBaseStyles);

  // ── 2. DEBATE PAGE OVERRIDES (only runs on /debate) ─────────────────────
  function isDebatePage() {
    return /\/debate/.test(window.location.pathname);
  }

  function injectDebateStyles() {
    var s = document.createElement('style');
    s.textContent = [
      /* Hide logo, vs text */
      '.debate-header-brand{display:none!important}',
      '.debate-topic{display:none!important}',
      /* Hide legal footer (added dynamically by legal-footer.js) */
      '.legal-footer,.site-footer,footer.legal{display:none!important}',
      /* Self cam: no name label */
      '.self-panel .video-label{display:none!important}',
      /* Taller portrait video area */
      '.video-area{padding:4px!important;gap:0!important}',
      '.video-grid{',
      '  position:relative!important;display:block!important;',
      '  height:52dvh!important;min-height:280px!important;max-height:480px!important',
      '}',
      /* Opponent fills full portrait container */
      '.opponent-panel{',
      '  position:absolute!important;inset:0!important;',
      '  border-radius:12px!important;aspect-ratio:unset!important',
      '}',
      /* Self: portrait thumbnail, no name */
      '.self-panel{',
      '  position:absolute!important;bottom:8px!important;right:8px!important;',
      '  width:64px!important;height:88px!important;',
      '  border-radius:8px!important;z-index:5!important;aspect-ratio:unset!important',
      '}',
      /* Controls: compact row, scrollable, no wrap */
      '.debate-controls{',
      '  padding:6px 4px!important;gap:2px!important;',
      '  flex-wrap:nowrap!important;overflow-x:auto!important;',
      '  -webkit-overflow-scrolling:touch!important;scrollbar-width:none!important;',
      '  justify-content:space-around!important;',
      '  padding-bottom:calc(6px + env(safe-area-inset-bottom,0px))!important',
      '}',
      '.debate-controls::-webkit-scrollbar{display:none!important}',
      '.btn-icon{width:40px!important;height:40px!important}',
      '.control-label{font-size:0.5rem!important}',
      '.control-wrap{min-width:42px!important;flex-shrink:0!important}',
      /* Chat: slide up from bottom like a sheet */
      '.chat-sidebar{',
      '  position:fixed!important;left:0!important;right:0!important;',
      '  bottom:0!important;top:auto!important;width:100%!important;',
      '  height:40dvh!important;',
      '  border-radius:16px 16px 0 0!important;',
      '  border-left:none!important;border-right:none!important;border-bottom:none!important;',
      '  transform:translateY(102%)!important;transition:transform 0.25s ease!important;',
      '  z-index:200!important',
      '}',
      '.chat-sidebar.mobile-visible{transform:translateY(0)!important}',
      '#chatBackdrop{pointer-events:auto!important}',
    ].join('');
    document.head.appendChild(s);
  }

  function autoHideLegalFooter() {
    // legal-footer.js appends a footer after DOMContentLoaded — observe for it
    var obs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (!n.classList) return;
          if (n.classList.contains('legal-footer') ||
              n.classList.contains('site-footer') ||
              n.tagName === 'FOOTER') {
            n.style.setProperty('display', 'none', 'important');
          }
        });
      });
    });
    obs.observe(document.body, {childList: true, subtree: true});
    // Also remove any already-present footer
    var existing = document.querySelector('.legal-footer,.site-footer,footer.legal');
    if (existing) existing.style.setProperty('display', 'none', 'important');
  }

  if (isDebatePage()) {
    if (document.head) {
      injectDebateStyles();
    } else {
      document.addEventListener('DOMContentLoaded', injectDebateStyles);
    }
    document.addEventListener('DOMContentLoaded', autoHideLegalFooter);
  }

  // ── 3. FIREBASE CUSTOM TOKEN SIGN-IN ─────────────────────────────────────
  function tryBridge() {
    if (typeof firebase === 'undefined' || !firebase.auth) {
      setTimeout(tryBridge, 100);
      return;
    }
    firebase.auth().signInWithCustomToken(mt).catch(function (e) {
      console.warn('[mobile-bridge] custom token sign-in failed:', e.message);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryBridge);
  } else {
    tryBridge();
  }
})();
