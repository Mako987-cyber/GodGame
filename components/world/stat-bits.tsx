import type { ReactNode } from "react";
import type { Stockpile } from "@genesis/simulation-core";
import { fmtDec, fmtInt } from "@/lib/client/format";

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

export function StockList({ stock }: { stock: Stockpile }) {
  return (
    <Facts
      items={[
        ["Cibo", fmtDec(stock.food)],
        ["Legname", fmtDec(stock.wood)],
        ["Pietra", fmtDec(stock.stone)],
        ["Rame", fmtInt(stock.copper)],
      ]}
    />
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
