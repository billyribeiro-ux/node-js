/* =========================================================================
   app.js — bootstrap. Wires the header chrome, builds the sidebar, keeps the
   overall progress bar in sync, and starts the router. Runs last.
   ========================================================================= */
(function () {
  "use strict";

  function updateOverall() {
    if (!window.COURSE || !window.Progress) return;
    var pct = Math.round((window.Progress.completedCount() / window.COURSE.totalLessons) * 100);
    var bar = document.getElementById("overall-progress-bar");
    var label = document.getElementById("overall-progress-label");
    if (bar) bar.style.width = pct + "%";
    if (label) label.textContent = pct + "%";
  }

  function boot() {
    if (!window.COURSE) { console.error("Course manifest missing"); return; }

    // Sidebar
    window.Sidebar.build();

    // Sidebar toggle (mobile) + scrim
    var toggle = document.getElementById("sidebar-toggle");
    var scrim = document.getElementById("sidebar-scrim");
    if (toggle) toggle.addEventListener("click", function () {
      document.body.classList.toggle("sidebar-open");
    });
    if (scrim) scrim.addEventListener("click", function () {
      document.body.classList.remove("sidebar-open");
    });
    // show scrim only when drawer open (CSS handles >900px)
    var obs = new MutationObserver(function () {
      if (scrim) scrim.hidden = !document.body.classList.contains("sidebar-open");
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    // Progress bar sync; also refresh the landing rings if we're on the home page.
    window.Progress.onChange(function () {
      updateOverall();
      if ((!location.hash || location.hash === "#/") && window.Router) {
        window.Router.refresh();
      }
    });
    updateOverall();

    // Re-render the current view when the language changes.
    if (window.I18n) window.I18n.onChange(function () { if (window.Router) window.Router.refresh(); });

    // Go
    window.Router.start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
