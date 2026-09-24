import { describe, expect, it } from "vitest";
import type { TransferState, TransferWitness } from "../src/effect.js";
import type { PaymentState, RefundWitness } from "../src/fixtures/refund.js";
import type { StockState, ReserveWitness } from "../src/fixtures/inventory.js";

/**
 * Semantic minimality locks — not behavioral tests.
 *
 * Reduction rule (ALGEBRA.md):
 * A type parameter is not eliminated when its information or
 * responsibility is merely absorbed by another parameter.
 *
 * Kill 1 (no S): FAIL if W must carry decide-fields (balance/status/stock).
 * Kill 2 (no W): FAIL if S must carry execute-fields (version) only for write.
 */

type KeysOf<T> = keyof T & string;

function assertNoKeys<T extends object>(
  sample: T,
  forbidden: readonly string[],
  label: string,
): void {
  for (const key of forbidden) {
    expect(key in sample, `${label} must not carry decide/execute leak: ${key}`).toBe(
      false,
    );
  }
}

describe("algebra minimality — S ≠ W (Kill 1 & 2 locks)", () => {
  it("Kill 1 lock: TransferWitness has no decide-fields (not W := S×W)", async () => {
    const w: TransferWitness = { fromVersion: 1 };
    assertNoKeys(w, ["fromBalance", "balance", "fromActive", "toActive", "from", "to"], "TransferWitness");
    expect(Object.keys(w)).toEqual(["fromVersion"]);
  });

  it("Kill 1 lock: RefundWitness / ReserveWitness are version-only", async () => {
    const rw: RefundWitness = { version: 1 };
    const sw: ReserveWitness = { version: 1 };
    assertNoKeys(rw, ["status", "amount", "id"], "RefundWitness");
    assertNoKeys(sw, ["available", "sku", "qty"], "ReserveWitness");
  });

  it("Kill 2 lock: decide-state types are not required to expose version to check", async () => {
    // Document the split: version lives on snapshots for hashing/CAS provenance,
    // but W is the only token passed to write. If someone "eliminates W" by
    // stuffing version into the decide surface alone, these witnesses would
    // vanish — this test requires W types to remain version carriers.
    const transferW: KeysOf<TransferWitness> = "fromVersion";
    const refundW: KeysOf<RefundWitness> = "version";
    const reserveW: KeysOf<ReserveWitness> = "version";
    expect(transferW).toBe("fromVersion");
    expect(refundW).toBe("version");
    expect(reserveW).toBe("version");
  });

  it("S carries decide knowledge; W is not a full state clone", async () => {
    const state: TransferState = {
      from: { id: "a", balance: 100, active: true, version: 1 },
      to: { id: "b", balance: 0, active: true, version: 1 },
    };
    const witness: TransferWitness = { fromVersion: state.from.version };

    expect(state.from.balance).toBe(100);
    expect("balance" in witness).toBe(false);
    expect(witness.fromVersion).toBe(1);
  });

  it("Refund/Reserve: status|available live in S, not in W", async () => {
    const payment: PaymentState = {
      id: "p",
      status: "CAPTURED",
      amount: 10,
      version: 3,
    };
    const stock: StockState = { sku: "x", available: 5, version: 2 };
    const rw: RefundWitness = { version: payment.version };
    const sw: ReserveWitness = { version: stock.version };

    expect(payment.status).toBe("CAPTURED");
    expect(stock.available).toBe(5);
    expect("status" in rw).toBe(false);
    expect("available" in sw).toBe(false);
  });
});
