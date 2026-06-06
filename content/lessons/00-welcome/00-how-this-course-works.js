registerLesson("00-how-this-course-works", `
---
id: 00-how-this-course-works
title: How This Course Works
minutes: 10
level: beginner
objectives:
  - Understand the structure that takes you from zero to principal engineer
  - Know how to run code right here in your browser
  - Learn how to get the most out of every lesson
---

# How This Course Works

## Why this matters

You are about to learn Node.js the way a great mentor would teach it: slowly enough that nothing is confusing, but deeply enough that by the end you can architect systems that serve millions of users. Before we touch a single line of Node, let's spend ten minutes making sure you know how to *use* this course. A small investment now will save you hours later.

## Learning objectives

- Understand the journey from absolute beginner to **distinguished principal engineer (Level 7+)**.
- Run JavaScript directly in this page — no installation required to start.
- Know exactly what each part of a lesson is for.

## The shape of the journey

This course is organised into **six tiers**. Each tier builds on the one before it, like floors of a building. You should not skip floors — the advanced material literally does not make sense without the foundations.

| Tier | What you become |
|------|-----------------|
| **Tier 0 — Orientation** | Set up and run Node like a professional |
| **Tier 1 — Foundations** | Fluent in JavaScript and the Node runtime |
| **Tier 2 — Core APIs** | Able to use every core Node module |
| **Tier 3 — Building Real Things** | Shipping CLIs, APIs, and database-backed apps |
| **Tier 4 — Engineering Quality** | TypeScript, testing, tooling, monorepos |
| **Tier 5 — Advanced & Principal** | Distributed systems, performance, architecture |

> [!NOTE] You can always see where you are
> The sidebar on the left is your map. Your progress is saved automatically in this browser, and the bar at the top shows how far you've come. Use the **Next →** and **← Previous** buttons at the bottom of every lesson, or just press the arrow keys.

## Run code without installing anything

Most code boxes in this course are **live**. When you see a green **▶ Run** button, you can edit the code and run it instantly — it executes safely inside your browser. Try it now:

~~~js run
// Edit me! Then press ▶ Run.
const name = "future principal engineer";
console.log("Hello, " + name + "!");

// JavaScript can do real work, too:
const numbers = [1, 2, 3, 4, 5];
const total = numbers.reduce((sum, n) => sum + n, 0);
console.log("The sum is:", total);
~~~

Go ahead — change the name, change the numbers, and run it again. Experimenting is how you learn. You cannot break anything.

> [!PITFALL] "Live" means browser JavaScript
> The **▶ Run** boxes execute *pure JavaScript* in your browser. Some lessons show code that uses Node-specific features — reading files, starting web servers, talking to databases — which a browser can't do. Those examples are **read-only** and come with an **Expected output** panel so you can see exactly what would happen when you run them on real Node. You'll install real Node in the next two lessons.

## Anatomy of a lesson

Every lesson follows the same rhythm, so you always know what to expect:

1. **Why this matters** — the real-world reason to care.
2. **Learning objectives** — what you'll be able to do.
3. **Concept** — plain-English explanation, building from the ground up.
4. **Narrated walkthrough** — annotated code you read line by line.
5. **Try it yourself** — a runnable playground to experiment in.
6. **Exercises** — small challenges with hints and revealable solutions.
7. **Project** — something real you build with what you learned.
8. **Pitfalls** — the mistakes even experienced developers make.
9. **What you learned** + **Next steps**.

## How to actually get good

> [!PRINCIPAL] The single habit that creates principal engineers
> Reading code teaches you to *recognise* solutions. **Writing** code teaches you to *produce* them. The gap between a mid-level and a principal engineer is mostly thousands of hours of deliberate practice. So for every concept: type it out, run it, break it on purpose, and fix it. Do every exercise. Build every project. Do not just read.

Here is a tiny exercise to prove you're ready.

### Exercise: make it yours

Edit the code below so it prints a countdown from 5 down to 1, then prints "Lift off!".

~~~js run
// Your turn. Hint: a loop that counts down.
for (let i = 5; i >= 1; i--) {
  console.log(i);
}
console.log("Lift off!");
~~~

<details>
<summary>Show one possible solution</summary>

The code above already works — but try writing it a different way, using \`while\` instead of \`for\`:

~~~js run
let i = 5;
while (i >= 1) {
  console.log(i);
  i = i - 1;
}
console.log("Lift off!");
~~~

There is rarely only one correct answer in programming. Getting comfortable with *multiple* ways to express the same idea is a sign you're growing.
</details>

## What you learned

- This course climbs six tiers from beginner to principal engineer — take them in order.
- Green **▶ Run** boxes execute live; read-only boxes show Node-only code with expected output.
- Your progress saves automatically; navigate with the buttons or arrow keys.
- The way to get good is to **write** code, not just read it.

## Next steps

Next, we'll install Node.js the way professionals do — with a version manager — so you can run everything in this course on your own machine.
`);
