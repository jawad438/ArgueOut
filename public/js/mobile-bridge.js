(function () {
  const mt = window.__MOBILE_CUSTOM_TOKEN;
  if (!mt) return;

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
