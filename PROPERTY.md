# PROPERTY — candidate safety claim (draft)

Status: **analysis spike — destroy the claim, do not grow the API.**  
Frozen API: `BoundarySpec<I, S, W>` v0 (see [ALGEBRA.md](./ALGEBRA.md)).

---

## 1. Assumptions

1. Composition root injects `write` into `createBoundary`; application/agent code does not receive raw write authority.
2. `Executable` is opaque and single-use (runtime vault).
3. `observe(I) → Observation<S, W> = { state: S, witness: W }` — types only guarantee **co-production**, not semantic coverage.
4. `check(I, S)` is pure; decides from `S` only.
5. `write(I, W)` is the only mutation path on the effect handle.
6. Backend may offer CAS / ETag / revision / conditional txn of varying strength.
7. Coverage of decision-relevant state by `W` is an **adapter obligation**, not inferred by the algebra.

---

## 2. Attack 0 — co-production ≠ coverage (primary)

The algebra says:

```text
observe(I) → (S₀, W₀)
```

Types guarantee only that `S₀` and `W₀` **came out of the same observe**. They do **not** guarantee that `W₀` protects whatever subset of `S₀` made `check` return Allow.

### Counterexample

```text
S₀ = { balance: 150, accountStatus: ACTIVE }
W₀ = { balanceVersion: 42 }

check:
  balance >= 100        ✓
  accountStatus = ACTIVE ✓
```

Then only:

```text
accountStatus → BLOCKED
```

If that change does **not** invalidate `balanceVersion`:

```text
write(I, W₀) → SUCCESS
```

Types OK. Vault OK. Binding OK. CAS OK.  
Effect still commits under a **false decision premise**.

### Consequence

The strong property is not merely:

> decision bound to observation

but:

> decision bound to evidence that **covers** the decision-relevant observation.

**Rupu’s current algebra cannot infer that coverage.** That does not kill Rupu; it **delimits** it.

---

## 3. Two layers (keep separate forever)

```text
RUPU (structural)
────────────────
Allow(S₀)
   ↓
seal(I, W₀)
   ↓
only sealed W₀ can reach write
(app never holds raw write port;
 Executable opaque / single-use)

ADAPTER / BACKEND
────────────────
Coverage(S₀, check, W₀)
   ↓
conditional write atomically validates W₀
```

### Coverage premise (formal obligation, not API)

```text
Coverage(S₀, check, W₀)
```

Informally: every dependency of `check` that was load-bearing for Allow is protected by the precondition encoded in `W₀` (under the backend’s concurrency model).

We do **not** put `Coverage` into `BoundarySpec` v0. It is a proof obligation on adapters.

---

## 4. What Rupu does **not** claim

| Non-claim | Why |
|---|---|
| Decision is correct | `check` is app policy |
| External system hasn’t changed | Changes are expected |
| `S₀ ==` current full state | Only `W`-protected correspondence |
| `W` proves the decision was right | `S` decided; `W` constrains execution |
| Coverage is type-checked | Attack 0 |
| Store atomicity | Belongs to Dynamo/Postgres/… |
| Multi-object atomicity in general | See §6 |

---

## 5. Resilient formulation (preferred over marketing)

**Structural (Rupu alone):**

> For a single sealed executable, Rupu preserves the witness produced with the authorized observation as the sole execution evidence available through the effect API.

**Full property (Rupu + adapter obligations):**

> For a single sealed executable, Rupu preserves the witness produced with the authorized observation as the sole execution evidence. **If** that witness faithfully covers the decision-relevant state (`Coverage(S₀, check, W₀)`) **and** the backend atomically enforces it, **then** the effect cannot successfully commit after that protected state becomes stale.

Less catchy. Much harder to destroy.

Informal name (still not branded): *observation-bound write authority under coverage*.

Operational picture **when Coverage holds**:

