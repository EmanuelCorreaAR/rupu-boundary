# @rupu/boundary

**Rupu Boundary**

A small TypeScript runtime boundary between decisions and real-world effects.

**Probabilistic decisions. Deterministic effects.**

```ts
import {
  createBoundary,
  type BoundarySpec,
} from "@rupu/boundary";

const refund = createBoundary({
  parse,
  spec: {
    observe,
    check,
    write,
  } satisfies BoundarySpec<I, S, W>,
});

const proposal = refund.propose(input);
const executable = refund.prepare(proposal);
const result = refund.commit(executable);
```

## Lifecycle

```text
probabilistic decision
        │
        ▼
┌─────────────────────┐
│    Rupu Boundary    │
│  propose            │
│     ↓               │
│  prepare            │
│     ↓               │
│  commit             │
└──────────┬──────────┘
           │
           ▼
 deterministic effect
```

```text
prepare:  observe · check · seal(I, W)
commit:   re-observe · compare W · Stale | conditional write
```

## Runtime guarantees (under T1)

Composition root seals the write client into `spec.write`. Application code holds only `BoundaryHandle` (and later an `Executable`).

| | |
|---|---|
| Opaque `Executable` | caller cannot read/set `I`/`W` |
| Single-use | replay → spent |
| Sealed at prepare | `I`/`W` bound together |
| No public `evaluate` | authority only from observe→check→seal |
| Explicit `Stale` / `Unknown` / `Denied` | |

## Not guaranteed (by design)

- Cross-system TOCTOU  
- Incomplete witness / Coverage holes (adapter obligation)  
- Durability across processes (host / workflow)  
- Idempotency (backend)  
- Distributed atomicity  
- Safety if write credentials are ambient (T1 violated)  

## Install / status

**0.1.0 experimental.** Algebra frozen: `BoundarySpec<I,S,W>` (`S` decide, `W` execute).

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Research stop

No more papers to justify this package. A new abstraction lands only if a real case cannot be expressed without breaking the guarantees above.
