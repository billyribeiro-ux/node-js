/* =========================================================================
   search.js — a Cmd/Ctrl+K command palette with fuzzy search over every
   lesson (title, module, tier). Keyboard-first: arrows to move, Enter to go,
   Esc to close. Also opened by the header search button or pressing "/".
   Exposes window.Palette.
   ========================================================================= */
(function () {
  "use strict";

  var overlay, input, list, items = [], active = 0, filtered = [];

  function buildIndex() {
    if (!window.COURSE) return [];
    var idx = window.COURSE.flat.map(function (l) {
      var mod = window.COURSE.byModule[l.moduleId];
      return { title: l.title, subtitle: mod.title, kind: "lesson",
               hash: "#/" + l.moduleId + "/" + l.id };
    });
    // Appendix pages.
    idx.push({ title: "Review (spaced repetition)", subtitle: "Practice", kind: "page", hash: "#/review" });
    idx.push({ title: "Progress — skills radar", subtitle: "Dashboard", kind: "page", hash: "#/progress" });
    idx.push({ title: "Study guides (printable)", subtitle: "Reference", kind: "page", hash: "#/guide" });
    idx.push({ title: "Glossary", subtitle: "Reference", kind: "page", hash: "#/glossary" });
    idx.push({ title: "API Cheat-sheets", subtitle: "Reference", kind: "page", hash: "#/cheatsheets" });
    idx.push({ title: "Completion Certificate", subtitle: "Your progress", kind: "page", hash: "#/certificate" });
    // Glossary terms + cheat-sheets (present once Reference data is loaded).
    if (window.Reference) {
      window.Reference.glossaryTerms().forEach(function (t) {
        idx.push({ title: t.term, subtitle: "Glossary · " + (t.def || "").slice(0, 60), kind: "term",
                   hash: t.lesson ? "#/" + lessonHash(t.lesson) : "#/glossary" });
      });
      window.Reference.cheatsheets().forEach(function (c) {
        idx.push({ title: c.title, subtitle: "Cheat-sheet", kind: "sheet", hash: "#/cheatsheets/" + c.id });
      });
    }
    return idx;
  }
  function lessonHash(id) {
    var l = window.COURSE.flat.find(function (x) { return x.id === id; });
    return l ? l.moduleId + "/" + l.id : "glossary";
  }

  // Lightweight fuzzy: every query char must appear in order; score rewards
  // contiguous runs, word-start matches, and earlier positions.
  function fuzzy(query, text) {
    query = query.toLowerCase();
    if (!query) return { score: 1, hits: [] };
    var lower = text.toLowerCase();        // compare case-insensitively…
    var qi = 0, score = 0, run = 0, hits = [], prevWasSep = true;
    for (var i = 0; i < lower.length && qi < query.length; i++) {
      var c = lower[i];                    // …but hit indices still map to original text
      if (c === query[qi]) {
        hits.push(i);
        run++;
        score += run * 2;
        if (prevWasSep) score += 8;        // word-start bonus
        if (i < 12) score += 2;            // early bonus
        qi++;
      } else {
        run = 0;
      }
      prevWasSep = (c === " " || c === "-" || c === ":" || c === "&");
    }
    return qi === query.length ? { score: score, hits: hits } : null;
  }

  function render() {
    list.innerHTML = "";
    if (!filtered.length) {
      list.innerHTML = '<li class="palette-empty">No lessons match. Try another term.</li>';
      return;
    }
    filtered.slice(0, 50).forEach(function (entry, idx) {
      var li = document.createElement("li");
      li.className = "palette-item" + (idx === active ? " active" : "");
      li.innerHTML =
        '<span class="palette-kind palette-kind-' + entry.kind + '">' + entry.kind + "</span>" +
        '<span class="palette-text"><span class="palette-title">' + highlight(entry.title, entry._hits) + "</span>" +
        '<span class="palette-meta">' + escapeHtml(entry.subtitle || "") + "</span></span>";
      li.addEventListener("click", function () { go(entry); });
      li.addEventListener("mousemove", function () { setActive(idx); });
      list.appendChild(li);
    });
  }

  function highlight(text, hits) {
    if (!hits || !hits.length) return escapeHtml(text);
    var out = "", set = {};
    hits.forEach(function (h) { set[h] = true; });
    for (var i = 0; i < text.length; i++) {
      var ch = escapeHtml(text[i]);
      out += set[i] ? "<mark>" + ch + "</mark>" : ch;
    }
    return out;
  }
  function escapeHtml(s) { return s.replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); }

  function update() {
    var q = input.value.trim();
    var scored = [];
    items.forEach(function (it) {
      var m = fuzzy(q, it.title) || fuzzy(q, it.subtitle || "");
      if (q === "") { scored.push({ entry: it, score: 0, hits: [] }); }
      else if (m) { scored.push({ entry: it, score: m.score, hits: m.hits }); }
    });
    if (q !== "") scored.sort(function (a, b) { return b.score - a.score; });
    filtered = scored.map(function (s) { var e = s.entry; e._hits = s.hits; return e; });
    active = 0;
    render();
  }

  function setActive(i) {
    active = Math.max(0, Math.min(i, filtered.length - 1));
    Array.prototype.forEach.call(list.children, function (el, idx) {
      el.classList.toggle("active", idx === active);
    });
    var el = list.children[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }

  function go(entry) { close(); location.hash = entry.hash; }

  function open() {
    if (!overlay) build();
    items = buildIndex();
    overlay.hidden = false;
    document.body.classList.add("palette-open");
    input.value = "";
    update();
    setTimeout(function () { input.focus(); }, 0);
    // Pull in glossary + cheat-sheet entries, then refresh the index.
    if (window.Reference) {
      window.Reference.load().then(function () { items = buildIndex(); update(); });
    }
  }
  function close() {
    if (overlay) { overlay.hidden = true; document.body.classList.remove("palette-open"); }
  }
  function isOpen() { return overlay && !overlay.hidden; }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "palette-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="palette" role="dialog" aria-label="Search lessons">' +
        '<div class="palette-search">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.49 4.49 0 0 1 9.5 14z"/></svg>' +
          '<input type="text" class="palette-input" placeholder="Search 136 lessons…  (type to filter)" aria-label="Search lessons" />' +
          '<kbd class="palette-esc">esc</kbd>' +
        "</div>" +
        '<ul class="palette-list" role="listbox"></ul>' +
        '<div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>' +
      "</div>";
    document.body.appendChild(overlay);
    input = overlay.querySelector(".palette-input");
    list = overlay.querySelector(".palette-list");

    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    input.addEventListener("input", update);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) go(filtered[active]); }
      else if (e.key === "Escape") { close(); }
    });
  }

  // Global shortcuts.
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); isOpen() ? close() : open(); return; }
    if (e.key === "/" && !isOpen()) {
      var t = e.target;
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || (t.closest && t.closest(".monaco-editor")))) return;
      e.preventDefault(); open();
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("search-btn");
    if (btn) btn.addEventListener("click", open);
  });

  window.Palette = { open: open, close: close };
})();
