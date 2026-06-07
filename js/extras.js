/* =========================================================================
   extras.js — per-lesson "Knowledge check" quizzes + "Further reading" links.
   Data lives in content/quizzes/<moduleId>.js (lazy-loaded), which call
   registerQuiz(lessonId, questions) and registerResources(lessonId, links).
   Exposes window.Extras. Quiz scores persist in localStorage.
   ========================================================================= */
(function () {
  "use strict";

  var QUIZ = {};        // lessonId -> [{ q, options:[...], answer:Number, explain }]
  var RES = {};         // lessonId -> [{ title, url }]
  var loadedModules = {};
  var pendingModule = {};

  window.registerQuiz = function (lessonId, questions) { QUIZ[lessonId] = questions; };
  window.registerResources = function (lessonId, links) { RES[lessonId] = links; };

  function loadModule(moduleId) {
    if (loadedModules[moduleId]) return Promise.resolve();
    if (pendingModule[moduleId]) return pendingModule[moduleId];
    pendingModule[moduleId] = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "content/quizzes/" + moduleId + ".js";
      s.onload = function () { loadedModules[moduleId] = true; resolve(); };
      s.onerror = function () { loadedModules[moduleId] = true; resolve(); }; // no quiz file is fine
      document.head.appendChild(s);
    });
    return pendingModule[moduleId];
  }

  /* ---- quiz score persistence ---- */
  function scoreKey(lessonId) { return "ultimate-node-course:quiz:" + lessonId; }
  function savedScore(lessonId) {
    try { var v = localStorage.getItem(scoreKey(lessonId)); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function saveScore(lessonId, correct, total) {
    try { localStorage.setItem(scoreKey(lessonId), JSON.stringify({ correct: correct, total: total, at: Date.now() })); } catch (e) {}
  }

  /* ---- render ---- */
  function renderQuiz(host, lessonId) {
    var questions = QUIZ[lessonId];
    if (!questions || !questions.length) return;

    var section = document.createElement("section");
    section.className = "quiz";
    var prev = savedScore(lessonId);
    section.innerHTML = '<h2 class="quiz-heading">📝 Knowledge check' +
      (prev ? ' <span class="quiz-prev">last score: ' + prev.correct + "/" + prev.total + "</span>" : "") +
      "</h2>";

    var state = { answered: 0, correct: 0, total: questions.length };

    questions.forEach(function (q, qi) {
      var card = document.createElement("div");
      card.className = "quiz-q";
      var qhtml = '<div class="quiz-q-text"><span class="quiz-q-num">' + (qi + 1) + ".</span> " +
        (window.MD ? window.MD.inline(q.q) : q.q) + "</div>";
      card.innerHTML = qhtml;
      var opts = document.createElement("div");
      opts.className = "quiz-opts";

      var locked = false;
      q.options.forEach(function (opt, oi) {
        var btn = document.createElement("button");
        btn.className = "quiz-opt";
        btn.type = "button";
        btn.innerHTML = '<span class="quiz-opt-key">' + String.fromCharCode(65 + oi) + "</span>" +
          '<span class="quiz-opt-text">' + (window.MD ? window.MD.inline(opt) : opt) + "</span>";
        btn.addEventListener("click", function () {
          if (locked) return;
          locked = true;
          var isCorrect = oi === q.answer;
          if (isCorrect) state.correct++;
          state.answered++;
          // mark all options
          Array.prototype.forEach.call(opts.children, function (b, bi) {
            b.classList.add("revealed");
            if (bi === q.answer) b.classList.add("correct");
            if (bi === oi && !isCorrect) b.classList.add("wrong");
            b.disabled = true;
          });
          var exp = document.createElement("div");
          exp.className = "quiz-explain " + (isCorrect ? "ok" : "no");
          exp.innerHTML = "<strong>" + (isCorrect ? "Correct. " : "Not quite. ") + "</strong>" +
            (window.MD ? window.MD.inline(q.explain || "") : (q.explain || ""));
          card.appendChild(exp);
          if (state.answered === state.total) {
            saveScore(lessonId, state.correct, state.total);
            tally.textContent = "You scored " + state.correct + " / " + state.total;
            tally.classList.add("done");
            if (state.correct === state.total) tally.classList.add("perfect");
          }
        });
        opts.appendChild(btn);
      });
      card.appendChild(opts);
      section.appendChild(card);
    });

    var tally = document.createElement("div");
    tally.className = "quiz-tally";
    tally.textContent = "Answer all " + state.total + " questions to see your score.";
    section.appendChild(tally);

    host.appendChild(section);
  }

  function renderResources(host, lessonId) {
    var links = RES[lessonId];
    if (!links || !links.length) return;
    var box = document.createElement("section");
    box.className = "resources";
    var items = links.map(function (l) {
      return '<li><a href="' + l.url + '" target="_blank" rel="noopener">' + l.title +
        '<span class="res-ext">↗</span></a></li>';
    }).join("");
    box.innerHTML = '<h2 class="resources-heading">📚 Further reading</h2><ul class="res-list">' + items + "</ul>";
    host.appendChild(box);
  }

  var Extras = {
    render: function (host, moduleId, lessonId) {
      return loadModule(moduleId).then(function () {
        renderQuiz(host, lessonId);
        renderResources(host, lessonId);
      });
    },
    hasQuiz: function (lessonId) { return !!(QUIZ[lessonId] && QUIZ[lessonId].length); }
  };

  window.Extras = Extras;
})();
