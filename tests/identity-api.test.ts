import { createWorld, hashWorld } from "@genesis/simulation-core";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listIdentities } from "@/app/api/historical-identities/route";
import { GET as getIdentity } from "@/app/api/historical-identities/[identityId]/route";
import { POST as createWorldRoute } from "@/app/api/worlds/route";
import { GET as listCivilizations } from "@/app/api/worlds/[worldId]/civilizations/route";
import { GET as getCivilization } from "@/app/api/worlds/[worldId]/civilizations/[civilizationId]/route";
import { GET as getHistory } from "@/app/api/worlds/[worldId]/civilizations/[civilizationId]/history/route";
import { setDbForTesting, type Database } from "@/lib/db";
import { InMemorySimulationLock } from "@/lib/db/lock";
import { loadWorldState } from "@/lib/db/queries";
import * as schema from "@/lib/db/schema";
import type {
  CivilizationHistoryDTO,
  IdentityDetailDTO,
  IdentityPageDTO,
  WorldCivilizationDetailDTO,
  WorldCivilizationListDTO,
} from "@/lib/dto";
import { getWorldDetailService, simulateWorldService } from "@/lib/services/world-service";
import { createTestDb } from "./db-helpers";

let db: Database;
let close: () => Promise<void>;
let worldId: string;
const KEYS = ["egyptian", "roman", "maya", "chinese"];

const post = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const get = (url: string) => new Request(url);
async function data<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}
const worldCtx = (id: string) => ({ params: Promise.resolve({ worldId: id }) });
const civCtx = (id: string, civilizationId: string) => ({
  params: Promise.resolve({ worldId: id, civilizationId }),
});

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  setDbForTesting(db);
  const res = await createWorldRoute(
    post("http://test/api/worlds", {
      name: "Roster",
      seed: "roster-db",
      width: 48,
      height: 48,
      roster: { mode: "selected", identityKeys: KEYS },
    }),
  );
  expect(res.status).toBe(201);
  worldId = (await data<{ worldId: string }>(res)).worldId;
});
afterAll(async () => {
  setDbForTesting(null);
  await close();
});

describe("catalogo via API", () => {
  it("elenca, filtra e cerca le identità (anche per alias, senza accenti)", async () => {
    const all = await data<IdentityPageDTO>(
      await listIdentities(get("http://test/api/historical-identities")),
    );
    expect(all.total).toBeGreaterThanOrEqual(12);
    const americas = await data<IdentityPageDTO>(
      await listIdentities(get("http://test/api/historical-identities?continent=americas")),
    );
    expect(americas.items.every((i) => i.continent === "americas")).toBe(true);
    const aztec = await data<IdentityPageDTO>(
      await listIdentities(get("http://test/api/historical-identities?search=aztechi")),
    );
    expect(aztec.items.map((i) => i.key)).toEqual(["mexica"]);
    const paged = await data<IdentityPageDTO>(
      await listIdentities(get("http://test/api/historical-identities?pageSize=5&page=2")),
    );
    expect(paged.items).toHaveLength(5);
    expect(paged.page).toBe(2);
  });

  it("il dettaglio mostra lo stato iniziale comune; chiavi ignote danno 404", async () => {
    const res = await getIdentity(get("http://test"), { params: Promise.resolve({ identityId: "roman" }) });
    const roman = await data<IdentityDetailDTO>(res);
    expect(roman.startingState).toEqual({
      technologies: ["stone_tools"],
      government: "clan",
      buildings: ["camp"],
    });
    const missing = await getIdentity(get("http://test"), {
      params: Promise.resolve({ identityId: "atlantidei" }),
    });
    expect(missing.status).toBe(404);
    const bad = await getIdentity(get("http://test"), { params: Promise.resolve({ identityId: "../etc" }) });
    expect(bad.status).toBe(404);
  });

  it("rifiuta roster non validi con 400", async () => {
    for (const roster of [
      { mode: "selected", identityKeys: ["atlantidei", "roman"] },
      { mode: "selected", identityKeys: ["roman", "roman"] },
      { mode: "selected", identityKeys: ["roman"] },
      { mode: "random-real", civilizationCount: 99 },
      { mode: "reconstruction" },
    ]) {
      const res = await createWorldRoute(post("http://test/api/worlds", { name: "X", roster }));
      expect(res.status, JSON.stringify(roster)).toBe(400);
    }
    const tooMany = await createWorldRoute(
      post("http://test/api/worlds", { name: "X", width: 24, height: 24, roster: { mode: "all-real" } }),
    );
    expect(tooMany.status).toBe(400);
    expect(((await tooMany.json()) as { error: { message: string } }).error.message).toMatch(
      /troppo piccola/,
    );
  });
});

