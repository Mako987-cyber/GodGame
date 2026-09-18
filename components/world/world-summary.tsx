import { Badge } from "@/components/ui/badge";
import type { WorldDetail } from "@/lib/dto";
import { CRISIS_LABELS, fmtInt, fmtPct, fmtYear, SEASON_LABELS, STATUS_LABELS } from "@/lib/client/format";

export function WorldSummary({ detail }: { detail: WorldDetail }) {
  const { world } = detail;
  const s = world.summary;
  const climate = world.climate;
  // The last season of the simulated year is the one the world is living through.
  const season = climate.seasons.at(-1);
  const facts: [string, string][] = [
    ["Popolazione", fmtInt(s.population)],
    ["Tribù", fmtInt(s.tribes)],
    ["Insediamenti", fmtInt(s.settlements)],
    ["Civiltà", fmtInt(s.civilizations)],
    ["Tecnologie", `${s.technologies} / ${detail.technologies.length}`],
    ["Guerre in corso", fmtInt(detail.relationships.filter((r) => r.atWar).length)],
  ];
  const crises = detail.crises.slice(0, 3);
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
          {fmtInt(world.currentTick)}, motore v{world.simulationVersion}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {season && (
            <Badge tone={season.season === "winter" ? "water" : "growth"}>
              Ultima stagione: {SEASON_LABELS[season.season]}
            </Badge>
          )}
          {climate.harshWinter && <Badge tone="water">Inverno rigidissimo</Badge>}
          <span className="text-muted">
            Indice climatico {climate.modifier.toFixed(2)} · rigore invernale {fmtPct(climate.winterSeverity)}
          </span>
          {crises.map((c) => (
            <Badge key={c.id} tone="war">
              {CRISIS_LABELS[c.kind] ?? c.kind} fino al {fmtYear(c.untilYear)}
            </Badge>
          ))}
        </div>
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
