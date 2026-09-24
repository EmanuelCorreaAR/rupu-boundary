# Changelog

## 0.1.0 — experimental

- Package: `@rupu/boundary` (`createBoundary`, `BoundarySpec<I,S,W>`, propose → prepare → commit).
- Hardened runtime: opaque single-use `Executable`, sealed write under T1, no public `evaluate`.
- `@rupu/boundary/testing`: `createBoundaryForTests`, vault helpers (harness only).
- Demo bank / refund / reserve stay in-repo for tests; not published.
- Renamed from working title `@rupu/boundary` before first publish (avoid Effect-TS collision).
