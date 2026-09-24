/**
 * HTTP concurrency model — ETag / If-Match.
 *
 * Same BoundarySpec lifecycle; different authority mechanism than local OCC rows.
 * W is an opaque ETag string. Freshness at write is enforced by the "server"
 * via If-Match (412 → version_conflict → Stale). No core HTTP special-cases.
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

export type HttpIntent = {
  readonly path: string;
  readonly body: string;
};

export type HttpState = {
  readonly path: string;
  readonly body: string;
  readonly status: "draft" | "published";
};

export type HttpWitness = {
  readonly etag: string;
};

type MutableDoc = {
  body: string;
  status: "draft" | "published";
  etag: string;
  etagSeq: number;
};

export type HttpWorld = {
  readonly get: (
    path: string,
  ) => { status: 200; body: string; etag: string; docStatus: "draft" | "published" } | { status: 404 };
  readonly putIfMatch: (
    path: string,
    body: string,
    ifMatch: string,
  ) => { status: 200 | 412 | 404 };
  readonly seed: (path: string, body: string, status?: "draft" | "published") => void;
  /** External actor changes the resource (new ETag). */
  readonly externalPut: (path: string, body: string) => void;
  readonly writeAttempts: () => number;
  readonly successfulPuts: () => number;
};

export function openHttpWorld(): HttpWorld {
  const store = new Map<string, MutableDoc>();
  let attempts = 0;
  let successes = 0;

  const nextEtag = (doc: MutableDoc) => {
    doc.etagSeq += 1;
    doc.etag = `"v${doc.etagSeq}"`;
  };

  return {
    get: (path) => {
      const doc = store.get(path);
      if (!doc) return { status: 404 };
      return {
        status: 200,
        body: doc.body,
        etag: doc.etag,
        docStatus: doc.status,
      };
    },
    putIfMatch: (path, body, ifMatch) => {
      attempts += 1;
      const doc = store.get(path);
      if (!doc) return { status: 404 };
      if (doc.etag !== ifMatch) return { status: 412 };
      doc.body = body;
      doc.status = "published";
      nextEtag(doc);
      successes += 1;
      return { status: 200 };
    },
    seed: (path, body, status = "draft") => {
      const doc: MutableDoc = {
        body,
        status,
        etag: "",
        etagSeq: 0,
      };
      nextEtag(doc);
      store.set(path, doc);
    },
    externalPut: (path, body) => {
      const doc = store.get(path);
      if (!doc) throw new Error("404");
      doc.body = body;
      nextEtag(doc);
    },
    writeAttempts: () => attempts,
    successfulPuts: () => successes,
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
  _i: HttpIntent,
  s: HttpState,
): Result<void, DeniedReasons> => {
  if (s.status === "draft") return ok(undefined);
  return fail("draftOnly", 'status == "draft"', `status=${s.status}`);
};

function parseHttp(raw: unknown): Result<HttpIntent, ParseFailure> {
  if (raw === null || typeof raw !== "object") {
    return err({ code: "invalid_shape", detail: "not an object" });
  }
  const o = raw as Record<string, unknown>;
  if (typeof o["path"] !== "string" || typeof o["body"] !== "string") {
    return err({ code: "invalid_shape", detail: "path/body" });
  }
  return ok(Object.freeze({ path: o["path"], body: o["body"] }));
}

export type HttpBoundary = BoundaryHandle<HttpIntent, HttpState, HttpWitness>;

export function createHttpPublishBoundary(world: HttpWorld): HttpBoundary {
  return createBoundary({
    parse: parseHttp,
    spec: {
      observe: (intent) => {
        const res = world.get(intent.path);
        if (res.status === 404) return err({ code: "not_found" });
        const state: HttpState = Object.freeze({
          path: intent.path,
          body: res.body,
          status: res.docStatus,
        });
        const witness: HttpWitness = Object.freeze({ etag: res.etag });
        return ok(Object.freeze({ state, witness }));
      },
      check: draftOnly,
      write: (intent, witness) => {
        const res = world.putIfMatch(intent.path, intent.body, witness.etag);
        if (res.status === 412) {
          return err({ code: "version_conflict", detail: "412_precondition_failed" });
        }
        if (res.status === 404) {
          return err({ code: "not_found", detail: "404" });
        }
        return ok(undefined);
      },
    },
  });
}
