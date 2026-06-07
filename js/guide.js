/* =========================================================================
   guide.js — printable per-tier study guides. For a tier, it loads every
   lesson, pulls out the title, objectives and "What you learned" takeaways,
   and renders a clean, condensed, printable revision sheet.
   Exposes window.Guide. Routes: #/guide  and  #/guide/<tierIndex>.
   ========================================================================= */
(function () {
  "use strict";

  function tiers() {
    var seen = {}, out = [];
    window.COURSE.modules.forEach(function (m) {
      if (!seen[m.tier]) { seen[m.tier] = true; out.push({ tier: m.tier, label: m.tierLabel }); }
    });
    return out;
  }

  function takeaways(md) {
    var m = /##\s+What you learned\s*\n([\s\S]*?)(\n##\s|$)/.exec(md);
    if (!m) return [];
    return m[1].split("\n")
      .filter(function (l) { return /^\s*[-*]\s+/.test(l); })
      .map(function (l) { return l.replace(/^\s*[-*]\s+/, "").trim(); });
  }
  function objectives(md) {
    var f = window.MD.render(md).front;
    return (f && f.objectives) || [];
  }

  /* ---- index of all tier guides ---- */
  function indexPage() {
    var el = document.createElement("article");
    el.className = "lesson guide-index";
    var cards = tiers().map(function (t, i) {
      var mods = window.COURSE.modules.filter(function (m) { return m.tier === t.tier; });
      var lessons = mods.reduce(function (a, m) { return a + m.lessons.length; }, 0);
      return '<a class="guide-card" href="#/guide/' + i + '"><span class="guide-tier">' + t.tier + "</span>" +
        "<strong>" + t.label + "</strong><span>" + mods.length + " modules · " + lessons + " lessons</span></a>";
    }).join("");
    el.innerHTML = '<div class="lesson-breadcrumb"><a href="#/">Home</a><span class="crumb-sep">›</span><span>Study guides</span></div>' +
      "<h1>🗂️ Printable study guides</h1><p>Condensed revision sheets — every lesson's objectives and key " +
      "takeaways for a tier, on one printable page.</p><div class='guide-grid'>" + cards + "</div>";
    return el;
  }

  /* ---- one tier's printable guide ---- */
  function tierPage(index) {
    var t = tiers()[index];
    var el = document.createElement("article");
    el.className = "lesson guide-page";
    if (!t) { el.innerHTML = "<h1>Guide not found</h1><p><a href='#/guide'>All study guides</a></p>"; return el; }

    el.innerHTML = '<div class="lesson-breadcrumb"><a href="#/">Home</a><span class="crumb-sep">›</span>' +
      '<a href="#/guide">Study guides</a><span class="crumb-sep">›</span><span>' + t.label + "</span></div>" +
      '<div class="guide-head"><h1>' + t.label + " — Study Guide</h1>" +
      '<button class="btn" id="guide-print">Print this guide</button></div>' +
      '<div class="guide-body">Building your study guide…</div>';

    var body = el.querySelector(".guide-body");
    el.querySelector("#guide-print").addEventListener("click", function () {
      document.body.classList.add("printing-guide"); window.print();
      setTimeout(function () { document.body.classList.remove("printing-guide"); }, 500);
    });

    var mods = window.COURSE.modules.filter(function (m) { return m.tier === t.tier; });
    var lessons = [];
    mods.forEach(function (m) { m.lessons.forEach(function (l) { lessons.push(l); }); });

    Promise.all(lessons.map(function (l) {
      return window.Router.fetchMarkdown(l).then(function (md) {
        var pts = takeaways(md);
        if (!pts.length) pts = objectives(md); // fall back to objectives
        return { lesson: l, points: pts };
      }).catch(function () { return { lesson: l, points: [] }; });
    })).then(function (results) {
      var html = mods.map(function (m) {
        var items = results.filter(function (r) { return r.lesson.moduleId === m.id; }).map(function (r) {
          return '<div class="guide-lesson"><h3><a href="#/' + r.lesson.moduleId + "/" + r.lesson.id + '">' +
            r.lesson.title + "</a></h3><ul>" +
            r.points.map(function (p) { return "<li>" + window.MD.inline(p) + "</li>"; }).join("") + "</ul></div>";
        }).join("");
        return '<section class="guide-module"><h2>' + m.title + "</h2>" + items + "</section>";
      }).join("");
      body.innerHTML = html;
    });
    return el;
  }

  window.Guide = { indexPage: indexPage, tierPage: tierPage };
})();
