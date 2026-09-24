# Changelog

## 0.1.0 — experimental
### Package
- Public name: `@rupu/boundary` (`createBoundary`, `BoundarySpec<I,S,W>`, `BoundaryHandle`).
- Lifecycle: `propose` → `prepare` → `commit`.
- Renamed from working title `@rupu/effect` before first publish (avoid Effect-TS collision).
- License: Apache-2.0.
- `@rupu/boundary/testing`: `createBoundaryForTests`, vault helpers (harness only).
- Demo bank / refund / reserve / coverage-hole fixtures stay in-repo for tests; not published.
### Runtime
- Opaque single-use `Executable`; sealed write under T1; no public `evaluate`.
- `witnessEq`: deep equality, key-order independent (not `JSON.stringify`).
- Commit spends authority only after freshness is confirmed (or on `Stale`); transient observe failure on commit keeps the capability retryable.
- Explicit `Stale` / `Unknown` / `Denied` / `Spent` / `Write`.
### Guarantees / limits (documented)
- `Proposal` is DX — forgeable; `parse` is not an integrity frontier.
- `Unknown` after `write` may mean the remote effect ran or not — idempotency is the backend’s job.
- Coverage of `check(S)` by witness `W` is an adapter obligation (false-fresh kill-test included).
### Tests
- Hostile consumer battery (refund): prepare→commit, Stale, Spent, Denied, Unknown, API misuse.
- Coverage-hole kill-test (incomplete witness → false-fresh).
- Review kill-tests: `witnessEq`, consume-before-observe, forged `Proposal`.

