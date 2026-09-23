/**
 * Domain effect boundary — FP core.
 *
 * Probabilistic (agent JSON) enters as data.
 * Pure functions decide.
 * The only write is commit → bank.transferCAS.
 *
 * There is no exported unlocked transfer.
 */

import {
  FakeBank,
  type AccountSnapshot,
  type TransferFailure,
  type TransferIntent,
} from "./bank.js";
import { err, ok, type Result } from "./result.js";

// ── Immutable evidence ──────────────────────────────────────────────

export type Observation = {
  readonly accountId: string;
  readonly version: number;
  readonly hash: string;
  readonly balance: number;
  readonly active: boolean;
};

export type Evidence = {
  readonly observedAt: string;
  readonly from: Observation;
  readonly to: Observation;
};

export type PolicyFailure = {
  readonly policy: string;
  readonly condition: string;
  readonly actual: string;
};

export type PolicyVerdict =
  | { readonly pass: true }
  | { readonly pass: false; readonly failure: PolicyFailure };

/** Pure: intent + snapshots → pass/fail. No I/O. */
export type Policy = (
  intent: TransferIntent,
  from: AccountSnapshot,
  to: AccountSnapshot,
) => PolicyVerdict;

// ── Lifecycle data (immutable) ──────────────────────────────────────

export type Proposal = {
  readonly tag: "Proposal";
  readonly intent: TransferIntent;
  readonly raw: unknown;
};

export type Denied = {
  readonly tag: "Denied";
  readonly intent: TransferIntent;
  readonly failed: readonly PolicyFailure[];
};

export type Stale = {
  readonly tag: "Stale";
  readonly intent: TransferIntent;
  readonly reason: string;
  readonly evidence: Evidence;
};

export type Unknown = {
  readonly tag: "Unknown";
  readonly intent: TransferIntent;
  readonly reason: string;
};

export type Committed = {
  readonly tag: "Committed";
  readonly intent: TransferIntent;
  readonly evidence: Evidence;
  readonly fromVersionAfter: number;
};

/**
 * Opaque single-use capability. Not a plain DTO — body lives in the vault.
 * Forging a structural twin does nothing: commit looks up the vault by token.
 */
export type Executable = {
  readonly tag: "Executable";
  readonly __token: symbol;
};

type SealedBody = {
  readonly intent: TransferIntent;
  readonly evidence: Evidence;
  spent: boolean;
};

const vault = new Map<symbol, SealedBody>();

function seal(intent: TransferIntent, evidence: Evidence): Executable {
  const token = Symbol("rupu.executable");
  vault.set(token, { intent, evidence, spent: false });
  return Object.freeze({ tag: "Executable", __token: token });
}

function peek(executable: Executable): SealedBody | null {
  return vault.get(executable.__token) ?? null;
}

function consume(executable: Executable): Result<SealedBody, string> {
  const body = vault.get(executable.__token);
  if (!body) return err("forged_or_unknown_executable");
  if (body.spent) return err("executable_already_spent");
  body.spent = true;
  vault.delete(executable.__token);
  return ok(body);
}

/** Test/diag only: how many live capabilities remain. */
export function liveExecutableCount(): number {
  return vault.size;
}

export function resetVault(): void {
  vault.clear();
}

// ── Pure helpers ────────────────────────────────────────────────────

export function hashSnapshot(s: AccountSnapshot): string {
  return `v${s.version}:b${s.balance}:a${s.active ? 1 : 0}`;
}

export function observationOf(s: AccountSnapshot): Observation {
  return Object.freeze({
    accountId: s.id,
    version: s.version,
    hash: hashSnapshot(s),
    balance: s.balance,
    active: s.active,
  });
}

export function buildEvidence(
  from: AccountSnapshot,
  to: AccountSnapshot,
  observedAt: string,
): Evidence {
  return Object.freeze({
    observedAt,
    from: observationOf(from),
    to: observationOf(to),
  });
}

export const sufficientBalance: Policy = (intent, from) => {
  if (from.balance >= intent.amount) return { pass: true };
  return {
    pass: false,
    failure: {
      policy: "sufficientBalance",
      condition: `from.balance >= ${intent.amount}`,
      actual: `balance=${from.balance}`,
    },
  };
};

