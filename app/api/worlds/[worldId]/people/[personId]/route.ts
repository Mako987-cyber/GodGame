import { getPersonService } from "@/lib/services/world-service";
import { errorResponse, ok, parseWorldId } from "@/lib/utils/api";
import { AppError } from "@/lib/utils/errors";
import { personIdSchema } from "@/lib/validation/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ worldId: string; personId: string }> };

/** Detail of a single person, loaded on demand: the world payload never carries them all. */
export async function GET(_request: Request, context: Context) {
  try {
    const params = await context.params;
    const worldId = parseWorldId(params.worldId);
    const parsed = personIdSchema.safeParse(params.personId);
    if (!parsed.success) throw new AppError("NOT_FOUND", "Persona non trovata");
    return ok(await getPersonService(worldId, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}
