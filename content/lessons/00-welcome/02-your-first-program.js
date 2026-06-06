registerLesson("00-your-first-program", `
---
id: 00-your-first-program
title: Your First Program
minutes: 18
level: beginner
objectives:
  - Run JavaScript in the Node REPL for instant experiments
  - Run a script from a file the way real programs ship
  - Use --eval and --print for one-off commands
  - Build and run your first real script three different ways
---

# Your First Program: REPL, Files & --eval

## Why this matters

There are three ways to run code with Node, and each has a purpose. The **REPL** is for quick experiments. **Files** are how real programs ship. **\`--eval\`** is for tiny one-liners and shell scripting. A professional reaches for the right one without thinking. By the end of this lesson you'll have run code all three ways and built your first genuinely useful script.

## Learning objectives

- Use the **REPL** to test ideas instantly.
- Run a program from a **\`.js\` file**.
- Use **\`--eval\`** and **\`--print\`** for quick commands.
- Build a small "system greeter" script.

## Way 1 — The REPL (your instant playground)

REPL stands for **Read-Eval-Print Loop**. Type \`node\` with no arguments and you get an interactive prompt that reads what you type, evaluates it, prints the result, and loops:

~~~bash
node
~~~

Now you're inside Node. Type an expression and press Enter:

> [!OUTPUT]
> > 2 + 2
> 4
> > const greeting = "hello"
> undefined
> > greeting.toUpperCase()
> 'HELLO'
> > .exit

A few things to notice:
- Node prints the **result** of each expression automatically (that's the "Print" in REPL).
- \`const greeting = ...\` prints \`undefined\` because an *assignment statement* has no value — but the variable is now remembered.
- Type \`.exit\` (or press Ctrl+D) to leave.

> [!NOTE] The REPL is for *learning*, not *building*
> It's perfect for "what does this function return again?" moments. But you can't save it, so real programs live in files.

You can experience a REPL-like loop right here in your browser. Each \`console.log\` is like pressing Enter in the REPL:

~~~js run
console.log(2 + 2);
const greeting = "hello";
console.log(greeting.toUpperCase());
console.log(typeof greeting);
~~~

## Way 2 — Run a file (how real programs ship)

Create a file called \`hello.js\` with this content:

~~~js
console.log("Hello from a real file!");

const now = new Date();
console.log("The time is:", now.toLocaleTimeString());
~~~

Then run it from your terminal:

~~~bash
node hello.js
~~~

> [!OUTPUT]
> Hello from a real file!
> The time is: 3:42:18 PM

That's it — that's how every Node program in the world starts. A file, and \`node\` in front of it.

> [!PRINCIPAL] --watch: auto-rerun on save
> Modern Node has a built-in watch mode. Run \`node --watch hello.js\` and Node re-executes the file every time you save it. No extra tools needed — this used to require a package called *nodemon*. We'll use \`--watch\` constantly later in the course.

## Way 3 — --eval and --print (one-liners)

Sometimes you just want one line of JavaScript without creating a file — handy in shell scripts:

~~~bash
# --eval (or -e) runs code but doesn't auto-print
node --eval "console.log(1 + 1)"

# --print (or -p) auto-prints the result of the expression
node -p "process.platform"
node -p "Math.max(3, 9, 2)"
~~~

> [!OUTPUT]
> 2
> linux
> 9

Notice \`process.platform\` — that's your first taste of Node's **\`process\`** object, which knows everything about the running program and the machine it's on. We'll explore it deeply in Tier 1.

## Project: your first real script

Let's build a **system greeter** — a script that prints a friendly, personalised banner. This uses Node's built-in \`os\` module, so it's a read-only example here (a browser has no operating system to inspect), but you can copy it into a file and run it for real.

~~~js
// greeter.js — run with: node greeter.js
import os from "node:os";

const user = os.userInfo().username;
const platform = os.platform();          // 'darwin', 'linux', 'win32'
const cpus = os.cpus().length;            // number of CPU cores
const memGB = (os.totalmem() / 1e9).toFixed(1);

console.log("============================================");
console.log("  Welcome back, " + user + "!");
console.log("--------------------------------------------");
console.log("  Platform : " + platform);
console.log("  CPU cores: " + cpus);
console.log("  Memory   : " + memGB + " GB");
console.log("  Node     : " + process.version);
console.log("============================================");
~~~

When you run it on your own machine, you'll see something like:

> [!OUTPUT]
> ============================================
>   Welcome back, ada!
> --------------------------------------------
>   Platform : linux
>   CPU cores: 8
>   Memory   : 16.6 GB
>   Node     : v24.2.0
> ============================================

### Make it three ways

Prove you understand all three execution methods:

1. **File:** save it as \`greeter.js\` and run \`node greeter.js\`.
2. **Watch:** run \`node --watch greeter.js\` and edit the banner — watch it re-run.
3. **One-liner:** run \`node -p "require('node:os').userInfo().username"\` to print just your username.

### Exercise: the logic, in the browser

The banner-building logic is plain JavaScript. Practice it here without the \`os\` module by using fake values:

~~~js run
// Build the banner string yourself.
const user = "ada";
const platform = "linux";
const cores = 8;

const line = "============================================";
console.log(line);
console.log("  Welcome back, " + user + "!");
console.log("  Platform: " + platform + " | Cores: " + cores);
console.log(line);
~~~

<details>
<summary>Challenge: use a template literal instead of + concatenation</summary>

~~~js run
const user = "ada";
const platform = "linux";
const cores = 8;

// Template literals use backticks and \${...} for interpolation.
console.log(\`  Welcome back, \${user}! Running \${platform} on \${cores} cores.\`);
~~~

Template literals are cleaner than gluing strings with \`+\`. You'll use them everywhere.
</details>

## Pitfalls

> [!PITFALL] Forgetting the file extension or the word "node"
> It's \`node hello.js\`, not \`hello.js\` (that would ask your OS to run the file directly) and not \`node hello\` (Node won't guess the extension for a plain script path). Type the whole thing.

## What you learned

- The **REPL** (\`node\`) is for instant experiments.
- Running a **file** (\`node file.js\`) is how real programs ship — and \`--watch\` re-runs on save.
- **\`--eval\`** and **\`--print\`** handle quick one-liners.
- You met the **\`process\`** and **\`os\`** objects, your window into the running machine.

## Next steps

You can now run Node every way that matters. Tier 1 begins with a JavaScript refresher — the language Node is built on. Even if you know some JavaScript, don't skip it: we focus on exactly the parts that make Node click.
`);
