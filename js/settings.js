/* =========================================================================
   settings.js — a slide-in settings panel: theme, reading font size,
   progress export / import / reset. Opened via the header gear button.
   Font scale is applied as a CSS variable on <html>. Exposes window.Settings.
   ========================================================================= */
(function () {
  "use strict";

  var FONT_KEY = "ultimate-node-course:fontscale";
  var panel, scrim;

  function applyFontScale(scale) {
    document.documentElement.style.setProperty("--content-font-scale", scale);
    try { localStorage.setItem(FONT_KEY, String(scale)); } catch (e) {}
  }
  function currentScale() {
    var v;
    try { v = localStorage.getItem(FONT_KEY); } catch (e) {}
    return v ? parseFloat(v) : 1;
  }

  function download(filename, text) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function build() {
    scrim = document.createElement("div");
    scrim.className = "settings-scrim";
    scrim.hidden = true;
    scrim.addEventListener("click", close);
    document.body.appendChild(scrim);

    panel = document.createElement("aside");
    panel.className = "settings-panel";
    panel.hidden = true;
    panel.innerHTML =
      '<div class="settings-head"><h2>Settings</h2>' +
        '<button class="icon-btn" id="settings-close" aria-label="Close settings">✕</button></div>' +

      '<div class="settings-group">' +
        "<label>Theme</label>" +
        '<div class="settings-row">' +
          '<button class="seg" data-theme-set="light">Light</button>' +
          '<button class="seg" data-theme-set="dark">Dark</button>' +
        "</div>" +
      "</div>" +

      '<div class="settings-group">' +
        '<label>Reading text size — <span id="font-scale-val"></span></label>' +
        '<input type="range" id="font-scale" min="0.85" max="1.4" step="0.05" />' +
      "</div>" +

      '<div class="settings-group">' +
        "<label>Progress</label>" +
        '<p class="settings-hint" id="progress-summary"></p>' +
        '<div class="settings-row">' +
          '<button class="btn" id="export-progress">Export…</button>' +
          '<button class="btn" id="import-progress">Import…</button>' +
        "</div>" +
        '<button class="btn btn-danger" id="reset-progress">Reset all progress</button>' +
        '<input type="file" id="import-file" accept="application/json" hidden />' +
      "</div>" +

      '<div class="settings-group settings-about">' +
        "<label>Keyboard shortcuts</label>" +
        '<ul class="shortcut-list">' +
          "<li><kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> — search lessons</li>" +
          "<li><kbd>←</kbd> <kbd>→</kbd> — previous / next lesson</li>" +
          "<li><kbd>t</kbd> — toggle theme · <kbd>m</kbd> — menu</li>" +
        "</ul>" +
      "</div>";
    document.body.appendChild(panel);

    panel.querySelector("#settings-close").addEventListener("click", close);
    panel.querySelectorAll("[data-theme-set]").forEach(function (b) {
      b.addEventListener("click", function () { window.Theme.set(b.dataset.themeSet); syncTheme(); });
    });

    var range = panel.querySelector("#font-scale");
    var rangeVal = panel.querySelector("#font-scale-val");
    range.value = currentScale();
    rangeVal.textContent = Math.round(currentScale() * 100) + "%";
    range.addEventListener("input", function () {
      applyFontScale(parseFloat(range.value));
      rangeVal.textContent = Math.round(range.value * 100) + "%";
    });

    panel.querySelector("#export-progress").addEventListener("click", function () {
      download("node-course-progress.json", window.Progress.export());
    });
    var fileInput = panel.querySelector("#import-file");
    panel.querySelector("#import-progress").addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      var f = fileInput.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        if (window.Progress.import(reader.result)) { syncSummary(); alert("Progress imported."); }
        else alert("That file could not be imported.");
      };
      reader.readAsText(f);
    });
    panel.querySelector("#reset-progress").addEventListener("click", function () {
      if (confirm("Reset all progress and quiz scores? This cannot be undone.")) {
        window.Progress.reset(); syncSummary();
      }
    });
  }

  function syncTheme() {
    if (!panel) return;
    var t = window.Theme.get();
    panel.querySelectorAll("[data-theme-set]").forEach(function (b) {
      b.classList.toggle("on", b.dataset.themeSet === t);
    });
  }
  function syncSummary() {
    if (!panel || !window.COURSE) return;
    var done = window.Progress.completedCount();
    var pct = Math.round((done / window.COURSE.totalLessons) * 100);
    panel.querySelector("#progress-summary").textContent =
      done + " of " + window.COURSE.totalLessons + " lessons complete (" + pct + "%).";
  }

  function open() {
    if (!panel) build();
    syncTheme(); syncSummary();
    scrim.hidden = false; panel.hidden = false;
    requestAnimationFrame(function () { panel.classList.add("open"); });
  }
  function close() {
    if (!panel) return;
    panel.classList.remove("open");
    setTimeout(function () { panel.hidden = true; scrim.hidden = true; }, 220);
  }

  // Apply saved font scale on load.
  applyFontScale(currentScale());

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("settings-btn");
    if (btn) btn.addEventListener("click", open);
  });

  window.Settings = { open: open, close: close };
})();
