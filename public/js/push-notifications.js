/* push-notifications.js — asks for browser notification permission on first
   visit (once signed in) and registers the resulting FCM token with the
   server. Delivers: admin broadcasts, challenge requests, and "N people
   online" reminders. Requires firebase-init.js (auth) loaded first.

   IMPORTANT: FCM_VAPID_KEY below is a placeholder. Generate the real one in
   the Firebase Console: Project Settings -> Cloud Messaging -> Web Push
   certificates -> Generate key pair, then paste it in here. Push silently
   no-ops (with a console warning) until this is set. */
const FCM_VAPID_KEY = 'REPLACE_WITH_VAPID_KEY_FROM_FIREBASE_CONSOLE';

// Called from the native Android app (FCMService via MainActivity) with its
// own natively-obtained FCM token — the WebView has no Web Notifications API
// permission flow of its own, so the native side handles permission/token
// retrieval and just hands the token off here to register it the same way
// the browser path does.
window.onAndroidFcmToken = function (token) {
  if (!token) return;
  (function trySend() {
    if (typeof auth === 'undefined' || !auth.currentUser) { setTimeout(trySend, 300); return; }
    auth.currentUser.getIdToken().then(idToken => {
      fetch('/api/notifications/register-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ token })
      }).catch(() => {});
    }).catch(() => {});
  })();
};

(function () {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (typeof firebase === 'undefined' || !firebase.messaging || !firebase.messaging.isSupported()) return;

  const PROMPTED_KEY = 'ao-notif-prompted';

  function showPermissionBanner(onAllow) {
    if (document.getElementById('notifPermBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'notifPermBanner';
    banner.style.cssText =
      'position:fixed;left:16px;right:16px;bottom:16px;max-width:420px;margin:0 auto;' +
      'background:var(--card-bg,#15151f);border:1px solid var(--border,#2a2a38);' +
      'border-radius:14px;padding:16px;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.4);' +
      'font-family:inherit;color:var(--text-1,#fff);display:flex;flex-direction:column;gap:10px;';
    banner.innerHTML =
      '<div style="font-weight:600;font-size:0.95rem">Enable notifications?</div>' +
      '<div style="font-size:0.85rem;opacity:0.75;line-height:1.4">' +
      'Get notified about challenge requests, admin announcements, and when people are online to debate.</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button id="notifPermDismiss" style="background:transparent;border:none;color:var(--text-2,#aaa);padding:8px 12px;border-radius:8px;cursor:pointer;font-size:0.85rem">Not now</button>' +
      '<button id="notifPermAllow" style="background:var(--purple,#8b5cf6);border:none;color:#fff;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600">Allow</button>' +
      '</div>';
    document.body.appendChild(banner);

    document.getElementById('notifPermDismiss').addEventListener('click', () => {
      localStorage.setItem(PROMPTED_KEY, '1');
      banner.remove();
    });
    document.getElementById('notifPermAllow').addEventListener('click', () => {
      localStorage.setItem(PROMPTED_KEY, '1');
      banner.remove();
      onAllow();
    });
  }

  async function registerToken() {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const messaging = firebase.messaging();
      const token = await messaging.getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: registration });
      if (!token) return;
      const user = auth.currentUser;
      if (!user) return;
      const idToken = await user.getIdToken();
      await fetch('/api/notifications/register-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ token })
      });
      messaging.onMessage(payload => {
        if (typeof showToast === 'function') {
          showToast(payload.notification?.body || 'New notification', 'info');
        }
      });
    } catch (e) {
      console.warn('[push] token registration failed:', e.message);
    }
  }

  function maybePrompt() {
    if (Notification.permission === 'granted') { registerToken(); return; }
    if (Notification.permission === 'denied') return;
    if (localStorage.getItem(PROMPTED_KEY)) return;
    showPermissionBanner(() => {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') registerToken();
      });
    });
  }

  auth.onAuthStateChanged(user => {
    if (user) maybePrompt();
  });
})();
