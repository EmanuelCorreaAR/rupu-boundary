# rupu-effect-spike

Exploración técnica: ¿puede la corrección de efectos de dominio sentirse como un type system?

**Probabilistic decisions. Deterministic effects.**

- Núcleo FP: `propose` / `evaluate` / policies son puros (Data → Data).
- I/O sólo en el borde: `observe` + `commit` (CAS).
- Capability `Executable` de un solo uso (vault runtime).
- **Write port sellado:** `takeWritePort()` → `createTransferEffect`; la app no recibe la operación de efecto.
- Sin adapters de framework todavía.

```bash
npm install
npm test
```

Ver [NOTES.md](./NOTES.md) — batería **19/19** y veredicto.
