"use client";

import { cn } from "@/lib/utils/cn";

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

/** Minimal accessible tab list (roving selection with arrow keys). */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex flex-wrap gap-1", className)}>
      {items.map((item, i) => (
        <button
          key={item.value}
          role="tab"
          type="button"
          aria-selected={item.value === value}
          tabIndex={item.value === value ? 0 : -1}
          onClick={() => onChange(item.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
            if (next) onChange(next.value);
          }}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm transition-colors",
            item.value === value
              ? "bg-raised text-parchment shadow-[inset_0_-2px_0_var(--color-ochre)]"
              : "text-muted hover:text-parchment",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
