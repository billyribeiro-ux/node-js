registerQuiz("05-cjs-vs-esm", [
  {
    q: "What is the key behavioural difference between 'require()' in CommonJS and 'import' in ES Modules?",
    options: [
      "require() is asynchronous; import is synchronous",
      "require() is synchronous and evaluated at runtime; import is asynchronous and statically analysed before execution",
      "require() supports tree-shaking; import does not",
      "There is no difference — they are interchangeable in modern Node"
    ],
    answer: 1,
    explain: "require() runs synchronously, stopping and loading the file immediately. ES Module import statements are statically analysed before the module runs, enabling tree-shaking and top-level await. This is why import must be at the top level, not inside an if statement — unlike dynamic import(), which returns a promise."
  },
  {
    q: "In CommonJS, what is the difference between 'module.exports = something' and 'exports.name = something'?",
    options: [
      "They are identical and can be used interchangeably",
      "'exports' is a reference to 'module.exports'; reassigning 'exports = ...' breaks the link and exports nothing",
      "'module.exports' can only export functions, while 'exports' can export objects",
      "'exports' is used for named exports and 'module.exports' for default exports, just like ESM"
    ],
    answer: 1,
    explain: "'exports' starts as a reference to 'module.exports'. Assigning a new value to 'exports' (e.g. exports = fn) breaks that reference — module.exports is still the empty original object. Always use 'module.exports = ...' to replace the whole export, and 'exports.name = ...' only to add individual properties."
  },
  {
    q: "What is the ESM equivalent of the CommonJS '__dirname' variable, available in modern Node (21.2+)?",
    options: [
      "process.cwd()",
      "import.meta.dirname",
      "import.dirname",
      "new URL('.', import.meta.url).pathname"
    ],
    answer: 1,
    explain: "In ESM, 'import.meta.dirname' (Node 21.2+) gives the directory of the current module, equivalent to '__dirname' in CommonJS. For older Node versions you derive it from 'fileURLToPath(import.meta.url)' and 'path.dirname'. 'process.cwd()' is the working directory, which may differ."
  }
]);

