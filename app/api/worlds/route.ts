import { createWorldService, listWorldsService } from "@/lib/services/world-service";
import { errorResponse, ok, parse, readJson } from "@/lib/utils/api";
import { createWorldSchema } from "@/lib/validation/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(await listWorldsService());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = parse(createWorldSchema, await readJson(request));
    const world = await createWorldService(input);
    return ok({ worldId: world.id, world }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
