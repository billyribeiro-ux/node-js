registerLesson("01-values-and-types", `
---
id: 01-values-and-types
title: Values, Types & Coercion
minutes: 22
level: beginner
objectives:
  - Know JavaScript's primitive types and the difference from objects
  - Understand truthiness and safe equality
  - Avoid the classic coercion traps
---

# Values, Types & Coercion

## Why this matters

Every bug you'll ever write involves a value being a different *type* than you expected. JavaScript is dynamically typed and famously willing to convert types behind your back ("coercion"). Master this and a whole category of confusing bugs simply disappears. This is the bedrock the entire course stands on.

## Learning objectives

- Name JavaScript's **primitive** types and how they differ from **objects**.
- Understand **truthiness** and when to use \`===\` vs \`==\`.
- Recognise and avoid coercion surprises.

## The primitive types

JavaScript has a small set of **primitive** values — simple, immutable building blocks:

~~~js run
console.log(typeof "hello");      // string
console.log(typeof 42);           // number
console.log(typeof 42n);          // bigint  (for huge integers)
console.log(typeof true);         // boolean
console.log(typeof undefined);    // undefined (a variable with no value yet)
console.log(typeof Symbol("id")); // symbol  (unique identifiers)
console.log(typeof null);         // "object"  <-- a famous historical bug!
~~~

Notice the last line: \`typeof null\` returns \`"object"\`. That's a 25-year-old quirk that can never be fixed without breaking the web. Just remember it.

Everything that is **not** a primitive is an **object** — including arrays and functions:

~~~js run
console.log(typeof {});           // object
console.log(typeof [1, 2, 3]);    // object  (arrays are objects)
console.log(typeof function(){}); // function (a callable object)
console.log(Array.isArray([1,2])); // true  <-- the right way to check arrays
~~~

> [!NOTE] Primitives are copied, objects are shared
> When you assign a primitive, you copy its *value*. When you assign an object, you copy a *reference* to the same object. This single fact explains a huge amount of JavaScript behaviour.

~~~js run
let a = 10;
let b = a;     // b gets a COPY of the value
b = 99;
console.log(a, b); // 10 99  — a is untouched

let x = { count: 1 };
let y = x;     // y points to the SAME object
y.count = 99;
console.log(x.count, y.count); // 99 99  — both see the change!
~~~

## Truthiness

In any boolean context (like an \`if\`), values are coerced to \`true\` or \`false\`. There are exactly **eight falsy values** — memorise them, because everything else is truthy:

~~~js run
const falsy = [false, 0, -0, 0n, "", null, undefined, NaN];
for (const v of falsy) {
  // String() safely renders every type (JSON.stringify would choke on BigInt)
  console.log(\`\${String(v)} (\${typeof v}) -> \${Boolean(v)}\`);
}
console.log("---");
console.log(Boolean("0"));   // true!  a non-empty string
console.log(Boolean([]));    // true!  an empty array is an object
console.log(Boolean({}));    // true!  an empty object too
~~~

> [!PITFALL] Empty array and "0" are truthy
> Beginners assume \`[]\` or \`"0"\` are falsy — they are not. An empty array is still an object, and \`"0"\` is a non-empty string. Check \`array.length\` to test for emptiness.

## Equality: always use ===

JavaScript has two equality operators. \`==\` coerces types before comparing (chaotic). \`===\` checks value *and* type (predictable). **Use \`===\` always.**

~~~js run
console.log(0 == "");        // true   (both coerce to falsy)  😱
console.log(0 == "0");       // true   😱
console.log("" == "0");      // false  😱 (inconsistent!)
console.log(null == undefined); // true
console.log(1 == true);      // true

console.log("--- with === ---");
console.log(0 === "");       // false  ✅ predictable
console.log(1 === true);     // false  ✅
~~~

The \`==\` results above are genuinely inconsistent (\`0 == ""\` and \`0 == "0"\` are both true, but \`"" == "0"\` is false). That's why professionals just use \`===\` and never think about it again.

> [!PRINCIPAL] The one exception
> There is exactly one place experienced developers use \`==\`: \`value == null\` is a concise way to check for **both** \`null\` and \`undefined\` at once. It's a deliberate, well-known idiom. Everywhere else: \`===\`.

## Coercion in arithmetic

The \`+\` operator is overloaded: it adds numbers but *concatenates* strings, and it will happily mix them:

~~~js run
console.log(1 + 2);       // 3
console.log("1" + 2);     // "12"  (number coerced to string)
console.log("5" - 2);     // 3     (- has no string meaning, so string -> number)
console.log("5" * "2");   // 10
console.log([] + []);     // ""    (arrays coerce to empty strings)
console.log(typeof (1 + "1")); // string
~~~

The fix is to **convert explicitly** so your intent is obvious:

~~~js run
const input = "42";          // imagine this came from a form
console.log(Number(input) + 8);   // 50
console.log(parseInt("42px", 10)); // 42  (stops at non-digits)
console.log(String(99) + "!");     // "99!"
~~~

### Exercise: predict and verify

Before running, predict each result. Then run it.

~~~js run
console.log(typeof NaN);        // ?
console.log(NaN === NaN);       // ?
console.log(10 / "abc");        // ?
console.log(Number.isNaN(10 / "abc")); // ?
~~~

<details>
<summary>Answers</summary>

- \`typeof NaN\` is \`"number"\` — NaN means "Not a Number" but is, ironically, of type number.
- \`NaN === NaN\` is \`false\` — NaN is the only value not equal to itself. Use \`Number.isNaN(x)\` to test for it.
- \`10 / "abc"\` is \`NaN\` — the string can't become a number.
- \`Number.isNaN(...)\` is \`true\`.
</details>

## Mini-project: a safe parser

Write a function that takes anything and returns a clean number, or \`0\` if it can't.

~~~js run
function toNumberOrZero(value) {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

console.log(toNumberOrZero("42"));    // 42
console.log(toNumberOrZero("3.14"));  // 3.14
console.log(toNumberOrZero("abc"));   // 0
console.log(toNumberOrZero(""));      // 0  (empty string -> 0... is that what we want?)
console.log(toNumberOrZero(null));    // 0
console.log(toNumberOrZero(true));    // 1
~~~

Notice \`toNumberOrZero("")\` returns 0 because \`Number("")\` is 0. Real-world parsing has edge cases — naming them is half the job.

## What you learned

- Primitives are copied by value; objects are shared by reference.
- There are eight falsy values; \`[]\`, \`{}\`, and \`"0"\` are **truthy**.
- Use \`===\` everywhere (with \`== null\` as the single idiomatic exception).
- \`+\` concatenates with strings; convert types explicitly to avoid surprises.

## Next steps

Next: functions, scope, and closures — the feature that powers callbacks, modules, and most of Node itself.
`);
