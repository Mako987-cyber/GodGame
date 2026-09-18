import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createWorld } from "@/app/api/worlds/route";
import { POST as simulate } from "@/app/api/worlds/[worldId]/simulate/route";
import { GET as events } from "@/app/api/worlds/[worldId]/events/route";
import { setDbForTesting } from "@/lib/db";
import { simulateSchema } from "@/lib/validation/world";
import { createTestDb } from "./db-helpers";

let close: () => Promise<void>;
let worldId: string;

const ctx = (id: string) => ({ params: Promise.resolve({ worldId: id }) });
const post = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeAll(async () => {
  const test = await createTestDb();
  close = test.close;
  setDbForTesting(test.db);
  const res = await createWorld(post("http://test/api/worlds", { name: "API", seed: "api" }));
  expect(res.status).toBe(201);
  worldId = ((await res.json()) as { data: { worldId: string } }).data.worldId;
});
afterAll(async () => {
  setDbForTesting(null);
  await close();
});

describe("validazione API", () => {
  it("lo schema accetta solo 1, 10, 50, 100 tick", () => {
    for (const ticks of [1, 10, 50, 100]) expect(simulateSchema.safeParse({ ticks }).success).toBe(true);
    for (const ticks of [0, 2, 7, 99, 101, 1000, -1, 1.5])
      expect(simulateSchema.safeParse({ ticks }).success).toBe(false);
    expect(simulateSchema.safeParse({ ticks: "10" }).success).toBe(false);
    expect(simulateSchema.safeParse({}).success).toBe(false);
  });

  it("rifiuta tick non consentiti con 400 TICKS_NOT_ALLOWED", async () => {
    const res = await simulate(
      post(`http://test/api/worlds/${worldId}/simulate`, { ticks: 7 }),
      ctx(worldId),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("TICKS_NOT_ALLOWED");
  });

  it("rifiuta JSON non valido", async () => {
    const res = await simulate(post(`http://test/api/worlds/${worldId}/simulate`, "{non json"), ctx(worldId));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_INPUT");
  });

  it("restituisce 404 per mondi inesistenti o id non validi", async () => {
    const missing = crypto.randomUUID();
    const res = await simulate(
      post(`http://test/api/worlds/${missing}/simulate`, { ticks: 10 }),
      ctx(missing),
    );
    expect(res.status).toBe(404);
    const bad = await simulate(post("http://test/api/worlds/abc/simulate", { ticks: 10 }), ctx("abc"));
    expect(bad.status).toBe(404);
  });

  it("valida la creazione del mondo", async () => {
    const res = await createWorld(post("http://test/api/worlds", { name: "", width: 5000 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_INPUT");
  });

  it("simula e pagina gli eventi con filtri validati", async () => {
    const res = await simulate(
      post(`http://test/api/worlds/${worldId}/simulate`, { ticks: 10 }),
      ctx(worldId),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { ticksRun: number; toTick: number } };
    expect(body.data.ticksRun).toBe(10);
    expect(body.data.toTick).toBe(10);

    const ok = await events(
      new Request(`http://test/api/worlds/${worldId}/events?page=1&pageSize=10&minImportance=1`),
      ctx(worldId),
    );
    expect(ok.status).toBe(200);
    const invalid = await events(
      new Request(`http://test/api/worlds/${worldId}/events?type=inesistente`),
      ctx(worldId),
    );
    expect(invalid.status).toBe(400);
  });
});
