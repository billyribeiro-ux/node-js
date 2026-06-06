/* =========================================================================
   theme-toggle.js — light/dark switch, persisted, also drives Monaco theme.
   Exposes window.Theme with get()/set()/onChange() so the Monaco loader can
   keep editors in sync with the page.
   ========================================================================= */
(function () {
  "use strict";

  var KEY = "ultimate-node-course:theme";
  var listeners = [];

  function systemPref() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light" : "dark";
  }

  function current() {
    return document.documentElement.getAttribute("data-theme") || "dark";
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    listeners.forEach(function (fn) { try { fn(theme); } catch (e) {} });
  }

  var Theme = {
    get: current,
    set: function (theme) {
      apply(theme);
      try { localStorage.setItem(KEY, theme); } catch (e) {}
    },
    toggle: function () { this.set(current() === "dark" ? "light" : "dark"); },
    /** monaco theme name matching the current page theme */
    monaco: function () { return current() === "light" ? "vs" : "vs-dark"; },
    onChange: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    }
  };

  // Initialise from stored preference, else system preference.
  var stored;
  try { stored = localStorage.getItem(KEY); } catch (e) {}
  apply(stored || systemPref());

  // Wire the header button once the DOM is ready.
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("theme-toggle");
    if (btn) btn.addEventListener("click", function () { Theme.toggle(); });
  });

  window.Theme = Theme;
})();
