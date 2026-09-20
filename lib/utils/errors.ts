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
