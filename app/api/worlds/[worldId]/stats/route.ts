import { getStatsService } from "@/lib/services/world-service";
import {
  errorResponse,
  ok,
  parse,
  parseWorldId,
  searchParams,
  type WorldRouteContext,
} from "@/lib/utils/api";
import { statsQuerySchema } from "@/lib/validation/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: WorldRouteContext) {
  try {
    const worldId = parseWorldId((await context.params).worldId);
    const { maxPoints, civilizations } = parse(statsQuerySchema, searchParams(request));
    return ok(await getStatsService(worldId, maxPoints, { civilizations }));
  } catch (error) {
    return errorResponse(error);
  }
}
