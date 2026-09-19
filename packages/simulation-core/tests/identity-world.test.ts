import { describe, expect, it } from "vitest";
import {
  checkInvariants,
  createWorld,
  distance,
  hashWorld,
  HISTORICAL_IDENTITIES,
  parseRosterConfig,
  resolveRosterIdentities,
  runSimulation,
  STARTING_CIVILIZATION_STATE,
  type WorldState,
} from "../src/index";

const historical = (seed: string, roster: Parameters<typeof createWorld>[0]["roster"], size = 48) =>
  createWorld({ seed, width: size, height: size, roster });

function founders(state: WorldState) {
  const ids = new Set(state.roster?.entries.map((e) => e.tribeId));
  return state.tribes.filter((t) => ids.has(t.id));
}

describe("roster e creazione del mondo", () => {
  it("stesso seed → stesso roster, colori, leader iniziali e posizioni", () => {
    const a = historical("roster-det", { mode: "random-real", civilizationCount: 6 });
    const b = historical("roster-det", { mode: "random-real", civilizationCount: 6 });
    expect(a.roster).toEqual(b.roster);
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(a.people.map((p) => p.name)).toEqual(b.people.map((p) => p.name));
  });

  it("seed diversi scelgono roster diversi", () => {
    const rosters = new Set(
      ["uno", "due", "tre", "quattro", "cinque"].map((seed) =>
        historical(seed, { mode: "random-real", civilizationCount: 5 })
          .roster!.entries.map((e) => e.identityId)
          .sort()
          .join(","),
      ),
    );
    expect(rosters.size).toBeGreaterThan(1);
  });

  it("il roster selezionato contiene esattamente le identità scelte, in qualsiasi ordine", () => {
    const keys = ["egyptian", "roman", "maya", "chinese", "persian", "inca"];
    const a = historical("selezione", { mode: "selected", identityKeys: keys });
    const b = historical("selezione", { mode: "selected", identityKeys: [...keys].reverse() });
    expect(a.roster!.entries.map((e) => e.identityId).sort()).toEqual([...keys].sort());
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(a.tribes.map((t) => t.name).sort()).toEqual(
      ["Cinesi", "Egizi", "Inca", "Maya", "Persiani", "Romani"].sort(),
    );
  });

  it("roster personalizzato: le scelte più un completamento casuale senza duplicati", () => {
    const state = historical("custom", {
      mode: "custom",
      identityKeys: ["greek", "norse"],
      civilizationCount: 5,
    });
    const ids = state.roster!.entries.map((e) => e.identityId);
    expect(ids).toHaveLength(5);
    expect(ids).toEqual(expect.arrayContaining(["greek", "norse"]));
    expect(new Set(ids).size).toBe(5);
  });

  it("i duplicati vengono rifiutati se non consentiti, e hanno nomi distinti se consentiti", () => {
    expect(() => parseRosterConfig({ mode: "selected", identityKeys: ["roman", "roman"] })).toThrow();
    expect(() => parseRosterConfig({ mode: "selected", identityKeys: ["atlantidei", "roman"] })).toThrow();
    const state = historical("duplicati", {
      mode: "selected",
      identityKeys: ["roman", "roman", "greek"],
      allowDuplicateCulturalIdentity: true,
    });
    const names = state.tribes.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => n.startsWith("Romani"))).toHaveLength(2);
  });

  it("tutte le civiltà partono dallo stesso livello: tecnologia, governo, popolazione, cibo", () => {
    for (const identityKeys of [
      HISTORICAL_IDENTITIES.slice(0, 8).map((i) => i.key),
      HISTORICAL_IDENTITIES.slice(8, 16).map((i) => i.key),
    ]) {
      const state = historical("parita", { mode: "selected", identityKeys }, 64);
      const tribes = founders(state);
      expect(tribes).toHaveLength(identityKeys.length);
      const sizes = new Set(tribes.map((t) => state.people.filter((p) => p.tribeId === t.id).length));
      expect(sizes.size).toBe(1);
      for (const t of tribes) {
        expect(t.techs).toEqual([...STARTING_CIVILIZATION_STATE.technologies]);
        expect(t.government).toBe("clan");
        expect(t.status).toBe("nomadic");
        expect(t.civilizationId).toBeNull();
        expect(t.stock.food).toBe(tribes[0]!.stock.food);
        expect(t.stock.wood + t.stock.stone + t.stock.copper).toBe(0);
        expect(t.identityType).toBe("historical");
      }
      expect(state.settlements).toHaveLength(0);
    }
  });

  it("i leader iniziali sono persone procedurali della propria tribù, mai figure storiche", () => {
    const state = historical("leader", { mode: "all-real" }, 64);
    const reserved = new Set(
      HISTORICAL_IDENTITIES.flatMap((i) => i.namingProfile.reservedNames.map((n) => n.toLowerCase())),
    );
    for (const entry of state.roster!.entries) {
      const leader = state.people.find((p) => p.id === entry.initialLeaderId);
      expect(leader, entry.identityId).toBeDefined();
      expect(leader!.tribeId).toBe(entry.tribeId);
      expect(leader!.title).toBe("chief");
      expect(reserved.has(leader!.name.toLowerCase())).toBe(false);
    }
  });

  it("il posizionamento bilanciato garantisce acqua, qualità comparabile e distanza minima", () => {
    for (const seed of ["bil-1", "bil-2", "bil-3", "bil-4"]) {
      const state = historical(seed, { mode: "random-real", civilizationCount: 6, balancedPlacement: true });
      const entries = state.roster!.entries;
      const qualities = entries.map((e) => e.startQuality);
      expect(Math.max(...qualities) - Math.min(...qualities), seed).toBeLessThanOrEqual(0.18 + 1e-9);
      expect(
        entries.every((e) => e.startWater),
        seed,
      ).toBe(true);
      for (const a of entries)
        for (const b of entries)
          if (a !== b) expect(distance(a.startX, a.startY, b.startX, b.startY)).toBeGreaterThanOrEqual(3);
    }
  });

  it("il posto di partenza non dipende dall'identità: nessuna regione storica", () => {
    const a = historical("slot", { mode: "selected", identityKeys: ["egyptian", "roman", "maya", "norse"] });
    const b = historical("slot", { mode: "selected", identityKeys: ["inca", "chinese", "celtic", "greek"] });
    const pos = (s: WorldState) => s.roster!.entries.map((e) => `${e.startX},${e.startY}`);
    expect(pos(a)).toEqual(pos(b));
    // The slot permutation is the same whatever identities fill it.
    const cfg = parseRosterConfig({ mode: "selected", identityKeys: ["egyptian", "roman", "maya", "norse"] });
    expect(resolveRosterIdentities("slot", cfg).map((i) => i.key)).toEqual(
      a.roster!.entries.map((e) => e.identityId),
    );
  });

  it("la modalità procedurale riproduce esattamente i mondi classici", () => {
    const classic = createWorld({ seed: "classico" });
    const procedural = createWorld({ seed: "classico", roster: { mode: "procedural" } });
    expect(hashWorld(procedural)).toBe(hashWorld(classic));
    expect(classic.roster).toBeNull();
    expect(classic.tribes.every((t) => t.identityId === null && t.identityType === "procedural")).toBe(true);
    expect(classic.tribes.every((t) => t.techs.length === 0)).toBe(true);
  });

  it("i modificatori spostano la cultura di poco e solo se attivi", () => {
    const keys = ["egyptian", "phoenician", "inca", "greek"];
    const on = historical("mod", { mode: "selected", identityKeys: keys, enableIdentityModifiers: true });
    const off = historical("mod", { mode: "selected", identityKeys: keys, enableIdentityModifiers: false });
    for (let i = 0; i < on.tribes.length; i++) {
      const a = on.tribes[i]!.culture;
      const b = off.tribes[i]!.culture;
      const identity = HISTORICAL_IDENTITIES.find((x) => x.key === on.tribes[i]!.identityId)!;
      let total = 0;
      for (const key of Object.keys(a) as (keyof typeof a)[]) {
        const delta = a[key] - b[key];
        expect(Math.abs(delta)).toBeLessThanOrEqual(5);
        total += delta;
      }
      expect(Math.abs(total)).toBeLessThanOrEqual(1 + identity.behavioralModifiers.length);
    }
  });
});

