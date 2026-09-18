import { getEventsService } from "@/lib/services/world-service";
import {
  errorResponse,
  ok,
  parse,
  parseWorldId,
  searchParams,
  type WorldRouteContext,
} from "@/lib/utils/api";
import { eventsQuerySchema } from "@/lib/validation/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: WorldRouteContext) {
  try {
    const worldId = parseWorldId((await context.params).worldId);
    const query = parse(eventsQuerySchema, searchParams(request));
    return ok(await getEventsService(worldId, query));
  } catch (error) {
    return errorResponse(error);
  }
}
