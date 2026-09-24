# EXPERIMENT — Temporal + safeRefund vs Temporal + Rupu

Status: **executed.** App handle = `propose/prepare/commit` only (`evaluate` gated to `createBoundaryForTests`).  
Threat model **T1:** write client sealed at composition root; Activity sees only `BoundaryHandle` + `Executable`.

Do not inflate wins by counting mutation rows. Evidence = **four independent properties**.

---

## Survived (local / same-process, T1)

| Property | Meaning | Spike |
|---|---|---|
| **Provenance** | Commit accepts only authority from `prepare → observe → check → seal` | Yes (no public `evaluate`) |
| **Binding** | Authority carries sealed `I`/`W` from that prepare | Yes (vault body) |
| **Consumption** | Authority not freely reusable | Yes (single-use vault) |
| **Mandatory protocol** | `commit` cannot skip observe→witnessEq→write | Yes |

`#3/#4/#5` in the old mutation table are faces of capability — not three separate products.

**Not claimed:** world freshness, Coverage, cross-system TOCTOU, ambient Stripe prevention, backend atomicity.

Product sentence (local T1):

> TypeScript capability protocol for deferred effects: binds a prepared decision to sealed evidence and keeps app code that only holds `BoundaryHandle` from turning that decision into unrestricted write authority (write sealed at composition root).

---

## Bypass

| Setup | Grade |
|---|---|
| Ambient Stripe/write client | **Trivial** → discipline only |
| T1 sealed write port | **Difficult** |

---

## Frozen conclusions

| Thesis | Status |
|---|---|
| **Authority primitive (local T1)** | **Survived** vs `safeRefund` |
| **Durable-authority (cross-process)** | **Untested** — see [DURABLE-AUTHORITY.md](./DURABLE-AUTHORITY.md) |

The niche that justifies Rupu (HITL / 6h / other worker) is exactly where the in-memory vault **fails**. That is the next kill-test — not more OCC comparisons.
