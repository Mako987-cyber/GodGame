import { getTechnologyHistoryService } from "@/lib/services/technology-service";
import { errorResponse, ok, parse, parseWorldId } from "@/lib/utils/api";
import { technologyIdSchema } from "@/lib/validation/technology";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ worldId: string; technologyId: string }> };

/** How one technology travelled through one world: who found it, who took it, who lost it. */
export async function GET(_request: Request, context: Context) {
  try {
    const params = await context.params;
    const worldId = parseWorldId(params.worldId);
    const technologyId = parse(technologyIdSchema, params.technologyId);
    return ok(await getTechnologyHistoryService(worldId, technologyId));
  } catch (error) {
    return errorResponse(error);
  }
}
