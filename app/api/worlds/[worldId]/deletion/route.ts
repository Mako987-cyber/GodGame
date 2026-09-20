import { getWorldDeletionService, resumeWorldDeletionService } from "@/lib/services/world-service";
import { errorResponse, ok, parseWorldId, requestIdOf, type WorldRouteContext } from "@/lib/utils/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Read-only state of the latest deletion of the world (404 if it was never deleted). */
export async function GET(request: Request, context: WorldRouteContext) {
  const requestId = requestIdOf(request);
  try {
    const worldId = parseWorldId((await context.params).worldId);
    return ok(await getWorldDeletionService(worldId), { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/**
 * Continues a deletion already confirmed with `DELETE /api/worlds/:id` for one time budget.
 * Idempotent and safe to call concurrently (a lease makes one slice run at a time):
 * 200 when completed, 202 while in progress.
 */
export async function POST(request: Request, context: WorldRouteContext) {
  const requestId = requestIdOf(request);
  try {
    const worldId = parseWorldId((await context.params).worldId);
    const result = await resumeWorldDeletionService(worldId, { requestId });
    return ok(result, { status: result.completed ? 200 : 202, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
