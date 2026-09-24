/**
 * Algebra D — minimal BoundarySpec:
 *
 *   observe(I) → Observation<S, W>
 *   check(I, S) → Result<void, DeniedReasons>
 *   write(I, W) → Result<void, WriteFailure>
 *
 * S = what you need to decide
 * W = what you need to prove at conditional write
 *
 * Freshness + sealed Executable live in the runtime, not in BoundarySpec.
 * parse stays as DX for propose(), outside the algebra.
 */

import { err, ok, type Result } from "./result.js";

export type PolicyFailure = {
  readonly policy: string;
  readonly condition: string;
  readonly actual: string;
};

export type DeniedReasons = readonly PolicyFailure[];

export type ParseFailure = { readonly code: "invalid_shape"; readonly detail: string };

export type Proposal<I> = {
  readonly tag: "Proposal";
  readonly intent: I;
  readonly raw: unknown;
};

export type Denied<I> = {
  readonly tag: "Denied";
  readonly intent: I;
  readonly failed: DeniedReasons;
};

export type Stale<I> = {
  readonly tag: "Stale";
  readonly intent: I;
  readonly reason: string;
};

export type Unknown<I> = {
  readonly tag: "Unknown";
  readonly intent: I;
  readonly reason: string;
};

export type Committed<I> = {
  readonly tag: "Committed";
  readonly intent: I;
};

export type Executable = {
  readonly tag: "Executable";
  readonly __token: symbol;
};

export type WriteFailure = { readonly code: string; readonly detail?: string };

export type ObserveError = { readonly code: string; readonly detail?: string };

/** S = decide; W = execute (CAS / conditional token). */
export type Observation<S, W> = {
  readonly state: S;
  readonly witness: W;
};

/**
 * Public algebra — no schema, no policies[], no hash helper.
 */
export type BoundarySpec<I, S, W> = {
  readonly observe: (
    input: I,
  ) => Result<Observation<S, W>, ObserveError>;
  readonly check: (input: I, state: S) => Result<void, DeniedReasons>;
  /** Conditional write against W only — never against full S. */
  readonly write: (input: I, witness: W) => Result<void, WriteFailure>;
};

type SealedBody<I, W> = {
  readonly intent: I;
  readonly witness: W;
  spent: boolean;
};

const vault = new Map<symbol, SealedBody<unknown, unknown>>();

function seal<I, W>(intent: I, witness: W): Executable {
  const token = Symbol("rupu.executable");
  vault.set(token, { intent, witness, spent: false });
  return Object.freeze({ tag: "Executable", __token: token });
}

function consume<I, W>(
  executable: Executable,
): Result<SealedBody<I, W>, string> {
  const body = vault.get(executable.__token);
  if (!body) return err("forged_or_unknown_executable");
  if (body.spent) return err("executable_already_spent");
  body.spent = true;
  vault.delete(executable.__token);
  return ok(body as SealedBody<I, W>);
}

export function liveExecutableCount(): number {
  return vault.size;
}

export function resetVault(): void {
  vault.clear();
}

/** Structural equality for frozen witnesses (versions, etags, …). */
export function witnessEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compose pure checks outside the algebra (not part of BoundarySpec).
 */
export function all<I, S>(
  ...checks: ReadonlyArray<(input: I, state: S) => Result<void, DeniedReasons>>
): (input: I, state: S) => Result<void, DeniedReasons> {
  return (input, state) => {
    const failed: PolicyFailure[] = [];
    for (const c of checks) {
      const r = c(input, state);
      if (!r.ok) failed.push(...r.error);
    }
    if (failed.length > 0) return err(Object.freeze(failed) as DeniedReasons);
    return ok(undefined);
  };
}

export type CommitFailure<I> =
  | Stale<I>
  | Unknown<I>
  | { readonly tag: "Spent"; readonly reason: string }
  | { readonly tag: "Write"; readonly error: WriteFailure };

/**
 * Public app-facing surface. Provenance claim under T1:
 * Executable originates only from prepare → observe → check → seal.
 * `evaluate` is NOT here — caller-controlled Observation would mean
 * Rupu-issued ≠ Rupu-observed.
 */
export type BoundaryHandle<I, S, W = unknown> = {
  readonly propose: (raw: unknown) => Result<Proposal<I>, ParseFailure>;
  readonly prepare: (
    proposal: Proposal<I>,
  ) => Result<Executable, Denied<I> | Unknown<I>>;
  readonly commit: (executable: Executable) => Result<Committed<I>, CommitFailure<I>>;
};

