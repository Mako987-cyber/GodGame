import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Section of the world page: a titled region separated by a rule, not a floating card. */
export function Panel({
  title,
  actions,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn("border-line bg-surface rounded-lg border", className)} {...props}>
      {(title || actions) && (
        <header className="border-line flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          {title && <h2 className="text-parchment font-serif text-lg">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
