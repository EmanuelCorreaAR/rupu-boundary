import { describe, expect, it, beforeEach } from "vitest";
import {
  openBank,
  createTransferEffect,
  openPayments,
  createRefundEffect,
  openWarehouse,
  createReserveEffect,
  resetVault,
  EFFECT_HANDLE_KEYS,
} from "../src/index.js";

describe("generality kill-test — same lifecycle, three domains", () => {
  beforeEach(() => resetVault());

  it("transfer: propose → prepare → commit", () => {
    const bank = openBank();
    bank.seed("alice", 100);
    bank.seed("bob", 0);
    const transfer = createTransferEffect({
      read: bank.read,
      write: bank.takeWritePort(),
    });

    expect(Object.keys(transfer).sort()).toEqual([...EFFECT_HANDLE_KEYS].sort());

    const p = transfer.propose({ from: "alice", to: "bob", amount: 40 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const d = transfer.prepare(p.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(transfer.commit(d.value).ok).toBe(true);
    expect(bank.read.observe("alice")?.balance).toBe(60);
  });

  it("refund: propose → prepare → commit (no lifecycle exceptions)", () => {
    const payments = openPayments();
    payments.seed("pay_1", 50, "CAPTURED");
    const refund = createRefundEffect(payments);

    expect(Object.keys(refund).sort()).toEqual([...EFFECT_HANDLE_KEYS].sort());

    const p = refund.propose({ paymentId: "pay_1", amount: 50 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const d = refund.prepare(p.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(refund.commit(d.value).ok).toBe(true);
    expect(payments.observe("pay_1")?.status).toBe("REFUNDED");
  });

  it("inventory reserve: propose → prepare → commit", () => {
    const wh = openWarehouse();
    wh.seed("sku-tea", 10);
    const reserve = createReserveEffect(wh);

    expect(Object.keys(reserve).sort()).toEqual([...EFFECT_HANDLE_KEYS].sort());

    const p = reserve.propose({ sku: "sku-tea", qty: 3 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const d = reserve.prepare(p.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(reserve.commit(d.value).ok).toBe(true);
    expect(wh.observe("sku-tea")?.available).toBe(7);
  });

  it("refund stale after external refund → Stale (same ADT)", () => {
    const payments = openPayments();
    payments.seed("pay_2", 20, "CAPTURED");
    const refund = createRefundEffect(payments);

    const p = refund.propose({ paymentId: "pay_2", amount: 20 });
    if (!p.ok) return;
    const d = refund.prepare(p.value);
    if (!d.ok) return;

    payments.externalRefund({ paymentId: "pay_2", amount: 20 }, 1);

    const result = refund.commit(d.value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Stale");
  });

  it("inventory stale after external reserve → Stale", () => {
    const wh = openWarehouse();
    wh.seed("sku-mug", 5);
    const reserve = createReserveEffect(wh);

    const p = reserve.propose({ sku: "sku-mug", qty: 2 });
    if (!p.ok) return;
    const d = reserve.prepare(p.value);
    if (!d.ok) return;

    wh.externalReserve({ sku: "sku-mug", qty: 1 }, 1);

    const result = reserve.commit(d.value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Stale");
  });

  it("refund already REFUNDED is Denied at prepare (policy), not a new verb", () => {
    const payments = openPayments();
    payments.seed("pay_3", 10, "REFUNDED");
    const refund = createRefundEffect(payments);

    const p = refund.propose({ paymentId: "pay_3", amount: 10 });
    if (!p.ok) return;
    const d = refund.prepare(p.value);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error.tag).toBe("Denied");
  });
});
