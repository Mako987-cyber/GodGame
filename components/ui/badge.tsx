import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-none", {
  variants: {
    tone: {
      neutral: "bg-raised text-muted",
      ochre: "bg-ochre/15 text-ochre",
      war: "bg-war/15 text-war",
      growth: "bg-growth/15 text-growth",
      water: "bg-water/15 text-water",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
