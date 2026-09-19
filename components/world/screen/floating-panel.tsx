"use client";

import { X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * A panel floating over the map. On phones it is a bottom sheet (never a fixed column that
 * shrinks the map); from `sm` up it sits where `className` places it. Esc closes it.
 */
export function FloatingPanel({
  title,
  subtitle,
  icon,
  onClose,
  closeLabel = "Chiudi pannello",
  actions,
  children,
  className,
  bodyClassName,
  labelledBy,
  role = "region",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  labelledBy?: string;
  role?: "region" | "dialog" | "complementary";
}) {
  const id = useId();
  return (
    <section
      role={role}
      aria-labelledby={labelledBy ?? id}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className={cn(
        "hud-glass animate-sheet-in sm:animate-panel-in pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex max-h-[62dvh] flex-col rounded-t-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:max-h-none sm:rounded-xl",
        className,
      )}
    >
      {/* Grab handle: a visual cue that the sheet sits over the map on phones. */}
      <div aria-hidden className="bg-line mx-auto mt-2 h-1 w-10 shrink-0 rounded-full sm:hidden" />
      <header className="border-line/70 flex items-start gap-2 border-b px-4 pt-2.5 pb-2 sm:pt-3">
        {icon && <span className="text-ochre mt-1 shrink-0 [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0 grow">
          <h2 id={id} className="text-parchment truncate font-serif text-lg leading-tight">
            {title}
          </h2>
          {subtitle && <p className="text-muted truncate text-xs">{subtitle}</p>}
        </div>
        {actions}
        <Button
          size="icon"
          variant="ghost"
          className="-mr-2 size-8 shrink-0"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <div className={cn("min-h-0 grow overflow-y-auto overscroll-contain px-4 py-3", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
