import { z } from "zod";
import { getEventCausalityService } from "@/lib/services/causality-service";
import { errorResponse, ok, parse, parseWorldId } from "@/lib/utils/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ worldId: string; eventId: string }> };

const eventIdSchema = z.string().regex(/^e\d+$/, "Evento non valido");

/** Why an event happened (its chain of causes) and what it led to (direct consequences). */
export async function GET(_request: Request, context: Context) {
  try {
    const params = await context.params;
    const worldId = parseWorldId(params.worldId);
    const eventId = parse(eventIdSchema, params.eventId);
    return ok(await getEventCausalityService(worldId, eventId));
  } catch (error) {
    return errorResponse(error);
  }
}
