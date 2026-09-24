/**
 * Test / harness only — not part of the app-facing package surface.
 * Enables evaluate (caller-controlled Observation); weakens provenance.
 *
 * Production memory ownership (`releaseExecutable`) lives on `rupu-boundary` main —
 * not here.
 */
export {
  createBoundaryForTests,
  resetVault,
  liveExecutableCount,
  type BoundaryTestHandle,
} from "./runtime.js";