export const accountActive: Policy = (_intent, from, to) => {
  if (!from.active) {
    return {
      pass: false,
      failure: {
        policy: "accountActive",
        condition: "from.active == true",
        actual: "from.active=false",
      },
    };
  }
  if (!to.active) {
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

export type ParseFailure = { readonly code: "invalid_shape"; readonly detail: string };

/** Pure: unknown agent output → Proposal | Err */
export function propose(raw: unknown): Result<Proposal, ParseFailure> {
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
  const intent: TransferIntent = Object.freeze({ from, to, amount });
  return ok(Object.freeze({ tag: "Proposal", intent, raw }));
}

export type EvaluateInput = {
  readonly proposal: Proposal;
  readonly from: AccountSnapshot;
  readonly to: AccountSnapshot;
  readonly policies: readonly Policy[];
  readonly observedAt: string;
};

/**
 * PURE evaluate: Proposal + snapshots + policies → Denied | Executable.
 * No bank I/O. Caller must have observed already.
 */
export function evaluate(
  input: EvaluateInput,
): Result<Executable, Denied> {
  const { proposal, from, to, policies, observedAt } = input;
  const failed: PolicyFailure[] = [];
  for (const policy of policies) {
    const v = policy(proposal.intent, from, to);
    if (!v.pass) failed.push(v.failure);
  }
  if (failed.length > 0) {
    return err(
      Object.freeze({
        tag: "Denied",
        intent: proposal.intent,
        failed: Object.freeze([...failed]),
      }),
    );
  }
  const evidence = buildEvidence(from, to, observedAt);
  return ok(seal(proposal.intent, evidence));
}

export type CommitFailure =
  | Stale
  | Unknown
  | { readonly tag: "Spent"; readonly reason: string }
  | { readonly tag: "Bank"; readonly error: TransferFailure };

/**
 * Effectful commit — the ONLY write path.
 * Re-observes, checks freshness against sealed evidence, then CAS.
 */
export function commit(
  bank: FakeBank,
  executable: Executable,
): Result<Committed, CommitFailure> {
  const sealed = consume(executable);
  if (!sealed.ok) {
    return err({ tag: "Spent", reason: sealed.error });
  }

  const { intent, evidence } = sealed.value;

  let from: AccountSnapshot | null;
  let to: AccountSnapshot | null;
  try {
    from = bank.observe(intent.from);
    to = bank.observe(intent.to);
  } catch (e) {
    return err({
      tag: "Unknown",
      intent,
      reason: e instanceof Error ? e.message : "observe_failed",
    });
  }

  if (!from || !to) {
    return err({
      tag: "Unknown",
      intent,
      reason: "account_missing_at_commit",
    });
  }

  const fromHash = hashSnapshot(from);
  const toHash = hashSnapshot(to);
  if (fromHash !== evidence.from.hash || toHash !== evidence.to.hash) {
    return err({
      tag: "Stale",
      intent,
      reason: "world_changed_since_evidence",
      evidence,
    });
  }

  let cas: ReturnType<FakeBank["transferCAS"]>;
  try {
    cas = bank.transferCAS({
      ...intent,
      expectedFromVersion: evidence.from.version,
    });
  } catch (e) {
    return err({
      tag: "Unknown",
      intent,
      reason: e instanceof Error ? `adapter:${e.message}` : "adapter_threw",
    });
  }

  if (!cas.ok) {
    if (cas.error.code === "version_conflict") {
      return err({
        tag: "Stale",
        intent,
        reason: "cas_version_conflict",
        evidence,
      });
    }
    return err({ tag: "Bank", error: cas.error });
  }

  return ok(
    Object.freeze({
      tag: "Committed",
      intent,
      evidence,
      fromVersionAfter: cas.value.from.version,
    }),
  );
}

/** Default policy set for the spike. */
export const defaultPolicies: readonly Policy[] = Object.freeze([
  sufficientBalance,
  accountActive,
]);

/**
 * Convenience orchestration (still thin): observe → pure evaluate.
 * Keeps I/O at the edges.
 */
export function prepare(
  bank: FakeBank,
  proposal: Proposal,
  policies: readonly Policy[] = defaultPolicies,
  clock: () => string = () => new Date().toISOString(),
): Result<Executable, Denied | Unknown> {
  const from = bank.observe(proposal.intent.from);
  const to = bank.observe(proposal.intent.to);
  if (!from || !to) {
    return err({
      tag: "Unknown",
      intent: proposal.intent,
      reason: "account_not_found_at_observe",
    });
  }
  return evaluate({
    proposal,
    from,
    to,
    policies,
    observedAt: clock(),
  });
}
