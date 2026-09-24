# Contract — @rupu/boundary 0.2 (API frozen)

## One-liner

Boundary is a general protocol to turn a decision into executable authority conditioned on observable evidence, with freshness verifiable up to the last point the write port allows.

## Frozen public surface

| Export | Symbols |
|---|---|
| `@rupu/boundary` | `createBoundary`, `BoundarySpec`, `BoundaryHandle`, ADTs (`Proposal`, `Executable`, `Committed`, `Stale`, `Denied`, `Unknown`, …), `all`, `witnessEq`, `Result` helpers |
| `@rupu/boundary/etag` | `createEtagBoundary` (GET + PUT `If-Match`) |
| `@rupu/boundary/testing` | harness only — not for app code |

**Lifecycle:** `propose` (sync) → `prepare` (async) → `commit` (async).

Breaking changes to this surface require a new major (or explicit 0.x minor with changelog callout). New core abstractions only if a real case cannot be expressed without breaking these guarantees.

## Guarantees (T1)

Composition root seals write capability into `spec.write`. App holds `BoundaryHandle` / `Executable` only.

- Opaque, single-use `Executable` (spent after confirmed fresh attempt or `Stale`)
- No public `evaluate` on the app handle
- Explicit `Stale` / `Unknown` / `Denied` / `Spent` / `Write`
- Observe failure on commit does **not** spend (retryable); write attempt does

## Not guaranteed

- Coverage completeness (`check` deps ⊆ witness) — adapter obligation
- Atomicity from freshness check to remote write, unless write port provides it (CAS / If-Match / …)
- Durability of `Executable` across processes
- Idempotency of remote effects
- Safety if write credentials are ambient (T1 violated)
- `Proposal` / `parse` integrity (`Proposal` is forgeable DX)

## Semver

- **0.2.x** — frozen surface above; patches for bugs only
- **0.3+** — additive adapters / docs; core breaks only with clear migration
