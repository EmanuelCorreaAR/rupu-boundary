# Spike NOTES

## Thesis

Probabilistic decisions (agent JSON). Deterministic effects (CAS + evidence).

FP constraint:
- `propose` / `evaluate` / policies = **pure** (Data → Data)
- `observe` / `commit` = **only** I/O edges
- `Result` ADT, no exceptions as control flow
- Write port is **owned by the runtime** via `takeWritePort()` → `createTransferEffect`

## API shape (happy path)

```ts
const bank = openBank();
bank.seed("alice", 100);
bank.seed("bob", 0);

const transfer = createTransferEffect({
  read: bank.read,
  write: bank.takeWritePort(), // ownership → runtime; not on app API
});

const proposal = transfer.propose(agentOutput); // pure
const decision = transfer.prepare(proposal);    // observe + pure evaluate
const result = transfer.commit(decision);       // freshness + private CAS
```

Application code receives `transfer` (and optionally `read`). It never receives `write`.

## Test results (19/19)

| # | Attack / property | Outcome |
|---|---|---|
| 0 | Happy path propose→prepare→commit | **Pass** |
| 1 | Bypass via effect surface (`transferCAS` / `write`) | **Pass** — keys absent |
| 2 | Forged `Executable` | **Pass** — vault miss → Spent |
| 3 | `as any` garbage | **Pass** — same as forge |
| 4 | Mutate raw after propose | **Pass** — intent frozen at parse |
| 5 | Stale world pre-commit (external writer) | **Pass** — Stale, no second debit |
| 6 | Replay same Executable | **Pass** — Spent |
| 7 | TOCTOU / version race | **Pass** — hash check + CAS |
| 8 | Concurrent dual prepare | **Pass** — exactly one commit |
| 9 | Adapter throw | **Pass** — Unknown; capability spent |
| 10 | Policy deny | **Pass** — never calls transferCAS |
| 11 | Object clone replay | **Pass** — shared token, already spent |
| 12 | JSON round-trip forge | **Pass** — Symbol lost |
| 13 | `evaluate` purity (no writes) | **Pass** |
| 14 | Propose freezes intent | **Pass** |
| 15 | `takeWritePort` is single-take | **Pass** |
| 16 | Effect keys = propose/prepare/commit/evaluate only | **Pass** |
| 17 | App with only `TransferEffect` debits only via commit | **Pass** |
| 18 | JSON of effect handle leaks no write | **Pass** |

## Sealed write port

```
APPLICATION / AGENT
        │ Proposal
        ▼
┌───────────────────────┐
│   createTransferEffect│
│  observe / evaluate / │
│  vault / freshness /  │
│  commit               │
│        │              │
│   private write port  │
└────────┼──────────────┘
         ▼
       BANK (CAS)
```

Property demonstrated: **consumer code never obtains a reference to an operation capable of producing the effect** on the returned handle. Composition root must not hand `write` / `externalWrite` to the app.

Honest residual: a malicious composition root can keep `externalWrite` or copy the write port before `takeWritePort`. That is wiring trust, not library bypass. Process isolation (A=app, B=credentials) remains out of scope for DX.

## What is still not proven

- True linear types in TS (vault is runtime).
- No Mastra/LangGraph adapters yet (by design).
- Cross-process credential separation.

## DX check

Happy path stays short. Failures are tagged (`Denied` | `Stale` | `Unknown` | `Spent` | `Write`).

## Verdict

| Hypothesis | Status |
|---|---|
| FP core | **Pass** |
| Anti-forge / replay / stale | **Pass** |
| TOCTOU + CAS | **Pass** (fake bank model) |
| DX propose→prepare→commit | **Pass** (preliminary) |
| Strong anti-bypass (sealed write port) | **Pass** within ownership injection model |

## Generality

See [GENERALITY.md](./GENERALITY.md) — transfer / refund / reserve on one `createEffect` runtime: **Pass**.

Next (only if productizing): document `EffectSpec` contract; still no Mastra by default.
