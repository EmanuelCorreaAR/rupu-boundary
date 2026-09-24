# Rupu Boundary

**Probabilistic decisions. Deterministic effects.**

Parte de la familia **Rupu**.

Frontera runtime pequeña en TypeScript entre decisiones y efectos del mundo real. Una decisión probabilística (agente, humano, cola, workflow) se convierte en autoridad sellada de un solo uso; el commit revalida el witness y ejecuta un write condicional.


## Install

Requiere Node.js 18+.

```bash
npm install @rupu/boundary
```

Estado: **0.1.0 experimental.**


## Quick start

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


## Ciclo de vida

```text
decisión probabilística
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
 efecto determinista
```

```text
prepare:  observe · check · seal(I, W)
commit:   re-observe · compare W · Stale | write condicional
```

Álgebra congelada: `BoundarySpec<I,S,W>` — `S` decide, `W` ejecuta.


## Garantías (bajo T1)

El composition root sella el cliente de escritura dentro de `spec.write`. La aplicación solo recibe un `BoundaryHandle` (y después un `Executable`).

| | |
|---|---|
| `Executable` opaco | el caller no lee ni setea `I`/`W` |
| Un solo uso | replay → spent |
| Sellado en prepare | `I`/`W` van juntos |
| Sin `evaluate` público | la autoridad solo nace de observe→check→seal |
| `Stale` / `Unknown` / `Denied` explícitos | |


## Qué no es / no garantiza

- No es Effect-TS ni un effect system general
- No elimina TOCTOU entre sistemas
- No inventa Coverage / witness incompleto (obligación del adapter)
- No aporta durabilidad entre procesos (host / workflow)
- No aporta idempotencia ni atomicidad distribuida (backend)
- No protege si las credenciales de write están ambient (T1 violado)


## Development

```bash
git clone https://github.com/EmanuelCorreaAR/rupu-boundary.git
cd rupu-boundary
npm install
npm test
npm run typecheck
npm run build
```


## Status

**0.1.0** — `createBoundary` / `BoundarySpec<I,S,W>`; propose → prepare → commit; vault local bajo T1.

Research stop: no más papers para justificar el paquete. Una abstracción nueva entra solo si un caso real no se puede expresar sin romper las garantías de arriba.


## Apoyar el proyecto

Si Rupu Boundary te sirve, podés invitarme un cafecito: [cafecito.app/emacorreadev](https://cafecito.app/emacorreadev)


## License

Apache License 2.0
