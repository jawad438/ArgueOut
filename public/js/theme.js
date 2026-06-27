/* ── ArgueOut Theme Manager ─────────────────────────────────── */
(function () {
  var KEY = 'ao-theme';

  var ICONS = {
    dark:   '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    light:  '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    system: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  };

  function _setAttr(t) {
    var root = document.documentElement;
    if (t === 'dark')       root.setAttribute('data-theme', 'dark');
    else if (t === 'light') root.setAttribute('data-theme', 'light');
    else                    root.removeAttribute('data-theme');
  }

  function _updateUI(t) {
    var icon = document.getElementById('themeIcon');
    if (icon) icon.innerHTML = ICONS[t] || ICONS.system;
    document.querySelectorAll('[data-t]').forEach(function (el) {
      var check = el.querySelector('.theme-check');
      var active = el.dataset.t === t;
      el.classList.toggle('active', active);
      if (check) check.style.opacity = active ? '1' : '0';
    });
  }

  window.applyTheme = function (t) {
    localStorage.setItem(KEY, t);
    _setAttr(t);
    _updateUI(t);
    var menu = document.getElementById('themeMenu');
    if (menu) menu.style.display = 'none';
  };

  window.themeMenuToggle = function (e) {
    e.stopPropagation();
    var menu = document.getElementById('themeMenu');
    if (!menu) return;
    var opening = menu.style.display !== 'flex';
    if (opening) {
      if (typeof closeAccountSwitcher === 'function') closeAccountSwitcher();
      if (typeof closeNotifDropdown   === 'function') closeNotifDropdown();
    }
    menu.style.display = opening ? 'flex' : 'none';
  };

  document.addEventListener('click', function (e) {
    var menu = document.getElementById('themeMenu');
    var btn  = document.getElementById('themeBtn');
    if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
      menu.style.display = 'none';
    }
  });

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      var saved = localStorage.getItem(KEY) || 'system';
      if (saved === 'system') _updateUI('system');
    });
  }

  var saved = localStorage.getItem(KEY) || 'system';
  _setAttr(saved);
  _updateUI(saved);
}());
