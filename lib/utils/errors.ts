export type ErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "TICKS_NOT_ALLOWED"
  | "SIMULATION_IN_PROGRESS"
  | "TIMEOUT"
  | "DATABASE_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFIRMATION_MISMATCH"
  | "WORLD_RUNNING"
  | "WORLD_BUSY"
  | "DELETION_FAILED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  TICKS_NOT_ALLOWED: 400,
  SIMULATION_IN_PROGRESS: 409,
  TIMEOUT: 504,
  DATABASE_ERROR: 500,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFIRMATION_MISMATCH: 422,
  WORLD_RUNNING: 409,
  /** A database lock on the world could not be taken within `lock_timeout`: retry shortly. */
  WORLD_BUSY: 409,
  DELETION_FAILED: 500,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const notFound = (what = "Mondo") => new AppError("NOT_FOUND", `${what} non trovato`);

/**
 * Human-readable description of an error, including its `cause` chain.
 *
 * Drizzle wraps every driver failure in a `DrizzleQueryError` whose message is only the SQL it
 * tried to run ("Failed query: select ..."); the reason — `relation "worlds" does not exist`,
 * `ECONNREFUSED`, a terminated session — lives in `cause`. Reporting `error.message` alone tells
 * the reader which query failed but never why, so the causes are appended here.
 */
export function describeError(error: unknown, maxDepth = 4): string {
  if (!(error instanceof Error)) return String(error);
  const parts: string[] = [];
  for (let e: unknown = error, depth = 0; e instanceof Error && depth < maxDepth; depth++) {
    const message = e.message.trim();
    if (message && !parts.includes(message)) parts.push(message);
    e = e.cause;
  }
  return parts.join(" — ") || error.name;
}
