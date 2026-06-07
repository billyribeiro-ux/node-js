/* =========================================================================
   reference.js — the Glossary and API Cheat-sheets appendices. Data lives in
   content/reference/{glossary,cheatsheets}.js (lazy-loaded), which call
   registerGlossary([...]) and registerCheatsheet({...}). Both pages have a
   live filter box. Exposes window.Reference.
   ========================================================================= */
(function () {
  "use strict";

  var GLOSSARY = [];
  var CHEATS = [];
  var loaded = false, pending = null;

  window.registerGlossary = function (entries) { GLOSSARY = GLOSSARY.concat(entries || []); };
  window.registerCheatsheet = function (sheet) { CHEATS.push(sheet); };

  function load() {
    if (loaded) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.all(["content/reference/glossary.js", "content/reference/cheatsheets.js"].map(function (src) {
      return new Promise(function (resolve) {
        var s = document.createElement("script");
        s.src = src;
        s.onload = function () { resolve(); };
        s.onerror = function () { resolve(); };
        document.head.appendChild(s);
      });
    })).then(function () { loaded = true; });
    return pending;
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); }
  function lessonLink(id) {
    if (!id || !window.COURSE) return "";
    var l = window.COURSE.flat.find(function (x) { return x.id === id; });
    if (!l) return "";
    return ' <a class="ref-lesson" href="#/' + l.moduleId + "/" + l.id + '">' + esc(l.title) + " →</a>";
  }

  /* ---------- Glossary ---------- */
  function glossaryPage() {
    var page = document.createElement("article");
    page.className = "lesson reference-page";
    page.innerHTML = '<div class="lesson-breadcrumb"><a href="#/">Home</a><span class="crumb-sep">›</span><span>Glossary</span></div>' +
      "<h1>📖 Glossary</h1><p>Every key term in the course, defined in plain English. Type to filter.</p>" +
      '<input class="ref-filter" type="text" placeholder="Filter terms…" aria-label="Filter glossary" />' +
      '<div class="glossary-list">Loading…</div>';
    load().then(function () {
      var listEl = page.querySelector(".glossary-list");
      var terms = GLOSSARY.slice().sort(function (a, b) { return a.term.toLowerCase() < b.term.toLowerCase() ? -1 : 1; });
      function draw(q) {
        q = (q || "").toLowerCase();
        var shown = terms.filter(function (t) {
          return !q || t.term.toLowerCase().indexOf(q) !== -1 || (t.def || "").toLowerCase().indexOf(q) !== -1;
        });
        if (!shown.length) { listEl.innerHTML = '<p class="ref-empty">No terms match.</p>'; return; }
        listEl.innerHTML = shown.map(function (t) {
          return '<div class="glossary-item"><dt>' + esc(t.term) + "</dt><dd>" + esc(t.def) + lessonLink(t.lesson) + "</dd></div>";
        }).join("");
      }
      draw("");
      var filter = page.querySelector(".ref-filter");
      filter.addEventListener("input", function () { draw(filter.value); });
      var count = page.querySelector("p");
      count.textContent = terms.length + " terms, defined in plain English. Type to filter.";
    });
    return page;
  }

  /* ---------- Cheat-sheets ---------- */
  function cheatsheetPage(id) {
    var page = document.createElement("article");
    page.className = "lesson reference-page";
    page.innerHTML = '<div class="lesson-breadcrumb"><a href="#/">Home</a><span class="crumb-sep">›</span>' +
      '<a href="#/cheatsheets">Cheat-sheets</a>' + (id ? '<span class="crumb-sep">›</span><span>' + esc(id) + "</span>" : "") +
      "</div><div class='cheats-body'>Loading…</div>";
    load().then(function () {
      var body = page.querySelector(".cheats-body");
      if (id) {
        var sheet = CHEATS.find(function (c) { return c.id === id; });
        if (!sheet) { body.innerHTML = "<h1>Not found</h1><p><a href='#/cheatsheets'>All cheat-sheets</a></p>"; return; }
        body.innerHTML = "<h1>" + esc(sheet.title) + "</h1>" +
          (sheet.blurb ? "<p>" + esc(sheet.blurb) + "</p>" : "") +
          lessonLinkBlock(sheet.lesson) +
          sheet.groups.map(function (g) {
            return "<h3>" + esc(g.name) + "</h3><table class='cheat-table'><tbody>" +
              g.items.map(function (it) {
                return "<tr><td><code>" + esc(it.sig) + "</code></td><td>" + esc(it.desc) + "</td></tr>";
              }).join("") + "</tbody></table>";
          }).join("");
      } else {
        body.innerHTML = "<h1>⚡ API Cheat-sheets</h1><p>Quick reference for the core Node.js modules.</p>" +
          '<input class="ref-filter" type="text" placeholder="Filter modules…" aria-label="Filter cheat-sheets" />' +
          '<div class="cheats-grid"></div>';
        var grid = body.querySelector(".cheats-grid");
        function draw(q) {
          q = (q || "").toLowerCase();
          grid.innerHTML = CHEATS.filter(function (c) {
            return !q || c.title.toLowerCase().indexOf(q) !== -1 || c.id.toLowerCase().indexOf(q) !== -1;
          }).map(function (c) {
            var n = c.groups.reduce(function (a, g) { return a + g.items.length; }, 0);
            return '<a class="cheat-card" href="#/cheatsheets/' + c.id + '"><h3>' + esc(c.title) + "</h3>" +
              "<p>" + esc(c.blurb || "") + "</p><span class='cheat-count'>" + n + " APIs</span></a>";
          }).join("");
        }
        draw("");
        var filter = body.querySelector(".ref-filter");
        filter.addEventListener("input", function () { draw(filter.value); });
      }
    });
    return page;
  }
  function lessonLinkBlock(id) {
    var lk = lessonLink(id);
    return lk ? '<p class="cheat-lessonlink">Learn it in:' + lk + "</p>" : "";
  }

  window.Reference = {
    load: load,
    glossaryPage: glossaryPage,
    cheatsheetPage: cheatsheetPage,
    glossaryTerms: function () { return GLOSSARY; },
    cheatsheets: function () { return CHEATS; }
  };
})();
