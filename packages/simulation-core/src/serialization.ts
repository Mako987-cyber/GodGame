import type { WorldState } from "./types";

export const STATE_VERSION = 1;

export interface SerializedWorld {
  version: number;
  state: WorldState;
}

export function serializeWorld(state: WorldState): string {
  return JSON.stringify({ version: STATE_VERSION, state } satisfies SerializedWorld);
}

export function deserializeWorld(json: string): WorldState {
  const parsed = JSON.parse(json) as SerializedWorld;
  if (parsed.version !== STATE_VERSION)
    throw new Error(`Versione di stato non supportata: ${parsed.version}`);
  return normalizeState(parsed.state);
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
  state.archive ??= { people: [], households: [] };
  return state;
}

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
