# CASE-C SURVEY — where does Rupu live?

Status: **decisive kill-test (paper).** Not a product roadmap.  
API unchanged. `BoundarySpec<I,S,W>` untouched until this experiment decides buy/kill.

---

## 0. Prior stack (accepted)

Temporal does not kill Rupu; it shrinks it. Complementary:

```text
Temporal → eventually get here
Rupu     → does this decision still carry authority to mutate?
Backend  → enforce what it can protect
```

Immediate Level-2 recheck ≈ ceremony. Cross-system TOCTOU neither arm removes.

---

## 1. Methodological correction

Do **not** count vague “bugs.” For each deliberate programmer mutation, classify:

| Class | Meaning |
|---|---|
| **Eliminated by construction** | Impossible (or rejected) via public API / runtime invariants |
| **Made harder** | Possible but requires explicit escape / abuse |
| **No change** | Same as careful `safeRefund` |

Ceremony wins do not count as survival.

Same refund scenario, both arms. Same 6h / HITL / Temporal. Attacks are **programmer mutations**, not infra failures.

### Arm A — Temporal + `safeRefund`

```ts
async function safeRefund(intent: RefundIntent) {
  const customer = await crm.get(intent.customerId)
  const dispute = await disputes.get(intent.disputeId)
  if (!stillValid(customer, dispute)) return Denied
  return stripe.refunds.create({
    payment_intent: intent.paymentId,
    amount: intent.amount,
  })
}
```

### Arm B — Temporal + Rupu (conceptual)

```ts
const refund = createBoundary({ observe, check, write })
const executable = refund.prepare(proposal)
// ... 6h / HITL / workflow ...
return refund.commit(executable)
```

---

## 2. Mutation table (programmer attacks)

| Mutation | safeRefund | Rupu (current spike direction) | Real win? |
|---|---|---|---|
| Drop revalidation | trivial | commit imposes protocol | **by construction** (protocol) |
| Call Stripe directly | trivial if client in scope | only if composition root withholds client | **conditional** |
| Substitute `W₀` | programmer owns all fields | caller does not control sealed `W` | **by construction** |
| Replay consumed authority | trivial unless manual | vault single-use | **by construction** |
| Forge authority | ordinary objects | opaque Executable + vault | **by construction** |
| Mutate intent between approval/write | easy if mutable/rebuilt | only if `I` also sealed/bound | **must verify** |
| CRM changes after recheck | vulnerable | vulnerable | **no change** |
| Stripe timeout after commit | Unknown manual | already modeled | protocol/DX, weak win |
| Double Activity (retry) | needs idempotency | needs idempotency | **no change** |
| Underspecified `W` / Coverage hole | possible | possible | **no change** |
| Bad policy in `check` | possible | possible | **no change** |
| Raw credentials accessible | possible | possible | deployment, **no change** |

Interesting residue: careful code does **not** automatically get:

1. **Provenance** — commit only accepts authority created by prepare  
2. **Binding** — authority keeps `I`/`W` from that prepare  
3. **Consumption** — authority not freely reusable  
4. **Mandatory protocol** — no `commit` that skips the runtime protocol  

That is distinct from **freshness**.

---

## 3. Reframed core question

Wrong framing:

> Does Rupu make **state** safer?

Better:

> Does Rupu make **authority to produce the effect** safer?

```text
ordinary:   RefundIntent → any code with StripeClient → refund

Rupu:       Proposal → prepare → Executable
                              (originated here, bound I/W, single-use)
                         → commit → write
```

Less “OCC wrapper,” more **capability discipline for deferred effects** — *if* enforceable.

### Mandatory Bypass test

> What must a developer do to produce the **same effect** without going through Rupu?

| Grade | Meaning |
|---|---|
| Impossible by public API | strong |
| Difficult / explicit escape hatch | medium |
| Ordinary import away | weak |
| Trivial | **do not sell enforcement** |

If this works:

```ts
import { stripe } from "./stripe"
stripe.refunds.create(...)
```

then claim at most: **authority discipline inside the Rupu boundary**, not security enforcement.

If composition root can be:

```text
composition root
    ├── StripeClient ──► writePort ──► Rupu runtime
    └── application ──► BoundaryHandle (NO StripeClient)
```

then architectural teeth exist.

---

## 4. Survival bar (do not kill only if…)

Not “2–3 bugs harder.” Require **≥2 eliminated by construction** under declared threat model, e.g.:

| Required | Status to prove in experiment |
|---|---|
| Caller cannot forge Executable | ? |
| Caller cannot substitute witness | ? |
| Consumed Executable cannot be replayed | ? |
| Effect handle cannot bypass commit/write protocol | ? (needs sealed write port + no client leak) |

And admit clearly:

| Not claimed |
|---|
| ✗ prevent leaked raw write authority (if client leaks) |
| ✗ fix incomplete Coverage |
| ✗ eliminate cross-system TOCTOU |
| ✗ provide backend atomicity |

### If those hold — concrete product sentence

> Rupu Effect is a TypeScript **capability protocol for deferred effects**. It binds a prepared decision to the evidence required for execution and prevents application code from turning that decision into unrestricted write authority.

Then marketing:

> Probabilistic decisions. Deterministic effects.

### If experiment shows provenance / binding / consumption / mandatory protocol are not enforceable without trusting the app as much as `safeRefund`

→ **Kill as library.** Survive as **pattern / documentation.**

---

## 5. Experiment result

[EXPERIMENT.md](./EXPERIMENT.md): four properties survived **locally** under T1 (`evaluate` gated).  
Next: [DURABLE-AUTHORITY.md](./DURABLE-AUTHORITY.md) — vault vs process boundary (ephemeral / durable port / signed).

**Freeze:** Authority primitive thesis survived locally under T1. Durable-authority thesis: **untested**.
