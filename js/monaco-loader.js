/* =========================================================================
   monaco-loader.js — load Monaco from a pinned CDN and turn <pre data-monaco>
   placeholders into real editors. Exposes window.MonacoKit.

   Two gotchas handled here:
   1) Monaco's language workers are loaded cross-origin from the CDN; browsers
      block that unless we hand Monaco a same-origin *proxy* worker (a Blob URL
      that importScripts() the real CDN worker). Without this, IntelliSense and
      type-checking spam CORS errors.
   2) Editors are auto-sized to their content (capped) so a page full of small
      snippets does not reserve giant blank rectangles.
   ========================================================================= */
(function () {
  "use strict";

  var CDN = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs";
  var ready = null;

  function load() {
    if (ready) return ready;
    ready = new Promise(function (resolve, reject) {
      if (!window.require) { reject(new Error("Monaco AMD loader not present")); return; }

      window.require.config({ paths: { vs: CDN } });

      // (1) Same-origin proxy worker so cross-origin CDN workers are allowed.
      window.MonacoEnvironment = {
        getWorkerUrl: function () {
          var proxy = [
            "self.MonacoEnvironment = { baseUrl: '" + CDN + "/' };",
            "importScripts('" + CDN + "/base/worker/workerMain.js');"
          ].join("\n");
          return URL.createObjectURL(new Blob([proxy], { type: "text/javascript" }));
        }
      };

      window.require(["vs/editor/editor.main"], function () {
        // Relax the TS/JS language service: these are teaching snippets, not a
        // real project, so we silence "cannot find module" / top-level await noise.
        try {
          var ts = window.monaco.languages.typescript;
          ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
          ts.typescriptDefaults.setCompilerOptions({
            target: ts.ScriptTarget.ESNext,
            allowNonTsExtensions: true,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            module: ts.ModuleKind.ESNext,
            noEmit: true,
            allowJs: true
          });
        } catch (e) { /* non-fatal */ }
        resolve(window.monaco);
      }, reject);
    });
    return ready;
  }

  var instances = []; // {editor, lang} for theme re-sync

  function autoHeight(editor, host, maxLines) {
    function update() {
      var lineCount = editor.getModel() ? editor.getModel().getLineCount() : 1;
      var lines = Math.min(Math.max(lineCount, 1), maxLines || 30);
      var h = lines * 19 + 16; // lineHeight ~19px + padding
      host.style.height = h + "px";
      editor.layout();
    }
    update();
    editor.onDidChangeModelContent(update);
  }

  /**
   * Create an editor inside a host element.
   * opts: { code, language, readOnly, maxLines }
   */
  function create(host, opts) {
    return load().then(function (monaco) {
      var editor = monaco.editor.create(host, {
        value: opts.code,
        language: opts.language || "javascript",
        theme: window.Theme ? window.Theme.monaco() : "vs-dark",
        readOnly: !!opts.readOnly,
        domReadOnly: !!opts.readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        scrollbar: { alwaysConsumeMouseWheel: false },
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 13.5,
        lineHeight: 19,
        tabSize: 2,
        renderLineHighlight: opts.readOnly ? "none" : "line",
        padding: { top: 8, bottom: 8 },
        fixedOverflowWidgets: true,
        contextmenu: false,
        wordWrap: "off"
      });
      autoHeight(editor, host, opts.maxLines);
      instances.push({ editor: editor, host: host });
      return editor;
    });
  }

  // Keep every editor's theme in lockstep with the page theme.
  if (window.Theme) {
    window.Theme.onChange(function () {
      if (window.monaco) window.monaco.editor.setTheme(window.Theme.monaco());
    });
  }

  /** Dispose all editors (called by the router before rendering a new lesson). */
  function disposeAll() {
    instances.forEach(function (i) { try { i.editor.dispose(); } catch (e) {} });
    instances = [];
  }

  window.MonacoKit = { load: load, create: create, disposeAll: disposeAll };
})();
