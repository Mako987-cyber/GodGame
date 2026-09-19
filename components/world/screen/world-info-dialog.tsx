"use client";

import { Dialog } from "@/components/ui/dialog";
import type { WorldDetail } from "@/lib/dto";
import { fmtInt, fmtYear } from "@/lib/client/format";
import { IDENTITY_DISCLAIMER, ROSTER_MODE_LABELS } from "@/lib/client/identity";
import { HEX_SIZE, MAP_OFFSET_LAYOUT, MAP_ORIENTATION } from "@/lib/map-renderer";
import { IdentityEmblem } from "../identity-emblem";
import { WorldSummary } from "../world-summary";

/** World facts, climate and the last snapshot. */
export function WorldInfoDialog({
  detail,
  open,
  onClose,
  focus,
}: {
  detail: WorldDetail;
  open: boolean;
  onClose: () => void;
  focus?: "snapshot";
}) {
  const snap = detail.lastSnapshot;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={focus === "snapshot" ? "Snapshot" : "Informazioni sul mondo"}
      className="w-[min(900px,calc(100vw-2rem))]"
    >
      <div className="grid gap-5">
        {focus !== "snapshot" && <WorldSummary detail={detail} />}
        {focus !== "snapshot" && detail.roster && (
          <section className="grid gap-2 text-sm">
            <h3 className="font-serif text-lg">Roster di fondazione</h3>
            <p className="text-muted">
              Modalità {ROSTER_MODE_LABELS[detail.roster.mode]?.label.toLowerCase() ?? detail.roster.mode} ·
              modificatori culturali {detail.roster.enableIdentityModifiers ? "attivi" : "disattivati"} ·
              posizionamento {detail.roster.balancedPlacement ? "bilanciato" : "libero"}. Assegnato una sola
              volta alla creazione del mondo.
            </p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {detail.roster.entries.map((e) => (
                <li key={e.tribeId} className="flex items-center gap-2">
                  <IdentityEmblem emblemKey={e.emblemKey} color={e.color} size="sm" />
                  <span>{e.displayName}</span>
                  <span className="text-muted text-xs">
                    guida iniziale {e.initialLeaderName ?? "—"}, {fmtInt(e.population)} persone
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted text-xs italic">{IDENTITY_DISCLAIMER}</p>
          </section>
        )}
        <section className="grid gap-1 text-sm">
          <h3 className="font-serif text-lg">Snapshot</h3>
          {snap ? (
            <p className="text-muted">
              L&apos;ultimo snapshot completo dello stato è stato salvato al tick {fmtInt(snap.tick)} (anno{" "}
              {fmtYear(snap.year)}). Gli snapshot vengono creati automaticamente dalla simulazione e servono
              come base per verifiche e ripristini.
            </p>
          ) : (
            <p className="text-muted">
              Nessuno snapshot ancora: vengono salvati automaticamente durante la simulazione.
            </p>
          )}
          <p className="text-muted">L&apos;esportazione dei dati non è ancora disponibile.</p>
        </section>
        <section className="text-muted grid gap-1 text-xs">
          <h3 className="text-parchment font-serif text-base">Mappa</h3>
          <p>
            Esagoni {MAP_ORIENTATION === "pointy" ? "a punta in alto" : "a lato piatto in alto"}, coordinate
            offset {MAP_OFFSET_LAYOUT} ({detail.world.width}×{detail.world.height} celle, raggio {HEX_SIZE} px
            a zoom 1). La simulazione conserva la sua griglia: ogni cella (x, y) è l&apos;esagono in colonna
            x, riga y.
          </p>
        </section>
      </div>
    </Dialog>
  );
}
