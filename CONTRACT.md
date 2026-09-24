# Contract — rupu-boundary 0.4 (API estable)

## One-liner

**RupuBoundary** es un **protocolo de capacidad** (`propose → prepare → commit`) que convierte una decisión en autoridad ejecutable condicionada por evidencia observable, con freshness verificable hasta el último punto que permita el write port.

No es un primitivo nuevo de concurrencia. Atomicidad y Coverage siguen siendo obligaciones del adapter / write port (CAS, If-Match, ConditionExpression, `UPDATE … WHERE version`, …).

## Generality (evidencia, no eslogan)

| Evidencia | Estado |
|---|---|
| Mismo lifecycle en dominios (transfer / refund / inventory) | kill-tests |
| Mismo lifecycle en hinges: OCC local, HTTP ETag, blind no-CAS (límite honesto), Dynamo conditional, SQL OCC | kill-tests |
| Adapters publicados: `etag`, `dynamodb`, `sql` (puertos inyectables; sin SDKs) | 0.3+ |

**Claim:** *la forma del protocolo generaliza sobre esos write ports sin verbos nuevos en el core.*  
**No claim:** *todo backend está cubierto*, ni *el core verifica Coverage*.

## Public surface (estable en 0.x)

| Export | Symbols |
|---|---|
| `rupu-boundary` | `createBoundary`, `BoundarySpec`, `BoundaryHandle`, ADTs, `all`, `witnessEq`, `releaseExecutable`, `Result` helpers |
| `rupu-boundary/etag` | `createEtagBoundary` |
| `rupu-boundary/dynamodb` | `createDynamoBoundary` |
| `rupu-boundary/sql` | `createSqlBoundary` |
| `rupu-boundary/testing` | harness only — not for app code |

**Lifecycle:** `propose` (sync) → `prepare` (async) → `commit` (async).

Nuevas abstracciones de **core** solo si un caso real no se puede expresar sin romper estas garantías — y entonces solo en **1.0.0+**, nunca revisando 0.4 en silencio.

## WriteFailure (0.4)

El conflicto condicional es **estructural**, no un string del adapter:

```ts
type WriteFailure =
  | { tag: "Conflict" }           // → commit Stale
  | { tag: "Error"; code: string; detail?: string }  // → commit Write
```

El core no interpreta `"version_conflict"` ni códigos HTTP/SQL/Dynamo.

## Witness (W)

Por defecto `witnessEq` compara hojas JSON-like (objetos planos, arrays, escalares; `Object.is`). **No** soporta `Date`, `Uint8Array`, `BigInt` ni instancias de clase.

Para W opaco: inyectá `compareWitness` en `BoundarySpec` (no es un verbo del lifecycle).

## Executable / vault

`Executable` es opaco y de un solo uso **en proceso**. Prepare abandonado (sin `commit`) permanece en el vault hasta `releaseExecutable(exec)` o fin de proceso. Sin durabilidad cross-process.

## Guarantees (T1)

Composition root sella write en `spec.write`. La app solo tiene `BoundaryHandle` / `Executable`.

- `Executable` opaco, single-use (spent tras intento fresco confirmado o `Stale`)
- Sin `evaluate` público en el handle de app
- ADTs explícitos: `Stale` / `Unknown` / `Denied` / `Spent` / `Write`
- Fallo de observe en commit **no** gasta (reintentable); el intento de write sí

## Not guaranteed

- Coverage completa (`check` deps ⊆ witness / condition) — obligación del adapter
- Atomicidad desde freshness check hasta write remoto, salvo que el write port la provea
- Durabilidad de `Executable` entre procesos
- Idempotencia de efectos remotos
- Seguridad si las credenciales de write son ambient (viola T1)
- Integridad de `Proposal` / `parse` (`Proposal` es DX forgeable)

## Semver

**Estable significa: no rompemos esta superficie en 0.x** — salvo el ajuste documentado de forma de `WriteFailure` en 0.4 (migración: `{ code: "version_conflict" }` → `{ tag: "Conflict" }`).

| Range | Allowed |
|---|---|
| **0.4.x** | Bugfixes sobre la superficie de arriba |
| **0.5+** (0.x) | Solo aditivo: adapters, docs, helpers opcionales |
| **1.0.0** | Primera revisión a propósito del core si hace falta — con nota de migración |

Si no podemos cumplir la promesa sin un break antes de 1.0, lo decimos en el changelog — **no** publicamos un minor 0.x con breaking change silencioso.
