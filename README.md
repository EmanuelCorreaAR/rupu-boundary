# Rupu Boundary

**Probabilistic decisions. Deterministic effects.**

Parte de la familia **Rupu**.

**0.3.0 — API estable (0.x sin breaks del core).** Contrato: [CONTRACT.md](./CONTRACT.md).

Boundary es un **protocolo de capacidad** (`propose → prepare → commit`) para convertir una decisión en autoridad ejecutable condicionada por evidencia observable, con freshness verificable hasta el último punto que permita el write port.

No es un primitivo nuevo de concurrencia: CAS / If-Match / ConditionExpression / `UPDATE … WHERE version` siguen siendo del adapter.

**Evidencia de generalidad (0.3):** el mismo lifecycle aguanta ETag, Dynamo conditional writes y SQL OCC en kill-tests + adapters publicados — sin verbos nuevos en el core.

```text
decision → observe → check → witness
                │
                │  ...el mundo puede cambiar...
                ▼
         re-observe → fresh | stale → effect?
```


## Install

Node.js 18+.

```bash
npm install @rupu/boundary
```


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
const executable = await refund.prepare(proposal);
const result = await refund.commit(executable);
```

Adapters publicados (puertos inyectables; sin SDKs):

```ts
import { createEtagBoundary } from "@rupu/boundary/etag";
import { createDynamoBoundary } from "@rupu/boundary/dynamodb";
import { createSqlBoundary } from "@rupu/boundary/sql";
```


## Lifecycle

```text
prepare = observe → check → seal(I, W)
commit  = re-observe → compare(W) → Stale | conditional write
```

| | |
|---|---|
| **I** | intent |
| **S** | state para **decidir** |
| **W** | witness para **probar al commit** |


## Boundary ≠ policy

```text
Policy / authz   →  ¿está permitida la acción?
Boundary         →  ¿la decisión sigue válida contra el estado actual?
```


## Guarantees (T1) / límites

Ver [CONTRACT.md](./CONTRACT.md). Resumen: `Executable` opaco y de un solo uso; Coverage y atomicidad remota son del adapter/write port; `Proposal` es DX.


## Development

```bash
git clone https://github.com/EmanuelCorreaAR/rupu-boundary.git
cd rupu-boundary
npm install && npm test && npm run build
```


## Status

**0.3.0** — core estable; adapters `etag` / `dynamodb` / `sql`; evidencia de generalidad sobre tres hinges de concurrencia.


## Apoyar el proyecto

[cafecito.app/emacorreadev](https://cafecito.app/emacorreadev)


## License

Apache License 2.0
