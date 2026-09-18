import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto grid max-w-xl gap-4 px-4 py-20">
      <h1 className="font-serif text-3xl">Questo mondo non esiste</h1>
      <p className="text-muted">Il link potrebbe essere sbagliato, oppure il mondo è stato eliminato.</p>
      <Link href="/worlds" className="text-ochre hover:text-ochre-strong">
        Vai all&apos;elenco dei mondi
      </Link>
    </main>
  );
}