registerResources("05-cjs-vs-esm", [
  { title: "Node.js: ES Modules Documentation", url: "https://nodejs.org/api/esm.html" },
  { title: "Node.js: CommonJS Modules Documentation", url: "https://nodejs.org/api/modules.html" },
  { title: "Node.js: Differences between ES Modules and CommonJS", url: "https://nodejs.org/api/esm.html#differences-between-es-modules-and-commonjs" },
  { title: "MDN: import statement", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import" },
  { title: "MDN: import() dynamic import", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import" }
]);

registerQuiz("05-package-json", [
  {
    q: "In a package.json 'exports' condition object, why does the order of condition keys matter?",
    options: [
      "Keys are sorted alphabetically by Node before evaluation",
      "Node evaluates conditions in insertion order and picks the first matching one, so a misplaced 'default' can make specific conditions unreachable",
      "Key order only matters for bundlers, not for Node itself",
      "Node randomly picks among matching conditions to distribute load"
    ],
    answer: 1,
    explain: "Node walks the condition keys in the order they appear in the object and takes the first match. If 'default' appears before 'import', it would always match and the 'import' condition would never be reached. Always order from most-specific to least-specific, with 'default' last."
  },
  {
    q: "What is the purpose of the 'imports' field in package.json?",
    options: [
      "It declares which npm packages the project depends on",
      "It defines package-private '#alias' paths usable only from inside the same package, without needing a bundler",
      "It is a shorthand for the 'dependencies' field",
      "It maps external package names to local files for offline development"
    ],
    answer: 1,
    explain: "The 'imports' field defines internal '#alias' shortcuts (e.g. '#config' -> './src/config.js') that only code inside the same package can use. It eliminates long relative '../../../' paths and is resolved natively by Node — no bundler required. Consumers cannot access these paths."
  },
  {
    q: "Once an 'exports' field is present in package.json, what happens to file paths that are not listed in it?",
    options: [
      "They are accessible as before — exports is purely additive",
      "They are blocked: Node throws ERR_PACKAGE_PATH_NOT_EXPORTED for any import path not explicitly listed",
      "They fall back to the 'main' field",
      "They are available only from CommonJS, not ESM"
    ],
    answer: 1,
    explain: "'exports' is strict — once present, it is the only way into the package. Any subpath not listed throws ERR_PACKAGE_PATH_NOT_EXPORTED, even if the file physically exists. This is intentional (clean public API) but is a breaking change for consumers relying on deep imports."
  }
]);

registerResources("05-package-json", [
  { title: "Node.js: Package Exports Documentation", url: "https://nodejs.org/api/packages.html#exports" },
  { title: "Node.js: Package Imports (imports field)", url: "https://nodejs.org/api/packages.html#imports" },
  { title: "Node.js: Conditional Exports", url: "https://nodejs.org/api/packages.html#conditional-exports" },
  { title: "Node.js: Packages Introduction", url: "https://nodejs.org/api/packages.html" }
]);

registerQuiz("05-dual-packages", [
  {
    q: "What is the 'dual-package hazard' in Node.js?",
    options: [
      "A package that installs two different versions of itself at the same time",
      "When both the ESM and CJS builds of the same package are loaded in a single process, causing module-level state to be split across two independent instances",
      "The risk of naming conflicts between a package's public and private exports",
      "A build error that occurs when both .mjs and .cjs files exist in the same directory"
    ],
    answer: 1,
    explain: "The dual-package hazard occurs when a single application's dependency graph triggers loading of both the ESM and CJS copies of the same package. Each copy is a separate module instance, so singletons diverge and 'instanceof' checks fail. Stateless libraries are unaffected; stateful ones must use the CJS-core/ESM-wrapper pattern."
  },
  {
    q: "What does 'import.meta.url' contain when accessed inside an ES Module file?",
    options: [
      "The HTTP URL of the server the module was downloaded from",
      "The 'file://' URL of the current module file on the local filesystem",
      "The base URL of the project's package.json",
      "The URL of the last dynamically imported module"
    ],
    answer: 1,
    explain: "'import.meta.url' is a 'file://' URL pointing to the current module file (e.g. 'file:///home/user/project/src/server.mjs'). It is the ESM equivalent of CJS's '__filename' and is the starting point for deriving 'import.meta.dirname' or constructing absolute paths."
  },
  {
    q: "When Node resolves a bare specifier like 'lodash', in which order does it search for the package?",
    options: [
      "It checks only the root node_modules directory",
      "It walks up from the importing file's directory, checking node_modules at each level until the filesystem root",
      "It checks the global node_modules first, then the local project",
      "It uses the order declared in package.json dependencies"
    ],
    answer: 1,
    explain: "Node performs a node_modules walk: starting in the directory of the importing file, it looks for 'node_modules/<specifier>'. If not found, it goes up one directory and tries again, repeating until the root. The first match wins, which is why a nested node_modules can shadow a parent one."
  }
]);

registerResources("05-dual-packages", [
  { title: "Node.js: Dual CommonJS/ESM Packages", url: "https://nodejs.org/api/packages.html#dual-commonjses-module-packages" },
  { title: "Node.js: import.meta", url: "https://nodejs.org/api/esm.html#importmeta" },
  { title: "Node.js: Module Resolution Algorithm", url: "https://nodejs.org/api/esm.html#resolution-algorithm-specification" },
  { title: "Node.js: Packages — Determining Module System", url: "https://nodejs.org/api/packages.html#determining-module-system" }
]);

registerQuiz("05-loaders", [
  {
    q: "In which thread do Node.js customisation hooks (registered via 'module.register') execute?",
    options: [
      "The main application thread, synchronously before each import",
      "A separate hooks worker thread, isolated from the main thread",
      "The libuv thread pool threads",
      "A dedicated V8 isolate with no thread overhead"
    ],
    answer: 1,
    explain: "Hooks registered with module.register run in a dedicated hooks worker thread, isolated from the main application. This prevents a buggy hook from corrupting the app's heap and avoids circular deadlocks when hooks themselves need to import modules."
  },
  {
    q: "What is the purpose of the 'resolve' hook in Node's module customisation pipeline?",
    options: [
      "It reads and transforms the source code of a module before execution",
      "It intercepts import specifiers before Node touches the filesystem and can rewrite them to different URLs",
      "It validates that a module's exports match its TypeScript types",
      "It caches resolved module paths to speed up subsequent imports"
    ],
    answer: 1,
    explain: "The resolve hook receives a specifier (what was written in the import statement) and returns a URL for Node to use. It runs before any filesystem access, making it the right place to rewrite path aliases, redirect bare specifiers, or enforce import policies."
  },
  {
    q: "If you call 'module.register' after some modules have already been imported, which imports will the hooks affect?",
    options: [
      "All imports in the process, including those already loaded",
      "Only imports that happen after the register() call",
      "Only imports from files in the same directory",
      "No imports — module.register only affects future Node processes"
    ],
    answer: 1,
    explain: "module.register only applies to imports that occur after it is called. Already-loaded modules are cached and will not be re-processed. This is why register must be called at the very top of the entry-point file, before any application imports."
  }
]);

registerResources("05-loaders", [
  { title: "Node.js: Customization Hooks (module.register)", url: "https://nodejs.org/api/module.html#customization-hooks" },
  { title: "Node.js: Loaders API", url: "https://nodejs.org/api/esm.html#loaders" },
  { title: "Node.js: module.register()", url: "https://nodejs.org/api/module.html#moduleregisterspecifier-parenturl-options" },
  { title: "tsx — TypeScript Execute (uses loaders)", url: "https://tsx.is" }
]);
