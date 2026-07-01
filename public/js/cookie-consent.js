/* cookie-consent.js — GDPR/CCPA-style cookie consent banner + preference center.

   Categories:
   - essential  — always on (Firebase auth session, Socket.io connection, the
                  consent record itself). Never shown as a toggle the user can turn off.
   - functional — first-party preferences that make the app itself work better
                  (theme choice, saved debate topic/room state, saved account list).
   - analytics  — reserved for future use. ArgueOut runs no analytics today; this
                  category exists so hasConsent('analytics') is ready the moment
                  one is added, with zero migration work.
   - thirdParty — reserved for any future third-party tracking/ad scripts. The
                  OpenRouter AI-question calls and Firebase auth are core,
                  essential-path service calls, not tracking, so they are not
                  gated behind this category (see /cookies for the disclosure).

   The pure consent-state functions (isValidRecord/resolveConsent/writeConsent/
   getConsent/hasConsent/dntOrGpcSignaled) work without a DOM so they can be
   unit-tested under plain Node (see test/cookie-consent.test.js). The banner/
   modal UI below only runs when `document` exists. */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.CookieConsent = mod;
})(this, function () {
  'use strict';

  var CONSENT_KEY     = 'ao-consent-v1';
  var CONSENT_VERSION = 1;
  var MAX_AGE_MS       = 365 * 24 * 60 * 60 * 1000; // 12 months — force re-consent after this
  var CATEGORIES       = ['functional', 'analytics', 'thirdParty']; // essential is implicit/always-on

  function hasLocalStorage() {
    try { return typeof localStorage !== 'undefined'; } catch (e) { return false; }
  }

  // ---- pure logic (no globals besides an explicit `nowMs`) --------------

  function isValidRecord(record, nowMs) {
    if (!record || typeof record !== 'object') return false;
    if (record.version !== CONSENT_VERSION) return false;
    if (typeof record.timestamp !== 'number') return false;
    if (nowMs - record.timestamp > MAX_AGE_MS) return false;
    if (!record.categories || typeof record.categories !== 'object') return false;
    return true;
  }

  // Builds a full, well-formed consent record from a partial categories object.
  function buildRecord(categories, nowMs) {
    categories = categories || {};
    return {
      version: CONSENT_VERSION,
      timestamp: nowMs,
      categories: {
        essential: true, // always on, not a real choice
        functional: !!categories.functional,
        analytics: !!categories.analytics,
        thirdParty: !!categories.thirdParty
      }
    };
  }

  function dntOrGpcSignaled(nav) {
    nav = nav || (typeof navigator !== 'undefined' ? navigator : null);
    if (!nav) return false;
    var dnt = nav.doNotTrack || (typeof window !== 'undefined' && window.doNotTrack);
    return dnt === '1' || dnt === 'yes' || nav.globalPrivacyControl === true;
  }

  // ---- storage-backed API -------------------------------------------------

  function readRaw() {
    if (!hasLocalStorage()) return null;
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function getConsent(nowMs) {
    nowMs = typeof nowMs === 'number' ? nowMs : Date.now();
    var record = readRaw();
    return isValidRecord(record, nowMs) ? record : null;
  }

  function hasConsent(category) {
    if (category === 'essential') return true;
    var record = getConsent();
    return !!(record && record.categories[category]);
  }

  function getAnonId() {
    if (!hasLocalStorage()) return 'anon_unknown';
    try {
      var id = localStorage.getItem('ao-anon-id');
      if (!id) {
        id = 'anon_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('ao-anon-id', id);
      }
      return id;
    } catch (e) { return 'anon_unknown'; }
  }

  function postConsent(record, idToken) {
    try {
      fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: record.version,
          categories: record.categories,
          timestamp: record.timestamp,
          anonId: getAnonId(),
          idToken: idToken || undefined
        })
      }).catch(function () {});
    } catch (e) {}
  }

  // Fire-and-forget compliance log. Attaches the signed-in user's ID token when
  // available (async), but never blocks writeConsent()'s synchronous return —
  // an anonId is logged either way so the record always exists.
  function logConsentEvent(record) {
    if (typeof fetch === 'undefined') return;
    try {
      if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
        firebase.auth().currentUser.getIdToken().then(
          function (idToken) { postConsent(record, idToken); },
          function () { postConsent(record, null); }
        );
        return;
      }
    } catch (e) {}
    postConsent(record, null);
  }

  function writeConsent(categories) {
    var record = buildRecord(categories, Date.now());
    if (hasLocalStorage()) {
      try { localStorage.setItem(CONSENT_KEY, JSON.stringify(record)); } catch (e) {}
    }
    if (typeof document !== 'undefined' && document.dispatchEvent) {
      try { document.dispatchEvent(new CustomEvent('ao-consent-changed', { detail: record })); } catch (e) {}
    }
    logConsentEvent(record);
    return record;
  }

  // ---- UI (browser only) --------------------------------------------------

  var api = {
    CONSENT_KEY: CONSENT_KEY,
    CONSENT_VERSION: CONSENT_VERSION,
    MAX_AGE_MS: MAX_AGE_MS,
    CATEGORIES: CATEGORIES,
    isValidRecord: isValidRecord,
    buildRecord: buildRecord,
    dntOrGpcSignaled: dntOrGpcSignaled,
    getConsent: getConsent,
    hasConsent: hasConsent,
    writeConsent: writeConsent,
    openPreferences: function () { /* replaced below once UI is built */ }
  };

  if (typeof document === 'undefined') return api; // Node/test environment — stop here

  var CATEGORY_META = [
    {
      key: 'functional',
      label: 'Functional',
      desc: 'Remembers your choices so the app works the way you left it — theme (dark/light), your saved account list, and in-progress debate/topic state.'
    },
    {
      key: 'analytics',
      label: 'Analytics',
      desc: 'Would help us understand how the app is used so we can improve it. Not currently in use — reserved for future opt-in.'
    },
    {
      key: 'thirdParty',
      label: 'Third-Party',
      desc: 'Reserved for any future third-party tracking or advertising scripts. ArgueOut runs none today. See the Cookies page for how Firebase and OpenRouter are used as core services, not trackers.'
    }
  ];

  function el(tag, className, html) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (html != null) e.innerHTML = html;
    return e;
  }

  var bannerEl = null;
  var modalEl  = null;

  function removeBanner() {
    if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
    bannerEl = null;
  }

  function buildBanner() {
    if (bannerEl) return bannerEl;
    var banner = el('div', 'cookie-banner');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<div class="cookie-banner-inner">' +
        '<div class="cookie-banner-text">' +
          'We use essential cookies/local storage to run ArgueOut, and optional functional ones to remember preferences like your theme. ' +
          '<a href="/cookies" class="cookie-banner-link">Learn more</a>' +
        '</div>' +
        '<div class="cookie-banner-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="cookieRejectBtn">Reject Non-Essential</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="cookieManageBtn">Manage Preferences</button>' +
          '<button type="button" class="btn btn-primary btn-sm" id="cookieAcceptBtn">Accept All</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);
    bannerEl = banner;

    banner.querySelector('#cookieAcceptBtn').addEventListener('click', function () {
      writeConsent({ functional: true, analytics: true, thirdParty: true });
      removeBanner();
    });
    banner.querySelector('#cookieRejectBtn').addEventListener('click', function () {
      writeConsent({ functional: false, analytics: false, thirdParty: false });
      removeBanner();
    });
    banner.querySelector('#cookieManageBtn').addEventListener('click', function () {
      openModal();
    });
    return banner;
  }

  function closeModal() {
    if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    modalEl = null;
  }

  function openModal() {
    if (modalEl) return;
    var existing = getConsent() || api.buildRecord({}, Date.now());
    var dntActive = dntOrGpcSignaled();

    var overlay = el('div', 'modal-overlay cookie-modal-overlay');
    overlay.style.display = 'flex';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    var rowsHtml = CATEGORY_META.map(function (cat) {
      var checked = existing.categories[cat.key] && !(dntActive && !getConsent());
      return (
        '<div class="cookie-category-row">' +
          '<div class="cookie-category-text">' +
            '<div class="cookie-category-label">' + cat.label + '</div>' +
            '<div class="cookie-category-desc">' + cat.desc + '</div>' +
          '</div>' +
          '<label class="cookie-toggle">' +
            '<input type="checkbox" data-cat="' + cat.key + '"' + (checked ? ' checked' : '') + '>' +
            '<span class="cookie-toggle-track"><span class="cookie-toggle-thumb"></span></span>' +
          '</label>' +
        '</div>'
      );
    }).join('');

    var modal = el('div', 'modal-card cookie-modal');
    modal.innerHTML =
      '<button type="button" class="cookie-modal-close" aria-label="Close">' +
        '<svg style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
      '<div style="font-size:1.1rem;font-weight:700;margin-bottom:4px">Cookie Preferences</div>' +
      '<div style="font-size:0.85rem;color:var(--text-3);margin-bottom:18px">Choose what ArgueOut is allowed to store on this device. Essential storage cannot be disabled — the app can\'t log you in or connect video without it.' +
        (dntActive ? '<br><br><strong>A Do Not Track / Global Privacy Control signal was detected from your browser.</strong> Non-essential categories default to off in response.' : '') +
      '</div>' +
      '<div class="cookie-category-row" style="opacity:0.65">' +
        '<div class="cookie-category-text">' +
          '<div class="cookie-category-label">Essential</div>' +
          '<div class="cookie-category-desc">Required for login, video-call connection, and remembering this consent choice. Always active.</div>' +
        '</div>' +
        '<label class="cookie-toggle cookie-toggle-locked"><span class="cookie-toggle-track cookie-toggle-track-on"><span class="cookie-toggle-thumb"></span></span></label>' +
      '</div>' +
      rowsHtml +
      '<div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-ghost btn-sm" id="cookieModalRejectBtn">Reject Non-Essential</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="cookieModalSaveBtn" style="margin-left:auto">Save Preferences</button>' +
      '</div>';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    modalEl = overlay;

    modal.querySelector('.cookie-modal-close').addEventListener('click', closeModal);
    modal.querySelector('#cookieModalRejectBtn').addEventListener('click', function () {
      writeConsent({ functional: false, analytics: false, thirdParty: false });
      removeBanner();
      closeModal();
    });
    modal.querySelector('#cookieModalSaveBtn').addEventListener('click', function () {
      var categories = {};
      CATEGORY_META.forEach(function (cat) {
        var input = modal.querySelector('input[data-cat="' + cat.key + '"]');
        categories[cat.key] = !!(input && input.checked);
      });
      writeConsent(categories);
      removeBanner();
      closeModal();
    });
  }

  api.openPreferences = openModal;

  function init() {
    if (window.__AO_COOKIE_CONSENT_INIT__) return;
    window.__AO_COOKIE_CONSENT_INIT__ = true;
    if (!getConsent()) buildBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return api;
});
