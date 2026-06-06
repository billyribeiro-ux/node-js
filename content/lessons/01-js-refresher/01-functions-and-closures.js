registerLesson("01-functions-and-closures", `
---
id: 01-functions-and-closures
title: Functions, Scope & Closures
minutes: 26
level: beginner
objectives:
  - Write functions as declarations, expressions, and arrow functions
  - Understand scope and the difference between let, const, and var
  - Truly understand closures and use them to build private state
---

# Functions, Scope & Closures

## Why this matters

Functions are the unit of work in JavaScript, and **closures** are the single most important concept in the language. Closures power callbacks, event handlers, modules, and most of Node's design. Developers who don't really *get* closures hit a ceiling. By the end of this lesson, you'll get them completely.

## Learning objectives

- Write the three function styles and know when each is used.
- Understand **scope** and why \`let\`/\`const\` beat \`var\`.
- Explain a **closure** and use one to build private, encapsulated state.

## Three ways to write a function

~~~js run
// 1. Function declaration — hoisted (usable before its line)
function add(a, b) {
  return a + b;
}

// 2. Function expression — assigned to a variable
const subtract = function (a, b) {
  return a - b;
};

// 3. Arrow function — concise, and handles 'this' differently (more soon)
const multiply = (a, b) => a * b;

console.log(add(2, 3), subtract(5, 2), multiply(4, 6)); // 5 3 24
~~~

Arrow functions with a single expression have an **implicit return** — no \`return\` keyword needed. With a block body \`{ }\`, you must write \`return\` explicitly:

~~~js run
const double = n => n * 2;             // implicit return
const greet = name => {                // block body needs explicit return
  const message = "Hi, " + name;
  return message;
};
console.log(double(10), greet("Sam"));
~~~

## Scope: where a variable lives

**Scope** is the region of code where a variable is visible. \`let\` and \`const\` are **block-scoped** — they exist only inside the nearest \`{ }\`. The old \`var\` is **function-scoped** and leaks, which causes bugs.

~~~js run
function demo() {
  if (true) {
    let blockScoped = "I only exist in this if-block";
    var functionScoped = "I leak to the whole function";
  }
  // console.log(blockScoped); // would throw: not defined here
  console.log(functionScoped); // works — var leaked out
}
demo();
~~~

> [!PRINCIPAL] Never use var
> In modern Node, use \`const\` by default and \`let\` only when you must reassign. Reserve \`const\` for "this binding never changes" — it makes code easier to reason about. \`var\` has no place in code written today; its function-scoping and hoisting quirks only cause bugs.

The classic \`var\` trap, and its modern fix:

~~~js run
// With var, all three callbacks share ONE i (which ends at 3):
const withVar = [];
for (var i = 0; i < 3; i++) {
  withVar.push(() => i);
}
console.log(withVar.map(fn => fn())); // [3, 3, 3]  😱

// With let, each loop iteration gets its OWN i:
const withLet = [];
for (let j = 0; j < 3; j++) {
  withLet.push(() => j);
}
console.log(withLet.map(fn => fn())); // [0, 1, 2]  ✅
~~~

That second example is already a closure in action. Let's name it.

## Closures: the big idea

A **closure** is a function bundled together with the variables from where it was *defined*. The inner function "remembers" those variables even after the outer function has returned.

~~~js run
function makeCounter() {
  let count = 0;            // a private variable
  return function () {
    count = count + 1;     // the inner function "closes over" count
    return count;
  };
}

const counter = makeCounter();
console.log(counter()); // 1
console.log(counter()); // 2
console.log(counter()); // 3

const another = makeCounter(); // a fresh, independent count
console.log(another());        // 1
~~~

Read that slowly. \`makeCounter\` finished running, yet \`count\` is still alive — because the returned function holds onto it. Each call to \`makeCounter\` creates a *new* \`count\`. That's a closure: a private variable that only the returned function can touch.

> [!NOTE] Why this is powerful
> \`count\` is genuinely private. No code outside can read or corrupt it — there is no way to reach it except through the function we returned. This is **encapsulation** without any class or special syntax.

## Building private state with closures

Closures let you build objects with truly private internals:

~~~js run
function createBankAccount(startingBalance) {
  let balance = startingBalance; // private — no outside access

  return {
    deposit(amount) {
      if (amount <= 0) throw new Error("Deposit must be positive");
      balance += amount;
      return balance;
    },
    withdraw(amount) {
      if (amount > balance) throw new Error("Insufficient funds");
      balance -= amount;
      return balance;
    },
    getBalance() {
      return balance;
    }
  };
}

const account = createBankAccount(100);
console.log(account.deposit(50));   // 150
console.log(account.withdraw(30));  // 120
console.log(account.getBalance());  // 120
// account.balance is undefined — you literally cannot reach it:
console.log(account.balance);       // undefined
~~~

This pattern — a "factory function" returning methods that share private state — appears constantly in Node libraries.

### Exercise: a once function

Write \`once(fn)\` that returns a new function which calls \`fn\` only the *first* time, and returns the cached result forever after.

~~~js run
function once(fn) {
  // Your turn: use a closure to remember whether we've called fn yet.
  let called = false;
  let result;
  return function (...args) {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
}

const setup = once(() => {
  console.log("running expensive setup...");
  return 42;
});

console.log(setup()); // logs "running..." then 42
console.log(setup()); // just 42 — setup did NOT run again
console.log(setup()); // just 42
~~~

<details>
<summary>Why does this work?</summary>

\`called\` and \`result\` live in the closure created by \`once\`. They persist between calls to the returned function, so after the first call we skip \`fn\` and return the cached \`result\`. Node's own \`events.once\` and countless libraries use exactly this idea.
</details>

## Pitfalls

> [!PITFALL] Creating closures in a loop with var
> We saw it above: \`var\` in a loop shares one variable across every closure. Always use \`let\` (or \`const\`) in loops so each iteration captures its own binding.

## What you learned

- Three function styles: declaration (hoisted), expression, and arrow (implicit return).
- \`let\`/\`const\` are block-scoped; never use \`var\`.
- A **closure** is a function plus the variables it was defined with — it remembers them.
- Closures give you **private state** and power factory functions, callbacks, and modules.

## Next steps

Next: objects, arrays, and the destructuring/spread syntax you'll use in every file you ever write.
`);
