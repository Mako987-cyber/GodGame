"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * Popover menu with keyboard support: arrows move between items, Home/End jump, Esc closes and
 * gives focus back to the trigger, a click outside closes it.
 */
export function Menu({
  trigger,
  label,
  items,
  align = "end",
  className,
}: {
  trigger: (props: {
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string;
    onClick: () => void;
    ref: React.Ref<HTMLButtonElement>;
  }) => ReactNode;
  label: string;
  items: MenuItem[];
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };

  return (
    <div className={cn("relative", className)}>
      {trigger({
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": id,
        onClick: () => setOpen((o) => !o),
        ref: triggerRef,
      })}
      {open && (
        <div
          ref={listRef}
          id={id}
          role="menu"
          aria-label={label}
          className={cn(
            "border-line bg-abyss/97 absolute top-full z-50 mt-2 grid min-w-56 gap-0.5 rounded-lg border p-1.5 shadow-2xl backdrop-blur",
            align === "end" ? "right-0" : "left-0",
          )}
          onKeyDown={(e) => {
            const nodes = [
              ...(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ??
                []),
            ];
            const i = nodes.indexOf(document.activeElement as HTMLButtonElement);
            const go = (k: number) => nodes[(k + nodes.length) % nodes.length]?.focus();
            if (e.key === "ArrowDown") go(i + 1);
            else if (e.key === "ArrowUp") go(i - 1);
            else if (e.key === "Home") go(0);
            else if (e.key === "End") go(nodes.length - 1);
            else if (e.key === "Escape") close();
            else if (e.key === "Tab") close(false);
            else return;
            if (e.key !== "Tab") e.preventDefault();
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
              className={cn(
                "flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none disabled:opacity-40 [&_svg]:size-4",
                item.tone === "danger"
                  ? "text-war hover:bg-war/10 focus-visible:bg-war/10"
                  : "text-parchment hover:bg-raised focus-visible:bg-raised",
              )}
            >
              {item.icon}
              <span className="grow">{item.label}</span>
              {item.hint && <span className="text-muted text-xs">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
