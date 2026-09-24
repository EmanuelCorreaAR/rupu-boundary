/**
 * Refund fixture — algebra D: Observation<S,W> + check + write(W).
 */

import { err, ok, type Result } from "../result.js";
import {
  all,
  createBoundary,
  type DeniedReasons,
  type BoundaryHandle,
  type ParseFailure,
  type PolicyFailure,
  type WriteFailure,
} from "../runtime.js";

export type PaymentId = string;
export type PaymentStatus = "CAPTURED" | "REFUNDED" | "VOID";

export type PaymentState = {
  readonly id: PaymentId;
  readonly status: PaymentStatus;
  readonly amount: number;
  readonly version: number;
};

export type RefundWitness = {
  readonly version: number;
};

export type RefundIntent = {
  readonly paymentId: PaymentId;
  readonly amount: number;
};

type MutablePayment = {
  status: PaymentStatus;
  amount: number;
  version: number;
};

export type PaymentsWorld = {
  readonly observe: (id: PaymentId) => PaymentState | null;
  readonly takeWritePort: () => {
    refundOnce: (
      intent: RefundIntent,
      expectedVersion: number,
    ) => Result<void, WriteFailure>;
  };
  readonly seed: (id: PaymentId, amount: number, status?: PaymentStatus) => void;
  readonly externalRefund: (
    intent: RefundIntent,
    expectedVersion: number,
  ) => Result<void, WriteFailure>;
  /** Hostility harness: how many times refundOnce was entered. */
  readonly writeAttempts: () => number;
  readonly successfulRefunds: () => number;
};

export function openPayments(): PaymentsWorld {
  const store = new Map<PaymentId, MutablePayment>();
  let writeTaken = false;
  let attempts = 0;
  let successes = 0;

  const observe = (id: PaymentId): PaymentState | null => {
    const p = store.get(id);
    if (!p) return null;
    return Object.freeze({
      id,
      status: p.status,
      amount: p.amount,
      version: p.version,
    });
  };

  const refundOnce = (
    intent: RefundIntent,
    expectedVersion: number,
  ): Result<void, WriteFailure> => {
    attempts += 1;
    const p = store.get(intent.paymentId);
    if (!p) return err({ code: "not_found" });
    if (p.version !== expectedVersion) {
      return err({ code: "version_conflict" });
    }
    if (p.status !== "CAPTURED") {
      return err({ code: "invalid_status", detail: p.status });
    }
    if (intent.amount !== p.amount) {
      return err({ code: "amount_mismatch" });
    }
    p.status = "REFUNDED";
    p.version += 1;
    successes += 1;
    return ok(undefined);
  };

  return {
    observe,
    takeWritePort: () => {
      if (writeTaken) throw new Error("write_port_already_taken");
      writeTaken = true;
      return { refundOnce };
    },
    seed: (id, amount, status = "CAPTURED") => {
      store.set(id, { status, amount, version: 1 });
    },
    externalRefund: refundOnce,
    writeAttempts: () => attempts,
    successfulRefunds: () => successes,
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
  _intent: RefundIntent,
  state: PaymentState,
): Result<void, DeniedReasons> => {
  if (state.status === "CAPTURED") return ok(undefined);
  return fail("capturedOnly", 'status == "CAPTURED"', `status=${state.status}`);
};

const fullAmountOnly = (
  intent: RefundIntent,
  state: PaymentState,
): Result<void, DeniedReasons> => {
  if (intent.amount === state.amount) return ok(undefined);
  return fail(
    "fullAmountOnly",
    `amount == ${state.amount}`,
    `amount=${intent.amount}`,
  );
};

function parseRefund(raw: unknown): Result<RefundIntent, ParseFailure> {
  if (raw === null || typeof raw !== "object") {
    return err({ code: "invalid_shape", detail: "not an object" });
  }
  const o = raw as Record<string, unknown>;
  const paymentId = o["paymentId"];
  const amount = o["amount"];
  if (typeof paymentId !== "string") {
    return err({ code: "invalid_shape", detail: "paymentId" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return err({ code: "invalid_shape", detail: "amount" });
  }
  return ok(Object.freeze({ paymentId, amount }));
}

export type RefundBoundary = BoundaryHandle<RefundIntent, PaymentState, RefundWitness>;

export function createRefundBoundary(world: PaymentsWorld): RefundBoundary {
  const write = world.takeWritePort();
  return createBoundary({
    parse: parseRefund,
    spec: {
      observe: (intent) => {
        const state = world.observe(intent.paymentId);
        if (!state) return err({ code: "not_found" });
        const witness: RefundWitness = Object.freeze({ version: state.version });
        return ok(Object.freeze({ state, witness }));
      },
      check: all(capturedOnly, fullAmountOnly),
      write: (intent, witness) => write.refundOnce(intent, witness.version),
    },
  });
}
