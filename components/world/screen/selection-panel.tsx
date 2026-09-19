"use client";

import { ChevronRight, Crosshair, Expand, LocateFixed, PanelRightClose } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { WorldDetail } from "@/lib/dto";
import { BIOME_LABELS } from "@/lib/client/format";
import { useWorldUi, type Selection } from "@/lib/client/store";
import { selectionContent } from "../entity-lists";
import { WorldTimeline } from "../world-timeline";
import { FloatingPanel } from "./floating-panel";

const KIND_LABELS: Record<Selection["kind"], string> = {
  cell: "Cella",
  settlement: "Insediamento",
  tribe: "Tribù",
  civilization: "Civiltà",
  person: "Personaggio",
  war: "Conflitto",
};

/** Name and place of the selection, for the panel header. */
export function selectionHeading(detail: WorldDetail, sel: Selection): { title: string; subtitle: string } {
  switch (sel.kind) {
    case "cell": {
      const biome = BIOME_LABELS[detail.map.biome[sel.y * detail.world.width + sel.x] ?? 0] ?? "Cella";
      return { title: biome, subtitle: `Cella ${sel.x}, ${sel.y}` };
    }
    case "settlement": {
      const s = detail.settlements.find((x) => x.id === sel.id);
      return {
        title: s?.name ?? "Insediamento",
        subtitle: s ? `${KIND_LABELS.settlement} · ${s.x}, ${s.y}` : "",
      };
    }
    case "tribe":
      return {
        title: detail.tribes.find((t) => t.id === sel.id)?.name ?? "Tribù",
        subtitle: KIND_LABELS.tribe,
      };
    case "civilization":
      return {
        title: detail.civilizations.find((c) => c.id === sel.id)?.name ?? "Civiltà",
        subtitle: KIND_LABELS.civilization,
      };
    case "person":
      return {
        title: detail.notablePeople.find((p) => p.id === sel.id)?.name ?? "Personaggio",
        subtitle: KIND_LABELS.person,
      };
    case "war": {
      const a = detail.tribes.find((t) => t.id === sel.aId)?.name ?? "?";
      const b = detail.tribes.find((t) => t.id === sel.bId)?.name ?? "?";
      return { title: `${a} contro ${b}`, subtitle: KIND_LABELS.war };
    }
  }
}

/** Map cell of a selection, from the world payload alone (for "centre on map"). */
export function placeOfSelection(
  detail: WorldDetail,
  sel: Selection | null,
): { x: number; y: number } | null {
  if (!sel) return null;
  const seatOf = (tribeId: string) => {
    const s = detail.settlements
      .filter((x) => x.tribeId === tribeId && x.status === "active")
      .sort((a, b) => b.population - a.population)[0];
    return s ?? detail.tribes.find((t) => t.id === tribeId) ?? null;
  };
  switch (sel.kind) {
    case "cell":
      return { x: sel.x, y: sel.y };
    case "settlement":
      return detail.settlements.find((s) => s.id === sel.id) ?? null;
    case "tribe":
      return seatOf(sel.id);
    case "civilization": {
      const civ = detail.civilizations.find((c) => c.id === sel.id);
      const capital = detail.settlements.find((s) => s.id === civ?.capitalSettlementId);
      return capital ?? (civ?.tribeIds[0] ? seatOf(civ.tribeIds[0]) : null);
    }
    case "war": {
      const a = seatOf(sel.aId);
      const b = seatOf(sel.bId);
      return a && b ? { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) } : (a ?? b);
    }
    case "person":
      return null;
  }
}

function actorOf(sel: Selection): string | undefined {
  if (sel.kind === "cell") return undefined;
  if (sel.kind === "war") return sel.aId;
  return sel.id;
}

/**
 * Contextual panel of the selected entity: floating on the right on desktop, a bottom sheet on
 * phones. It can be collapsed to a tab without losing the selection.
 */
export function SelectionPanel({
  detail,
  place,
}: {
  detail: WorldDetail;
  place: { x: number; y: number } | null;
}) {
  const { selection, select, focusOn, detailsCollapsed, setDetailsCollapsed, follow, setFollow } =
    useWorldUi();
  const [full, setFull] = useState(false);
  if (!selection) return null;
  const heading = selectionHeading(detail, selection);
  const content = selectionContent(detail, selection);
  const followable = selection.kind === "settlement" || selection.kind === "tribe";

  if (detailsCollapsed) {
    return (
      <button
        type="button"
        onClick={() => setDetailsCollapsed(false)}
        className="hud-glass text-parchment pointer-events-auto absolute top-[7.25rem] right-3 z-20 flex max-w-60 items-center gap-2 rounded-xl px-3 py-2 text-sm lg:top-[4.25rem]"
        aria-label={`Riapri il pannello: ${heading.title}`}
      >
        <ChevronRight className="size-4 rotate-180" aria-hidden />
        <span className="truncate">{heading.title}</span>
      </button>
    );
  }

  const actions = (
    <div className="flex shrink-0 items-center">
      {place && (
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Centra sulla mappa"
          title="Centra sulla mappa"
          onClick={() => focusOn(place.x, place.y, true)}
        >
          <LocateFixed />
        </Button>
      )}
      {followable && (
        <Button
          size="icon"
          variant="ghost"
          className={follow ? "text-ochre size-8" : "size-8"}
          aria-pressed={follow}
          aria-label={follow ? "Smetti di seguire" : "Segui dopo ogni avanzamento"}
          title="Segui"
          onClick={() => setFollow(!follow)}
        >
          <Crosshair />
        </Button>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Apri il dettaglio completo"
        title="Dettaglio completo"
        onClick={() => setFull(true)}
        disabled={!content}
      >
        <Expand />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="hidden size-8 sm:inline-flex"
        aria-label="Riduci il pannello"
        title="Riduci"
        onClick={() => setDetailsCollapsed(true)}
      >
        <PanelRightClose />
      </Button>
    </div>
  );

  return (
    <>
      <FloatingPanel
        role="complementary"
        title={heading.title}
        subtitle={heading.subtitle}
        onClose={() => select(null)}
        closeLabel="Chiudi il pannello e deseleziona"
        actions={actions}
        className="sm:top-[7.25rem] sm:right-3 sm:bottom-3 sm:w-[min(24rem,calc(100vw-6rem))] lg:top-[4.25rem]"
      >
        <div data-testid="selection-panel" className="[&_h2]:sr-only">
          {content ?? (
            <div className="text-muted grid gap-2 py-6 text-center text-sm" role="status">
              <p>Questo elemento non è più presente nel mondo.</p>
              <Button variant="ghost" onClick={() => select(null)}>
                Chiudi
              </Button>
            </div>
          )}
        </div>
      </FloatingPanel>
      <Dialog
        open={full}
        onClose={() => setFull(false)}
        title={heading.title}
        description={heading.subtitle}
        className="w-[min(1100px,calc(100vw-2rem))]"
      >
        {full && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div>{content}</div>
            {actorOf(selection) && (
              <section aria-label="Eventi collegati">
                <h3 className="mb-2 font-serif text-lg">Eventi collegati</h3>
                <WorldTimeline detail={detail} actorId={actorOf(selection)} />
              </section>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
