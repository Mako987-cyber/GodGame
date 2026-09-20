import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import type { ApiErrorBody } from "@/lib/dto";
import { worldIdSchema } from "@/lib/validation/world";
import { AppError } from "./errors";
import { errorDetails, logger } from "./logger";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

/** Vercel's request id when deployed, a fresh one otherwise: echoed in errors and logs. */
export function requestIdOf(request: Request): string {
  return request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function errorResponse(error: unknown, requestId?: string) {
  const headers = requestId ? { "x-request-id": requestId } : undefined;
  if (error instanceof AppError) {
    const body: ApiErrorBody = {
      error: { code: error.code, message: error.message, details: error.details, requestId },
    };
    return NextResponse.json(body, { status: error.status, headers });
  }
  if (error instanceof ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: "INVALID_INPUT",
        message: error.issues[0]?.message ?? "Input non valido",
        details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId,
      },
    };
    return NextResponse.json(body, { status: 400, headers });
  }
  logger.error("api.unhandled", { requestId, ...errorDetails(error) });
  const body: ApiErrorBody = { error: { code: "INTERNAL", message: "Errore interno del server", requestId } };
  return NextResponse.json(body, { status: 500, headers });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("INVALID_INPUT", "Il corpo della richiesta deve essere JSON valido");
  }
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

/** Invalid UUIDs are reported as "not found" instead of leaking a database cast error. */
export function parseWorldId(value: string): string {
  const parsed = worldIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError("NOT_FOUND", "Mondo non trovato");
  return parsed.data;
}

export function searchParams(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

export type WorldRouteContext = { params: Promise<{ worldId: string }> };
