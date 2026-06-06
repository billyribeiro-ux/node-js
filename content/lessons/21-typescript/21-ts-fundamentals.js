registerLessonSrc("21-ts-fundamentals", function () {/*
---
id: 21-ts-fundamentals
title: TypeScript Fundamentals for Node
minutes: 26
level: intermediate
objectives:
  - Understand why static types matter and what TypeScript adds over JavaScript
  - Write type annotations, interfaces, type aliases, and generics confidently
  - Narrow union types at runtime with type guards that work in both TS and JS
---

# TypeScript Fundamentals for Node

## Why this matters

Runtime bugs caused by passing the wrong shape of data to a function are among the most common — and most embarrassing — issues in production Node services. TypeScript lets you describe *exactly* what your functions expect and return, catching those mismatches at edit-time rather than at 3 a.m. on-call. Even if you write plain JavaScript today, understanding TypeScript's type model makes you a better API designer and helps you read the ecosystem's type declarations.

## Learning objectives

- Explain the core value TypeScript provides over JavaScript.
- Write basic type annotations, interfaces, type aliases, and generics.
- Use union types and type guards to narrow types safely at runtime.
- Understand structural typing and why TypeScript calls it "duck typing."

## Why types?

JavaScript lets you pass anything to anything. That's expressive but dangerous:

```js
// Pure JS — no error until runtime
function greet(user) {
  return "Hello, " + user.name.toUpperCase();
}
greet(null); // TypeError: Cannot read properties of null
```

TypeScript adds a *compile-time* layer that rejects the call before the code ever runs:

```ts
function greet(user: { name: string }): string {
  return "Hello, " + user.name.toUpperCase();
}
greet(null); // TS error: Argument of type 'null' is not assignable
```

The TypeScript compiler (`tsc`) **erases** all type syntax before emitting JavaScript — there is zero runtime cost. Types are purely a development-time tool.

## Basic type annotations

TypeScript adds `: Type` after variable names, parameters, and return positions:

```ts
// Variable annotations (usually inferred — only annotate when needed)
const port: number = 3000;
const host: string = "localhost";
let ready: boolean = false;

// Function parameter and return types
function add(a: number, b: number): number {
  return a + b;
}

// Arrays and tuples
const ids: number[] = [1, 2, 3];
const pair: [string, number] = ["Ada", 42]; // fixed-length tuple

// The "any" escape hatch — avoid it; it turns off all checking
let wild: any = "whatever";
```

> [!NOTE] TypeScript infers most types
> You rarely need to write annotations on local variables — TypeScript infers `const x = 42` as `number` automatically. Annotate function signatures (public APIs) and leave the rest to inference. Over-annotating is a common beginner habit.

## Interfaces vs type aliases

Both describe the shape of an object. Use **interfaces** when defining a public API shape (especially one consumers might extend); use **type aliases** for complex unions, intersections, or computed types.

```ts
// Interface — extensible via declaration merging and `extends`
interface User {
  id: number;
  name: string;
  email?: string; // optional property
}

interface AdminUser extends User {
  role: "admin";
}

// Type alias — more flexible, can represent anything
type ID = string | number;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
type Callback = (err: Error | null, data: Buffer) => void;
```

> [!PRINCIPAL] Interfaces for objects, types for everything else
> Prefer `interface` for object shapes you export from a library — consumers can "augment" interfaces via declaration merging to add properties (handy for framework plugins). Use `type` for unions, mapped types, conditional types, and aliases that are not object shapes. This distinction is architectural, not syntactic.

## Generics

Generics let you write code that is *parameterised by a type* — like type-level functions. They are the key to writing reusable utilities without sacrificing type safety:

```ts
// Without generics, you'd return "any"
function firstItem<T>(arr: T[]): T | undefined {
  return arr[0];
}

const name = firstItem(["Alice", "Bob"]); // type: string | undefined
const id   = firstItem([10, 20, 30]);     // type: number | undefined

// Generic interfaces
interface Repository<T> {
  findById(id: number): Promise<T | null>;
  save(item: T): Promise<T>;
  delete(id: number): Promise<void>;
}

// Constrained generics — T must have an "id" property
function sortById<T extends { id: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id - b.id);
}
```

## Union types and narrowing

A union type says a value is one of several types: `string | number`. TypeScript tracks which branch you're in via **control flow analysis** — this is called *narrowing*:

```ts
type StringOrNumber = string | number;

function double(value: StringOrNumber): StringOrNumber {
  if (typeof value === "string") {
    // TypeScript knows value is string here
    return value.repeat(2);
  }
  // TypeScript knows value is number here
  return value * 2;
}
```

**Discriminated unions** are the most powerful narrowing pattern — each branch has a literal `kind` or `type` property:

```ts
type Shape =
  | { kind: "circle";    radius: number }
  | { kind: "rectangle"; width: number; height: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":    return Math.PI * shape.radius ** 2;
    case "rectangle": return shape.width * shape.height;
  }
}
```

## Structural typing ("duck typing")

TypeScript uses **structural typing**: two types are compatible if they have the same shape, regardless of their names. This feels natural for JavaScript developers:

```ts
interface Point2D { x: number; y: number; }
interface Point3D { x: number; y: number; z: number; }

function print2D(p: Point2D): void {
  console.log(p.x, p.y);
}

const p3: Point3D = { x: 1, y: 2, z: 3 };
print2D(p3); // OK — Point3D has all of Point2D's properties
```

This is profoundly different from C# or Java where types must explicitly extend each other. In TypeScript, *compatible shape is all that matters*.

## Runtime type guards in JavaScript

TypeScript's type annotations disappear at runtime. To narrow a type safely in *running code* (and teach JavaScript code the same discipline), you use **type guard** expressions. These work in pure JS too — they are ordinary boolean-returning expressions:

```js
// typeof — works for primitives
typeof x === "string"
typeof x === "number"
typeof x === "function"

// instanceof — works for class instances
x instanceof Date
x instanceof Error

// in — checks for a property key on an object
"radius" in shape

// Array.isArray — distinguishes arrays from other objects
Array.isArray(x)

// Custom "shape check" guard
function isUser(obj) {
  return (
    obj !== null &&
    typeof obj === "object" &&
    typeof obj.id === "number" &&
    typeof obj.name === "string"
  );
}
```

In TypeScript you add `: obj is User` as the return type of such a function — making it a *type predicate* — so the compiler narrows the type inside `if (isUser(obj))` blocks automatically.

## Try it yourself

The following runnable block demonstrates **runtime type guards** and **discriminated-union dispatch** in pure JavaScript — exactly the pattern TypeScript formalises with union types and `switch` narrowing:

```js run
// Runtime type guards and discriminated unions — pure JS

// typeof guard
function formatValue(value) {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number") return value.toFixed(2);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value !== null && typeof value === "object") return `{object}`;
  return String(value);
}

console.log(formatValue("hello"));       // "hello"
console.log(formatValue(3.14159));       // 3.14
console.log(formatValue(true));          // yes
console.log(formatValue([1, 2, 3]));     // [3 items]
console.log(formatValue({ x: 1 }));      // {object}

// Discriminated union dispatch (the shape that TS loves)
function area(shape) {
  switch (shape.kind) {
    case "circle":    return Math.PI * shape.radius ** 2;
    case "rectangle": return shape.width * shape.height;
    case "triangle":  return 0.5 * shape.base * shape.height;
    default:
      throw new Error("Unknown shape: " + shape.kind);
  }
}

console.log(area({ kind: "circle",    radius: 5 }).toFixed(2));          // 78.54
console.log(area({ kind: "rectangle", width: 4, height: 6 }).toFixed(2));// 24.00
console.log(area({ kind: "triangle",  base: 3, height: 8 }).toFixed(2)); // 12.00

// Custom "isUser" guard
function isUser(obj) {
  return (
    obj !== null &&
    typeof obj === "object" &&
    typeof obj.id === "number" &&
    typeof obj.name === "string"
  );
}

const inputs = [
  { id: 1, name: "Ada" },
  { id: "x", name: "Ada" },
  null,
  42,
];

inputs.forEach((v) => console.log(isUser(v) ? "User: " + v.name : "Not a User"));
// User: Ada
// Not a User
// Not a User
// Not a User
```

## Exercise: build a typed result wrapper

Implement a `Result` type in JavaScript using discriminated unions. Write `ok(value)` and `fail(error)` constructors and an `unwrap(result)` function that throws on failure.

<details>
<summary>Show solution</summary>

```js run
function ok(value)    { return { success: true,  value }; }
function fail(error)  { return { success: false, error }; }

function unwrap(result) {
  if (result.success) return result.value;
  throw new Error(result.error);
}

function safeDivide(a, b) {
  if (b === 0) return fail("Division by zero");
  return ok(a / b);
}

const r1 = safeDivide(10, 2);
const r2 = safeDivide(10, 0);

console.log(unwrap(r1));             // 5

try {
  unwrap(r2);
} catch (e) {
  console.log("Caught:", e.message); // Caught: Division by zero
}

// Chaining results
function parsePositive(str) {
  const n = Number(str);
  if (isNaN(n))  return fail("Not a number: " + str);
  if (n <= 0)    return fail("Not positive: " + n);
  return ok(n);
}

["42", "-5", "abc", "100"].forEach((s) => {
  const r = parsePositive(s);
  console.log(s + " =>", r.success ? r.value : "ERR:" + r.error);
});
```

</details>

## Common pitfalls

> [!PITFALL] Using `any` defeats the purpose
> When you annotate something `any`, TypeScript stops checking it and everything that flows from it. A single poorly-typed third-party import annotated `any` can silently propagate through your whole codebase. Use `unknown` instead — it forces you to narrow before using the value, preserving safety.

> [!PITFALL] Confusing structural equality with runtime identity
> TypeScript's structural compatibility is a *compile-time* concept. At runtime, `instanceof` checks class identity, not structure. A plain object `{ id: 1, name: "Ada" }` satisfies the `User` interface at compile time, but `obj instanceof User` will be `false` if `User` is a class. Know which world you're operating in.

## What you learned

- TypeScript adds **zero-cost** compile-time types that are erased before running.
- **Interfaces** describe extensible object shapes; **type aliases** handle unions, intersections, and complex types.
- **Generics** parameterise types the way functions parameterise values — enabling reusable, type-safe utilities.
- **Union types** combined with **narrowing** (typeof, in, instanceof, discriminated unions) let the compiler track which branch you're in.
- **Structural typing** means shape compatibility is all that matters — no need for explicit `implements`.

## Next steps

Now that you know what TypeScript's type system offers, the next lesson covers how to *configure* the compiler — tsconfig.json, ESM output, and getting your project structure right before you write a single line.
*/});
