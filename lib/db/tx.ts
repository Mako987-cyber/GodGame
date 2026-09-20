import { sql } from "drizzle-orm";
import { isEmbeddedDatabase } from "./driver";
import type { Database } from "./index";

/**
 * Bounded transactions.
 *
 * A serverless function can be frozen or killed in the middle of a transaction. Through the
 * Supabase transaction pooler its server connection then stays pinned "idle in transaction",
 * holding every row lock it took, and any later statement that needs one of those rows waits
 * forever: the next request times out at the platform limit (HTTP 504) and, if it was itself
 * inside a transaction, becomes the next zombie. Every write transaction therefore sets:
 *
 * - `lock_timeout`: never wait more than this for a row/table lock (fails with 55P03);
 * - `statement_timeout`: no single statement runs longer than this (fails with 57014);
 * - `idle_in_transaction_session_timeout`: Postgres terminates the session if the client goes
 *   silent mid-transaction, so an orphaned transaction releases its locks by itself.
 *
 * All three are `SET LOCAL` (via `set_config(..., true)`): they end with the transaction and
 * never leak to the next client of a pooled connection.
 *
 * `idle_in_transaction_session_timeout` is skipped on the embedded PGlite database used in local
 * development. It is the only one of the three that kills the *session* rather than the
 * statement, and PGlite has exactly one session for the whole process with no pool to open
 * another: when it fires there, the shared client is destroyed, every later query — including
 * the plain `select ... from worlds` behind the home page — can no longer be served, and PGlite
 * blocks the event loop instead of rejecting, freezing the dev server until it is restarted.
 * The setting also protects against something PGlite cannot suffer: a serverless function frozen
 * mid-transaction while pinned to a pooled server connection.
 */
export interface TxTimeouts {
  lockTimeoutMs: number;
  statementTimeoutMs: number;
  idleInTransactionMs: number;
}

export const DEFAULT_TX_TIMEOUTS: TxTimeouts = {
  lockTimeoutMs: 5_000,
  statementTimeoutMs: 30_000,
  idleInTransactionMs: 15_000,
};

const ms = (value: number) => `${Math.max(1, Math.trunc(value))}ms`;

/**
 * `options.sessionTimeouts` is false for a single-session database (PGlite), where terminating
 * the session would take the whole process down instead of just this transaction.
 */
export async function applyTxTimeouts(
  tx: Pick<Database, "execute">,
  t: TxTimeouts,
  options: { sessionTimeouts?: boolean } = {},
) {
  const settings = [
    sql`set_config('lock_timeout', ${ms(t.lockTimeoutMs)}, true)`,
    sql`set_config('statement_timeout', ${ms(t.statementTimeoutMs)}, true)`,
  ];
  if (options.sessionTimeouts !== false)
    settings.push(sql`set_config('idle_in_transaction_session_timeout', ${ms(t.idleInTransactionMs)}, true)`);
  await tx.execute(sql`select ${sql.join(settings, sql`, `)}`);
}

/** `db.transaction` with the timeouts above applied as its first statement. */
export function boundedTransaction<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
  timeouts: Partial<TxTimeouts> = {},
): Promise<T> {
  const t = { ...DEFAULT_TX_TIMEOUTS, ...timeouts };
  const sessionTimeouts = !isEmbeddedDatabase(db);
  return db.transaction(async (tx) => {
    await applyTxTimeouts(tx as unknown as Database, t, { sessionTimeouts });
    return fn(tx as unknown as Database);
  });
}

/** SQLSTATE of a Postgres error, also when wrapped by Drizzle (`cause`). */
export function pgErrorCode(error: unknown): string | null {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    if (typeof e === "object" && e !== null && "code" in e) {
      const code = (e as { code: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    }
    e = e instanceof Error ? e.cause : undefined;
  }
  return null;
}

/**
 * Errors worth retrying later: lock/statement timeouts, deadlocks, serialization failures,
 * dropped or refused connections. Nothing was committed by the failed transaction.
 */
export function isTransientDbError(error: unknown): boolean {
  const code = pgErrorCode(error);
  if (code)
    return (
      ["55P03", "57014", "40P01", "40001", "57P01", "57P03", "53300"].includes(code) || code.startsWith("08")
    );
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|CONNECTION_CLOSED|CONNECT_TIMEOUT|terminat/i.test(message);
}
