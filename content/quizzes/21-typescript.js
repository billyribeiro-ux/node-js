registerQuiz("21-ts-fundamentals", [
  {
    q: "What does TypeScript's structural typing mean in practice?",
    options: [
      "Every type must explicitly declare which interfaces it implements",
      "Two types are compatible if they have the same shape, regardless of their names",
      "Only classes can be used as types; plain objects are not allowed",
      "Type compatibility is determined at runtime by checking the prototype chain"
    ],
    answer: 1,
    explain: "TypeScript uses structural (duck) typing: if two types have the same shape — the same required properties and their types — they are mutually assignable, even if they have different names and no explicit relationship declared."
  },
  {
    q: "Which of the following is a discriminated union, and why is it particularly useful for type narrowing?",
    options: [
      "type ID = string | number — a union of primitives narrowed with typeof",
      "interface User { name: string; age?: number } — an object with an optional field",
      "type Shape = { kind: 'circle'; radius: number } | { kind: 'rectangle'; width: number; height: number } — branches share a literal 'kind' field",
      "type Callback = (err: Error | null, data: Buffer) => void — a function type"
    ],
    answer: 2,
    explain: "A discriminated union gives every branch a shared literal property (the discriminant, here 'kind'). A switch on that property lets TypeScript narrow the type to exactly one branch, giving full access to that branch's unique fields."
  },
  {
    q: "When should you use the 'unknown' type instead of 'any' for a value whose type you do not know yet?",
    options: [
      "Never; 'any' and 'unknown' are interchangeable",
      "When the value comes from a third-party library that ships no type declarations",
      "When you want TypeScript to stop checking that value and everything derived from it",
      "When you want to force the caller to narrow the type before using it, preserving safety"
    ],
    answer: 3,
    explain: "'unknown' is the type-safe counterpart to 'any'. You cannot use an 'unknown' value directly — TypeScript forces you to narrow it (with typeof, instanceof, or a type guard) before any operation. 'any' skips all checks and propagates unsafety silently."
  }
]);

