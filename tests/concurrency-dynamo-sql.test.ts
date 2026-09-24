/**
 * Concurrency-model kill-tests (0.3) — Dynamo conditional + SQL OCC.
 *
 * Bar: propose → prepare → commit unchanged; core grows no Dynamo/SQL special-cases.
 * Pass ⇒ evidence the protocol generalizes beyond HTTP ETag.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  openDynamoWorld,
  createDynamoPublishBoundary,
  type DynamoWorld,
  type DynamoBoundary,
} from "../src/fixtures/dynamo-conditional.js";
import {
  openSqlWorld,
  createSqlPublishBoundary,
  type SqlWorld,
  type SqlBoundary,
} from "../src/fixtures/sql-occ.js";
import { resetVault } from "../src/testing.js";
import type { Executable } from "../src/index.js";

describe("DynamoDB ConditionExpression — same lifecycle", () => {
  let world: DynamoWorld;
  let publish: DynamoBoundary;

  beforeEach(() => {
    resetVault();
    world = openDynamoWorld();
    world.seed("doc#1", "hello", "draft");
    publish = createDynamoPublishBoundary(world);
  });

  async function prepareOk(): Promise<Executable> {
    const p = publish.propose({ pk: "doc#1", body: "published" });
    if (!p.ok) throw new Error("propose");
    const d = await publish.prepare(p.value);
    if (!d.ok) throw new Error(`prepare ${d.error.tag}`);
    return d.value;
  }

  it("1. prepare → commit: conditional update once", async () => {
    expect((await publish.commit(await prepareOk())).ok).toBe(true);
    expect(world.successfulUpdates()).toBe(1);
    expect(world.writeAttempts()).toBe(1);
  });

  it("2. prepare → external version bump → commit: Stale", async () => {
    const exec = await prepareOk();
    world.externalBump("doc#1");
    const result = await publish.commit(exec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.tag).toBe("Stale");
    expect(world.successfulUpdates()).toBe(0);
  });

  it("3. commit twice → Spent", async () => {
    const exec = await prepareOk();
    expect((await publish.commit(exec)).ok).toBe(true);
    const again = await publish.commit(exec);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.tag).toBe("Spent");
    expect(world.successfulUpdates()).toBe(1);
  });

  it("4. check rejects published → Denied", async () => {
    world.seed("live", "x", "published");
    const p = publish.propose({ pk: "live", body: "y" });
    if (!p.ok) return;
    const d = await publish.prepare(p.value);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.tag).toBe("Denied");
    expect(world.writeAttempts()).toBe(0);
  });

  it("5. missing item → Unknown", async () => {
    const p = publish.propose({ pk: "gone", body: "z" });
    if (!p.ok) return;
    const d = await publish.prepare(p.value);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.tag).toBe("Unknown");
  });
});

describe("SQL OCC (UPDATE WHERE version) — same lifecycle", () => {
  let world: SqlWorld;
  let publish: SqlBoundary;

  beforeEach(() => {
    resetVault();
    world = openSqlWorld();
    world.seed("row-1", "hello", "draft");
    publish = createSqlPublishBoundary(world);
  });

  async function prepareOk(): Promise<Executable> {
    const p = publish.propose({ id: "row-1", body: "published" });
    if (!p.ok) throw new Error("propose");
    const d = await publish.prepare(p.value);
    if (!d.ok) throw new Error(`prepare ${d.error.tag}`);
    return d.value;
  }

  it("1. prepare → commit: UPDATE once", async () => {
    expect((await publish.commit(await prepareOk())).ok).toBe(true);
    expect(world.successfulUpdates()).toBe(1);
  });

  it("2. prepare → external version bump → commit: Stale", async () => {
    const exec = await prepareOk();
    world.externalBump("row-1");
    const result = await publish.commit(exec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.tag).toBe("Stale");
    expect(world.successfulUpdates()).toBe(0);
  });

  it("3. commit twice → Spent", async () => {
    const exec = await prepareOk();
    expect((await publish.commit(exec)).ok).toBe(true);
    const again = await publish.commit(exec);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.tag).toBe("Spent");
  });

  it("4. check rejects published → Denied", async () => {
    world.seed("live", "x", "published");
    const p = publish.propose({ id: "live", body: "y" });
    if (!p.ok) return;
    const d = await publish.prepare(p.value);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.tag).toBe("Denied");
  });

  it("5. missing row → Unknown", async () => {
    const p = publish.propose({ id: "gone", body: "z" });
    if (!p.ok) return;
    const d = await publish.prepare(p.value);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.tag).toBe("Unknown");
  });
});