```text
decision(S₀)
      │
      └── authority bound to W₀
                │
      protected state changes
                │
           W₀ invalidated
                │
          write fails / Stale
```

When Coverage **fails**, only the structural half remains: you still cannot call unlocked `repository.update` through the facade — but a “successful” CAS may still realize a decision whose premises died on uncovered fields.

---

## 6. Attack 1 — multi-object / protected resource set

```text
transfer A → B
S = { A, B }
W = { aVersion: 7, bVersion: 12 }
```

Suppose `check` depends on both, but the backend can CAS **only A**.

Then `W` is not “a token”; it is **evidence over a protected resource set**, and the question becomes:

> Can that set be validated **atomically** with respect to the effect?

### Degrade explicitly (do not fix with frameworkitis)

| Backend reality | Rupu stance |
|---|---|
| Single-key CAS covering all check deps | Full property available under Coverage |
| Multi-key without atomic multi-CAS | **Degrade**: document partial coverage / “best-effort OCC on subset”; do **not** add 2PC, locks, sagas into the core |
| Need distribute atomicity | Out of scope — another system |

Adding distributed transactions to “save” the slogan is exactly the framework creep this spike avoids.

---

## 7. Relation to OCC — provisional uncomfortable conclusion

Optimistic concurrency remains the **concurrency mechanism**.

Candidate novelty of Rupu Effect is making this error path hard:

```text
AI/app decides
       ↓
decision escapes
       ↓
later: repository.update(...)
```

and forcing instead:

```text
observe → (S, W) → check(S) → seal(W) → write(W)
```

That is: **structure authority so it can only arrive at OCC with a sealed witness**, with S/W split and no app write port.

Still an interesting thesis for a small TS library — **not purchased yet**. It must survive:

1. Coverage attack (done: delimits claim; Coverage as obligation)  
2. Multi-object atomicity (done: force explicit degradation, no 2PC in core)

If a **useful** sentence remains after both, we have more than a slogan. If it collapses to “please use If-Match,” say so and keep only the capability/DX packaging.

---

## 8. Status table

| Layer | Status |
|---|---|
| API `BoundarySpec<I,S,W>` | **Frozen v0** — stop touching |
| Structural binding | Spike-supported (threat model in NOTES) |
| Coverage | **Obligation**, not algebra |
| Multi-object | **Degrade** when no atomic protected set |
| Named product property | Deferred until claim stops shrinking |

### Next (paper only)

Done below in §9–§10. Remaining: keep falsifying §5; no API/code changes.

---

## 9. Coverage checklists (spike adapters)

Rule: list every **load-bearing** dependency of `check`. For each, say whether `W` invalidates when it changes, or whether `write` re-validates it another way. If neither → **Coverage FAIL**.

### 9.1 Transfer (`createTransferBoundary` + `FakeBank`)

| check dependency | In `W`? | Invalidates `fromVersion`? | Re-checked in `transferCAS`? | Coverage? |
|---|---|---|---|---|
| `from.balance` | no | yes, if only mutated via `transferCAS` (bumps version) | yes (`insufficient`) | **OK under closed world** |
| `from.active` | no | **not modeled** (no `blockAccount` in spike) | yes (`inactive`) | **rescued by write-time check**, not by `W` |
| `to.active` | no | **not modeled** / `to.version` not in `W` | yes (`inactive`) | **rescued by write-time check**; `to` not in CAS token |

Honest adapter blurb:

> Structural Rupu binding applies. Full stale-decision protection holds for fields that either bump `fromVersion` or are re-checked inside `transferCAS`. Account status flips that bypass versioning are **not** covered by `W`; today they are only caught if `write` re-reads them. `to.*` is not part of the CAS witness.

**Verdict:** spike transfer is **partial Coverage** — hybrid OCC + write-time asserts. Attack 0 (`status` vs `balanceVersion`) would apply if we added `setActive` without version bump and removed the inactive check from `write`.

