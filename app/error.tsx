"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto grid max-w-xl gap-4 px-4 py-20">
      <h1 className="font-serif text-3xl">Qualcosa si è interrotto</h1>
      <p className="text-muted">La pagina non è stata caricata: {error.message || "errore sconosciuto"}.</p>
      <Button onClick={reset} className="self-start">
        Riprova
      </Button>
    </main>
  );
}
