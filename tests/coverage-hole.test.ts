/**
 * Coverage kill-test — false-fresh under incomplete witness.
 *
 * Declared README limit: Coverage is an adapter obligation.
 * This file proves the limit is real: relevant state changes, W unchanged,
 * commit still Committed.
 *
 *   check uses: status, amount, currency
 *   W covers:   statusAmountVersion only (currency invisible)
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  openHoleWorld,
  createHoleyRefundBoundary,
  type HoleWorld,
  type HoleBoundary,
} from "../src/fixtures/coverage-hole.js";
import { resetVault } from "../src/testing.js";

describe("coverage hole — false-fresh kill-test", () => {
  let world: HoleWorld;
  let refund: HoleBoundary;

  beforeEach(() => {
    resetVault();
    world = openHoleWorld();
    world.seed("pay_1", 50, "ARS");
    refund = createHoleyRefundBoundary(world);
  });

  it("CONTROL: covered field change (statusAmountVersion) → Stale, NO write", () => {
    const p = refund.propose({ paymentId: "pay_1", amount: 50 });
    if (!p.ok) throw new Error("propose");
    const prep = refund.prepare(p.value);
    if (!prep.ok) throw new Error("prepare");

    world.bumpStatusAmountVersion("pay_1");

    const result = refund.commit(prep.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.tag).toBe("Stale");
    expect(world.writeAttempts()).toBe(0);
  });

  it("KILL: currency ARS → USD between prepare and commit → Committed (false-fresh)", () => {
    const p = refund.propose({ paymentId: "pay_1", amount: 50 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;

    const prep = refund.prepare(p.value);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    // Decision premise invalid now — but W is unchanged.
    world.setCurrency("pay_1", "USD");
    expect(world.observe("pay_1")?.currency).toBe("USD");
    expect(world.observe("pay_1")?.statusAmountVersion).toBe(1);

    const result = refund.commit(prep.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tag).toBe("Committed");
    expect(world.successfulRefunds()).toBe(1);
    expect(world.writeAttempts()).toBe(1);
  });

  it("CONTROL: prepare after currency flip → Denied (check still sees currency)", () => {
    world.setCurrency("pay_1", "USD");
    const p = refund.propose({ paymentId: "pay_1", amount: 50 });
    if (!p.ok) return;
    const prep = refund.prepare(p.value);
    expect(prep.ok).toBe(false);
    if (prep.ok) return;
    expect(prep.error.tag).toBe("Denied");
    expect(world.writeAttempts()).toBe(0);
  });
});
