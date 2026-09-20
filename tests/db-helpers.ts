import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Logger } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "@/lib/db";
import { markEmbeddedDatabase } from "@/lib/db/driver";
import * as schema from "@/lib/db/schema";

/** In-memory PGlite with every migration applied: tests never touch a real database. */
export async function createTestDb(
  options: { logger?: Logger } = {},
): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema, logger: options.logger });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { db: markEmbeddedDatabase(db) as unknown as Database, close: () => client.close() };
}

/** Records every SQL statement a test database runs (to prove there are no per-record queries). */
export class QueryRecorder implements Logger {
  queries: string[] = [];
  logQuery(query: string) {
    this.queries.push(query);
  }
  reset() {
    this.queries = [];
  }
  count(pattern: RegExp) {
    return this.queries.filter((q) => pattern.test(q)).length;
  }
}
