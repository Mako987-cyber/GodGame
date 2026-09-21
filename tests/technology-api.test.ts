import { beforeAll, describe, expect, it } from "vitest";
import { TECHNOLOGIES } from "@genesis/simulation-core";
import type { Database } from "@/lib/db";
import { InMemorySimulationLock } from "@/lib/db/lock";
import {
  getCivilizationKnowledgeService,
  getCivilizationTechnologiesService,
  getDiscoverableTechnologiesService,
  getSettlementHistoryService,
  getTechnologyHistoryService,
  getWorldTechnologiesService,
} from "@/lib/services/technology-service";
import { createWorldService, simulateWorldService } from "@/lib/services/world-service";
import { AppError } from "@/lib/utils/errors";
import { createTestDb, QueryRecorder } from "./db-helpers";

let db: Database;
let recorder: QueryRecorder;
let worldId: string;
let civilizationId: string;

beforeAll(async () => {
  recorder = new QueryRecorder();
  ({ db } = await createTestDb({ logger: recorder }));
  const deps = { db, lock: new InMemorySimulationLock() };
  const world = await createWorldService({ name: "Tecnologie", seed: "api-tech" }, deps);
  worldId = world.id;
  // Long enough that somebody has actually discovered something.
  await simulateWorldService(worldId, 100, deps);
  await simulateWorldService(worldId, 100, deps);
  const catalogue = await getWorldTechnologiesService(worldId, { db });
  expect(catalogue.items.length).toBe(TECHNOLOGIES.length);
  const held = catalogue.items.find((i) => i.holders > 0);
  expect(held).toBeDefined();
  civilizationId = held!.pioneerCivilizationId!;
}, 120_000);

