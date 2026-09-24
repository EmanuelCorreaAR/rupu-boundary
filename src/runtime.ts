/**
 * Generic effect runtime — domain-agnostic propose → prepare → commit.
 *
 * I = intent (parsed agent output)
 * S = snapshot (observed world slice)
 */

import { err, ok, type Result } from "./result.js";

export type PolicyFailure = {
  readonly policy: string;
  readonly condition: string;
  readonly actual: string;
};

export type PolicyVerdict =
  | { readonly pass: true }
  | { readonly pass: false; readonly failure: PolicyFailure };

export type Policy<I, S> = (intent: I, snapshot: S) => PolicyVerdict;

export type ParseFailure = { readonly code: "invalid_shape"; readonly detail: string };

export type Proposal<I> = {
  readonly tag: "Proposal";
  readonly intent: I;
  readonly raw: unknown;
};

export type Denied<I> = {
  readonly tag: "Denied";
  readonly intent: I;
  readonly failed: readonly PolicyFailure[];
};

export type Stale<I> = {
  readonly tag: "Stale";
  readonly intent: I;
  readonly reason: string;
  readonly evidenceHash: string;
};

export type Unknown<I> = {
  readonly tag: "Unknown";
  readonly intent: I;
  readonly reason: string;
};

export type Committed<I> = {
  readonly tag: "Committed";
  readonly intent: I;
  readonly evidenceHash: string;
};

export type Executable = {
  readonly tag: "Executable";
  readonly __token: symbol;
};

export type WriteFailure = { readonly code: string; readonly detail?: string };

export type EffectSpec<I, S> = {
  readonly parse: (raw: unknown) => Result<I, ParseFailure>;
  /** Read edge: intent → current world slice (or null if missing). */
  readonly observe: (intent: I) => S | null;
  /** Pure fingerprint of the observed slice (includes versions). */
  readonly hash: (snapshot: S) => string;
  readonly policies: readonly Policy<I, S>[];
  /**
   * Write edge: must be CAS/conditional on versions carried in `snapshot`.
   * Captured privately by createEffect — never returned on the handle.
   */
  readonly write: (intent: I, snapshot: S) => Result<void, WriteFailure>;
  readonly clock?: () => string;
};

type SealedBody<I> = {
  readonly intent: I;
  readonly evidenceHash: string;
  spent: boolean;
};

const vault = new Map<symbol, SealedBody<unknown>>();

function seal<I>(intent: I, evidenceHash: string): Executable {
  const token = Symbol("rupu.executable");
  vault.set(token, { intent, evidenceHash, spent: false });
  return Object.freeze({ tag: "Executable", __token: token });
}

function consume<I>(executable: Executable): Result<SealedBody<I>, string> {
  const body = vault.get(executable.__token);
  if (!body) return err("forged_or_unknown_executable");
  if (body.spent) return err("executable_already_spent");
  body.spent = true;
  vault.delete(executable.__token);
  return ok(body as SealedBody<I>);
}

export function liveExecutableCount(): number {
  return vault.size;
}

export function resetVault(): void {
  vault.clear();
}

export type CommitFailure<I> =
  | Stale<I>
  | Unknown<I>
  | { readonly tag: "Spent"; readonly reason: string }
  | { readonly tag: "Write"; readonly error: WriteFailure };

export type EffectHandle<I, S> = {
  readonly propose: (raw: unknown) => Result<Proposal<I>, ParseFailure>;
  readonly prepare: (
    proposal: Proposal<I>,
    clock?: () => string,
  ) => Result<Executable, Denied<I> | Unknown<I>>;
  readonly commit: (executable: Executable) => Result<Committed<I>, CommitFailure<I>>;
  readonly evaluate: (
    proposal: Proposal<I>,
    snapshot: S,
    observedAt: string,
  ) => Result<Executable, Denied<I>>;
};

export const EFFECT_HANDLE_KEYS = Object.freeze([
  "propose",
  "prepare",
  "commit",
  "evaluate",
] as const);

/**
 * Build an application-facing effect API.
 * The write function is closed over and never placed on the returned object.
 */
export function createEffect<I, S>(spec: EffectSpec<I, S>): EffectHandle<I, S> {
  const write = spec.write;
  const policies = spec.policies;
  const clockDefault = spec.clock ?? (() => new Date().toISOString());

  const propose = (raw: unknown): Result<Proposal<I>, ParseFailure> => {
    const parsed = spec.parse(raw);
    if (!parsed.ok) return parsed;
    return ok(
      Object.freeze({
        tag: "Proposal",
        intent: parsed.value,
        raw,
      }) as Proposal<I>,
    );
  };

  const evaluate = (
    proposal: Proposal<I>,
    snapshot: S,
    _observedAt: string,
  ): Result<Executable, Denied<I>> => {
    const failed: PolicyFailure[] = [];
    for (const policy of policies) {
      const v = policy(proposal.intent, snapshot);
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
    return ok(seal(proposal.intent, spec.hash(snapshot)));
  };

  const prepare = (
    proposal: Proposal<I>,
    clock: () => string = clockDefault,
  ): Result<Executable, Denied<I> | Unknown<I>> => {
    let snapshot: S | null;
    try {
      snapshot = spec.observe(proposal.intent);
    } catch (e) {
      return err({
        tag: "Unknown",
        intent: proposal.intent,
        reason: e instanceof Error ? e.message : "observe_failed",
      });
    }
    if (snapshot === null) {
      return err({
        tag: "Unknown",
        intent: proposal.intent,
        reason: "snapshot_missing",
      });
    }
    return evaluate(proposal, snapshot, clock());
  };

  const commit = (
    executable: Executable,
  ): Result<Committed<I>, CommitFailure<I>> => {
    const sealed = consume<I>(executable);
    if (!sealed.ok) {
      return err({ tag: "Spent", reason: sealed.error });
    }
    const { intent, evidenceHash } = sealed.value;

    let snapshot: S | null;
    try {
      snapshot = spec.observe(intent);
    } catch (e) {
      return err({
        tag: "Unknown",
        intent,
        reason: e instanceof Error ? e.message : "observe_failed",
      });
    }
    if (snapshot === null) {
      return err({
        tag: "Unknown",
        intent,
        reason: "snapshot_missing_at_commit",
      });
    }

    const currentHash = spec.hash(snapshot);
    if (currentHash !== evidenceHash) {
      return err({
        tag: "Stale",
        intent,
        reason: "world_changed_since_evidence",
        evidenceHash,
      });
    }

    let written: Result<void, WriteFailure>;
    try {
      written = write(intent, snapshot);
    } catch (e) {
      return err({
        tag: "Unknown",
        intent,
        reason: e instanceof Error ? `adapter:${e.message}` : "adapter_threw",
      });
    }

    if (!written.ok) {
      if (written.error.code === "version_conflict") {
        return err({
          tag: "Stale",
          intent,
          reason: "cas_version_conflict",
          evidenceHash,
        });
      }
      return err({ tag: "Write", error: written.error });
    }

    return ok(
      Object.freeze({
        tag: "Committed",
        intent,
        evidenceHash,
      }),
    );
  };

  return Object.freeze({
    propose,
    prepare,
    commit,
    evaluate,
  });
}
