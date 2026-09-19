import { listIdentitiesService } from "@/lib/services/identity-service";
import { errorResponse, ok, parse, searchParams } from "@/lib/utils/api";
import { identityListQuerySchema } from "@/lib/validation/identity";

export const runtime = "nodejs";

/** Static catalog: cacheable, it only changes with a new deploy (see `IDENTITY_CATALOG_VERSION`). */
const CACHE = { "cache-control": "public, max-age=300, s-maxage=3600" };

export async function GET(request: Request) {
  try {
    const query = parse(identityListQuerySchema, searchParams(request));
    return ok(listIdentitiesService(query), { headers: CACHE });
  } catch (error) {
    return errorResponse(error);
  }
}
