import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorldScreen } from "@/components/world/screen/world-screen";
import { getWorldDetailService } from "@/lib/services/world-service";
import { AppError } from "@/lib/utils/errors";
import { worldIdSchema } from "@/lib/validation/world";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ worldId: string }> };

async function load(worldId: string) {
  if (!worldIdSchema.safeParse(worldId).success) notFound();
  try {
    return await getWorldDetailService(worldId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { worldId } = await params;
  if (!worldIdSchema.safeParse(worldId).success) return { title: "Mondo" };
  try {
    return { title: (await getWorldDetailService(worldId)).world.name };
  } catch {
    return { title: "Mondo" };
  }
}

export default async function WorldPage({ params }: Props) {
  const { worldId } = await params;
  const detail = await load(worldId);
  return <WorldScreen initial={detail} />;
}
