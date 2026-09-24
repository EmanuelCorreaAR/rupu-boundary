/**
 * Transfer effect — thin domain adapter over the generic runtime.
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
  createEffect,
  EFFECT_HANDLE_KEYS,
  type EffectHandle,
  type ParseFailure,
  type Policy,
  type WriteFailure,
} from "./runtime.js";

export type { TransferIntent, AccountSnapshot } from "./bank.js";
export {
  createEffect,
  liveExecutableCount,
  resetVault,
  EFFECT_HANDLE_KEYS,
  type Executable,
  type Proposal,
  type Denied,
  type Stale,
  type Unknown,
  type Committed,
  type PolicyFailure,
  type PolicyVerdict,
  type EffectHandle,
} from "./runtime.js";

export type TransferSnapshot = {
  readonly from: AccountSnapshot;
  readonly to: AccountSnapshot;
};

export const sufficientBalance: Policy<TransferIntent, TransferSnapshot> = (
  intent,
  snap,
) => {
  if (snap.from.balance >= intent.amount) return { pass: true };
  return {
    pass: false,
    failure: {
      policy: "sufficientBalance",
      condition: `from.balance >= ${intent.amount}`,
      actual: `balance=${snap.from.balance}`,
    },
  };
};

export const accountActive: Policy<TransferIntent, TransferSnapshot> = (
  _intent,
  snap,
) => {
  if (!snap.from.active) {
    return {
      pass: false,
      failure: {
        policy: "accountActive",
        condition: "from.active == true",
        actual: "from.active=false",
      },
    };
  }
  if (!snap.to.active) {
    return {
      pass: false,
      failure: {
        policy: "accountActive",
        condition: "to.active == true",
        actual: "to.active=false",
      },
    };
  }
  return { pass: true };
};

export const defaultPolicies: readonly Policy<TransferIntent, TransferSnapshot>[] =
  Object.freeze([sufficientBalance, accountActive]);

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

function hashTransfer(snap: TransferSnapshot): string {
  const h = (a: AccountSnapshot) =>
    `v${a.version}:b${a.balance}:a${a.active ? 1 : 0}`;
  return `from=${h(snap.from)}|to=${h(snap.to)}`;
}

function mapWriteError(e: TransferFailure): WriteFailure {
  return { code: e.code, detail: JSON.stringify(e) };
}

export type TransferEffect = EffectHandle<TransferIntent, TransferSnapshot>;

/** @deprecated alias — use EFFECT_HANDLE_KEYS */
export const TRANSFER_EFFECT_KEYS = EFFECT_HANDLE_KEYS;

export function createTransferEffect(input: {
  readonly read: ReadPort;
  readonly write: WritePort;
  readonly policies?: readonly Policy<TransferIntent, TransferSnapshot>[];
}): TransferEffect {
  const read = input.read;
  const write = input.write;
  const policies = input.policies ?? defaultPolicies;

  return createEffect<TransferIntent, TransferSnapshot>({
    parse: parseTransfer,
    observe: (intent) => {
      const from = read.observe(intent.from);
      const to = read.observe(intent.to);
      if (!from || !to) return null;
      return Object.freeze({ from, to });
    },
    hash: hashTransfer,
    policies,
    write: (intent, snap) => {
      const cas = write.transferCAS({
        ...intent,
        expectedFromVersion: snap.from.version,
      });
      if (!cas.ok) return err(mapWriteError(cas.error));
      return ok(undefined);
    },
  });
}
