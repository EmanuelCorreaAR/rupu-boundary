# Rupu Boundary

**Probabilistic decisions. Deterministic effects.**

Parte de la familia **Rupu**.

Una decisión puede ser válida cuando se toma y dejar de serlo antes de ejecutarse. Rupu Boundary hace explícito ese intervalo: observa, decide, sella un witness y, al commit, comprueba si ese witness sigue vigente antes del efecto.

```text
decision
   │
   ▼
observe → check → witness
   │
   │   ...el mundo puede cambiar...
   │
   ▼
re-observe → fresh | stale → effect?
```

En una frase: evita ejecutar una decisión en silencio contra un estado relevante distinto del que la justificó — **dentro de la cobertura del witness**.

No importa quién decidió: agente, humano, cola, workflow o código normal.


## Install

Requiere Node.js 18+.

```bash
npm install @rupu/boundary
```

Estado: **0.1.0 — experimental.**


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


## Lifecycle

```text
prepare = observe → check → seal(I, W)
commit  = re-observe → compare(W) → Stale | write condicional
```

`BoundarySpec<I, S, W>`:

| | |
|---|---|
| **I** | intent — qué se quiere hacer |
| **S** | state — qué hace falta para **decidir** |
| **W** | witness — qué hace falta **probar al commit** |

`S` y `W` no tienen por qué ser iguales.


## Why

Refund en `prepare`: status `CAPTURED`, amount `100`, version `42` → allow, witness `42`.

Antes del commit otro proceso sube la version a `43`.

Boundary re-observa: expected `42`, current `43` → **Stale** → no hay write.

La pregunta no es “¿tenés permiso de refundear?”. Es “¿siguen vigentes las condiciones que justificaron *este* refund?”.


## Boundary ≠ policy engine

```text
Policy / authz          →  ¿está permitida la acción?
Rupu Boundary           →  ¿la decisión sigue válida contra el estado actual?
```

```text
LLM / human / workflow / queue / rules
              │
              ▼
         Rupu Boundary
              │
              ▼
            effect
```


## Guarantees (T1)

**T1:** el composition root sella la escritura en `spec.write`. La app solo ve `BoundaryHandle` y, tras prepare, un `Executable`.

| Guarantee | Meaning |
|---|---|
| Opaque `Executable` | no se lee ni setea `I` / `W` |
| Single-use | tras freshness o `Stale`, replay → spent |
| Sealed prepare | `I` y `W` van juntos |
| Sin `evaluate` público | autoridad solo de observe → check → seal |
| Outcomes explícitos | `Stale`, `Unknown`, `Denied` |
| Retry tras observe `Unknown` | si no se llegó al write, la capability sigue viva |

`Proposal` es DX y fabricable — `parse` no es frontera de seguridad.

`Unknown` después de `write` puede significar que el efecto ocurrió o no: idempotencia = backend.


## Coverage

Boundary solo puede detectar cambios que el **witness** representa.

Si `check` depende de `currency` y `W` no la cubre, un `ARS → USD` entre prepare y commit puede seguir siendo **fresh** → *false-fresh*. Coverage es obligación del **adapter**.

Demostrado en `tests/coverage-hole.test.ts`.


## Qué no garantiza

No es policy engine, authz, ni motor de workflows.
No elimina TOCTOU multi-sistema, no inventa Coverage, no aporta durabilidad entre procesos, idempotencia remota ni atomicidad distribuida. Si el write client está ambient, T1 está roto.


## Development

```bash
git clone https://github.com/EmanuelCorreaAR/rupu-boundary.git
cd rupu-boundary
npm install
npm test
npm run typecheck
npm run build
```

Consumidor hostil (refund OCC): `tests/hostile-consumer.test.ts`.  
Otros modelos de concurrencia (HTTP ETag, remote sin CAS): `tests/concurrency-models.test.ts`.  
Coverage hole: `tests/coverage-hole.test.ts`.


## Status

**0.1.0 — experimental:** `createBoundary`, `BoundarySpec<I,S,W>`, propose → prepare → commit, vault local bajo T1.

El core se mantiene deliberadamente chico.


## Apoyar el proyecto

Si Rupu Boundary te sirve, podés invitarme un cafecito: [cafecito.app/emacorreadev](https://cafecito.app/emacorreadev)


## License

Apache License 2.0
