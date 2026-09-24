/**
 * rupu-boundary — public API (v0.4 stable)
 *
 * BoundarySpec<I,S,W> + propose → prepare → commit
 * Fixtures stay out of the package surface.
 * Adapters: `rupu-boundary/etag` | `/dynamodb` | `/sql`
 */

export { ok, err, matchResult, type Result, type Ok, type Err } from "./result.js";

export {
  createBoundary,
  all,
  witnessEq,
  releaseExecutable,
  BOUNDARY_HANDLE_KEYS,
  type BoundaryHandle,
  type BoundarySpec,
  type Observation,
  type Executable,
  type Proposal,
  type Denied,
  type DeniedReasons,
  type PolicyFailure,
  type Stale,
  type Unknown,
  type Committed,
  type CommitFailure,
  type ParseFailure,
  type WriteFailure,
  type WriteError,
  type WitnessCompare,
  type ObserveError,
} from "./runtime.js";
