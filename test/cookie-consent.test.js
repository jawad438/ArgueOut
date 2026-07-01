/* Unit tests for the pure consent-state logic in public/js/cookie-consent.js.
   Run with: npm test (node:test, no extra dependency). */
const test = require('node:test');
const assert = require('node:assert/strict');

// cookie-consent.js detects the browser vs Node environment via `typeof
// document === 'undefined'` and returns before touching any DOM APIs, so it's
// safe to require directly under plain Node. A minimal in-memory localStorage
// polyfill is enough to exercise the storage-backed functions.
function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); }
  };
}

global.localStorage = makeFakeLocalStorage();

const CookieConsent = require('../public/js/cookie-consent.js');

test('essential category is always granted, even with zero saved consent', () => {
  assert.equal(CookieConsent.hasConsent('essential'), true);
});

test('non-essential categories are denied before any consent is saved', () => {
  assert.equal(CookieConsent.hasConsent('functional'), false);
  assert.equal(CookieConsent.hasConsent('analytics'), false);
  assert.equal(CookieConsent.hasConsent('thirdParty'), false);
  assert.equal(CookieConsent.getConsent(), null);
});

test('isValidRecord rejects a record with the wrong version (forces re-consent on policy change)', () => {
  const record = CookieConsent.buildRecord({ functional: true }, Date.now());
  record.version = CookieConsent.CONSENT_VERSION + 1;
  assert.equal(CookieConsent.isValidRecord(record, Date.now()), false);
});

test('isValidRecord rejects a record older than the 12-month max age', () => {
  const now = Date.now();
  const record = CookieConsent.buildRecord({ functional: true }, now - CookieConsent.MAX_AGE_MS - 1000);
  assert.equal(CookieConsent.isValidRecord(record, now), false);
});

test('isValidRecord accepts a fresh, correctly-versioned record', () => {
  const now = Date.now();
  const record = CookieConsent.buildRecord({ functional: true, analytics: false, thirdParty: false }, now);
  assert.equal(CookieConsent.isValidRecord(record, now), true);
});

test('isValidRecord rejects malformed records (missing/invalid fields)', () => {
  const now = Date.now();
  assert.equal(CookieConsent.isValidRecord(null, now), false);
  assert.equal(CookieConsent.isValidRecord({}, now), false);
  assert.equal(CookieConsent.isValidRecord({ version: CookieConsent.CONSENT_VERSION }, now), false);
  assert.equal(CookieConsent.isValidRecord({ version: CookieConsent.CONSENT_VERSION, timestamp: 'not-a-number', categories: {} }, now), false);
});

test('writeConsent -> getConsent round-trips through storage and reflects the chosen categories', () => {
  localStorage.clear();
  const written = CookieConsent.writeConsent({ functional: true, analytics: false, thirdParty: true });
  assert.equal(written.categories.essential, true);
  assert.equal(written.categories.functional, true);
  assert.equal(written.categories.analytics, false);
  assert.equal(written.categories.thirdParty, true);

  const read = CookieConsent.getConsent();
  assert.deepEqual(read, written);
  assert.equal(CookieConsent.hasConsent('functional'), true);
  assert.equal(CookieConsent.hasConsent('analytics'), false);
  assert.equal(CookieConsent.hasConsent('thirdParty'), true);
});

test('buildRecord always forces essential to true regardless of what is passed in', () => {
  const record = CookieConsent.buildRecord({ essential: false, functional: true }, Date.now());
  assert.equal(record.categories.essential, true);
});

test('"Reject Non-Essential" transition (all non-essential categories false) is a valid, distinct state from "Accept All"', () => {
  localStorage.clear();
  const rejected = CookieConsent.writeConsent({ functional: false, analytics: false, thirdParty: false });
  assert.equal(CookieConsent.hasConsent('functional'), false);
  assert.equal(CookieConsent.hasConsent('analytics'), false);
  assert.equal(CookieConsent.hasConsent('thirdParty'), false);
  assert.equal(CookieConsent.hasConsent('essential'), true); // never blocked

  const accepted = CookieConsent.writeConsent({ functional: true, analytics: true, thirdParty: true });
  assert.notDeepEqual(accepted.categories, rejected.categories);
  assert.equal(CookieConsent.hasConsent('analytics'), true);
});

test('dntOrGpcSignaled detects Do Not Track = "1"', () => {
  assert.equal(CookieConsent.dntOrGpcSignaled({ doNotTrack: '1' }), true);
});

test('dntOrGpcSignaled detects Global Privacy Control', () => {
  assert.equal(CookieConsent.dntOrGpcSignaled({ globalPrivacyControl: true }), true);
});

test('dntOrGpcSignaled is false when no signal is present', () => {
  assert.equal(CookieConsent.dntOrGpcSignaled({ doNotTrack: null, globalPrivacyControl: false }), false);
  assert.equal(CookieConsent.dntOrGpcSignaled(null), false);
});
