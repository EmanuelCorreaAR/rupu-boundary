/**
 * Defective refund adapter — Coverage hole by construction.
 *
 * check depends on: status, amount, currency
 * witness captures only: statusVersion, amountVersion  (NOT currency)
 *
 * If currency flips ARS → USD between prepare and commit while status/amount
 * stay put, commit can still succeed → false-fresh. That is the declared
 * Boundary limit (Coverage = adapter obligation), not a runtime bug.
 */

import { err, ok, type Result } from "../result.js";
import {
  all,
  createBoundary,
  type BoundaryHandle,
  type DeniedReasons,
  type ParseFailure,
  type PolicyFailure,
  type WriteFailure,
} from "../runtime.js";

export type HoleIntent = {
  readonly paymentId: string;
  readonly amount: number;
};

export type HoleState = {
  readonly id: string;
  readonly status: "CAPTURED" | "REFUNDED";
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  /** Bumps only when status or amount change — not currency. */
  readonly statusAmountVersion: number;
};

export type HoleWitness = {
  readonly statusAmountVersion: number;
};

type Mutable = {
  status: "CAPTURED" | "REFUNDED";
  amount: number;
  currency: "ARS" | "USD";
  statusAmountVersion: number;
};

export type HoleWorld = {
  readonly observe: (id: string) => HoleState | null;
  readonly seed: (
    id: string,
    amount: number,
    currency?: "ARS" | "USD",
  ) => void;
  /** Mutate currency without bumping the witness-relevant version. */
  readonly setCurrency: (id: string, currency: "ARS" | "USD") => void;
  /** Bump witness-relevant version (simulates covered-field change). */
  readonly bumpStatusAmountVersion: (id: string) => void;
  readonly writeAttempts: () => number;
  readonly successfulRefunds: () => number;
  readonly takeWritePort: () => {
    refundOnce: (
      intent: HoleIntent,
      expectedVersion: number,
    ) => Result<void, WriteFailure>;
  };
};

export function openHoleWorld(): HoleWorld {
  const store = new Map<string, Mutable>();
  let writeTaken = false;
  let attempts = 0;
  let successes = 0;

  const observe = (id: string): HoleState | null => {
    const p = store.get(id);
    if (!p) return null;
    return Object.freeze({
      id,
      status: p.status,
      amount: p.amount,
      currency: p.currency,
      statusAmountVersion: p.statusAmountVersion,
    });
  };

  const refundOnce = (
    intent: HoleIntent,
    expectedVersion: number,
  ): Result<void, WriteFailure> => {
    attempts += 1;
    const p = store.get(intent.paymentId);
    if (!p) return err({ tag: "Error", code: "not_found" });
    if (p.statusAmountVersion !== expectedVersion) {
      return err({ tag: "Conflict" });
    }
    if (p.status !== "CAPTURED") {
      return err({ tag: "Error", code: "invalid_status", detail: p.status });
    }
    // Write also does NOT re-check currency — hole extends into write.
    p.status = "REFUNDED";
    p.statusAmountVersion += 1;
    successes += 1;
    return ok(undefined);
  };

  return {
    observe,
    seed: (id, amount, currency = "ARS") => {
      store.set(id, {
        status: "CAPTURED",
        amount,
        currency,
        statusAmountVersion: 1,
      });
    },
    setCurrency: (id, currency) => {
      const p = store.get(id);
      if (!p) throw new Error("not_found");
      p.currency = currency;
      // Deliberate: do not bump statusAmountVersion.
    },
    bumpStatusAmountVersion: (id) => {
      const p = store.get(id);
      if (!p) throw new Error("not_found");
      p.statusAmountVersion += 1;
    },
    writeAttempts: () => attempts,
    successfulRefunds: () => successes,
    takeWritePort: () => {
      if (writeTaken) throw new Error("write_port_already_taken");
      writeTaken = true;
      return { refundOnce };
    },
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

const capturedOnly = (
  _i: HoleIntent,
  s: HoleState,
): Result<void, DeniedReasons> => {
  if (s.status === "CAPTURED") return ok(undefined);
  return fail("capturedOnly", 'status == "CAPTURED"', `status=${s.status}`);
};

const amountMatches = (
  i: HoleIntent,
  s: HoleState,
): Result<void, DeniedReasons> => {
  if (i.amount === s.amount) return ok(undefined);
  return fail("amountMatches", `amount == ${s.amount}`, `amount=${i.amount}`);
};

/** Decision depends on currency — but witness will NOT cover it. */
const arsOnly = (
  _i: HoleIntent,
  s: HoleState,
): Result<void, DeniedReasons> => {
  if (s.currency === "ARS") return ok(undefined);
  return fail("arsOnly", 'currency == "ARS"', `currency=${s.currency}`);
};

function parseHole(raw: unknown): Result<HoleIntent, ParseFailure> {
  if (raw === null || typeof raw !== "object") {
    return err({ code: "invalid_shape", detail: "not an object" });
  }
  const o = raw as Record<string, unknown>;
  if (typeof o["paymentId"] !== "string" || typeof o["amount"] !== "number") {
    return err({ code: "invalid_shape", detail: "paymentId/amount" });
  }
  return ok(
    Object.freeze({
      paymentId: o["paymentId"] as string,
      amount: o["amount"] as number,
    }),
  );
}

export type HoleBoundary = BoundaryHandle<HoleIntent, HoleState, HoleWitness>;

/** Incorrect adapter: check uses currency; W omits it. */
export function createHoleyRefundBoundary(world: HoleWorld): HoleBoundary {
  const write = world.takeWritePort();
  return createBoundary({
    parse: parseHole,
    spec: {
      observe: (intent) => {
        const state = world.observe(intent.paymentId);
        if (!state) return err({ code: "not_found" });
        const witness: HoleWitness = Object.freeze({
          statusAmountVersion: state.statusAmountVersion,
        });
        return ok(Object.freeze({ state, witness }));
      },
      check: all(capturedOnly, amountMatches, arsOnly),
      write: (intent, witness) =>
        write.refundOnce(intent, witness.statusAmountVersion),
    },
  });
}
