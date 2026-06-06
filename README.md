# The Ultimate Node.js Course — Zero to Principal Engineer (L7+)

An interactive, self-contained, **plain-English** Node.js course that takes you from your
very first `console.log` to architecting distributed systems at a distinguished principal
engineer (Level 7+) standard — as of June 2026.

Every concept is narrated in depth. Most code examples are **live**: edit them and press
**▶ Run** to execute them right in your browser, powered by the same [Monaco editor](https://microsoft.github.io/monaco-editor/)
that drives VS Code. Node-specific examples (file system, HTTP servers, databases) ship with
narrated **Expected output** panels.

## Open it (no installation, no build step)

Just open **`index.html`** in any modern browser:

- **Double-click** `index.html`, **or**
- Serve the folder (recommended, avoids browser file:// quirks):

```bash
# Python (built in on macOS/Linux)
python3 -m http.server 8080
# then visit http://localhost:8080

# ...or with Node, if you have it:
npx serve .
```

> The page loads the Monaco editor from a pinned CDN, so the **first** view needs an internet
> connection. Everything else — navigation, lesson content, the code runner — works offline.

## What's inside

- **41 modules · 136 lessons · dozens of hands-on projects**, organised into six tiers:
  - **Tier 0 — Orientation:** setup, running Node, the REPL
  - **Tier 1 — Foundations:** JavaScript, async, the runtime, the event loop *(fully written)*
  - **Tier 2 — Core APIs:** modules, npm, fs, streams, buffers, events, process
  - **Tier 3 — Building Real Things:** CLIs, HTTP, frameworks, REST, SQL, ORMs, NoSQL, auth
  - **Tier 4 — Engineering Quality:** TypeScript, testing, the modern toolchain, monorepos
  - **Tier 5 — Advanced & Principal:** threads, real-time, queues, gRPC/GraphQL, microservices,
    performance, V8 internals, memory leaks, native addons, observability, Docker, CI/CD,
    Kubernetes, serverless/edge, scalability, security, and principal-level capstones
- A live **▶ Run** button for pure-JavaScript snippets (sandboxed in a Web Worker).
- **Next / Previous** navigation (or use the ← / → arrow keys), a collapsible sidebar,
  light/dark themes (`t` to toggle), and **automatic progress tracking** saved in your browser.

The **Foundations** tier (Modules 0–4) is authored in full depth. The remaining modules are
fully mapped in the curriculum with their learning objectives and projects, and render a
"coming soon" outline until their narrated content is filled in.

## Project layout

```
index.html              # the single-page shell (header, sidebar, content, nav)
assets/css/             # theme tokens, layout, and content styling
js/
  manifest.js           # the entire curriculum (single source of truth)
  router.js             # hash router + lazy lesson loading (file:// safe)
  markdown.js           # self-contained Markdown renderer
  monaco-loader.js      # Monaco integration (CDN + cross-origin worker proxy)
  runner.js             # sandboxed Web Worker code runner
  sidebar.js / nav.js / landing.js / progress.js / theme-toggle.js / app.js
content/lessons/<module>/<lesson>.js   # one file per lesson (registerLesson)
```

## Authoring a new lesson

1. Create `content/lessons/<module>/<n>-<slug>.js`:

   ```js
   registerLesson("my-lesson-id", `
   ---
   id: my-lesson-id
   title: My Lesson Title
   minutes: 20
   level: beginner
   ---

   # My Lesson Title

   Narrated prose here.

   ~~~js run
   console.log("a live, runnable example");
   ~~~
   `);
   ```

   Lesson content is Markdown inside a JS template literal. Use **`~~~` fences** for code
   blocks (so backticks don't clash with the template literal). Fence flags: `~~~js run`
   (live + runnable), `~~~js edit` (editable, no Run), `~~~js` (read-only walkthrough).
   Custom callouts: `> [!NOTE]`, `> [!WARNING]`, `> [!PITFALL]`, `> [!PRINCIPAL]`,
   `> [!OUTPUT]` (terminal-style expected output).

2. Register it in `js/manifest.js` with `status: "complete"` and its `file` path.

## License

MIT — learn freely, teach freely.
