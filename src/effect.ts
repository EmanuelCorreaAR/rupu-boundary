/**
 * Transfer adapter — maps bank ports onto algebra D (S vs W).
 */

import type {
  AccountSnapshot,
  ReadPort,
  TransferFailure,
  TransferIntent,
  WritePort,
} from "./bank.js";
import { err, ok, type Result } from "./result.js";
import {
  all,
  createBoundary,
  createBoundaryForTests,
  BOUNDARY_HANDLE_KEYS,
  type DeniedReasons,
  type BoundaryHandle,
  type BoundaryTestHandle,
  type Observation,
  type ParseFailure,
  type PolicyFailure,
  type WriteFailure,
} from "./runtime.js";

export type { TransferIntent, AccountSnapshot } from "./bank.js";
export { openBank, type OpenBank, type ReadPort, type WritePort } from "./bank.js";
export {
  createBoundary,
  createBoundaryForTests,
  liveExecutableCount,
  resetVault,
  BOUNDARY_HANDLE_KEYS,
  all,
  type Executable,
  type Proposal,
  type Denied,
  type Stale,
  type Unknown,
  type Committed,
  type BoundaryHandle,
  type BoundaryTestHandle,
  type Observation,
} from "./runtime.js";

export type TransferState = {
  readonly from: AccountSnapshot;
  readonly to: AccountSnapshot;
};

/** Minimal CAS token — not the full account snapshot. */
export type TransferWitness = {
  readonly fromVersion: number;
};

export type TransferObservation = Observation<TransferState, TransferWitness>;

function fail(
  policy: string,
  condition: string,
  actual: string,
): Result<void, DeniedReasons> {
  const f: PolicyFailure = { policy, condition, actual };
  return err(Object.freeze([f]) as DeniedReasons);
}

export const sufficientBalance = (
  intent: TransferIntent,
  state: TransferState,
): Result<void, DeniedReasons> => {
  if (state.from.balance >= intent.amount) return ok(undefined);
  return fail(
    "sufficientBalance",
    `from.balance >= ${intent.amount}`,
    `balance=${state.from.balance}`,
  );
};

export const accountActive = (
  _intent: TransferIntent,
  state: TransferState,
): Result<void, DeniedReasons> => {
  if (!state.from.active) {
    return fail("accountActive", "from.active == true", "from.active=false");
  }
  if (!state.to.active) {
    return fail("accountActive", "to.active == true", "to.active=false");
  }
  return ok(undefined);
};

/** External composition — not part of BoundarySpec. */
export const defaultCheck = all(sufficientBalance, accountActive);

function parseTransfer(raw: unknown): Result<TransferIntent, ParseFailure> {
  if (raw === null || typeof raw !== "object") {
    return err({ code: "invalid_shape", detail: "not an object" });
  }
  const o = raw as Record<string, unknown>;
  const from = o["from"];
  const to = o["to"];
  const amount = o["amount"];
  if (typeof from !== "string" || typeof to !== "string") {
    return err({ code: "invalid_shape", detail: "from/to must be strings" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return err({ code: "invalid_shape", detail: "amount must be a finite number" });
  }
  return ok(Object.freeze({ from, to, amount }));
}

function mapWriteError(e: TransferFailure): WriteFailure {
  return { code: e.code, detail: JSON.stringify(e) };
}

export type TransferBoundary = BoundaryHandle<
  TransferIntent,
  TransferState,
  TransferWitness
>;

export const TRANSFER_BOUNDARY_KEYS = BOUNDARY_HANDLE_KEYS;

function transferSpec(input: {
  readonly read: ReadPort;
  readonly write: WritePort;
  readonly check?: (
    intent: TransferIntent,
    state: TransferState,
  ) => Result<void, DeniedReasons>;
}) {
  const read = input.read;
  const write = input.write;
  const check = input.check ?? defaultCheck;
  return {
    parse: parseTransfer,
    spec: {
      observe: (intent: TransferIntent) => {
        const from = read.observe(intent.from);
        const to = read.observe(intent.to);
        if (!from || !to) {
          return err({ code: "account_not_found" });
        }
        const state: TransferState = Object.freeze({ from, to });
        const witness: TransferWitness = Object.freeze({
          fromVersion: from.version,
        });
        return ok(Object.freeze({ state, witness }));
      },
      check,
      write: (intent: TransferIntent, witness: TransferWitness) => {
        const cas = write.transferCAS({
          ...intent,
          expectedFromVersion: witness.fromVersion,
        });
        if (!cas.ok) return err(mapWriteError(cas.error));
        return ok(undefined);
      },
    },
  };
}

export function createTransferBoundary(input: {
  readonly read: ReadPort;
  readonly write: WritePort;
  readonly check?: (
    intent: TransferIntent,
    state: TransferState,
  ) => Result<void, DeniedReasons>;
}): TransferBoundary {
  return createBoundary(transferSpec(input));
}

/** Test harness — exposes evaluate. Not for app Activities. */
export function createTransferBoundaryForTests(input: {
  readonly read: ReadPort;
  readonly write: WritePort;
  readonly check?: (
    intent: TransferIntent,
    state: TransferState,
  ) => Result<void, DeniedReasons>;
}): BoundaryTestHandle<TransferIntent, TransferState, TransferWitness> {
  return createBoundaryForTests(transferSpec(input));
}
