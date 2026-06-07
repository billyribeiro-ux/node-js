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
        '<button class="btn" id="cert-png">Download PNG</button>' +
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
    el.querySelector("#cert-png").addEventListener("click", downloadPng);
    return el;
  }

  /* ---------- PNG export (pure-SVG -> canvas, no taint, no dependency) ---------- */
  function certSvg(name, dateStr, lessons, projects) {
    var W = 1200, H = 850;
    function t(x, y, s, size, weight, fill, anchor) {
      return '<text x="' + x + '" y="' + y + '" font-family="Inter, Helvetica, Arial, sans-serif" ' +
        'font-size="' + size + '" font-weight="' + (weight || 400) + '" fill="' + fill + '" ' +
        'text-anchor="' + (anchor || "middle") + '">' + s + "</text>";
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' +
      '<rect width="' + W + '" height="' + H + '" fill="#ffffff"/>' +
      '<rect x="24" y="24" width="' + (W - 48) + '" height="' + (H - 48) + '" rx="18" fill="#f6f8fa" stroke="#2f9c42" stroke-width="6"/>' +
      '<rect x="44" y="44" width="' + (W - 88) + '" height="' + (H - 88) + '" rx="10" fill="none" stroke="#d6dce2" stroke-width="2"/>' +
      t(W / 2, 175, "🟢", 64, 400, "#2f9c42") +
      t(W / 2, 250, "CERTIFICATE OF COMPLETION", 22, 700, "#828d98") +
      t(W / 2, 320, "The Ultimate Node.js Course", 52, 800, "#1a2027") +
      t(W / 2, 360, "Zero to Distinguished Principal Engineer", 24, 600, "#2f9c42") +
      t(W / 2, 450, "This certifies that", 22, 400, "#57636e") +
      t(W / 2, 520, escHtml(name || "Your Name"), 46, 700, "#1a2027") +
      '<line x1="' + (W / 2 - 260) + '" y1="540" x2="' + (W / 2 + 260) + '" y2="540" stroke="#d6dce2" stroke-width="2"/>' +
      t(W / 2, 595, "has completed all " + lessons + " lessons across 51 modules — mastering Node.js from", 20, 400, "#57636e") +
      t(W / 2, 623, "fundamentals through distributed systems, performance, and L7++ architecture.", 20, 400, "#57636e") +
      t(W / 2 - 220, 720, dateStr, 18, 600, "#828d98") +
      '<line x1="' + (W / 2 - 90) + '" y1="715" x2="' + (W / 2 + 90) + '" y2="715" stroke="#c2cad2" stroke-width="1"/>' +
      t(W / 2 + 220, 720, projects + " projects · " + lessons + " lessons", 18, 600, "#828d98") +
      "</svg>";
  }

  function downloadPng() {
    var lessons = window.COURSE.totalLessons, projects = window.COURSE.totalProjects;
    var dateStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    var svg = certSvg(getName(), dateStr, lessons, projects);
    var url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    var img = new Image();
    img.onload = function () {
      var scale = 2, c = document.createElement("canvas");
      c.width = 1200 * scale; c.height = 850 * scale;
      var ctx = c.getContext("2d"); ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, 1200, 850);
      URL.revokeObjectURL(url);
      try {
        c.toBlob(function (blob) {
          if (!blob) { alert("PNG export isn't supported here — use Print / Save as PDF instead."); return; }
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "node-course-certificate.png";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        }, "image/png");
      } catch (e) { alert("PNG export failed — use Print / Save as PDF instead."); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); alert("PNG export failed — use Print / Save as PDF instead."); };
    img.src = url;
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
