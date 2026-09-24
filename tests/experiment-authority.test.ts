/**
 * Decisive kill-test (EXPERIMENT.md) — authority properties under T1.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { openPayments, createRefundBoundary } from "../src/fixtures/refund.js";
import type { RefundBoundary } from "../src/fixtures/refund.js";
import {
  createBoundaryForTests,
  resetVault,
} from "../src/testing.js";
import type { Executable } from "../src/index.js";
import { err, ok } from "../src/result.js";

describe("experiment: authority vs safeRefund-shaped mutations", () => {
  let refund: RefundBoundary;

  beforeEach(() => {
    resetVault();
    const world = openPayments();
    world.seed("pay_1", 50);
    refund = createRefundBoundary(world);
  });

  async function prepareOk(): Promise<Executable> {
    const p = refund.propose({ paymentId: "pay_1", amount: 50 });
    if (!p.ok) throw new Error("propose");
    const d = await refund.prepare(p.value);
    if (!d.ok) throw new Error("prepare");
    return d.value;
  }

  it("provenance: forged Executable cannot commit", async () => {
    const forged = {
      tag: "Executable",
      __token: Symbol("forged"),
    } as Executable;
    expect((await refund.commit(forged)).ok).toBe(false);
  });

  it("consumption: replay after successful commit fails", async () => {
    const exec = await prepareOk();
    expect((await refund.commit(exec)).ok).toBe(true);
    const again = await refund.commit(exec);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.tag).toBe("Spent");
  });

  it("binding: Executable surface has no writable witness/intent fields", async () => {
    const exec = await prepareOk();
    expect(Object.keys(exec).sort()).toEqual(["__token", "tag"].sort());
    expect(exec).not.toHaveProperty("witness");
    expect(exec).not.toHaveProperty("intent");
  });

  it("app handle: propose/prepare/commit only (no evaluate)", async () => {
    expect(refund).not.toHaveProperty("evaluate");
    expect(Object.keys(refund).sort()).toEqual(
      ["commit", "prepare", "propose"].sort(),
    );
  });

  it("ESCAPE (harness only): evaluate mints Rupu-issued ≠ Rupu-observed", async () => {
    const world2 = openPayments();
    world2.seed("pay_1", 50);
    const write = world2.takeWritePort();
    const harness = createBoundaryForTests({
      parse: (raw: unknown) => {
        const o = raw as { paymentId: string; amount: number };
        return ok(Object.freeze({ paymentId: o.paymentId, amount: o.amount }));
      },
      spec: {
        observe: (intent) => {
          const state = world2.observe(intent.paymentId);
          if (!state) return err({ code: "not_found" });
          return ok(
            Object.freeze({
              state,
              witness: Object.freeze({ version: state.version }),
            }),
          );
        },
        check: () => ok(undefined),
        write: (intent, witness) => write.refundOnce(intent, witness.version),
      },
    });

    const p = harness.propose({ paymentId: "pay_1", amount: 50 });
    if (!p.ok) return;
    const minted = harness.evaluate(p.value, {
      state: Object.freeze({
        id: "pay_1",
        status: "CAPTURED" as const,
        amount: 50,
        version: 1,
      }),
      witness: Object.freeze({ version: 999 }),
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    const result = await harness.commit(minted.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.tag).toBe("Stale");
  });
});
