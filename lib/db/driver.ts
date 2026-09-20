/**
 * Which driver is behind a `Database`.
 *
 * PGlite is a single embedded Postgres session shared by the whole process, with no pool behind
 * it: the app, every request and every background job talk to that one session. A pooled
 * Postgres tolerates losing a connection — the pool opens another one — whereas losing the
 * PGlite session takes the entire application down with it until the process restarts.
 *
 * Transaction settings that can *terminate* the session are therefore safe on Postgres and fatal
 * on PGlite, and `boundedTransaction` needs to tell the two apart. See `tx.ts`.
 */
const embedded = new WeakSet<object>();

/** Records that this database is an embedded single-session PGlite instance. */
export function markEmbeddedDatabase<T extends object>(db: T): T {
  embedded.add(db);
  return db;
}

export function isEmbeddedDatabase(db: unknown): boolean {
  return typeof db === "object" && db !== null && embedded.has(db as object);
}
