/**
 * Production adapter: HTTP resource publish via GET + PUT If-Match.
 * Outside test fixtures — published as `@rupu/boundary/etag`.
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

export type EtagIntent = {
  readonly url: string;
  readonly body: string;
};

export type EtagState = {
  readonly url: string;
  readonly body: string;
  readonly contentType: string;
};

export type EtagWitness = {
  readonly etag: string;
};

export type EtagBoundary = BoundaryHandle<EtagIntent, EtagState, EtagWitness>;

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
}>;

export type CreateEtagBoundaryOptions = {
  readonly fetch?: FetchLike;
  /** Default: only allow overwrite when remote body parses / exists (200). */
  readonly check?: (
    intent: EtagIntent,
    state: EtagState,
  ) => Result<void, DeniedReasons>;
  readonly parse?: (raw: unknown) => Result<EtagIntent, ParseFailure>;
};

function defaultParse(raw: unknown): Result<EtagIntent, ParseFailure> {
  if (raw === null || typeof raw !== "object") {
    return err({ code: "invalid_shape", detail: "not an object" });
  }
  const o = raw as Record<string, unknown>;
  if (typeof o["url"] !== "string" || typeof o["body"] !== "string") {
    return err({ code: "invalid_shape", detail: "url/body" });
  }
  return ok(Object.freeze({ url: o["url"], body: o["body"] }));
}

const allowExisting: (
  _i: EtagIntent,
  _s: EtagState,
) => Result<void, DeniedReasons> = () => ok(undefined);

/**
 * Boundary over a URL: observe via GET (ETag), write via PUT If-Match.
 * Composition root should pass `fetch` bound with auth; app gets only the handle.
 */
export function createEtagBoundary(
  options: CreateEtagBoundaryOptions = {},
): EtagBoundary {
  const fetchFn: FetchLike = options.fetch ?? globalThis.fetch;
  const parse = options.parse ?? defaultParse;
  const check = options.check ?? allowExisting;

  return createBoundary({
    parse,
    spec: {
      observe: async (intent) => {
        let res: Awaited<ReturnType<FetchLike>>;
        try {
          res = await fetchFn(intent.url, { method: "GET" });
        } catch (e) {
          return err({
            code: "network",
            detail: e instanceof Error ? e.message : "fetch_failed",
          } satisfies ObserveError);
        }
        if (res.status === 404) {
          return err({ code: "not_found" });
        }
        if (!res.ok) {
          return err({ code: `http_${res.status}` });
        }
        const etag = res.headers.get("etag");
        if (!etag) {
          return err({ code: "missing_etag" });
        }
        const body = await res.text();
        const contentType = res.headers.get("content-type") ?? "text/plain";
        return ok(
          Object.freeze({
            state: Object.freeze({
              url: intent.url,
              body,
              contentType,
            }),
            witness: Object.freeze({ etag }),
          }),
        );
      },
      check,
      write: async (intent, witness) => {
        let res: Awaited<ReturnType<FetchLike>>;
        try {
          res = await fetchFn(intent.url, {
            method: "PUT",
            headers: {
              "If-Match": witness.etag,
              "Content-Type": "text/plain; charset=utf-8",
            },
            body: intent.body,
          });
        } catch (e) {
          throw e instanceof Error ? e : new Error("fetch_failed");
        }
        if (res.status === 412) {
          return err({
            code: "version_conflict",
            detail: "412_precondition_failed",
          } satisfies WriteFailure);
        }
        if (res.status === 404) {
          return err({ code: "not_found" });
        }
        if (!res.ok) {
          return err({ code: `http_${res.status}` });
        }
        return ok(undefined);
      },
    },
  });
}
