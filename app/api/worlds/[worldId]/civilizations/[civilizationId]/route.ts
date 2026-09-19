import { getWorldCivilizationService } from "@/lib/services/identity-service";
import { errorResponse, ok, parseWorldId } from "@/lib/utils/api";
import { AppError } from "@/lib/utils/errors";
import { civilizationIdSchema } from "@/lib/validation/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ worldId: string; civilizationId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const params = await context.params;
    const worldId = parseWorldId(params.worldId);
    const parsed = civilizationIdSchema.safeParse(params.civilizationId);
    if (!parsed.success) throw new AppError("NOT_FOUND", "Civiltà non trovata");
    return ok(await getWorldCivilizationService(worldId, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}