### 9.2 Refund (`createRefundBoundary`)

| check dependency | In `W`? | Version bump on change? | Re-checked in `refundOnce`? | Coverage? |
|---|---|---|---|---|
| `status == CAPTURED` | no (`W={version}`) | yes on refund; **no other status mutator in spike** | yes | OK under closed world |
| `amount` match | no | amount immutable in spike | yes | OK under closed world |

Honest blurb:

> Coverage holds if payment rows only change status/amount through versioned writers. A silent `status=VOID` without version bump breaks Coverage even though Rupu structure is intact.

### 9.3 Reserve (`createReserveBoundary`)

| check dependency | In `W`? | Version bump? | Re-checked in `reserveCAS`? | Coverage? |
|---|---|---|---|---|
| `available >= qty` | no | yes on reserve | yes (`insufficient_stock`) | OK under closed world |

Same pattern: Coverage = versioned single-row world + write-time assert.

### 9.4 Dynamo-style (sketch, not implemented)

Condition expression must mention **every** attribute `check` read for Allow (or a single atomic item version that bumps on any of those attributes).  
Attribute-level conditions that omit a check field = Attack 0.

---

## 10. Multi-object transfer — honest guarantee text

Intent: `transfer A → B`.  
`S` includes both accounts.  
Spike `W = { fromVersion }` — **only A** is CAS-protected.

### What we may say

**Rupu structural:** Allow cannot reach write except via sealed `fromVersion`.

**External under Coverage (narrow):** Successful CAS implies **A**’s version still matched. It does **not** by itself imply B was unchanged since observe, unless B’s relevant fields are also in an atomically validated set or re-checked in `write`.

### What we must not say

> “The transfer decision is atomic w.r.t. both accounts.”

That would require a protected resource set `{A,B}` validated in one atomic conditional write (or a transaction). FakeBank does not provide that; Rupu core will not grow 2PC to fake it.

### Degraded label (recommended for adapters)

```text
Guarantee class: single-key OCC + write-time predicates
Protected set:   { from.account } via version
Re-checked:      balances/active inside write
Not claimed:     atomic multi-account snapshot isolation
```

---

## 11. Residue after coverage + multi-object pressure

After Attack 0 and multi-object:

| Claim | Survives? |
|---|---|
| New concurrency primitive beyond OCC | **No** — OCC (or txn) still does atomicity |
| Algebra forces S≠W + sealed path to write | **Yes** (structural) |
| Full “stale decision cannot commit” | **Only if** Coverage + atomic protected set |
| Useful library thesis | **Maybe:** authority structuring into OCC, with **honest degradation labels** |

Still not purchased as “effect-correctness theorem.” Purchased as a **precise boundary**:

> Rupu makes unbound `repository.update` after an agent decision the unnatural path; it does not certify Coverage or multi-object atomicity.

Next falsification (still paper): **§12 — seal vs full re-check vs atomic `write(I)`**.

---

## 12. Attack 2 — is sealed `W₀` load-bearing?

Three commit designs. Ask in each: **what does the sealed Executable add that the backend does not already provide?**

### Spike reality (baseline)

Current runtime roughly:

```text
prepare: observe → (S₀,W₀); check(S₀); seal(W₀)
commit:  observe → (S₁,W₁); if W₁≠W₀ → Stale; write(I, W₀)
```

It does **not** re-run `check(S₁)`. Freshness is witness equality + whatever `write` asserts.

### Hypothetical kill: re-check then write `W₁`

```text
prepare: check(I,S₀)=Allow; seal(W₀)
commit:  observe → (S₁,W₁); check(I,S₁)=Allow; write(I, W₁)
```

Then `W₀` is not needed for commit correctness. The executed authorization is a **new** decision on `S₁`. `W₀` shrinks to attempt identity / audit at best. Seal stops being authority for execution.

That design abandons “prepare authority → commit” and becomes “commit re-authorizes.”

