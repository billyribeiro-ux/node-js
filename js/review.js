/* =========================================================================
   review.js — spaced-repetition Review Mode. Resurfaces quiz questions you've
   missed or are due to revisit (SM-2-lite scheduling lives in extras.js), and
   runs a flashcard-style session. Exposes window.Review.
   ========================================================================= */
(function () {
  "use strict";

  var SESSION_MAX = 20;

  function lessonOf(id) { return window.COURSE.flat.find(function (l) { return l.id === id; }); }

  function page() {
    var el = document.createElement("article");
    el.className = "lesson review-page";
    el.innerHTML = '<div class="lesson-breadcrumb"><a href="#/">Home</a><span class="crumb-sep">›</span><span>Review</span></div>' +
      "<h1>🔁 Spaced-Repetition Review</h1><div class='review-body'>Loading your review deck…</div>";
    var body = el.querySelector(".review-body");

    window.Extras.loadAll().then(function () {
      var due = window.Extras.dueQuestions();
      start(body, due, false);
    });
    return el;
  }

  function start(body, deck, forced) {
    if (!deck.length) {
      body.innerHTML =
        "<p class='review-caught'>✅ <strong>You're all caught up.</strong> No questions are due for review right now. " +
        "As you answer quizzes, missed questions come back here on a spaced schedule (10 min → 1 day → 3 days → 1 week → 3 weeks → 2 months).</p>" +
        '<button class="btn" id="review-anyway">Review a random 20 anyway</button>';
      var anyBtn = body.querySelector("#review-anyway");
      if (anyBtn) anyBtn.addEventListener("click", function () {
        var all = window.Extras.dueQuestions(Number.MAX_SAFE_INTEGER); // treat everything as due
        shuffle(all);
        start(body, all, true);
      });
      return;
    }

    var queue = deck.slice(0, SESSION_MAX);
    var i = 0, correct = 0;

    function renderCard() {
      if (i >= queue.length) { summary(); return; }
      var item = queue[i];
      var lesson = lessonOf(item.lessonId);
      var q = item.q;
      body.innerHTML =
        '<div class="review-progress">Question ' + (i + 1) + " of " + queue.length +
          (forced ? "" : " due") + ' &middot; <span class="review-score">' + correct + ' correct</span></div>' +
        '<div class="review-bar"><div class="review-bar-fill" style="width:' + (i / queue.length * 100) + '%"></div></div>' +
        '<div class="quiz-q review-q"><div class="quiz-q-text">' + (window.MD ? window.MD.inline(q.q) : q.q) + "</div>" +
        '<div class="quiz-opts"></div></div>' +
        (lesson ? '<div class="review-from">from <a href="#/' + lesson.moduleId + "/" + lesson.id + '">' + lesson.title + "</a></div>" : "");

      var opts = body.querySelector(".quiz-opts");
      var locked = false;
      q.options.forEach(function (opt, oi) {
        var btn = document.createElement("button");
        btn.className = "quiz-opt"; btn.type = "button";
        btn.innerHTML = '<span class="quiz-opt-key">' + String.fromCharCode(65 + oi) + "</span>" +
          '<span class="quiz-opt-text">' + (window.MD ? window.MD.inline(opt) : opt) + "</span>";
        btn.addEventListener("click", function () {
          if (locked) return; locked = true;
          var ok = oi === q.answer;
          if (ok) correct++;
          window.Extras.recordResult(item.lessonId, item.qi, ok);
          Array.prototype.forEach.call(opts.children, function (b, bi) {
            b.classList.add("revealed");
            if (bi === q.answer) b.classList.add("correct");
            if (bi === oi && !ok) b.classList.add("wrong");
            b.disabled = true;
          });
          var exp = document.createElement("div");
          exp.className = "quiz-explain " + (ok ? "ok" : "no");
          exp.innerHTML = "<strong>" + (ok ? "Correct. " : "Review this. ") + "</strong>" +
            (window.MD ? window.MD.inline(q.explain || "") : (q.explain || ""));
          body.querySelector(".review-q").appendChild(exp);
          var next = document.createElement("button");
          next.className = "btn btn-cta review-next";
          next.textContent = (i + 1 < queue.length) ? "Next →" : "Finish";
          next.addEventListener("click", function () { i++; renderCard(); });
          body.querySelector(".review-q").appendChild(next);
          next.focus();
        });
        opts.appendChild(btn);
      });
    }

    function summary() {
      var pct = Math.round(correct / queue.length * 100);
      body.innerHTML = '<div class="review-summary"><div class="review-big">' + correct + " / " + queue.length + "</div>" +
        "<p>" + (pct >= 80 ? "Strong session — those are sticking." : "Good work — the ones you missed will resurface sooner.") + "</p>" +
        '<div class="review-actions"><button class="btn btn-cta" id="review-more">Review more</button>' +
        '<a class="btn" href="#/">Back home</a></div></div>';
      var more = body.querySelector("#review-more");
      more.addEventListener("click", function () {
        var due = window.Extras.dueQuestions();
        if (!due.length) { var all = window.Extras.dueQuestions(Number.MAX_SAFE_INTEGER); shuffle(all); start(body, all, true); }
        else start(body, due, false);
      });
    }

    renderCard();
  }

  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } }

  // Count of due questions, for badges (only counts already-loaded modules).
  function dueCount() { return window.Extras ? window.Extras.dueQuestions().length : 0; }

  window.Review = { page: page, dueCount: dueCount };
})();