/** Test / harness only — mint from a caller-supplied Observation. */
export type BoundaryTestHandle<I, S, W = unknown> = BoundaryHandle<I, S, W> & {
  readonly evaluate: (
    proposal: Proposal<I>,
    observation: Observation<S, W>,
  ) => Result<Executable, Denied<I>>;
};

export const BOUNDARY_HANDLE_KEYS = Object.freeze([
  "propose",
  "prepare",
  "commit",
] as const);

export type CreateBoundaryInput<I, S, W> = {
  /** DX only — not part of the algebra. */
  readonly parse: (raw: unknown) => Result<I, ParseFailure>;
  readonly spec: BoundarySpec<I, S, W>;
};

type BuildOptions = {
  readonly exposeEvaluate?: boolean;
};

function buildBoundary<I, S, W>(
  input: CreateBoundaryInput<I, S, W>,
  options: BuildOptions,
): BoundaryHandle<I, S, W> | BoundaryTestHandle<I, S, W> {
  const { parse, spec } = input;
  const write = spec.write;

  const propose = (raw: unknown): Result<Proposal<I>, ParseFailure> => {
    const parsed = parse(raw);
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
    observation: Observation<S, W>,
  ): Result<Executable, Denied<I>> => {
    const checked = spec.check(proposal.intent, observation.state);
    if (!checked.ok) {
      return err(
        Object.freeze({
          tag: "Denied",
          intent: proposal.intent,
          failed: checked.error,
        }),
      );
    }
    return ok(seal(proposal.intent, observation.witness));
  };

  const prepare = (
    proposal: Proposal<I>,
  ): Result<Executable, Denied<I> | Unknown<I>> => {
    let observed: Result<Observation<S, W>, ObserveError>;
    try {
      observed = spec.observe(proposal.intent);
    } catch (e) {
      return err({
        tag: "Unknown",
        intent: proposal.intent,
        reason: e instanceof Error ? e.message : "observe_failed",
      });
    }
    if (!observed.ok) {
      return err({
        tag: "Unknown",
        intent: proposal.intent,
        reason: observed.error.code,
      });
    }
    return evaluate(proposal, observed.value);
  };

  const commit = (
    executable: Executable,
  ): Result<Committed<I>, CommitFailure<I>> => {
    const sealed = consume<I, W>(executable);
    if (!sealed.ok) {
      return err({ tag: "Spent", reason: sealed.error });
    }
    const { intent, witness } = sealed.value;

    let observed: Result<Observation<S, W>, ObserveError>;
    try {
      observed = spec.observe(intent);
    } catch (e) {
      return err({
        tag: "Unknown",
        intent,
        reason: e instanceof Error ? e.message : "observe_failed",
      });
    }
    if (!observed.ok) {
      return err({
        tag: "Unknown",
        intent,
        reason: observed.error.code,
      });
    }

    if (!witnessEq(witness, observed.value.witness)) {
      return err({
        tag: "Stale",
        intent,
        reason: "world_changed_since_evidence",
      });
    }

    let written: Result<void, WriteFailure>;
    try {
      written = write(intent, witness);
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
        });
      }
      return err({ tag: "Write", error: written.error });
    }

    return ok(Object.freeze({ tag: "Committed", intent }));
  };

  if (options.exposeEvaluate) {
    return Object.freeze({
      propose,
      prepare,
      commit,
      evaluate,
    });
  }

  return Object.freeze({
    propose,
    prepare,
    commit,
  });
}

/**
 * Facade: propose → prepare → commit.
 * Algebra inside: Observe → Decide(S) → Execute(W).
 * BoundarySpec unchanged. No public evaluate (strong provenance under T1).
 */
export function createBoundary<I, S, W>(
  input: CreateBoundaryInput<I, S, W>,
): BoundaryHandle<I, S, W> {
  return buildBoundary(input, { exposeEvaluate: false }) as BoundaryHandle<I, S, W>;
}

/**
 * Test / harness only. Same as createBoundary but exposes `evaluate`
 * (caller-controlled Observation → seal). Do not wire into app Activities.
 */
export function createBoundaryForTests<I, S, W>(
  input: CreateBoundaryInput<I, S, W>,
): BoundaryTestHandle<I, S, W> {
  return buildBoundary(input, {
    exposeEvaluate: true,
  }) as BoundaryTestHandle<I, S, W>;
}
