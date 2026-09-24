/**
 * Inventory reservation fixture — same runtime lifecycle.
 */

import { err, ok, type Result } from "../result.js";
import {
  createEffect,
  type EffectHandle,
  type ParseFailure,
  type Policy,
  type WriteFailure,
} from "../runtime.js";

export type Sku = string;

export type StockSnapshot = {
  readonly sku: Sku;
  readonly available: number;
  readonly version: number;
};

export type ReserveIntent = {
  readonly sku: Sku;
  readonly qty: number;
};

type MutableStock = {
  available: number;
  version: number;
};

export type WarehouseWorld = {
  readonly observe: (sku: Sku) => StockSnapshot | null;
  readonly takeWritePort: () => {
    reserveCAS: (
      intent: ReserveIntent,
      expectedVersion: number,
    ) => Result<void, WriteFailure>;
  };
  readonly seed: (sku: Sku, available: number) => void;
  readonly externalReserve: (
    intent: ReserveIntent,
    expectedVersion: number,
  ) => Result<void, WriteFailure>;
};

export function openWarehouse(): WarehouseWorld {
  const store = new Map<Sku, MutableStock>();
  let writeTaken = false;

  const observe = (sku: Sku): StockSnapshot | null => {
    const s = store.get(sku);
    if (!s) return null;
    return Object.freeze({
      sku,
      available: s.available,
      version: s.version,
    });
  };

  const reserveCAS = (
    intent: ReserveIntent,
    expectedVersion: number,
  ): Result<void, WriteFailure> => {
    const s = store.get(intent.sku);
    if (!s) return err({ code: "not_found" });
    if (s.version !== expectedVersion) {
      return err({ code: "version_conflict" });
    }
    if (s.available < intent.qty) {
      return err({ code: "insufficient_stock" });
    }
    s.available -= intent.qty;
    s.version += 1;
    return ok(undefined);
  };

  return {
    observe,
    takeWritePort: () => {
      if (writeTaken) throw new Error("write_port_already_taken");
      writeTaken = true;
      return { reserveCAS };
    },
    seed: (sku, available) => {
      store.set(sku, { available, version: 1 });
    },
    externalReserve: reserveCAS,
  };
}

const enoughStock: Policy<ReserveIntent, StockSnapshot> = (intent, snap) => {
  if (snap.available >= intent.qty) return { pass: true };
  return {
    pass: false,
    failure: {
      policy: "enoughStock",
      condition: `available >= ${intent.qty}`,
      actual: `available=${snap.available}`,
    },
  };
};

function parseReserve(raw: unknown): Result<ReserveIntent, ParseFailure> {
  if (raw === null || typeof raw !== "object") {
    return err({ code: "invalid_shape", detail: "not an object" });
  }
  const o = raw as Record<string, unknown>;
  const sku = o["sku"];
  const qty = o["qty"];
  if (typeof sku !== "string") {
    return err({ code: "invalid_shape", detail: "sku" });
  }
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) {
    return err({ code: "invalid_shape", detail: "qty" });
  }
  return ok(Object.freeze({ sku, qty }));
}

export type ReserveEffect = EffectHandle<ReserveIntent, StockSnapshot>;

export function createReserveEffect(world: WarehouseWorld): ReserveEffect {
  const write = world.takeWritePort();
  return createEffect<ReserveIntent, StockSnapshot>({
    parse: parseReserve,
    observe: (intent) => world.observe(intent.sku),
    hash: (snap) => `v${snap.version}:a${snap.available}`,
    policies: [enoughStock],
    write: (intent, snap) => write.reserveCAS(intent, snap.version),
  });
}
