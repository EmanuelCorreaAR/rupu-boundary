import { describe, expect, it, beforeEach } from "vitest";
import { openBank, createTransferBoundary } from "../src/effect.js";
import { openPayments, createRefundBoundary } from "../src/fixtures/refund.js";
import { openWarehouse, createReserveBoundary } from "../src/fixtures/inventory.js";
import { BOUNDARY_HANDLE_KEYS } from "../src/index.js";
import { resetVault } from "../src/testing.js";

describe("generality kill-test — same lifecycle, three domains", () => {
  beforeEach(() => resetVault());

  it("transfer: propose → prepare → commit", async () => {
    const bank = openBank();
    bank.seed("alice", 100);
    bank.seed("bob", 0);
    const transfer = createTransferBoundary({
      read: bank.read,
      write: bank.takeWritePort(),
    });

    expect(Object.keys(transfer).sort()).toEqual([...BOUNDARY_HANDLE_KEYS].sort());

    const p = transfer.propose({ from: "alice", to: "bob", amount: 40 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const d = await transfer.prepare(p.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect((await transfer.commit(d.value)).ok).toBe(true);
    expect(bank.read.observe("alice")?.balance).toBe(60);
  });

  it("refund: propose → prepare → commit (no lifecycle exceptions)", async () => {
    const payments = openPayments();
    payments.seed("pay_1", 50, "CAPTURED");
    const refund = createRefundBoundary(payments);

    expect(Object.keys(refund).sort()).toEqual([...BOUNDARY_HANDLE_KEYS].sort());

    const p = refund.propose({ paymentId: "pay_1", amount: 50 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const d = await refund.prepare(p.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect((await refund.commit(d.value)).ok).toBe(true);
    expect(payments.observe("pay_1")?.status).toBe("REFUNDED");
  });

  it("inventory reserve: propose → prepare → commit", async () => {
    const wh = openWarehouse();
    wh.seed("sku-tea", 10);
    const reserve = createReserveBoundary(wh);

    expect(Object.keys(reserve).sort()).toEqual([...BOUNDARY_HANDLE_KEYS].sort());

    const p = reserve.propose({ sku: "sku-tea", qty: 3 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const d = await reserve.prepare(p.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect((await reserve.commit(d.value)).ok).toBe(true);
    expect(wh.observe("sku-tea")?.available).toBe(7);
  });

  it("refund stale after external refund → Stale (same ADT)", async () => {
    const payments = openPayments();
    payments.seed("pay_2", 20, "CAPTURED");
    const refund = createRefundBoundary(payments);

    const p = refund.propose({ paymentId: "pay_2", amount: 20 });
    if (!p.ok) return;
    const d = await refund.prepare(p.value);
    if (!d.ok) return;

    payments.externalRefund({ paymentId: "pay_2", amount: 20 }, 1);

    const result = await refund.commit(d.value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Stale");
  });

  it("inventory stale after external reserve → Stale", async () => {
    const wh = openWarehouse();
    wh.seed("sku-mug", 5);
    const reserve = createReserveBoundary(wh);

    const p = reserve.propose({ sku: "sku-mug", qty: 2 });
    if (!p.ok) return;
    const d = await reserve.prepare(p.value);
    if (!d.ok) return;

    wh.externalReserve({ sku: "sku-mug", qty: 1 }, 1);

    const result = await reserve.commit(d.value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Stale");
  });

  it("refund already REFUNDED is Denied at prepare (policy), not a new verb", async () => {
    const payments = openPayments();
    payments.seed("pay_3", 10, "REFUNDED");
    const refund = createRefundBoundary(payments);

    const p = refund.propose({ paymentId: "pay_3", amount: 10 });
    if (!p.ok) return;
    const d = await refund.prepare(p.value);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error.tag).toBe("Denied");
  });
});
