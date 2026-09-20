import { getCivilizationTechnologiesService } from "@/lib/services/technology-service";
import { errorResponse, ok, parse, parseWorldId, searchParams } from "@/lib/utils/api";
import { AppError } from "@/lib/utils/errors";
import { civilizationIdSchema } from "@/lib/validation/identity";
import { civilizationTechnologyQuerySchema } from "@/lib/validation/technology";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ worldId: string; civilizationId: string }> };

/** What one people knows, is working on, has adopted or has lost. Paginated and filterable. */
export async function GET(request: Request, context: Context) {
  try {
    const params = await context.params;
    const worldId = parseWorldId(params.worldId);
    const parsed = civilizationIdSchema.safeParse(params.civilizationId);
    if (!parsed.success) throw new AppError("NOT_FOUND", "Civiltà non trovata");
    const query = parse(civilizationTechnologyQuerySchema, searchParams(request));
    return ok(await getCivilizationTechnologiesService(worldId, parsed.data, query));
  } catch (error) {
    return errorResponse(error);
  }
}
