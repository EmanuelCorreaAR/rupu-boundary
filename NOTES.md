# Spike NOTES

## Thesis

Probabilistic decisions (agent JSON). Deterministic effects (CAS + evidence).

FP constraint:
- `observe` / `check` = **pure** (Data → Data); `all()` is external composition
- `write(I, W)` = only write edge (CAS token = W, not full S)
- freshness + vault = **runtime**
- Write port owned via `takeWritePort()` → closed over in `createBoundary`

## API shape (happy path)

```ts
const bank = openBank();
bank.seed("alice", 100);
bank.seed("bob", 0);

const transfer = createTransferBoundary({
  read: bank.read,
  write: bank.takeWritePort(), // ownership → runtime; not on app API
});

const proposal = transfer.propose(agentOutput); // pure
const decision = transfer.prepare(proposal);    // observe + check + seal
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
| 13 | `evaluate` (test harness) purity | **Pass** |
| 14 | Propose freezes intent | **Pass** |
| 15 | `takeWritePort` is single-take | **Pass** |
| 16 | Effect keys = propose/prepare/commit only | **Pass** |
| 17 | App with only `TransferBoundary` debits only via commit | **Pass** |
| 18 | JSON of effect handle leaks no write | **Pass** |

## Sealed write port

```
APPLICATION / AGENT
        │ Proposal
        ▼
┌───────────────────────┐
│   createTransferBoundary│
│  observe / prepare /  │
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

See [GENERALITY.md](./GENERALITY.md) — transfer / refund / reserve: **Pass**.

## Algebra D → v0 freeze

See [ALGEBRA.md](./ALGEBRA.md).

- `Observation<S,W>` + `check(S)` + `write(W)`: **Pass** (behavior)
- Kill eliminate **S**: **FAIL** (semantic displacement)
- Kill eliminate **W**: **FAIL** (semantic displacement)
- `BoundarySpec<I,S,W>` **frozen v0**

Candidate formal claim (draft): [PROPERTY.md](./PROPERTY.md).

- Structural: sealed `W₀` is the sole write evidence through the API  
- Full property only under adapter premise `Coverage(S₀, check, W₀)`  
- Multi-object without atomic protected set → **degrade**, don’t add 2PC  

Local authority under T1 survived (`evaluate` gated). Historical research notes stay in-repo.

## Research stop + 0.1.0

**No more papers to justify the package.** New abstractions only if a real case cannot be expressed without breaking guarantees.

Shipped as `@rupu/boundary@0.1.0` experimental — public surface = `createBoundary` + ADTs; demos stay private to the repo. See [README.md](./README.md) / [CHANGELOG.md](./CHANGELOG.md).
