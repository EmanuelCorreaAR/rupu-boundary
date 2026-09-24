import { describe, expect, it, beforeEach } from "vitest";
import {
  openBank,
  createTransferBoundary,
  TRANSFER_BOUNDARY_KEYS,
  type TransferBoundary,
} from "../src/effect.js";
import { resetVault } from "../src/testing.js";

/**
 * Simulated application module: only receives the effect handle (+ optional read).
 * It must not be able to reach a write-capable operation.
 */
async function runAppAgent(
  transfer: TransferBoundary,
  agentOutput: unknown,
): Promise<{ ok: boolean; aliceBalance?: number; read?: { observe: (id: string) => unknown } }> {
  const proposal = transfer.propose(agentOutput);
  if (!proposal.ok) return { ok: false };
  const decision = await transfer.prepare(proposal.value);
  if (!decision.ok) return { ok: false };
  const result = await transfer.commit(decision.value);
  return { ok: result.ok };
}

describe("sealed write port", () => {
  beforeEach(() => resetVault());

  it("15. write port is taken once; second take throws", async () => {
    const bank = openBank();
    bank.takeWritePort();
    expect(() => bank.takeWritePort()).toThrow(/write_port_already_taken/);
  });

  it("16. effect handle exposes only propose/prepare/commit (no evaluate)", async () => {
    const bank = openBank();
    const transfer = createTransferBoundary({
      read: bank.read,
      write: bank.takeWritePort(),
    });

    expect(Object.keys(transfer).sort()).toEqual([...TRANSFER_BOUNDARY_KEYS].sort());
    expect(transfer).not.toHaveProperty("evaluate");
    expect(transfer).not.toHaveProperty("write");
    expect(transfer).not.toHaveProperty("read");
    expect(transfer).not.toHaveProperty("transferCAS");
    expect(transfer).not.toHaveProperty("externalWrite");

    // Deep-ish surface scan: no function named like a write.
    for (const key of Object.keys(transfer)) {
      expect(key.toLowerCase()).not.toMatch(/write|cas|transfer$/);
    }
  });

  it("17. app callback with only TransferBoundary cannot debit except via commit", async () => {
    const bank = openBank();
    bank.seed("alice", 100);
    bank.seed("bob", 0);

    const transfer = createTransferBoundary({
      read: bank.read,
      write: bank.takeWritePort(),
    });

    // Composition root keeps read for assertions; app only gets `transfer`.
    const outcome = await runAppAgent(transfer, {
      from: "alice",
      to: "bob",
      amount: 30,
    });
    expect(outcome.ok).toBe(true);
    expect(bank.read.observe("alice")?.balance).toBe(70);

    // App cannot call takeWritePort again (already taken at wiring).
    expect(() => bank.takeWritePort()).toThrow(/write_port_already_taken/);
  });

  it("18. JSON/inspect of effect handle does not leak write port", async () => {
    const bank = openBank();
    const transfer = createTransferBoundary({
      read: bank.read,
      write: bank.takeWritePort(),
    });

    const serialized = JSON.stringify(transfer);
    expect(serialized).toBe("{}"); // functions omitted; no write data
    expect(serialized).not.toContain("transferCAS");
  });
});
