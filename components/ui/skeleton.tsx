import { cn } from "@/lib/utils/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bg-raised animate-pulse rounded-md", className)} />;
}
