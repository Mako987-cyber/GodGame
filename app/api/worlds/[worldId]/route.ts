import {
  deleteWorldService,
  getWorldDetailService,
  setWorldStatusService,
} from "@/lib/services/world-service";
import {
  errorResponse,
  ok,
  parse,
  parseWorldId,
  readJson,
  requestIdOf,
  type WorldRouteContext,
} from "@/lib/utils/api";
import { deleteWorldSchema, updateWorldSchema } from "@/lib/validation/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The deletion answers within its own budget (WORLD_DELETE_BUDGET_MS, 15 s by default) and
// every transaction it opens is bounded by lock/statement timeouts: this is a safety margin,
// not the fix of the former 504.
export const maxDuration = 60;

export async function GET(_request: Request, context: WorldRouteContext) {
  try {
    const worldId = parseWorldId((await context.params).worldId);
    return ok(await getWorldDetailService(worldId));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Pause / resume: the status is persisted so the optional cron can advance running worlds. */
export async function PATCH(request: Request, context: WorldRouteContext) {
  try {
    const worldId = parseWorldId((await context.params).worldId);
    const input = parse(updateWorldSchema, await readJson(request));
    return ok(await setWorldStatusService(worldId, input.status));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Deletes the world and all its data. Requires a JSON body
 * `{ "confirmation": "ELIMINA <nome>", "worldName": "<nome>" }` matching the stored name;
 * the world must be paused.
 *
 * - 200: deleted and verified (`completed: true`, per-table counts);
 * - 202: confirmed and in progress (huge world, or a transient database error): continue with
 *   `POST /api/worlds/:id/deletion` after `retryAfterMs`;
 * - 404: the world does not exist (already deleted); 409: running, simulating or locked;
 * - 422: wrong confirmation; 403: not the owner; 500: `requestId` to find the logs.
 */
export async function DELETE(request: Request, context: WorldRouteContext) {
  const requestId = requestIdOf(request);
  try {
    const worldId = parseWorldId((await context.params).worldId);
    const input = parse(deleteWorldSchema, await readJson(request));
    const result = await deleteWorldService(worldId, input, { requestId });
    return ok(result, { status: result.completed ? 200 : 202, headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
