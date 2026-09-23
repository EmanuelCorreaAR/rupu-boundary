import { describe, expect, it, beforeEach } from "vitest";
import { FakeBank, propose, prepare, commit, resetVault, liveExecutableCount } from "../src/index.js";

describe("happy path (~20 lines)", () => {
  beforeEach(() => {
    resetVault();
  });

  it("agent proposes → prepare → commit moves money once", () => {
    const bank = new FakeBank();
    bank.seed("alice", 100);
    bank.seed("bob", 0);

    const proposal = propose({ from: "alice", to: "bob", amount: 40 });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;

    const decision = prepare(bank, proposal.value);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    const result = commit(bank, decision.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tag).toBe("Committed");

    expect(bank.observe("alice")?.balance).toBe(60);
    expect(bank.observe("bob")?.balance).toBe(40);
    expect(bank.successfulTransfers).toBe(1);
    expect(liveExecutableCount()).toBe(0);
  });
});
