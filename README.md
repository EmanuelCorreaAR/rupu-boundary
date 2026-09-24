# @rupu/boundary

**Rupu Boundary**

Una frontera runtime pequeña en TypeScript entre decisiones y efectos del mundo real.

**Probabilistic decisions. Deterministic effects.**

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

## Garantías del runtime (bajo T1)

El composition root sella el cliente de escritura dentro de `spec.write`. El código de aplicación solo recibe un `BoundaryHandle` (y después un `Executable`).

| | |
|---|---|
| `Executable` opaco | el caller no lee ni setea `I`/`W` |
| Un solo uso | replay → spent |
| Sellado en prepare | `I`/`W` van juntos |
| Sin `evaluate` público | la autoridad solo nace de observe→check→seal |
| `Stale` / `Unknown` / `Denied` explícitos | |

## No garantizado (a propósito)

- TOCTOU entre sistemas  
- Witness incompleto / agujeros de Coverage (obligación del adapter)  
- Durabilidad entre procesos (host / workflow)  
- Idempotencia (backend)  
- Atomicidad distribuida  
- Seguridad si las credenciales de write están ambient (T1 violado)  

## Install / estado

**0.1.0 experimental.** Álgebra congelada: `BoundarySpec<I,S,W>` (`S` decide, `W` ejecuta).

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Research stop

No más papers para justificar el paquete. Una abstracción nueva entra solo si un caso real no se puede expresar sin romper las garantías de arriba.

## Cafecito

Si Rupu Boundary te sirve, podés invitarme un cafecito: [cafecito.app/emacorreadev](https://cafecito.app/emacorreadev)