---

### Case A — `write(I, W₀)` with CAS only

```text
atomic (store):
  assert version == W₀.version
  mutate
```

| Question | Answer |
|---|---|
| Is `W₀` load-bearing? | **Yes** — without it, no conditional link to prepare |
| Is seal load-bearing? | **Yes** — prevents `write(I, callerWitness)` / unbound update |
| Backend alone? | OCC token; Rupu binds **who may present** that token |

**Seal + W₀ clear value.** Closest to “observation-bound authority” under Coverage.

---

### Case B — `write(I, W₀)` with CAS + all decision predicates

```text
atomic:
  assert version == W₀.version
  assert active
  assert balance >= amount
  mutate
```

(Spike `FakeBank.transferCAS` is in this family for several fields.)

| Question | Answer |
|---|---|
| Freshness of decision premises | Partly from **write-time asserts**, not only from `W₀` |
| Is `W₀` still needed? | **Weaker** for “premises still true”; still needed if CAS is the concurrency hinge |
| Is seal still needed? | **Yes for authority** — even a perfect atomic write must not be callable with a caller-minted witness or from a free-floating decision |

**W₀ loses some freshness role; seal still structures prepare→authority→commit.**

Without seal you can still do:

```text
write(input, callerSuppliedWitness)  // or write that ignores prepare
```

Write may be safe w.r.t. *current* state, but the property

> only authority derived from that preparation may attempt the effect

is gone.

---

### Case C — atomic `write(I)` (maximum danger)

```text
write(input): Result<void, Denied | WriteFailure>

atomic {
  read current state
  check all predicates
  mutate
}
```

Then hypothetically:

| Piece | Status |
|---|---|
| `S` in algebra | optional / decorative |
| `W` | optional |
| `observe` / `prepare` | ceremony |
| sealed Executable | capability theater if anyone can call `write(I)` |

**If the backend can do C, Rupu collapses toward capability/DX around a well-designed transaction.**

That is **not** project failure. It locates Rupu:

> **Rupu Effect has value when the decision happens outside the transactional boundary of the effect.**

---

### Why agents make A/B (not C) the interesting zone

You generally cannot put this inside one DB transaction:

```text
BEGIN;
  read;
  LLM / tools think for seconds or minutes;
  human approval?;
  network hop?;
COMMIT;
```

The deferred path is exactly:

```text
observe → (S,W) → check(S) → [time / agent / delay] → seal(W) → write(W)
```

So:

| World | Rupu role |
|---|---|
| Decision ⊂ same atomic txn as mutate (Case C available) | Thin / maybe unnecessary |
| Decision **before** and **outside** mutate (agents, jobs, HITL) | Structural binding to `W₀` is the point |

---

### Prediction table

| Case | Seal value | W₀ value | Thesis pressure |
|---|---|---|---|
| **A** CAS only | high | high | supports observation-bound authority |
| **B** CAS + predicates | high (authority) | medium (freshness shared with write) | seal survives; Coverage hybrid |
| **C** atomic write(I) | low unless write is still sealed | low | thesis → deferred-decision niche or DX-only |

### Spike placement

FakeBank transfer ≈ **B** (CAS on `fromVersion` + balance/active checks in write).  
Runtime seal ≈ authority path for **A/B**.  
We have **not** implemented Case C as the happy path — and should not “win” by pretending C needs Rupu.

### Residue after Attack 2

Useful claim that still stands pressure:

> When authorization cannot live inside the effect’s atomic write, Rupu makes the unnatural path “decide, then later `repository.update`” and the natural path “carry sealed witness into conditional write.”

Vacuous if every interesting effect can be Case C.  
Non-vacuous for agent/deferred pipelines — **the intended niche**.

Still not a new concurrency theorem. Still possibly a **small TS primitive for deferred effect authority**.

Freeze: `@rupu/boundary@0.1.0` — local T1 capability; research stop. See README.
