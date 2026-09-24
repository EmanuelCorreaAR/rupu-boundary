/**
 * Test / harness only — not part of the app-facing package surface.
 * Enables evaluate (caller-controlled Observation); weakens provenance.
 */
export {
  createBoundaryForTests,
  resetVault,
  liveExecutableCount,
  type BoundaryTestHandle,
} from "./runtime.js";
