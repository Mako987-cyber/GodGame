"use client";

import type { WorldDetail } from "@/lib/dto";
import { fmtInt, fmtYear, PHASE_LABELS } from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import { useMapBattles } from "./map/use-map-battles";
import { EntityLink, Facts, Meter, SubHeading } from "./stat-bits";

/** A war between two tribes: state of the relationship plus the battles recorded in the chronicle. */
export function WarPanel({ aId, bId, detail }: { aId: string; bId: string; detail: WorldDetail }) {
  const { select, focusOn } = useWorldUi();
  const battles = useMapBattles(detail.world.id, detail.world.currentYear);
  const rel = detail.relationships.find(
    (r) => (r.aId === aId && r.bId === bId) || (r.aId === bId && r.bId === aId),
  );
  const a = detail.tribes.find((t) => t.id === aId);
  const b = detail.tribes.find((t) => t.id === bId);
  if (!rel || !a || !b) return <p className="text-muted text-sm">Questo conflitto non è più registrato.</p>;

  const events = (battles.data?.items ?? []).filter((e) => {
    const ids = e.actors.map((x) => x.id);
    return ids.includes(aId) && ids.includes(bId);
  });
  let warriors = 0;
  let losses = 0;
  for (const e of events) {
    const md = e.metadata;
    warriors = Math.max(warriors, (Number(md.attackerWarriors) || 0) + (Number(md.defenderWarriors) || 0));
    losses += (Number(md.attackerLosses) || 0) + (Number(md.defenderLosses) || 0);
  }

  return (
    <div>
      <h2 className="font-serif text-2xl">Guerra</h2>
      <p className="mb-3 flex flex-wrap items-center gap-1.5 text-sm">
        <EntityLink color={a.color} onClick={() => select({ kind: "tribe", id: a.id })}>
          {a.name}
        </EntityLink>
        <span className="text-muted">contro</span>
        <EntityLink color={b.color} onClick={() => select({ kind: "tribe", id: b.id })}>
          {b.name}
        </EntityLink>
      </p>
      <Facts
        items={[
          ["Stato", PHASE_LABELS[rel.phase] ?? rel.phase],
          ["Iniziata", rel.warStartYear !== null ? `anno ${fmtYear(rel.warStartYear)}` : "—"],
          ["Battaglie", fmtInt(rel.battles)],
          ["Adulti (combattenti possibili)", `${fmtInt(a.adults)} / ${fmtInt(b.adults)}`],
          ["Schieramento più grande", warriors ? `${fmtInt(warriors)} guerrieri` : "—"],
          ["Caduti recenti", battles.isLoading ? "…" : fmtInt(losses)],
        ]}
      />
      <div className="mt-3 grid gap-1.5">
        <Meter label="Ostilità" value={rel.hostility} tone="war" />
        <Meter label="Rancore" value={rel.conflictMemory} tone="war" />
        <Meter label="Fiducia" value={rel.trust} tone="growth" />
      </div>
      <SubHeading>Battaglie recenti</SubHeading>
      {battles.isError ? (
        <p className="text-muted text-sm">Cronaca delle battaglie non disponibile.</p>
      ) : events.length === 0 ? (
        <p className="text-muted text-sm">
          {battles.isLoading ? "Caricamento…" : "Nessuna battaglia negli ultimi anni."}
        </p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {events.slice(0, 8).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="hover:text-ochre text-left"
                onClick={() => e.x !== null && e.y !== null && focusOn(e.x, e.y, true)}
                disabled={e.x === null || e.y === null}
              >
                <span className="text-muted">{fmtYear(e.year)}</span> {e.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
