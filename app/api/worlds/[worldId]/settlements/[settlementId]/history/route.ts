import { getSettlementHistoryService } from "@/lib/services/technology-service";
import { errorResponse, ok, parse, parseWorldId, searchParams } from "@/lib/utils/api";
import { settlementHistoryQuerySchema } from "@/lib/validation/technology";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ worldId: string; settlementId: string }> };

/** What one place remembers about itself, with its chronicle paginated. */
export async function GET(request: Request, context: Context) {
  try {
    const params = await context.params;
    const worldId = parseWorldId(params.worldId);
    const query = parse(settlementHistoryQuerySchema, searchParams(request));
    return ok(await getSettlementHistoryService(worldId, params.settlementId, query));
  } catch (error) {
    return errorResponse(error);
  }
}
