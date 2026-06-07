registerQuiz("01-values-and-types", [
  {
    q: "What does 'typeof null' return in JavaScript, and why is this surprising?",
    options: [
      "\"null\" — the correct type name",
      "\"undefined\" — because null is an unset value",
      "\"object\" — a 25-year-old historical bug that cannot be fixed",
      "\"boolean\" — because null is falsy"
    ],
    answer: 2,
    explain: "typeof null returns \"object\", which is a well-known bug from JavaScript's early days. It cannot be changed without breaking existing code on the web. The correct way to check for null is via strict equality: value === null."
  },
  {
    q: "Which of the following values is TRUTHY in JavaScript?",
    options: [
      "0",
      "\"\"",
      "[]",
      "null"
    ],
    answer: 2,
    explain: "An empty array [] is truthy because it is an object, and all objects are truthy. The falsy values are: false, 0, -0, 0n, \"\", null, undefined, and NaN. An empty array is not in that list."
  },
  {
    q: "When should you use '==' instead of '===' in JavaScript?",
    options: [
      "Whenever comparing numbers to avoid type errors",
      "Never — '==' should never be used",
      "Only for the idiomatic 'value == null' check that catches both null and undefined",
      "When comparing strings from different sources"
    ],
    answer: 2,
    explain: "The one widely accepted use of '==' is 'value == null', which is true when value is null OR undefined. Everywhere else, '===' should be used because it does not coerce types and produces predictable results."
  }
]);

