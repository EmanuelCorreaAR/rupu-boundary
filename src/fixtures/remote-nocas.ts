/**
 * Remote side-effect without CAS — honesty kill-test.
 *
 * After Boundary confirms freshness (re-observe + witnessEq), write is a blind
 * POST that ignores W. A race before POST can invalidate decision premises
 * while commit still returns Committed.
 *
 * Delimits: freshness through compare(W); (fresh → write) atomicity = write port.
 */

import { err, ok, type Result } from "../result.js";
import {
  createBoundary,
  type BoundaryHandle,
  type DeniedReasons,
  type ParseFailure,
  type WriteFailure,
} from "../runtime.js";

export type BlindIntent = { readonly id: string; readonly amount: number };

export type BlindState = {
  readonly id: string;
  readonly remaining: number;
  readonly version: number;
};

export type BlindWitness = { readonly version: number };

type Mutable = { remaining: number; version: number };

export type BlindWorld = {
  readonly observe: (id: string) => BlindState | null;
  readonly seed: (id: string, remaining: number) => void;
  readonly mutate: (id: string, remaining: number) => void;
  /** Runs once at the start of write() — after Boundary already said fresh. */
  readonly armRaceInWrite: (fn: () => void) => void;
  readonly writeAttempts: () => number;
  readonly posts: () => number;
  readonly remainingOf: (id: string) => number;
  /** Used only by the adapter write. */
  readonly postBlind: () => Result<void, WriteFailure>;
};

export function openBlindRemote(): BlindWorld {
  const store = new Map<string, Mutable>();
  let attempts = 0;
  let posts = 0;
  let race: (() => void) | null = null;

  return {
    observe: (id) => {
      const p = store.get(id);
      if (!p) return null;
      return Object.freeze({
        id,
        remaining: p.remaining,
        version: p.version,
      });
    },
    seed: (id, remaining) => {
      store.set(id, { remaining, version: 1 });
    },
    mutate: (id, remaining) => {
      const p = store.get(id);
      if (!p) throw new Error("missing");
      p.remaining = remaining;
      p.version += 1;
    },
    armRaceInWrite: (fn) => {
      race = fn;
    },
    writeAttempts: () => attempts,
    posts: () => posts,
    remainingOf: (id) => store.get(id)?.remaining ?? -1,
    postBlind: () => {
      attempts += 1;
      if (race) {
        const r = race;
        race = null;
        r();
      }
      posts += 1;
      // Blind POST: no If-Match / no version check — always "accepted".
      return ok(undefined);
    },
  };
}

function parseBlind(raw: unknown): Result<BlindIntent, ParseFailure> {
  if (raw === null || typeof raw !== "object") {
    return err({ code: "invalid_shape", detail: "not an object" });
  }
  const o = raw as Record<string, unknown>;
  if (typeof o["id"] !== "string" || typeof o["amount"] !== "number") {
    return err({ code: "invalid_shape", detail: "id/amount" });
  }
  return ok(Object.freeze({ id: o["id"], amount: o["amount"] }));
}

const enoughRemaining = (
  i: BlindIntent,
  s: BlindState,
): Result<void, DeniedReasons> => {
  if (s.remaining >= i.amount) return ok(undefined);
  return err(
    Object.freeze([
      {
        policy: "enoughRemaining",
        condition: `remaining >= ${i.amount}`,
        actual: `remaining=${s.remaining}`,
      },
    ]) as DeniedReasons,
  );
};

export type BlindBoundary = BoundaryHandle<BlindIntent, BlindState, BlindWitness>;

export function createBlindChargeBoundary(world: BlindWorld): BlindBoundary {
  return createBoundary({
    parse: parseBlind,
    spec: {
      observe: (intent) => {
        const state = world.observe(intent.id);
        if (!state) return err({ code: "not_found" });
        return ok(
          Object.freeze({
            state,
            witness: Object.freeze({ version: state.version }),
          }),
        );
      },
      check: enoughRemaining,
      write: (_intent, _witness) => world.postBlind(),
    },
  });
}
