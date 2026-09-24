/**
 * DynamoDB-style concurrency — ConditionExpression / item version.
 *
 * Same BoundarySpec lifecycle as ETag and SQL OCC.
 * W is the item version (or attrs named in the condition). No Dynamo SDK in core.
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

export type DynamoIntent = {
  readonly pk: string;
  readonly body: string;
};

export type DynamoState = {
  readonly pk: string;
  readonly body: string;
  readonly status: "draft" | "published";
  readonly version: number;
};

/** Witness = values that enter ConditionExpression. */
export type DynamoWitness = {
  readonly version: number;
};

type MutableItem = {
  body: string;
  status: "draft" | "published";
  version: number;
};

export type DynamoWorld = {
  readonly getItem: (
    pk: string,
  ) => { item: DynamoState } | { missing: true };
  readonly updateConditional: (
    pk: string,
    body: string,
    expectedVersion: number,
  ) => "ok" | "conflict" | "not_found";
  readonly seed: (pk: string, body: string, status?: "draft" | "published") => void;
  readonly externalBump: (pk: string) => void;
  readonly writeAttempts: () => number;
  readonly successfulUpdates: () => number;
};

export function openDynamoWorld(): DynamoWorld {
  const store = new Map<string, MutableItem>();
  let attempts = 0;
  let successes = 0;

  return {
    getItem: (pk) => {
      const item = store.get(pk);
      if (!item) return { missing: true };
      return {
        item: Object.freeze({
          pk,
          body: item.body,
          status: item.status,
          version: item.version,
        }),
      };
    },
    updateConditional: (pk, body, expectedVersion) => {
      attempts += 1;
      const item = store.get(pk);
      if (!item) return "not_found";
      // ConditionExpression: version = :expected
      if (item.version !== expectedVersion) return "conflict";
      item.body = body;
      item.status = "published";
      item.version += 1;
      successes += 1;
      return "ok";
    },
    seed: (pk, body, status = "draft") => {
      store.set(pk, { body, status, version: 1 });
    },
    externalBump: (pk) => {
      const item = store.get(pk);
      if (!item) throw new Error("missing");
      item.version += 1;
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
  _i: DynamoIntent,
  s: DynamoState,
): Result<void, DeniedReasons> => {
  if (s.status === "draft") return ok(undefined);
  return fail("draftOnly", 'status == "draft"', `status=${s.status}`);
};

function parseDynamo(raw: unknown): Result<DynamoIntent, ParseFailure> {
  if (raw === null || typeof raw !== "object") {
    return err({ code: "invalid_shape", detail: "not an object" });
  }
  const o = raw as Record<string, unknown>;
  if (typeof o["pk"] !== "string" || typeof o["body"] !== "string") {
    return err({ code: "invalid_shape", detail: "pk/body" });
  }
  return ok(Object.freeze({ pk: o["pk"], body: o["body"] }));
}

export type DynamoBoundary = BoundaryHandle<
  DynamoIntent,
  DynamoState,
  DynamoWitness
>;

export function createDynamoPublishBoundary(world: DynamoWorld): DynamoBoundary {
  return createBoundary({
    parse: parseDynamo,
    spec: {
      observe: (intent) => {
        const res = world.getItem(intent.pk);
        if ("missing" in res) return err({ code: "not_found" });
        const state = res.item;
        const witness: DynamoWitness = Object.freeze({ version: state.version });
        return ok(Object.freeze({ state, witness }));
      },
      check: draftOnly,
      write: (intent, witness) => {
        const res = world.updateConditional(
          intent.pk,
          intent.body,
          witness.version,
        );
        if (res === "conflict") {
          return err({
            code: "version_conflict",
            detail: "ConditionExpression",
          } satisfies WriteFailure);
        }
        if (res === "not_found") {
          return err({ code: "not_found" });
        }
        return ok(undefined);
      },
    },
  });
}
