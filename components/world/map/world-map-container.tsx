"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import type { WorldDetail } from "@/lib/dto";
import { MAP_DEBUG_PANEL_DEFAULT, type MapMode } from "@/lib/client/map-config";
import { useWorldUi, type Selection } from "@/lib/client/store";
import {
  buildIsometricMapViewModel,
  describeTarget,
  type FrameStats,
  type HitTarget,
  type IsometricMapViewModel,
  type SelectedMapEntity,
} from "@/lib/map-renderer";
import { WorldMap } from "../world-map";
import { IsometricMapCanvas, type MapController } from "./isometric-map-canvas";
import { MapDebugPanel, type MapDebugPanelHandle } from "./map-debug-panel";
import { MapErrorBoundary } from "./map-error-boundary";
import { MapLayerControls } from "./map-layer-controls";
import { MapLegend } from "./map-legend";
import { MapToolbar } from "./map-toolbar";
import { useMapBattles } from "./use-map-battles";

const MODES: { value: MapMode; label: string }[] = [
  { value: "isometric", label: "Mappa isometrica" },
  { value: "debug", label: "Mappa tecnica" },
];

function toMapEntity(sel: Selection | null): SelectedMapEntity | undefined {
  if (!sel || sel.kind === "person") return undefined;
  return sel;
}

/** Map target → sidebar selection (buildings select their settlement, resources their cell). */
function toSelection(t: HitTarget): Selection {
  switch (t.type) {
    case "settlement":
      return { kind: "settlement", id: t.id };
    case "building":
      return { kind: "settlement", id: t.settlementId };
    case "nomad":
      return { kind: "tribe", id: t.id };
    case "conflict": {
      const [aId = "", bId = ""] = t.id.split(":");
      return { kind: "war", aId, bId };
    }
    case "trade":
      return { kind: "tribe", id: t.id.split(":")[0] ?? "" };
    case "resource":
    case "cell":
      return { kind: "cell", x: t.x, y: t.y };
  }
}

/** Where a selection is on the map, if it has a place. */
function selectionCell(sel: Selection | null, vm: IsometricMapViewModel, detail: WorldDetail) {
  if (!sel) return null;
  switch (sel.kind) {
    case "cell":
      return { x: sel.x, y: sel.y };
    case "settlement":
      return vm.settlements.find((s) => s.id === sel.id) ?? null;
    case "tribe": {
      const seat = vm.settlements
        .filter((s) => s.tribeId === sel.id && s.status === "active")
        .sort((a, b) => b.population - a.population)[0];
      return seat ?? detail.tribes.find((t) => t.id === sel.id) ?? null;
    }
    case "civilization": {
      const civ = vm.civilizations.find((c) => c.id === sel.id);
      const capital = vm.settlements.find((s) => s.id === civ?.capitalSettlementId);
      if (capital) return capital;
      const c = vm.regions.find((r) => r.id === sel.id)?.centroid;
      return c ? { x: Math.floor(c.x), y: Math.floor(c.y) } : null;
    }
    case "war": {
      const c = vm.conflicts.find(
        (w) => w.id === `${sel.aId}:${sel.bId}` || w.id === `${sel.bId}:${sel.aId}`,
      );
      return c ? { x: Math.floor(c.anchor.x), y: Math.floor(c.anchor.y) } : null;
    }
    case "person":
      return null;
  }
}

function selectionTarget(sel: Selection | null): HitTarget | null {
  if (!sel) return null;
  switch (sel.kind) {
    case "cell":
      return { type: "cell", x: sel.x, y: sel.y };
    case "settlement":
      return { type: "settlement", id: sel.id };
    case "tribe":
      return { type: "nomad", id: sel.id };
    case "war":
      return { type: "conflict", id: `${sel.aId}:${sel.bId}` };
    default:
      return null;
  }
}

