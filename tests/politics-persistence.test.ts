import {
  buildCommunities,
  createContext,
  createVassalage,
  fuse,
  parseRosterConfig,
  runSimulation,
  startOccupation,
} from "@genesis/simulation-core";
import { buildProfiles } from "../packages/simulation-core/src/diplomacy";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import { InMemorySimulationLock } from "@/lib/db/lock";
import { loadWorldState, persistSimulation } from "@/lib/db/queries";
import * as schema from "@/lib/db/schema";
import { boundedTransaction } from "@/lib/db/tx";
import { countWorldRows } from "@/lib/db/world-deletion";
import { listWorldCivilizationsService } from "@/lib/services/identity-service";
import {
  createWorldService,
  deleteWorldService,
  getEventsService,
  getWorldDetailService,
} from "@/lib/services/world-service";
import { deleteConfirmationPhrase } from "@/lib/validation/world";
import { createSettlement } from "../packages/simulation-core/src/settlements";
import { createTestDb } from "./db-helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

describe("vassallaggi e occupazioni nel database", () => {
  it("sono persistiti, ricaricati, esposti dall'API e cancellati con il mondo", async () => {
    const world = await createWorldService(
      {
        name: "Politica",
        seed: "politica-db",
        width: 48,
        roster: parseRosterConfig({ mode: "selected", identityKeys: ["roman", "celtic", "egyptian"] }),
      },
      { db, lock: new InMemorySimulationLock() },
    );
    const loaded = (await loadWorldState(db, world.id))!;
    const { state } = loaded;
    const by = (key: string) => state.tribes.find((t) => t.identityId === key)!;
    const ctx = createContext(state);
    buildCommunities(ctx);
    const celtic = by("celtic");
    const s = createSettlement(ctx, celtic, celtic.x, celtic.y);
    for (const p of state.people) if (p.tribeId === celtic.id) p.settlementId = s.id;
    buildCommunities(ctx);
    const vassalage = createVassalage(ctx, by("roman"), by("egyptian"))!;
    const occupation = startOccupation(ctx, by("roman"), celtic, s)!;
    expect(vassalage && occupation).toBeTruthy();
    const result = { ...runSimulation(state, 0), events: ctx.events };
    await boundedTransaction(db, (tx) => persistSimulation(tx, loaded, result));

    // Reloaded exactly.
    const again = (await loadWorldState(db, world.id))!;
    expect(again.state.vassalages).toEqual(state.vassalages);
    expect(again.state.occupations).toEqual(state.occupations);

    // Visible in the world detail, in the timeline and in the civilization statuses.
    const detail = await getWorldDetailService(world.id, { db });
    expect(detail.vassalages).toHaveLength(1);
    expect(detail.vassalages[0]).toMatchObject({
      diplomaticStatus: "active",
      vassalCivilizationId: by("egyptian").id,
    });
    expect(detail.occupations[0]).toMatchObject({ status: "active", occupiedSettlementId: s.id });
    const events = await getEventsService(
      world.id,
      { page: 1, pageSize: 25, type: ["vassalage", "occupation"] },
      { db },
    );
    expect(events.items.map((e) => e.type).sort()).toEqual(["occupation", "vassalage"]);
    const civs = await listWorldCivilizationsService(world.id, { db });
    expect(civs.items.find((c) => c.id === by("egyptian").id)?.status).toBe("vassal");
    expect(civs.items.find((c) => c.id === celtic.id)?.status).toBe("occupied");

    // Deleting the world removes them too.
    const done = await deleteWorldService(
      world.id,
      { confirmation: deleteConfirmationPhrase("Politica"), worldName: "Politica" },
      { db },
    );
    expect(done.completed).toBe(true);
    expect(done.deleted.vassal_relationships).toBe(1);
    expect(done.deleted.occupations).toBe(1);
    const left = await countWorldRows(db, world.id);
    expect(Object.values(left).reduce((a, b) => a + b, 0)).toBe(0);
    expect(
      await db
        .select()
        .from(schema.vassalRelationships)
        .where(eq(schema.vassalRelationships.worldId, world.id)),
    ).toEqual([]);
  });

  it("le identità composite sono persistite, uniche per mondo ed esposte con le identità sorgenti", async () => {
    const world = await createWorldService(
      {
        name: "Fusione",
        seed: "fusione-db",
        width: 48,
        roster: parseRosterConfig({ mode: "selected", identityKeys: ["roman", "celtic", "greek"] }),
      },
      { db, lock: new InMemorySimulationLock() },
    );
    const loaded = (await loadWorldState(db, world.id))!;
    const { state } = loaded;
    const by = (key: string) => state.tribes.find((t) => t.identityId === key)!;
    const ctx = createContext(state);
    buildCommunities(ctx);
    const profiles = buildProfiles(ctx);
    const rel = {
      id: `${by("roman").id}|${by("celtic").id}`,
      aId: by("roman").id,
      bId: by("celtic").id,
      trust: 0.9,
      hostility: 0,
      tradeVolume: 100,
      conflictMemory: 0,
      atWar: false,
      warStartYear: null,
      allied: true,
      distance: 3,
      lastInteractionYear: state.year,
      battles: 0,
      truceUntilYear: null,
      respect: 0.5,
      tradeDependency: 0.3,
      culturalDistance: 0.05,
      status: "allied" as const,
      phase: "peace" as const,
      lastConflictYear: null,
      phaseYears: 0,
      fusionYears: 40,
    };
    state.relationships.push(rel);
    const composite = fuse(ctx, profiles.get(by("roman").id)!, profiles.get(by("celtic").id)!, rel, [
      "test",
    ])!;
    expect(composite).toBeTruthy();
    const result = { ...runSimulation(state, 0), events: ctx.events };
    await boundedTransaction(db, (tx) => persistSimulation(tx, loaded, result));

    const again = (await loadWorldState(db, world.id))!;
    expect(again.state.composites).toEqual(state.composites);
    const detail = await getWorldDetailService(world.id, { db });
    expect(detail.composites).toHaveLength(1);
    // The larger people leads the compound name: "Romano-Celti" or "Celtico-Romani".
    const dto = detail.composites[0]!;
    expect([...dto.sourceIdentityIds].sort()).toEqual(["celtic", "roman"]);
    expect(dto.sourceNames).toEqual(dto.sourceIdentityIds.map((k) => (k === "roman" ? "Romani" : "Celti")));
    expect(dto.displayName).toBe(dto.sourceIdentityIds[0] === "roman" ? "Romano-Celti" : "Celtico-Romani");
    const fusedTribe = detail.tribes.find((t) => t.id === composite.civilizationId)!;
    expect(fusedTribe).toMatchObject({ identityType: "composite", name: dto.displayName });
    expect(fusedTribe.emblemKey).toBeTruthy();
    const civs = await listWorldCivilizationsService(world.id, { db });
    expect(civs.items.find((c) => c.id === by("roman").id)?.status).toBe("merged");
    expect(civs.items.find((c) => c.id === by("celtic").id)?.status).toBe("merged");
    expect(civs.items.find((c) => c.id === composite.civilizationId)?.identityType).toBe("composite");
    const events = await getEventsService(world.id, { page: 1, pageSize: 25, type: ["fusion"] }, { db });
    expect(events.items).toHaveLength(1);

    // The database itself refuses a second composite of the same set in the same world.
    const row = (
      await db
        .select()
        .from(schema.compositeIdentities)
        .where(eq(schema.compositeIdentities.worldId, world.id))
    )[0]!;
    await expect(
      db.insert(schema.compositeIdentities).values({ ...row, id: "ci99", seq: 99 }),
    ).rejects.toThrow();
  });
});
