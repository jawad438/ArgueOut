(function () {
  var year = new Date().getFullYear();

  var bar = document.createElement('div');
  bar.className = 'lf-bar';
  bar.innerHTML =
    '<div class="lf-inner">' +
      '<div class="lf-tabs">' +
        '<a href="/legal" class="lf-tab">Terms of Service</a>' +
        '<a href="/legal#privacy" class="lf-tab">Privacy Policy</a>' +
        '<a href="/cookies" class="lf-tab">Cookies</a>' +
        '<a href="/help" class="lf-tab">Help &amp; Guide</a>' +
        '<button type="button" class="lf-tab" id="lfCookieSettingsBtn" style="background:none;border:none;font:inherit;cursor:pointer">Cookie Settings</button>' +
      '</div>' +
      '<div class="lf-copy">&copy; ' + year + ' ArgueOut. All rights reserved.</div>' +
    '</div>';

  document.body.appendChild(bar);

  var settingsBtn = document.getElementById('lfCookieSettingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function () {
      if (window.CookieConsent && window.CookieConsent.openPreferences) {
        window.CookieConsent.openPreferences();
      }
    });
  }
})();
