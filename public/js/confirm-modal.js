/* confirm-modal.js — shared in-app replacement for window.confirm(), so
   destructive/consequential actions get a styled modal instead of the
   browser's native "Page says:" dialog. Promise-based: `await appConfirm(msg)`
   resolves true/false exactly like `confirm()` did, so call sites barely
   change beyond adding `await` and making the enclosing function async. */
(function () {
  let overlay = null;
  let resolvePending = null;

  function settle(result) {
    overlay.style.display = 'none';
    const r = resolvePending;
    resolvePending = null;
    if (r) r(result);
  }

  function ensureModal() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML =
      '<div class="modal-card modal-pop-in" style="max-width:380px;text-align:left">' +
        '<div id="appConfirmTitle" style="font-size:1.05rem;font-weight:700;font-family:\'Space Grotesk\',sans-serif;margin-bottom:10px"></div>' +
        '<div id="appConfirmMessage" style="font-size:0.87rem;color:var(--text-2);line-height:1.6;margin-bottom:22px;white-space:pre-line"></div>' +
        '<div style="display:flex;gap:10px">' +
          '<button class="btn btn-ghost btn-full" id="appConfirmCancelBtn">Cancel</button>' +
          '<button class="btn btn-full" id="appConfirmOkBtn">Confirm</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) settle(false); });
    overlay.querySelector('#appConfirmCancelBtn').addEventListener('click', function () { settle(false); });
    overlay.querySelector('#appConfirmOkBtn').addEventListener('click', function () { settle(true); });
    document.addEventListener('keydown', function (e) {
      if (overlay.style.display !== 'none' && e.key === 'Escape') settle(false);
    });
  }

  // opts: { title, confirmText, cancelText, danger } — danger (default true)
  // colors the confirm button red via .btn-danger; pass danger:false for a
  // neutral/positive action (styled with .btn-primary instead).
  window.appConfirm = function (message, opts) {
    opts = opts || {};
    ensureModal();
    const titleEl = overlay.querySelector('#appConfirmTitle');
    if (opts.title) { titleEl.textContent = opts.title; titleEl.style.display = ''; }
    else { titleEl.style.display = 'none'; }
    overlay.querySelector('#appConfirmMessage').textContent = message || '';
    const okBtn = overlay.querySelector('#appConfirmOkBtn');
    okBtn.textContent = opts.confirmText || 'Confirm';
    okBtn.className = 'btn btn-full ' + (opts.danger === false ? 'btn-primary' : 'btn-danger');
    overlay.querySelector('#appConfirmCancelBtn').textContent = opts.cancelText || 'Cancel';
    overlay.style.display = 'flex';
    return new Promise(function (resolve) { resolvePending = resolve; });
  };
})();
