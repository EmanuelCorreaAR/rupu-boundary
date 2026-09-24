# Contract — rupu-boundary 0.3 (API estable)

## One-liner

Boundary is a **capability protocol** (`propose → prepare → commit`) that turns a decision into executable authority conditioned on observable evidence, with freshness verifiable up to the last point the write port allows.

It is **not** a new concurrency primitive. Atomicity and Coverage remain obligations of the adapter / write port (CAS, If-Match, ConditionExpression, `UPDATE … WHERE version`, …).

## Generality (evidence, not slogan)

| Evidence | Status |
|---|---|
| Same lifecycle across domains (transfer / refund / inventory) | kill-tests |
| Same lifecycle across concurrency hinges: local OCC, HTTP ETag, blind no-CAS (honest limit), **Dynamo conditional**, **SQL OCC** | kill-tests |
| Published adapters: `etag`, `dynamodb`, `sql` (injectable ports; no SDKs) | 0.3 |

Claim we make: *the protocol shape generalizes across those write ports without new core verbs.*  
Claim we do **not** make: *every backend is covered*, or *Coverage is checked by the core*.

## Public surface (estable en 0.x)

| Export | Symbols |
|---|---|
| `rupu-boundary` | `createBoundary`, `BoundarySpec`, `BoundaryHandle`, ADTs (`Proposal`, `Executable`, `Committed`, `Stale`, `Denied`, `Unknown`, …), `all`, `witnessEq`, `Result` helpers |
| `rupu-boundary/etag` | `createEtagBoundary` (GET + PUT `If-Match`) |
| `rupu-boundary/dynamodb` | `createDynamoBoundary` (GetItem + conditional update port) |
| `rupu-boundary/sql` | `createSqlBoundary` (SELECT + `UPDATE WHERE version` port) |
| `rupu-boundary/testing` | harness only — not for app code |

**Lifecycle:** `propose` (sync) → `prepare` (async) → `commit` (async).

New **core** abstractions only if a real case cannot be expressed without breaking these guarantees — and then only at **1.0.0** (or later majors), never by quietly revising 0.3.

## Guarantees (T1)

Composition root seals write capability into `spec.write`. App holds `BoundaryHandle` / `Executable` only.

- Opaque, single-use `Executable` (spent after confirmed fresh attempt or `Stale`)
- No public `evaluate` on the app handle
- Explicit `Stale` / `Unknown` / `Denied` / `Spent` / `Write`
- Observe failure on commit does **not** spend (retryable); write attempt does

## Not guaranteed

- Coverage completeness (`check` deps ⊆ witness / condition) — adapter obligation
- Atomicity from freshness check to remote write, unless write port provides it
- Durability of `Executable` across processes
- Idempotency of remote effects
- Safety if write credentials are ambient (T1 violated)
- `Proposal` / `parse` integrity (`Proposal` is forgeable DX)

## Semver

**Estable significa: no rompemos esta superficie en 0.x.**

| Range | Allowed |
|---|---|
| **0.3.x** | Solo bugfixes sobre la superficie de arriba |
| **0.4+** (0.x) | Solo aditivo: adapters nuevos (`rupu-boundary/…`), docs, helpers opcionales que no cambien firmas ni semántica existentes |
| **1.0.0** | Primera oportunidad de *revisar a propósito* el contrato del core si 0.3 estaba mal — con nota de migración. Preferimos llevar la semántica de 0.3 a 1.0 si aguantó. |

Si no podemos cumplir la promesa sin un break antes de 1.0, lo decimos en el changelog y retiramos el claim de estabilidad — **no** publicamos un minor 0.x con breaking change silencioso.
