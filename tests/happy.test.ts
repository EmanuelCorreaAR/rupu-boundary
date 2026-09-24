import { describe, expect, it, beforeEach } from "vitest";
import {
  openBank,
  createTransferBoundary,
} from "../src/effect.js";
import { resetVault, liveExecutableCount } from "../src/testing.js";

describe("happy path (~20 lines)", () => {
  beforeEach(() => resetVault());

  it("agent proposes → prepare → commit moves money once", async () => {
    const bank = openBank();
    bank.seed("alice", 100);
    bank.seed("bob", 0);

    const transfer = createTransferBoundary({
      read: bank.read,
      write: bank.takeWritePort(),
    });

    const proposal = transfer.propose({ from: "alice", to: "bob", amount: 40 });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;

    const decision = await transfer.prepare(proposal.value);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    const result = await transfer.commit(decision.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tag).toBe("Committed");

    expect(bank.read.observe("alice")?.balance).toBe(60);
    expect(bank.read.observe("bob")?.balance).toBe(40);
    expect(bank.stats().successfulTransfers).toBe(1);
    expect(liveExecutableCount()).toBe(0);
  });
});
