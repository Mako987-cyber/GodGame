export type ErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "TICKS_NOT_ALLOWED"
  | "SIMULATION_IN_PROGRESS"
  | "TIMEOUT"
  | "DATABASE_ERROR"
  | "UNAUTHORIZED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  TICKS_NOT_ALLOWED: 400,
  SIMULATION_IN_PROGRESS: 409,
  TIMEOUT: 504,
  DATABASE_ERROR: 500,
  UNAUTHORIZED: 401,
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
