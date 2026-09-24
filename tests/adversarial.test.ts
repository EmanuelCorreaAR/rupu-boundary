import { describe, expect, it, beforeEach } from "vitest";
import { openBank, type OpenBank } from "../src/bank.js";
import {
  createTransferBoundary,
  createTransferBoundaryForTests,
  type Executable,
  type TransferBoundary,
} from "../src/effect.js";
import { resetVault } from "../src/testing.js";

describe("adversarial battery", () => {
  let bank: OpenBank;
  let transfer: TransferBoundary;

  beforeEach(() => {
    resetVault();
    bank = openBank();
    bank.seed("alice", 100);
    bank.seed("bob", 0);
    transfer = createTransferBoundary({
      read: bank.read,
      write: bank.takeWritePort(),
    });
  });

  async function ready(): Promise<Executable> {
    const p = transfer.propose({ from: "alice", to: "bob", amount: 25 });
    if (!p.ok) throw new Error("propose failed");
    const d = await transfer.prepare(p.value);
    if (!d.ok) throw new Error("prepare failed");
    return d.value;
  }

  it("1. bypass: application effect surface has no write / transferCAS", async () => {
    expect("transferCAS" in transfer).toBe(false);
    expect("write" in transfer).toBe(false);
    expect(typeof (transfer as { transferCAS?: unknown }).transferCAS).toBe(
      "undefined",
    );
  });

  it("2. forged Executable (structural twin) cannot commit", async () => {
    const forged = {
      tag: "Executable",
      __token: Symbol("forged"),
    } as Executable;

    const result = await transfer.commit(forged);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Spent");
    expect(bank.stats().successfulTransfers).toBe(0);
  });

  it("3. as any double-asserted garbage cannot commit", async () => {
    const garbage = { tag: "Executable", __token: Symbol("any") } as any as Executable;
    const result = await transfer.commit(garbage);
    expect(result.ok).toBe(false);
    expect(bank.stats().successfulTransfers).toBe(0);
  });

  it("4. mutating proposal data after propose does not affect sealed intent", async () => {
    const raw = { from: "alice", to: "bob", amount: 25 };
    const p = transfer.propose(raw);
    expect(p.ok).toBe(true);
    if (!p.ok) return;

    (raw as { amount: number }).amount = 999;

    const d = await transfer.prepare(p.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;

    const result = await transfer.commit(d.value);
    expect(result.ok).toBe(true);
    expect(bank.read.observe("alice")?.balance).toBe(75);
  });

  it("5. stale state between prepare and commit → Stale, no transfer", async () => {
    const exec = await ready();

    // External actor (not the app) mutates the world.
    bank.externalWrite.transferCAS({
      from: "alice",
      to: "bob",
      amount: 10,
      expectedFromVersion: 1,
    });
    expect(bank.stats().successfulTransfers).toBe(1);

    const result = await transfer.commit(exec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Stale");
    expect(bank.stats().successfulTransfers).toBe(1);
    expect(bank.read.observe("alice")?.balance).toBe(90);
  });

  it("6. replay of same Executable → second commit fails", async () => {
    const exec = await ready();
    const first = await transfer.commit(exec);
    expect(first.ok).toBe(true);

    const second = await transfer.commit(exec);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.tag).toBe("Spent");
    expect(bank.stats().successfulTransfers).toBe(1);
  });

  it("7. TOCTOU: evidence version must match CAS; conflict → Stale", async () => {
    // evaluate is test-harness only (not on app BoundaryHandle).
    const harness = createTransferBoundaryForTests({
      read: bank.read,
      write: bank.externalWrite,
    });
    const p = harness.propose({ from: "alice", to: "bob", amount: 25 });
    if (!p.ok) return;
    const from = bank.read.observe("alice")!;
    const to = bank.read.observe("bob")!;

    const decision = harness.evaluate(p.value, {
      state: Object.freeze({ from, to }),
      witness: Object.freeze({ fromVersion: from.version }),
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    bank.externalWrite.transferCAS({
      from: "alice",
      to: "bob",
      amount: 1,
      expectedFromVersion: from.version,
    });

    const result = await harness.commit(decision.value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Stale");
  });

  it("8. concurrent commits of two executables: at most one wins if racing on same version", async () => {
    const p1 = transfer.propose({ from: "alice", to: "bob", amount: 60 });
    const p2 = transfer.propose({ from: "alice", to: "bob", amount: 60 });
    if (!p1.ok || !p2.ok) return;

    const e1 = await transfer.prepare(p1.value);
    const e2 = await transfer.prepare(p2.value);
    expect(e1.ok && e2.ok).toBe(true);
    if (!e1.ok || !e2.ok) return;

    const results = await Promise.all([
      transfer.commit(e1.value),
      transfer.commit(e2.value),
    ]);

    const wins = results.filter((r) => r.ok).length;
    const losses = results.filter((r) => !r.ok).length;

    expect(wins).toBe(1);
    expect(losses).toBe(1);
    expect(bank.read.observe("alice")?.balance).toBe(40);
    expect(bank.stats().successfulTransfers).toBe(1);
  });

  it("9. adapter exception → Unknown, capability spent, no silent success", async () => {
    const exec = await ready();
    bank.failNextTransfer(new Error("network_timeout"));

    const result = await transfer.commit(exec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Unknown");
    expect(bank.stats().successfulTransfers).toBe(0);

    const retry = await transfer.commit(exec);
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.error.tag).toBe("Spent");
  });

  it("10. denied by policy (insufficient funds) never reaches transferCAS", async () => {
    const p = transfer.propose({ from: "alice", to: "bob", amount: 10_000 });
    if (!p.ok) return;
    const d = await transfer.prepare(p.value);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error.tag).toBe("Denied");
    expect(bank.stats().transferAttempts).toBe(0);
  });

  it("11. cloning executable object still shares token — replay after commit fails", async () => {
    const exec = await ready();
    const clone = { ...exec } as Executable;
    const first = await transfer.commit(exec);
    expect(first.ok).toBe(true);
    const second = await transfer.commit(clone);
    expect(second.ok).toBe(false);
    expect(bank.stats().successfulTransfers).toBe(1);
  });

  it("12. JSON round-trip cannot reconstruct a live capability", async () => {
    const exec = await ready();
    const json = JSON.stringify(exec);
    const parsed = JSON.parse(json) as Executable;
    expect(parsed.__token).toBeUndefined();
    const result = await transfer.commit(parsed);
    expect(result.ok).toBe(false);
    expect(bank.stats().successfulTransfers).toBe(0);
    expect((await transfer.commit(exec)).ok).toBe(true);
  });
});

describe("purity boundaries", () => {
  beforeEach(() => resetVault());

  it("13. evaluate (test harness) is pure w.r.t bank writes", async () => {
    const bank = openBank();
    bank.seed("alice", 50);
    bank.seed("bob", 0);
    const transfer = createTransferBoundaryForTests({
      read: bank.read,
      write: bank.takeWritePort(),
    });
    const p = transfer.propose({ from: "alice", to: "bob", amount: 10 });
    if (!p.ok) return;
    const from = bank.read.observe("alice")!;
    const to = bank.read.observe("bob")!;
    const before = bank.stats().successfulTransfers;

    transfer.evaluate(p.value, {
      state: Object.freeze({ from, to }),
      witness: Object.freeze({ fromVersion: from.version }),
    });

    expect(bank.stats().successfulTransfers).toBe(before);
    expect(bank.stats().transferAttempts).toBe(0);
  });

  it("14. propose freezes intent (Object.isFrozen)", async () => {
    const bank = openBank();
    const transfer = createTransferBoundary({
      read: bank.read,
      write: bank.takeWritePort(),
    });
    const p = transfer.propose({ from: "alice", to: "bob", amount: 1 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(Object.isFrozen(p.value.intent)).toBe(true);
    expect(Object.isFrozen(p.value)).toBe(true);
  });
});
