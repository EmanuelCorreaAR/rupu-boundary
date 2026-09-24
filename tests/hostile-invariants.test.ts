/**
 * Hostile invariants — races, totality, coverage ceiling.
 *
 * Documents what Boundary guarantees vs what the write port must enforce.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  createBoundary,
  releaseExecutable,
  type Executable,
} from "../src/index.js";
import { resetVault, liveExecutableCount } from "../src/testing.js";
import { err, ok } from "../src/result.js";
import {
  openHoleWorld,
  createHoleyRefundBoundary,
} from "../src/fixtures/coverage-hole.js";

describe("concurrent commit on the same Executable", () => {
  beforeEach(() => resetVault());

  it("exactly one attempt succeeds; the other is Spent", async () => {
    let writes = 0;
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
        write: async () => {
          writes += 1;
          await new Promise((r) => setTimeout(r, 20));
          return ok(undefined);
        },
      },
    });
    const p = boundary.propose({ id: "a" });
    if (!p.ok) throw new Error("propose");
    const prep = await boundary.prepare(p.value);
    if (!prep.ok) throw new Error("prepare");
    const exec = prep.value;

    const [a, b] = await Promise.all([
      boundary.commit(exec),
      boundary.commit(exec),
    ]);

    const oks = [a, b].filter((r) => r.ok);
    const spent = [a, b].filter((r) => !r.ok && r.error.tag === "Spent");
    expect(oks).toHaveLength(1);
    expect(spent).toHaveLength(1);
    expect(writes).toBe(1);
  });
});

describe("TOCTOU after re-observe — write port is the closer", () => {
  beforeEach(() => resetVault());

  it("mutate after witnessEq but before write returns → Conflict/Stale if CAS holds", async () => {
    let version = 1;
    let race: (() => void) | null = null;
    const boundary = createBoundary({
      parse: (raw: unknown) => ok(Object.freeze(raw as { id: string })),
      spec: {
        observe: () =>
          ok(
            Object.freeze({
              state: Object.freeze({ id: "a", version }),
              witness: Object.freeze({ version }),
            }),
          ),
        check: () => ok(undefined),
        write: (_i, w) => {
          if (race) {
            const fn = race;
            race = null;
            fn();
          }
          if (version !== w.version) {
            return err({ tag: "Conflict" });
          }
          version += 1;
          return ok(undefined);
        },
      },
    });

    const p = boundary.propose({ id: "a" });
    if (!p.ok) throw new Error("propose");
    const prep = await boundary.prepare(p.value);
    if (!prep.ok) throw new Error("prepare");

    // After prepare sealed version=1; bump during write (after commit's compare).
    race = () => {
      version = 99;
    };

    const result = await boundary.commit(prep.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.tag).toBe("Stale");
  });

  it("HONEST LIMIT: if write ignores W, race still Committed", async () => {
    let version = 1;
    let remaining = 100;
    const boundary = createBoundary({
      parse: (raw: unknown) =>
        ok(Object.freeze(raw as { id: string; amount: number })),
      spec: {
        observe: () =>
          ok(
            Object.freeze({
              state: Object.freeze({ remaining, version }),
              witness: Object.freeze({ version }),
            }),
          ),
        check: (intent, state) =>
          state.remaining >= intent.amount
            ? ok(undefined)
            : err(
                Object.freeze([
                  {
                    policy: "funds",
                    condition: "remaining >= amount",
                    actual: String(state.remaining),
                  },
                ]),
              ),
        write: () => {
          // Blind write — no CAS on version.
          remaining = 0;
          return ok(undefined);
        },
      },
    });

    const p = boundary.propose({ id: "a", amount: 80 });
    if (!p.ok) throw new Error("propose");
    const prep = await boundary.prepare(p.value);
    if (!prep.ok) throw new Error("prepare");

    // Mutate premises after prepare; version bump so commit Stales on compare…
    // Wait — if we bump version, witnessEq fails. For honest blind limit we
    // change remaining WITHOUT bumping version (coverage hole + no CAS).
    remaining = 0;

    const result = await boundary.commit(prep.value);
    // version still 1 → compare OK → blind write Committed though funds died.
    expect(result.ok).toBe(true);
    expect(remaining).toBe(0);
  });
});

describe("write throws after spend → Unknown (effect may have run)", () => {
  beforeEach(() => resetVault());

  it("does not reject the Promise; returns Unknown ADT", async () => {
    let applied = false;
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
        write: () => {
          applied = true;
          throw new Error("network_drop_after_apply");
        },
      },
    });
    const p = boundary.propose({ id: "a" });
    if (!p.ok) throw new Error("propose");
    const prep = await boundary.prepare(p.value);
    if (!prep.ok) throw new Error("prepare");

    const result = await boundary.commit(prep.value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.tag).toBe("Unknown");
      if (result.error.tag === "Unknown") {
        expect(result.error.reason).toMatch(/network_drop/);
      }
    }
    expect(applied).toBe(true);
    expect(liveExecutableCount()).toBe(0);
  });
});

describe("compareWitness / witnessEq throw → Unknown, authority kept", () => {
  beforeEach(() => resetVault());

  it("throwing compareWitness does not reject; Executable still live", async () => {
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
        compareWitness: () => {
          throw new Error("opaque_revision_unsupported");
        },
        write: () => ok(undefined),
      },
    });
    const p = boundary.propose({ id: "a" });
    if (!p.ok) throw new Error("propose");
    const prep = await boundary.prepare(p.value);
    if (!prep.ok) throw new Error("prepare");

    const result = await boundary.commit(prep.value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.tag).toBe("Unknown");
      if (result.error.tag === "Unknown") {
        expect(result.error.reason).toMatch(/compare:/);
      }
    }
    expect(liveExecutableCount()).toBe(1);
    releaseExecutable(prep.value);
  });
});

describe("incomplete Coverage — adapter ceiling (documented limit)", () => {
  beforeEach(() => resetVault());

  it("owner/currency-class flip without version bump can still Commit", async () => {
    const world = openHoleWorld();
    world.seed("pay1", 100, "ARS");
    const refund = createHoleyRefundBoundary(world);

    const p = refund.propose({ paymentId: "pay1", amount: 100 });
    if (!p.ok) throw new Error("propose");
    const prep = await refund.prepare(p.value);
    if (!prep.ok) throw new Error("prepare");

    // Currency is a check dependency but not in W — flip without bumping version.
    world.setCurrency("pay1", "USD");

    const result = await refund.commit(prep.value);
    expect(result.ok).toBe(true);
  });
});

describe("releaseExecutable under load", () => {
  beforeEach(() => resetVault());

  it("10_000 prepare + release leaves vault empty", async () => {
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
    const execs: Executable[] = [];
    for (let i = 0; i < 10_000; i++) {
      const p = boundary.propose({ id: `x${i}` });
      if (!p.ok) throw new Error("propose");
      const prep = await boundary.prepare(p.value);
      if (!prep.ok) throw new Error("prepare");
      execs.push(prep.value);
    }
    expect(liveExecutableCount()).toBe(10_000);
    for (const e of execs) releaseExecutable(e);
    expect(liveExecutableCount()).toBe(0);
  }, 20_000);
});
