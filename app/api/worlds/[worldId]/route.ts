import {
  deleteWorldService,
  getWorldDetailService,
  setWorldStatusService,
} from "@/lib/services/world-service";
import { errorResponse, ok, parse, parseWorldId, readJson, type WorldRouteContext } from "@/lib/utils/api";
import { deleteWorldSchema, updateWorldSchema } from "@/lib/validation/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Deleting a large world removes many rows in one transaction.
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
 * the world must be paused. Responds 404 when the world does not exist (already deleted).
 */
export async function DELETE(request: Request, context: WorldRouteContext) {
  try {
    const worldId = parseWorldId((await context.params).worldId);
    const input = parse(deleteWorldSchema, await readJson(request));
    return ok(await deleteWorldService(worldId, input));
  } catch (error) {
    return errorResponse(error);
  }
}
