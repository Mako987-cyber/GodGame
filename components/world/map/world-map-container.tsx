"use client";

import { AlertTriangle, Info, Layers } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WorldDetail } from "@/lib/dto";
import { MAP_DEBUG_PANEL_DEFAULT } from "@/lib/client/map-config";
import { useWorldUi, type Selection } from "@/lib/client/store";
import {
  buildIsometricMapViewModel,
  describeTarget,
  type FrameStats,
  type HitTarget,
  type IsometricMapViewModel,
  type SelectedMapEntity,
} from "@/lib/map-renderer";
import { FloatingPanel } from "../screen/floating-panel";
import { WorldMap } from "../world-map";
import { MapCanvas, type MapController, type MapViewState } from "./map-canvas";
import { MapDebugPanel, type MapDebugPanelHandle } from "./map-debug-panel";
import { MapErrorBoundary } from "./map-error-boundary";
import { MapLayerControls } from "./map-layer-controls";
import { MapLegend } from "./map-legend";
import { MapToolbar } from "./map-toolbar";
import { Minimap, type MinimapHandle } from "./minimap";
import { useMapBattles } from "./use-map-battles";

function toMapEntity(sel: Selection | null): SelectedMapEntity | undefined {
  if (!sel || sel.kind === "person") return undefined;
  return sel;
}

/** Map target → selection (buildings select their settlement, resources their cell). */
export function toSelection(t: HitTarget): Selection {
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
export function selectionCell(sel: Selection | null, vm: IsometricMapViewModel, detail: WorldDetail) {
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

/**
 * The full-screen map: canvas behind everything, the vertical toolbar, the minimap and the
 * layer/legend panels floating over it. The debug renderer is the technical top-down map.
 */
export function WorldMapContainer({ detail }: { detail: WorldDetail }) {
  const ui = useWorldUi();
  const { mapMode, setMapMode, mapLayers, toggleMapLayer, selection, select, focus, follow, setFollow } = ui;
  const battles = useMapBattles(detail.world.id, detail.world.currentYear);
  const controller = useRef<MapController>(null);
  const debugRef = useRef<MapDebugPanelHandle>(null);
  const minimapRef = useRef<MinimapHandle>(null);
  const [hover, setHover] = useState<HitTarget | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const debugOpen = ui.debugStats || MAP_DEBUG_PANEL_DEFAULT;

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
  const onView = useCallback((v: MapViewState) => minimapRef.current?.update(v), []);
  const onError = useCallback((e: Error) => {
    console.error("[map] renderer failed", e);
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

  const panels = (
    <>
      {ui.panel === "layers" && (
        <FloatingPanel
          title="Livelli e lenti"
          icon={<Layers />}
          onClose={ui.closePanel}
          className="sm:top-[7.25rem] sm:left-[4.25rem] sm:max-h-[calc(100dvh-13rem)] sm:w-72 lg:top-[4.25rem] lg:max-h-[calc(100dvh-10rem)]"
        >
          <MapLayerControls
            layers={mapLayers}
            onToggle={toggleMapLayer}
            mode={mapMode}
            onModeChange={setMapMode}
            debugStats={ui.debugStats}
            onToggleDebugStats={() => ui.setDebugStats(!ui.debugStats)}
          />
        </FloatingPanel>
      )}
      {ui.panel === "legend" && (
        <FloatingPanel
          title="Legenda"
          icon={<Info />}
          onClose={ui.closePanel}
          className="sm:top-[7.25rem] sm:left-[4.25rem] sm:max-h-[calc(100dvh-13rem)] sm:w-80 lg:top-[4.25rem] lg:max-h-[calc(100dvh-10rem)]"
        >
          <MapLegend layers={mapLayers} />
        </FloatingPanel>
      )}
    </>
  );

  const toolbar = (
    <div className="pointer-events-none absolute top-[7.25rem] left-3 z-20 lg:top-[4.25rem]">
      <MapToolbar
        mode={mapMode}
        layers={mapLayers}
        onToggleLayer={toggleMapLayer}
        onZoomIn={() => controller.current?.zoomBy(1.4)}
        onZoomOut={() => controller.current?.zoomBy(1 / 1.4)}
        onCenterWorld={() => controller.current?.resetView()}
        onCenterSelection={centerSelection}
        follow={follow}
        onToggleFollow={followable ? () => setFollow(!follow) : null}
        minimap={ui.minimap}
        onToggleMinimap={() => ui.setMinimap(!ui.minimap)}
        layersOpen={ui.panel === "layers"}
        onToggleLayers={() => ui.togglePanel("layers")}
        legendOpen={ui.panel === "legend"}
        onToggleLegend={() => ui.togglePanel("legend")}
        statsOpen={debugOpen}
        onToggleStats={() => ui.setDebugStats(!ui.debugStats)}
      />
    </div>
  );

  if (mapMode === "debug") {
    return (
      <>
        <div className="absolute inset-0 overflow-auto px-4 pt-[7.5rem] pb-28 sm:pl-20 lg:pt-[4.5rem]">
          <div className="hud-glass mx-auto w-[min(100%,calc(100dvh-4rem))] rounded-xl p-3">
            <WorldMap detail={detail} />
          </div>
        </div>
        {toolbar}
        {panels}
      </>
    );
  }

  if (!viewModel) {
    return (
      <div className="text-muted absolute inset-0 grid place-items-center text-sm">
        Questo mondo non ha ancora una mappa da mostrare.
      </div>
    );
  }

  const fallback = (e: Error, reset: () => void) => (
    <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center">
      <div className="hud-glass grid max-w-sm justify-items-center gap-3 rounded-xl p-6">
        <AlertTriangle className="text-war size-8" aria-hidden />
        <p className="text-parchment font-serif text-lg">La mappa non è riuscita a disegnare il mondo.</p>
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

  const kind = mapMode === "isometric" ? "isometric" : "hex";
  return (
    <>
      <div className="absolute inset-0" data-testid="world-map" data-map-kind={kind}>
        <MapErrorBoundary fallback={fallback}>
          {error ? (
            fallback(error, () => setError(null))
          ) : (
            <MapCanvas
              ref={controller}
              kind={kind}
              viewModel={viewModel}
              hoverTarget={hover}
              focus={focus}
              onHover={setHover}
              onSelect={onSelect}
              onStats={debugOpen ? onStats : undefined}
              onError={onError}
              onViewChange={kind === "hex" && ui.minimap ? onView : undefined}
            />
          )}
        </MapErrorBoundary>
      </div>
      {toolbar}
      {kind === "hex" && ui.minimap && !error && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-20 hidden sm:block">
          <Minimap
            ref={minimapRef}
            viewModel={viewModel}
            selection={place}
            large={ui.minimapLarge}
            onToggleSize={() => ui.setMinimapLarge(!ui.minimapLarge)}
            onClose={() => ui.setMinimap(false)}
            onNavigate={(x, y, immediate) => controller.current?.centerOnWorld(x, y, immediate)}
          />
        </div>
      )}
      {debugOpen && (
        <div className="pointer-events-none absolute top-[7.25rem] left-[4.25rem] z-10 hidden sm:block lg:top-[4.25rem]">
          <MapDebugPanel ref={debugRef} />
        </div>
      )}
      {panels}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
