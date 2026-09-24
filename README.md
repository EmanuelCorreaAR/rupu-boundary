# RupuBoundary

**Capability protocol (`propose → prepare → commit`) for deferred authority over OCC write ports — ETag, Dynamo conditional, SQL version.**

Parte de la familia **Rupu**.

**0.4.0 — API estable (0.x).** Contrato: [CONTRACT.md](./CONTRACT.md).

**RupuBoundary** convierte una decisión en autoridad ejecutable condicionada por evidencia observable, con freshness verificable hasta el último punto que permita el write port.

No es un primitivo nuevo de concurrencia: CAS / If-Match / ConditionExpression / `UPDATE … WHERE version` siguen siendo del adapter.

**Evidencia de generalidad:** el mismo lifecycle aguanta ETag, Dynamo conditional writes y SQL OCC — sin verbos nuevos en el core.

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
npm install rupu-boundary
```


## Quick start

```ts
import {
  createBoundary,
  type BoundarySpec,
} from "rupu-boundary";

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
import { createEtagBoundary } from "rupu-boundary/etag";
import { createDynamoBoundary } from "rupu-boundary/dynamodb";
import { createSqlBoundary } from "rupu-boundary/sql";
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


## RupuBoundary ≠ policy

```text
Policy / authz   →  ¿está permitida la acción?
RupuBoundary     →  ¿la decisión sigue válida contra el estado actual?
```


## Guarantees (T1) / límites

Ver [CONTRACT.md](./CONTRACT.md). Resumen: `Executable` opaco y de un solo uso; conflicto de write es `{ tag: "Conflict" }`; Coverage y atomicidad remota son del adapter; prepare abandonado → `releaseExecutable`.


## Development

```bash
git clone https://github.com/EmanuelCorreaAR/rupu-boundary.git
cd rupu-boundary
npm install && npm test && npm run build
```


## Status

**0.4.0** — core estable; adapters `etag` / `dynamodb` / `sql`; `WriteFailure` estructural; `compareWitness` opcional.


## Apoyar el proyecto

Si RupuBoundary te sirve, podés invitarme un cafecito: [cafecito.app/emacorreadev](https://cafecito.app/emacorreadev)


## License

Apache License 2.0
