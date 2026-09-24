/**
 * Hostile consumer battery — README guarantees, attacked from outside.
 *
 * Adapter: minimal refund (fixtures/refund). Composition root seals write;
 * this file only holds BoundaryHandle + Executable.
 *
 *   1 prepare → commit              → write once
 *   2 prepare → external change → commit → Stale, NO write
 *   3 commit twice                  → second Spent
 *   4 check rejects                 → Denied, no authority
 *   5 observe fails                 → Unknown, NO write
 *   + API misuse                    → forge / leak I·W / skip prepare
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  openPayments,
  createRefundBoundary,
  type PaymentsWorld,
  type RefundBoundary,
} from "../src/fixtures/refund.js";
import { resetVault } from "../src/testing.js";
import type { Executable } from "../src/index.js";
import { BOUNDARY_HANDLE_KEYS } from "../src/index.js";

describe("hostile consumer — refund adapter", () => {
  let world: PaymentsWorld;
  let refund: RefundBoundary;

  beforeEach(() => {
    resetVault();
    world = openPayments();
    world.seed("pay_1", 50, "CAPTURED");
    refund = createRefundBoundary(world);
  });

  async function prepareOk(raw = { paymentId: "pay_1", amount: 50 }): Promise<Executable> {
    const p = refund.propose(raw);
    if (!p.ok) throw new Error("propose");
    const d = await refund.prepare(p.value);
    if (!d.ok) throw new Error(`prepare: ${d.error.tag}`);
    return d.value;
  }

  it("1. prepare → commit: write occurs exactly once", async () => {
    const exec = await prepareOk();
    const result = await refund.commit(exec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tag).toBe("Committed");
    expect(world.successfulRefunds()).toBe(1);
    expect(world.writeAttempts()).toBe(1);
    expect(world.observe("pay_1")?.status).toBe("REFUNDED");
  });

  it("2. prepare → external change → commit: Stale and NO write (raison d'être)", async () => {
    const exec = await prepareOk();

    // World moves under the sealed witness (external actor, not the app).
    const external = world.externalRefund(
      { paymentId: "pay_1", amount: 50 },
      1,
    );
    expect(external.ok).toBe(true);
    expect(world.successfulRefunds()).toBe(1);
    const attemptsBefore = world.writeAttempts();

    const result = await refund.commit(exec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Stale");
    // Boundary must not call write after witness mismatch.
    expect(world.writeAttempts()).toBe(attemptsBefore);
  });

  it("3. commit(executable) twice: second is Spent", async () => {
    const exec = await prepareOk();
    expect((await refund.commit(exec)).ok).toBe(true);
    const again = await refund.commit(exec);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.tag).toBe("Spent");
    expect(world.successfulRefunds()).toBe(1);
    expect(world.writeAttempts()).toBe(1);
  });

  it("4. check rejects: Denied — no write authority is minted", async () => {
    world.seed("pay_denied", 10, "REFUNDED");
    const p = refund.propose({ paymentId: "pay_denied", amount: 10 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const d = await refund.prepare(p.value);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error.tag).toBe("Denied");
    expect(world.writeAttempts()).toBe(0);
  });

  it("5. observe fails: Unknown — NO write", async () => {
    const p = refund.propose({ paymentId: "missing", amount: 1 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const d = await refund.prepare(p.value);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error.tag).toBe("Unknown");
    expect(world.writeAttempts()).toBe(0);
  });

  describe("API misuse", () => {
    it("Executable exposes no I / W fields", async () => {
      const exec = await prepareOk();
      expect(Object.keys(exec).sort()).toEqual(["__token", "tag"].sort());
      expect(exec).not.toHaveProperty("intent");
      expect(exec).not.toHaveProperty("witness");
      expect(exec).not.toHaveProperty("state");
    });

    it("forged Executable cannot commit", async () => {
      const forged = {
        tag: "Executable",
        __token: Symbol("forged"),
      } as Executable;
      const result = await refund.commit(forged);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.tag).toBe("Spent");
      expect(world.writeAttempts()).toBe(0);
    });

    it("JSON round-trip cannot reconstruct a live capability", async () => {
      const exec = await prepareOk();
      const parsed = JSON.parse(JSON.stringify(exec)) as Executable;
      expect(parsed.__token).toBeUndefined();
      expect((await refund.commit(parsed)).ok).toBe(false);
      expect(world.writeAttempts()).toBe(0);
      expect((await refund.commit(exec)).ok).toBe(true);
    });

    it("BoundaryHandle has no write / refundOnce / evaluate", async () => {
      expect(Object.keys(refund).sort()).toEqual([...BOUNDARY_HANDLE_KEYS].sort());
      expect(refund).not.toHaveProperty("write");
      expect(refund).not.toHaveProperty("evaluate");
      expect(refund).not.toHaveProperty("refundOnce");
      // Second take must fail — port already sealed into the boundary.
      expect(() => world.takeWritePort()).toThrow(/write_port_already_taken/);
    });
  });
});