export function WorldMapContainer({ detail }: { detail: WorldDetail }) {
  const { mapMode, setMapMode, mapLayers, toggleMapLayer, selection, select, focus, follow, setFollow } =
    useWorldUi();
  const battles = useMapBattles(detail.world.id, detail.world.currentYear);
  const controller = useRef<MapController>(null);
  const debugRef = useRef<MapDebugPanelHandle>(null);
  const [hover, setHover] = useState<HitTarget | null>(null);
  const [panel, setPanel] = useState<"layers" | "legend" | null>(null);
  const [debugOpen, setDebugOpen] = useState(MAP_DEBUG_PANEL_DEFAULT);
  const [error, setError] = useState<Error | null>(null);

  const base = useMemo(
    () =>
      detail.map.biome.length ? buildIsometricMapViewModel(detail, { battles: battles.data?.items }) : null,
    [detail, battles.data],
  );
  const selectedEntity = useMemo(() => toMapEntity(selection), [selection]);
  const viewModel = useMemo(
    () => (base ? { ...base, layers: mapLayers, selectedEntity } : null),
    [base, mapLayers, selectedEntity],
  );

  const onSelect = useCallback((t: HitTarget) => select(toSelection(t)), [select]);
  const onStats = useCallback((s: FrameStats) => debugRef.current?.update(s), []);
  const onError = useCallback((e: Error) => {
    console.error("[map] isometric renderer failed", e);
    setError(e);
  }, []);

  const place = viewModel ? selectionCell(selection, viewModel, detail) : null;
  const centerSelection = place
    ? () => controller.current?.flyToCell(place.x, place.y, selection?.kind === "settlement" ? 0.7 : 0)
    : null;
  const followable = selection?.kind === "settlement" || selection?.kind === "tribe";

  // Follow mode: after every simulation batch, bring the followed entity back to the centre.
  const tick = detail.world.currentTick;
  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  });
  useEffect(() => {
    const p = placeRef.current;
    if (follow && p) controller.current?.flyToCell(p.x, p.y);
  }, [tick, follow]);
  useEffect(() => {
    if (!followable && follow) setFollow(false);
  }, [followable, follow, setFollow]);

  const announcement = useMemo(() => {
    const t = selectionTarget(selection);
    const d = t && viewModel ? describeTarget(t, viewModel) : null;
    return d ? `Selezionato: ${d.title}. ${d.lines.slice(0, 2).join(". ")}` : "";
  }, [selection, viewModel]);

  const modeTabs = <Tabs label="Tipo di mappa" items={MODES} value={mapMode} onChange={setMapMode} />;

  if (mapMode === "debug") {
    return (
      <div className="grid gap-3">
        {modeTabs}
        <WorldMap detail={detail} />
      </div>
    );
  }

  if (!viewModel) {
    return (
      <div className="grid gap-3">
        {modeTabs}
        <div className="border-line text-muted grid h-[50vh] place-items-center rounded-md border text-sm">
          Questo mondo non ha ancora una mappa da mostrare.
        </div>
      </div>
    );
  }

  const fallback = (e: Error, reset: () => void) => (
    <div
      role="alert"
      className="border-war/50 grid h-full place-items-center rounded-md border p-6 text-center"
    >
      <div className="grid max-w-sm justify-items-center gap-3">
        <AlertTriangle className="text-war size-8" aria-hidden />
        <p className="text-parchment font-serif text-lg">
          La mappa isometrica non è riuscita a disegnare il mondo.
        </p>
        <p className="text-muted text-sm">{e.message}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              reset();
            }}
          >
            Riprova
          </Button>
          <Button variant="primary" onClick={() => setMapMode("debug")}>
            Usa la mappa tecnica
          </Button>
        </div>
      </div>
    </div>
  );

  const sheet = selectionTarget(selection);
  const sheetText = sheet ? describeTarget(sheet, viewModel) : null;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {modeTabs}
        {battles.isError && <span className="text-muted text-xs">Battaglie recenti non disponibili.</span>}
      </div>
      <div className="border-line relative h-[62svh] min-h-[340px] overflow-hidden rounded-md border sm:h-[min(74vh,780px)]">
        <MapErrorBoundary fallback={fallback}>
          {error ? (
            fallback(error, () => setError(null))
          ) : (
            <>
              <IsometricMapCanvas
                ref={controller}
                viewModel={viewModel}
                hoverTarget={hover}
                focus={focus}
                onHover={setHover}
                onSelect={onSelect}
                onStats={debugOpen ? onStats : undefined}
                onError={onError}
              />
              <MapToolbar
                onZoomIn={() => controller.current?.zoomBy(1.4)}
                onZoomOut={() => controller.current?.zoomBy(1 / 1.4)}
                onReset={() => controller.current?.resetView()}
                onCenterWorld={() => controller.current?.centerWorld()}
                onCenterSelection={centerSelection}
                follow={follow}
                onToggleFollow={followable ? () => setFollow(!follow) : null}
                layersOpen={panel === "layers"}
                onToggleLayers={() => setPanel((p) => (p === "layers" ? null : "layers"))}
                legendOpen={panel === "legend"}
                onToggleLegend={() => setPanel((p) => (p === "legend" ? null : "legend"))}
                debugOpen={debugOpen}
                onToggleDebug={() => setDebugOpen((d) => !d)}
              />
              {panel === "layers" && (
                <MapLayerControls
                  layers={mapLayers}
                  onToggle={toggleMapLayer}
                  onClose={() => setPanel(null)}
                />
              )}
              {panel === "legend" && <MapLegend layers={mapLayers} onClose={() => setPanel(null)} />}
              {debugOpen && <MapDebugPanel ref={debugRef} />}
              {sheetText && !panel && (
                // Bottom sheet on small screens; on wide screens the sidebar sits next to the map.
                <div className="border-line bg-abyss/95 absolute inset-x-2 bottom-2 z-20 rounded-lg border p-3 shadow-xl backdrop-blur xl:hidden">
                  <p className="text-parchment font-serif text-base">{sheetText.title}</p>
                  <p className="text-muted text-xs">{sheetText.lines.slice(0, 3).join(" · ")}</p>
                  <button
                    type="button"
                    className="text-ochre mt-1 inline-flex items-center gap-1 text-sm"
                    onClick={() =>
                      document.getElementById("world-detail")?.scrollIntoView({ behavior: "smooth" })
                    }
                  >
                    Dettagli <ChevronDown className="size-4" aria-hidden />
                  </button>
                </div>
              )}
            </>
          )}
        </MapErrorBoundary>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <p className="text-muted hidden text-xs sm:block">
        Trascina per spostarti, rotella per lo zoom, clic su un insediamento per i dettagli. Più ti avvicini,
        più dettagli compaiono: villaggi, strade, edifici, campi.
      </p>
    </div>
  );
}
