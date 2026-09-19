import { QueryClient } from "@tanstack/react-query";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db";
import { InMemorySimulationLock } from "@/lib/db/lock";
import type { EventDTO, WorldDetail, WorldListItem } from "@/lib/dto";
import { ApiError, queryKeys } from "@/lib/client/api";
import { computeHudStats, hudDeltas, trendOf } from "@/lib/client/hud";
import { buildNotifications, categoryOf, filterNotifications, unreadCount } from "@/lib/client/notifications";
import { useWorldUi } from "@/lib/client/store";
import {
  WORLDS_PATH,
  confirmationMatches,
  deleteWorldFlow,
  deletionErrorMessage,
  purgeWorldFromCache,
} from "@/lib/client/world-deletion";
import { buildIsometricMapViewModel, HexGrid } from "@/lib/map-renderer";
import {
  minimapToWorld,
  minimapTransform,
  viewportOnMinimap,
  worldToMinimap,
} from "@/lib/map-renderer/minimap";
import {
  createWorldService,
  getEventsService,
  getWorldDetailService,
  simulateWorldService,
} from "@/lib/services/world-service";
import { eventsQuerySchema } from "@/lib/validation/world";
import { createTestDb } from "./db-helpers";

let db: Database;
let close: () => Promise<void>;
let detail: WorldDetail;
let later: WorldDetail;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const lock = new InMemorySimulationLock();
  const w = await createWorldService({ name: "HUD", seed: "hud-test", width: 32 }, { db, lock });
  await simulateWorldService(w.id, 50, { db, lock });
  detail = await getWorldDetailService(w.id, { db });
  await simulateWorldService(w.id, 50, { db, lock });
  later = await getWorldDetailService(w.id, { db });
}, 120_000);
afterAll(async () => {
  await close();
});

describe("HUD strategico", () => {
  it("calcola gli indicatori dal payload del mondo", () => {
    const s = computeHudStats(detail);
    expect(s.population).toBe(detail.world.summary.population);
    expect(s.technologies).toBe(detail.world.summary.technologies);
    expect(s.food).toBeGreaterThanOrEqual(0);
    expect(s.water).toBeGreaterThanOrEqual(0);
    expect(s.water).toBeLessThanOrEqual(100);
    expect(s.stability).toBeGreaterThanOrEqual(0);
    expect(s.stability).toBeLessThanOrEqual(100);
    expect(s.wars).toBe(detail.relationships.filter((r) => r.atWar).length);
  });

  it("mostra le variazioni solo rispetto a un tick precedente", () => {
    const a = computeHudStats(detail);
    const b = computeHudStats(later);
    expect(hudDeltas(a, null)).toEqual({});
    expect(hudDeltas(a, a)).toEqual({});
    const d = hudDeltas(b, a);
    if (b.population !== a.population) expect(d.population).toBe(b.population - a.population);
  });

  it("surplus e deficit: per guerre e crisi la crescita è negativa", () => {
    expect(trendOf("food", 10)).toBe("surplus");
    expect(trendOf("food", -3)).toBe("deficit");
    expect(trendOf("wars", 1)).toBe("deficit");
    expect(trendOf("crises", -1)).toBe("surplus");
    expect(trendOf("population", undefined)).toBe("steady");
  });
});

const event = (over: Partial<EventDTO>): EventDTO => ({
  id: "e1",
  tick: 10,
  year: -9000,
  type: "settlement_founded",
  subtype: null,
  causeEventIds: [],
  importance: 3,
  actors: [{ kind: "settlement", id: "s1", name: "Namar" }],
  x: 4,
  y: 5,
  title: "Fondata Namar",
  description: "…",
  metadata: {},
  ...over,
});

