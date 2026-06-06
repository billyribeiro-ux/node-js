registerLessonSrc("29-sagas", function () {/*
---
id: 29-sagas
title: "Sagas & Distributed Transactions"
minutes: 30
level: principal
objectives:
  - Explain why traditional two-phase commit fails at scale and what replaces it
  - Design sagas using both choreography and orchestration patterns
  - Implement compensating transactions, idempotency keys, and the outbox pattern
---

# Sagas & Distributed Transactions

## Why this matters

Every non-trivial business workflow touches more than one service: placing an order reserves inventory, charges a card, and sends a confirmation email. If the charge succeeds but the reservation fails, you have oversold. If the email fires before the payment clears, you have a support nightmare. In a monolith you would wrap this in a database transaction. In a distributed system, you have no shared transaction manager. The **saga pattern** is the industry-standard solution, and understanding it is the difference between a system that is eventually consistent by design and one that is corrupt by accident.

## Learning objectives

- Explain why **two-phase commit (2PC)** does not scale and what problems it leaves behind.
- Design sagas using **choreography** (event-driven) and **orchestration** (central coordinator).
- Write **compensating transactions** that cleanly undo completed steps.
- Apply **idempotency keys** so retried messages never cause duplicate side effects.
- Understand the **outbox pattern** for reliable event publishing.

## Why distributed transactions are hard

In a single relational database, `BEGIN / COMMIT / ROLLBACK` gives you atomicity for free. In a microservices architecture, "Order DB", "Inventory DB", and "Payments DB" are owned by different services and may be entirely different database engines.

**Two-phase commit (2PC)** was designed to solve this:
1. A coordinator asks each participant "can you commit?" — all say yes or one says no.
2. If all agree, coordinator sends "commit"; otherwise "rollback".

2PC works, but it has fatal properties at scale:
- **Blocking** — if the coordinator crashes between phase 1 and phase 2, participants are locked in limbo holding their locks.
- **Latency** — every operation takes at least two network round-trips synchronously.
- **Availability** — if any participant is unreachable, the whole transaction stalls.
- **Heterogeneous stores** — a Kafka topic and a Postgres database cannot participate in the same 2PC coordinator.

Most distributed systems instead embrace **eventual consistency**: the system may be temporarily inconsistent, but given time (and correct compensations when things go wrong), it reaches a correct final state.

> [!PRINCIPAL] Eventual consistency is a choice, not a fallback
> Choosing eventual consistency means shifting complexity from the database layer into your application logic. You must define what "correct final state" means for every failure scenario, write compensating actions for every step that can succeed-but-later-need-undoing, and build the observability to detect when something is stuck. This is harder to think through, but it scales horizontally and survives partial outages that 2PC cannot.

## The saga pattern

A **saga** is a sequence of local transactions, each within a single service, linked by messages or events. If a step fails, previously completed steps are undone via **compensating transactions**.

```
Step 1: Reserve inventory  ──► Step 2: Charge payment  ──► Step 3: Create shipment
                                          │ FAIL
                                          ▼
                               Compensate step 1: Release reservation
```

Each step either succeeds (and publishes a message triggering the next step) or fails (triggering compensations in reverse order for all already-completed steps).

### Choreography

In **choreography**, each service listens for events and decides what to do next. There is no central brain.

```
OrdersService       InventoryService      PaymentsService       ShippingService
     │                    │                     │                     │
     │── order.created ──►│                     │                     │
     │                    │── stock.reserved ──►│                     │
     │                    │                     │── payment.charged ──►│
     │                    │                     │                     │── shipment.created
```

If `payment.charged` fails, `PaymentsService` emits `payment.failed`, and `InventoryService` listens for that event and releases the reservation.

**Pros:** No central point of failure, services are loosely coupled, easy to add new participants.

**Cons:** The workflow logic is spread across multiple codebases — hard to see the whole picture, debugging a stuck saga requires correlating events across services.

### Orchestration

In **orchestration**, a central **saga orchestrator** knows the full sequence and tells each service what to do via commands.

```
          ┌────────────────────────────────────────┐
          │          SagaOrchestrator              │
          │                                        │
          │  [1] reserve   [2] charge   [3] ship   │
          └────────┬────────────┬──────────┬───────┘
                   │            │          │
             Inventory     Payments    Shipping
```

If step 2 fails, the orchestrator explicitly calls the compensation for step 1.

**Pros:** Workflow logic lives in one place, easier to monitor and debug, easy to add retries and timeouts per step.

**Cons:** The orchestrator is a new service to build, operate, and avoid making a distributed monolith.

> [!NOTE] Prefer orchestration for complex sagas
> When a saga has more than 3-4 steps, branching logic, or retry requirements per step, orchestration pays for itself. For simple 2-step sagas (reserve + charge), choreography may be simpler. Most teams start with choreography and migrate to orchestration when debugging becomes painful.

## Compensating transactions

A compensating transaction undoes the logical effect of a completed step. It is **not** a database rollback — it is new business logic that produces the opposite result.

| Step | Compensation |
|---|---|
| Reserve inventory | Release reservation |
| Charge payment | Issue refund |
| Create shipment | Cancel shipment |
| Send email | (cannot un-send — log and alert) |

> [!PITFALL] Not all actions can be compensated
> Sending an email, firing a push notification, or triggering a third-party webhook cannot be undone. Design your saga so these steps happen last (after all reversible steps have committed) or use a "pending" state that the user only sees after everything succeeds.

## Idempotency

In a distributed system, messages can be delivered more than once (network retries, at-least-once delivery semantics). Every step and every compensation must be **idempotent** — running it twice must produce the same outcome as running it once.

The standard technique: use a **client-generated idempotency key** (a UUID tied to the saga and step). Before executing, check whether you have already processed this key. If yes, return the previous result without re-executing.

```js
// Conceptual idempotency guard
async function idempotentStep(key, fn, store) {
  const existing = await store.get(key);
  if (existing !== undefined) {
    console.log(`[idempotency] key ${key} already processed, returning cached result`);
    return existing;
  }
  const result = await fn();
  await store.set(key, result);
  return result;
}
```

## The outbox pattern

A service needs to: (1) update its own database, and (2) publish an event. These are two separate I/O operations. If the service crashes after the DB update but before publishing, the event is lost. If it publishes before updating the DB and then crashes, the event fires with no backing state.

The **outbox pattern** solves this with a single atomic operation:
1. Write the DB change **and** the outgoing event to an `outbox` table in the **same transaction**.
2. A separate "relay" process polls the outbox table and publishes events to the message broker, deleting or marking rows as sent.

```js
// Conceptual — within a single DB transaction:
// BEGIN
//   INSERT INTO orders (id, status) VALUES ($1, 'placed')
//   INSERT INTO outbox (event_type, payload) VALUES ('order.placed', $2)
// COMMIT
// -- A relay reads outbox and publishes to Kafka/RabbitMQ/etc.
```

The relay publishes with at-least-once semantics — consumers must be idempotent (see above). But the DB transaction guarantees the event is never silently lost.

## Try it yourself

A saga orchestrator that executes steps in sequence and runs compensations in reverse order on failure.

```js run
// Saga orchestrator — pure JS, fully runnable

function createSagaOrchestrator(steps) {
  // steps: [{ name, execute, compensate }]
  return {
    async run(context) {
      const completed = [];

      for (const step of steps) {
        try {
          console.log(`[saga] executing: ${step.name}`);
          const result = await step.execute(context);
          context[step.name] = result;
          completed.push(step);
          console.log(`[saga] succeeded: ${step.name} ->`, result);
        } catch (err) {
          console.log(`[saga] FAILED at: ${step.name} — ${err.message}`);
          console.log(`[saga] starting compensations (${completed.length} to undo)`);

          // Compensate in reverse order
          for (let i = completed.length - 1; i >= 0; i--) {
            const doneStep = completed[i];
            try {
              await doneStep.compensate(context);
              console.log(`[saga] compensated: ${doneStep.name}`);
            } catch (compErr) {
              // Compensation failures must be alarmed on — manual intervention needed
              console.log(`[saga] COMPENSATION FAILED: ${doneStep.name} — ${compErr.message}`);
            }
          }
          return { ok: false, failedAt: step.name, error: err.message };
        }
      }

      return { ok: true, context };
    }
  };
}

// --- Order placement saga ---

// Simulated "databases" as plain objects
const inventory = { "item-42": 10 };
const charges   = [];
const shipments = [];

const orderSaga = createSagaOrchestrator([
  {
    name: "reserveInventory",
    async execute(ctx) {
      if (inventory[ctx.itemId] < ctx.quantity) throw new Error("out of stock");
      inventory[ctx.itemId] -= ctx.quantity;
      return { reservationId: `res-${Date.now()}`, item: ctx.itemId, qty: ctx.quantity };
    },
    async compensate(ctx) {
      inventory[ctx.itemId] += ctx.reserveInventory.qty;
      console.log(`  [inventory] released reservation for ${ctx.reserveInventory.qty}x ${ctx.itemId}`);
    }
  },
  {
    name: "chargePayment",
    async execute(ctx) {
      if (ctx.paymentMethod === "declined") throw new Error("card declined");
      const charge = { chargeId: `chg-${Date.now()}`, amount: ctx.amount };
      charges.push(charge);
      return charge;
    },
    async compensate(ctx) {
      const idx = charges.findIndex(c => c.chargeId === ctx.chargePayment.chargeId);
      if (idx !== -1) charges.splice(idx, 1);
      console.log(`  [payments] refunded charge ${ctx.chargePayment.chargeId}`);
    }
  },
  {
    name: "createShipment",
    async execute(ctx) {
      const shipment = { shipmentId: `shp-${Date.now()}`, address: ctx.address };
      shipments.push(shipment);
      return shipment;
    },
    async compensate(ctx) {
      const idx = shipments.findIndex(s => s.shipmentId === ctx.createShipment.shipmentId);
      if (idx !== -1) shipments.splice(idx, 1);
      console.log(`  [shipping] cancelled shipment ${ctx.createShipment.shipmentId}`);
    }
  }
]);

async function main() {
  console.log("=== Scenario 1: Happy path ===");
  const ctx1 = {
    itemId: "item-42", quantity: 2, paymentMethod: "visa",
    amount: 59.99, address: "123 Main St"
  };
  const r1 = await orderSaga.run(ctx1);
  console.log("result:", r1.ok ? "SUCCESS" : `FAILED at ${r1.failedAt}`);
  console.log("inventory remaining:", inventory["item-42"]);
  console.log("charges:", charges.length);
  console.log("shipments:", shipments.length);

  console.log("\n=== Scenario 2: Payment failure (compensation runs) ===");
  const ctx2 = {
    itemId: "item-42", quantity: 3, paymentMethod: "declined",
    amount: 89.99, address: "456 Oak Ave"
  };
  const r2 = await orderSaga.run(ctx2);
  console.log("result:", r2.ok ? "SUCCESS" : `FAILED at ${r2.failedAt}: ${r2.error}`);
  console.log("inventory remaining (should be same as after scenario 1):", inventory["item-42"]);
}

main();
```

## Exercise

**Challenge:** Add a fourth step, `sendConfirmationEmail`, that always succeeds (emails can't be unsent). Its compensation should log a warning message instead of attempting a real undo. Run a scenario where `createShipment` fails — verify that `chargePayment` and `reserveInventory` are compensated but the email step was never reached.

<details>
<summary>Show solution</summary>

```js run
function createSagaOrchestrator(steps) {
  return {
    async run(context) {
      const completed = [];
      for (const step of steps) {
        try {
          const result = await step.execute(context);
          context[step.name] = result;
          completed.push(step);
        } catch (err) {
          console.log(`[saga] FAILED at: ${step.name} — ${err.message}`);
          for (let i = completed.length - 1; i >= 0; i--) {
            await completed[i].compensate(context);
          }
          return { ok: false, failedAt: step.name, error: err.message };
        }
      }
      return { ok: true, context };
    }
  };
}

const inventory = { "item-1": 5 };
const charges   = [];

const saga = createSagaOrchestrator([
  {
    name: "reserveInventory",
    async execute(ctx) {
      inventory[ctx.itemId] -= ctx.qty;
      console.log(`  [inventory] reserved ${ctx.qty}`);
      return { qty: ctx.qty };
    },
    async compensate(ctx) {
      inventory[ctx.itemId] += ctx.reserveInventory.qty;
      console.log(`  [inventory] released ${ctx.reserveInventory.qty} (compensation)`);
    }
  },
  {
    name: "chargePayment",
    async execute(ctx) {
      const c = { chargeId: "chg-1", amount: ctx.amount };
      charges.push(c);
      console.log(`  [payments] charged $${ctx.amount}`);
      return c;
    },
    async compensate(ctx) {
      const idx = charges.findIndex(c => c.chargeId === ctx.chargePayment.chargeId);
      if (idx !== -1) charges.splice(idx, 1);
      console.log(`  [payments] refunded (compensation)`);
    }
  },
  {
    name: "createShipment",
    async execute() {
      throw new Error("shipping service unavailable");
    },
    async compensate() {
      console.log(`  [shipping] nothing to compensate (step never completed)`);
    }
  },
  {
    name: "sendConfirmationEmail",
    async execute(ctx) {
      console.log(`  [email] sent confirmation`);
      return { sent: true };
    },
    async compensate() {
      // Cannot unsend an email — log a warning, alert on-call
      console.log(`  [email] WARNING: email already sent — cannot compensate; alert on-call`);
    }
  }
]);

async function main() {
  console.log("=== Saga with shipping failure ===");
  const r = await saga.run({ itemId: "item-1", qty: 2, amount: 29.99 });
  console.log("\nresult:", r.ok ? "SUCCESS" : `FAILED at ${r.failedAt}: ${r.error}`);
  console.log("inventory:", inventory["item-1"], "(should be 5 — reservation released)");
  console.log("charges:", charges.length, "(should be 0 — refunded)");
}

main();
```

</details>

## Project

**Decompose your monolith into 3-4 services communicating via queue and gRPC behind an API gateway.**

Design and implement a simulated microservices platform using the patterns from this module. The project is deliberately backend-logic-only (no real HTTP servers required) so you can focus on the distributed systems concepts.

### Acceptance criteria

1. **Service definitions.** Implement at least three services as JavaScript classes or factory functions: `OrderService`, `InventoryService`, and `PaymentService`. Each service owns its own in-memory "database" (a plain Map or array) and exposes a narrow API. No service directly reads another's data.

2. **Saga orchestrator.** A `SagaOrchestrator` class drives the order-placement workflow: reserve inventory → charge payment → confirm order. It tracks completed steps and runs compensating transactions in reverse on failure.

3. **Simulated message queue.** An in-memory `MessageQueue` class supports `publish(topic, message)` and `subscribe(topic, handler)`. Use it for at least one async step (e.g., sending the order confirmation event after the saga succeeds).

4. **Idempotency.** Each service method accepts an idempotency key. If the same key is seen twice, return the cached result without re-executing side effects. Demonstrate this by calling a service method twice with the same key.

5. **API gateway function.** A `gateway(request)` function accepts a plain-object request, routes it to the correct saga, and returns a normalised response `{ ok, data, error }`. This simulates the single entry-point a real gateway provides.

6. **Failure scenario.** Demonstrate at least one failure path (e.g., insufficient inventory or declined payment) where the saga runs compensations and the gateway returns a meaningful error response.

### Starter

```js run
// Saga orchestrator core — expand this into the full project

class SagaOrchestrator {
  constructor(steps) {
    this.steps = steps; // [{ name, execute, compensate }]
  }

  async run(context) {
    const completed = [];

    for (const step of this.steps) {
      try {
        console.log(`[saga] -> ${step.name}`);
        const result = await step.execute(context);
        context[`_${step.name}`] = result;
        completed.push(step);
      } catch (err) {
        console.log(`[saga] FAILED: ${step.name} (${err.message})`);
        for (let i = completed.length - 1; i >= 0; i--) {
          try {
            await completed[i].compensate(context);
            console.log(`[saga] compensated: ${completed[i].name}`);
          } catch (compErr) {
            console.log(`[saga] COMPENSATION ERROR: ${completed[i].name} — needs manual fix`);
          }
        }
        return { ok: false, failedAt: step.name, error: err.message };
      }
    }

    return { ok: true, context };
  }
}

// Simple in-memory message queue
class MessageQueue {
  constructor() {
    this.subscribers = new Map(); // topic -> [handler]
  }

  subscribe(topic, handler) {
    if (!this.subscribers.has(topic)) this.subscribers.set(topic, []);
    this.subscribers.get(topic).push(handler);
  }

  async publish(topic, message) {
    const handlers = this.subscribers.get(topic) || [];
    for (const handler of handlers) {
      await handler(message);
    }
  }
}

// Idempotency guard
function withIdempotency(store) {
  return async function idempotent(key, fn) {
    if (store.has(key)) {
      console.log(`[idempotency] key "${key}" already processed`);
      return store.get(key);
    }
    const result = await fn();
    store.set(key, result);
    return result;
  };
}

// --- Minimal wiring demo (expand each service into a full class) ---
const mq = new MessageQueue();
const idempotencyStore = new Map();
const guard = withIdempotency(idempotencyStore);

// Subscribe to the post-saga confirmation event
mq.subscribe("order.confirmed", (msg) => {
  console.log(`[email-service] sending confirmation for order ${msg.orderId}`);
});

// Simple inventory + payment stubs
const inventoryDb = new Map([["sku-1", 10]]);
const chargesDb   = [];

const orderSaga = new SagaOrchestrator([
  {
    name: "reserveInventory",
    async execute(ctx) {
      const stock = inventoryDb.get(ctx.sku) || 0;
      if (stock < ctx.qty) throw new Error(`insufficient stock: ${stock} < ${ctx.qty}`);
      inventoryDb.set(ctx.sku, stock - ctx.qty);
      return { sku: ctx.sku, qty: ctx.qty };
    },
    async compensate(ctx) {
      const r = ctx._reserveInventory;
      inventoryDb.set(r.sku, (inventoryDb.get(r.sku) || 0) + r.qty);
    }
  },
  {
    name: "chargePayment",
    async execute(ctx) {
      if (ctx.card === "declined") throw new Error("card declined");
      const charge = { id: `chg-${chargesDb.length + 1}`, amount: ctx.amount };
      chargesDb.push(charge);
      return charge;
    },
    async compensate(ctx) {
      const id = ctx._chargePayment?.id;
      const idx = chargesDb.findIndex(c => c.id === id);
      if (idx !== -1) chargesDb.splice(idx, 1);
    }
  }
]);

// API gateway
async function gateway(request) {
  if (request.action === "placeOrder") {
    const ctx = { sku: request.sku, qty: request.qty, amount: request.amount, card: request.card };
    const result = await orderSaga.run(ctx);
    if (result.ok) {
      const orderId = `ord-${Date.now()}`;
      await mq.publish("order.confirmed", { orderId, sku: ctx.sku });
      return { ok: true, data: { orderId } };
    }
    return { ok: false, error: result.error };
  }
  return { ok: false, error: "unknown action" };
}

// --- Demo ---
async function main() {
  console.log("=== Happy path ===");
  const r1 = await gateway({ action: "placeOrder", sku: "sku-1", qty: 3, amount: 99, card: "visa" });
  console.log("gateway:", r1);
  console.log("inventory left:", inventoryDb.get("sku-1"));

  console.log("\n=== Declined card — compensation runs ===");
  const r2 = await gateway({ action: "placeOrder", sku: "sku-1", qty: 2, amount: 49, card: "declined" });
  console.log("gateway:", r2);
  console.log("inventory after compensation:", inventoryDb.get("sku-1"), "(should be restored)");

  console.log("\n=== Idempotency demo ===");
  await guard("step-xyz", async () => { console.log("  executing step-xyz"); return "done"; });
  await guard("step-xyz", async () => { console.log("  THIS LINE SHOULD NOT PRINT"); return "done"; });
}

main();
```

## Common pitfalls

> [!PITFALL] Missing compensations for steps that can fail silently
> A common bug: the orchestrator marks a step complete but the downstream actually returned a 202 (accepted asynchronously). If the async work fails later, the orchestrator thinks the step succeeded and never compensates it. Always design steps to confirm final success before marking complete — use polling or callbacks, not just an initial acceptance ACK.

> [!PITFALL] Compensations that are not idempotent
> If a compensation is triggered twice (due to a message re-delivery), a non-idempotent compensation (like issuing a refund) runs twice. Every compensation must use its own idempotency key and guard.

## What you learned

- **2PC** provides strong consistency but blocks on coordinator failure and does not scale across heterogeneous stores.
- The **saga pattern** replaces 2PC with local transactions linked by messages; failures trigger **compensating transactions** in reverse.
- **Choreography** distributes workflow logic across services; **orchestration** centralises it in a coordinator for easier monitoring.
- **Idempotency keys** make every step and compensation safe to retry without duplicate side effects.
- The **outbox pattern** atomically pairs a DB change with an event publication, eliminating the "published but not saved / saved but not published" race.

## Next steps

With resilient, saga-powered services in place, the next challenge is observing them at scale: structured logging, distributed tracing, and metrics that let you find exactly where a saga stalled — topics we cover in the Observability module.
*/});
