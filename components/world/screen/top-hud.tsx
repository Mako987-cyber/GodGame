"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Droplets,
  Landmark,
  Lightbulb,
  Mountain,
  Pickaxe,
  Scale,
  Swords,
  TreePine,
  Users,
  Wheat,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WorldDetail } from "@/lib/dto";
import { fmtInt, fmtYear, SEASON_LABELS, STATUS_LABELS } from "@/lib/client/format";
import { computeHudStats, fmtSigned, hudDeltas, trendOf, type HudKey, type HudStats } from "@/lib/client/hud";
import { cn } from "@/lib/utils/cn";

interface Chip {
  key: HudKey;
  label: string;
  icon: ReactNode;
  format: (v: number) => string;
  hint: string;
  /** Hidden on small screens. */
  secondary?: boolean;
}

const pct = (v: number) => `${Math.round(v)}`;
const CHIPS: Chip[] = [
  {
    key: "population",
    label: "Popolazione",
    icon: <Users />,
    format: fmtInt,
    hint: "Persone vive in tutto il mondo",
  },
  {
    key: "food",
    label: "Cibo",
    icon: <Wheat />,
    format: fmtInt,
    hint: "Scorte di cibo di insediamenti e tribù",
  },
  {
    key: "water",
    label: "Acqua",
    icon: <Droplets />,
    format: pct,
    hint: "Disponibilità media d'acqua nelle terre abitate (0–100)",
  },
  {
    key: "wood",
    label: "Legname",
    icon: <TreePine />,
    format: fmtInt,
    hint: "Legname immagazzinato",
    secondary: true,
  },
  {
    key: "stone",
    label: "Pietra",
    icon: <Mountain />,
    format: fmtInt,
    hint: "Pietra immagazzinata",
    secondary: true,
  },
  {
    key: "copper",
    label: "Metalli",
    icon: <Pickaxe />,
    format: fmtInt,
    hint: "Rame immagazzinato",
    secondary: true,
  },
  {
    key: "stability",
    label: "Stabilità",
    icon: <Scale />,
    format: pct,
    hint: "Stabilità media pesata sulla popolazione (100 = nessun disordine)",
  },
  {
    key: "technologies",
    label: "Tecnologie",
    icon: <Lightbulb />,
    format: fmtInt,
    hint: "Tecnologie scoperte",
  },
  { key: "wars", label: "Guerre", icon: <Swords />, format: fmtInt, hint: "Guerre in corso" },
  {
    key: "crises",
    label: "Crisi",
    icon: <AlertTriangle />,
    format: fmtInt,
    hint: "Crisi attive (epidemie, carestie, rivolte)",
    secondary: true,
  },
];

/** Keeps the figures of the previous tick, to show what changed with the last advance. */
function usePrevious(stats: HudStats): HudStats | null {
  const [state, setState] = useState<{ current: HudStats; previous: HudStats | null }>({
    current: stats,
    previous: null,
  });
  // Adjusting state while rendering is React's pattern for "value from the previous render".
  if (state.current.tick !== stats.tick) setState({ current: stats, previous: state.current });
  return state.previous;
}

