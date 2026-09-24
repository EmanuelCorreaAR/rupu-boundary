# rupu-effect-spike

Exploración técnica: ¿puede la corrección de efectos de dominio sentirse como un type system?

**Probabilistic decisions. Deterministic effects.**

- Núcleo FP: `observe` / `check` puros; write solo con witness.
- I/O en el borde: `observe` + `write(W)` (CAS).
- Capability `Executable` de un solo uso (vault).
- **Álgebra v0 congelada:** `EffectSpec<I,S,W>` — S decide, W ejecuta (S/W irreducibles).
- Write port sellado; sin adapters de framework.

```bash
npm install
npm test
```

Ver [NOTES.md](./NOTES.md), [GENERALITY.md](./GENERALITY.md), [ALGEBRA.md](./ALGEBRA.md).
