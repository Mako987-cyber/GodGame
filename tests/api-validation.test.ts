import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createWorld } from "@/app/api/worlds/route";
import { POST as simulate } from "@/app/api/worlds/[worldId]/simulate/route";
import { GET as events } from "@/app/api/worlds/[worldId]/events/route";
import { GET as stats } from "@/app/api/worlds/[worldId]/stats/route";
import { GET as person } from "@/app/api/worlds/[worldId]/people/[personId]/route";
import { GET as cron } from "@/app/api/cron/advance/route";
import { PATCH as patchWorld } from "@/app/api/worlds/[worldId]/route";
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

describe("nuovi endpoint e filtri", () => {
  it("valida i filtri della cronaca", async () => {
    const ok = await events(
      new Request(
        `http://test/api/worlds/${worldId}/events?fromYear=-10000&toYear=-9900&search=anno&minImportance=2`,
      ),
      ctx(worldId),
    );
    expect(ok.status).toBe(200);

    const badYear = await events(
      new Request(`http://test/api/worlds/${worldId}/events?fromYear=abc`),
      ctx(worldId),
    );
    expect(badYear.status).toBe(400);

    const badActor = await events(
      new Request(`http://test/api/worlds/${worldId}/events?actorId=' OR 1=1--`),
      ctx(worldId),
    );
    expect(badActor.status).toBe(400);

    const tooBig = await events(
      new Request(`http://test/api/worlds/${worldId}/events?pageSize=5000`),
      ctx(worldId),
    );
    expect(tooBig.status).toBe(400);
  });

  it("espone le statistiche con la serie per civiltà", async () => {
    const res = await stats(
      new Request(`http://test/api/worlds/${worldId}/stats?maxPoints=50&civilizations=true`),
      ctx(worldId),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { world: unknown[]; civilizations: unknown[] } };
    expect(Array.isArray(body.data.world)).toBe(true);
    expect(Array.isArray(body.data.civilizations)).toBe(true);

    const invalid = await stats(
      new Request(`http://test/api/worlds/${worldId}/stats?maxPoints=99999`),
      ctx(worldId),
    );
    expect(invalid.status).toBe(400);
  });

  it("valida l'identificativo della persona", async () => {
    const bad = await person(new Request("http://test/x"), {
      params: Promise.resolve({ worldId, personId: "non-valido" }),
    });
    expect(bad.status).toBe(404);

    const missing = await person(new Request("http://test/x"), {
      params: Promise.resolve({ worldId, personId: "p999999" }),
    });
    expect(missing.status).toBe(404);
  });

  it("il cron non è accessibile senza segreto", async () => {
    const res = await cron(new Request("http://test/api/cron/advance"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("non espone stack trace negli errori", async () => {
    const res = await simulate(post(`http://test/api/worlds/${worldId}/simulate`, "{oops"), ctx(worldId));
    const text = await res.text();
    expect(text).not.toContain("at ");
    expect(text).not.toContain("node_modules");
  });
});

describe("modalità autonoma opzionale", () => {
  it("il cron avanza solo i mondi in stato running quando il segreto è corretto", async () => {
    process.env.CRON_SECRET = "segreto-di-prova";
    process.env.CRON_TICKS_PER_WORLD = "1";
    try {
      const unauthorized = await cron(
        new Request("http://test/api/cron/advance", { headers: { authorization: "Bearer sbagliato" } }),
      );
      expect(unauthorized.status).toBe(401);

      // No world is "running": the cron runs, finds nothing and does not fail.
      const idle = await cron(
        new Request("http://test/api/cron/advance", {
          headers: { authorization: "Bearer segreto-di-prova" },
        }),
      );
      expect(idle.status).toBe(200);
      expect(((await idle.json()) as { data: { advanced: unknown[] } }).data.advanced).toEqual([]);

      await patchWorld(
        new Request(`http://test/api/worlds/${worldId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "running" }),
          headers: { "content-type": "application/json" },
        }),
        ctx(worldId),
      );
      const res = await cron(
        new Request("http://test/api/cron/advance", {
          headers: { authorization: "Bearer segreto-di-prova" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { advanced: { worldId: string; ok: boolean }[] } };
      expect(body.data.advanced).toHaveLength(1);
      expect(body.data.advanced[0]).toMatchObject({ worldId, ok: true });
    } finally {
      delete process.env.CRON_SECRET;
      delete process.env.CRON_TICKS_PER_WORLD;
      await patchWorld(
        new Request(`http://test/api/worlds/${worldId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "paused" }),
          headers: { "content-type": "application/json" },
        }),
        ctx(worldId),
      );
    }
  });
});
