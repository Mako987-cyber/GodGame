/**
 * View model consumed by the isometric renderer.
 *
 * The renderer never sees DTOs, Drizzle rows or the simulation state: `view-model.ts` adapts
 * `WorldDetail` into these shapes, so the drawing code stays independent of storage and API.
 */

export type BiomeKind = "ocean" | "coast" | "plains" | "forest" | "hills" | "mountain" | "desert" | "tundra";

/** Visual class of a settlement: `city_state` and `town` both read as towns of different size. */
export type SettlementVisualTier = "camp" | "village" | "town" | "city" | "capital";

export interface MapCellViewModel {
  x: number;
  y: number;
  index: number;
  biome: BiomeKind;
  /** Raw altitude 0..1 from the terrain generator. */
  altitude: number;
  /** Discrete terrace level: 0 for water, 1..MAX_ELEVATION for land. */
  elevation: number;
  temperature: number;
  moisture: number;
  fertility: number;
  water: number;
  river: boolean;
  riverName: string | null;
  coastal: boolean;
  road: boolean;
  fields: number;
  pastures: number;
  wood: number;
  stone: number;
  fauna: number;
  maxFauna: number;
  copper: number;
  iron: number;
  tin: number;
  coal: number;
  clay: number;
  /** Index into `regions`, -1 when unclaimed. */
  region: number;
  /** Index into `tribeIds` of the owning tribe, -1 when unclaimed (war fronts are per tribe). */
  tribe: number;
  /** Index into `settlements`, -1 when none. */
  settlement: number;
  /** Stable per-cell noise in 0..1 derived from the world seed. */
  noise: number;
}

/**
 * A political region: an active civilization, or a tribe that does not belong to one.
 * Territory fill and borders are drawn per region, so tribes of the same civilization share a border.
 */
export interface RegionViewModel {
  id: string;
  kind: "civilization" | "tribe";
  name: string;
  color: string;
  tribeIds: string[];
  cellCount: number;
  /** Centroid of the territory in grid coordinates (cell centres), used for labels. */
  centroid: { x: number; y: number } | null;
}

export interface SettlementViewModel {
  id: string;
  name: string;
  x: number;
  y: number;
  tier: SettlementVisualTier;
  /** Tier as stored by the simulation (for labels). */
  rawTier: string;
  level: number;
  status: "active" | "abandoned";
  population: number;
  buildings: Record<string, number>;
  construction: { type: string; progress: number; required: number } | null;
  isCapital: boolean;
  epidemic: boolean;
  tribeId: string;
  tribeName: string;
  civilizationId: string | null;
  civilizationName: string | null;
  color: string;
  food: number;
  stability: number | null;
  techs: string[];
  foundedYear: number;
  abandonedYear: number | null;
  /** True when the settlement touches the sea or a river (ports and piers). */
  nearWater: boolean;
}

export interface NomadBandViewModel {
  id: string;
  name: string;
  x: number;
  y: number;
  population: number;
  color: string;
}

export interface CivilizationViewModel {
  id: string;
  name: string;
  color: string;
  capitalSettlementId: string | null;
  population: number;
  status: "active" | "collapsed";
}

export interface RoadViewModel {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface TradeRouteViewModel {
  id: string;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Settlements at both ends, when the partner has one (for selection highlight). */
  settlementIds: string[];
  volume: number;
}

export interface BattleViewModel {
  id: string;
  x: number;
  y: number;
  year: number;
  title: string;
  attackerWarriors: number;
  defenderWarriors: number;
  attackerLosses: number;
  defenderLosses: number;
}

export interface ConflictViewModel {
  id: string;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  aColor: string;
  bColor: string;
  phase: string;
  startYear: number | null;
  battles: number;
  hostility: number;
  /** Cell edges shared by the two sides' territories, merged into polylines (grid coordinates). */
  front: BorderPolyline[];
  /** Where the front marker goes: front centroid, latest battle or midpoint of the campaign. */
  anchor: { x: number; y: number };
  /** Campaign line when the two sides do not share a border. */
  campaign: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
  recentBattles: BattleViewModel[];
  casualties: number;
}

export interface HazardViewModel {
  id: string;
  kind: string;
  x: number;
  y: number;
  radius: number;
  severity: number;
}

export interface CrisisMarkerViewModel {
  id: string;
  kind: string;
  x: number;
  y: number;
  severity: number;
}

/** A polyline along cell edges, in grid-corner coordinates. */
export interface GridPolyline {
  points: { x: number; y: number }[];
  elevation: number;
}

export interface BorderPolyline extends GridPolyline {
  region: number;
  /** Border shared with a region this one is at war with. */
  contested: boolean;
  /** +1 when the region lies on the positive side of the run (y+ for horizontal, x+ for vertical). */
  side: 1 | -1;
}

export type SelectedMapEntity =
  | { kind: "cell"; x: number; y: number }
  | { kind: "settlement"; id: string }
  | { kind: "tribe"; id: string }
  | { kind: "civilization"; id: string }
  | { kind: "war"; aId: string; bId: string };

export interface MapLayerVisibility {
  terrain: boolean;
  elevation: boolean;
  water: boolean;
  rivers: boolean;
  settlements: boolean;
  buildings: boolean;
  resources: boolean;
  fertility: boolean;
  territories: boolean;
  roads: boolean;
  tradeRoutes: boolean;
  conflicts: boolean;
  labels: boolean;
  /** Thin hex outlines at medium and high zoom (hex view only). */
  hexGrid: boolean;
  /** Temperature tint (climate lens). */
  climate: boolean;
  debugGrid: boolean;
}

export type MapLayerId = keyof MapLayerVisibility;

export interface IsometricMapViewModel {
  width: number;
  height: number;
  seed: string;
  year: number;
  cells: MapCellViewModel[];
  /** Tribe id per `MapCellViewModel.tribe` index. */
  tribeIds: string[];
  regions: RegionViewModel[];
  settlements: SettlementViewModel[];
  nomads: NomadBandViewModel[];
  civilizations: CivilizationViewModel[];
  roads: RoadViewModel[];
  borders: BorderPolyline[];
  tradeRoutes: TradeRouteViewModel[];
  conflicts: ConflictViewModel[];
  hazards: HazardViewModel[];
  crises: CrisisMarkerViewModel[];
  selectedEntity?: SelectedMapEntity;
  layers: MapLayerVisibility;
}
