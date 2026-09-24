/**
 * Abandoned prepare — vault memory ownership.
 * releaseExecutable drops sealed authority without commit.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  createBoundary,
  releaseExecutable,
  type Executable,
} from "../src/index.js";
import { resetVault, liveExecutableCount } from "../src/testing.js";
import { ok } from "../src/result.js";

describe("releaseExecutable — abandoned prepare", () => {
  beforeEach(() => resetVault());

  async function prepareMany(n: number): Promise<Executable[]> {
    const boundary = createBoundary({
      parse: (raw: unknown) => ok(Object.freeze(raw as { id: string })),
      spec: {
        observe: (intent) =>
          ok(
            Object.freeze({
              state: Object.freeze({ id: intent.id }),
              witness: Object.freeze({ v: 1 }),
            }),
          ),
        check: () => ok(undefined),
        write: () => ok(undefined),
      },
    });
    const out: Executable[] = [];
    for (let i = 0; i < n; i++) {
      const p = boundary.propose({ id: `x${i}` });
      if (!p.ok) throw new Error("propose");
      const prep = await boundary.prepare(p.value);
      if (!prep.ok) throw new Error("prepare");
      out.push(prep.value);
    }
    return out;
  }

  it("prepare without commit grows the vault; release shrinks it", async () => {
    const execs = await prepareMany(1000);
    expect(liveExecutableCount()).toBe(1000);
    for (const e of execs) releaseExecutable(e);
    expect(liveExecutableCount()).toBe(0);
  });

  it("release is idempotent; commit after release → Spent", async () => {
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
    releaseExecutable(prep.value);
    releaseExecutable(prep.value);
    const result = await boundary.commit(prep.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.tag).toBe("Spent");
  });

  it("stress: 50_000 abandoned prepares then release all", async () => {
    const execs = await prepareMany(50_000);
    expect(liveExecutableCount()).toBe(50_000);
    for (const e of execs) releaseExecutable(e);
    expect(liveExecutableCount()).toBe(0);
  }, 30_000);
});
