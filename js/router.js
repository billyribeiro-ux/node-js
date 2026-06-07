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

  // Alternative hook: lesson content lives inside a function's block comment, so
  // authors can write real backticks and ${...} with NO escaping. The only rule
  // is the content must not contain the literal sequence that closes a block
  // comment. We extract everything between the first /* and the last */.
  window.registerLessonSrc = function (id, fn) {
    var src = String(fn);
    var start = src.indexOf("/*");
    var end = src.lastIndexOf("*/");
    var body = (start !== -1 && end > start) ? src.slice(start + 2, end) : "";
    body = body.replace(/^\r?\n/, ""); // drop the first newline so front-matter is at col 0
    window.registerLesson(id, body);
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

  var teardown = null; // cleans up per-lesson listeners / floating UI

  function setContent(node) {
    var content = document.getElementById("content");
    if (teardown) { try { teardown(); } catch (e) {} teardown = null; }
    if (window.MonacoKit) window.MonacoKit.disposeAll();
    content.innerHTML = "";
    if (typeof node === "string") content.innerHTML = node;
    else content.appendChild(node);
    content.scrollTop = 0;
    window.scrollTo(0, 0);
    setReadingProgress(0);
  }

  function setReadingProgress(pct) {
    var fill = document.getElementById("reading-progress-fill");
    if (fill) fill.style.width = pct + "%";
  }

  /* ---------- inject concept diagrams ---------- */
  function injectDiagrams(container) {
    if (!window.DIAGRAMS) return;
    container.querySelectorAll(".diagram[data-diagram]").forEach(function (fig) {
      var d = window.DIAGRAMS[fig.dataset.diagram];
      if (!d) { fig.remove(); return; }
      fig.innerHTML = d.svg + (d.title ? '<figcaption>' + d.title + "</figcaption>" : "");
    });
  }

  /* ---------- mini "on this page" TOC + scroll-spy + reading progress ---------- */
  function setupLessonChrome(article) {
    var headings = Array.prototype.slice.call(article.querySelectorAll("h2, h3"));
    var aside = null, links = [];
    if (headings.length >= 3) {
      aside = document.createElement("aside");
      aside.className = "minitoc";
      aside.innerHTML = '<div class="minitoc-title">On this page</div>';
      var ul = document.createElement("ul");
      headings.forEach(function (h, i) {
        if (!h.id) h.id = "h-" + i;
        var li = document.createElement("li");
        li.className = "minitoc-" + h.tagName.toLowerCase();
        var a = document.createElement("a");
        a.href = "#/" + ""; // prevent hash routing; we scroll manually
        a.textContent = h.textContent;
        a.addEventListener("click", function (e) {
          e.preventDefault();
          h.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        li.appendChild(a);
        ul.appendChild(li);
        links.push({ h: h, a: a });
      });
      aside.appendChild(ul);
      document.getElementById("content").appendChild(aside);
    }

    function onScroll() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - doc.clientHeight;
      var pct = max > 0 ? Math.min(100, Math.round((doc.scrollTop || window.scrollY) / max * 100)) : 0;
      setReadingProgress(pct);
      if (links.length) {
        var top = (doc.scrollTop || window.scrollY) + 120;
        var activeIdx = 0;
        for (var i = 0; i < links.length; i++) {
          if (links[i].h.offsetTop <= top) activeIdx = i;
        }
        links.forEach(function (l, i) { l.a.classList.toggle("active", i === activeIdx); });
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return function () {
      window.removeEventListener("scroll", onScroll);
      if (aside) aside.remove();
    };
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
        // Node-only JS/TS reference code gets an "Open in StackBlitz" button so
        // learners can run the real thing (servers, fs, npm) in a Node sandbox.
        var isNodeCode = /^(js|javascript|ts|typescript)$/.test(b.lang);
        if (isNodeCode && window.StackBlitz) {
          var sbBtn = mkBtn("⚡ Open in StackBlitz", "btn btn-ghost btn-sb");
          sbBtn.title = "Run this on real Node.js in a new tab";
          toolbar.appendChild(sbBtn);
          sbBtn.addEventListener("click", function () {
            window.StackBlitz.openSnippet(currentValue(), entry ? entry.title : "Node snippet");
          });
        }
        var copyBtn2 = mkBtn("Copy", "btn btn-ghost");
        toolbar.appendChild(copyBtn2);
        card.appendChild(toolbar);
        card.appendChild(host);
        placeholder.replaceWith(card);
        var currentValue = function () { return b.code; };
        window.MonacoKit.create(host, { code: b.code, language: jsLang(b.lang), readOnly: (b.mode === "readonly") })
          .then(function (editor) {
            currentValue = function () { return editor.getValue(); };
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
      '<div class="lesson-extras-host"></div>' +
      '<div class="lesson-nav-host"></div>';

    // append nav
    var navHost = article.querySelector(".lesson-nav-host");
    navHost.innerHTML = window.Nav.render(entry.id);

    setContent(article);
    injectDiagrams(article);
    upgradeEditors(article, parsed.blocks);
    window.Nav.wire(entry.id, article);

    // quizzes + further reading (lazy-loaded per module)
    if (window.Extras) {
      window.Extras.render(article.querySelector(".lesson-extras-host"), entry.moduleId, entry.id);
    }

    teardown = setupLessonChrome(article);
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
