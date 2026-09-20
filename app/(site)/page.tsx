import Link from "next/link";
import { CreateWorldForm } from "@/components/world/create-world-form";
import { DatabaseError } from "@/components/world/db-error";
import { WorldCard } from "@/components/world/world-card";
import type { WorldListItem } from "@/lib/dto";
import { listWorldsService } from "@/lib/services/world-service";
import { describeError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let worlds: WorldListItem[] = [];
  let error: string | null = null;
  try {
    worlds = (await listWorldsService()).slice(0, 6);
  } catch (e) {
    error = describeError(e);
  }

  return (
    <main className="mx-auto grid max-w-[1500px] gap-12 px-4 py-10">
      <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="max-w-xl pt-2">
          <h1 className="font-serif text-5xl leading-[1.05] sm:text-6xl">Ogni seme contiene una storia.</h1>
          <p className="text-muted mt-5 text-lg leading-relaxed">
            Genesis genera una terra dal nulla e vi colloca poche tribù di cacciatori-raccoglitori. Da lì,
            anno dopo anno, cercano cibo, migrano, fondano villaggi, scoprono l&apos;agricoltura e la
            scrittura, commerciano e si fanno la guerra.
          </p>
          <p className="text-muted mt-3 leading-relaxed">
            Nessuno scrive la trama: ogni evento nasce da risorse, geografia, popolazione e relazioni,
            calcolato con regole esplicite e casualità riproducibile.
          </p>
        </div>
        <CreateWorldForm />
      </section>

      <section aria-labelledby="recenti" className="grid gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="recenti" className="font-serif text-3xl">
            Mondi recenti
          </h2>
          {worlds.length > 0 && (
            <Link href="/worlds" className="text-ochre hover:text-ochre-strong text-sm">
              Tutti i mondi
            </Link>
          )}
        </div>
        {error ? (
          <DatabaseError message={error} />
        ) : worlds.length === 0 ? (
          <p className="text-muted">
            Non esiste ancora nessun mondo. Scegli un seed qui sopra e crea il primo.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {worlds.map((w) => (
              <WorldCard key={w.id} world={w} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
