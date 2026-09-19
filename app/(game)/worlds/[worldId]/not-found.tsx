import { MapPinOff } from "lucide-react";
import Link from "next/link";

/** Shown for unknown ids and for worlds that have just been deleted. */
export default function WorldNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="grid max-w-md justify-items-center gap-4 text-center">
        <MapPinOff className="text-muted size-10" aria-hidden />
        <h1 className="font-serif text-3xl">Mondo non disponibile</h1>
        <p className="text-muted">
          Questo mondo non esiste oppure è stato eliminato insieme a tutti i suoi dati.
        </p>
        <Link href="/worlds" className="text-ochre hover:text-ochre-strong">
          Torna all&apos;elenco dei mondi
        </Link>
      </div>
    </main>
  );
}
