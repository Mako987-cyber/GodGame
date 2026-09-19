"use client";

import { BIOME_LABELS } from "@/lib/client/format";
import type { MapLayerVisibility } from "@/lib/map-renderer";
import { BIOME_TOP, PALETTE, RESOURCE_COLORS } from "@/lib/map-renderer/color-palette";
import { RESOURCE_LABELS, type ResourceKind } from "@/lib/map-renderer/resource-renderer";
import { BIOME_ORDER } from "@/lib/map-renderer/view-model";

function Line({ color, dash, width = 3 }: { color: string; dash?: string; width?: number }) {
  return (
    <svg width="26" height="10" aria-hidden className="shrink-0">
      <line
        x1="2"
        y1="5"
        x2="24"
        y2="5"
        stroke={color}
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

function Hex({ color }: { color: string }) {
  return (
    <svg width="12" height="14" aria-hidden className="shrink-0">
      <polygon points="6,0 12,3.5 12,10.5 6,14 0,10.5 0,3.5" fill={color} />
    </svg>
  );
}

const TIERS: { label: string; desc: string; size: number; square: boolean; star?: boolean }[] = [
  { label: "Accampamento", desc: "tende e fuoco comune", size: 8, square: false },
  { label: "Villaggio", desc: "capanne, sala del capo, magazzino", size: 10, square: false },
  { label: "Città", desc: "strade, piazza, mercato, mura", size: 12, square: true },
  { label: "Capitale", desc: "palazzo, torri, alone dorato", size: 14, square: true, star: true },
];

/** Text legend: every symbol on the map is described here, never by colour alone. */
export function MapLegend({ layers }: { layers: MapLayerVisibility }) {
  return (
    <div className="text-xs">
      <h4 className="text-muted mb-1 tracking-wide uppercase">Biomi</h4>
      <ul className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1">
        {BIOME_ORDER.map((b, i) => (
          <li key={b} className="flex items-center gap-1.5">
            <Hex color={BIOME_TOP[b]} />
            {BIOME_LABELS[i]}
          </li>
        ))}
      </ul>
      <h4 className="text-muted mb-1 tracking-wide uppercase">Insediamenti</h4>
      <ul className="mb-3 grid gap-1">
        {TIERS.map((t) => (
          <li key={t.label} className="flex items-center gap-2">
            <span
              aria-hidden
              className="border-parchment inline-block shrink-0 border"
              style={{
                width: t.size,
                height: t.size,
                borderRadius: t.square ? 3 : 999,
                background: "#6d8fb0",
                borderColor: t.star ? PALETTE.gold : undefined,
                boxShadow: t.star ? `0 0 6px ${PALETTE.gold}` : undefined,
              }}
            />
            <span>
              <span className="text-parchment">{t.label}</span> <span className="text-muted">— {t.desc}</span>
            </span>
          </li>
        ))}
        <li className="text-muted">
          Lontano: icona per rango. Vicino: edifici, strade e mura reali dell&apos;insediamento.
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-2.5 shrink-0 rounded-full"
            style={{ background: PALETTE.war }}
          />
          Epidemia in corso
        </li>
      </ul>
      <h4 className="text-muted mb-1 tracking-wide uppercase">Linee</h4>
      <ul className="grid gap-1">
        <li className="flex items-center gap-2">
          <Line color={PALETTE.river} /> Fiume
        </li>
        <li className="flex items-center gap-2">
          <Line color={PALETTE.road} /> Strada
        </li>
        <li className="flex items-center gap-2">
          <Line color="#c9a0dc" width={2} /> Confine (colore della civiltà o tribù)
        </li>
        <li className="flex items-center gap-2">
          <svg width="26" height="10" aria-hidden className="shrink-0">
            <pattern id="legend-hatch" width="4" height="4" patternUnits="userSpaceOnUse">
              <path d="M-1,5 L5,-1" stroke="#fff4d6" strokeOpacity="0.6" />
            </pattern>
            <rect x="1" y="1" width="24" height="8" fill="url(#legend-hatch)" stroke="#c9a0dc" />
          </svg>
          Territorio selezionato (tratteggio + bordo rinforzato)
        </li>
        {layers.tradeRoutes && (
          <li className="flex items-center gap-2">
            <Line color={PALETTE.trade} dash="5 4" /> Rotta commerciale (spessore = volume)
          </li>
        )}
        {layers.conflicts && (
          <>
            <li className="flex items-center gap-2">
              <Line color={PALETTE.war} dash="5 3" /> Fronte di guerra o confine conteso
            </li>
            <li className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[#78180f] text-[9px]"
              >
                ⚔
              </span>
              Guerra (clic per i dettagli)
            </li>
            <li className="flex items-center gap-2">
              <Line color="#d6b25a" dash="4 3" width={2} /> Siccità, alluvione o incendio
            </li>
          </>
        )}
      </ul>
      {layers.resources && (
        <>
          <h4 className="text-muted mt-3 mb-1 tracking-wide uppercase">Risorse</h4>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {(Object.keys(RESOURCE_LABELS) as ResourceKind[]).map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block size-2.5 shrink-0 rounded-full"
                  style={{ background: RESOURCE_COLORS[k] }}
                />
                {RESOURCE_LABELS[k]}
              </li>
            ))}
          </ul>
          <p className="text-muted mt-1">
            A zoom basso le risorse vicine sono raggruppate; il numero indica quante sono.
          </p>
        </>
      )}
      {layers.climate && (
        <p className="text-muted mt-3 flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2.5 w-24 shrink-0 rounded-sm"
            style={{ background: "linear-gradient(90deg, #4f86c6, #e8e2b0, #d9622b)" }}
          />
          Clima: dal freddo (blu) al caldo (arancio).
        </p>
      )}
      {layers.fertility && (
        <p className="text-muted mt-3">Fertilità: dal bruno (sterile) al verde acceso (molto fertile).</p>
      )}
    </div>
  );
}
