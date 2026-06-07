registerQuiz("00-how-this-course-works", [
  {
    q: "How many tiers does this course contain, and what does completing all of them lead to?",
    options: [
      "Four tiers, leading to senior engineer",
      "Six tiers, leading to distinguished principal engineer",
      "Six tiers, leading to full-stack developer",
      "Eight tiers, leading to principal engineer"
    ],
    answer: 1,
    explain: "The course is organised into six tiers (Tier 0 through Tier 5), taking you from orientation all the way to advanced and principal-level skills."
  },
  {
    q: "What is the difference between a live 'Run' code box and a read-only code box in this course?",
    options: [
      "Live boxes run Node.js on the server; read-only boxes run in the browser",
      "Live boxes execute pure JavaScript in the browser; read-only boxes show Node-specific code with expected output",
      "Live boxes require Node to be installed; read-only boxes work without installation",
      "There is no difference — both execute the same JavaScript"
    ],
    answer: 1,
    explain: "Live boxes execute pure JavaScript safely in your browser. Read-only boxes show code that relies on Node-specific features (like reading files or opening sockets) which the browser cannot do, and display an Expected output panel instead."
  },
  {
    q: "According to the lesson, what is the single habit that most distinguishes a principal engineer from a mid-level engineer?",
    options: [
      "Reading as many books and articles as possible",
      "Memorising language specifications and APIs",
      "Thousands of hours of deliberate practice by writing, breaking, and fixing code",
      "Attending conferences and networking regularly"
    ],
    answer: 2,
    explain: "The lesson states that the gap between mid-level and principal engineers is mostly thousands of hours of deliberate practice. Reading teaches recognition, but writing code teaches production — so you must type out, run, break, and fix every concept."
  }
]);
registerResources("00-how-this-course-works", [
  { title: "Node.js Official Documentation", url: "https://nodejs.org/en/docs" },
  { title: "MDN JavaScript Guide", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide" },
  { title: "Node.js Release Schedule (LTS vs Current)", url: "https://nodejs.org/en/about/previous-releases" }
]);

registerQuiz("00-installing-node", [
  {
    q: "Why do professionals use a version manager (fnm, nvm, or Volta) instead of installing Node directly from nodejs.org?",
    options: [
      "Version managers are faster to download",
      "The nodejs.org installer is not available on all platforms",
      "Real projects often require different Node versions; a version manager lets you switch in one command",
      "Version managers automatically update Node daily"
    ],
    answer: 2,
    explain: "Different projects pin different Node versions. A version manager lets you install multiple versions side by side and switch with a single command, preventing 'works on my machine' headaches."
  },
  {
    q: "As of mid-2026, which Node release line should you run in production and why?",
    options: [
      "Current, because it has the newest features",
      "LTS (Node 24), because it is stable and supported for about three years",
      "LTS (Node 20), because it is the most widely tested",
      "Any version, because all versions receive the same support"
    ],
    answer: 1,
    explain: "LTS (Long-Term Support) releases are even-numbered majors supported for roughly three years. As of mid-2026, Node 24 is the active LTS, giving a good balance of modern features and stability."
  },
  {
    q: "What is the purpose of adding a '.nvmrc' or '.node-version' file to a project?",
    options: [
      "It speeds up npm install by caching packages",
      "It pins the Node version for the project so all teammates use the same version automatically",
      "It configures the Node debugger",
      "It replaces package.json for version management"
    ],
    answer: 1,
    explain: "A '.nvmrc' (or '.node-version') file containing just the version number lets fnm/nvm automatically switch to the correct Node version when you run them with no argument, ensuring reproducibility across the whole team."
  }
]);
registerResources("00-installing-node", [
  { title: "fnm (Fast Node Manager) GitHub", url: "https://github.com/Schniz/fnm" },
  { title: "nvm (Node Version Manager) GitHub", url: "https://github.com/nvm-sh/nvm" },
  { title: "Volta: JavaScript Tool Manager", url: "https://volta.sh" },
  { title: "Node.js Release Working Group", url: "https://github.com/nodejs/release" },
  { title: "Node.js Downloads Page", url: "https://nodejs.org/en/download" }
]);

registerQuiz("00-your-first-program", [
  {
    q: "What does REPL stand for, and what is it best used for?",
    options: [
      "Run-Evaluate-Print-Loop; best for writing production code",
      "Read-Eval-Print Loop; best for quick experiments and one-off checks",
      "Read-Execute-Print Loop; best for running files",
      "Run-Eval-Produce-Loop; best for automated testing"
    ],
    answer: 1,
    explain: "REPL stands for Read-Eval-Print Loop. It reads what you type, evaluates it, prints the result, and loops. It is ideal for quick experiments like 'what does this function return?' but not for building programs, since you cannot save its state."
  },
  {
    q: "What is the difference between 'node --eval' and 'node --print' (or '-p')?",
    options: [
      "Both behave identically",
      "'--eval' runs code and auto-prints the result; '--print' runs code without printing",
      "'--eval' runs code but does not auto-print; '--print' evaluates the expression AND prints its result",
      "'--eval' only works with file paths; '--print' works with inline strings"
    ],
    answer: 2,
    explain: "'--eval' (or '-e') executes the given string but does not automatically print the result — you must use console.log yourself. '--print' (or '-p') evaluates the expression and automatically prints its return value."
  },
  {
    q: "In the 'greeter.js' project, which Node built-in module is used to read information such as the username, platform, and total memory?",
    options: [
      "node:process",
      "node:sys",
      "node:os",
      "node:fs"
    ],
    answer: 2,
    explain: "The greeter script imports 'node:os', which provides os.userInfo(), os.platform(), os.cpus(), and os.totalmem(). The 'process' object is also used for process.version, but os is the primary module for machine details."
  }
]);
registerResources("00-your-first-program", [
  { title: "Node.js REPL Documentation", url: "https://nodejs.org/api/repl.html" },
  { title: "Node.js CLI Options Reference", url: "https://nodejs.org/api/cli.html" },
  { title: "Node.js 'os' Module Documentation", url: "https://nodejs.org/api/os.html" },
  { title: "Node.js 'process' Object Documentation", url: "https://nodejs.org/api/process.html" }
]);
