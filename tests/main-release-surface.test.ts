/**
 * releaseExecutable must be importable from the production entrypoint.
 * /testing must NOT be required for abandoned-prepare cleanup.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createBoundary, releaseExecutable } from "../src/index.js";
import { resetVault, liveExecutableCount } from "../src/testing.js";
import { ok } from "../src/result.js";

describe("releaseExecutable on main surface", () => {
  beforeEach(() => resetVault());

  it("import from rupu-boundary (index), not testing", async () => {
    const boundary = createBoundary({
      parse: (raw: unknown) => ok(Object.freeze(raw as { id: string })),
      spec: {
        observe: () =>
          ok(
            Object.freeze({
              state: Object.freeze({ id: "a" }),
              witness: Object.freeze({ v: 1 }),
            }),
          ),
        check: () => ok(undefined),
        write: () => ok(undefined),
      },
    });
    const p = boundary.propose({ id: "a" });
    if (!p.ok) throw new Error("propose");
    const prep = await boundary.prepare(p.value);
    if (!prep.ok) throw new Error("prepare");
    expect(liveExecutableCount()).toBe(1);
    releaseExecutable(prep.value);
    expect(liveExecutableCount()).toBe(0);
  });
});
