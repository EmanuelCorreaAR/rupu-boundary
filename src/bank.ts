/**
 * Hostile fake bank — ports, not a god-object handed to the app.
 *
 * Composition root may hold read + write.
 * Application code should receive only `read` (optional) and the effect handle.
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

export type CasResult =
  | { ok: true; value: { from: AccountSnapshot; to: AccountSnapshot } }
  | { ok: false; error: TransferFailure };

/** Read capability — safe to hand to application / UI. */
export type ReadPort = {
  readonly observe: (id: AccountId) => AccountSnapshot | null;
};

/**
 * Write capability — must be injected into the runtime and never returned
 * on the application-facing effect API.
 */
export type WritePort = {
  readonly transferCAS: (req: TransferCasRequest) => CasResult;
};

export type BankStats = {
  transferAttempts: number;
  successfulTransfers: number;
};

export type OpenBank = {
  readonly read: ReadPort;
  /**
   * Take the write port exactly once (ownership transfer into the runtime).
   * After this, the composition root no longer holds a usable write reference
   * unless it kept a copy before calling takeWritePort — don't.
   */
  readonly takeWritePort: () => WritePort;
  readonly seed: (id: AccountId, balance: number, active?: boolean) => void;
  readonly stats: () => Readonly<BankStats>;
  /** Test / harness: make the next CAS throw (simulates adapter failure). */
  readonly failNextTransfer: (error: Error) => void;
  /**
   * Test only: a second write handle that simulates an *external* actor
   * (not the application). Does not count as the app write port.
   */
  readonly externalWrite: WritePort;
};

type MutableAccount = {
  balance: number;
  active: boolean;
  version: number;
};

class World {
  readonly accounts = new Map<AccountId, MutableAccount>();
  stats: BankStats = { transferAttempts: 0, successfulTransfers: 0 };
  failNext: Error | null = null;

  observe(id: AccountId): AccountSnapshot | null {
    const a = this.accounts.get(id);
    if (!a) return null;
    return Object.freeze({
      id,
      balance: a.balance,
      active: a.active,
      version: a.version,
    });
  }

  transferCAS(req: TransferCasRequest): CasResult {
    this.stats.transferAttempts += 1;

    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }

    if (req.amount <= 0 || !Number.isFinite(req.amount)) {
      return { ok: false, error: { code: "invalid_amount" } };
    }
    if (req.from === req.to) {
      return { ok: false, error: { code: "same_account" } };
    }

    const from = this.accounts.get(req.from);
    const to = this.accounts.get(req.to);
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
    this.stats.successfulTransfers += 1;

    return {
      ok: true,
      value: {
        from: this.observe(req.from)!,
        to: this.observe(req.to)!,
      },
    };
  }
}

export function openBank(): OpenBank {
  const world = new World();
  let writeTaken = false;

  const read: ReadPort = {
    observe: (id) => world.observe(id),
  };

  const makeWrite = (): WritePort => ({
    transferCAS: (req) => world.transferCAS(req),
  });

  return {
    read,
    takeWritePort: () => {
      if (writeTaken) {
        throw new Error("write_port_already_taken");
      }
      writeTaken = true;
      return makeWrite();
    },
    seed: (id, balance, active = true) => {
      world.accounts.set(id, { balance, active, version: 1 });
    },
    stats: () => ({ ...world.stats }),
    failNextTransfer: (error) => {
      world.failNext = error;
    },
    externalWrite: makeWrite(),
  };
}