describe("catalogo del mondo", () => {
  it("elenca tutte le tecnologie e dice quante civiltà le hanno davvero", async () => {
    const page = await getWorldTechnologiesService(worldId, { db });
    expect(page.items).toHaveLength(TECHNOLOGIES.length);
    for (const item of page.items) {
      // A technology in the catalogue is never presented as something everybody has.
      expect(item.holders).toBeLessThanOrEqual(item.civilizations);
      expect(item.holders).toBeGreaterThanOrEqual(0);
      if (item.holders === 0) expect(item.pioneerCivilizationId).toBe(null);
      if (item.pioneerCivilizationId) expect(item.firstDiscoveredYear).not.toBeNull();
    }
    // At least one is held by some but not all: the point of the whole system.
    expect(page.items.some((i) => i.holders > 0 && i.holders < i.civilizations)).toBe(true);
  });

  it("rifiuta un mondo inesistente", async () => {
    await expect(
      getWorldTechnologiesService("11111111-1111-4111-8111-111111111111", { db }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("tecnologie di una civiltà", () => {
  it("restituisce stato, progresso e adozione con i conteggi per stato", async () => {
    const page = await getCivilizationTechnologiesService(
      worldId,
      civilizationId,
      { page: 1, pageSize: 100, status: undefined, category: undefined },
      { db },
    );
    expect(page.civilizationId).toBe(civilizationId);
    expect(page.total).toBe(TECHNOLOGIES.length);
    const counted = Object.values(page.counts).reduce((a, b) => a + b, 0);
    expect(counted).toBe(TECHNOLOGIES.length);
    for (const item of page.items) {
      expect(item.adoptionPercentage).toBeGreaterThanOrEqual(0);
      expect(item.adoptionPercentage).toBeLessThanOrEqual(100);
      expect(item.discoveryProgress).toBeGreaterThanOrEqual(0);
      expect(item.discoveryProgress).toBeLessThanOrEqual(1);
      // Something not held is not adopted, and something adopted has been discovered.
      if (item.status === "unknown" || item.status === "observed") {
        expect(item.adoptionPercentage).toBe(0);
      }
      if (item.adoptionPercentage > 0) expect(item.discoveredYear).not.toBeNull();
    }
  });

  it("filtra per stato e per categoria, e pagina", async () => {
    const adopted = await getCivilizationTechnologiesService(
      worldId,
      civilizationId,
      { page: 1, pageSize: 50, status: ["adopted"], category: undefined },
      { db },
    );
    for (const item of adopted.items) expect(item.status).toBe("adopted");
    expect(adopted.total).toBe(adopted.counts.adopted ?? 0);

    const metals = await getCivilizationTechnologiesService(
      worldId,
      civilizationId,
      { page: 1, pageSize: 50, status: undefined, category: ["metals"] },
      { db },
    );
    for (const item of metals.items) expect(item.category).toBe("metals");

    const firstPage = await getCivilizationTechnologiesService(
      worldId,
      civilizationId,
      { page: 1, pageSize: 5, status: undefined, category: undefined },
      { db },
    );
    expect(firstPage.items).toHaveLength(5);
    expect(firstPage.totalPages).toBe(Math.ceil(TECHNOLOGIES.length / 5));
    const secondPage = await getCivilizationTechnologiesService(
      worldId,
      civilizationId,
      { page: 2, pageSize: 5, status: undefined, category: undefined },
      { db },
    );
    expect(secondPage.items[0]!.technologyId).not.toBe(firstPage.items[0]!.technologyId);
  });

  it("non interroga il database una volta per tecnologia", async () => {
    recorder.reset();
    await getCivilizationTechnologiesService(
      worldId,
      civilizationId,
      { page: 1, pageSize: 100, status: undefined, category: undefined },
      { db },
    );
    // World row, tribe row, discovery rows: a handful, not one per technology.
    expect(recorder.queries.length).toBeLessThan(10);
  });

  it("rifiuta una civiltà inesistente", async () => {
    await expect(
      getCivilizationTechnologiesService(
        worldId,
        "t9999",
        { page: 1, pageSize: 10, status: undefined, category: undefined },
        { db },
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("tecnologie raggiungibili", () => {
  it("mostra solo ciò che è davvero a portata, con quello che manca", async () => {
    const page = await getDiscoverableTechnologiesService(worldId, civilizationId, { db });
    expect(page.items.length).toBeLessThan(TECHNOLOGIES.length);
    const owned = await getCivilizationTechnologiesService(
      worldId,
      civilizationId,
      { page: 1, pageSize: 100, status: undefined, category: undefined },
      { db },
    );
    const held = new Set(owned.items.filter((i) => i.adoptionPercentage > 0).map((i) => i.technologyId));
    for (const item of page.items) {
      // Never what the people already has.
      expect(held.has(item.technologyId)).toBe(false);
      expect(item.affinity).toBeGreaterThanOrEqual(0);
      expect(item.affinity).toBeLessThanOrEqual(1);
      expect(item.weight).toBeGreaterThanOrEqual(0);
      if (!item.prerequisitesMet) expect(item.missingPrerequisites.length).toBeGreaterThan(0);
    }
    // Ordered by how likely the people is to get it next.
    const weights = page.items.map((i) => i.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });
});

describe("storia di una tecnologia", () => {
  it("dice chi l'ha scoperta per primo, chi l'ha presa e chi l'ha persa", async () => {
    const catalogue = await getWorldTechnologiesService(worldId, { db });
    const spread = catalogue.items.find((i) => i.holders > 1) ?? catalogue.items.find((i) => i.holders > 0);
    const history = await getTechnologyHistoryService(worldId, spread!.id, { db });
    expect(history.definition.id).toBe(spread!.id);
    expect(history.pioneer).not.toBeNull();
    expect(history.holders.length).toBeGreaterThan(0);
    // The pioneer is the earliest of the holders.
    const earliest = Math.min(...history.holders.map((h) => h.year));
    expect(history.pioneer!.year).toBe(earliest);
    if (history.holders.length > 1) expect(history.spreadYears).not.toBeNull();
    for (const event of history.events) expect(event.year).toBeLessThanOrEqual(10_000);
  });

  it("rifiuta una tecnologia che non esiste nel catalogo", async () => {
    await expect(getTechnologyHistoryService(worldId, "teletrasporto", { db })).rejects.toBeTruthy();
  });
});

describe("storia di un insediamento", () => {
  it("racconta fondazione, specializzazioni, picco e cronologia paginata", async () => {
    const { getWorldEntities } = await import("@/lib/db/queries");
    const entities = await getWorldEntities(db, worldId);
    const settlement = entities.settlements[0];
    if (!settlement) return;
    const history = await getSettlementHistoryService(
      worldId,
      settlement.id,
      { page: 1, pageSize: 10 },
      { db },
    );
    expect(history.settlementId).toBe(settlement.id);
    expect(history.history.foundingReasonLabel).toBeTruthy();
    expect(history.history.peakPopulation).toBeGreaterThanOrEqual(history.population);
    expect(history.history.peakYear).toBeGreaterThanOrEqual(history.foundedYear);
    expect(history.history.destructions).toBeGreaterThanOrEqual(history.history.reconstructions);
    expect(history.events.pageSize).toBe(10);
    expect(history.events.items.length).toBeLessThanOrEqual(10);
    // Only technologies actually in use are attributed to the place.
    for (const tech of history.technologies) expect(tech.adoptionPercentage).toBeGreaterThan(0);
  });

  it("rifiuta un insediamento inesistente", async () => {
    await expect(
      getSettlementHistoryService(worldId, "s9999", { page: 1, pageSize: 10 }, { db }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("conoscenza filtrata per osservatore", () => {
  it("restituisce solo stime, mai i valori reali dei bersagli", async () => {
    const { loadWorldState } = await import("@/lib/db/queries");
    const loaded = (await loadWorldState(db, worldId))!;
    const withRecords = loaded.state.knowledge.find((k) => k.population !== null);
    if (!withRecords) return;
    const page = await getCivilizationKnowledgeService(worldId, withRecords.observerId, { db });
    const records = loaded.state.knowledge.filter((k) => k.observerId === withRecords.observerId);
    // Exactly the peoples this observer has met, no others.
    expect(page.items.map((i) => i.targetId).sort()).toEqual(records.map((k) => k.targetId).sort());
    for (const item of page.items) {
      const record = records.find((k) => k.targetId === item.targetId)!;
      // Every number comes from the observer's record, whatever the truth is.
      expect(item.population).toEqual(record.population);
      expect(item.military).toEqual(record.military);
      expect(item.stability).toEqual(record.stability);
      expect(item.technologies?.ids ?? null).toEqual(record.technologies?.ids ?? null);
    }
  });

  it("le tecnologie viste nei vicini vengono dalla conoscenza, non dalla realtà", async () => {
    const { loadWorldState } = await import("@/lib/db/queries");
    const loaded = (await loadWorldState(db, worldId))!;
    const page = await getDiscoverableTechnologiesService(worldId, civilizationId, { db });
    const seen = loaded.state.knowledge.filter((k) => k.observerId === civilizationId);
    const nameOf = new Map(loaded.state.tribes.map((t) => [t.id, t.name]));
    for (const item of page.items) {
      const expected = seen
        .filter((k) => k.technologies?.ids.includes(item.technologyId))
        .map((k) => nameOf.get(k.targetId));
      expect(item.knownByNeighbours.sort()).toEqual(expected.sort());
    }
  });

  it("rifiuta un osservatore inesistente", async () => {
    await expect(getCivilizationKnowledgeService(worldId, "t9999", { db })).rejects.toBeInstanceOf(AppError);
  });
});
