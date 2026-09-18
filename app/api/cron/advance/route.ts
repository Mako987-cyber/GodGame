import { getDb } from "@/lib/db";
import { listRunningWorldIds } from "@/lib/db/queries";
import { simulateWorldService } from "@/lib/services/world-service";
import { errorResponse, ok } from "@/lib/utils/api";
import { AppError } from "@/lib/utils/errors";
import { errorDetails, logger } from "@/lib/utils/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const WORLDS_PER_RUN = 3;
const TICKS_PER_WORLD = 10;

/**
 * OPTIONAL: advances worlds marked "running". Disabled unless CRON_SECRET is set;
 * the MVP works entirely through explicit calls from the UI.
 */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      throw new AppError("UNAUTHORIZED", "Cron non autorizzato o non configurato");
    }
    const db = await getDb();
    const ids = await listRunningWorldIds(db, WORLDS_PER_RUN);
    const results: { worldId: string; ok: boolean; ticks?: number; error?: string }[] = [];
    for (const worldId of ids) {
      try {
        const r = await simulateWorldService(worldId, TICKS_PER_WORLD);
        results.push({ worldId, ok: true, ticks: r.ticksRun });
      } catch (error) {
        logger.warn("cron.world_failed", { worldId, ...errorDetails(error) });
        results.push({ worldId, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return ok({ advanced: results });
  } catch (error) {
    return errorResponse(error);
  }
}
