/**
 * Production adapters — injectable Dynamo / SQL ports (no SDKs).
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  createDynamoBoundary,
  type DynamoStoreLike,
} from "../src/adapters/dynamodb.js";
import { createSqlBoundary, type SqlQueryLike } from "../src/adapters/sql.js";
import { resetVault } from "../src/testing.js";

function memDynamo(): DynamoStoreLike & {
  bump: (pk: string) => void;
  updates: () => number;
} {
  const store = new Map<
    string,
    { pk: string; body: string; status: string; version: number }
  >();
  store.set("k1", { pk: "k1", body: "a", status: "draft", version: 1 });
  let updates = 0;
  return {
    getItem: async (pk) => ({ item: store.get(pk) ?? null }),
    updateConditional: async ({ pk, body, expectedVersion }) => {
      updates += 1;
      const item = store.get(pk);
      if (!item) return "not_found";
      if (item.version !== expectedVersion) return "conflict";
      item.body = body;
      item.status = "published";
      item.version += 1;
      return "ok";
    },
    bump: (pk) => {
      const item = store.get(pk);
      if (item) item.version += 1;
    },
    updates: () => updates,
  };
}

function memSql(): SqlQueryLike & {
  bump: (id: string) => void;
  updates: () => number;
} {
  const rows = new Map<
    string,
    { id: string; body: string; status: string; version: number }
  >();
  rows.set("r1", { id: "r1", body: "a", status: "draft", version: 1 });
  let updates = 0;
  return {
    selectById: async (id) => rows.get(id) ?? null,
    updateWhereVersion: async ({ id, body, expectedVersion }) => {
      updates += 1;
      const row = rows.get(id);
      if (!row || row.version !== expectedVersion) return { rowCount: 0 };
      row.body = body;
      row.status = "published";
      row.version += 1;
      return { rowCount: 1 };
    },
    bump: (id) => {
      const row = rows.get(id);
      if (row) row.version += 1;
    },
    updates: () => updates,
  };
}

describe("rupu-boundary/dynamodb", () => {
  beforeEach(() => resetVault());

  it("prepare → commit conditional update", async () => {
    const store = memDynamo();
    const b = createDynamoBoundary({ store });
    const p = b.propose({ pk: "k1", body: "b" });
    if (!p.ok) throw new Error("propose");
    const prep = await b.prepare(p.value);
    if (!prep.ok) throw new Error("prepare");
    expect((await b.commit(prep.value)).ok).toBe(true);
    expect(store.updates()).toBe(1);
  });

  it("version bump → Stale", async () => {
    const store = memDynamo();
    const b = createDynamoBoundary({ store });
    const p = b.propose({ pk: "k1", body: "b" });
    if (!p.ok) return;
    const prep = await b.prepare(p.value);
    if (!prep.ok) return;
    store.bump("k1");
    const result = await b.commit(prep.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.tag).toBe("Stale");
  });
});

describe("rupu-boundary/sql", () => {
  beforeEach(() => resetVault());

  it("prepare → commit UPDATE WHERE version", async () => {
    const db = memSql();
    const b = createSqlBoundary({ db });
    const p = b.propose({ id: "r1", body: "b" });
    if (!p.ok) throw new Error("propose");
    const prep = await b.prepare(p.value);
    if (!prep.ok) throw new Error("prepare");
    expect((await b.commit(prep.value)).ok).toBe(true);
    expect(db.updates()).toBe(1);
  });

  it("version bump → Stale", async () => {
    const db = memSql();
    const b = createSqlBoundary({ db });
    const p = b.propose({ id: "r1", body: "b" });
    if (!p.ok) return;
    const prep = await b.prepare(p.value);
    if (!prep.ok) return;
    db.bump("r1");
    const result = await b.commit(prep.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.tag).toBe("Stale");
  });
});
