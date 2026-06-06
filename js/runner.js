/* =========================================================================
   runner.js — run pure-JavaScript snippets safely in a sandboxed Web Worker.

   Why a Worker and not eval()? Two reasons:
   1) Isolation: the snippet can't touch the page's DOM, our app state, or the
      learner's localStorage.
   2) Killability: an infinite loop (while(true){}) freezes a single thread —
      but we can terminate() a Worker after a timeout and keep the page alive.

   The worker shims console.* to postMessage each call back to the page, where
   we paint it into the output console. Node-only APIs (fs/http/etc.) are NOT
   available here on purpose — those lessons ship a static [!OUTPUT] block.
   Exposes window.Runner.run(code, outputEl).
   ========================================================================= */
(function () {
  "use strict";

  var IDLE_MS = 2000;     // tear down this long after the last output/completion
  var HARD_CAP_MS = 9000; // absolute ceiling (also catches infinite loops)

  // The worker's source. Kept as a string so we can spin a fresh, clean worker
  // per run (no leaked state between runs) via a Blob URL.
  var WORKER_SRC = [
    "self.onmessage = function (e) {",
    "  var code = e.data;",
    "  function send(level, args) {",
    "    var parts = Array.prototype.map.call(args, function (a) {",
    "      try {",
    "        if (typeof a === 'string') return a;",
    "        if (a instanceof Error) return a.stack || (a.name + ': ' + a.message);",
    "        return JSON.stringify(a, function (k, v) {",
    "          if (typeof v === 'function') return '[Function: ' + (v.name || 'anonymous') + ']';",
    "          if (typeof v === 'bigint') return v.toString() + 'n';",
    "          if (typeof v === 'undefined') return '[undefined]';",
    "          return v;",
    "        }, 2);",
    "      } catch (err) { return String(a); }",
    "    });",
    "    self.postMessage({ level: level, text: parts.join(' ') });",
    "  }",
    "  var console = {",
    "    log: function () { send('log', arguments); },",
    "    info: function () { send('info', arguments); },",
    "    warn: function () { send('warn', arguments); },",
    "    error: function () { send('error', arguments); },",
    "    debug: function () { send('log', arguments); }",
    "  };",
    "  try {",
    "    var result = (function () { 'use strict';",
    "      return eval(code);",
    "    })();",
    "    if (result && typeof result.then === 'function') {",
    "      result.then(function (v) {",
    "        if (v !== undefined) send('log', [v]);",
    "        self.postMessage({ done: true });",
    "      }, function (err) { send('error', [err]); self.postMessage({ done: true }); });",
    "    } else {",
    "      self.postMessage({ done: true });",
    "    }",
    "  } catch (err) {",
    "    send('error', [err]);",
    "    self.postMessage({ done: true });",
    "  }",
    "};"
  ].join("\n");

  function line(level, text) {
    var span = document.createElement("div");
    if (level === "error") span.className = "out-err";
    else if (level === "warn") span.className = "out-warn";
    else if (level === "info") span.className = "out-info";
    else if (level === "meta") span.className = "out-meta";
    span.textContent = text;
    return span;
  }

  function run(code, outputEl) {
    outputEl.innerHTML = "";
    outputEl.appendChild(line("meta", "▶ running…"));

    // Because snippets may schedule async work (setTimeout, promises), we can't
    // terminate the worker the instant the *synchronous* part finishes — the
    // interesting output often arrives later. Instead we keep the worker alive
    // and tear it down when it goes IDLE (no messages for IDLE_MS) or when the
    // hard safety cap (HARD_CAP_MS) is hit (which also catches infinite loops).
    var worker, idleTimer, hardTimer, finished = false, syncDone = false;
    var url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));

    function cleanup() {
      if (finished) return;
      finished = true;
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      try { worker.terminate(); } catch (e) {}
      URL.revokeObjectURL(url);
    }

    function resetIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        if (finished) return;
        if (!syncDone) {
          // No completion signal and no recent output -> blocked / too long.
          outputEl.appendChild(line("error", "⏱ Stopped — the code ran too long " +
            "(likely an infinite loop or a very long operation)."));
        } else if (!outputEl.querySelector(":not(.out-meta)") && !outputEl.childNodes.length) {
          outputEl.appendChild(line("meta", "✓ done (no output)"));
        }
        cleanup();
      }, IDLE_MS);
    }

    try {
      worker = new Worker(url);
    } catch (e) {
      outputEl.innerHTML = "";
      outputEl.appendChild(line("error", "Could not start sandbox: " + e.message));
      URL.revokeObjectURL(url);
      return;
    }

    var started = false;
    worker.onmessage = function (e) {
      var d = e.data;
      if (d.done) { syncDone = true; resetIdle(); return; }
      if (!started) { outputEl.innerHTML = ""; started = true; } // clear "running…"
      outputEl.appendChild(line(d.level, d.text));
      outputEl.scrollTop = outputEl.scrollHeight;
      resetIdle();
    };

    worker.onerror = function (e) {
      if (!started) { outputEl.innerHTML = ""; started = true; }
      outputEl.appendChild(line("error", e.message || "Worker error"));
      cleanup();
    };

    // Hard safety cap regardless of activity (kills runaway infinite loops that
    // never yield a message to reset the idle timer either).
    hardTimer = setTimeout(function () {
      if (finished) return;
      outputEl.appendChild(line("error", "⏱ Stopped after " + (HARD_CAP_MS / 1000) +
        "s (hard limit)."));
      cleanup();
    }, HARD_CAP_MS);

    resetIdle();           // start the idle watchdog immediately
    worker.postMessage(code);
  }

  window.Runner = { run: run };
})();
