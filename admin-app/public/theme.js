/* Light/dark theme for OneGrid WebAdmin. Loaded in <head> (before the page is drawn) so it never
 * flashes the wrong colours. First visit follows the device's setting; once someone uses the
 * switch, their choice is remembered on that device. Buttons: any element with [data-theme-toggle]. */
(function () {
  'use strict';
  var KEY = 'onegrid-admin-theme';
  var root = document.documentElement;
  var systemLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function saved() {
    try { var value = localStorage.getItem(KEY); return value === 'light' || value === 'dark' ? value : null; } catch (e) { return null; }
  }
  function apply(theme) {
    root.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#0a0a0a');
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      var next = theme === 'light' ? 'dark' : 'light';
      buttons[i].setAttribute('aria-label', 'Switch to ' + next + ' mode');
      buttons[i].setAttribute('title', 'Switch to ' + next + ' mode');
      var label = buttons[i].querySelector('[data-theme-label]');
      if (label) label.textContent = next === 'light' ? 'Light mode' : 'Dark mode';
    }
  }

  apply(saved() || (systemLight && systemLight.matches ? 'light' : 'dark'));

  // Follow the device setting until the person picks a theme themselves.
  if (systemLight && systemLight.addEventListener) {
    systemLight.addEventListener('change', function (event) { if (!saved()) apply(event.matches ? 'light' : 'dark'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    apply(root.dataset.theme);
    document.addEventListener('click', function (event) {
      if (!event.target.closest || !event.target.closest('[data-theme-toggle]')) return;
      var next = root.dataset.theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(KEY, next); } catch (e) { /* still switches for this visit */ }
      apply(next);
    });
  });
})();
