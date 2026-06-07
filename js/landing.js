/* =========================================================================
   landing.js — the course home: hero, live stats, and a tier-grouped grid of
   module cards each showing a progress ring. Exposes window.Landing.
   ========================================================================= */
(function () {
  "use strict";

  function ring(pct) {
    return '<span class="mc-ring" style="--pct:' + pct + '"><span>' + pct + "%</span></span>";
  }

  function moduleCard(mod) {
    var ids = mod.lessons.map(function (l) { return l.id; });
    var pct = Math.round((window.Progress ? window.Progress.ratioFor(ids) : 0) * 100);
    var first = mod.lessons[0];
    var card = document.createElement("a");
    card.className = "module-card";
    card.href = "#/" + mod.id + "/" + (first ? first.id : "");
    var done = mod.lessons.filter(function (l) { return window.Progress && window.Progress.isComplete(l.id); }).length;
    var mastered = window.Certificate && window.Certificate.moduleMastered(mod.id);
    if (mastered) card.classList.add("mastered");
    card.innerHTML =
      '<div class="mc-head"><span class="mc-num">' + mod.code + "</span>" + ring(pct) + "</div>" +
      "<h3>" + mod.shortTitle + "</h3>" +
      "<p>" + mod.summary + "</p>" +
      '<div class="mc-foot"><span>' + mod.lessons.length + " lessons</span>" +
      (mastered ? '<span class="mc-badge">✓ Mastered</span>' : "<span>" + done + " done</span>") + "</div>";
    return card;
  }

  function render() {
    var wrap = document.createElement("div");
    wrap.className = "landing";

    var last = window.Progress && window.Progress.getLastVisited();
    var resumeEntry = last && window.COURSE.flat.find(function (l) { return l.id === last; });
    var resumeHref = resumeEntry ? "#/" + resumeEntry.moduleId + "/" + resumeEntry.id : null;
    var startEntry = window.COURSE.flat[0];

    var hero = document.createElement("section");
    hero.className = "hero";
    hero.innerHTML =
      "<h1>Become a <span class='accent'>Node.js</span> Principal Engineer</h1>" +
      "<p class='tagline'>The most complete, plain-English Node.js course ever assembled — " +
      "from your very first <code>console.log</code> to architecting distributed systems at " +
      "L7+. Every concept is narrated, every example runs in your browser, and every module " +
      "ships a real project.</p>" +
      "<div class='hero-cta'>" +
      (resumeHref ? "<a class='btn btn-cta' href='" + resumeHref + "'>Resume: " +
          resumeEntry.title + " →</a>" : "") +
      "<a class='btn " + (resumeHref ? "" : "btn-cta") + "' href='#/" + startEntry.moduleId +
        "/" + startEntry.id + "'>" + (resumeHref ? "Start from the beginning" : "Start the course →") + "</a>" +
      "</div>";
    wrap.appendChild(hero);

    var stats = document.createElement("div");
    stats.className = "hero-stats";
    var doneCount = window.Progress ? window.Progress.completedCount() : 0;
    stats.innerHTML =
      stat(window.COURSE.modules.length, "Modules") +
      stat(window.COURSE.totalLessons, "Lessons") +
      stat(window.COURSE.totalProjects, "Projects") +
      stat("0 → L7+", "Skill range") +
      stat(doneCount, "You've finished");
    wrap.appendChild(stats);

    // reference + certificate band
    var mastered = window.Certificate ? window.Certificate.masteredCount() : 0;
    var ref = document.createElement("div");
    ref.className = "ref-band";
    var T = window.I18n ? function (k) { return window.I18n.t(k); } : function (k) { return k; };
    function card(href, icon, title, sub) {
      return '<a class="ref-card" href="' + href + '"><span class="ref-icon">' + icon + "</span><div><strong>" +
        title + "</strong><span>" + sub + "</span></div></a>";
    }
    ref.innerHTML =
      card("#/review", "🔁", T("ref_review"), T("ref_review_sub")) +
      card("#/progress", "📊", T("ref_radar"), T("ref_radar_sub")) +
      card("#/guide", "🗂️", T("ref_guides"), T("ref_guides_sub")) +
      card("#/glossary", "📖", T("ref_glossary"), T("ref_glossary_sub")) +
      card("#/cheatsheets", "⚡", T("ref_cheats"), T("ref_cheats_sub")) +
      card("#/certificate", "🏆", T("ref_cert"), mastered + " / " + window.COURSE.modules.length + " modules mastered");
    wrap.appendChild(ref);

    // group modules by tier
    var tiers = [];
    window.COURSE.modules.forEach(function (m) {
      var t = tiers.find(function (x) { return x.tier === m.tier; });
      if (!t) { t = { tier: m.tier, label: m.tierLabel, mods: [] }; tiers.push(t); }
      t.mods.push(m);
    });

    tiers.forEach(function (t) {
      var band = document.createElement("div");
      band.className = "tier-band";
      band.innerHTML = "<span class='tier-tag'>" + t.tier + "</span><h2>" + t.label +
        "</h2><span class='tier-line'></span>";
      wrap.appendChild(band);
      var grid = document.createElement("div");
      grid.className = "module-grid";
      t.mods.forEach(function (m) { grid.appendChild(moduleCard(m)); });
      wrap.appendChild(grid);
    });

    return wrap;
  }

  function stat(num, lbl) {
    return "<div class='hero-stat'><span class='num'>" + num + "</span>" +
      "<span class='lbl'>" + lbl + "</span></div>";
  }

  window.Landing = { render: render };
})();
