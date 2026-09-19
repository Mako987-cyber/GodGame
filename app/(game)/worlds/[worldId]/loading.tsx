import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main
      className="bg-abyss relative h-dvh overflow-hidden"
      aria-busy="true"
      aria-label="Caricamento del mondo"
    >
      <Skeleton className="absolute inset-0 rounded-none opacity-40" />
      <div className="absolute inset-x-3 top-3 flex gap-3">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="hidden h-12 grow sm:block" />
        <Skeleton className="h-12 w-40" />
      </div>
      <p className="text-muted absolute inset-0 grid place-items-center font-serif text-lg">
        Il mondo prende forma…
      </p>
    </main>
  );
}
