import { describe, expect, it, beforeEach } from "vitest";
import { openBank, type OpenBank } from "../src/bank.js";
import {
  createTransferEffect,
  resetVault,
  type Executable,
  type TransferEffect,
} from "../src/effect.js";

describe("adversarial battery", () => {
  let bank: OpenBank;
  let transfer: TransferEffect;

  beforeEach(() => {
    resetVault();
    bank = openBank();
    bank.seed("alice", 100);
    bank.seed("bob", 0);
    transfer = createTransferEffect({
      read: bank.read,
      write: bank.takeWritePort(),
    });
  });

  function ready(): Executable {
    const p = transfer.propose({ from: "alice", to: "bob", amount: 25 });
    if (!p.ok) throw new Error("propose failed");
    const d = transfer.prepare(p.value);
    if (!d.ok) throw new Error("prepare failed");
    return d.value;
  }

  it("1. bypass: application effect surface has no write / transferCAS", () => {
    expect("transferCAS" in transfer).toBe(false);
    expect("write" in transfer).toBe(false);
    expect(typeof (transfer as { transferCAS?: unknown }).transferCAS).toBe(
      "undefined",
    );
  });

  it("2. forged Executable (structural twin) cannot commit", () => {
    const forged = {
      tag: "Executable",
      __token: Symbol("forged"),
    } as Executable;

    const result = transfer.commit(forged);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Spent");
    expect(bank.stats().successfulTransfers).toBe(0);
  });

  it("3. as any double-asserted garbage cannot commit", () => {
    const garbage = { tag: "Executable", __token: Symbol("any") } as any as Executable;
    const result = transfer.commit(garbage);
    expect(result.ok).toBe(false);
    expect(bank.stats().successfulTransfers).toBe(0);
  });

  it("4. mutating proposal data after propose does not affect sealed intent", () => {
    const raw = { from: "alice", to: "bob", amount: 25 };
    const p = transfer.propose(raw);
    expect(p.ok).toBe(true);
    if (!p.ok) return;

    (raw as { amount: number }).amount = 999;

    const d = transfer.prepare(p.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;

    const result = transfer.commit(d.value);
    expect(result.ok).toBe(true);
    expect(bank.read.observe("alice")?.balance).toBe(75);
  });

  it("5. stale state between prepare and commit → Stale, no transfer", () => {
    const exec = ready();

    // External actor (not the app) mutates the world.
    bank.externalWrite.transferCAS({
      from: "alice",
      to: "bob",
      amount: 10,
      expectedFromVersion: 1,
    });
    expect(bank.stats().successfulTransfers).toBe(1);

    const result = transfer.commit(exec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Stale");
    expect(bank.stats().successfulTransfers).toBe(1);
    expect(bank.read.observe("alice")?.balance).toBe(90);
  });

  it("6. replay of same Executable → second commit fails", () => {
    const exec = ready();
    const first = transfer.commit(exec);
    expect(first.ok).toBe(true);

    const second = transfer.commit(exec);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.tag).toBe("Spent");
    expect(bank.stats().successfulTransfers).toBe(1);
  });

  it("7. TOCTOU: evidence version must match CAS; conflict → Stale", () => {
    const p = transfer.propose({ from: "alice", to: "bob", amount: 25 });
    if (!p.ok) return;
    const from = bank.read.observe("alice")!;
    const to = bank.read.observe("bob")!;

    const decision = transfer.evaluate(
      p.value,
      Object.freeze({ from, to }),
      "2026-09-23T00:00:00Z",
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    bank.externalWrite.transferCAS({
      from: "alice",
      to: "bob",
      amount: 1,
      expectedFromVersion: from.version,
    });

    const result = transfer.commit(decision.value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Stale");
  });

  it("8. concurrent commits of two executables: at most one wins if racing on same version", async () => {
    const p1 = transfer.propose({ from: "alice", to: "bob", amount: 60 });
    const p2 = transfer.propose({ from: "alice", to: "bob", amount: 60 });
    if (!p1.ok || !p2.ok) return;

    const e1 = transfer.prepare(p1.value);
    const e2 = transfer.prepare(p2.value);
    expect(e1.ok && e2.ok).toBe(true);
    if (!e1.ok || !e2.ok) return;

    const results = await Promise.all([
      Promise.resolve(transfer.commit(e1.value)),
      Promise.resolve(transfer.commit(e2.value)),
    ]);

    const wins = results.filter((r) => r.ok).length;
    const losses = results.filter((r) => !r.ok).length;

    expect(wins).toBe(1);
    expect(losses).toBe(1);
    expect(bank.read.observe("alice")?.balance).toBe(40);
    expect(bank.stats().successfulTransfers).toBe(1);
  });

  it("9. adapter exception → Unknown, capability spent, no silent success", () => {
    const exec = ready();
    bank.failNextTransfer(new Error("network_timeout"));

    const result = transfer.commit(exec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Unknown");
    expect(bank.stats().successfulTransfers).toBe(0);

    const retry = transfer.commit(exec);
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.error.tag).toBe("Spent");
  });

  it("10. denied by policy (insufficient funds) never reaches transferCAS", () => {
    const p = transfer.propose({ from: "alice", to: "bob", amount: 10_000 });
    if (!p.ok) return;
    const d = transfer.prepare(p.value);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error.tag).toBe("Denied");
    expect(bank.stats().transferAttempts).toBe(0);
  });

  it("11. cloning executable object still shares token — replay after commit fails", () => {
    const exec = ready();
    const clone = { ...exec } as Executable;
    const first = transfer.commit(exec);
    expect(first.ok).toBe(true);
    const second = transfer.commit(clone);
    expect(second.ok).toBe(false);
    expect(bank.stats().successfulTransfers).toBe(1);
  });

  it("12. JSON round-trip cannot reconstruct a live capability", () => {
    const exec = ready();
    const json = JSON.stringify(exec);
    const parsed = JSON.parse(json) as Executable;
    expect(parsed.__token).toBeUndefined();
    const result = transfer.commit(parsed);
    expect(result.ok).toBe(false);
    expect(bank.stats().successfulTransfers).toBe(0);
    expect(transfer.commit(exec).ok).toBe(true);
  });
});

describe("purity boundaries", () => {
  beforeEach(() => resetVault());

  it("13. evaluate is pure w.r.t bank writes", () => {
    const bank = openBank();
    bank.seed("alice", 50);
    bank.seed("bob", 0);
    const transfer = createTransferEffect({
      read: bank.read,
      write: bank.takeWritePort(),
    });
    const p = transfer.propose({ from: "alice", to: "bob", amount: 10 });
    if (!p.ok) return;
    const from = bank.read.observe("alice")!;
    const to = bank.read.observe("bob")!;
    const before = bank.stats().successfulTransfers;

    transfer.evaluate(p.value, Object.freeze({ from, to }), "t0");

    expect(bank.stats().successfulTransfers).toBe(before);
    expect(bank.stats().transferAttempts).toBe(0);
  });

  it("14. propose freezes intent (Object.isFrozen)", () => {
    const bank = openBank();
    const transfer = createTransferEffect({
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
