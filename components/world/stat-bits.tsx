import type { ReactNode } from "react";
import type { Stockpile } from "@genesis/simulation-core";
import { fmtDec, RESOURCE_LABELS } from "@/lib/client/format";

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-muted text-xs">{label}</dt>
          <dd className="truncate">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Horizontal meter (0..1) with a text value next to it: the value never depends on color alone. */
export function Meter({
  label,
  value,
  tone = "ochre",
}: {
  label: string;
  value: number;
  tone?: "ochre" | "war" | "growth" | "water";
}) {
  const colors = { ochre: "bg-ochre", war: "bg-war", growth: "bg-growth", water: "bg-water" };
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <span
        className="bg-raised h-1.5 overflow-hidden rounded-full"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 100)}
        aria-label={label}
      >
        <span className={`block h-full rounded-full ${colors[tone]}`} style={{ width: `${v * 100}%` }} />
      </span>
      <span className="text-right">{Math.round(v * 100)}%</span>
    </div>
  );
}

/** Shows the four core resources plus anything the group actually holds. */
export function StockList({ stock }: { stock: Stockpile }) {
  const goods = Object.entries(stock.goods ?? {})
    .filter(([, amount]) => (amount ?? 0) > 0.05)
    .sort(([a], [b]) => a.localeCompare(b));
  const items: [string, ReactNode][] = [
    [RESOURCE_LABELS.food ?? "Cibo", fmtDec(stock.food)],
    [RESOURCE_LABELS.wood ?? "Legname", fmtDec(stock.wood)],
    [RESOURCE_LABELS.stone ?? "Pietra", fmtDec(stock.stone)],
    [RESOURCE_LABELS.copper ?? "Rame", fmtDec(stock.copper)],
    ...goods.map(([kind, amount]): [string, ReactNode] => [
      RESOURCE_LABELS[kind] ?? kind,
      fmtDec(amount ?? 0),
    ]),
  ];
  return <Facts items={items} />;
}

/** Culture traits are shown as a compact 0-100 list, never as a single "score". */
export function TraitList<T extends object>({
  traits,
  labels,
}: {
  traits: T;
  labels: Record<string, string>;
}) {
  const entries = Object.entries(traits).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  return (
    <div className="grid gap-1.5">
      {entries.map(([key, value]) => (
        // Culture traits are stored 0-100, stability indicators 0-1: both render as a meter.
        <Meter key={key} label={labels[key] ?? key} value={value > 1 ? value / 100 : value} />
      ))}
    </div>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-parchment mt-4 mb-2 font-serif text-base first:mt-0">{children}</h3>;
}

export function EntityLink({
  color,
  children,
  onClick,
}: {
  color?: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-parchment hover:text-ochre inline-flex items-center gap-1.5 text-left underline-offset-4 hover:underline"
    >
      {color && <span className="size-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden />}
      {children}
    </button>
  );
}
