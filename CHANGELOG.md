# Changelog

## 0.4.1

### Fix

- **`releaseExecutable` is main-only.** Removed from `rupu-boundary/testing` so production memory ownership is not gated behind the harness export. CONTRACT table lists `/testing` contents explicitly.

### Runtime

- **`commit` totality:** if `compareWitness` / `witnessEq` throw → `Unknown` (authority kept), never a rejected Promise for that class of error.

### Ops / tests

- GitHub Actions CI: typecheck + test + build on **Node 18 / 20 / 22**.
- Hostile invariants: concurrent commit, TOCTOU vs CAS, blind write limit, write-throws-after-apply, throwing comparator, coverage hole, mass `releaseExecutable`.

### Docs

- Framing: *transport evidence to a write port that can enforce it* — not “we solved freshness”.

## 0.4.0

### Core

- **`WriteFailure` estructural:** `{ tag: "Conflict" } | { tag: "Error"; code; detail? }`. El core ya no interpreta el string `"version_conflict"`.
- **`compareWitness` opcional** en `BoundarySpec` (no es verbo del lifecycle). `witnessEq` documentado: solo JSON-like / objetos planos.
- **`releaseExecutable`:** soltar prepare abandonado del vault in-process (memory ownership).

### Docs

- One-liner / CONTRACT en español; tagline técnica en README (ya no solo el eslogan de familia).
- Paquete unscoped `rupu-boundary` (scope `@rupu` no disponible en npm).

### Migration from 0.3

```ts
// before
err({ code: "version_conflict" })
// after
err({ tag: "Conflict" })

// other write errors
err({ tag: "Error", code: "not_found" })
```

## 0.3.0

### Package name

- Published as **`rupu-boundary`** (unscoped). npm org/scope `@rupu` unavailable — same pattern as `rupu-sonda`. Subpaths: `rupu-boundary/etag`, `/dynamodb`, `/sql`, `/testing`.

### Generality evidence

- Kill-tests: **DynamoDB-style ConditionExpression** and **SQL OCC** (`UPDATE … WHERE version`) keep exactly `propose → prepare → commit` — no new core verbs.
- Honest docs: capability protocol + adapter evidence; not “protocolo general” as a slogan without hinges.

### Adapters (additive)

- **`rupu-boundary/dynamodb`**: `createDynamoBoundary` over injectable `DynamoStoreLike`.
- **`rupu-boundary/sql`**: `createSqlBoundary` over injectable `SqlQueryLike`.

### Docs

- CONTRACT / README: generality table; claim scoped to proven write ports.

## 0.2.0

### API estable

- Public surface **stable for all of 0.x** (no core breaks in minors) — see [CONTRACT.md](./CONTRACT.md).
- `prepare` / `commit` are **async** (adapters may use `fetch`); sync `observe`/`write` still work.
- One-liner: decision → executable authority conditioned on observable evidence; freshness up to the write port.

### Adapter

- **`rupu-boundary/etag`**: production GET + PUT `If-Match` via injectable `fetch`.

### Docs

- README + CONTRACT; out of “experimental” framing for the stable core.

## 0.1.0 — experimental (yanked naming era)

- First spike: `createBoundary`, sealed `Executable`, T1, hostile/coverage/concurrency fixtures.
- Renamed from `@rupu/effect` before publish.
