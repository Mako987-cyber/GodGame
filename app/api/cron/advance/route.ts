import { getDb } from "@/lib/db";
import { listRunningWorldIds } from "@/lib/db/queries";
import { resumePendingDeletionsService, simulateWorldService } from "@/lib/services/world-service";
import { cronConfig } from "@/lib/config";
import { errorResponse, ok } from "@/lib/utils/api";
import { AppError } from "@/lib/utils/errors";
import { errorDetails, logger } from "@/lib/utils/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * OPTIONAL: advances worlds marked "running". Disabled unless CRON_SECRET is set;
 * the app works entirely through explicit calls from the UI.
 *
 * Every invocation takes a bounded slice of work — at most `worldsPerRun` worlds,
 * `ticksPerWorld` years each — so a single execution always terminates well inside the
 * serverless budget. Archived worlds are never touched, concurrent runs are kept apart by
 * the per-world lock, and a failure on one world does not stop the others.
 */
export async function GET(request: Request) {
  const started = Date.now();
  try {
    const config = cronConfig();
    if (!config.secret || request.headers.get("authorization") !== `Bearer ${config.secret}`) {
      throw new AppError("UNAUTHORIZED", "Cron non autorizzato o non configurato");
    }
    const db = await getDb();
    // Deletions nobody is polling any more (tab closed) are finished here, one short slice each.
    const deletions = await resumePendingDeletionsService(2, { db, budgetMs: 10_000 }).catch((error) => {
      logger.warn("cron.deletions_failed", errorDetails(error));
      return [];
    });
    const ids = await listRunningWorldIds(db, config.worldsPerRun);
    const results: { worldId: string; ok: boolean; ticks?: number; error?: string }[] = [];
    for (const worldId of ids) {
      // Stop early rather than being killed mid-write by the platform timeout.
      if (Date.now() - started > config.budgetMs) {
        logger.warn("cron.budget_exhausted", { processed: results.length, pending: ids.length });
        break;
      }
      try {
        const r = await simulateWorldService(worldId, config.ticksPerWorld);
        results.push({ worldId, ok: true, ticks: r.ticksRun });
      } catch (error) {
        logger.warn("cron.world_failed", { worldId, ...errorDetails(error) });
        results.push({ worldId, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    logger.info("cron.advance", {
      candidates: ids.length,
      advanced: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      durationMs: Date.now() - started,
    });
    return ok({
      advanced: results,
      deletions: deletions.map((d) => ({ worldId: d.worldId, status: d.status, progress: d.progress })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
