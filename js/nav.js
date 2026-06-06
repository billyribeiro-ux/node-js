/* =========================================================================
   nav.js — builds the Next/Prev footer for a lesson and the "mark complete &
   continue" button. All ordering comes from the flattened lesson list on
   window.COURSE, so neighbours are never hard-coded. Exposes window.Nav.
   ========================================================================= */
(function () {
  "use strict";

  function lessonHref(entry) { return "#/" + entry.moduleId + "/" + entry.id; }

  /** Returns an HTML string for the Next/Prev bar + complete button. */
  function render(lessonId) {
    var flat = window.COURSE.flat;
    var idx = flat.findIndex(function (l) { return l.id === lessonId; });
    if (idx === -1) return "";
    var prev = flat[idx - 1];
    var next = flat[idx + 1];
    var done = window.Progress && window.Progress.isComplete(lessonId);

    var html = '<div class="complete-bar">' +
      '<button class="btn btn-complete' + (done ? " done" : "") + '" data-complete="' + lessonId + '">' +
      (done ? "✓ Completed — click to unmark" : "Mark complete & continue →") +
      "</button></div>";

    html += '<nav class="lesson-nav" aria-label="Lesson navigation">';
    if (prev) {
      html += '<a class="nav-card prev" href="' + lessonHref(prev) + '">' +
        '<span class="nav-dir">← Previous</span>' +
        '<span class="nav-title">' + prev.title + "</span></a>";
    } else {
      html += '<a class="nav-card prev disabled" aria-disabled="true">' +
        '<span class="nav-dir">← Previous</span><span class="nav-title">You\'re at the start</span></a>';
    }
    if (next) {
      html += '<a class="nav-card next" href="' + lessonHref(next) + '">' +
        '<span class="nav-dir">Next →</span>' +
        '<span class="nav-title">' + next.title + "</span></a>";
    } else {
      html += '<a class="nav-card next disabled" aria-disabled="true">' +
        '<span class="nav-dir">Next →</span><span class="nav-title">🎉 End of course</span></a>';
    }
    html += "</nav>";
    return html;
  }

  /** Wire the complete button + keyboard shortcuts after a lesson renders. */
  function wire(lessonId, container) {
    var btn = container.querySelector("[data-complete]");
    if (btn) {
      btn.addEventListener("click", function () {
        var nowDone = window.Progress.toggle(lessonId);
        if (nowDone) {
          var next = neighbour(lessonId, +1);
          if (next) { location.hash = "#/" + next.moduleId + "/" + next.id; return; }
        }
        // re-render just the nav region
        var navHost = container.querySelector(".lesson-nav-host");
        if (navHost) { navHost.innerHTML = render(lessonId); wire(lessonId, container); }
      });
    }
  }

  function neighbour(lessonId, dir) {
    var flat = window.COURSE.flat;
    var idx = flat.findIndex(function (l) { return l.id === lessonId; });
    return idx === -1 ? null : flat[idx + dir] || null;
  }

  // Global keyboard shortcuts: ← / → move lessons, m toggles sidebar, t theme.
  document.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.target && e.target.closest && e.target.closest(".monaco-editor")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var cur = window.Router && window.Router.currentLesson();
    if (!cur) return;
    if (e.key === "ArrowRight") {
      var n = neighbour(cur, +1); if (n) location.hash = "#/" + n.moduleId + "/" + n.id;
    } else if (e.key === "ArrowLeft") {
      var p = neighbour(cur, -1); if (p) location.hash = "#/" + p.moduleId + "/" + p.id;
    } else if (e.key === "t") { window.Theme && window.Theme.toggle(); }
    else if (e.key === "m") { document.body.classList.toggle("sidebar-open"); }
  });

  window.Nav = { render: render, wire: wire, neighbour: neighbour };
})();
