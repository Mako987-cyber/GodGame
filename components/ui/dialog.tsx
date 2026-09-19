"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "./button";

/**
 * Modal dialog on the native <dialog> element: focus is trapped and restored by the browser,
 * Esc closes it (unless `dismissible` is false, e.g. while a destructive request is running).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  className,
  tone = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  className?: string;
  tone?: "default" | "danger";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, outside the panel).
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
      className={cn(
        "bg-surface text-parchment m-auto max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] rounded-xl border p-0 shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-[2px]",
        tone === "danger" ? "border-war/60" : "border-line",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <header className="border-line flex items-start justify-between gap-3 border-b px-5 py-4">
            <div className="grid gap-1">
              <h2 id={titleId} className={cn("font-serif text-2xl", tone === "danger" && "text-war")}>
                {title}
              </h2>
              {description && (
                <p id={descId} className="text-muted text-sm">
                  {description}
                </p>
              )}
            </div>
            <Button size="icon" variant="ghost" aria-label="Chiudi" disabled={!dismissible} onClick={onClose}>
              <X />
            </Button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="border-line flex flex-wrap justify-end gap-2 border-t px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
