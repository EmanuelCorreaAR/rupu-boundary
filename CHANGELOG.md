# Changelog

## 0.2.0

### API freeze

- Public surface frozen — see [CONTRACT.md](./CONTRACT.md).
- `prepare` / `commit` are **async** (adapters may use `fetch`); sync `observe`/`write` still work.
- One-liner: decision → executable authority conditioned on observable evidence; freshness up to the write port.

### Adapter

- **`@rupu/boundary/etag`**: production GET + PUT `If-Match` via injectable `fetch`.

### Docs

- README + CONTRACT; out of “experimental” framing for the frozen core.

## 0.1.0 — experimental (yanked naming era)

- First `@rupu/boundary` spike: `createBoundary`, sealed `Executable`, T1, hostile/coverage/concurrency fixtures.
- Renamed from `@rupu/effect` before publish.