describe("notifiche", () => {
  it("solo eventi importanti: niente nascite né battaglie minori", () => {
    expect(categoryOf({ type: "birth", importance: 5 })).toBeNull();
    expect(categoryOf({ type: "battle", importance: 2 })).toBeNull();
    expect(categoryOf({ type: "battle", importance: 3 })).toBe("war");
    expect(categoryOf({ type: "famine", importance: 2 })).toBe("famine");
    expect(categoryOf({ type: "epidemic", importance: 3 })).toBe("epidemic");
    expect(categoryOf({ type: "peace", importance: 3 })).toBe("peace");
  });

  it("deduplica per id e unisce eventi identici dello stesso anno", () => {
    const items = buildNotifications([
      event({ id: "e1" }),
      event({ id: "e1" }),
      event({ id: "e2", title: "Carestia", type: "famine" }),
      event({ id: "e3", title: "Carestia", type: "famine" }),
      event({ id: "e4", type: "birth" }),
    ]);
    expect(items.map((n) => n.id).sort()).toEqual(["e1", "e2"]);
    expect(items.find((n) => n.category === "famine")?.count).toBe(2);
  });

  it("ogni notifica è collegata a un'entità e a una cella", () => {
    const [n] = buildNotifications([event({})]);
    expect(n?.target).toEqual({ kind: "settlement", id: "s1" });
    expect(n?.cell).toEqual({ x: 4, y: 5 });
    const [war] = buildNotifications([
      event({
        id: "w",
        type: "conflict",
        actors: [
          { kind: "tribe", id: "t1", name: "A" },
          { kind: "tribe", id: "t2", name: "B" },
        ],
      }),
    ]);
    expect(war?.target).toEqual({ kind: "war", aId: "t1", bId: "t2" });
  });

  it("filtri per categoria e conteggio non lette", () => {
    const items = buildNotifications([
      event({ id: "a", tick: 5 }),
      event({ id: "b", tick: 12, type: "famine", title: "X" }),
    ]);
    expect(filterNotifications(items, new Set(["famine"]))).toHaveLength(1);
    expect(unreadCount(items, 10)).toBe(1);
    expect(unreadCount(items, 20)).toBe(0);
  });

  it("eventi reali di un mondo simulato: meno notifiche che eventi, tutte collegate", async () => {
    const page = await getEventsService(
      detail.world.id,
      eventsQuerySchema.parse({ page: 1, pageSize: 100 }),
      { db },
    );
    const items = buildNotifications(page.items);
    expect(items.length).toBeLessThanOrEqual(page.items.length);
    for (const n of items) expect(n.target ?? n.cell).not.toBeNull();
  });
});

describe("pannelli e selezione (store UI)", () => {
  beforeEach(() => useWorldUi.getState().reset());

  it("apertura e chiusura dei pannelli, uno alla volta", () => {
    const ui = useWorldUi.getState();
    ui.togglePanel("layers");
    expect(useWorldUi.getState().panel).toBe("layers");
    ui.togglePanel("legend");
    expect(useWorldUi.getState().panel).toBe("legend");
    ui.togglePanel("legend");
    expect(useWorldUi.getState().panel).toBeNull();
  });

  it("una nuova selezione riapre il pannello dettagli ridotto", () => {
    const ui = useWorldUi.getState();
    ui.select({ kind: "settlement", id: "s1" });
    ui.setDetailsCollapsed(true);
    expect(useWorldUi.getState().detailsCollapsed).toBe(true);
    ui.select({ kind: "cell", x: 1, y: 2 });
    expect(useWorldUi.getState().detailsCollapsed).toBe(false);
    ui.select(null);
    expect(useWorldUi.getState().selection).toBeNull();
  });

  it("i livelli (lenti) si attivano e disattivano singolarmente", () => {
    const before = useWorldUi.getState().mapLayers;
    useWorldUi.getState().toggleMapLayer("climate");
    const after = useWorldUi.getState().mapLayers;
    expect(after.climate).toBe(!before.climate);
    expect({ ...after, climate: before.climate }).toEqual(before);
  });

  it("minimappa e segnalazioni lette", () => {
    const ui = useWorldUi.getState();
    ui.setMinimap(false);
    expect(useWorldUi.getState().minimap).toBe(false);
    ui.markSeen(10);
    ui.markSeen(5);
    expect(useWorldUi.getState().seenTick).toBe(10);
  });
});

