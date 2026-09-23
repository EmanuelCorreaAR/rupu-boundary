/**
 * Hostile fake bank — the only mutable world in the spike.
 * Reads return immutable snapshots. Writes are CAS-only.
 */

export type AccountId = string;

export type AccountSnapshot = {
  readonly id: AccountId;
  readonly balance: number;
  readonly active: boolean;
  readonly version: number;
};

export type TransferIntent = {
  readonly from: AccountId;
  readonly to: AccountId;
  readonly amount: number;
};

export type TransferCasRequest = TransferIntent & {
  readonly expectedFromVersion: number;
};

export type TransferFailure =
  | { readonly code: "not_found"; readonly account: AccountId }
  | { readonly code: "inactive"; readonly account: AccountId }
  | { readonly code: "insufficient"; readonly balance: number; readonly amount: number }
  | { readonly code: "version_conflict"; readonly expected: number; readonly actual: number }
  | { readonly code: "same_account" }
  | { readonly code: "invalid_amount" };

type MutableAccount = {
  balance: number;
  active: boolean;
  version: number;
};

export class FakeBank {
  readonly #accounts = new Map<AccountId, MutableAccount>();
  /** How many times transferCAS was invoked (including rejected). */
  transferAttempts = 0;
  /** How many times a CAS write actually mutated state. */
  successfulTransfers = 0;
  /** Optional hook to fail the adapter mid-flight. */
  failNextTransfer: Error | null = null;

  seed(id: AccountId, balance: number, active = true): void {
    this.#accounts.set(id, { balance, active, version: 1 });
  }

  /** Pure-looking read: returns a frozen snapshot (copy). */
  observe(id: AccountId): AccountSnapshot | null {
    const a = this.#accounts.get(id);
    if (!a) return null;
    return Object.freeze({
      id,
      balance: a.balance,
      active: a.active,
      version: a.version,
    });
  }

  /**
   * Conditional transfer. Mutates only if from.version === expectedFromVersion.
   * This is the sole write path — there is no unlocked transfer().
   */
  transferCAS(
    req: TransferCasRequest,
  ): ResultFromBank {
    this.transferAttempts += 1;

    if (this.failNextTransfer) {
      const e = this.failNextTransfer;
      this.failNextTransfer = null;
      throw e;
    }

    if (req.amount <= 0 || !Number.isFinite(req.amount)) {
      return { ok: false, error: { code: "invalid_amount" } };
    }
    if (req.from === req.to) {
      return { ok: false, error: { code: "same_account" } };
    }

    const from = this.#accounts.get(req.from);
    const to = this.#accounts.get(req.to);
    if (!from) return { ok: false, error: { code: "not_found", account: req.from } };
    if (!to) return { ok: false, error: { code: "not_found", account: req.to } };
    if (!from.active) return { ok: false, error: { code: "inactive", account: req.from } };
    if (!to.active) return { ok: false, error: { code: "inactive", account: req.to } };

    if (from.version !== req.expectedFromVersion) {
      return {
        ok: false,
        error: {
          code: "version_conflict",
          expected: req.expectedFromVersion,
          actual: from.version,
        },
      };
    }

    if (from.balance < req.amount) {
      return {
        ok: false,
        error: { code: "insufficient", balance: from.balance, amount: req.amount },
      };
    }

    from.balance -= req.amount;
    from.version += 1;
    to.balance += req.amount;
    to.version += 1;
    this.successfulTransfers += 1;

    return {
      ok: true,
      value: {
        from: this.observe(req.from)!,
        to: this.observe(req.to)!,
      },
    };
  }
}

type ResultFromBank =
  | { ok: true; value: { from: AccountSnapshot; to: AccountSnapshot } }
  | { ok: false; error: TransferFailure };
