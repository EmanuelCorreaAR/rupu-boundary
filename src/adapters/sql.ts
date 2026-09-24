/**
 * Production adapter: SQL OCC via SELECT + UPDATE … WHERE version = $w.
 * Injectable query port — no pg/mysql dependency. Published as `@rupu/boundary/sql`.
 */

import { err, ok, type Result } from "../result.js";
import {
  createBoundary,
  type BoundaryHandle,
  type DeniedReasons,
  type ObserveError,
  type ParseFailure,
  type WriteFailure,
} from "../runtime.js";

export type SqlIntent = {
  readonly id: string;
  readonly body: string;
};

export type SqlState = {
  readonly id: string;
  readonly body: string;
  readonly status: string;
  readonly version: number;
};

export type SqlWitness = {
  readonly version: number;
};

export type SqlBoundary = BoundaryHandle<SqlIntent, SqlState, SqlWitness>;

export type SqlRow = {
  readonly id: string;
  readonly body: string;
  readonly status: string;
  readonly version: number;
};

/** Minimal port — map your driver here. */
export type SqlQueryLike = {
  readonly selectById: (id: string) => Promise<SqlRow | null>;
  /**
   * `UPDATE … SET body=$body, status='published', version=version+1
   *  WHERE id=$id AND version=$expected`. Returns affected row count.
   */
  readonly updateWhereVersion: (args: {
    readonly id: string;
    readonly body: string;
    readonly expectedVersion: number;
  }) => Promise<{ rowCount: number }>;
};

export type CreateSqlBoundaryOptions = {
  readonly db: SqlQueryLike;
  readonly check?: (
    intent: SqlIntent,
    state: SqlState,
  ) => Result<void, DeniedReasons>;
  readonly parse?: (raw: unknown) => Result<SqlIntent, ParseFailure>;
};

function defaultParse(raw: unknown): Result<SqlIntent, ParseFailure> {
  if (raw === null || typeof raw !== "object") {
    return err({ code: "invalid_shape", detail: "not an object" });
  }
  const o = raw as Record<string, unknown>;
  if (typeof o["id"] !== "string" || typeof o["body"] !== "string") {
    return err({ code: "invalid_shape", detail: "id/body" });
  }
  return ok(Object.freeze({ id: o["id"], body: o["body"] }));
}

const allowAny: (
  _i: SqlIntent,
  _s: SqlState,
) => Result<void, DeniedReasons> = () => ok(undefined);

/**
 * Boundary over a versioned SQL row.
 * Coverage: every check-dependent column must bump `version` (or be in the WHERE).
 */
export function createSqlBoundary(
  options: CreateSqlBoundaryOptions,
): SqlBoundary {
  const { db } = options;
  const parse = options.parse ?? defaultParse;
  const check = options.check ?? allowAny;

  return createBoundary({
    parse,
    spec: {
      observe: async (intent) => {
        let row: SqlRow | null;
        try {
          row = await db.selectById(intent.id);
        } catch (e) {
          return err({
            code: "sql_select",
            detail: e instanceof Error ? e.message : "select_failed",
          } satisfies ObserveError);
        }
        if (!row) {
          return err({ code: "not_found" });
        }
        return ok(
          Object.freeze({
            state: Object.freeze({
              id: row.id,
              body: row.body,
              status: row.status,
              version: row.version,
            }),
            witness: Object.freeze({ version: row.version }),
          }),
        );
      },
      check,
      write: async (intent, witness) => {
        let res: { rowCount: number };
        try {
          res = await db.updateWhereVersion({
            id: intent.id,
            body: intent.body,
            expectedVersion: witness.version,
          });
        } catch (e) {
          throw e instanceof Error ? e : new Error("sql_update_failed");
        }
        if (res.rowCount === 0) {
          return err({
            code: "version_conflict",
            detail: "UPDATE_WHERE_version",
          } satisfies WriteFailure);
        }
        return ok(undefined);
      },
    },
  });
}
