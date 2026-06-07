/* =========================================================================
   diagrams.js — a registry of hand-built, theme-aware SVG concept diagrams.
   Lessons embed one with a line:   @diagram:event-loop
   markdown.js turns that into a placeholder; router injects the SVG + caption.
   SVGs use currentColor (inherits the text colour) plus the Node-green accent,
   so they read well in both light and dark themes. Exposes window.DIAGRAMS.
   ========================================================================= */
(function () {
  "use strict";

  var G = "#3fae50";        // node green accent
  var G2 = "#2f9c42";

  function box(x, y, w, h, label, fill) {
    var lines = String(label).split("\\n");
    var cx = x + w / 2;
    var startY = y + h / 2 + 5 - (lines.length - 1) * 8;
    var text = '<text x="' + cx + '" y="' + startY + '" text-anchor="middle" font-size="13" fill="currentColor">';
    lines.forEach(function (ln, i) {
      text += '<tspan x="' + cx + '" dy="' + (i === 0 ? 0 : 16) + '">' + ln + "</tspan>";
    });
    text += "</text>";
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
      '" rx="8" fill="' + (fill || "none") + '" stroke="currentColor" stroke-width="1.5" opacity="0.95"/>' + text;
  }
  function arrow(x1, y1, x2, y2, color) {
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
      '" stroke="' + (color || G) + '" stroke-width="2" marker-end="url(#arrowhead)"/>';
  }
  function svg(vb, body) {
    return '<svg viewBox="0 0 ' + vb + '" xmlns="http://www.w3.org/2000/svg" role="img">' +
      '<defs><marker id="arrowhead" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">' +
      '<path d="M0,0 L7,3 L0,6 Z" fill="' + G + '"/></marker></defs>' + body + "</svg>";
  }

  var D = {};

  // ---- The event loop phases (cycle) ----
  D["event-loop"] = {
    title: "The libuv event loop cycles through ordered phases on every tick",
    svg: svg("760 360",
      '<text x="380" y="28" text-anchor="middle" font-size="15" font-weight="700" fill="' + G + '">EVENT LOOP — one tick</text>' +
      box(300, 50, 160, 44, "timers", "rgba(63,174,80,0.12)") +
      box(520, 120, 170, 44, "pending callbacks") +
      box(520, 200, 170, 44, "poll  (I/O)", "rgba(63,174,80,0.12)") +
      box(300, 270, 160, 44, "check (setImmediate)") +
      box(70, 200, 170, 44, "close callbacks") +
      box(70, 120, 170, 44, "idle / prepare") +
      arrow(380, 94, 540, 120) + arrow(605, 164, 605, 200) +
      arrow(560, 244, 420, 270) + arrow(300, 292, 180, 244) +
      arrow(155, 200, 155, 164) + arrow(180, 120, 320, 94) +
      '<text x="605" y="188" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.7">most time spent here</text>' +
      '<text x="380" y="340" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.7">After every callback, the microtask queue is drained completely.</text>')
  };

  // ---- Macrotasks vs microtasks priority ----
  D["task-queues"] = {
    title: "Priority: nextTick → promise microtasks → macrotask phases",
    svg: svg("760 250",
      box(40, 40, 200, 60, "process.nextTick", "rgba(63,174,80,0.18)") +
      box(290, 40, 200, 60, "microtasks (promises)", "rgba(63,174,80,0.10)") +
      box(540, 40, 190, 60, "macrotasks (timers, I/O)") +
      arrow(240, 70, 290, 70) + arrow(490, 70, 540, 70) +
      '<text x="135" y="125" text-anchor="middle" font-size="12" fill="currentColor">highest priority</text>' +
      '<text x="635" y="125" text-anchor="middle" font-size="12" fill="currentColor">lowest priority</text>' +
      '<text x="380" y="175" text-anchor="middle" font-size="13" fill="currentColor" opacity="0.85">The two left queues drain FULLY before the loop runs the next macrotask.</text>' +
      '<text x="380" y="205" text-anchor="middle" font-size="12" fill="#f85149">Recursive nextTick / microtasks here can STARVE the loop →</text>')
  };

  // ---- Node architecture ----
  D["node-architecture"] = {
    title: "Node = your JavaScript on V8, with libuv handling async I/O",
    svg: svg("700 320",
      box(220, 30, 260, 50, "Your JavaScript", "rgba(63,174,80,0.12)") +
      box(220, 110, 260, 46, "Node.js core APIs (fs, http, …)") +
      box(120, 185, 200, 46, "V8 (runs JS)") +
      box(380, 185, 200, 46, "libuv (event loop + thread pool)", "rgba(63,174,80,0.10)") +
      box(120, 255, 460, 44, "Operating System (disk, network, timers)") +
      arrow(350, 80, 350, 110) + arrow(300, 156, 220, 185) + arrow(400, 156, 480, 185) +
      arrow(220, 231, 250, 255) + arrow(480, 231, 450, 255))
  };

  // ---- Streams & backpressure ----
  D["backpressure"] = {
    title: "Backpressure: a slow consumer makes the producer pause",
    svg: svg("740 230",
      box(40, 80, 150, 56, "Readable\\n(source)", "rgba(63,174,80,0.12)") +
      box(300, 80, 150, 56, "buffer\\n(highWaterMark)") +
      box(560, 80, 150, 56, "Writable\\n(slow sink)") +
      arrow(190, 108, 300, 108) + arrow(450, 108, 560, 108) +
      '<text x="245" y="70" text-anchor="middle" font-size="12" fill="' + G + '">fast</text>' +
      '<text x="505" y="70" text-anchor="middle" font-size="12" fill="#f85149">slow</text>' +
      '<path d="M560 165 C 400 210, 280 210, 190 150" fill="none" stroke="#d29922" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#arrowhead)"/>' +
      '<text x="375" y="205" text-anchor="middle" font-size="12" fill="#d29922">"pause!" — when the buffer fills, the source is told to wait</text>')
  };

  // ---- Promise states ----
  D["promise-states"] = {
    title: "A promise settles once — then never changes",
    svg: svg("700 200",
      box(40, 75, 160, 50, "pending", "rgba(210,153,34,0.15)") +
      box(420, 30, 230, 50, "fulfilled (value)", "rgba(63,174,80,0.15)") +
      box(420, 120, 230, 50, "rejected (error)", "rgba(248,81,73,0.15)") +
      arrow(200, 90, 420, 55) + arrow(200, 110, 420, 145) +
      '<text x="310" y="60" text-anchor="middle" font-size="12" fill="' + G + '">resolve()</text>' +
      '<text x="310" y="160" text-anchor="middle" font-size="12" fill="#f85149">reject()</text>')
  };

  // ---- GC generations ----
  D["gc-generations"] = {
    title: "Generational GC: most objects die young in new space",
    svg: svg("700 230",
      box(60, 60, 240, 70, "New space (young)\\nfast, frequent Scavenge", "rgba(63,174,80,0.12)") +
      box(400, 60, 240, 70, "Old space\\nslow Mark-Sweep-Compact") +
      arrow(300, 95, 400, 95) +
      '<text x="350" y="80" text-anchor="middle" font-size="11" fill="currentColor">survives a few GCs</text>' +
      '<text x="180" y="160" text-anchor="middle" font-size="12" fill="#f85149">most objects die here ✓</text>' +
      '<text x="520" y="160" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.8">long-lived objects</text>')
  };

  // ---- Cluster ----
  D["cluster"] = {
    title: "cluster: a primary forks one worker per CPU core, sharing the port",
    svg: svg("700 260",
      box(260, 30, 180, 48, "Primary process", "rgba(63,174,80,0.12)") +
      box(60, 150, 140, 48, "Worker 1") +
      box(280, 150, 140, 48, "Worker 2") +
      box(500, 150, 140, 48, "Worker 3") +
      arrow(320, 78, 130, 150) + arrow(350, 78, 350, 150) + arrow(380, 78, 570, 150) +
      '<text x="350" y="235" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.8">incoming connections are balanced across workers (one shared port)</text>')
  };

  // ---- HTTP request lifecycle ----
  D["http-lifecycle"] = {
    title: "An HTTP request flows through middleware, then a handler, then back",
    svg: svg("760 180",
      box(30, 70, 110, 46, "request") +
      box(180, 70, 120, 46, "middleware", "rgba(63,174,80,0.10)") +
      box(340, 70, 120, 46, "route handler", "rgba(63,174,80,0.15)") +
      box(500, 70, 120, 46, "middleware", "rgba(63,174,80,0.10)") +
      box(660, 70, 80, 46, "response") +
      arrow(140, 93, 180, 93) + arrow(300, 93, 340, 93) +
      arrow(460, 93, 500, 93) + arrow(620, 93, 660, 93) +
      '<text x="380" y="150" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.75">the "onion" model: each middleware can act before AND after the handler</text>')
  };

  // ---- Circuit breaker ----
  D["circuit-breaker"] = {
    title: "Circuit breaker: stop hammering a failing dependency, then probe",
    svg: svg("700 210",
      box(40, 80, 160, 50, "CLOSED\\n(calls pass)", "rgba(63,174,80,0.15)") +
      box(270, 80, 160, 50, "OPEN\\n(fail fast)", "rgba(248,81,73,0.15)") +
      box(500, 80, 160, 50, "HALF-OPEN\\n(test one)", "rgba(210,153,34,0.15)") +
      arrow(200, 95, 270, 95) + arrow(430, 110, 500, 110) +
      '<path d="M580 80 C 560 30, 120 30, 120 78" fill="none" stroke="' + G + '" stroke-width="2" marker-end="url(#arrowhead)"/>' +
      '<text x="235" y="80" text-anchor="middle" font-size="10" fill="#f85149">too many fails</text>' +
      '<text x="465" y="135" text-anchor="middle" font-size="10" fill="#d29922">after cooldown</text>' +
      '<text x="350" y="35" text-anchor="middle" font-size="10" fill="' + G + '">probe succeeds → close</text>')
  };

  // ---- JWT structure ----
  D["jwt-structure"] = {
    title: "A JWT is three base64url parts joined by dots: header.payload.signature",
    svg: svg("740 200",
      box(30, 70, 200, 56, "Header\\n{ alg, typ }", "rgba(47,129,247,0.14)") +
      box(270, 70, 200, 56, "Payload\\n{ sub, exp, … }", "rgba(63,174,80,0.14)") +
      box(510, 70, 200, 56, "Signature\\nHMAC/RSA", "rgba(163,113,247,0.14)") +
      '<text x="250" y="103" text-anchor="middle" font-size="22" fill="currentColor">.</text>' +
      '<text x="490" y="103" text-anchor="middle" font-size="22" fill="currentColor">.</text>' +
      '<text x="370" y="170" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.8">the signature is verified with a secret/key — tamper with any part and it fails</text>')
  };

  // ---- Worker pool ----
  D["worker-pool"] = {
    title: "A worker pool reuses a fixed set of threads, fed by a task queue",
    svg: svg("720 250",
      box(30, 95, 150, 48, "task queue", "rgba(63,174,80,0.10)") +
      box(280, 30, 150, 44, "Worker A") +
      box(280, 100, 150, 44, "Worker B") +
      box(280, 170, 150, 44, "Worker C") +
      box(540, 95, 150, 48, "results") +
      arrow(180, 110, 280, 52) + arrow(180, 119, 280, 122) + arrow(180, 128, 280, 192) +
      arrow(430, 52, 540, 110) + arrow(430, 122, 540, 119) + arrow(430, 192, 540, 128) +
      '<text x="360" y="240" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.8">idle workers pull the next task — no costly thread-per-task spin-up</text>')
  };

  // ---- Pub/Sub fan-out across nodes ----
  D["pubsub-fanout"] = {
    title: "A shared pub/sub bus lets users on different servers reach each other",
    svg: svg("720 250",
      box(280, 30, 160, 46, "Redis Pub/Sub", "rgba(63,174,80,0.14)") +
      box(40, 150, 150, 46, "Server A") +
      box(285, 150, 150, 46, "Server B") +
      box(530, 150, 150, 46, "Server C") +
      arrow(330, 150, 350, 76) + arrow(360, 76, 360, 150, "#888") +
      arrow(190, 165, 285, 76) + arrow(640, 165, 440, 76) +
      '<text x="360" y="235" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.8">each server publishes events; every server receives them and pushes to its own sockets</text>')
  };

  // ---- Saga (compensating transactions) ----
  D["saga"] = {
    title: "A saga runs local steps; on failure it runs compensations in reverse",
    svg: svg("740 210",
      box(30, 40, 130, 46, "Order", "rgba(63,174,80,0.12)") +
      box(210, 40, 130, 46, "Payment", "rgba(63,174,80,0.12)") +
      box(390, 40, 130, 46, "Shipping", "rgba(248,81,73,0.14)") +
      arrow(160, 63, 210, 63) + arrow(340, 63, 390, 63) +
      '<text x="455" y="110" text-anchor="middle" font-size="11" fill="#f85149">fails ✗</text>' +
      '<path d="M390 86 C 300 150, 200 150, 95 88" fill="none" stroke="#d29922" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#arrowhead)"/>' +
      '<text x="250" y="175" text-anchor="middle" font-size="12" fill="#d29922">compensate: refund payment, cancel order (undo in reverse)</text>')
  };

  // ---- Docker multi-stage layers ----
  D["container-layers"] = {
    title: "Multi-stage builds keep heavy build tools out of the final image",
    svg: svg("720 220",
      box(40, 40, 280, 140, "BUILD STAGE\\n(full toolchain, devDeps,\\ncompile/bundle)", "rgba(210,153,34,0.12)") +
      box(400, 70, 280, 90, "RUNTIME STAGE\\n(distroless, prod deps,\\njust the built output)", "rgba(63,174,80,0.14)") +
      '<path d="M320 110 L 400 110" stroke="' + G + '" stroke-width="2" marker-end="url(#arrowhead)"/>' +
      '<text x="360" y="100" text-anchor="middle" font-size="11" fill="currentColor">COPY artifacts</text>' +
      '<text x="540" y="195" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.8">small, secure final image</text>')
  };

  // ---- Hidden classes ----
  D["hidden-classes"] = {
    title: "Same shape → same hidden class → fast inline caches",
    svg: svg("720 210",
      box(40, 40, 280, 60, "{ x, y } added in order\\n→ hidden class C0→C1→C2", "rgba(63,174,80,0.12)") +
      box(40, 130, 280, 50, "{ y, x } different order\\n→ a DIFFERENT hidden class", "rgba(248,81,73,0.12)") +
      box(420, 40, 260, 60, "monomorphic call site\\n(one shape) = fastest", "rgba(63,174,80,0.14)") +
      box(420, 130, 260, 50, "megamorphic (many shapes)\\n= V8 gives up optimising", "rgba(248,81,73,0.12)") +
      arrow(320, 70, 420, 70) + arrow(320, 155, 420, 155))
  };

  Object.keys(D).forEach(function () {}); // no-op to keep diff readable
  window.DIAGRAMS = D;
})();
