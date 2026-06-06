registerLesson("01-modern-javascript", `
---
id: 01-modern-javascript
title: Modern JavaScript You'll Use Every Day
minutes: 22
level: beginner
objectives:
  - Use optional chaining and nullish coalescing to handle missing data
  - Use template literals, ternaries, and short-circuiting cleanly
  - Understand classes and when to prefer them over closures
project: true
---

# Modern JavaScript You'll Use Every Day

## Why this matters

A handful of newer JavaScript features show up in essentially every modern Node file. Knowing them turns clumsy, defensive code into clean, readable code. This lesson collects the high-value ones and ends with a project that pulls together everything from Module 1.

## Learning objectives

- Safely read possibly-missing data with **\`?.\`** and **\`??\`**.
- Use template literals and short-circuit logic idiomatically.
- Write a **class** and know when a closure is better.

## Optional chaining: ?.

Reaching into nested data that might not exist used to require ugly guards. \`?.\` short-circuits to \`undefined\` the moment something is missing:

~~~js run
const response = {
  user: {
    profile: { name: "Ada" }
    // note: no "address" key
  }
};

// Old, defensive way:
const cityOld = response.user && response.user.address && response.user.address.city;
console.log(cityOld); // undefined

// Modern way:
const city = response.user?.address?.city;
console.log(city); // undefined — no crash

// Works on method calls and array access too:
console.log(response.user?.profile?.name?.toUpperCase()); // "ADA"
console.log(response.user?.missingMethod?.()); // undefined (no error)
~~~

> [!PITFALL] ?. only guards against null and undefined
> \`a?.b\` checks if \`a\` is \`null\`/\`undefined\`. It does **not** guard against \`a\` being \`0\` or \`""\` (those are valid). And don't over-use it — if a value should *always* exist, let it throw loudly so you find the bug.

## Nullish coalescing: ??

\`??\` provides a fallback, but **only** when the left side is \`null\` or \`undefined\` — unlike \`||\`, which also triggers on \`0\`, \`""\`, and \`false\`:

~~~js run
const settings = { volume: 0, label: "" };

// || is wrong here: 0 and "" are falsy, so the defaults wrongly kick in
console.log(settings.volume || 10); // 10  😱 (we wanted 0!)
console.log(settings.label  || "untitled"); // "untitled" 😱

// ?? is right: only null/undefined trigger the default
console.log(settings.volume ?? 10);          // 0   ✅
console.log(settings.label  ?? "untitled");  // ""  ✅
console.log(settings.missing ?? "fallback"); // "fallback"
~~~

This pairs beautifully with \`?.\`:

~~~js run
const config = {};
const port = config.server?.port ?? 3000;
console.log(port); // 3000
~~~

## Template literals and short-circuiting

~~~js run
const user = "Ada";
const count = 3;

// Template literal — multi-line and interpolated
const message = \`Hi \${user},
you have \${count} new message\${count === 1 ? "" : "s"}.\`;
console.log(message);

// Short-circuit: && returns the right side if the left is truthy
const isAdmin = true;
isAdmin && console.log("Showing admin panel");

// || gives the first truthy value
const display = user || "Anonymous";
console.log(display);
~~~

## Classes

A **class** is a template for creating objects that share behaviour. Under the hood it's still JavaScript's prototype system, but the syntax is clean:

~~~js run
class Stack {
  #items = []; // # marks a TRULY private field

  push(item) {
    this.#items.push(item);
    return this; // returning this enables chaining
  }
  pop() {
    return this.#items.pop();
  }
  get size() {        // a getter — accessed like a property
    return this.#items.length;
  }
}

const s = new Stack();
s.push(1).push(2).push(3); // chained
console.log(s.size);  // 3
console.log(s.pop()); // 3
console.log(s.size);  // 2
// console.log(s.#items); // SyntaxError — genuinely private
~~~

> [!PRINCIPAL] Class vs closure — which to use?
> Both give you private state (\`#field\` in classes, captured variables in closures). Use a **class** when you'll create many instances and want inheritance or \`instanceof\` checks. Use a **closure/factory** for one-off objects or a more functional style. Neither is "better" — principal engineers choose based on the shape of the problem, not dogma.

## Project: a tiny data-transformation pipeline

Let's combine *everything* from Module 1 — arrays, objects, destructuring, modern syntax — into a small but real data pipeline. Imagine raw user records from an API; we want to clean, filter, and summarise them.

~~~js run
const rawUsers = [
  { name: "Ada Lovelace", age: 36, plan: { tier: "pro" } },
  { name: "Alan Turing",  age: 41, plan: null },        // missing plan
  { name: "Grace Hopper", age: 0,  plan: { tier: "pro" } }, // age unknown (0)
  { name: "Edsger D.",    age: 55, plan: { tier: "free" } }
];

// 1. Normalise each record safely with ?. and ??
const cleaned = rawUsers.map(({ name, age, plan }) => ({
  name,
  age: age ?? null,                 // keep 0? here we treat 0 as null via... actually keep as-is
  tier: plan?.tier ?? "free"        // default tier when plan is missing
}));

// 2. Keep only pro users
const proUsers = cleaned.filter(u => u.tier === "pro");

// 3. Summarise
const summary = {
  totalUsers: cleaned.length,
  proCount: proUsers.length,
  proNames: proUsers.map(u => u.name),
  averageAge: Math.round(
    cleaned.reduce((sum, u) => sum + (u.age ?? 0), 0) / cleaned.length
  )
};

console.log(JSON.stringify(summary, null, 2));
~~~

Run it, then try extending it:
- Add a \`filter\` step that removes users with \`age === 0\` (treat 0 as "unknown").
- Group users by \`tier\` using \`Object.groupBy\`.
- Sort \`proNames\` alphabetically.

<details>
<summary>One extension, solved</summary>

~~~js run
const rawUsers = [
  { name: "Ada", tier: "pro" }, { name: "Edsger", tier: "free" },
  { name: "Grace", tier: "pro" }
];
const byTier = Object.groupBy(rawUsers, u => u.tier);
console.log("pro:", byTier.pro.map(u => u.name).sort());
console.log("free:", byTier.free.map(u => u.name));
~~~
</details>

## What you learned

- \`?.\` safely reads nested data; \`??\` falls back only on \`null\`/\`undefined\` (use it over \`||\`).
- Template literals, short-circuiting, and ternaries keep code expressive.
- Classes (with \`#private\` fields) and closures both encapsulate state — choose by problem shape.
- You built a real **data pipeline** combining every Module 1 skill.

## Next steps

Module 1 is complete — you're fluent in the JavaScript that matters. Module 2 tackles the single most important Node skill: **asynchronous programming**. This is where Node truly comes alive.
`);
