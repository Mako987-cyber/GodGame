import { listWorldCivilizationsService } from "@/lib/services/identity-service";
import { errorResponse, ok, parseWorldId, type WorldRouteContext } from "@/lib/utils/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Civilizations (political instances) of a world. Read-only: the roster is assigned once when
 * the world is created (`POST /api/worlds`), so there is no way to add or re-roll peoples later.
 */
export async function GET(_request: Request, context: WorldRouteContext) {
  try {
    const worldId = parseWorldId((await context.params).worldId);
    return ok(await listWorldCivilizationsService(worldId));
  } catch (error) {
    return errorResponse(error);
  }
}