function StatChip({ chip, value, delta }: { chip: Chip; value: number; delta: number | undefined }) {
  const trend = trendOf(chip.key, delta);
  const deltaText = delta !== undefined ? fmtSigned(delta, chip.format) : null;
  const alarm = (chip.key === "wars" || chip.key === "crises") && value > 0;
  const tip = `${chip.label}: ${chip.format(value)}${deltaText ? ` (${deltaText} dall'ultimo avanzamento)` : ""}. ${chip.hint}.`;
  return (
    <li
      className={cn(
        "group relative flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm",
        chip.secondary && "hidden 2xl:flex",
        alarm && "text-war",
      )}
      title={tip}
      aria-label={tip}
      tabIndex={0}
    >
      <span aria-hidden className={cn("[&_svg]:size-4", alarm ? "text-war" : "text-ochre")}>
        {chip.icon}
      </span>
      <span className="text-parchment font-medium tabular-nums">{chip.format(value)}</span>
      {deltaText && (
        <span
          aria-hidden
          className={cn(
            "text-[11px] tabular-nums",
            trend === "surplus" ? "text-growth" : trend === "deficit" ? "text-war" : "text-muted",
          )}
        >
          {deltaText}
        </span>
      )}
      {/* Tooltip on hover/focus (the title attribute stays for touch and screen readers). */}
      <span
        role="presentation"
        className="hud-glass text-muted pointer-events-none absolute top-full left-1/2 z-50 mt-2 hidden w-56 -translate-x-1/2 rounded-md px-2.5 py-1.5 text-xs group-hover:block group-focus-visible:block"
      >
        <span className="text-parchment block font-medium">{chip.label}</span>
        {chip.hint}
      </span>
    </li>
  );
}

/**
 * Strategic top bar: the world, its time and status, key resources with their change since the
 * last advance, time controls, notifications and the world menu.
 */
export function TopHud({
  detail,
  controls,
  unread,
  onToggleNotifications,
  notificationsOpen,
  overviewOpen,
  onToggleOverview,
  menu,
}: {
  detail: WorldDetail;
  controls: ReactNode;
  unread: number;
  notificationsOpen: boolean;
  onToggleNotifications: () => void;
  overviewOpen: boolean;
  onToggleOverview: () => void;
  menu: ReactNode;
}) {
  const { world } = detail;
  const stats = computeHudStats(detail);
  const previous = usePrevious(stats);
  const deltas = hudDeltas(stats, previous);
  const season = world.climate.definingSeason;
  const running = world.status === "running";
  const yearRef = useRef<HTMLSpanElement>(null);
  // Brief highlight of the year when time advances.
  useEffect(() => {
    const el = yearRef.current;
    if (!el) return;
    el.animate?.([{ color: "var(--color-ochre-strong)" }, { color: "inherit" }], { duration: 700 });
  }, [world.currentYear]);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-50 p-2 sm:p-3">
      <div className="hud-glass pointer-events-auto flex h-14 items-center gap-2 rounded-xl px-2 sm:gap-3 sm:px-3">
        <Link
          href="/worlds"
          className="text-muted hover:text-parchment hover:bg-raised grid size-9 shrink-0 place-items-center rounded-lg"
          aria-label="Torna all'elenco dei mondi"
          title="Torna ai mondi"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 shrink grow sm:grow-0">
          <h1 className="truncate font-serif text-base leading-tight sm:text-xl">{world.name}</h1>
          <p className="text-muted flex items-center gap-1.5 truncate text-[11px] leading-tight whitespace-nowrap">
            <span
              aria-hidden
              className={cn(
                "inline-block size-1.5 rounded-full",
                running ? "bg-growth animate-pulse" : "bg-muted",
              )}
            />
            {STATUS_LABELS[world.status]} · tick {fmtInt(world.currentTick)}
          </p>
        </div>

        <ul
          className="hidden min-w-0 grow items-center justify-center gap-0.5 lg:flex"
          aria-label="Risorse e indicatori del mondo"
        >
          {CHIPS.map((c) => (
            <StatChip key={c.key} chip={c} value={stats[c.key]} delta={deltas[c.key]} />
          ))}
        </ul>
        <span className="hidden grow sm:block lg:hidden" />

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <div
            className="text-right leading-tight"
            aria-label={`Anno ${fmtYear(world.currentYear)}, ${SEASON_LABELS[season] ?? season}`}
          >
            <span
              ref={yearRef}
              className="block font-serif text-base whitespace-nowrap tabular-nums sm:text-xl"
            >
              {fmtYear(world.currentYear)}
            </span>
            <span className="text-muted hidden text-[11px] sm:block">{SEASON_LABELS[season] ?? season}</span>
          </div>
          <span aria-hidden className="bg-line hidden h-8 w-px sm:block" />
          {controls}
          <span aria-hidden className="bg-line hidden h-8 w-px sm:block" />
          <button
            type="button"
            onClick={onToggleNotifications}
            aria-pressed={notificationsOpen}
            aria-label={unread > 0 ? `Notifiche: ${unread} nuove` : "Notifiche"}
            title="Notifiche"
            className="text-parchment/85 hover:bg-raised relative grid size-9 place-items-center rounded-lg"
          >
            <Bell className="size-4" />
            {unread > 0 && (
              <span className="bg-war text-parchment absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onToggleOverview}
            aria-pressed={overviewOpen}
            aria-label="Civiltà e insediamenti"
            title="Civiltà e insediamenti"
            className={cn(
              "hover:bg-raised grid size-9 place-items-center rounded-lg",
              overviewOpen ? "text-ochre bg-ochre/15" : "text-parchment/85",
            )}
          >
            <Landmark className="size-4" />
          </button>
          {menu}
        </div>
      </div>
      {/* Compact resource strip on tablets and phones, scrollable instead of wrapping. */}
      <ul
        className="hud-glass pointer-events-auto mt-2 flex items-center gap-0.5 overflow-x-auto rounded-xl px-1 lg:hidden"
        aria-label="Risorse e indicatori del mondo"
      >
        {CHIPS.filter((c) => !c.secondary).map((c) => (
          <StatChip key={c.key} chip={c} value={stats[c.key]} delta={deltas[c.key]} />
        ))}
      </ul>
    </header>
  );
}
