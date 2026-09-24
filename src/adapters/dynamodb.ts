/**
 * Production adapter: DynamoDB-style GetItem + conditional UpdateItem.
 * Injectable store — no AWS SDK dependency. Published as `rupu-boundary/dynamodb`.
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

export type DynamoIntent = {
  readonly pk: string;
  readonly body: string;
};

export type DynamoState = {
  readonly pk: string;
  readonly body: string;
  readonly status: string;
  readonly version: number;
};

export type DynamoWitness = {
  readonly version: number;
};

export type DynamoBoundary = BoundaryHandle<
  DynamoIntent,
  DynamoState,
  DynamoWitness
>;

/** Minimal port — map your DocumentClient / Put/Update here. */
export type DynamoStoreLike = {
  readonly getItem: (pk: string) => Promise<{
    item: {
      pk: string;
      body: string;
      status: string;
      version: number;
    } | null;
  }>;
  /**
   * ConditionExpression equivalent: version = :expected.
   * Must return `"conflict"` when the condition fails (ConditionalCheckFailed).
   */
  readonly updateConditional: (args: {
    readonly pk: string;
    readonly body: string;
    readonly expectedVersion: number;
  }) => Promise<"ok" | "conflict" | "not_found">;
};

export type CreateDynamoBoundaryOptions = {
  readonly store: DynamoStoreLike;
  readonly check?: (
    intent: DynamoIntent,
    state: DynamoState,
  ) => Result<void, DeniedReasons>;
  readonly parse?: (raw: unknown) => Result<DynamoIntent, ParseFailure>;
};

function defaultParse(raw: unknown): Result<DynamoIntent, ParseFailure> {
  if (raw === null || typeof raw !== "object") {
    return err({ code: "invalid_shape", detail: "not an object" });
  }
  const o = raw as Record<string, unknown>;
  if (typeof o["pk"] !== "string" || typeof o["body"] !== "string") {
    return err({ code: "invalid_shape", detail: "pk/body" });
  }
  return ok(Object.freeze({ pk: o["pk"], body: o["body"] }));
}

const allowAny: (
  _i: DynamoIntent,
  _s: DynamoState,
) => Result<void, DeniedReasons> = () => ok(undefined);

/**
 * Boundary over a Dynamo item: observe via getItem, write via conditional update.
 * Coverage: bump `version` (or include every check attr in the condition) in `store`.
 */
export function createDynamoBoundary(
  options: CreateDynamoBoundaryOptions,
): DynamoBoundary {
  const { store } = options;
  const parse = options.parse ?? defaultParse;
  const check = options.check ?? allowAny;

  return createBoundary({
    parse,
    spec: {
      observe: async (intent) => {
        let res: Awaited<ReturnType<DynamoStoreLike["getItem"]>>;
        try {
          res = await store.getItem(intent.pk);
        } catch (e) {
          return err({
            code: "dynamo_get",
            detail: e instanceof Error ? e.message : "get_failed",
          } satisfies ObserveError);
        }
        if (!res.item) {
          return err({ code: "not_found" });
        }
        const { pk, body, status, version } = res.item;
        return ok(
          Object.freeze({
            state: Object.freeze({ pk, body, status, version }),
            witness: Object.freeze({ version }),
          }),
        );
      },
      check,
      write: async (intent, witness) => {
        let res: Awaited<ReturnType<DynamoStoreLike["updateConditional"]>>;
        try {
          res = await store.updateConditional({
            pk: intent.pk,
            body: intent.body,
            expectedVersion: witness.version,
          });
        } catch (e) {
          throw e instanceof Error ? e : new Error("dynamo_update_failed");
        }
        if (res === "conflict") {
          return err({ tag: "Conflict" } satisfies WriteFailure);
        }
        if (res === "not_found") {
          return err({ tag: "Error", code: "not_found" });
        }
        return ok(undefined);
      },
    },
  });
}
