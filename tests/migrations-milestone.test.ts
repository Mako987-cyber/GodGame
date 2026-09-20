import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const FOLDER = path.join(process.cwd(), "drizzle");

/** Applies one migration file the way the migrator does, statement by statement. */
async function apply(client: PGlite, tag: string) {
  const sql = await readFile(path.join(FOLDER, `${tag}.sql`), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) await client.exec(trimmed);
  }
}

/**
 * Every migration of this milestone must be safe on a database that already holds worlds: it
 * adds columns with defaults (or a new table) and never rewrites what is already there.
 */
const MILESTONE_MIGRATIONS = [
  "0006_technology_loss",
  "0007_dynasty_succession",
  "0008_belief_systems",
  "0009_settlement_history",
  "0010_culture_traits",
  "0011_diplomatic_agreements",
  "0012_resilience",
] as const;

describe("migrazioni della milestone", () => {
  it.each(MILESTONE_MIGRATIONS)("%s non è distruttiva", async (tag) => {
    const sql = await readFile(path.join(FOLDER, `${tag}.sql`), "utf8");
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|ALTER COLUMN .* TYPE)\b/i);
    // The only DELETE-shaped statement allowed is an ON DELETE clause of a foreign key.
    for (const statement of sql.split("-->")) {
      if (/\bDELETE\b/i.test(statement)) expect(statement).toMatch(/ON DELETE/i);
    }
  });

  it("0006 aggiunge il registro delle perdite con un default", async () => {
    const sql = await readFile(path.join(FOLDER, "0006_technology_loss.sql"), "utf8");
    expect(sql).toMatch(/ADD COLUMN "tech_lost" jsonb DEFAULT '\{\}'::jsonb NOT NULL/i);
  });

  it("0007 riallinea le case già chiuse invece di dichiararle attive", async () => {
    const sql = await readFile(path.join(FOLDER, "0007_dynasty_succession.sql"), "utf8");
    expect(sql).toMatch(/UPDATE "dynasties" SET "status" = 'extinct'/i);
    expect(sql).toMatch(/"ended_year" IS NOT NULL/i);
  });

  it("un mondo già salvato attraversa tutte le migrazioni senza perdere nulla", async () => {
    const client = new PGlite();
    const journal = JSON.parse(await readFile(path.join(FOLDER, "meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    // Bring the database to the state it had before this milestone, then write a world in it.
    for (const entry of journal.entries) {
      if ((MILESTONE_MIGRATIONS as readonly string[]).includes(entry.tag)) break;
      await apply(client, entry.tag);
    }

    const worldId = "11111111-1111-4111-8111-111111111111";
    await client.exec(`
      INSERT INTO worlds (id, name, seed, width, height, current_tick, current_year, rng_state,
                          settings, counters, climate, summary, status)
      VALUES ('${worldId}', 'Mondo legacy', 'legacy', 8, 8, 10, -9900,
              '[1,2,3,4]'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'paused');
      INSERT INTO tribes (world_id, id, seq, name, color, status, x, y, food, wood, stone, copper,
                          techs, tech_progress, years_at_location, scarcity_years, founded_year,
                          morale, population_milestone, last_food_produced, last_food_consumed,
                          last_food_ratio)
      VALUES ('${worldId}', 't1', 1, 'Kanar', '#fff', 'nomadic', 1, 1, 10, 0, 0, 0,
              '["fire","stone_tools"]'::jsonb, '{"agriculture": 40}'::jsonb, 3, 0, -9950,
              0.5, 0, 0, 0, 1);
      INSERT INTO dynasties (world_id, id, seq, name, tribe_id, founder_id, founded_year,
                             ended_year, prestige, rulers)
      VALUES ('${worldId}', 'dy1', 1, 'Casa di Kanar', 't1', 'p1', -9940, NULL, 0.6, 3),
             ('${worldId}', 'dy2', 2, 'Casa di Oren', 't1', 'p2', -9990, -9950, 0.4, 2);
      INSERT INTO settlements (world_id, id, seq, name, tribe_id, x, y, level, status, founded_year,
                               food, wood, stone, copper, buildings, defense, territory_radius,
                               famine_years, road_links, last_production, last_food_ratio, population)
      VALUES ('${worldId}', 's1', 1, 'Naru', 't1', 2, 2, 3, 'active', -9930,
              5, 0, 0, 0, '{"camp":1}'::jsonb, 1, 2, 0, '[]'::jsonb, '{}'::jsonb, 1, 40),
             ('${worldId}', 's2', 2, 'Ruderi', 't1', 4, 4, 1, 'abandoned', -9960,
              0, 0, 0, 0, '{"camp":1}'::jsonb, 1, 2, 0, '[]'::jsonb, '{}'::jsonb, 1, 0);
    `);

    for (const tag of MILESTONE_MIGRATIONS) await apply(client, tag);

    // Technologies already held are untouched: nothing unlocked, nothing removed, nothing lost.
    const tribes = await client.query<{
      techs: string[];
      tech_progress: Record<string, number>;
      tech_lost: Record<string, number>;
      belief_system_id: string | null;
      belief_adherence: number;
    }>(`SELECT techs, tech_progress, tech_lost, belief_system_id, belief_adherence
        FROM tribes WHERE world_id = '${worldId}'`);
    expect(tribes.rows).toHaveLength(1);
    expect(tribes.rows[0]!.techs).toEqual(["fire", "stone_tools"]);
    expect(tribes.rows[0]!.tech_progress).toEqual({ agriculture: 40 });
    expect(tribes.rows[0]!.tech_lost).toEqual({});
    // A legacy people follows no belief and has never held one.
    expect(tribes.rows[0]!.belief_system_id).toBeNull();
    expect(tribes.rows[0]!.belief_adherence).toBe(0);

    // The backfill tells an already-closed house apart from a ruling one.
    const dynasties = await client.query<{
      id: string;
      status: string;
      succession_law: string;
      crises: number;
      ended_year: number | null;
    }>(`SELECT id, status, succession_law, crises, ended_year
        FROM dynasties WHERE world_id = '${worldId}' ORDER BY seq`);
    expect(dynasties.rows.map((r) => [r.id, r.status])).toEqual([
      ["dy1", "active"],
      ["dy2", "extinct"],
    ]);
    for (const row of dynasties.rows) {
      expect(row.succession_law).toBe("hereditary");
      expect(row.crises).toBe(0);
    }
    expect(dynasties.rows[1]!.ended_year).toBe(-9950);

    // Settlement memory is filled in by the engine on load, not by the migration: the column
    // starts empty and the founding years are untouched.
    const settlements = await client.query<{
      id: string;
      history: unknown;
      founded_year: number;
      status: string;
    }>(`SELECT id, history, founded_year, status
        FROM settlements WHERE world_id = '${worldId}' ORDER BY seq`);
    expect(settlements.rows.map((r) => [r.id, r.founded_year, r.status])).toEqual([
      ["s1", -9930, "active"],
      ["s2", -9960, "abandoned"],
    ]);
    for (const row of settlements.rows) expect(row.history).toBeNull();

    // The new table exists and starts empty.
    const beliefs = await client.query(`SELECT id FROM belief_systems WHERE world_id = '${worldId}'`);
    expect(beliefs.rows).toHaveLength(0);
    await client.close();
  });

  it("applicare due volte le migrazioni della milestone non cambia i dati", async () => {
    const client = new PGlite();
    const journal = JSON.parse(await readFile(path.join(FOLDER, "meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    for (const entry of journal.entries) {
      if ((MILESTONE_MIGRATIONS as readonly string[]).includes(entry.tag)) break;
      await apply(client, entry.tag);
    }
    const worldId = "22222222-2222-4222-8222-222222222222";
    await client.exec(`
      INSERT INTO worlds (id, name, seed, width, height, current_tick, current_year, rng_state,
                          settings, counters, climate, summary, status)
      VALUES ('${worldId}', 'Idempotenza', 'idem', 8, 8, 1, -9990,
              '[1,2,3,4]'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'paused');
      INSERT INTO dynasties (world_id, id, seq, name, tribe_id, founder_id, founded_year,
                             ended_year, prestige, rulers)
      VALUES ('${worldId}', 'dy1', 1, 'Casa chiusa', 't1', 'p1', -9995, -9991, 0.4, 2);
    `);
    for (const tag of MILESTONE_MIGRATIONS) await apply(client, tag);
    const first = await client.query(`SELECT * FROM dynasties WHERE world_id = '${worldId}'`);
    // Only the backfill can run again: the ALTERs would fail, which is what the migrator's own
    // journal prevents. Re-running the backfill must be a no-op.
    await client.exec(
      `UPDATE "dynasties" SET "status" = 'extinct' WHERE "ended_year" IS NOT NULL AND "status" = 'active';`,
    );
    const second = await client.query(`SELECT * FROM dynasties WHERE world_id = '${worldId}'`);
    expect(second.rows).toEqual(first.rows);
    await client.close();
  });
});
