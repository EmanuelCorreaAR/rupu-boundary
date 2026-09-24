/**
 * Refund fixture — same runtime, different schema/observe/invariants/write.
 */

import { err, ok, type Result } from "../result.js";
import {
  createEffect,
  type EffectHandle,
  type ParseFailure,
  type Policy,
  type WriteFailure,
} from "../runtime.js";

export type PaymentId = string;

export type PaymentStatus = "CAPTURED" | "REFUNDED" | "VOID";

export type PaymentSnapshot = {
  readonly id: PaymentId;
  readonly status: PaymentStatus;
  readonly amount: number;
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
  readonly observe: (id: PaymentId) => PaymentSnapshot | null;
  readonly takeWritePort: () => {
    refundOnce: (
      intent: RefundIntent,
      expectedVersion: number,
    ) => Result<void, WriteFailure>;
  };
  readonly seed: (id: PaymentId, amount: number, status?: PaymentStatus) => void;
  /** External actor for stale tests. */
  readonly externalRefund: (
    intent: RefundIntent,
    expectedVersion: number,
  ) => Result<void, WriteFailure>;
};

export function openPayments(): PaymentsWorld {
  const store = new Map<PaymentId, MutablePayment>();
  let writeTaken = false;

  const observe = (id: PaymentId): PaymentSnapshot | null => {
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
  };
}

const capturedOnly: Policy<RefundIntent, PaymentSnapshot> = (intent, snap) => {
  if (snap.status === "CAPTURED") return { pass: true };
  return {
    pass: false,
    failure: {
      policy: "capturedOnly",
      condition: 'status == "CAPTURED"',
      actual: `status=${snap.status}`,
    },
  };
};

const fullAmountOnly: Policy<RefundIntent, PaymentSnapshot> = (intent, snap) => {
  if (intent.amount === snap.amount) return { pass: true };
  return {
    pass: false,
    failure: {
      policy: "fullAmountOnly",
      condition: `amount == ${snap.amount}`,
      actual: `amount=${intent.amount}`,
    },
  };
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

export type RefundEffect = EffectHandle<RefundIntent, PaymentSnapshot>;

export function createRefundEffect(world: PaymentsWorld): RefundEffect {
  const write = world.takeWritePort();
  return createEffect<RefundIntent, PaymentSnapshot>({
    parse: parseRefund,
    observe: (intent) => world.observe(intent.paymentId),
    hash: (snap) => `v${snap.version}:s${snap.status}:a${snap.amount}`,
    policies: [capturedOnly, fullAmountOnly],
    write: (intent, snap) => write.refundOnce(intent, snap.version),
  });
}
