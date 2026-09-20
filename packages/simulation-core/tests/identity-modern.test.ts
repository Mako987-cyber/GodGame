import { describe, expect, it } from "vitest";
import {
  articled,
  createWorld,
  HISTORICAL_IDENTITIES,
  IDENTITY_BY_KEY,
  IDENTITY_ERA_GROUPS,
  np,
  runSimulation,
  STARTING_CIVILIZATION_STATE,
  UNIFORM_START,
  type HistoricalEvent,
  type WorldState,
} from "../src/index";

const MODERN_KEYS = [
  "french",
  "english",
  "spanish",
  "portuguese",
  "italian",
  "german",
  "russian",
  "ottoman",
  "ethiopian",
  "american",
];

describe("identità dell'età moderna nel catalogo", () => {
  it("sono presenti, marcate come età moderna e mai come stati già formati", () => {
    for (const key of MODERN_KEYS) {
      const identity = IDENTITY_BY_KEY.get(key);
      expect(identity, key).toBeDefined();
      expect(IDENTITY_ERA_GROUPS.modern as readonly string[]).toContain(identity!.broadCategory);
      expect(identity!.representationNotes.toLowerCase()).toMatch(
        /sandbox|non (è )?uno stato|non sono lo stato/,
      );
      // No behavioural leaning: national stereotypes are not a game mechanic.
      expect(identity!.behavioralModifiers, key).toEqual([]);
    }
    // Cinesi, Indiani and Giapponesi were already in the catalog: one identity each, no duplicates.
    for (const name of ["Cinesi", "Indiani", "Giapponesi"])
      expect(HISTORICAL_IDENTITIES.filter((i) => i.displayName === name)).toHaveLength(1);
  });

  it("ogni identità, antica o moderna, dichiara la stessa identica partenza", () => {
    for (const identity of HISTORICAL_IDENTITIES) {
      expect(identity.uniformStart, identity.key).toEqual({
        defaultGovernment: "clan",
        startingTechnologies: ["stone_tools"],
        startingInfrastructure: ["camp"],
        startingPopulationRange: [15, 40],
      });
    }
    expect([...STARTING_CIVILIZATION_STATE.technologies]).toEqual([...UNIFORM_START.startingTechnologies]);
    expect(STARTING_CIVILIZATION_STATE.government).toBe(UNIFORM_START.defaultGovernment);
  });

  it("i filtri per epoca coprono tutto il catalogo", () => {
    const covered = new Set<string>(Object.values(IDENTITY_ERA_GROUPS).flat());
    for (const identity of HISTORICAL_IDENTITIES)
      expect(covered.has(identity.broadCategory), identity.key).toBe(true);
    const modern = HISTORICAL_IDENTITIES.filter((i) =>
      (IDENTITY_ERA_GROUPS.modern as readonly string[]).includes(i.broadCategory),
    );
    expect(modern.map((i) => i.key).sort()).toEqual([...MODERN_KEYS].sort());
  });

  it("il profilo linguistico è coerente con le regole degli articoli", () => {
    for (const identity of HISTORICAL_IDENTITIES) {
      const { language } = identity;
      expect(language.pluralNoun).toBe(identity.displayName);
      expect(language.collectiveName).toBe(articled(np(identity.displayName, "m", "pl")));
      expect(language.adjective).toBe(language.adjective.toLowerCase());
      expect(language.politicalNamePatterns.every((p) => p.includes("{form}"))).toBe(true);
    }
    expect(IDENTITY_BY_KEY.get("italian")!.language.collectiveName).toBe("gli Italiani");
    expect(IDENTITY_BY_KEY.get("german")!.language.collectiveName).toBe("i Tedeschi");
    expect(IDENTITY_BY_KEY.get("spanish")!.language.collectiveName).toBe("gli Spagnoli");
    expect(IDENTITY_BY_KEY.get("american")!.language.collectiveName).toBe("gli Statunitensi");
  });
});

describe("Italiani in un mondo preistorico", () => {
  const world = (seed: string) =>
    createWorld({
      seed,
      width: 48,
      height: 48,
      roster: { mode: "selected", identityKeys: ["italian", "egyptian", "celtic", "inca"] },
    });
  const italians = (state: WorldState) => state.tribes.find((t) => t.identityId === "italian")!;

  it("partono esattamente come gli altri: pietra, accampamento, clan, niente scrittura né agricoltura", () => {
    const state = world("preistoria-1");
    const it = italians(state);
    expect(it.name).toBe("Italiani");
    expect(it.techs).toEqual(["stone_tools"]);
    expect(it.techs).not.toContain("writing");
    expect(it.techs).not.toContain("agriculture");
    expect(it.government).toBe("clan");
    expect(it.status).toBe("nomadic");
    expect(it.civilizationId).toBeNull();
    expect(state.settlements).toHaveLength(0);
    // The only "infrastructure" is the band's camp, recorded as its home in the roster.
    const entry = state.roster!.entries.find((e) => e.identityId === "italian")!;
    expect(entry.homeName.length).toBeGreaterThan(1);
    // Nothing modern, nothing beyond the common start — and exactly the start of the others.
    for (const other of state.tribes) {
      expect(other.techs).toEqual(it.techs);
      expect(other.government).toBe(it.government);
      expect(state.people.filter((p) => p.tribeId === other.id).length).toBe(
        state.people.filter((p) => p.tribeId === it.id).length,
      );
      expect(other.stock.food).toBe(it.stock.food);
    }
    // The people know only what the band knows.
    for (const p of state.people.filter((p) => p.tribeId === it.id))
      expect(p.knowledge).toEqual(["stone_tools"]);
  });

  it("hanno un leader procedurale, mai un personaggio storico", () => {
    const state = world("preistoria-2");
    const it = italians(state);
    const leader = state.people.find((p) => p.id === it.leaderId)!;
    expect(leader).toBeDefined();
    expect(leader.tribeId).toBe(it.id);
    const reserved = IDENTITY_BY_KEY.get("italian")!.namingProfile.reservedNames.map((n) => n.toLowerCase());
    expect(reserved).not.toContain(leader.name.toLowerCase());
    expect(state.roster!.entries.find((e) => e.identityId === "italian")!.initialLeaderName).toBe(
      leader.name,
    );
  });

  it("sviluppano una storia propria: tecnologie solo da eventi, storie diverse con seed diversi", () => {
    const histories: string[] = [];
    for (const seed of ["preistoria-3", "preistoria-4"]) {
      const state = world(seed);
      const id = italians(state).id;
      const events: HistoricalEvent[] = [];
      for (let i = 0; i < 6; i++) events.push(...runSimulation(state, 25).events);
      const own = events.filter((e) => e.actors.some((a) => a.id === id));
      expect(own.length, seed).toBeGreaterThan(0);
      // Every technology beyond the start was discovered in-world and told by an event.
      const discovered = new Set(
        events
          .filter((e) => e.type === "tech_discovered" && e.actors[0]?.id === id)
          .map((e) => String(e.metadata.techId)),
      );
      const it = state.tribes.find((t) => t.id === id)!;
      for (const tech of it.techs)
        if (tech !== "stone_tools") expect(discovered.has(tech), `${seed}: ${tech}`).toBe(true);
      histories.push(own.map((e) => `${e.year}:${e.type}`).join("|"));
    }
    expect(histories[0]).not.toBe(histories[1]);
  });

  it("stesso seed, stessa storia (determinismo)", () => {
    const run = () => {
      const state = world("preistoria-5");
      return runSimulation(state, 60).events.map((e) => `${e.seq}:${e.type}:${e.title}`);
    };
    expect(run()).toEqual(run());
  });
});
