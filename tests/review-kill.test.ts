/**
 * Review kill-tests A/B — witnessEq + consume-before-observe semantics.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createBoundary, witnessEq, type Proposal } from "../src/index.js";
import { resetVault, liveExecutableCount } from "../src/testing.js";
import { err, ok } from "../src/result.js";

describe("A — witnessEq", () => {
  it("same logical witness, different key order → equal", async () => {
    expect(witnessEq({ version: 1, shard: "A" }, { shard: "A", version: 1 })).toBe(
      true,
    );
  });

  it("does not collapse undefined-property with missing key (unlike JSON.stringify)", async () => {
    expect(witnessEq({ x: undefined }, {})).toBe(false);
  });

  it("does not treat NaN as null (unlike JSON.stringify)", async () => {
    expect(witnessEq({ x: NaN }, { x: null })).toBe(false);
    expect(witnessEq({ x: NaN }, { x: NaN })).toBe(true);
  });

  it("rejects non-plain object witnesses (use compareWitness)", () => {
    expect(() => witnessEq(new Date(), new Date())).toThrow(/compareWitness/);
  });
});

describe("B — observe failure on commit does not spend authority", () => {
  beforeEach(() => resetVault());

  it("transient observe fail → Unknown → retry can still commit", async () => {
    let observes = 0;
    let writes = 0;
    const world = { version: 1, status: "CAPTURED" as const };

    const boundary = createBoundary({
      parse: (raw: unknown) => {
        const o = raw as { id: string };
        return ok(Object.freeze({ id: o.id }));
      },
      spec: {
        observe: (intent) => {
          observes += 1;
          if (observes === 2) {
            // First commit's re-observe fails transiently.
            return err({ code: "timeout" });
          }
          return ok(
            Object.freeze({
              state: Object.freeze({ ...world, id: intent.id }),
              witness: Object.freeze({ version: world.version }),
            }),
          );
        },
        check: () => ok(undefined),
        write: () => {
          writes += 1;
          return ok(undefined);
        },
      },
    });

    const proposal = boundary.propose({ id: "x" });
    if (!proposal.ok) throw new Error("propose");
    const prep = await boundary.prepare(proposal.value);
    if (!prep.ok) throw new Error("prepare");
    expect(liveExecutableCount()).toBe(1);

    const first = await boundary.commit(prep.value);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.tag).toBe("Unknown");
    }
    expect(writes).toBe(0);
    expect(liveExecutableCount()).toBe(1); // still live

    const second = await boundary.commit(prep.value);
    expect(second.ok).toBe(true);
    expect(writes).toBe(1);
    expect(liveExecutableCount()).toBe(0);
  });

  it("Stale still spends the Executable", async () => {
    let version = 1;
    const boundary = createBoundary({
      parse: (raw: unknown) => ok(Object.freeze(raw as { id: string })),
      spec: {
        observe: (intent) =>
          ok(
            Object.freeze({
              state: Object.freeze({ id: intent.id }),
              witness: Object.freeze({ version }),
            }),
          ),
        check: () => ok(undefined),
        write: () => ok(undefined),
      },
    });

    const proposal = boundary.propose({ id: "x" });
    if (!proposal.ok) throw new Error("propose");
    const prep = await boundary.prepare(proposal.value);
    if (!prep.ok) throw new Error("prepare");

    version = 2;
    const stale = await boundary.commit(prep.value);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.tag).toBe("Stale");
    expect(liveExecutableCount()).toBe(0);

    const again = await boundary.commit(prep.value);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.tag).toBe("Spent");
  });
});

describe("Proposal is DX — forgeable, parse is not an integrity frontier", () => {
  beforeEach(() => resetVault());

  it("forged Proposal skips parse and can still prepare", async () => {
    let parsed = 0;
    const boundary = createBoundary({
      parse: () => {
        parsed += 1;
        return err({ code: "invalid_shape", detail: "should not run" });
      },
      spec: {
        observe: () =>
          ok(
            Object.freeze({
              state: Object.freeze({ ok: true }),
              witness: Object.freeze({ v: 1 }),
            }),
          ),
        check: () => ok(undefined),
        write: () => ok(undefined),
      },
    });

    const forged = {
      tag: "Proposal",
      intent: Object.freeze({ id: "forged" }),
      raw: null,
    } as Proposal<{ id: string }>;

    const prep = await boundary.prepare(forged);
    expect(parsed).toBe(0);
    expect(prep.ok).toBe(true);
  });
});
