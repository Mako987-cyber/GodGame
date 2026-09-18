"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function WorldError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto grid max-w-xl gap-4 px-4 py-20">
      <h1 className="font-serif text-3xl">Il mondo non si è caricato</h1>
      <p className="text-muted">
        {error.message || "Errore sconosciuto"}. Se il database non è raggiungibile, controlla la
        configurazione e riprova.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Riprova</Button>
        <Link href="/worlds" className="text-ochre hover:text-ochre-strong self-center">
          Torna ai mondi
        </Link>
      </div>
    </main>
  );
}
