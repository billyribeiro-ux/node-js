/* =========================================================================
   sidebar.js — renders the collapsible module/lesson tree and keeps it in sync
   with the current route and the learner's progress. Exposes window.Sidebar.
   ========================================================================= */
(function () {
  "use strict";

  var COLLAPSE_KEY = "ultimate-node-course:collapsed";
  var collapsed = {};
  try { collapsed = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}"); } catch (e) {}

  function saveCollapsed() {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)); } catch (e) {}
  }

  var CHECK = '<svg class="toc-check" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
  var CARET = '<svg class="toc-module-caret" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>';

  function build() {
    var toc = document.getElementById("toc");
    if (!toc || !window.COURSE) return;
    toc.innerHTML = "";

    window.COURSE.modules.forEach(function (mod) {
      var wrap = document.createElement("div");
      wrap.className = "toc-module" + (collapsed[mod.id] ? " collapsed" : "");
      wrap.dataset.module = mod.id;

      var header = document.createElement("button");
      header.className = "toc-module-header";
      header.innerHTML = CARET + "<span>" + mod.title + "</span>" +
        (mod.tier ? '<span class="toc-module-tier">' + mod.tier + "</span>" : "");
      header.addEventListener("click", function () {
        wrap.classList.toggle("collapsed");
        collapsed[mod.id] = wrap.classList.contains("collapsed");
        saveCollapsed();
      });
      wrap.appendChild(header);

      var ul = document.createElement("ul");
      ul.className = "toc-lessons";
      mod.lessons.forEach(function (lesson) {
        var li = document.createElement("li");
        li.className = "toc-lesson";
        li.dataset.lesson = lesson.id;
        var a = document.createElement("a");
        a.href = "#/" + mod.id + "/" + lesson.id;
        a.innerHTML = CHECK + "<span>" + lesson.title + "</span>" +
          (lesson.status === "stub" ? '<span class="toc-stub-tag">soon</span>' : "");
        li.appendChild(a);
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      toc.appendChild(wrap);
    });

    refreshProgress();
  }

  function setActive(lessonId, moduleId) {
    var toc = document.getElementById("toc");
    if (!toc) return;
    toc.querySelectorAll(".toc-lesson.active").forEach(function (el) { el.classList.remove("active"); });
    var li = toc.querySelector('.toc-lesson[data-lesson="' + lessonId + '"]');
    if (li) {
      li.classList.add("active");
      // auto-expand the active module
      var mod = toc.querySelector('.toc-module[data-module="' + moduleId + '"]');
      if (mod && mod.classList.contains("collapsed")) {
        mod.classList.remove("collapsed");
        collapsed[moduleId] = false; saveCollapsed();
      }
      if (li.scrollIntoView) li.scrollIntoView({ block: "nearest" });
    }
  }

  function refreshProgress() {
    var toc = document.getElementById("toc");
    if (!toc || !window.Progress) return;
    toc.querySelectorAll(".toc-lesson").forEach(function (li) {
      li.classList.toggle("done", window.Progress.isComplete(li.dataset.lesson));
    });
    var stats = document.getElementById("sidebar-stats");
    if (stats && window.COURSE) {
      stats.textContent = window.Progress.completedCount() + " / " + window.COURSE.totalLessons + " done";
    }
  }

  if (window.Progress) window.Progress.onChange(refreshProgress);

  window.Sidebar = { build: build, setActive: setActive, refreshProgress: refreshProgress };
})();
