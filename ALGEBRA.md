# Algebra D kill-test

## Spec (public algebra)

```ts
type Observation<S, W> = { state: S; witness: W }

type EffectSpec<I, S, W> = {
  observe(input: I): Result<Observation<S, W>, ObserveError>
  check(input: I, state: S): Result<void, DeniedReasons>
  write(input: I, witness: W): Result<void, WriteFailure>
}
```

- **S** — decide (balances, status, stock, …)
- **W** — execute (version / etag / CAS token)
- **Freshness / vault / sealed write** — runtime, not EffectSpec
- **parse / schema / policies[]** — outside the algebra (`parse` is DX for `propose`; `all()` composes checks)

Facade unchanged: `propose → prepare → commit`.

## Result

**Pass** — same battery + generality (transfer / refund / reserve) on algebra D.

| Domain | S | W |
|---|---|---|
| Transfer | `{ from, to }` accounts | `{ fromVersion }` |
| Refund | payment row | `{ version }` |
| Reserve | stock row | `{ version }` |

`write` never receives full `S` — only `W`.

## Next reduction (not done)

Try to eliminate **S** or **W**. Prediction: both irreducible.
