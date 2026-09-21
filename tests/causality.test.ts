import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import { InMemorySimulationLock } from "@/lib/db/lock";
import * as schema from "@/lib/db/schema";
import {
  MAX_CONSEQUENCES,
  MAX_DEPTH,
  MAX_NODES,
  getEventCausalityService,
} from "@/lib/services/causality-service";
import { createWorldService, simulateWorldService } from "@/lib/services/world-service";
import { AppError } from "@/lib/utils/errors";
import { createTestDb, QueryRecorder } from "./db-helpers";

let db: Database;
let recorder: QueryRecorder;
let worldId: string;

/** Writes a hand-built chain of events straight into the table. */
async function insertEvents(rows: { id: string; causes: string[] }[]) {
  await db.insert(schema.historicalEvents).values(
    rows.map((r, i) => ({
      worldId,
      id: r.id,
      seq: 100_000 + i,
      tick: i,
      year: -9000 + i,
      type: "culture",
      subtype: null,
      importance: 3,
      actors: [],
      causeEventIds: r.causes,
      x: null,
      y: null,
      title: `Evento ${r.id}`,
      description: "",
      metadata: {},
    })),
  );
}

beforeAll(async () => {
  recorder = new QueryRecorder();
  ({ db } = await createTestDb({ logger: recorder }));
  const world = await createWorldService(
    { name: "Causalità", seed: "causalita" },
    { db, lock: new InMemorySimulationLock() },
  );
  worldId = world.id;
}, 60_000);

describe("catena all'indietro", () => {
  it("risale di livello in livello, i più vicini per primi", async () => {
    // e9001 <- e9002 <- e9003 <- e9004: each caused by the previous one.
    await insertEvents([
      { id: "e9001", causes: [] },
      { id: "e9002", causes: ["e9001"] },
      { id: "e9003", causes: ["e9002"] },
      { id: "e9004", causes: ["e9003"] },
    ]);
    const chain = await getEventCausalityService(worldId, "e9004", { db });
    expect(chain.event.id).toBe("e9004");
    expect(chain.causes.map((c) => [c.event.id, c.depth])).toEqual([
      ["e9003", 1],
      ["e9002", 2],
      ["e9001", 3],
    ]);
    expect(chain.truncated).toBe(false);
  });

  it("si ferma a MAX_DEPTH e lo dichiara", async () => {
    const ids = Array.from({ length: MAX_DEPTH + 3 }, (_, i) => `e91${String(i).padStart(2, "0")}`);
    await insertEvents(ids.map((id, i) => ({ id, causes: i === 0 ? [] : [ids[i - 1]!] })));
    const chain = await getEventCausalityService(worldId, ids.at(-1)!, { db });
    expect(Math.max(...chain.causes.map((c) => c.depth))).toBe(MAX_DEPTH);
    expect(chain.truncated).toBe(true);
  });

  it("non gira in tondo su un ciclo", async () => {
    await insertEvents([
      { id: "e9201", causes: ["e9202"] },
      { id: "e9202", causes: ["e9201"] },
    ]);
    const chain = await getEventCausalityService(worldId, "e9201", { db });
    expect(chain.causes.map((c) => c.event.id)).toEqual(["e9202"]);
  });

  it("non supera MAX_NODES anche con molte cause per evento", async () => {
    const leaves = Array.from({ length: MAX_NODES + 10 }, (_, i) => `e93${String(i).padStart(3, "0")}`);
    await insertEvents([...leaves.map((id) => ({ id, causes: [] })), { id: "e9399", causes: leaves }]);
    const chain = await getEventCausalityService(worldId, "e9399", { db });
    expect(chain.causes.length).toBeLessThanOrEqual(MAX_NODES);
    expect(chain.truncated).toBe(true);
  });

  it("fa una query per livello, non una per evento", async () => {
    const leaves = Array.from({ length: 15 }, (_, i) => `e94${String(i).padStart(2, "0")}`);
    await insertEvents([...leaves.map((id) => ({ id, causes: [] })), { id: "e9499", causes: leaves }]);
    recorder.reset();
    await getEventCausalityService(worldId, "e9499", { db });
    // World row, root event, one level of causes, consequences.
    expect(recorder.queries.length).toBeLessThanOrEqual(5);
  });
});

describe("conseguenze", () => {
  it("elenca gli eventi che nominano questo come causa diretta", async () => {
    await insertEvents([
      { id: "e9501", causes: [] },
      { id: "e9502", causes: ["e9501"] },
      { id: "e9503", causes: ["e9501", "e9001"] },
      { id: "e9504", causes: ["e9502"] },
    ]);
    const chain = await getEventCausalityService(worldId, "e9501", { db });
    expect(chain.consequences.map((e) => e.id)).toEqual(["e9502", "e9503"]);
    // Only direct consequences: e9504 follows from e9502, not from e9501.
    expect(chain.consequences.some((e) => e.id === "e9504")).toBe(false);
    expect(chain.consequences.length).toBeLessThanOrEqual(MAX_CONSEQUENCES);
  });

  it("non confonde un id con un altro che lo contiene come prefisso", async () => {
    await insertEvents([
      { id: "e96", causes: [] },
      { id: "e9601", causes: ["e960"] },
    ]);
    const chain = await getEventCausalityService(worldId, "e96", { db });
    expect(chain.consequences).toEqual([]);
  });
});

describe("errori", () => {
  it("rifiuta un evento o un mondo inesistenti", async () => {
    await expect(getEventCausalityService(worldId, "e999999", { db })).rejects.toBeInstanceOf(AppError);
    await expect(
      getEventCausalityService("11111111-1111-4111-8111-111111111111", "e1", { db }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("in un mondo simulato", () => {
  it("ogni causa trovata esiste davvero ed è precedente all'evento", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    const world = await createWorldService({ name: "Catene", seed: "catene-reali" }, deps);
    await simulateWorldService(world.id, 100, deps);
    await simulateWorldService(world.id, 100, deps);
    const withCauses = await db
      .select()
      .from(schema.historicalEvents)
      .where(
        (await import("drizzle-orm")).sql`${schema.historicalEvents.worldId} = ${world.id}
        AND jsonb_array_length(${schema.historicalEvents.causeEventIds}) > 0`,
      )
      .limit(10);
    // The engine does link events: without any, this test would prove nothing.
    expect(withCauses.length).toBeGreaterThan(0);
    for (const row of withCauses) {
      const chain = await getEventCausalityService(world.id, row.id, { db });
      for (const { event } of chain.causes) expect(event.tick).toBeLessThanOrEqual(chain.event.tick);
      for (const consequence of chain.consequences) {
        expect(consequence.causeEventIds).toContain(row.id);
        expect(consequence.tick).toBeGreaterThanOrEqual(chain.event.tick);
      }
    }
  }, 120_000);
});
