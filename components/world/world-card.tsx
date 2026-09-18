import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { WorldListItem } from "@/lib/dto";
import { EVENT_LABELS, fmtInt, fmtYear, STATUS_LABELS } from "@/lib/client/format";

export function WorldCard({ world }: { world: WorldListItem }) {
  const s = world.summary;
  return (
    <li>
      <Link
        href={`/worlds/${world.id}`}
        className="group border-line bg-surface hover:border-ochre/60 grid gap-3 rounded-lg border p-4 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="group-hover:text-ochre font-serif text-xl">{world.name}</h3>
            <p className="text-muted text-xs">
              Seed {world.seed} · {world.width}×{world.height}
            </p>
          </div>
          <Badge tone={world.status === "running" ? "growth" : "neutral"}>
            {STATUS_LABELS[world.status]}
          </Badge>
        </div>
        <p className="font-serif text-3xl leading-none">
          <span className="sr-only">Anno </span>
          {fmtYear(world.currentYear)}
        </p>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-muted text-xs">Popolazione</dt>
            <dd>{fmtInt(s.population)}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">Insediamenti</dt>
            <dd>{fmtInt(s.settlements)}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">Civiltà</dt>
            <dd>{fmtInt(s.civilizations)}</dd>
          </div>
        </dl>
        <p className="text-muted line-clamp-2 min-h-[2.5rem] text-sm">
          {s.lastEvent ? (
            <>
              <span className="text-parchment">{EVENT_LABELS[s.lastEvent.type] ?? s.lastEvent.type}:</span>{" "}
              {s.lastEvent.title} ({fmtYear(s.lastEvent.year)})
            </>
          ) : (
            "Nessun evento: la storia non è ancora cominciata."
          )}
        </p>
      </Link>
    </li>
  );
}
