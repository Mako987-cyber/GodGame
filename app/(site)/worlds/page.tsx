import type { Metadata } from "next";
import Link from "next/link";
import { DatabaseError } from "@/components/world/db-error";
import { WorldCard } from "@/components/world/world-card";
import type { WorldListItem } from "@/lib/dto";
import { listWorldsService } from "@/lib/services/world-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mondi" };

export default async function WorldsPage() {
  let worlds: WorldListItem[] = [];
  let error: string | null = null;
  try {
    worlds = await listWorldsService();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return (
    <main className="mx-auto grid max-w-[1500px] gap-6 px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-serif text-4xl">Mondi</h1>
        <Link href="/#nuovo-mondo" className="text-ochre hover:text-ochre-strong text-sm">
          Crea un mondo
        </Link>
      </div>
      {error ? (
        <DatabaseError message={error} />
      ) : worlds.length === 0 ? (
        <p className="text-muted">
          Nessun mondo salvato.{" "}
          <Link href="/#nuovo-mondo" className="text-ochre underline-offset-4 hover:underline">
            Creane uno dalla pagina iniziale.
          </Link>
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {worlds.map((w) => (
            <WorldCard key={w.id} world={w} />
          ))}
        </ul>
      )}
    </main>
  );
}
