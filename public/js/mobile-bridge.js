(function () {
  const mt = window.__MOBILE_CUSTOM_TOKEN;
  if (!mt) return;

  // Inside the native app: strip the animated network background to a plain one
  function plainBackground() {
    const style = document.createElement('style');
    style.textContent =
      '#bgCanvas{display:none!important}' +
      'html,body{background:#05050f!important}';
    document.head.appendChild(style);
  }
  if (document.head) {
    plainBackground();
  } else {
    document.addEventListener('DOMContentLoaded', plainBackground);
  }

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
