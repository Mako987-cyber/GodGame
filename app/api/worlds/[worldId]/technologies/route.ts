import { getWorldTechnologiesService } from "@/lib/services/technology-service";
import { errorResponse, ok, parseWorldId } from "@/lib/utils/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ worldId: string }> };

/**
 * Catalogue of this world, with how far each technology has actually spread in it. The
 * catalogue is global; holding a technology is not: every row says who holds it.
 */
export async function GET(_request: Request, context: Context) {
  try {
    const { worldId } = await context.params;
    return ok(await getWorldTechnologiesService(parseWorldId(worldId)));
  } catch (error) {
    return errorResponse(error);
  }
}
