import { migrateState, SIMULATION_VERSION } from "./normalize";
import type { WorldState } from "./types";

/**
 * Serialization format version. Bumping it never breaks an existing world: anything older
 * is run through `migrateState`, which fills the fields introduced later with deterministic
 * defaults (see `normalize.ts`).
 */
export const STATE_VERSION = 2;

/** Oldest format this build can still read. */
export const MIN_SUPPORTED_STATE_VERSION = 1;

export { SIMULATION_VERSION };

export interface SerializedWorld {
  version: number;
  state: WorldState;
}

export function serializeWorld(state: WorldState): string {
  return JSON.stringify({ version: STATE_VERSION, state } satisfies SerializedWorld);
}

export function deserializeWorld(json: string): WorldState {
  const parsed = JSON.parse(json) as SerializedWorld;
  return deserializeState(parsed);
}

/** Accepts any state produced by a supported version and returns a fully normalized one. */
export function deserializeState(parsed: SerializedWorld): WorldState {
  const version = Number(parsed.version ?? 1);
  if (!Number.isFinite(version) || version < MIN_SUPPORTED_STATE_VERSION) {
    throw new Error(`Versione di stato non supportata: ${parsed.version}`);
  }
  if (version > STATE_VERSION) {
    throw new Error(
      `Lo stato è stato salvato da una versione più recente del motore (${version} > ${STATE_VERSION})`,
    );
  }
  return normalizeState(migrateState(parsed.state));
}

export function cloneWorld(state: WorldState): WorldState {
  return structuredClone(state);
}

/**
 * Canonical ordering: the engine iterates arrays in order, so any state loaded from a
 * database must be sorted by the deterministic sequence numbers to replay identically.
 */
export function normalizeState(state: WorldState): WorldState {
  state.cells.sort((a, b) => a.y - b.y || a.x - b.x);
  state.people.sort((a, b) => a.seq - b.seq);
  state.tribes.sort((a, b) => a.seq - b.seq);
  state.settlements.sort((a, b) => a.seq - b.seq);
  state.civilizations.sort((a, b) => a.seq - b.seq);
  state.households.sort((a, b) => a.seq - b.seq);
  state.relationships.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  state.dynasties ??= [];
  state.dynasties.sort((a, b) => a.seq - b.seq);
  state.crises ??= [];
  state.crises.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  state.climate.hazards ??= [];
  state.climate.hazards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  state.archive ??= { people: [], households: [] };
  // Lists without a sequence number get a canonical order too: the database returns them in
  // its own order, and a replay must iterate them exactly as the original run did.
  state.reputations ??= [];
  state.reputations.sort(byReputation);
  state.knowledge ??= [];
  state.knowledge.sort(byKnowledge);
  return state;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const byReputation = (a: { civilizationId: string }, b: { civilizationId: string }) =>
  cmp(a.civilizationId, b.civilizationId);

export const byKnowledge = (
  a: { observerId: string; targetId: string },
  b: { observerId: string; targetId: string },
) => cmp(a.observerId, b.observerId) || cmp(a.targetId, b.targetId);

/** JSON with sorted object keys: JSONB storage does not preserve key order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return v;
  });
}

/** FNV-1a hash of the canonical JSON, used to compare worlds in determinism tests. */
export function hashWorld(state: WorldState): string {
  const { archive: _archive, ...rest } = state;
  const json = canonicalJson(rest);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
