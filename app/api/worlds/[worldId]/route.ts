import {
  deleteWorldService,
  getWorldDetailService,
  setWorldStatusService,
} from "@/lib/services/world-service";
import { errorResponse, ok, parse, parseWorldId, readJson, type WorldRouteContext } from "@/lib/utils/api";
import { updateWorldSchema } from "@/lib/validation/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function DELETE(_request: Request, context: WorldRouteContext) {
  try {
    const worldId = parseWorldId((await context.params).worldId);
    await deleteWorldService(worldId);
    return ok({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
