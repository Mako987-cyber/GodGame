/**
 * Resource model.
 *
 * The four historical resources (food, wood, stone, copper) keep their own columns in the
 * database, so worlds created before this version load unchanged. Every resource added
 * later lives in the `goods` bag, persisted as a single JSONB column with default `{}`.
 * All access goes through the helpers below, which never produce NaN or negative values.
 */
export const CORE_RESOURCES = ["food", "wood", "stone", "copper"] as const;
export type CoreResource = (typeof CORE_RESOURCES)[number];

export const EXTRA_RESOURCES = ["water", "clay", "hides", "tin", "iron", "fuel", "tools", "wealth"] as const;
export type ExtraResource = (typeof EXTRA_RESOURCES)[number];

export const RESOURCES = [...CORE_RESOURCES, ...EXTRA_RESOURCES] as const;
export type ResourceKind = (typeof RESOURCES)[number];

export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  food: "cibo",
  wood: "legname",
  stone: "pietra",
  copper: "rame",
  water: "acqua",
  clay: "argilla",
  hides: "pelli e tessuti",
  tin: "stagno",
  iron: "ferro",
  fuel: "combustibile",
  tools: "strumenti",
  wealth: "ricchezza",
};

/** Resources that rot: a share is lost every year unless preservation improves. */
export const PERISHABLE: ReadonlySet<ResourceKind> = new Set<ResourceKind>(["food", "hides"]);

export type ResourceBundle = Partial<Record<ResourceKind, number>>;

export type GoodsBag = Partial<Record<ExtraResource, number>>;

export interface Stockpile {
  food: number;
  wood: number;
  stone: number;
  copper: number;
  /** Resources introduced after the first release; absent keys mean zero. */
  goods: GoodsBag;
}

const CORE = new Set<string>(CORE_RESOURCES);

export function isCoreResource(kind: ResourceKind): kind is CoreResource {
  return CORE.has(kind);
}

export function emptyStock(): Stockpile {
  return { food: 0, wood: 0, stone: 0, copper: 0, goods: {} };
}

/** Accepts anything shaped like a stockpile (including rows loaded from an older schema). */
export function normalizeStock(input: Partial<Stockpile> | null | undefined): Stockpile {
  const goods: GoodsBag = {};
  const raw = (input?.goods ?? {}) as Record<string, unknown>;
  for (const key of EXTRA_RESOURCES) {
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value !== 0) goods[key] = value < 0 ? 0 : value;
  }
  return {
    food: safe(input?.food),
    wood: safe(input?.wood),
    stone: safe(input?.stone),
    copper: safe(input?.copper),
    goods,
  };
}

function safe(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function getResourceAmount(stock: Stockpile, kind: ResourceKind): number {
  if (isCoreResource(kind)) return stock[kind];
  return stock.goods[kind] ?? 0;
}

function setResource(stock: Stockpile, kind: ResourceKind, amount: number): number {
  const value = Number.isFinite(amount) && amount > 0 ? amount : 0;
  if (isCoreResource(kind)) {
    stock[kind] = value;
    return value;
  }
  if (value === 0) delete stock.goods[kind];
  else stock.goods[kind] = value;
  return value;
}

/** Adds `amount` (negative amounts are clamped at zero) and returns the new total. */
export function addResource(stock: Stockpile, kind: ResourceKind, amount: number): number {
  if (!Number.isFinite(amount) || amount === 0) return getResourceAmount(stock, kind);
  return setResource(stock, kind, getResourceAmount(stock, kind) + amount);
}

/** Consumes up to `amount` and returns how much was actually taken. */
export function consumeResource(stock: Stockpile, kind: ResourceKind, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const available = getResourceAmount(stock, kind);
  const taken = Math.min(available, amount);
  setResource(stock, kind, available - taken);
  return taken;
}

/** Moves up to `amount` from one stockpile to another; returns the amount moved. */
export function transferResource(from: Stockpile, to: Stockpile, kind: ResourceKind, amount: number): number {
  const taken = consumeResource(from, kind, amount);
  if (taken > 0) addResource(to, kind, taken);
  return taken;
}

/** Caps a resource at `max` and returns how much was lost. */
export function clampResource(stock: Stockpile, kind: ResourceKind, max: number): number {
  const available = getResourceAmount(stock, kind);
  if (!Number.isFinite(max) || max < 0) return 0;
  if (available <= max) return 0;
  setResource(stock, kind, max);
  return available - max;
}

export function hasRequiredResources(stock: Stockpile, required: ResourceBundle): boolean {
  for (const [kind, amount] of bundleEntries(required)) {
    if (getResourceAmount(stock, kind) + 1e-9 < amount) return false;
  }
  return true;
}

export function payResources(stock: Stockpile, required: ResourceBundle): boolean {
  if (!hasRequiredResources(stock, required)) return false;
  for (const [kind, amount] of bundleEntries(required)) consumeResource(stock, kind, amount);
  return true;
}

export function bundleEntries(bundle: ResourceBundle): [ResourceKind, number][] {
  const out: [ResourceKind, number][] = [];
  for (const kind of RESOURCES) {
    const amount = bundle[kind];
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) out.push([kind, amount]);
  }
  return out;
}

export function bundleTotal(bundle: ResourceBundle): number {
  let total = 0;
  for (const [, amount] of bundleEntries(bundle)) total += amount;
  return total;
}

export function addBundle(target: ResourceBundle, source: ResourceBundle): ResourceBundle {
  for (const [kind, amount] of bundleEntries(source)) target[kind] = (target[kind] ?? 0) + amount;
  return target;
}

/** What is still missing from `stock` to cover `required`. */
export function missingResources(stock: Stockpile, required: ResourceBundle): ResourceBundle {
  const missing: ResourceBundle = {};
  for (const [kind, amount] of bundleEntries(required)) {
    const gap = amount - getResourceAmount(stock, kind);
    if (gap > 1e-9) missing[kind] = Math.round(gap * 100) / 100;
  }
  return missing;
}

export function stockToBundle(stock: Stockpile): ResourceBundle {
  const bundle: ResourceBundle = {};
  for (const kind of RESOURCES) {
    const amount = getResourceAmount(stock, kind);
    if (amount > 0) bundle[kind] = amount;
  }
  return bundle;
}

export function roundStock(stock: Stockpile, decimals = 2): Stockpile {
  const f = 10 ** decimals;
  for (const kind of CORE_RESOURCES) stock[kind] = Math.round(safe(stock[kind]) * f) / f;
  for (const kind of EXTRA_RESOURCES) {
    const value = stock.goods[kind];
    if (value === undefined) continue;
    const rounded = Math.round(safe(value) * f) / f;
    if (rounded === 0) delete stock.goods[kind];
    else stock.goods[kind] = rounded;
  }
  return stock;
}

/** Aggregate "value" of a stockpile, used for trade valuation and wealth statistics. */
export const RESOURCE_VALUE: Record<ResourceKind, number> = {
  food: 1,
  water: 0.2,
  wood: 0.8,
  stone: 0.9,
  clay: 0.7,
  hides: 1.6,
  copper: 3,
  tin: 3.4,
  iron: 4,
  fuel: 1.2,
  tools: 5,
  wealth: 1,
};

export function stockValue(stock: Stockpile): number {
  let value = 0;
  for (const kind of RESOURCES) value += getResourceAmount(stock, kind) * RESOURCE_VALUE[kind];
  return Math.round(value * 100) / 100;
}
