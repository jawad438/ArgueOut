(function () {
  var year = new Date().getFullYear();

  var bar = document.createElement('div');
  bar.className = 'lf-bar';
  bar.innerHTML =
    '<div class="lf-inner">' +
      '<div class="lf-tabs">' +
        '<a href="/legal" class="lf-tab">Terms of Service</a>' +
        '<a href="/legal#privacy" class="lf-tab">Privacy Policy</a>' +
        '<a href="/help" class="lf-tab">Help &amp; Guide</a>' +
      '</div>' +
      '<div class="lf-copy">&copy; ' + year + ' ArgueOut. All rights reserved.</div>' +
    '</div>';

  document.body.appendChild(bar);
})();
