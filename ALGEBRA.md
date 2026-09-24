# Algebra — EffectSpec\<I, S, W\> v0 (frozen)

## Spec (public algebra)

```ts
type Observation<S, W> = { state: S; witness: W }

type EffectSpec<I, S, W> = {
  observe(input: I): Result<Observation<S, W>, ObserveError>
  check(input: I, state: S): Result<void, DeniedReasons>
  write(input: I, witness: W): Result<void, WriteFailure>
}
```

| Parameter | Responsibility |
|---|---|
| **S** | Knowledge sufficient to **decide** |
| **W** | Evidence sufficient to **execute** against the world that was decided upon |

Runtime (not EffectSpec): freshness, vault, sealed write port.  
Outside the algebra: `parse` / schema / `policies[]` / `all()`.

Facade: `propose → prepare → commit`.

## Domain mapping (v0)

| Domain | S (decide) | W (execute) |
|---|---|---|
| Transfer | balances, active flags | `fromVersion` |
| Refund | status, amount | `version` |
| Reserve | available qty | `version` |

`write` never receives full `S`.

## Reduction rule (falsifiable)

> A type parameter is **not** eliminated when its information or responsibility is merely absorbed by another parameter.

Green tests alone do not count as a successful reduction. Semantic displacement = **FAIL**.

---

## Kill 1 — eliminate S

Proposed:

```ts
type EffectSpec<I, W> = {
  observe(input: I): Result<W, ObserveError>
  check(input: I, witness: W): Result<void, DeniedReasons>
  write(input: I, witness: W): Result<void, WriteFailure>
}
```

### Attempt (transfer)

To keep `sufficientBalance` / `accountActive`, W must become:

```ts
W = {
  fromBalance: number
  fromActive: boolean
  toActive: boolean
  fromVersion: number  // still needed for CAS
}
```

That is **W := S × W_cas**, not elimination of S.

| Domain | What leaked into W | Verdict |
|---|---|---|
| Transfer | balance, active | **FAIL** — displacement |
| Refund | status, amount | **FAIL** — displacement |
| Reserve | available | **FAIL** — displacement |

**PASS criterion (not met):** W remains *only* evidence required for correct conditional execution.

---

## Kill 2 — eliminate W

Proposed:

```ts
type EffectSpec<I, S> = {
  observe(input: I): Result<S, ObserveError>
  check(input: I, state: S): Result<void, DeniedReasons>
  write(input: I, state: S): Result<void, WriteFailure>
}
```

### Attempt (transfer)

`write` needs a concurrency token. S becomes:

```ts
S = {
  balance: number
  active: boolean
  version: number  // only for write / CAS
}
```

`check` does not need `version`. Absorbing it into S is **S := S_decide × W**.

| Domain | What leaked into S | Verdict |
|---|---|---|
| Transfer | `version` for CAS | **FAIL** — displacement |
| Refund | `version` for CAS | **FAIL** — displacement |
| Reserve | `version` for CAS | **FAIL** — displacement |

**PASS criterion (not met):** S remains *only* information required to decide.

---

## Conclusion

Both kills fail by semantic displacement in all three domains.

```text
                 observe
                    │
                    ▼
              Observation
               /         \
              S           W
              │           │
           decide      execute
              │           │
              ▼           ▼
            check        write
```

**Claim (v0):**

> An effect requires two distinct forms of knowledge: state sufficient to decide, and evidence sufficient to execute against the state that was decided upon.

`propose → prepare → commit` is the facade. **S / W is the model.**

`EffectSpec<I, S, W>` is **frozen at v0**. Next product question (later): what formal property this expresses — not more domain fixtures.
