/* =========================================================================
   router.js — hash-based router (works under file://), lazy-loads lesson
   content by injecting a classic <script>, renders landing/lesson/stub pages,
   and upgrades fenced code blocks into Monaco editors. Exposes window.Router.

   Lesson scripts call registerLesson(id, markdown); we resolve the pending
   load when that fires. No fetch(), no modules — file:// safe.
   ========================================================================= */
(function () {
  "use strict";

  var registry = {};      // lessonId -> markdown string
  var pending = {};       // lessonId -> { resolve, reject }
  var loadedScripts = {}; // file -> true
  var current = null;     // current lesson id

  // Global hook lesson files call.
  window.registerLesson = function (id, markdown) {
    registry[id] = markdown;
    if (pending[id]) { pending[id].resolve(markdown); delete pending[id]; }
  };

  function loadLesson(entry) {
    if (registry[entry.id]) return Promise.resolve(registry[entry.id]);
    return new Promise(function (resolve, reject) {
      pending[entry.id] = { resolve: resolve, reject: reject };
      if (loadedScripts[entry.file]) return; // script loaded but maybe wrong id
      var s = document.createElement("script");
      s.src = entry.file;
      s.onload = function () {
        loadedScripts[entry.file] = true;
        if (registry[entry.id]) { resolve(registry[entry.id]); delete pending[entry.id]; }
      };
      s.onerror = function () {
        reject(new Error("Could not load lesson file: " + entry.file));
        delete pending[entry.id];
      };
      document.head.appendChild(s);
    });
  }

  function setContent(node) {
    var content = document.getElementById("content");
    if (window.MonacoKit) window.MonacoKit.disposeAll();
    content.innerHTML = "";
    if (typeof node === "string") content.innerHTML = node;
    else content.appendChild(node);
    content.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* ---------- upgrade code blocks to Monaco ---------- */
  function upgradeEditors(container, blocks) {
    if (!window.MonacoKit) return;
    blocks.forEach(function (b) {
      var placeholder = container.querySelector('.editor-placeholder[data-block="' + b.index + '"]');
      if (!placeholder) return;

      var card = document.createElement("div");
      card.className = "editor-card";

      var toolbar = document.createElement("div");
      toolbar.className = "editor-toolbar";
      toolbar.innerHTML = '<span class="editor-lang">' + b.lang + "</span>" +
        (b.mode === "readonly" ? '<span class="editor-readonly-tag">walkthrough</span>' : "");
      var spacer = document.createElement("span");
      spacer.className = "spacer";
      toolbar.appendChild(spacer);

      var host = document.createElement("div");
      host.className = "editor-host";

      var output = document.createElement("div");
      output.className = "editor-output";

      var runnable = (b.mode === "run");

      if (runnable) {
        var runBtn = mkBtn("▶ Run", "btn btn-run");
        var resetBtn = mkBtn("Reset", "btn btn-ghost");
        var copyBtn = mkBtn("Copy", "btn btn-ghost");
        toolbar.appendChild(runBtn);
        toolbar.appendChild(resetBtn);
        toolbar.appendChild(copyBtn);
        card.appendChild(toolbar);
        card.appendChild(host);
        card.appendChild(output);
        placeholder.replaceWith(card);
        window.MonacoKit.create(host, { code: b.code, language: jsLang(b.lang), readOnly: false })
          .then(function (editor) {
            runBtn.addEventListener("click", function () { window.Runner.run(editor.getValue(), output); });
            resetBtn.addEventListener("click", function () { editor.setValue(b.code); output.innerHTML = ""; });
            copyBtn.addEventListener("click", function () {
              navigator.clipboard && navigator.clipboard.writeText(editor.getValue());
              copyBtn.textContent = "Copied!"; setTimeout(function () { copyBtn.textContent = "Copy"; }, 1200);
            });
          });
      } else {
        var copyBtn2 = mkBtn("Copy", "btn btn-ghost");
        toolbar.appendChild(copyBtn2);
        card.appendChild(toolbar);
        card.appendChild(host);
        placeholder.replaceWith(card);
        window.MonacoKit.create(host, { code: b.code, language: jsLang(b.lang), readOnly: (b.mode === "readonly") })
          .then(function (editor) {
            copyBtn2.addEventListener("click", function () {
              navigator.clipboard && navigator.clipboard.writeText(editor.getValue());
              copyBtn2.textContent = "Copied!"; setTimeout(function () { copyBtn2.textContent = "Copy"; }, 1200);
            });
          });
      }
    });
  }
  function mkBtn(label, cls) { var b = document.createElement("button"); b.className = cls; b.textContent = label; return b; }
  function jsLang(lang) {
    if (lang === "ts" || lang === "typescript") return "typescript";
    if (lang === "js" || lang === "javascript") return "javascript";
    if (lang === "json") return "json";
    if (lang === "bash" || lang === "sh" || lang === "shell") return "shell";
    if (lang === "html") return "html";
    if (lang === "css") return "css";
    return lang || "plaintext";
  }

  /* ---------- render a full lesson ---------- */
  function renderLesson(entry, markdown) {
    var parsed = window.MD.render(markdown);
    var f = parsed.front;
    var mod = window.COURSE.byModule[entry.moduleId];

    var article = document.createElement("article");
    article.className = "lesson";

    var head = '<div class="lesson-breadcrumb">' +
      '<a href="#/">Home</a><span class="crumb-sep">›</span>' +
      '<span>' + mod.title + "</span>" +
      '<span class="crumb-sep">›</span><span>Lesson ' + (entry.indexInModule + 1) +
      " of " + mod.lessons.length + "</span></div>";

    var level = (f.level || entry.level || "beginner");
    var meta = '<div class="lesson-meta">' +
      '<span class="pill level-' + level + '">' + level + "</span>" +
      (f.minutes ? '<span class="pill">⏱ ' + f.minutes + " min</span>" : "") +
      '<span class="pill">' + mod.tier + "</span></div>";

    article.innerHTML = head + meta + parsed.html +
      '<div class="lesson-nav-host"></div>';

    // objectives front-matter -> checklist near the top isn't auto-injected;
    // lessons author their own "Learning objectives" section for control.

    // append nav
    var navHost = article.querySelector(".lesson-nav-host");
    navHost.innerHTML = window.Nav.render(entry.id);

    setContent(article);
    upgradeEditors(article, parsed.blocks);
    window.Nav.wire(entry.id, article);
    document.title = entry.title + " — Ultimate Node.js Course";
  }

  /* ---------- render a not-yet-written (stub) lesson ---------- */
  function renderStub(entry) {
    var mod = window.COURSE.byModule[entry.moduleId];
    var md = "# " + entry.title + "\n\n" +
      "> [!NOTE] Coming soon\n> This lesson is part of the published curriculum and is " +
      "scaffolded next. The full narrated walkthrough, runnable editors, exercises and " +
      "project are being authored. Here is what it will cover.\n\n";
    if (entry.summary) md += entry.summary + "\n\n";
    if (entry.objectives && entry.objectives.length) {
      md += "## What you'll learn\n\n" + entry.objectives.map(function (o) { return "- " + o; }).join("\n") + "\n\n";
    }
    if (entry.project) {
      md += "## Project for this lesson\n\n> [!PRINCIPAL] " + entry.project + "\n\n";
    }
    md += "## Keep going\n\nThe foundations (Modules 0–4) are fully written — work through " +
      "those to build the mental model everything else rests on.\n";

    var parsed = window.MD.render(md);
    var article = document.createElement("article");
    article.className = "lesson";
    var head = '<div class="lesson-breadcrumb"><a href="#/">Home</a>' +
      '<span class="crumb-sep">›</span><span>' + mod.title + "</span></div>";
    article.innerHTML = head + parsed.html + '<div class="lesson-nav-host"></div>';
    article.querySelector(".lesson-nav-host").innerHTML = window.Nav.render(entry.id);
    setContent(article);
    window.Nav.wire(entry.id, article);
    document.title = entry.title + " — Ultimate Node.js Course";
  }

  /* ---------- landing page ---------- */
  function renderLanding() {
    if (window.Landing) { setContent(window.Landing.render()); document.title = window.COURSE.title; }
    current = null;
  }

  /* ---------- route handling ---------- */
  function handle() {
    var hash = location.hash.replace(/^#/, "");
    if (!hash || hash === "/" ) { renderLanding(); return; }
    var parts = hash.split("/").filter(Boolean); // [moduleId, lessonId]
    var entry = window.COURSE.flat.find(function (l) {
      return l.moduleId === parts[0] && l.id === parts[1];
    });
    if (!entry) {
      // maybe just a module id -> jump to its first lesson
      var mod = window.COURSE.byModule[parts[0]];
      if (mod && mod.lessons[0]) { location.hash = "#/" + mod.id + "/" + mod.lessons[0].id; return; }
      renderLanding(); return;
    }

    current = entry.id;
    window.Sidebar.setActive(entry.id, entry.moduleId);
    window.Progress && window.Progress.setLastVisited(entry.id);
    document.body.classList.remove("sidebar-open");

    if (entry.status === "stub") { renderStub(entry); return; }

    setContent('<div class="loading-splash">Loading lesson…</div>');
    loadLesson(entry).then(function (md) { renderLesson(entry, md); })
      .catch(function (err) {
        setContent('<article class="lesson"><h1>Could not load this lesson</h1><p>' +
          window.MD.escapeHtml(err.message) + "</p><p><a href='#/'>Back home</a></p></article>");
      });
  }

  window.Router = {
    start: function () {
      window.addEventListener("hashchange", handle);
      handle();
    },
    refresh: function () { handle(); },
    currentLesson: function () { return current; }
  };
})();
