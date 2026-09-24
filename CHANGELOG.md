# Changelog

## 0.3.0

### Generality evidence

- Kill-tests: **DynamoDB-style ConditionExpression** and **SQL OCC** (`UPDATE … WHERE version`) keep exactly `propose → prepare → commit` — no new core verbs.
- Honest docs: capability protocol + adapter evidence; not “protocolo general” as a slogan without hinges.

### Adapters (additive)

- **`@rupu/boundary/dynamodb`**: `createDynamoBoundary` over injectable `DynamoStoreLike`.
- **`@rupu/boundary/sql`**: `createSqlBoundary` over injectable `SqlQueryLike`.

### Docs

- CONTRACT / README: generality table; claim scoped to proven write ports.

## 0.2.0

### API estable

- Public surface **stable for all of 0.x** (no core breaks in minors) — see [CONTRACT.md](./CONTRACT.md).
- `prepare` / `commit` are **async** (adapters may use `fetch`); sync `observe`/`write` still work.
- One-liner: decision → executable authority conditioned on observable evidence; freshness up to the write port.

### Adapter

- **`@rupu/boundary/etag`**: production GET + PUT `If-Match` via injectable `fetch`.

### Docs

- README + CONTRACT; out of “experimental” framing for the stable core.

## 0.1.0 — experimental (yanked naming era)

- First `@rupu/boundary` spike: `createBoundary`, sealed `Executable`, T1, hostile/coverage/concurrency fixtures.
- Renamed from `@rupu/effect` before publish.