describe("persistenza del roster", () => {
  it("il roster è salvato una volta sola: ricaricamenti e letture non lo rigenerano", async () => {
    const [row] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId));
    expect(row!.roster!.entries.map((e) => e.identityId).sort()).toEqual([...KEYS].sort());
    const first = await loadWorldState(db, worldId);
    const second = await loadWorldState(db, worldId);
    expect(hashWorld(first!.state)).toBe(hashWorld(second!.state));
    const a = await getWorldDetailService(worldId, { db });
    const b = await getWorldDetailService(worldId, { db });
    expect(a.roster).toEqual(b.roster);
    expect(a.tribes.map((t) => t.name)).toEqual(b.tribes.map((t) => t.name));
    // Same seed and roster in memory: same peoples, leaders and positions.
    const expected = createWorld({ seed: "roster-db", width: 48, height: 48, roster: row!.roster!.config });
    expect(first!.state.roster).toEqual(expected.roster);
  });

  it("identità, eventi e snapshot sopravvivono alla simulazione", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    await simulateWorldService(worldId, 100, deps);
    const loaded = await loadWorldState(db, worldId);
    const state = loaded!.state;
    for (const entry of state.roster!.entries) {
      const tribe = state.tribes.find((t) => t.id === entry.tribeId)!;
      expect(tribe.identityId).toBe(entry.identityId);
      expect(tribe.identityType).toBe("historical");
    }
    const tribeRows = await db.select().from(schema.tribes).where(eq(schema.tribes.worldId, worldId));
    expect(tribeRows.every((t) => t.identityType === "historical" && KEYS.includes(t.identityId ?? ""))).toBe(
      true,
    );
    const snapshot = await db
      .select()
      .from(schema.worldSnapshots)
      .where(and(eq(schema.worldSnapshots.worldId, worldId), eq(schema.worldSnapshots.tick, 0)));
    const snapState = (snapshot[0]!.state as { state: { roster: unknown; tribes: { identityId: string }[] } })
      .state;
    expect(snapState.roster).toEqual(state.roster);
    expect(snapState.tribes.map((t) => t.identityId).sort()).toEqual([...KEYS].sort());
    const civEvents = await db
      .select()
      .from(schema.historicalEvents)
      .where(
        and(
          eq(schema.historicalEvents.worldId, worldId),
          eq(schema.historicalEvents.type, "civilization_founded"),
        ),
      );
    for (const e of civEvents) {
      expect(typeof e.metadata.civilizationId).toBe("string");
      expect(KEYS).toContain(e.metadata.identityId);
    }
    const starting = await db
      .select()
      .from(schema.worldTechnologies)
      .where(
        and(eq(schema.worldTechnologies.worldId, worldId), eq(schema.worldTechnologies.method, "starting")),
      );
    expect(starting.map((r) => r.techId)).toEqual(KEYS.map(() => "stone_tools"));
  });
});

describe("civiltà del mondo via API", () => {
  it("elenca le civiltà con identità, stato e leader", async () => {
    const list = await data<WorldCivilizationListDTO>(
      await listCivilizations(get("http://test"), worldCtx(worldId)),
    );
    expect(list.historical).toBe(true);
    const founders = list.items.filter((c) => c.foundingMember);
    expect(founders.map((c) => c.identityId).sort()).toEqual([...KEYS].sort());
    for (const c of list.items) {
      expect(KEYS).toContain(c.identityId);
      if (c.leader) expect(c.leader.title.length).toBeGreaterThan(0);
      for (const successor of c.successorIds)
        expect(list.items.find((x) => x.id === successor)?.predecessorIds).toContain(c.id);
    }
  });

  it("la scheda dichiara che la storia reale non è applicata, e la cronologia è paginata", async () => {
    const list = await data<WorldCivilizationListDTO>(
      await listCivilizations(get("http://test"), worldCtx(worldId)),
    );
    const egizi = list.items.find((c) => c.identityId === "egyptian" && c.foundingMember)!;
    const detail = await data<WorldCivilizationDetailDTO>(
      await getCivilization(get("http://test"), civCtx(worldId, egizi.id)),
    );
    expect(detail.realHistoryApplied).toBe(false);
    expect(detail.identityUsedAsFlavour).toBe(true);
    expect(detail.identity?.displayName).toBe("Egizi");
    expect(detail.founding?.startingTechnologies).toEqual(["stone_tools"]);
    expect(detail.founding?.initialLeaderName).toBeTruthy();
    const history = await data<CivilizationHistoryDTO>(
      await getHistory(get("http://test/x?page=1&pageSize=5"), civCtx(worldId, egizi.id)),
    );
    expect(history.events.items.length).toBeLessThanOrEqual(5);
    expect(history.events.items.every((e) => e.actors.some((a) => a.id === egizi.id))).toBe(true);
    expect(history.discoveries[0]).toMatchObject({ techId: "stone_tools", method: "starting" });
  });

  it("id sconosciuti o malformati danno 404, senza creare nulla", async () => {
    expect((await getCivilization(get("http://test"), civCtx(worldId, "t999"))).status).toBe(404);
    expect((await getCivilization(get("http://test"), civCtx(worldId, "p1"))).status).toBe(404);
    expect((await getHistory(get("http://test"), civCtx(worldId, "t999"))).status).toBe(404);
    expect(
      (await listCivilizations(get("http://test"), worldCtx("00000000-0000-4000-8000-000000000000"))).status,
    ).toBe(404);
  });
});

describe("compatibilità con i mondi legacy nel database", () => {
  it("un mondo scritto prima delle identità resta legacy, si simula e non viene rinominato", async () => {
    const res = await createWorldRoute(
      post("http://test/api/worlds", { name: "Vecchio", seed: "vecchio", roster: { mode: "procedural" } }),
    );
    const id = (await data<{ worldId: string }>(res)).worldId;
    // Recreate what the migration leaves on old rows: column defaults, no roster.
    await db.update(schema.tribes).set({ identityType: "legacy" }).where(eq(schema.tribes.worldId, id));
    await db.update(schema.worlds).set({ roster: null }).where(eq(schema.worlds.id, id));
    const before = (await loadWorldState(db, id))!.state.tribes.map((t) => t.name);
    await simulateWorldService(id, 50, { db, lock: new InMemorySimulationLock() });
    const after = (await loadWorldState(db, id))!.state;
    expect(after.tribes.slice(0, before.length).map((t) => t.name)).toEqual(before);
    expect(after.tribes.slice(0, before.length).every((t) => t.identityType === "legacy")).toBe(true);
    expect(after.tribes.every((t) => t.identityId === null)).toBe(true);
    const list = await data<WorldCivilizationListDTO>(
      await listCivilizations(get("http://test"), worldCtx(id)),
    );
    expect(list.historical).toBe(false);
  });
});
