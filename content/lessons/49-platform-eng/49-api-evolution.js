registerLessonSrc("49-api-evolution", function () {/*
---
id: 49-api-evolution
title: "API Versioning, Schema Evolution & Compatibility"
minutes: 28
level: advanced
objectives:
  - Distinguish backward vs forward compatibility and know when each matters
  - Apply the expand/contract migration pattern without downtime
  - Classify schema changes as compatible or breaking using Hyrum's Law awareness
---

# API Versioning, Schema Evolution & Compatibility

## Why this matters

Every long-lived API eventually needs to change. You rename a field, tighten a type, drop a
deprecated endpoint. The engineering challenge is that your producers and consumers deploy
independently — there is always a window where both old and new code coexist in production.
Get the transition wrong and you get cascading failures, data loss, or silent corruption. A
distinguished engineer's superpower here is building systems that evolve *without* breaking
existing callers, even unintentional ones.

## Learning objectives

- Define backward and forward compatibility precisely and explain the asymmetry.
- Apply the expand/contract (parallel-change) pattern to zero-downtime schema migrations.
- Know the protobuf and Avro field evolution rules by heart.
- Write a deprecation policy with proper sunset headers and versioning strategies.
- Reason about Hyrum's Law: every observable behavior becomes someone's API.

## Backward vs forward compatibility

**Backward compatibility** (the most common requirement): new producers emit data that old
consumers can still read. You deployed a new service; your old clients must still work.

**Forward compatibility** (often overlooked): old producers emit data that new consumers can
still handle. You rolled out new consumers first; they still get old-format events from producers
not yet updated.

In practice, event-driven and multi-datacenter systems need *both*. A field you add must be
ignorable by old readers (forward compat). A field you remove must be optional or defaulted for
new readers encountering old data (backward compat).

> [!PRINCIPAL]
> The asymmetry that bites teams: they test backward compatibility (new code, old data) but forget
> forward compatibility (old code, new data). During a canary rollout or partial outage you always
> have mixed versions. A consumer that crashes on an unknown field destroys the deployment window.
> JSON's "ignore unknown fields" is a feature, not a bug. Protobuf's unknown-field preservation is
> a deliberate protocol decision for this exact reason.

## Additive vs breaking changes

The canonical taxonomy for REST/JSON and binary schema systems:

| Change | Compatible? | Notes |
|---|---|---|
| Add optional field | Yes (backward + forward) | New readers use it; old readers ignore it |
| Add required field | Breaking | Old producers don't emit it; new readers get validation errors |
| Remove field | Breaking (backward) | Old producers still emit it; new readers may depend on it |
| Rename field | Breaking | Equivalent to remove + add |
| Narrow a type | Breaking | `string` → `enum`, `number` → `integer` |
| Widen a type | Usually safe | `integer` → `number`, but check consumer parsers |
| Change default value | Breaking (semantically) | Old readers use the field with one meaning; new default changes behavior |
| Add enum value | Breaking for exhaustive switches | Old consumers may not handle new values; always add a default/unknown case |
| Reorder fields | Safe in JSON/protobuf | Breaking in positional CSV or Avro without a schema |

> [!PITFALL]
> Renaming a JSON field and keeping the old name as an alias seems safe — but if you ever remove
> the alias you have a breaking change, and many codebases forget the alias exists. Track aliases
> in your schema registry explicitly or you're accumulating hidden debt.

## Protobuf schema evolution rules

Protocol Buffers are designed for evolution, but the rules are strict:

1. **Field numbers are forever.** Once assigned, a field number must never be reused for a
   different field. Even after the field is deleted, reserve the number: `reserved 5;`.
2. **Wire types must be preserved.** Changing from `int32` to `sint32` changes the wire encoding
   and silently corrupts data.
3. **Adding fields is safe** if they're `optional` (proto3: all singular fields are optional by
   default). The default value (zero, empty string, false) is returned when absent.
4. **`required` fields in proto2 are a trap.** Once required, removing the field breaks old
   producers. The proto3 design removes `required` entirely for this reason.
5. **Unknown fields are preserved** by the runtime since proto3.5+, so a consumer that round-trips
   a message it doesn't fully understand won't drop data.

```js
// Proto3 schema — additive evolution example
// v1:
// message User { string id = 1; string name = 2; }

// v2 (backward + forward compatible):
// message User {
//   string id = 1;
//   string name = 2;
//   string email = 3;         // new optional field — safe
//   reserved 4;               // was "phone", deleted — number reserved
//   reserved "phone";         // name also reserved
// }
```

## Avro schema evolution rules

Avro takes a different approach: the schema is embedded in the data (or resolved via a schema
registry). Evolution works by providing both a **writer schema** (how the data was encoded) and
a **reader schema** (how you want to decode it). The Avro resolution rules:

- **Field in writer, not in reader:** ignored.
- **Field in reader, not in writer:** the reader's default value is used (required!). This means
  every field you add to a reader schema **must have a default**, even if it's `null`.
- **Type promotion:** `int` → `long` → `float` → `double` is safe; the reverse is not.
- **Union types:** Adding `null` to an existing type creates an optional field safely.

```json
// Avro schema v2 — adding email with a default (required for reader evolution)
{
  "type": "record",
  "name": "User",
  "fields": [
    { "name": "id",    "type": "string" },
    { "name": "name",  "type": "string" },
    { "name": "email", "type": ["null", "string"], "default": null }
  ]
}
```

> [!NOTE]
> The Confluent Schema Registry enforces compatibility checks (`BACKWARD`, `FORWARD`, `FULL`)
> at schema registration time. Configure your registry to reject breaking schemas before they
> reach production — this is your automated guard rail.

## The expand/contract (parallel-change) migration pattern

This is the zero-downtime migration playbook for any schema change that looks breaking:

**Phase 1 — Expand:** Add the new field/column alongside the old one. Both producer and
consumer versions can coexist. New producers write both fields; old consumers read the old field.

**Phase 2 — Migrate:** Update all consumers to use the new field. Deploy incrementally. Monitor
error rates. This is the longest phase.

**Phase 3 — Contract:** Once all consumers are confirmed on the new field, remove the old field.
Old producers stop emitting it; no consumer reads it.

```js
// REST API: expand/contract for renaming "username" → "displayName"
// Phase 1 response (BOTH fields):
// { "username": "ada", "displayName": "ada" }

// Phase 2: consumers migrated to displayName
// Phase 3 response (OLD field removed):
// { "displayName": "ada" }
```

> [!PRINCIPAL]
> The expand phase is cheap; the contract phase is politically expensive. Teams hold onto dual
> fields for 2–3 quarters because "we're not sure all consumers are updated." This is why schema
> registries, consumer tracking, and deprecation headers exist: they give you *evidence* to justify
> the contract. Without tooling, you keep technical debt forever.

## Versioning strategies at scale

**URI versioning** (`/v1/`, `/v2/`): explicit, easy to route, easy to deprecate. Heavy: you run
parallel codepaths. Works well for major breaking versions.

**Header versioning** (`Accept: application/vnd.myapi.v2+json`): RESTful, invisible in URLs,
harder to test and share links. Favored by hypermedia purists.

**Query param versioning** (`?version=2`): easy to add, easy to ignore validation. Sloppy in
practice.

**Semantic versioning of schema artifacts:** version your Protobuf/Avro schemas in a schema
registry with a numeric version. Consumers declare the version they were tested against;
`can-i-deploy` checks whether deploying consumer@version is safe against provider@version.

For internal microservices, URI versioning or schema-registry versioning (not URL versioning)
is most common. For public APIs, URI versioning with a clear deprecation schedule is the
industry standard.

## Deprecation policy and Sunset headers

The IETF `Sunset` header (RFC 8594) tells API clients when an endpoint or version will stop
working. Pair it with `Deprecation` (RFC draft):

```js
// Node.js Express middleware example (read-only — uses Node APIs)
import express from "node:express";
const app = express();

app.use("/v1/users", (req, res, next) => {
  res.set("Deprecation", "true");
  res.set("Sunset", "Sat, 01 Jan 2027 00:00:00 GMT");
  res.set("Link", '</v2/users>; rel="successor-version"');
  next();
});
```

> [!OUTPUT]
> HTTP/1.1 200 OK
> Deprecation: true
> Sunset: Sat, 01 Jan 2027 00:00:00 GMT
> Link: </v2/users>; rel="successor-version"

A credible deprecation policy includes:
- At least 6 months notice for public APIs (12 months for enterprise).
- Traffic dashboards per version to identify still-active callers.
- Automated emails/tickets when traffic spikes right before sunset.
- A kill switch that returns 410 Gone after sunset, not 404.

## Hyrum's Law — the observable behavior problem

> *"With a sufficient number of users of an API, it does not matter what you promise in the
> contract: all observable behaviors of your system will be depended on by somebody."*
> — Hyrum Wright

Practically: your undocumented response ordering, your specific error message text, your
accidental microsecond latency, your quirky empty-array-vs-null choice — someone depends on it.

Real examples from production:
- Changing `"error": null` to omitting the `error` key on success broke clients checking `if (body.error === null)`.
- Sorting results alphabetically when the spec said "unordered" broke clients that expected alphabetical order after a refactor changed the sort.
- Removing a trailing newline from a CSV export broke a downstream awk script.

> [!PRINCIPAL]
> Hyrum's Law means your *contract surface* is always larger than your *documented* surface.
> Mitigations: (1) strict schema validation on responses (not just requests), (2) consumer-driven
> contract tests that pin observed behavior, (3) structured changelogs that document *every* change
> even if you think it's internal. The best teams treat their API like a binary ABI: once observed
> by consumers, behaviors are sticky.

## Try it yourself

Implement a schema compatibility checker that classifies a diff between two JSON-schema-like
definitions as compatible or breaking. The model:

- Adding an optional field → compatible
- Adding a required field → breaking
- Removing any field → breaking
- Renaming (remove + add with different name) → breaking
- Changing a field type → breaking

```js run
// Schema compatibility classifier
// Schemas are plain objects: { fieldName: { type, required } }

function diffSchemas(v1, v2) {
  const results = [];

  // Fields in v2 not in v1 (additions)
  for (const [field, def] of Object.entries(v2)) {
    if (!(field in v1)) {
      if (def.required) {
        results.push({ field, change: "added-required", compatible: false });
      } else {
        results.push({ field, change: "added-optional", compatible: true });
      }
    }
  }

  // Fields in v1 (check for removal or type change)
  for (const [field, def] of Object.entries(v1)) {
    if (!(field in v2)) {
      results.push({ field, change: "removed", compatible: false });
    } else {
      const newDef = v2[field];
      // Required→optional is safe (widening); optional→required is breaking
      if (!def.required && newDef.required) {
        results.push({ field, change: "became-required", compatible: false });
      } else if (def.type !== newDef.type) {
        results.push({ field, change: `type-changed(${def.type}->${newDef.type})`, compatible: false });
      } else {
        results.push({ field, change: "unchanged", compatible: true });
      }
    }
  }

  return results;
}

function checkCompat(v1, v2) {
  const diffs = diffSchemas(v1, v2);
  const breaking = diffs.filter(d => !d.compatible);
  console.log("=== Schema Diff ===");
  for (const d of diffs) {
    const icon = d.compatible ? "[OK]  " : "[BREAK]";
    console.log(`${icon} ${d.field}: ${d.change}`);
  }
  console.log(breaking.length === 0
    ? "\nResult: COMPATIBLE — safe to deploy"
    : `\nResult: BREAKING — ${breaking.length} breaking change(s) detected`);
}

const v1 = {
  id:       { type: "string",  required: true  },
  name:     { type: "string",  required: true  },
  username: { type: "string",  required: false },
};

const v2 = {
  id:          { type: "string",  required: true  },
  name:        { type: "string",  required: true  },
  displayName: { type: "string",  required: false }, // rename: username removed, displayName added
  email:       { type: "string",  required: true  }, // new required field — breaking
  age:         { type: "number",  required: false }, // new optional field — safe
};

checkCompat(v1, v2);
```

## Exercise: classify a batch of changes

Given the v2 schema above, add a `score` optional field of type `number` and then try making
`email` optional (required → optional). Which changes are compatible?

<details>
<summary>Show solution</summary>

```js run
function diffSchemas(v1, v2) {
  const results = [];
  for (const [field, def] of Object.entries(v2)) {
    if (!(field in v1)) {
      results.push({ field, change: def.required ? "added-required" : "added-optional",
                     compatible: !def.required });
    }
  }
  for (const [field, def] of Object.entries(v1)) {
    if (!(field in v2)) {
      results.push({ field, change: "removed", compatible: false });
    } else {
      const n = v2[field];
      if (!def.required && n.required) {
        results.push({ field, change: "became-required", compatible: false });
      } else if (def.required && !n.required) {
        // required → optional: SAFE (widening the contract)
        results.push({ field, change: "became-optional", compatible: true });
      } else if (def.type !== n.type) {
        results.push({ field, change: `type-changed(${def.type}->${n.type})`, compatible: false });
      } else {
        results.push({ field, change: "unchanged", compatible: true });
      }
    }
  }
  return results;
}

const v2 = {
  id:          { type: "string", required: true  },
  name:        { type: "string", required: true  },
  email:       { type: "string", required: false }, // was required — now optional: SAFE
  score:       { type: "number", required: false }, // new optional: SAFE
};

const v1 = {
  id:    { type: "string", required: true  },
  name:  { type: "string", required: true  },
  email: { type: "string", required: true  },
};

const diffs = diffSchemas(v1, v2);
for (const d of diffs) {
  console.log(`${d.compatible ? "[OK]" : "[BREAK]"} ${d.field}: ${d.change}`);
}
const breaking = diffs.filter(d => !d.compatible);
console.log(breaking.length === 0 ? "COMPATIBLE" : "BREAKING: " + breaking.map(d => d.field).join(", "));
// Making email optional is a widening change — compatible.
// Adding score optional — compatible.
```

Making `required → optional` is a *widening* of the contract: new readers accept old data that
has the field, and the contract is now less strict. Old readers that validated `required` might
reject new optional responses, which is a client-side concern but not a protocol break.
</details>

## Common pitfalls

> [!PITFALL]
> **The "compatible on paper" trap:** Adding an optional field is schema-compatible, but if every
> downstream service has an `if (Object.keys(body).length !== expectedCount)` guard (common in
> security-hardened microservices), your "compatible" change is still a breaking one. Contract
> tests catch this; schema diffs alone do not.

Enum exhaustion is another common trap: you add a new enum value thinking it's additive, but
every consumer with an exhaustive `switch` / `match` throws an unhandled case error. Always add
a catch-all `default`/`UNKNOWN_VALUE` to enums you control, and document that consumers MUST
handle unknown values.

## What you learned

- **Backward compatibility** = new code handles old data; **forward compatibility** = old code
  handles new data. Production deployments require both.
- The expand/contract pattern gives you a zero-downtime path for any migration.
- Protobuf and Avro have precise evolution rules: field numbers are forever, every reader-added
  field needs a default, unknown fields must be preserved.
- Hyrum's Law: your *observed* surface is larger than your *documented* surface. Contract tests
  are the mitigation.
- Sunset/Deprecation headers and schema registries are operational necessities, not nice-to-haves.

## Next steps

Schema compatibility is half the story. The other half is proving your API actually satisfies
what your consumers depend on — that's the job of consumer-driven contract testing with Pact,
covered next.
*/});
