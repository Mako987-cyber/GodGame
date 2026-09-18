import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main
      className="mx-auto grid max-w-[1500px] gap-5 px-4 py-6"
      aria-busy="true"
      aria-label="Caricamento del mondo"
    >
      <Skeleton className="h-28" />
      <Skeleton className="h-14" />
      <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Skeleton className="aspect-square" />
        <Skeleton className="h-96" />
      </div>
    </main>
  );
}
