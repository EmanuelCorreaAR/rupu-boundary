import { describe, expect, it, beforeEach } from "vitest";
import { FakeBank } from "../src/bank.js";
import {
  propose,
  prepare,
  commit,
  evaluate,
  resetVault,
  defaultPolicies,
  type Executable,
} from "../src/effect.js";

describe("adversarial battery", () => {
  let bank: FakeBank;

  beforeEach(() => {
    resetVault();
    bank = new FakeBank();
    bank.seed("alice", 100);
    bank.seed("bob", 0);
  });

  function ready(): Executable {
    const p = propose({ from: "alice", to: "bob", amount: 25 });
    if (!p.ok) throw new Error("propose failed");
    const d = prepare(bank, p.value);
    if (!d.ok) throw new Error("prepare failed");
    return d.value;
  }

  it("1. bypass: there is no unlocked transfer API on FakeBank", () => {
    expect("transfer" in bank).toBe(false);
    expect(typeof (bank as { transfer?: unknown }).transfer).toBe("undefined");
    // Only transferCAS exists — and it demands expectedFromVersion.
    const rejected = bank.transferCAS({
      from: "alice",
      to: "bob",
      amount: 25,
      expectedFromVersion: 999,
    });
    expect(rejected.ok).toBe(false);
    expect(bank.successfulTransfers).toBe(0);
  });

  it("2. forged Executable (structural twin) cannot commit", () => {
    const forged = {
      tag: "Executable",
      __token: Symbol("forged"),
    } as Executable;

    const result = commit(bank, forged);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Spent");
    expect(bank.successfulTransfers).toBe(0);
  });

  it("3. as any double-asserted garbage cannot commit", () => {
    const garbage = { tag: "Executable", __token: Symbol("any") } as any as Executable;
    const result = commit(bank, garbage);
    expect(result.ok).toBe(false);
    expect(bank.successfulTransfers).toBe(0);
  });

  it("4. mutating proposal data after propose does not affect sealed intent", () => {
    const raw = { from: "alice", to: "bob", amount: 25 };
    const p = propose(raw);
    expect(p.ok).toBe(true);
    if (!p.ok) return;

    // Try to poison the agent payload after parse.
    (raw as { amount: number }).amount = 999;

    const d = prepare(bank, p.value);
    expect(d.ok).toBe(true);
    if (!d.ok) return;

    const result = commit(bank, d.value);
    expect(result.ok).toBe(true);
    expect(bank.observe("alice")?.balance).toBe(75); // 100-25, not 999
  });

  it("5. stale state between prepare and commit → Stale, no transfer", () => {
    const exec = ready();

    // World changes (e.g. another withdrawal) before commit.
    bank.transferCAS({
      from: "alice",
      to: "bob",
      amount: 10,
      expectedFromVersion: 1,
    });
    expect(bank.successfulTransfers).toBe(1);

    const result = commit(bank, exec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Stale");
    // Only the direct CAS above succeeded — sealed commit did not.
    expect(bank.successfulTransfers).toBe(1);
    expect(bank.observe("alice")?.balance).toBe(90);
  });

  it("6. replay of same Executable → second commit fails", () => {
    const exec = ready();
    const first = commit(bank, exec);
    expect(first.ok).toBe(true);

    const second = commit(bank, exec);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.tag).toBe("Spent");
    expect(bank.successfulTransfers).toBe(1);
  });

  it("7. TOCTOU: evidence version must match CAS; conflict → Stale", () => {
    const p = propose({ from: "alice", to: "bob", amount: 25 });
    if (!p.ok) return;
    const from = bank.observe("alice")!;
    const to = bank.observe("bob")!;

    const decision = evaluate({
      proposal: p.value,
      from,
      to,
      policies: defaultPolicies,
      observedAt: "2026-09-23T00:00:00Z",
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    // Interleave a write with the same observed version window.
    bank.transferCAS({
      from: "alice",
      to: "bob",
      amount: 1,
      expectedFromVersion: from.version,
    });

    const result = commit(bank, decision.value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Stale");
  });

  it("8. concurrent commits of two executables: at most one wins if racing on same version", async () => {
    const p1 = propose({ from: "alice", to: "bob", amount: 60 });
    const p2 = propose({ from: "alice", to: "bob", amount: 60 });
    if (!p1.ok || !p2.ok) return;

    // Both prepared against the same snapshot (classic TOCTOU race setup).
    const e1 = prepare(bank, p1.value);
    const e2 = prepare(bank, p2.value);
    expect(e1.ok && e2.ok).toBe(true);
    if (!e1.ok || !e2.ok) return;

    const results = await Promise.all([
      Promise.resolve(commit(bank, e1.value)),
      Promise.resolve(commit(bank, e2.value)),
    ]);

    const wins = results.filter((r) => r.ok).length;
    const stales = results.filter((r) => !r.ok && r.error.tag === "Stale").length;
    const spentOrBank = results.filter(
      (r) => !r.ok && (r.error.tag === "Spent" || r.error.tag === "Bank"),
    ).length;

    // First CAS bumps version; second must not double-spend.
    expect(wins).toBe(1);
    expect(stales + spentOrBank).toBe(1);
    expect(bank.observe("alice")?.balance).toBe(40);
    expect(bank.successfulTransfers).toBe(1);
  });

  it("9. adapter exception → Unknown, capability spent, no silent success", () => {
    const exec = ready();
    bank.failNextTransfer = new Error("network_timeout");

    const result = commit(bank, exec);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.tag).toBe("Unknown");
    expect(bank.successfulTransfers).toBe(0);

    // Capability was consumed — cannot retry the same Executable.
    const retry = commit(bank, exec);
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.error.tag).toBe("Spent");
  });

  it("10. denied by policy (insufficient funds) never reaches transferCAS", () => {
    const p = propose({ from: "alice", to: "bob", amount: 10_000 });
    if (!p.ok) return;
    const d = prepare(bank, p.value);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error.tag).toBe("Denied");
    expect(bank.transferAttempts).toBe(0);
  });

  it("11. cloning executable object still shares token — replay after commit fails", () => {
    const exec = ready();
    const clone = { ...exec } as Executable;
    const first = commit(bank, exec);
    expect(first.ok).toBe(true);
    const second = commit(bank, clone);
    expect(second.ok).toBe(false);
    expect(bank.successfulTransfers).toBe(1);
  });

  it("12. JSON round-trip cannot reconstruct a live capability", () => {
    const exec = ready();
    const json = JSON.stringify(exec);
    const parsed = JSON.parse(json) as Executable;
    // Symbol token is lost in JSON.
    expect(parsed.__token).toBeUndefined();
    const result = commit(bank, parsed);
    expect(result.ok).toBe(false);
    expect(bank.successfulTransfers).toBe(0);
    // Original still works.
    expect(commit(bank, exec).ok).toBe(true);
  });
});

describe("purity boundaries", () => {
  beforeEach(() => resetVault());

  it("evaluate is pure w.r.t bank writes", () => {
    const bank = new FakeBank();
    bank.seed("alice", 50);
    bank.seed("bob", 0);
    const p = propose({ from: "alice", to: "bob", amount: 10 });
    if (!p.ok) return;
    const from = bank.observe("alice")!;
    const to = bank.observe("bob")!;
    const before = bank.successfulTransfers;

    evaluate({
      proposal: p.value,
      from,
      to,
      policies: defaultPolicies,
      observedAt: "t0",
    });

    expect(bank.successfulTransfers).toBe(before);
    expect(bank.transferAttempts).toBe(0);
  });

  it("propose freezes intent (Object.isFrozen)", () => {
    const p = propose({ from: "alice", to: "bob", amount: 1 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(Object.isFrozen(p.value.intent)).toBe(true);
    expect(Object.isFrozen(p.value)).toBe(true);
  });
});
