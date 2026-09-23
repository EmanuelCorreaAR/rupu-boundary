# Spike NOTES

## Thesis

Probabilistic decisions (agent JSON). Deterministic effects (CAS + evidence).

FP constraint:
- `propose` / `evaluate` / policies = **pure** (Data → Data)
- `observe` / `commit` = **only** I/O edges
- `Result` ADT, no exceptions as control flow
- No exported unlocked `transfer`

## API shape (happy path)

```ts
const proposal = propose(agentOutput);      // pure
const decision = prepare(bank, proposal);   // observe + pure evaluate
const result = commit(bank, decision);      // re-observe + freshness + CAS
```

## Adversarial results

| # | Attack | Outcome |
|---|---|---|
| 1 | Bypass unlocked transfer | **Pass** — API does not exist; only `transferCAS` |
| 2 | Forged `Executable` | **Pass** — vault miss → Spent |
| 3 | `as any` garbage | **Pass** — same as forge |
| 4 | Mutate raw after propose | **Pass** — intent frozen at parse |
| 5 | Stale world pre-commit | **Pass** — Stale, no second debit |
| 6 | Replay same Executable | **Pass** — Spent |
| 7 | TOCTOU / version race | **Pass** — hash check + CAS |
| 8 | Concurrent dual prepare | **Pass** — exactly one commit |
| 9 | Adapter throw | **Pass** — Unknown; capability spent; no silent success |
| 10 | Policy deny | **Pass** — never calls transferCAS |
| 11 | Object clone replay | **Pass** — shared token, already spent |
| 12 | JSON round-trip forge | **Pass** — Symbol lost |

## What is NOT proven

- TypeScript cannot stop a determined attacker with access to `FakeBank` from calling `transferCAS` directly if they hold the bank reference. The invariant is: **application effects go through `commit`**, and the bank offers no unlocked write. Production needs the write port to be sealed behind the runtime (not handed to agent code).
- True linear types do not exist in TS; single-use is a **runtime vault**, not a type-system guarantee.
- No Mastra/LangGraph adapters yet (by design).

## DX check

Happy path stays short. Failures are tagged (`Denied` | `Stale` | `Unknown` | `Spent` | `Bank`), not throw soup.

## Verdict (spike)

Architecture survives the hostile battery **without** collapsing into `guard(call, execute)` or allow/deny-only.

Next only if we still want productization: seal the write port so callers never receive `transferCAS`, then consider one adapter.
