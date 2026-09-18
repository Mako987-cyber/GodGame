import { simulateWorldService } from "@/lib/services/world-service";
import { errorResponse, ok, parseWorldId, readJson, type WorldRouteContext } from "@/lib/utils/api";
import { AppError } from "@/lib/utils/errors";
import { simulateSchema } from "@/lib/validation/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Upper bound for the serverless function; the engine stops earlier via SIMULATION_TIME_BUDGET_MS.
export const maxDuration = 60;

export async function POST(request: Request, context: WorldRouteContext) {
  try {
    const worldId = parseWorldId((await context.params).worldId);
    const parsed = simulateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new AppError(
        "TICKS_NOT_ALLOWED",
        parsed.error.issues[0]?.message ?? "Numero di tick non consentito",
      );
    }
    return ok(await simulateWorldService(worldId, parsed.data.ticks));
  } catch (error) {
    return errorResponse(error);
  }
}
