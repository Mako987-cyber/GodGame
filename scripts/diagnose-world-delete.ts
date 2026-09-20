/**
 * Read-only diagnosis of the deletion of one world. NEVER deletes or modifies anything: every
 * query runs inside a `READ ONLY` transaction that is rolled back at the end.
 *
 *   npm run diagnose:world-delete -- --world-id <uuid> [--json]
 *
 * Uses DIRECT_URL / DATABASE_URL (see lib/db/config.ts), otherwise the local PGlite database.
 * Reports: row counts and sizes per table, foreign keys (ON DELETE, index on the child column),
 * triggers, sessions that hold or wait for locks on the world tables (the cause of the former
 * HTTP 504), current timeouts, the plan of one deletion batch, an estimate and a recommended plan.
 */
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Database } from "../lib/db";
import { directDatabaseUrl, pgliteDirectory, requiresSsl } from "../lib/db/config";
import * as schema from "../lib/db/schema";
import { WORLD_CASCADE_ONLY_TABLES, WORLD_CHILD_TABLES } from "../lib/db/world-deletion";

type Row = Record<string, unknown>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

async function connect(): Promise<{ db: Database; kind: string; close: () => Promise<void> }> {
  const url = directDatabaseUrl();
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(url, {
      max: 1,
      prepare: false,
      ssl: requiresSsl(url) ? "require" : undefined,
      onnotice: () => undefined,
    });
    return {
      db: drizzle(client, { schema }) as unknown as Database,
      kind: `postgres ${new URL(url).host}`,
      close: () => client.end({ timeout: 5 }),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = pgliteDirectory();
  const client = new PGlite(path.resolve(dir));
  return {
    db: drizzle(client, { schema }) as unknown as Database,
    kind: `pglite ${dir}`,
    close: () => client.close(),
  };
}

class Rollback extends Error {}

async function main() {
  const worldId = arg("--world-id");
  const asJson = process.argv.includes("--json");
  if (!worldId || !/^[0-9a-f-]{36}$/i.test(worldId)) {
    console.error("Uso: npm run diagnose:world-delete -- --world-id <uuid> [--json]");
    process.exit(2);
  }
  const { db, kind, close } = await connect();
  const report: Record<string, unknown> = { worldId, database: kind, generatedAt: new Date().toISOString() };
  const tables = [...WORLD_CHILD_TABLES.map((t) => t.name), ...WORLD_CASCADE_ONLY_TABLES.map((t) => t.name)];
  const q = async (tx: Database, query: ReturnType<typeof sql>) => rowsOf(await tx.execute(query));
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | { unavailable: string }> => {
    try {
      return await fn();
    } catch (e) {
      return { unavailable: `${label}: ${e instanceof Error ? e.message : String(e)}` };
    }
  };

  try {
    await db.transaction(async (tx) => {
      // Guarantee: nothing below can write.
      await tx.execute(sql`set transaction read only`);
      await tx.execute(sql`select set_config('statement_timeout', '60000ms', true)`);

      const [world] = await q(
        tx,
        sql`select id, name, status, current_tick, width, height, created_at, updated_at from worlds where id = ${worldId}`,
      );
      report.world = world ?? null;
      report.deletionJobs = await safe("jobs", () =>
        q(
          tx,
          sql`select id, status, current_phase, deleted_rows, progress, attempts, error_code, lease_until, created_at, finished_at
              from world_deletion_jobs where world_id = ${worldId} order by created_at desc limit 5`,
        ),
      );

      // Tables the code expects but the database lacks: a migration was not applied yet.
      const present = new Set(
        (
          await q(tx, sql`select table_name from information_schema.tables where table_schema = 'public'`)
        ).map((r) => String(r.table_name)),
      );
      const missing = tables.filter((t) => !present.has(t));
      report.missingTables = missing;

      // Row counts (timed: the read cost is a lower bound of the delete cost).
      const counts: Record<string, { rows: number; countMs: number }> = {};
      let totalRows = 0;
      let totalMs = 0;
      for (const t of tables) {
        if (missing.includes(t)) continue;
        const started = performance.now();
        const [r] = await q(
          tx,
          sql`select count(*)::bigint as n from ${sql.identifier(t)} where world_id = ${worldId}`,
        );
        const ms = Math.round((performance.now() - started) * 10) / 10;
        const n = Number(r?.n ?? 0);
        counts[t] = { rows: n, countMs: ms };
        totalRows += n;
        totalMs += ms;
      }
      report.rows = counts;
      report.totalRows = totalRows;

      report.tableSizes = await safe("sizes", () =>
        q(
          tx,
          sql`select relname as table, pg_total_relation_size(c.oid) as bytes, c.reltuples::bigint as estimated_rows_all_worlds
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' order by 2 desc`,
        ),
      );

      const fks = await q(
        tx,
        sql`select c.conrelid::regclass::text as child, a.attname as column, c.confdeltype as on_delete,
                   exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]) as indexed
            from pg_constraint c
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = 'worlds'::regclass order by 1`,
      );
      const onDelete: Record<string, string> = {
        c: "CASCADE",
        a: "NO ACTION",
        r: "RESTRICT",
        n: "SET NULL",
        d: "SET DEFAULT",
      };
      report.foreignKeys = fks.map((f) => ({
        ...f,
        on_delete: onDelete[String(f.on_delete)] ?? f.on_delete,
      }));
      const problems: string[] = missing.map(
        (t) => `tabella ${t} assente: applicare le migrazioni (npm run db:migrate) prima di eliminare`,
      );
      for (const f of fks) {
        if (f.on_delete !== "c") problems.push(`FK ${f.child}.${f.column} non è ON DELETE CASCADE`);
        if (!f.indexed)
          problems.push(`FK ${f.child}.${f.column} senza indice: la cascata scansiona tutta la tabella`);
      }
      const registered = new Set<string>(tables);
      for (const f of fks)
        if (!registered.has(String(f.child)))
          problems.push(`tabella ${f.child} non registrata in WORLD_CHILD_TABLES`);

      const triggers = await q(
        tx,
        sql`select tgrelid::regclass::text as table, tgname as trigger from pg_trigger where not tgisinternal order by 1`,
      );
      report.triggers = triggers;
      if (triggers.length)
        problems.push(`${triggers.length} trigger applicativi sulle tabelle: verificarne il costo`);

      report.settings = await safe("settings", async () =>
        Object.fromEntries(
          (
            await q(
              tx,
              // reset_val: the session default, not the 60 s this script set for itself.
              sql`select name, reset_val as setting, unit from pg_settings
                  where name in ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout','max_connections')`,
            )
          ).map((r) => [r.name, `${r.setting}${r.unit ? ` ${r.unit}` : ""}`]),
        ),
      );

      // Sessions that could block a deletion: long or idle transactions, lock waiters, holders of
      // locks on the world tables. Terminating one is an operator decision: printed, never run.
      const sessions = await safe("sessions", () =>
        q(
          tx,
          sql`select a.pid, a.state, a.wait_event_type, a.wait_event, a.application_name,
                     extract(epoch from now() - a.xact_start)::int as xact_seconds,
                     extract(epoch from now() - a.state_change)::int as state_seconds,
                     pg_blocking_pids(a.pid) as blocked_by, left(a.query, 120) as last_query
              from pg_stat_activity a
              where a.datname = current_database() and a.pid <> pg_backend_pid()
                and (a.state like 'idle in transaction%' or a.wait_event_type = 'Lock'
                     or (a.state = 'active' and now() - a.xact_start > interval '30 seconds')
                     or exists (select 1 from pg_locks l where l.pid = a.pid
                                and l.relation = any (array[${sql.raw(
                                  ["worlds", ...tables.filter((t) => !missing.includes(t))]
                                    .map((t) => `'${t}'::regclass`)
                                    .join(","),
                                )}])))
              order by a.xact_start nulls last`,
        ),
      );
      report.suspiciousSessions = sessions;
      if (Array.isArray(sessions) && sessions.length) {
        problems.push(
          `${sessions.length} sessioni aperte o in attesa sulle tabelle dei mondi: una transazione orfana ` +
            `blocca la cancellazione (causa del 504). Se confermato: select pg_terminate_backend(<pid>);`,
        );
      }

      report.batchPlan = await safe("explain", async () => {
        const biggest = Object.entries(counts).sort((a, b) => b[1].rows - a[1].rows)[0]?.[0] ?? "people";
        const plan = await q(
          tx,
          sql`explain delete from ${sql.identifier(biggest)} where world_id = ${worldId}
              and ctid = any(array(select ctid from ${sql.identifier(biggest)} where world_id = ${worldId} limit 5000))`,
        );
        return { table: biggest, plan: plan.map((r) => Object.values(r)[0]) };
      });

      const batches = WORLD_CHILD_TABLES.reduce(
        (acc, t) => acc + Math.floor((counts[t.name]?.rows ?? 0) / t.batch) + 1,
        1,
      );
      // Deleting costs a few times more than counting (heap + WAL); network adds one round trip per batch.
      const estimatedMs = Math.round(totalMs * 4 + batches * 5);
      report.estimate = {
        batches,
        estimatedDeleteMs: estimatedMs,
        basis: "4× tempo di conteggio + 5 ms per blocco",
      };
      report.problems = problems;
      report.recommendedPlan = !world
        ? "Il mondo non esiste (già eliminato?). Controlla world_deletion_jobs."
        : missing.length
          ? "Applica prima le migrazioni mancanti (npm run db:migrate): l'eliminazione le richiede."
          : problems.some((p) => p.includes("sessioni"))
            ? "Prima rimuovi il blocco (attendi idle_in_transaction_session_timeout o termina la sessione orfana), poi riprova: la DELETE risponderà 409 WORLD_BUSY finché il lock è tenuto."
            : estimatedMs < 10_000
              ? "Cancellazione in una sola richiesta (200) entro il budget di WORLD_DELETE_BUDGET_MS."
              : `Cancellazione a job: circa ${Math.ceil(estimatedMs / 15_000)} richieste da 15 s (202 + ripresa automatica).`;
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await close();
  }

  if (asJson) {
    console.log(JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2));
    return;
  }
  const r = report as Record<string, unknown>;
  console.log(`Diagnosi cancellazione mondo ${worldId} (${kind}) — sola lettura, nessun dato modificato\n`);
  console.log("Mondo:", r.world ?? "non trovato");
  console.log("\nRighe per tabella:");
  console.table(r.rows);
  console.log(`Totale righe: ${r.totalRows}`);
  console.log("\nForeign key verso worlds:");
  console.table(r.foreignKeys);
  console.log(
    "\nTrigger applicativi:",
    (r.triggers as unknown[] | undefined)?.length ? r.triggers : "nessuno",
  );
  console.log("\nTimeout correnti:", r.settings);
  console.log("\nSessioni sospette:", r.suspiciousSessions);
  console.log("\nPiano di un blocco di cancellazione:", r.batchPlan);
  console.log("\nStima:", r.estimate);
  if ((r.missingTables as string[] | undefined)?.length) console.log("\nTabelle mancanti:", r.missingTables);
  console.log("\nProblemi:", (r.problems as string[] | undefined)?.length ? r.problems : "nessuno");
  console.log("\nPiano consigliato:", r.recommendedPlan);
  console.log("\nUltimi job:", r.deletionJobs);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