registerResources("01-values-and-types", [
  { title: "MDN: JavaScript Data Types and Data Structures", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures" },
  { title: "MDN: Equality Comparisons and Sameness", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness" },
  { title: "MDN: Falsy Values", url: "https://developer.mozilla.org/en-US/docs/Glossary/Falsy" },
  { title: "MDN: typeof Operator", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof" }
]);

registerQuiz("01-functions-and-closures", [
  {
    q: "What is a closure in JavaScript?",
    options: [
      "A function that cannot be modified after it is defined",
      "A function bundled with the variables from the scope where it was defined, remembered even after the outer scope has returned",
      "A function that closes the current file or module",
      "A special syntax for immediately-invoked function expressions"
    ],
    answer: 1,
    explain: "A closure is a function plus the variables from the environment where it was created. The inner function 'closes over' those variables and retains access to them even after the outer function has returned, enabling private state and factory patterns."
  },
  {
    q: "Why should you use 'let' or 'const' instead of 'var' in a for loop that creates closures?",
    options: [
      "Because 'var' cannot be used inside loops at all",
      "Because 'var' is function-scoped and all closures in the loop share the same variable, while 'let' is block-scoped giving each iteration its own binding",
      "Because 'let' runs faster than 'var' inside loops",
      "Because 'var' does not support arrow functions"
    ],
    answer: 1,
    explain: "With 'var', all loop iterations share one variable (which ends at the final value). With 'let', each iteration gets its own block-scoped binding. The classic symptom is 'withVar.map(fn => fn())' returning [3,3,3] instead of [0,1,2]."
  },
  {
    q: "An arrow function written as 'const double = n => n * 2' uses which feature to return without the 'return' keyword?",
    options: [
      "Hoisting",
      "Implicit return — a concise arrow body returns the expression automatically",
      "Default parameters",
      "Destructuring"
    ],
    answer: 1,
    explain: "Arrow functions with a concise body (no curly braces) have an implicit return — the single expression is automatically returned. When you add a block body '{ }', you must write 'return' explicitly."
  }
]);

registerResources("01-functions-and-closures", [
  { title: "MDN: Closures", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures" },
  { title: "MDN: Arrow Function Expressions", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions" },
  { title: "MDN: var, let, and const — Block Scoping", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/let" },
  { title: "MDN: Functions Guide", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Functions" }
]);

registerQuiz("01-objects-and-arrays", [
  {
    q: "Why is '[10, 9, 100].sort()' a pitfall when sorting numbers?",
    options: [
      "The sort method does not work on number arrays",
      "sort() mutates the array and compares items as strings by default, giving wrong numeric order",
      "sort() returns a new array instead of sorting in place",
      "sort() only works correctly with arrays of fewer than 10 elements"
    ],
    answer: 1,
    explain: "Array.sort() converts elements to strings before comparing by default, so '100' < '9' lexicographically, giving [10, 100, 9]. Always pass a numeric comparator '(a, b) => a - b' for number arrays, and spread first if you want to preserve the original."
  },
  {
    q: "What does 'structuredClone(obj)' do that '{ ...obj }' does not?",
    options: [
      "structuredClone converts the object to JSON automatically",
      "structuredClone performs a deep copy, whereas spread only copies the top-level properties",
      "structuredClone is faster than spread for large objects",
      "structuredClone validates that all property values are serialisable"
    ],
    answer: 1,
    explain: "Spread ('{ ...obj }') is a shallow copy — nested objects are still shared by reference. structuredClone produces a true deep clone, so changes to nested objects in the clone do not affect the original."
  },
  {
    q: "In the function signature 'function createServer({ port = 3000, host = \"0.0.0.0\" } = {}) {}', what does the trailing '= {}' accomplish?",
    options: [
      "It sets port and host to empty objects by default",
      "It prevents a TypeError when the function is called with no arguments at all",
      "It makes the function accept only one argument",
      "It initialises an empty options object that is exported"
    ],
    answer: 1,
    explain: "Without '= {}', calling 'createServer()' with no arguments would try to destructure 'undefined', throwing a TypeError. The default '= {}' means an empty object is used when no argument is passed, so all individual property defaults still apply."
  }
]);

registerResources("01-objects-and-arrays", [
  { title: "MDN: Destructuring Assignment", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment" },
  { title: "MDN: Spread Syntax", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax" },
  { title: "MDN: Array.prototype.sort", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort" },
  { title: "MDN: structuredClone", url: "https://developer.mozilla.org/en-US/docs/Web/API/structuredClone" },
  { title: "MDN: Object.groupBy", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy" }
]);

registerQuiz("01-modern-javascript", [
  {
    q: "Why should you use '??' (nullish coalescing) instead of '||' when providing a default for 'settings.volume'?",
    options: [
      "?? is faster than || for numeric values",
      "|| also triggers on null and undefined, while ?? only triggers on null or undefined",
      "?? triggers on false and 0, while || does not",
      "|| cannot be used with object properties"
    ],
    answer: 1,
    explain: "'||' returns the right side if the left is any falsy value, including 0 and \"\". So 'settings.volume || 10' would return 10 even when volume is 0 (a valid setting). '??' only falls back when the left side is null or undefined, preserving legitimate falsy values like 0."
  },
  {
    q: "In a JavaScript class, what does the '#' prefix on a field name (e.g. '#items') do?",
    options: [
      "It marks the field as deprecated",
      "It makes the field truly private — inaccessible from outside the class, enforced by the language",
      "It makes the field static, shared across all instances",
      "It marks the field as read-only"
    ],
    answer: 1,
    explain: "A '#' prefix declares a class field as private. JavaScript enforces this at the language level — attempting to access 's.#items' from outside the class is a SyntaxError, not just a naming convention."
  },
  {
    q: "What does the optional chaining operator '?.' return when it encounters a null or undefined value in a chain like 'user?.address?.city'?",
    options: [
      "It throws a TypeError",
      "It returns null",
      "It returns undefined and short-circuits the rest of the chain",
      "It returns an empty string"
    ],
    answer: 2,
    explain: "'?.' short-circuits to undefined the moment it encounters null or undefined. So 'user?.address?.city' returns undefined without throwing if either 'user' or 'address' is null or undefined. Note it does NOT guard against other falsy values like 0 or \"\"."
  }
]);

registerResources("01-modern-javascript", [
  { title: "MDN: Optional Chaining (?.)", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining" },
  { title: "MDN: Nullish Coalescing Operator (??)", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing" },
  { title: "MDN: Classes", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes" },
  { title: "MDN: Private Class Fields", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_class_fields" },
  { title: "MDN: Template Literals", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals" }
]);
