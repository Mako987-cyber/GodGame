import { getIdentityService } from "@/lib/services/identity-service";
import { errorResponse, ok } from "@/lib/utils/api";
import { AppError } from "@/lib/utils/errors";
import { identityKeySchema } from "@/lib/validation/identity";

export const runtime = "nodejs";

type Context = { params: Promise<{ identityId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const parsed = identityKeySchema.safeParse((await context.params).identityId);
    if (!parsed.success) throw new AppError("NOT_FOUND", "Identità non trovata");
    return ok(getIdentityService(parsed.data), {
      headers: { "cache-control": "public, max-age=300, s-maxage=3600" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
