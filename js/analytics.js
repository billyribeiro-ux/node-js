/* =========================================================================
   analytics.js — a personal "skills radar" + progress dashboard. Computes a
   0-100 score per tier from lessons completed (60%) and quiz accuracy (40%),
   draws an SVG radar chart, and shows accuracy / strongest+weakest areas.
   Exposes window.Analytics. Route: #/progress.
   ========================================================================= */
(function () {
  "use strict";

  function shortTier(label) {
    return ({
      "Orientation": "Orientation", "Foundations": "Foundations", "Core Node APIs": "Core APIs",
      "Building Real Things": "Building", "Engineering Quality": "Quality",
      "Advanced & Principal Engineering": "Advanced", "Distinguished Engineer (L7++)": "L7++"
    })[label] || label;
  }

  function compute() {
    var stats = window.Extras ? window.Extras.quizStatsByLesson() : {};
    var tiers = [];
    window.COURSE.modules.forEach(function (m) {
      var t = tiers.find(function (x) { return x.tier === m.tier; });
      if (!t) { t = { tier: m.tier, label: shortTier(m.tierLabel), lessons: 0, done: 0, attempts: 0, correct: 0, modules: [] }; tiers.push(t); }
      var modDone = 0, modAtt = 0, modCorr = 0;
      m.lessons.forEach(function (l) {
        t.lessons++;
        var isDone = window.Progress.isComplete(l.id);
        if (isDone) { t.done++; modDone++; }
        var s = stats[l.id];
        if (s) { t.attempts += s.attempts; t.correct += s.correct; modAtt += s.attempts; modCorr += s.correct; }
      });
      t.modules.push({ id: m.id, code: m.code, title: m.shortTitle, total: m.lessons.length, done: modDone, attempts: modAtt, correct: modCorr });
    });
    tiers.forEach(function (t) {
      t.completion = t.lessons ? t.done / t.lessons : 0;
      t.accuracy = t.attempts ? t.correct / t.attempts : null;
      // Blend: completion dominates; accuracy refines it when quizzes attempted.
      t.score = Math.round((t.accuracy == null ? t.completion : (0.6 * t.completion + 0.4 * t.accuracy)) * 100);
    });
    return tiers;
  }

  function radarSvg(tiers) {
    var n = tiers.length, cx = 260, cy = 240, R = 180;
    function pt(i, frac) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [cx + R * frac * Math.cos(a), cy + R * frac * Math.sin(a)];
    }
    var rings = [0.25, 0.5, 0.75, 1].map(function (f) {
      var pts = tiers.map(function (_, i) { return pt(i, f).join(","); }).join(" ");
      return '<polygon points="' + pts + '" fill="none" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"/>';
    }).join("");
    var axes = tiers.map(function (t, i) {
      var p = pt(i, 1), lp = pt(i, 1.16);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="currentColor" stroke-opacity="0.18"/>' +
        '<text x="' + lp[0] + '" y="' + lp[1] + '" font-size="12" fill="currentColor" text-anchor="middle" dominant-baseline="middle">' + t.label + "</text>";
    }).join("");
    var poly = tiers.map(function (t, i) { return pt(i, Math.max(0.02, t.score / 100)).join(","); }).join(" ");
    var dots = tiers.map(function (t, i) { var p = pt(i, Math.max(0.02, t.score / 100)); return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="#3fae50"/>'; }).join("");
    return '<svg viewBox="0 0 520 480" class="radar" role="img" aria-label="Skills radar by tier">' +
      rings + axes +
      '<polygon points="' + poly + '" fill="#3fae50" fill-opacity="0.18" stroke="#3fae50" stroke-width="2"/>' +
      dots + "</svg>";
  }

  function page() {
    var el = document.createElement("article");
    el.className = "lesson analytics-page";
    el.innerHTML = '<div class="lesson-breadcrumb"><a href="#/">Home</a><span class="crumb-sep">›</span><span>Progress</span></div>' +
      "<h1>📊 Your skills radar</h1><div class='analytics-body'>Crunching your progress…</div>";
    var body = el.querySelector(".analytics-body");

    window.Extras.loadAll().then(function () {
      var tiers = compute();
      var doneTotal = window.Progress.completedCount();
      var attempts = tiers.reduce(function (a, t) { return a + t.attempts; }, 0);
      var correct = tiers.reduce(function (a, t) { return a + t.correct; }, 0);
      var acc = attempts ? Math.round(correct / attempts * 100) : 0;
      var ranked = tiers.filter(function (t) { return t.lessons; }).slice().sort(function (a, b) { return b.score - a.score; });
      var strongest = ranked[0], weakest = ranked[ranked.length - 1];
      var due = window.Extras.dueQuestions().length;

      body.innerHTML =
        '<div class="analytics-top">' +
          '<div class="radar-wrap">' + radarSvg(tiers) + "</div>" +
          '<div class="stat-grid">' +
            statCard(doneTotal + " / " + window.COURSE.totalLessons, "Lessons complete") +
            statCard(acc + "%", "Quiz accuracy") +
            statCard(attempts, "Questions answered") +
            statCard(due, "Due for review") +
            statCard(strongest ? strongest.label : "—", "Strongest area") +
            statCard(weakest ? weakest.label : "—", "Focus area") +
          "</div>" +
        "</div>" +
        '<h2>By tier</h2><div class="tier-bars">' +
          tiers.map(function (t) {
            return '<div class="tier-row"><div class="tier-row-label">' + t.label + "</div>" +
              '<div class="tier-row-bar"><div class="tier-row-fill" style="width:' + t.score + '%"></div></div>' +
              '<div class="tier-row-num">' + t.score + "</div>" +
              '<div class="tier-row-meta">' + t.done + "/" + t.lessons + " lessons" +
                (t.attempts ? " · " + Math.round(t.correct / t.attempts * 100) + "% quiz" : "") + "</div></div>";
          }).join("") +
        "</div>" +
        '<div class="analytics-cta"><a class="btn btn-cta" href="#/review">Review weak spots →</a>' +
          '<a class="btn" href="#/certificate">Certificate</a></div>';
    });
    return el;
  }
  function statCard(big, label) {
    return '<div class="stat-card"><div class="stat-big">' + big + '</div><div class="stat-label">' + label + "</div></div>";
  }

  window.Analytics = { page: page };
})();
