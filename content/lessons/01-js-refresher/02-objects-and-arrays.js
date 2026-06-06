registerLesson("01-objects-and-arrays", `
---
id: 01-objects-and-arrays
title: Objects, Arrays, Destructuring & Spread
minutes: 24
level: beginner
objectives:
  - Work fluently with objects and arrays
  - Use destructuring to pull values out cleanly
  - Use spread/rest to copy, merge, and collect
---

# Objects, Arrays, Destructuring & Spread

## Why this matters

Data in Node is overwhelmingly objects and arrays — JSON from an API, rows from a database, options passed to a function. The modern syntax for handling them (destructuring, spread, rest) is everywhere in real Node code. Fluency here makes you faster and your code cleaner.

## Learning objectives

- Read and modify objects and arrays confidently.
- Use **destructuring** to extract values.
- Use **spread** and **rest** to copy, merge, and gather.

## Objects: keyed collections

~~~js run
const user = {
  name: "Ada",
  age: 36,
  "favourite language": "JavaScript" // keys with spaces need quotes
};

console.log(user.name);                  // dot access
console.log(user["favourite language"]); // bracket access for tricky keys

user.age = 37;          // update
user.role = "engineer"; // add
delete user.age;        // remove
console.log(user);

// Useful object helpers:
console.log(Object.keys(user));    // ["name","favourite language","role"]
console.log(Object.values(user));  // ["Ada","JavaScript","engineer"]
console.log(Object.entries(user)); // [["name","Ada"], ...]
~~~

> [!NOTE] Shorthand properties
> When a variable name matches the key, you can omit the value: \`{ name }\` means \`{ name: name }\`. You'll see this constantly.

~~~js run
const name = "Ada";
const role = "engineer";
const person = { name, role }; // shorthand
console.log(person); // { name: "Ada", role: "engineer" }
~~~

## Arrays: ordered collections

~~~js run
const nums = [10, 20, 30];

console.log(nums.length);     // 3
console.log(nums[0]);         // 10
console.log(nums.at(-1));     // 30  — .at(-1) reads from the end

nums.push(40);                // add to end -> [10,20,30,40]
nums.unshift(5);              // add to start -> [5,10,20,30,40]
const last = nums.pop();      // remove & return last (40)
console.log(nums, "removed", last);

console.log(nums.includes(20));      // true
console.log(nums.indexOf(20));       // 2
~~~

The transformation methods are the heart of day-to-day code:

~~~js run
const prices = [10, 25, 30, 5, 50];

console.log(prices.map(p => p * 1.1));          // add 10% to each
console.log(prices.filter(p => p >= 25));       // keep big ones
console.log(prices.reduce((sum, p) => sum + p, 0)); // total
console.log(prices.find(p => p > 20));          // first match: 25
console.log(prices.some(p => p > 40));          // true (at least one)
console.log(prices.every(p => p > 0));          // true (all)
console.log([...prices].sort((a, b) => a - b)); // sorted copy
~~~

> [!PITFALL] sort() mutates and sorts as strings by default
> \`array.sort()\` changes the original array *and* compares items as **strings** unless you pass a comparator. \`[10, 9, 100].sort()\` gives \`[10, 100, 9]\`! Always pass \`(a, b) => a - b\` for numbers, and spread first (\`[...arr].sort(...)\`) if you want to keep the original.

## Destructuring: unpack with one line

Destructuring pulls values out of objects and arrays into variables:

~~~js run
const config = { host: "localhost", port: 5432, secure: true };

// Object destructuring — by key name
const { host, port } = config;
console.log(host, port); // localhost 5432

// Rename + provide defaults
const { secure: isSecure, timeout = 3000 } = config;
console.log(isSecure, timeout); // true 3000  (timeout used its default)

// Array destructuring — by position
const colours = ["red", "green", "blue"];
const [first, , third] = colours; // skip the middle with an empty slot
console.log(first, third); // red blue
~~~

Destructuring in **function parameters** is one of the cleanest patterns in Node — it gives you named options:

~~~js run
function createServer({ port = 3000, host = "0.0.0.0", https = false } = {}) {
  console.log(\`Starting on \${host}:\${port} (https: \${https})\`);
}

createServer({ port: 8080 });        // host & https use defaults
createServer();                      // everything defaults (note the = {} !)
~~~

> [!PRINCIPAL] That trailing = {} matters
> The \`= {}\` default on the whole parameter lets \`createServer()\` be called with **no arguments**. Without it, destructuring \`undefined\` throws. This "options object with defaults" pattern is how most Node libraries accept configuration.

## Spread and rest: the ... operator

The same \`...\` does two opposite jobs depending on context.

**Spread** expands a collection *out*:

~~~js run
const a = [1, 2, 3];
const b = [4, 5, 6];
console.log([...a, ...b]);        // [1,2,3,4,5,6]  — merge arrays
console.log(Math.max(...a));      // 3  — spread into arguments

const base = { theme: "dark", lang: "en" };
const override = { lang: "fr" };
console.log({ ...base, ...override }); // { theme:"dark", lang:"fr" } — later wins
~~~

**Rest** gathers leftovers *in*:

~~~js run
// Gather remaining function arguments into an array
function sum(...numbers) {
  return numbers.reduce((t, n) => t + n, 0);
}
console.log(sum(1, 2, 3, 4)); // 10

// Gather remaining object properties
const { name, ...rest } = { name: "Ada", age: 36, role: "eng" };
console.log(name); // Ada
console.log(rest); // { age: 36, role: "eng" }
~~~

> [!WARNING] Spread is a shallow copy
> \`{ ...obj }\` copies the top level only. Nested objects are still shared by reference. For a true deep copy of plain data, use \`structuredClone(obj)\` — a built-in in modern Node.

~~~js run
const original = { user: { name: "Ada" } };
const shallow = { ...original };
shallow.user.name = "Changed";
console.log(original.user.name); // "Changed" 😱 — nested object was shared

const deep = structuredClone(original);
deep.user.name = "Safe";
console.log(original.user.name); // still "Changed" from before, not "Safe"
~~~

### Exercise: merge with defaults

Write \`withDefaults(options)\` that fills in missing settings.

~~~js run
const DEFAULTS = { retries: 3, timeout: 5000, verbose: false };

function withDefaults(options = {}) {
  return { ...DEFAULTS, ...options };
}

console.log(withDefaults());                    // all defaults
console.log(withDefaults({ timeout: 1000 }));   // timeout overridden
console.log(withDefaults({ verbose: true, retries: 5 }));
~~~

## Mini-project: group records

Given an array of orders, group their totals by customer — a real task you'll do often.

~~~js run
const orders = [
  { customer: "Ada", total: 30 },
  { customer: "Sam", total: 20 },
  { customer: "Ada", total: 45 },
  { customer: "Sam", total: 10 }
];

const totals = orders.reduce((acc, order) => {
  acc[order.customer] = (acc[order.customer] || 0) + order.total;
  return acc;
}, {});

console.log(totals); // { Ada: 75, Sam: 30 }

// Modern alternative: Object.groupBy (built into recent Node/JS)
const grouped = Object.groupBy(orders, o => o.customer);
console.log(grouped.Ada.length, "orders for Ada");
~~~

## What you learned

- Objects are keyed collections; \`Object.keys/values/entries\` iterate them.
- Array methods (\`map\`, \`filter\`, \`reduce\`, \`find\`...) are your daily tools — and \`sort\` needs a comparator.
- **Destructuring** unpacks values; the "options object with \`= {}\`" pattern is everywhere in Node.
- **Spread** expands, **rest** gathers; spread is shallow, so reach for \`structuredClone\` for deep copies.

## Next steps

Next: the modern JavaScript features (optional chaining, nullish coalescing, top-level await) you'll reach for every single day.
`);
