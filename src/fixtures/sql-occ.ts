/**
 * SQL optimistic concurrency — UPDATE … WHERE version = $w.
 *
 * Same BoundarySpec lifecycle as ETag and Dynamo conditional writes.
 * W is the row version. No SQL driver in core.
 */

import { err, ok, type Result } from "../result.js";
import {
  createBoundary,
  type BoundaryHandle,
  type DeniedReasons,
  type ParseFailure,
  type PolicyFailure,
  type WriteFailure,
} from "../runtime.js";

export type SqlIntent = {
  readonly id: string;
  readonly body: string;
};

export type SqlState = {
  readonly id: string;
  readonly body: string;
  readonly status: "draft" | "published";
  readonly version: number;
};

export type SqlWitness = {
  readonly version: number;
};

type MutableRow = {
  body: string;
  status: "draft" | "published";
  version: number;
};

export type SqlWorld = {
  readonly select: (id: string) => SqlState | null;
  readonly updateWhereVersion: (
    id: string,
    body: string,
    expectedVersion: number,
  ) => { rowCount: 0 | 1 };
  readonly seed: (id: string, body: string, status?: "draft" | "published") => void;
  readonly externalBump: (id: string) => void;
  readonly writeAttempts: () => number;
  readonly successfulUpdates: () => number;
};

export function openSqlWorld(): SqlWorld {
  const store = new Map<string, MutableRow>();
  let attempts = 0;
  let successes = 0;

  return {
    select: (id) => {
      const row = store.get(id);
      if (!row) return null;
      return Object.freeze({
        id,
        body: row.body,
        status: row.status,
        version: row.version,
      });
    },
    updateWhereVersion: (id, body, expectedVersion) => {
      attempts += 1;
      const row = store.get(id);
      if (!row || row.version !== expectedVersion) {
        return { rowCount: 0 };
      }
      row.body = body;
      row.status = "published";
      row.version += 1;
      successes += 1;
      return { rowCount: 1 };
    },
    seed: (id, body, status = "draft") => {
      store.set(id, { body, status, version: 1 });
    },
    externalBump: (id) => {
      const row = store.get(id);
      if (!row) throw new Error("missing");
      row.version += 1;
    },
    writeAttempts: () => attempts,
    successfulUpdates: () => successes,
  };
}

function fail(
  policy: string,
  condition: string,
  actual: string,
): Result<void, DeniedReasons> {
  const f: PolicyFailure = { policy, condition, actual };
  return err(Object.freeze([f]) as DeniedReasons);
}

const draftOnly = (
  _i: SqlIntent,
  s: SqlState,
): Result<void, DeniedReasons> => {
  if (s.status === "draft") return ok(undefined);
  return fail("draftOnly", 'status == "draft"', `status=${s.status}`);
};

function parseSql(raw: unknown): Result<SqlIntent, ParseFailure> {
  if (raw === null || typeof raw !== "object") {
    return err({ code: "invalid_shape", detail: "not an object" });
  }
  const o = raw as Record<string, unknown>;
  if (typeof o["id"] !== "string" || typeof o["body"] !== "string") {
    return err({ code: "invalid_shape", detail: "id/body" });
  }
  return ok(Object.freeze({ id: o["id"], body: o["body"] }));
}

export type SqlBoundary = BoundaryHandle<SqlIntent, SqlState, SqlWitness>;

export function createSqlPublishBoundary(world: SqlWorld): SqlBoundary {
  return createBoundary({
    parse: parseSql,
    spec: {
      observe: (intent) => {
        const row = world.select(intent.id);
        if (!row) return err({ code: "not_found" });
        const witness: SqlWitness = Object.freeze({ version: row.version });
        return ok(Object.freeze({ state: row, witness }));
      },
      check: draftOnly,
      write: (intent, witness) => {
        const res = world.updateWhereVersion(
          intent.id,
          intent.body,
          witness.version,
        );
        if (res.rowCount === 0) {
          return err({ tag: "Conflict" } satisfies WriteFailure);
        }
        return ok(undefined);
      },
    },
  });
}
