# GENERALITY kill-test

## Question

Does `propose → prepare → commit` work only because `FakeBank` was tailored to the thesis, or can the **same** runtime express different effect natures?

## Method

One generic runtime (`createEffect<I,S>`). Three domain adapters that only swap:

| Piece | Transfer | Refund | Inventory reserve |
|---|---|---|---|
| schema / parse | from, to, amount | paymentId, amount | sku, qty |
| observe | two accounts | payment row | stock row |
| invariants | balance + active | CAPTURED + full amount | available ≥ qty |
| writePort | transferCAS | refundOnce | reserveCAS |
| **lifecycle** | propose/prepare/commit | **same** | **same** |

No new verbs. No framework adapters.

## Result

**Pass** (spike evidence in `tests/generality.test.ts`).

- All three expose exactly `EFFECT_HANDLE_KEYS`: propose, prepare, commit, evaluate.
- Happy path identical.
- Stale after external mutation uses the same `Stale` ADT.
- Refund of already-`REFUNDED` is `Denied` via policy — not a special lifecycle branch.

## What we deliberately did *not* model

| Temptation | Why deferred |
|---|---|
| Partial refunds | Would add intent shape + policies, still same lifecycle |
| Reservation TTL / release | Would be a **second** effect (`release`), not a broken reserve |
| Compensate / saga | Orchestration outside this primitive |
| Idempotent retry of same Executable | Still Spent → re-prepare (by design) |

If product needs holds-with-expiry *inside* `prepare`, that would fail this kill-test. Expressing release as another `createEffect` keeps the abstraction.

## Verdict

Within this threat model, the answer looks like a **general effect-correctness abstraction**, not merely a sharp financial gate — for effects that fit:

```text
observe versioned state → check invariants → conditional write
```

Commit: keep pausing productization; next optional step is documenting the `EffectSpec` contract, not Mastra.
