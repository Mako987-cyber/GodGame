import { getCivilizationKnowledgeService } from "@/lib/services/technology-service";
import { errorResponse, ok, parseWorldId } from "@/lib/utils/api";
import { AppError } from "@/lib/utils/errors";
import { civilizationIdSchema } from "@/lib/validation/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ worldId: string; civilizationId: string }> };

/**
 * What one people believes about the others: estimates with confidence, age and source, never
 * the truth. A people it has never met does not appear at all.
 */
export async function GET(_request: Request, context: Context) {
  try {
    const params = await context.params;
    const worldId = parseWorldId(params.worldId);
    const parsed = civilizationIdSchema.safeParse(params.civilizationId);
    if (!parsed.success) throw new AppError("NOT_FOUND", "Civiltà non trovata");
    return ok(await getCivilizationKnowledgeService(worldId, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}
