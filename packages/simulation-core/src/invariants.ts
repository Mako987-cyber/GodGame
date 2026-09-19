import { RESOURCES, getResourceAmount } from "./stock";
import { TECH_BY_ID } from "./technology";
import { inBounds } from "./grid";
import { checkIdentityLineage } from "./identity/lineage";
import type { HistoricalEvent, WorldState } from "./types";

/**
 * Integrity checks that must hold after every tick.
 *
 * Used by the test suite (250-tick stress run) and available in development through
 * `runSimulation(..., { checkInvariants: true })`. Returns a list of human-readable
 * violations: an empty list means the state is consistent.
 */
export interface InvariantOptions {
  /** Events produced so far, checked for dangling references. */
  events?: HistoricalEvent[];
  /** Ids that ever existed (including archived entities). */
  knownIds?: Set<string>;
  /** Stops after this many violations to keep error messages readable. */
  limit?: number;
}

export function checkInvariants(state: WorldState, options: InvariantOptions = {}): string[] {
  const problems: string[] = [];
  const limit = options.limit ?? 40;
  const add = (message: string) => {
    if (problems.length < limit) problems.push(message);
  };
  const finite = (value: number, what: string) => {
    if (!Number.isFinite(value)) add(`${what} non è un numero finito (${value})`);
  };

  const tribes = new Map(state.tribes.map((t) => [t.id, t]));
  const settlements = new Map(state.settlements.map((s) => [s.id, s]));
  const people = new Map(state.people.map((p) => [p.id, p]));
  const households = new Map(state.households.map((h) => [h.id, h]));
  const dynasties = new Set(state.dynasties.map((d) => d.id));

  // --- World ---------------------------------------------------------------
  if (state.tick < 0) add(`tick negativo (${state.tick})`);
  if (state.cells.length !== state.width * state.height)
    add(`numero di celle errato: ${state.cells.length} invece di ${state.width * state.height}`);
  finite(state.climate.modifier, "climate.modifier");
  if (state.climate.modifier <= 0) add(`climate.modifier non positivo (${state.climate.modifier})`);
  if (state.climate.seasons.length !== 0 && state.climate.seasons.length !== 4)
    add(`stagioni incoerenti: ${state.climate.seasons.length}`);

  // --- Cells ---------------------------------------------------------------
  for (const cell of state.cells) {
    if (!inBounds(state, cell.x, cell.y)) add(`cella fuori mappa: ${cell.x},${cell.y}`);
    for (const [key, value] of [
      ["fauna", cell.fauna],
      ["wood", cell.wood],
      ["stone", cell.stone],
      ["copper", cell.copper],
      ["iron", cell.iron],
      ["clay", cell.clay],
      ["tin", cell.tin],
      ["coal", cell.coal],
      ["fertility", cell.fertility],
      ["habitability", cell.habitability],
    ] as const) {
      finite(value, `cella ${cell.x},${cell.y} ${key}`);
      if (value < 0) add(`cella ${cell.x},${cell.y} ha ${key} negativo (${value})`);
    }
    if (cell.fields < 0 || cell.pastures < 0) add(`cella ${cell.x},${cell.y} ha campi/pascoli negativi`);
    if (cell.settlementId) {
      const owner = settlements.get(cell.settlementId);
      if (!owner) add(`cella ${cell.x},${cell.y} riferisce l'insediamento inesistente ${cell.settlementId}`);
      else if (cell.ownerTribeId !== owner.tribeId)
        add(`cella ${cell.x},${cell.y}: insediamento e tribù proprietaria non coincidono`);
    }
    if (cell.ownerTribeId && !tribes.has(cell.ownerTribeId))
      add(`cella ${cell.x},${cell.y} riferisce la tribù inesistente ${cell.ownerTribeId}`);
  }

  // --- People --------------------------------------------------------------
  for (const p of state.people) {
    if (!p.alive) add(`la persona ${p.id} è morta ma è ancora nello stato attivo`);
    if (p.action !== "rest" && !p.alive) add(`la persona morta ${p.id} sta ancora agendo (${p.action})`);
    if (!inBounds(state, p.x, p.y)) add(`persona ${p.id} fuori mappa (${p.x},${p.y})`);
    finite(p.health, `persona ${p.id} health`);
    finite(p.hunger, `persona ${p.id} hunger`);
    if (p.health < 0 || p.health > 1) add(`persona ${p.id} con health fuori range (${p.health})`);
    if (p.age < 0) add(`persona ${p.id} con età negativa`);
    if (p.motherId === p.id || p.fatherId === p.id) add(`persona ${p.id} è genitore di sé stessa`);
    if (p.motherId && p.fatherId && p.motherId === p.fatherId)
      add(`persona ${p.id} ha lo stesso individuo come madre e padre`);
    const tribe = tribes.get(p.tribeId);
    if (!tribe) add(`persona ${p.id} appartiene alla tribù inesistente ${p.tribeId}`);
    else if (tribe.status === "extinct") add(`persona ${p.id} appartiene alla tribù estinta ${p.tribeId}`);
    if (p.settlementId) {
      const s = settlements.get(p.settlementId);
      if (!s) add(`persona ${p.id} vive nell'insediamento inesistente ${p.settlementId}`);
      else if (s.status !== "active")
        add(`persona ${p.id} vive nell'insediamento abbandonato ${p.settlementId}`);
      else if (s.tribeId !== p.tribeId)
        add(`persona ${p.id} vive in un insediamento di un'altra tribù (${s.tribeId})`);
    }
    // Children keep the id of the household they were born into even after it dissolves and
    // leaves the active state, so a dangling id is history, not corruption. What must hold is
    // that an active household a person points at is really theirs and still standing.
    const household = p.householdId ? households.get(p.householdId) : undefined;
    if (household) {
      if (household.dissolvedYear !== null && household.partnerIds.includes(p.id))
        add(`persona ${p.id} è partner del nucleo sciolto ${household.id}`);
    }
    if (p.dynastyId && !dynasties.has(p.dynastyId))
      add(`persona ${p.id} riferisce la dinastia inesistente ${p.dynastyId}`);
  }

  for (const p of state.archive.people) {
    if (p.alive) add(`la persona archiviata ${p.id} risulta viva`);
    if (p.deathYear === null || p.deathCause === null)
      add(`la persona archiviata ${p.id} non ha anno o causa di morte`);
    if (people.has(p.id)) add(`la persona ${p.id} è sia viva sia archiviata`);
  }

  // --- Tribes --------------------------------------------------------------
  for (const t of state.tribes) {
    if (!inBounds(state, t.x, t.y)) add(`tribù ${t.id} fuori mappa`);
    for (const kind of RESOURCES) {
      const value = getResourceAmount(t.stock, kind);
      finite(value, `tribù ${t.id} ${kind}`);
      if (value < 0) add(`tribù ${t.id} ha ${kind} negativo (${value})`);
    }
    if (t.leaderId) {
      const leader = people.get(t.leaderId);
      if (!leader) add(`tribù ${t.id} ha un leader inesistente (${t.leaderId})`);
      else if (leader.tribeId !== t.id) add(`il leader ${t.leaderId} non appartiene alla tribù ${t.id}`);
    }
    if (t.status === "extinct" && t.leaderId) add(`la tribù estinta ${t.id} ha ancora un leader`);
    // Technologies must have their prerequisites satisfied.
    for (const techId of t.techs) {
      const tech = TECH_BY_ID.get(techId);
      if (!tech) continue;
      for (const prerequisite of tech.prerequisites) {
        if (!t.techs.includes(prerequisite))
          add(`tribù ${t.id}: ${techId} senza il prerequisito ${prerequisite}`);
      }
    }
    for (const [techId, adoption] of Object.entries(t.techAdoption)) {
      if (!Number.isFinite(adoption) || adoption < 0 || adoption > 1)
        add(`tribù ${t.id}: adozione fuori range per ${techId} (${adoption})`);
    }
    for (const [key, value] of Object.entries(t.stability)) {
      finite(value, `tribù ${t.id} stability.${key}`);
      if (key !== "unrestYears" && (value < 0 || value > 1))
        add(`tribù ${t.id}: stability.${key} fuori range (${value})`);
    }
    for (const [key, value] of Object.entries(t.culture)) {
      if (value < 0 || value > 100) add(`tribù ${t.id}: cultura ${key} fuori range (${value})`);
    }
    if (t.civilizationId && !state.civilizations.some((c) => c.id === t.civilizationId))
      add(`tribù ${t.id} riferisce la civiltà inesistente ${t.civilizationId}`);
  }

  // --- Settlements ---------------------------------------------------------
  for (const s of state.settlements) {
    if (!inBounds(state, s.x, s.y)) add(`insediamento ${s.id} fuori mappa`);
    if (!tribes.has(s.tribeId)) add(`insediamento ${s.id} appartiene alla tribù inesistente ${s.tribeId}`);
    if (s.population < 0) add(`insediamento ${s.id} con popolazione negativa`);
    for (const kind of RESOURCES) {
      const value = getResourceAmount(s.stock, kind);
      finite(value, `insediamento ${s.id} ${kind}`);
      if (value < 0) add(`insediamento ${s.id} ha ${kind} negativo`);
    }
    for (const [type, count] of Object.entries(s.buildings)) {
      if (!Number.isFinite(count) || count < 0)
        add(`insediamento ${s.id}: edifici ${type} non validi (${count})`);
    }
    const project = s.construction;
    if (project) {
      if (project.settlementId !== s.id)
        add(`il cantiere di ${s.id} riferisce un altro insediamento (${project.settlementId})`);
      if (project.laborRequired <= 0) add(`il cantiere di ${s.id} non richiede lavoro`);
      if (project.laborCompleted < 0) add(`il cantiere di ${s.id} ha lavoro negativo`);
      if (project.targetId && !settlements.has(project.targetId))
        add(`il cantiere di ${s.id} punta a un insediamento inesistente (${project.targetId})`);
    }
    if (s.status === "abandoned" && s.population > 0)
      add(`insediamento abbandonato ${s.id} con ${s.population} abitanti`);
  }

  // --- Households and relationships ----------------------------------------
  for (const h of state.households) {
    if (h.partnerIds[0] === h.partnerIds[1]) add(`nucleo ${h.id} con lo stesso partner due volte`);
    for (const id of h.partnerIds) {
      const partner = people.get(id);
      if (!partner && !state.archive.people.some((p) => p.id === id))
        add(`nucleo ${h.id} riferisce la persona inesistente ${id}`);
    }
  }

  const seen = new Set<string>();
  for (const rel of state.relationships) {
    if (seen.has(rel.id)) add(`relazione duplicata ${rel.id}`);
    seen.add(rel.id);
    if (rel.aId === rel.bId) add(`relazione ${rel.id} tra una tribù e sé stessa`);
    if (!tribes.has(rel.aId) || !tribes.has(rel.bId))
      add(`relazione ${rel.id} riferisce una tribù inesistente`);
    for (const [key, value] of [
      ["trust", rel.trust],
      ["hostility", rel.hostility],
      ["respect", rel.respect],
      ["conflictMemory", rel.conflictMemory],
      ["culturalDistance", rel.culturalDistance],
      ["tradeDependency", rel.tradeDependency],
    ] as const) {
      finite(value, `relazione ${rel.id} ${key}`);
      if (value < 0 || value > 1) add(`relazione ${rel.id}: ${key} fuori range (${value})`);
    }
    if (rel.atWar !== (rel.status === "war")) add(`relazione ${rel.id}: stato e flag di guerra incoerenti`);
    if (rel.atWar && rel.allied) add(`relazione ${rel.id}: alleata e in guerra contemporaneamente`);
  }

  // --- Historical identities ----------------------------------------------
  for (const problem of checkIdentityLineage(state)) add(problem);

  // --- Civilizations and dynasties ----------------------------------------
  for (const civ of state.civilizations) {
    if (civ.capitalSettlementId && !settlements.has(civ.capitalSettlementId))
      add(`civiltà ${civ.id} riferisce una capitale inesistente`);
  }
  for (const d of state.dynasties) {
    if (!tribes.has(d.tribeId) && d.endedYear === null)
      add(`dinastia attiva ${d.id} riferisce la tribù inesistente ${d.tribeId}`);
  }

  // --- Events --------------------------------------------------------------
  if (options.events) {
    for (const e of options.events) {
      if (e.x !== null && e.y !== null && !inBounds(state, e.x, e.y))
        add(`evento ${e.id} con coordinate fuori mappa`);
      if (e.importance < 1 || e.importance > 5) add(`evento ${e.id} con importanza fuori range`);
      if (options.knownIds) {
        for (const a of e.actors) {
          if (!options.knownIds.has(a.id)) add(`evento ${e.id} riferisce ${a.kind} inesistente ${a.id}`);
        }
      }
      // Causes may come from an earlier batch (a drought that started years ago), so they are
      // validated by shape and sequence rather than against the current window.
      for (const causeId of e.causeEventIds) {
        const match = /^e(\d+)$/.exec(causeId);
        if (!match) {
          add(`evento ${e.id} riferisce la causa malformata ${causeId}`);
          continue;
        }
        const seq = Number(match[1]);
        if (seq <= 0 || seq > state.counters.event)
          add(`evento ${e.id} riferisce la causa inesistente ${causeId}`);
        if (seq >= e.seq) add(`evento ${e.id} riferisce una causa successiva (${causeId})`);
      }
    }
  }

  return problems;
}

export class InvariantError extends Error {
  constructor(
    readonly problems: string[],
    tick: number,
  ) {
    super(`Invarianti violati al tick ${tick}:\n- ${problems.join("\n- ")}`);
    this.name = "InvariantError";
  }
}

export function assertInvariants(state: WorldState, options?: InvariantOptions) {
  const problems = checkInvariants(state, options);
  if (problems.length > 0) throw new InvariantError(problems, state.tick);
}
