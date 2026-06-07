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

  /* ---------- spaced-repetition (SM-2-lite) ---------- */
  var SR_KEY = "ultimate-node-course:sr";
  // Intervals (ms) by streak length. Wrong answers reset to the short end.
  var INTERVALS = [10 * 60e3, 24 * 3600e3, 3 * 24 * 3600e3, 7 * 24 * 3600e3, 21 * 24 * 3600e3, 60 * 24 * 3600e3];

  function loadSR() { try { return JSON.parse(localStorage.getItem(SR_KEY) || "{}"); } catch (e) { return {}; } }
  function saveSR(s) { try { localStorage.setItem(SR_KEY, JSON.stringify(s)); } catch (e) {} }
  function qKey(lessonId, qi) { return lessonId + "#" + qi; }

  function recordResult(lessonId, qi, correct) {
    var sr = loadSR();
    var k = qKey(lessonId, qi);
    var cur = sr[k] || { streak: 0, lapses: 0, seen: 0, attempts: 0, correctCount: 0 };
    cur.seen++;
    cur.attempts = (cur.attempts || 0) + 1;
    if (correct) { cur.streak = Math.min(cur.streak + 1, INTERVALS.length - 1); cur.correctCount = (cur.correctCount || 0) + 1; }
    else { cur.streak = 0; cur.lapses++; }
    cur.last = Date.now();
    cur.due = Date.now() + INTERVALS[correct ? cur.streak : 0];
    cur.lastCorrect = correct;
    sr[k] = cur;
    saveSR(sr);
  }

  // Aggregate quiz performance per lesson (from the SR store). Returns a map
  // lessonId -> { questions, attempted, attempts, correct } for loaded modules.
  function quizStatsByLesson() {
    var sr = loadSR();
    var out = {};
    Object.keys(QUIZ).forEach(function (lessonId) {
      var qs = QUIZ[lessonId];
      var stat = { questions: qs.length, attempted: 0, attempts: 0, correct: 0 };
      qs.forEach(function (q, qi) {
        var st = sr[qKey(lessonId, qi)];
        if (st) { stat.attempted++; stat.attempts += (st.attempts || 0); stat.correct += (st.correctCount || 0); }
      });
      out[lessonId] = stat;
    });
    return out;
  }

  // Questions due for review: never-correct or past their due time. Returns
  // [{ lessonId, moduleId, qi, q }] sorted by urgency (lapsed/overdue first).
  function dueQuestions(now) {
    now = now || Date.now();
    var sr = loadSR();
    var out = [];
    Object.keys(QUIZ).forEach(function (lessonId) {
      var lesson = window.COURSE && window.COURSE.flat.find(function (l) { return l.id === lessonId; });
      QUIZ[lessonId].forEach(function (q, qi) {
        var st = sr[qKey(lessonId, qi)];
        var due = !st || !st.lastCorrect || (st.due && st.due <= now);
        if (due) out.push({ lessonId: lessonId, moduleId: lesson ? lesson.moduleId : null, qi: qi, q: q,
          urgency: st ? (st.lastCorrect ? (now - st.due) : 1e12 + (now - (st.last || 0))) : 5e11 });
      });
    });
    out.sort(function (a, b) { return b.urgency - a.urgency; });
    return out;
  }

  // Load every module's quiz file (used by the review page).
  function loadAll() {
    if (!window.COURSE) return Promise.resolve();
    return Promise.all(window.COURSE.modules.map(function (m) { return loadModule(m.id); }));
  }

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
    var T = window.I18n ? function (k) { return window.I18n.t(k); } : function (k) { return k; };
    section.innerHTML = '<h2 class="quiz-heading">' + T("quiz_heading") +
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
          recordResult(lessonId, qi, isCorrect); // feed spaced-repetition
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
            tally.textContent = T("quiz_scored") + " " + state.correct + " / " + state.total;
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
    tally.textContent = T("quiz_answer_all");
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
    var T2 = window.I18n ? function (k) { return window.I18n.t(k); } : function (k) { return k; };
    box.innerHTML = '<h2 class="resources-heading">' + T2("res_heading") + '</h2><ul class="res-list">' + items + "</ul>";
    host.appendChild(box);
  }

  var Extras = {
    render: function (host, moduleId, lessonId) {
      return loadModule(moduleId).then(function () {
        renderQuiz(host, lessonId);
        renderResources(host, lessonId);
      });
    },
    hasQuiz: function (lessonId) { return !!(QUIZ[lessonId] && QUIZ[lessonId].length); },
    getQuestions: function (lessonId) { return QUIZ[lessonId] || []; },
    loadAll: loadAll,
    dueQuestions: dueQuestions,
    recordResult: recordResult,
    quizStatsByLesson: quizStatsByLesson
  };

  window.Extras = Extras;
})();
