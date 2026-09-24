/**
 * Inventory reservation — algebra D.
 */

import { err, ok, type Result } from "../result.js";
import {
  createBoundary,
  type DeniedReasons,
  type BoundaryHandle,
  type ParseFailure,
  type PolicyFailure,
  type WriteFailure,
} from "../runtime.js";

export type Sku = string;

export type StockState = {
  readonly sku: Sku;
  readonly available: number;
  readonly version: number;
};

export type ReserveWitness = {
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
  readonly observe: (sku: Sku) => StockState | null;
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

  const observe = (sku: Sku): StockState | null => {
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
    if (!s) return err({ tag: "Error", code: "not_found" });
    if (s.version !== expectedVersion) {
      return err({ tag: "Conflict" });
    }
    if (s.available < intent.qty) {
      return err({ tag: "Error", code: "insufficient_stock" });
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

function enoughStock(
  intent: ReserveIntent,
  state: StockState,
): Result<void, DeniedReasons> {
  if (state.available >= intent.qty) return ok(undefined);
  const f: PolicyFailure = {
    policy: "enoughStock",
    condition: `available >= ${intent.qty}`,
    actual: `available=${state.available}`,
  };
  return err(Object.freeze([f]) as DeniedReasons);
}

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

export type ReserveBoundary = BoundaryHandle<ReserveIntent, StockState, ReserveWitness>;

export function createReserveBoundary(world: WarehouseWorld): ReserveBoundary {
  const write = world.takeWritePort();
  return createBoundary({
    parse: parseReserve,
    spec: {
      observe: (intent) => {
        const state = world.observe(intent.sku);
        if (!state) return err({ code: "not_found" });
        const witness: ReserveWitness = Object.freeze({ version: state.version });
        return ok(Object.freeze({ state, witness }));
      },
      check: enoughStock,
      write: (intent, witness) => write.reserveCAS(intent, witness.version),
    },
  });
}
