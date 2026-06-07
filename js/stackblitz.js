/* =========================================================================
   stackblitz.js — "Open in StackBlitz" launches a real Node sandbox in a new
   tab (real npm, real fs/http, real servers) for the Node-only code that the
   in-browser JS runner can't execute. Works by POSTing a tiny project to
   StackBlitz's documented form endpoint — no SDK/dependency needed.
   Exposes window.StackBlitz.
   ========================================================================= */
(function () {
  "use strict";

  var ENDPOINT = "https://stackblitz.com/run";

  function field(form, name, value) {
    var i = document.createElement("input");
    i.type = "hidden";
    i.name = name;
    i.value = value;
    form.appendChild(i);
  }

  /**
   * open({ title, description, files: { "index.js": "...", "package.json": "..." } })
   * Opens a new tab with a runnable Node project containing those files.
   */
  function open(opts) {
    var files = opts.files || {};
    var form = document.createElement("form");
    form.method = "post";
    form.action = ENDPOINT + "?file=" + encodeURIComponent(Object.keys(files)[0] || "index.js");
    form.target = "_blank";
    form.style.display = "none";

    field(form, "project[title]", opts.title || "Node.js — Ultimate Node Course");
    field(form, "project[description]", opts.description || "Runnable example from The Ultimate Node.js Course");
    field(form, "project[template]", "node");
    Object.keys(files).forEach(function (path) {
      field(form, "project[files][" + path + "]", files[path]);
    });

    document.body.appendChild(form);
    form.submit();
    setTimeout(function () { form.remove(); }, 1000);
  }

  // Build a minimal package.json for a snippet (ESM, modern Node).
  function packageJson(name) {
    return JSON.stringify({
      name: name || "node-course-snippet",
      type: "module",
      private: true,
      scripts: { start: "node index.js" },
      engines: { node: ">=22" }
    }, null, 2);
  }

  /** Convenience: open a single JS snippet as index.js in a Node sandbox. */
  function openSnippet(code, title) {
    open({
      title: title || "Node.js snippet",
      files: {
        "index.js": "// From The Ultimate Node.js Course — runs on real Node here.\n\n" + code,
        "package.json": packageJson()
      }
    });
  }

  window.StackBlitz = { open: open, openSnippet: openSnippet, packageJson: packageJson };
})();
