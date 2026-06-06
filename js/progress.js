/* =========================================================================
   progress.js — learner progress via localStorage (no backend)
   Tracks: which lessons are completed, and the last lesson visited so the
   landing page can offer "Resume". Keyed by course version so a new course
   revision never collides with old data. Exposes a tiny global: window.Progress
   ========================================================================= */
(function () {
  "use strict";

  var KEY = "ultimate-node-course:" + (window.COURSE ? window.COURSE.version : "dev");

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return { completed: {}, lastVisited: null };
      var parsed = JSON.parse(raw);
      parsed.completed = parsed.completed || {};
      return parsed;
    } catch (e) {
      return { completed: {}, lastVisited: null };
    }
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage may be off */ }
  }

  var state = load();
  var listeners = [];

  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) {} }); }

  var Progress = {
    /** Subscribe to any progress change. Returns an unsubscribe function. */
    onChange: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    },
    isComplete: function (lessonId) { return !!state.completed[lessonId]; },
    setComplete: function (lessonId, done) {
      if (done) state.completed[lessonId] = Date.now();
      else delete state.completed[lessonId];
      save(state); emit();
    },
    toggle: function (lessonId) {
      this.setComplete(lessonId, !this.isComplete(lessonId));
      return this.isComplete(lessonId);
    },
    completedCount: function () { return Object.keys(state.completed).length; },
    /** Completion ratio (0..1) for a list of lesson ids. */
    ratioFor: function (lessonIds) {
      if (!lessonIds.length) return 0;
      var n = 0;
      lessonIds.forEach(function (id) { if (state.completed[id]) n++; });
      return n / lessonIds.length;
    },
    setLastVisited: function (lessonId) { state.lastVisited = lessonId; save(state); },
    getLastVisited: function () { return state.lastVisited; },
    /** Export progress as a JSON string so a learner can move machines. */
    export: function () { return JSON.stringify(state, null, 2); },
    import: function (json) {
      try { state = JSON.parse(json); state.completed = state.completed || {}; save(state); emit(); return true; }
      catch (e) { return false; }
    },
    reset: function () { state = { completed: {}, lastVisited: null }; save(state); emit(); }
  };

  window.Progress = Progress;
})();
