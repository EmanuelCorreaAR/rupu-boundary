# DURABLE AUTHORITY — next kill-test

Status: **paper only.** Do not implement an AuthorityStore yet.  
`BoundarySpec<I,S,W>` unchanged.

Premise from [EXPERIMENT.md](./EXPERIMENT.md): local capability properties survived under T1.  
Tension:

```text
Niche that justifies Rupu:  authority must cross a process/time boundary
Current vault:              in-memory Map — dies with the process
```

```text
Process A  prepare → vaultA[token] = {I,W}
           Temporal persists workflow; process dies
Process B  commit(token) → vaultB empty → Spent/invalid
```

Naive serialize `{I,W,spent}` destroys opacity (caller reconstructs).  
Signed blob → key mgmt, replay, durable spend.  
Looks like sliding into a security/durable platform.

---

## One question

> Can provenance + binding + consumption survive a process boundary **without** turning Rupu into a durable workflow/security platform?

---

## Three candidates (paper)

### A. Ephemeral authority

`prepare` + `commit` same process. Current vault.  
→ Properties hold locally.  
→ **Niche much smaller** (no HITL/6h/other worker as sold).

### B. Durable opaque reference

```text
Executable{id} → AuthorityStore → atomic take(id) → {I,W} or reject
```

Port shape (sketch, not API):

```text
put(id, {I,W})
take(id)  // atomic: if spent reject; else spend + return body
```

Implementable on Redis / Dynamo / Postgres / even Temporal payload + CAS row.  
→ Properties can survive cross-process.  
→ Rupu needs a **port**, not necessarily a platform.  
→ Kill if the port grows leases, recovery, distributed locks, reconciliation, expiry orchestration → Temporal invasion.

### C. Self-contained signed capability

```text
Executable{I, W, …, signature}
```

→ Provenance/binding cryptographic.  
→ **Consumption** hard (distributed spend / denylist / single-flight).  
→ Cost: keys, rotation, replay.

---

## Comparison

| Model | Provenance | Binding | Consumption | Cross-process | Cost |
|---|---|---|---|---|---|
| In-memory vault | ✓ | ✓ | ✓ | ✗ | tiny |
| Durable store (B) | ✓ | ✓ | ✓ with atomic take | ✓ | storage dependency |
| Signed token (C) | ✓ | ✓ | problematic | ✓ | crypto / replay complexity |

**Suspicion:** B is the only model that keeps the thesis intact *and* fits the niche — kill-test whether `put` + `atomic take` stays a small composable port.

---

## Kill criteria for B

| Outcome | Verdict |
|---|---|
| Port stays `put` + `atomic take` (+ optional TTL); adapters are thin | Durable thesis can survive; library stays small |
| Need leases, lock managers, recovery protocols, Temporal-like orchestration | **Stop** — invading Temporal; prefer pattern + Temporal |
| Teams refuse any store → only A works | Shrink claim to same-process capability DX |

Do **not** design the store schema next. Answer the port-vs-platform question on paper with one concrete adapter sketch each (Redis, Dynamo, Postgres) — complexity budget only.

---

## Freeze (honest project state)

> **Authority primitive thesis:** survived locally under T1.  
> **Durable-authority thesis:** untested.