describe("minimappa", () => {
  it("conversioni mondo ↔ minimappa inverse e proporzioni mantenute", () => {
    const g = new HexGrid(40, 30);
    const t = minimapTransform(g.bounds(), 200);
    expect(t.width).toBe(200);
    expect(t.height).toBe(Math.round(g.bounds().height * (200 / g.bounds().width)));
    const p = g.center(17, 9);
    const back = minimapToWorld(t, worldToMinimap(t, p));
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it("il riquadro della vista resta dentro la minimappa", () => {
    const g = new HexGrid(40, 30);
    const t = minimapTransform(g.bounds(), 200);
    const r = viewportOnMinimap(t, { x: -500, y: -500, width: 1e5, height: 1e5 });
    expect(r).toEqual({ x: 0, y: 0, width: t.width, height: t.height });
  });

  it("usa il view model già caricato (nessuna query aggiuntiva)", () => {
    const vm = buildIsometricMapViewModel(detail);
    expect(vm.cells).toHaveLength(detail.world.width * detail.world.height);
    expect(vm.tribeIds).toEqual(detail.tribes.map((t) => t.id));
  });
});

describe("eliminazione dal client", () => {
  const world = { id: "w1", name: "Terra", status: "paused" as const };
  const item = { id: "w1" } as WorldListItem;
  const other = { id: "w2" } as WorldListItem;

  function seeded() {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.world("w1"), { any: 1 });
    qc.setQueryData([...queryKeys.events("w1"), { page: 1 }], { items: [] });
    qc.setQueryData(queryKeys.stats("w1"), { world: [] });
    qc.setQueryData(queryKeys.worlds, [item, other]);
    return qc;
  }

  it("il pulsante resta disabilitato finché il testo non coincide esattamente", () => {
    expect(confirmationMatches("Terra", "")).toBe(false);
    expect(confirmationMatches("Terra", "ELIMINA terra")).toBe(false);
    expect(confirmationMatches("Terra", "ELIMINA Terra ")).toBe(false);
    expect(confirmationMatches("Terra", "ELIMINA Terra")).toBe(true);
  });

  it("dopo il successo la cache del mondo è svuotata e la lista aggiornata", async () => {
    const qc = seeded();
    const client = {
      deleteWorld: vi.fn(async () => ({ worldId: "w1", name: "Terra", deleted: {}, total: 1 })),
      setStatus: vi.fn(),
    };
    await deleteWorldFlow(qc, world, "ELIMINA Terra", client as never);
    expect(client.deleteWorld).toHaveBeenCalledWith("w1", {
      confirmation: "ELIMINA Terra",
      worldName: "Terra",
    });
    expect(client.setStatus).not.toHaveBeenCalled();
    expect(qc.getQueryData(queryKeys.world("w1"))).toBeUndefined();
    expect(qc.getQueryData([...queryKeys.events("w1"), { page: 1 }])).toBeUndefined();
    expect(qc.getQueryData(queryKeys.stats("w1"))).toBeUndefined();
    expect(qc.getQueryData<WorldListItem[]>(queryKeys.worlds)).toEqual([other]);
    // The UI then redirects here.
    expect(WORLDS_PATH).toBe("/worlds");
  });

  it("un mondo in esecuzione viene messo in pausa prima dell'eliminazione", async () => {
    const qc = seeded();
    const calls: string[] = [];
    const client = {
      setStatus: vi.fn(async () => void calls.push("pause")),
      deleteWorld: vi.fn(async () => {
        calls.push("delete");
        return { worldId: "w1", name: "Terra", deleted: {}, total: 1 };
      }),
    };
    await deleteWorldFlow(qc, { ...world, status: "running" }, "ELIMINA Terra", client as never);
    expect(calls).toEqual(["pause", "delete"]);
  });

  it("un mondo già eliminato (404) conta come eliminato; gli altri errori no", async () => {
    const qc = seeded();
    const gone = {
      setStatus: vi.fn(),
      deleteWorld: vi.fn(async () => {
        throw new ApiError("NOT_FOUND", "Mondo non trovato", 404);
      }),
    };
    await expect(deleteWorldFlow(qc, world, "ELIMINA Terra", gone as never)).resolves.toBeNull();
    expect(qc.getQueryData(queryKeys.world("w1"))).toBeUndefined();

    const qc2 = seeded();
    const refused = {
      setStatus: vi.fn(),
      deleteWorld: vi.fn(async () => {
        throw new ApiError("CONFIRMATION_MISMATCH", "no", 422);
      }),
    };
    const err = await deleteWorldFlow(qc2, world, "ELIMINA Terra", refused as never).catch((e) => e);
    expect(deletionErrorMessage(err)).toMatch(/non corrisponde/);
    // Nothing was forgotten: the world still exists.
    expect(qc2.getQueryData(queryKeys.world("w1"))).toEqual({ any: 1 });
  });

  it("purgeWorldFromCache tocca solo il mondo indicato", async () => {
    const qc = seeded();
    qc.setQueryData(queryKeys.world("w2"), { keep: true });
    await purgeWorldFromCache(qc, "w1");
    expect(qc.getQueryData(queryKeys.world("w2"))).toEqual({ keep: true });
  });
});
