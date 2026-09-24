# Rupu Boundary

**Probabilistic decisions. Deterministic effects.**

Parte de la familia **Rupu**.

**0.2.0 — API congelada.** Contrato: [CONTRACT.md](./CONTRACT.md).

Boundary es un protocolo general para convertir una decisión en autoridad ejecutable condicionada por evidencia observable, con freshness verificable hasta el último punto que permita el write port.

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

HTTP con ETag (adapter publicado):

```ts
import { createEtagBoundary } from "@rupu/boundary/etag";

const publish = createEtagBoundary({
  fetch, // composition root: auth-bound fetch
});

const proposal = publish.propose({ url, body });
const executable = await publish.prepare(proposal);
const result = await publish.commit(executable);
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

**0.2.0** — core + `@rupu/boundary/etag` publicados; superficie congelada.


## Apoyar el proyecto

[cafecito.app/emacorreadev](https://cafecito.app/emacorreadev)


## License

Apache License 2.0
