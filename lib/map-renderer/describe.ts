/** Short textual descriptions of map targets, used by tooltips and the live region. */
import { BIOME_LABELS, PHASE_LABELS, TIER_LABELS, fmtInt, fmtYear } from "@/lib/client/format";
import type { HitTarget } from "./hit-testing";
import { RESOURCE_LABELS } from "./resource-renderer";
import type { IsometricMapViewModel } from "./types";
import { BIOME_ORDER } from "./view-model";

export interface TargetDescription {
  title: string;
  lines: string[];
}

function level(v: number): string {
  return v >= 0.66 ? "alta" : v >= 0.33 ? "media" : "bassa";
}

export function describeTarget(target: HitTarget, vm: IsometricMapViewModel): TargetDescription | null {
  switch (target.type) {
    case "cell": {
      const c = vm.cells[target.y * vm.width + target.x];
      if (!c) return null;
      const biome = BIOME_LABELS[BIOME_ORDER.indexOf(c.biome)] ?? c.biome;
      const region = vm.regions[c.region];
      const nearest = nearestSettlement(vm, c.x, c.y);
      const title =
        c.biome === "ocean"
          ? biome
          : c.fertility >= 0.66
            ? `${biome} fertile`
            : c.fertility < 0.2
              ? `${biome} arida`
              : biome;
      const lines = [`Coordinate: ${c.x}, ${c.y}`];
      if (c.biome !== "ocean") {
        lines.push(
          `Altitudine: ${c.elevation}`,
          `Acqua: ${level(c.water)}`,
          `Fertilità: ${Math.round(c.fertility * 100)}`,
        );
      }
      if (c.riverName) lines.push(`Fiume ${c.riverName}`);
      lines.push(`Proprietario: ${region ? region.name : "nessuno"}`);
      if (nearest) lines.push(`Insediamento vicino: ${nearest}`);
      return { title, lines };
    }
    case "settlement": {
      const s = vm.settlements.find((x) => x.id === target.id);
      if (!s) return null;
      const tier =
        s.isCapital && s.rawTier !== "capital"
          ? `${TIER_LABELS[s.rawTier] ?? s.rawTier}, capitale`
          : (TIER_LABELS[s.rawTier] ?? s.rawTier);
      if (s.status === "abandoned") {
        return {
          title: `Rovine di ${s.name}`,
          lines: [
            `Fondato nel ${fmtYear(s.foundedYear)}`,
            s.abandonedYear !== null ? `Abbandonato nel ${fmtYear(s.abandonedYear)}` : "Abbandonato",
          ],
        };
      }
      const lines = [
        `Tipo: ${tier}`,
        `Popolazione: ${fmtInt(s.population)}`,
        `${s.civilizationName ? "Civiltà" : "Tribù"}: ${s.civilizationName ?? s.tribeName}`,
        `Cibo: ${fmtInt(s.food)}`,
      ];
      if (s.stability !== null) lines.push(`Stabilità: ${s.stability}`);
      if (s.techs.length)
        lines.push(
          `Tecnologie: ${s.techs.slice(0, 3).join(", ")}${s.techs.length > 3 ? ` +${s.techs.length - 3}` : ""}`,
        );
      if (s.epidemic) lines.push("Epidemia in corso");
      if (s.construction) lines.push(`In costruzione: ${s.construction.type}`);
      return { title: s.name, lines };
    }
    case "building": {
      const s = vm.settlements.find((x) => x.id === target.settlementId);
      return { title: target.label, lines: s ? [`${s.name} · ${TIER_LABELS[s.rawTier] ?? s.rawTier}`] : [] };
    }
    case "resource":
      return {
        title: RESOURCE_LABELS[target.kind],
        lines: [
          target.count > 1 ? `${target.count} giacimenti in quest'area` : `Cella ${target.x}, ${target.y}`,
        ],
      };
    case "nomad": {
      const band = vm.nomads.find((n) => n.id === target.id);
      return band
        ? { title: band.name, lines: ["Tribù nomade", `Popolazione: ${fmtInt(band.population)}`] }
        : null;
    }
    case "conflict": {
      const c = vm.conflicts.find((x) => x.id === target.id);
      if (!c) return null;
      const lines = [`Fase: ${PHASE_LABELS[c.phase] ?? c.phase}`, `Battaglie: ${c.battles}`];
      if (c.startYear !== null) lines.push(`Dal ${fmtYear(c.startYear)}`);
      if (c.casualties > 0) lines.push(`Caduti recenti: ${fmtInt(c.casualties)}`);
      return { title: `${c.aName} contro ${c.bName}`, lines };
    }
    case "trade": {
      const r = vm.tradeRoutes.find((x) => x.id === target.id);
      return r
        ? { title: "Rotta commerciale", lines: [`${r.aName} ↔ ${r.bName}`, `Volume: ${fmtInt(r.volume)}`] }
        : null;
    }
  }
}

function nearestSettlement(vm: IsometricMapViewModel, x: number, y: number): string | null {
  let best: { name: string; d: number } | null = null;
  for (const s of vm.settlements) {
    if (s.status !== "active") continue;
    const d = Math.max(Math.abs(s.x - x), Math.abs(s.y - y));
    if (d <= 6 && (!best || d < best.d)) best = { name: s.name, d };
  }
  return best?.name ?? null;
}
