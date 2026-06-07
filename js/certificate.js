/* =========================================================================
   certificate.js — module "mastery" helpers + a printable completion
   certificate. A module is mastered when all its lessons are complete; the
   course certificate unlocks when every lesson is done. Exposes
   window.Certificate. The learner's name is saved in localStorage.
   ========================================================================= */
(function () {
  "use strict";

  var NAME_KEY = "ultimate-node-course:name";

  function moduleMastered(moduleId) {
    var mod = window.COURSE.byModule[moduleId];
    if (!mod) return false;
    return mod.lessons.every(function (l) { return window.Progress.isComplete(l.id); });
  }
  function masteredCount() {
    return window.COURSE.modules.filter(function (m) { return moduleMastered(m.id); }).length;
  }
  function courseComplete() {
    return window.Progress.completedCount() >= window.COURSE.totalLessons;
  }
  function getName() { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } }
  function setName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) {} }

  function page() {
    var done = window.Progress.completedCount();
    var total = window.COURSE.totalLessons;
    var pct = Math.round((done / total) * 100);
    var complete = courseComplete();
    var today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

    var el = document.createElement("article");
    el.className = "lesson certificate-page";
    el.innerHTML =
      '<div class="lesson-breadcrumb"><a href="#/">Home</a><span class="crumb-sep">›</span><span>Certificate</span></div>' +
      (complete
        ? '<p class="cert-status done">🎉 You\'ve completed every lesson. Your certificate is unlocked.</p>'
        : '<p class="cert-status">Complete all ' + total + " lessons to unlock your certificate. " +
          "You're at <strong>" + done + " / " + total + "</strong> (" + pct + "%).</p>") +
      '<div class="cert-namerow">' +
        '<label for="cert-name">Name on certificate:</label>' +
        '<input id="cert-name" type="text" placeholder="Your name" value="' + escAttr(getName()) + '" />' +
      "</div>" +

      '<div class="certificate" id="cert-card">' +
        '<div class="cert-inner">' +
          '<div class="cert-seal">🟢</div>' +
          '<div class="cert-kicker">Certificate of Completion</div>' +
          '<div class="cert-course">The Ultimate Node.js Course</div>' +
          '<div class="cert-sub">Zero to Distinguished Principal Engineer</div>' +
          '<div class="cert-awarded">This certifies that</div>' +
          '<div class="cert-name" id="cert-name-display">' + (escHtml(getName()) || "Your Name") + "</div>" +
          '<div class="cert-desc">has completed all ' + total + " lessons across 41 modules — mastering Node.js " +
            "from fundamentals through distributed systems, performance, and principal-level architecture.</div>" +
          '<div class="cert-foot"><span>' + today + "</span><span class='cert-line'></span><span>" +
            window.COURSE.totalProjects + " projects · " + total + " lessons</span></div>" +
        "</div>" +
      "</div>" +

      '<div class="cert-actions">' +
        '<button class="btn btn-cta" id="cert-print">Print / Save as PDF</button>' +
        (complete ? "" : '<a class="btn" href="#/' + window.COURSE.flat[0].moduleId + "/" + window.COURSE.flat[0].id + '">Keep learning →</a>') +
      "</div>";

    if (!complete) el.querySelector(".certificate").classList.add("locked");

    var nameInput = el.querySelector("#cert-name");
    var nameDisplay = el.querySelector("#cert-name-display");
    nameInput.addEventListener("input", function () {
      setName(nameInput.value);
      nameDisplay.textContent = nameInput.value || "Your Name";
    });
    el.querySelector("#cert-print").addEventListener("click", function () {
      document.body.classList.add("printing-cert");
      window.print();
      setTimeout(function () { document.body.classList.remove("printing-cert"); }, 500);
    });
    return el;
  }

  function escHtml(s) { return String(s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); }
  function escAttr(s) { return escHtml(s).replace(/"/g, "&quot;"); }

  window.Certificate = {
    page: page,
    moduleMastered: moduleMastered,
    masteredCount: masteredCount,
    courseComplete: courseComplete
  };
})();