registerResources("21-ts-fundamentals", [
  { title: "TypeScript Handbook — Basic Types", url: "https://www.typescriptlang.org/docs/handbook/2/basic-types.html" },
  { title: "TypeScript Handbook — Narrowing", url: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html" },
  { title: "TypeScript Handbook — Generics", url: "https://www.typescriptlang.org/docs/handbook/2/generics.html" },
  { title: "TypeScript Handbook — Interfaces vs Type Aliases", url: "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#differences-between-type-aliases-and-interfaces" },
  { title: "TypeScript Playground", url: "https://www.typescriptlang.org/play" }
]);

registerQuiz("21-tsconfig-esm", [
  {
    q: "Which pair of 'tsconfig.json' options must be used together for a Node.js project that uses native ESM without a bundler?",
    options: [
      "module: ESNext and moduleResolution: Bundler",
      "module: CommonJS and moduleResolution: Node",
      "module: NodeNext and moduleResolution: NodeNext",
      "module: ES2022 and moduleResolution: Classic"
    ],
    answer: 2,
    explain: "'module: NodeNext' tells TypeScript to emit ESM-style code matching Node's native behaviour, and 'moduleResolution: NodeNext' mirrors how Node resolves imports at runtime, including the exports map in package.json. These two must always match."
  },
  {
    q: "When using 'module: NodeNext' in tsconfig, how should you write import paths in your TypeScript source files?",
    options: [
      "With a .ts extension, e.g. import { foo } from './utils.ts'",
      "Without any extension, e.g. import { foo } from './utils'",
      "With a .js extension, e.g. import { foo } from './utils.js'",
      "With a .mjs extension, e.g. import { foo } from './utils.mjs'"
    ],
    answer: 2,
    explain: "With NodeNext module resolution, import paths must match what Node will see at runtime after compilation. The compiled output is '.js', so you write '.js' in your TypeScript source. TypeScript understands that './utils.js' refers to './utils.ts' during development."
  },
  {
    q: "What does enabling 'strict: true' in tsconfig.json actually do?",
    options: [
      "It sets all type errors to warnings instead of errors",
      "It enables a bundle of safety checks including strictNullChecks, noImplicitAny, and strictFunctionTypes",
      "It prevents any use of the 'any' type in the project",
      "It forces all functions to have explicit return type annotations"
    ],
    answer: 1,
    explain: "'strict: true' is a shorthand flag that enables a family of individual checks at once: strictNullChecks, noImplicitAny, strictFunctionTypes, strictPropertyInitialization, and others. It does not individually forbid 'any' but does enforce that variables have explicit types when they cannot be inferred."
  }
]);

registerResources("21-tsconfig-esm", [
  { title: "tsconfig.json Reference", url: "https://www.typescriptlang.org/tsconfig" },
  { title: "TypeScript NodeNext Module Resolution", url: "https://www.typescriptlang.org/docs/handbook/modules/reference.html#node16-nodenext" },
  { title: "Node.js ESM Documentation", url: "https://nodejs.org/api/esm.html" },
  { title: "TypeScript Project References", url: "https://www.typescriptlang.org/docs/handbook/project-references.html" },
  { title: "Are the types wrong? (publint / arethetypeswrong)", url: "https://arethetypeswrong.github.io/" }
]);

registerQuiz("21-running-ts", [
  {
    q: "What does 'node --experimental-strip-types file.ts' do, and what does it NOT do?",
    options: [
      "It compiles and type-checks the file, then executes the result",
      "It strips TypeScript type syntax and executes the file, but does not type-check it",
      "It converts the file to CommonJS before executing it",
      "It requires a tsconfig.json to be present in the same directory"
    ],
    answer: 1,
    explain: "Node's native type-stripping removes type annotations (using the amaro/SWC stripper) so the file can execute immediately. It deliberately skips type-checking for speed. Run 'tsc --noEmit' separately in CI to catch type errors."
  },
  {
    q: "Which TypeScript features cannot be used with Node's native type-stripping and must be avoided or replaced?",
    options: [
      "Interfaces, type aliases, and generic type parameters",
      "Optional chaining (?.) and nullish coalescing (??)",
      "Enums and TypeScript namespaces, which emit runtime JavaScript code",
      "Import type statements and type-only exports"
    ],
    answer: 2,
    explain: "Type-stripping only works on 'erasable' syntax — annotations that can be deleted without changing runtime behaviour. 'enum' and 'namespace' generate real JavaScript output (variable declarations and IIFEs), so the stripper cannot handle them. Use 'const ... as const' objects instead of enums."
  },
  {
    q: "In what scenario is 'tsx watch src/index.ts' the recommended tool over 'node --experimental-strip-types'?",
    options: [
      "When the project uses only vanilla JavaScript with no TypeScript syntax",
      "When you need hot-reload during active development of a TypeScript application server",
      "When deploying to production to avoid a compile step",
      "When you need to enforce strict type-checking on every file save"
    ],
    answer: 1,
    explain: "'tsx watch' monitors source files and restarts the process on changes, handling all TypeScript including enums and JSX. It is the ergonomic inner-loop tool for development. Native stripping is the zero-dependency baseline; tsx is the richer dev experience."
  }
]);

registerResources("21-running-ts", [
  { title: "Node.js Type Stripping Documentation", url: "https://nodejs.org/api/typescript.html" },
  { title: "tsx — TypeScript Execute (GitHub)", url: "https://github.com/privatenumber/tsx" },
  { title: "Node.js CLI Flags Reference (--experimental-strip-types)", url: "https://nodejs.org/api/cli.html#--experimental-strip-types" },
  { title: "esbuild Transform API", url: "https://esbuild.github.io/api/#transform" },
  { title: "TypeScript tsc --noEmit Flag", url: "https://www.typescriptlang.org/tsconfig#noEmit" }
]);

registerQuiz("21-typed-libraries", [
  {
    q: "What is a '.d.ts' declaration file, and what runtime overhead does it add?",
    options: [
      "A compiled JavaScript file with type comments; it adds slight parsing overhead",
      "A pure-type description of a JavaScript module that contains no runtime code; it adds zero overhead",
      "A minified version of the source TypeScript file used in production",
      "A JSON schema file that describes the package's public API"
    ],
    answer: 1,
    explain: "A '.d.ts' file contains only type declarations — no executable code. TypeScript reads it at compile time to understand a module's shapes. At runtime Node ignores it entirely, so there is zero performance cost."
  },
  {
    q: "In the 'exports' field of package.json, why must the 'types' condition appear BEFORE the 'default' condition in each export block?",
    options: [
      "npm requires alphabetical ordering of condition keys",
      "TypeScript resolves the first matching condition and will miss types if 'default' comes first",
      "The 'default' condition is only valid in CommonJS packages",
      "Node.js ignores all conditions that follow 'default'"
    ],
    answer: 1,
    explain: "TypeScript resolves export conditions in order and stops at the first match. If 'default' appears before 'types', TypeScript picks the JavaScript file and never finds the '.d.ts' declarations, resulting in missing type information for consumers."
  },
  {
    q: "What does enabling 'declarationMap: true' in tsconfig provide to consumers of your library?",
    options: [
      "It generates a JSON manifest of all exported symbols for documentation tools",
      "It allows consumers to jump-to-source through the '.d.ts' file directly to your original TypeScript source",
      "It embeds source code inline inside the '.d.ts' file",
      "It forces TypeScript to validate the declaration files match the compiled output"
    ],
    answer: 1,
    explain: "Declaration maps ('.d.ts.map' files) link each position in a '.d.ts' file back to the corresponding position in the original '.ts' source. Editors use these maps so that 'Go to definition' lands in the readable TypeScript source, not the generated declaration file."
  }
]);

registerResources("21-typed-libraries", [
  { title: "TypeScript Declaration Files (Handbook)", url: "https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html" },
  { title: "TypeScript package.json exports and types", url: "https://www.typescriptlang.org/docs/handbook/modules/reference.html#packagejson-exports" },
  { title: "npm package.json 'exports' field documentation", url: "https://nodejs.org/api/packages.html#exports" },
  { title: "DefinitelyTyped (@types) Repository", url: "https://github.com/DefinitelyTyped/DefinitelyTyped" },
  { title: "publint — Validate package.json for publishing", url: "https://publint.dev/" }
]);
