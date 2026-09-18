import { Badge } from "@/components/ui/badge";
import type { WorldDetail } from "@/lib/dto";
import { fmtInt, fmtYear, STATUS_LABELS } from "@/lib/client/format";

export function WorldSummary({ detail }: { detail: WorldDetail }) {
  const { world } = detail;
  const s = world.summary;
  const facts: [string, string][] = [
    ["Popolazione", fmtInt(s.population)],
    ["Tribù", fmtInt(s.tribes)],
    ["Insediamenti", fmtInt(s.settlements)],
    ["Civiltà", fmtInt(s.civilizations)],
    ["Tecnologie", `${s.technologies} / ${detail.technologies.length}`],
    ["Guerre in corso", fmtInt(detail.relationships.filter((r) => r.atWar).length)],
  ];
  return (
    <header className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-serif text-3xl sm:text-4xl">{world.name}</h1>
          <Badge tone={world.status === "running" ? "growth" : "neutral"}>
            {STATUS_LABELS[world.status]}
          </Badge>
        </div>
        <p className="text-muted text-sm">
          Seed <span className="text-parchment">{world.seed}</span>, mappa {world.width}×{world.height}, tick{" "}
          {fmtInt(world.currentTick)}
          {detail.world.climate.droughts > 0 && <span className="text-ochre">, siccità in corso</span>}
        </p>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-2 sm:grid-cols-6">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted text-xs">{label}</dt>
              <dd className="text-lg">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="font-serif leading-none lg:text-right" aria-label={`Anno ${fmtYear(world.currentYear)}`}>
        <span className="text-muted block text-sm">Anno</span>
        <span className="text-6xl sm:text-7xl xl:text-8xl">{fmtYear(world.currentYear)}</span>
      </p>
    </header>
  );
}