describe("determinismo e neutralità dell'identità", () => {
  it("stesso seed + stessi tick → stessa storia generata", () => {
    const a = historical("storia", { mode: "random-real", civilizationCount: 5 });
    const b = historical("storia", { mode: "random-real", civilizationCount: 5 });
    const ra = runSimulation(a, 120);
    const rb = runSimulation(b, 120);
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(ra.events.map((e) => e.title)).toEqual(rb.events.map((e) => e.title));
  });

  it("a modificatori spenti il nome non conferisce alcun vantaggio: storie identiche per slot", () => {
    const base = { mode: "selected" as const, enableIdentityModifiers: false };
    const a = historical("neutro", {
      ...base,
      identityKeys: ["egyptian", "roman", "maya", "norse", "chinese"],
    });
    const b = historical("neutro", {
      ...base,
      identityKeys: ["inca", "greek", "celtic", "korean", "persian"],
    });
    runSimulation(a, 100);
    runSimulation(b, 100);
    const outcome = (s: WorldState) =>
      s.roster!.entries.map((e) => {
        const tribe = s.tribes.find((t) => t.id === e.tribeId)!;
        return {
          slot: e.slot,
          status: tribe.status,
          population: s.people.filter((p) => p.tribeId === tribe.id).length,
          techs: [...tribe.techs].sort(),
          settlements: s.settlements.filter((x) => x.tribeId === tribe.id && x.status === "active").length,
          government: tribe.government,
        };
      });
    expect(outcome(a)).toEqual(outcome(b));
    expect(a.tribes.length).toBe(b.tribes.length);
    expect(a.counters).toEqual(b.counters);
  });

  it("nessuna identità riceve tecnologie extra: le scoperte arrivano solo dal motore", () => {
    const state = historical("tecnologie", { mode: "all-real" }, 64);
    const result = runSimulation(state, 60);
    const discovered = new Map<string, Set<string>>();
    for (const e of result.events) {
      if (e.type !== "tech_discovered") continue;
      const tribeId = e.actors.find((a) => a.kind === "tribe")?.id ?? "";
      discovered.set(tribeId, (discovered.get(tribeId) ?? new Set()).add(String(e.metadata.techId)));
    }
    for (const tribe of state.tribes) {
      const allowed = new Set([
        ...STARTING_CIVILIZATION_STATE.technologies,
        ...(discovered.get(tribe.id) ?? []),
      ]);
      // Successors inherit their parent's knowledge: walk up the lineage.
      let parent = tribe.parentTribeId ? state.tribes.find((t) => t.id === tribe.parentTribeId) : undefined;
      while (parent) {
        for (const techId of parent.techs) allowed.add(techId);
        for (const techId of discovered.get(parent.id) ?? []) allowed.add(techId);
        parent = parent.parentTribeId ? state.tribes.find((t) => t.id === parent!.parentTribeId) : undefined;
      }
      for (const techId of tribe.techs) expect(allowed.has(techId), `${tribe.name}: ${techId}`).toBe(true);
    }
  });

  it("le invarianti di identità reggono per 150 tick con controllo a ogni tick", () => {
    const state = historical("invarianti-identita", { mode: "random-real", civilizationCount: 8 }, 64);
    runSimulation(state, 150, { checkInvariants: true });
    expect(checkInvariants(state)).toEqual([]);
  });
});
