import {
  getIdentity,
  HISTORICAL_IDENTITIES,
  IDENTITY_CATALOG_VERSION,
  politicalTitle,
  STARTING_CIVILIZATION_STATE,
  type GovernmentType,
} from "@genesis/simulation-core";
import { getDb, type Database } from "@/lib/db";
import { getCivilizationFacts, getPoliticalInstances, listEvents } from "@/lib/db/queries";
import type { CivilizationHistoryDTO } from "@/lib/dto";
import { AppError, notFound } from "@/lib/utils/errors";
import {
  civilizationHistorySchema,
  identityDetailSchema,
  identityPageSchema,
  worldCivilizationDetailSchema,
  worldCivilizationListSchema,
  type IdentityDetailDTO,
  type IdentityListQuery,
  type IdentityPageDTO,
  type IdentitySummaryDTO,
  type WorldCivilizationDetailDTO,
  type WorldCivilizationDTO,
  type WorldCivilizationListDTO,
} from "@/lib/validation/identity";
import { toIdentitySummary } from "./identity-dto";
import { toEventDTO } from "./world-service";

export { toIdentitySummary };

/**
 * Catalog of historical identities and the civilizations (political instances) of a world.
 *
 * The catalog is static: summaries are built once per server instance. World data is read
 * only; nothing here ever creates, renames or re-rolls a civilization.
 */

const SUMMARIES: readonly IdentitySummaryDTO[] = HISTORICAL_IDENTITIES.map(toIdentitySummary);

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function listIdentitiesService(query: IdentityListQuery): IdentityPageDTO {
  const term = query.search ? fold(query.search) : null;
  const matches = SUMMARIES.filter(
    (s) =>
      (!query.category || s.broadCategory === query.category) &&
      (!query.continent || s.continent === query.continent) &&
      (!term ||
        [s.key, s.displayName, ...s.aliases, ...s.geographicAssociations].some((v) =>
          fold(v).includes(term),
        )),
  );
  const start = (query.page - 1) * query.pageSize;
  return identityPageSchema.parse({
    items: matches.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: matches.length,
    catalogVersion: IDENTITY_CATALOG_VERSION,
  });
}

export function getIdentityService(key: string): IdentityDetailDTO {
  const identity = getIdentity(key);
  if (!identity) throw notFound("Identità");
  return identityDetailSchema.parse({
    ...toIdentitySummary(identity),
    shortName: identity.shortName,
    architecture: identity.visualProfile.architecture,
    modifiers: identity.behavioralModifiers.map((m) => ({ ...m })),
    representationNotes: identity.representationNotes,
    sources: identity.sources.map((s) => ({ ...s })),
    dataVersion: identity.dataVersion,
    startingState: {
      technologies: [...STARTING_CIVILIZATION_STATE.technologies],
      government: STARTING_CIVILIZATION_STATE.government,
      buildings: [...STARTING_CIVILIZATION_STATE.buildings],
    },
  });
}

type Instances = Awaited<ReturnType<typeof getPoliticalInstances>>;

function buildCivilizations(data: Instances): WorldCivilizationDTO[] {
  const { row, tribes, civilizations, populations, leaders } = data;
  const population = new Map(populations.map((p) => [p.tribeId, p.population]));
  const leaderById = new Map(leaders.map((l) => [l.id, l]));
  const civById = new Map(civilizations.map((c) => [c.id, c]));
  const founders = new Set((row?.roster?.entries ?? []).map((e) => e.tribeId));
  const children = new Map<string, string[]>();
  for (const t of tribes) {
    if (!t.parentTribeId) continue;
    children.set(t.parentTribeId, [...(children.get(t.parentTribeId) ?? []), t.id]);
  }
  return tribes.map((t) => {
    const government = (t.government ?? "clan") as GovernmentType;
    const leader = t.leaderId ? leaderById.get(t.leaderId) : undefined;
    const civ = t.civilizationId ? civById.get(t.civilizationId) : undefined;
    const status: WorldCivilizationDTO["status"] =
      t.status === "extinct"
        ? t.absorbedByTribeId
          ? "absorbed"
          : "dissolved"
        : t.parentTribeId
          ? "successor"
          : "active";
    return {
      id: t.id,
      displayName: t.name,
      color: t.color,
      identityId: t.identityId,
      identityType: t.identityType,
      emblemKey: getIdentity(t.identityId)?.visualProfile.emblemKey ?? null,
      status,
      lifecycle: t.status,
      foundedYear: t.foundedYear,
      endedYear: t.extinctYear,
      government,
      population: population.get(t.id) ?? 0,
      technologies: t.techs,
      leader: leader
        ? { id: leader.id, name: leader.name, age: leader.age, title: politicalTitle(government, leader.sex) }
        : null,
      state: civ
        ? { id: civ.id, name: civ.name, status: civ.status, formerNames: civ.formerNames ?? [] }
        : null,
      predecessorIds: t.parentTribeId ? [t.parentTribeId] : [],
      successorIds: children.get(t.id) ?? [],
      absorbedIdentityIds: t.absorbedIdentityIds ?? [],
      absorbedByTribeId: t.absorbedByTribeId,
      foundingMember: row?.roster ? founders.has(t.id) : t.parentTribeId === null,
    };
  });
}

async function load(worldId: string, db?: Database): Promise<Instances> {
  const data = await getPoliticalInstances(db ?? (await getDb()), worldId);
  if (!data.row) throw notFound();
  return data;
}

export async function listWorldCivilizationsService(
  worldId: string,
  deps?: { db: Database },
): Promise<WorldCivilizationListDTO> {
  const data = await load(worldId, deps?.db);
  return worldCivilizationListSchema.parse({
    worldId,
    historical: data.row?.roster != null,
    items: buildCivilizations(data),
  });
}

export async function getWorldCivilizationService(
  worldId: string,
  civilizationId: string,
  deps?: { db: Database },
): Promise<WorldCivilizationDetailDTO> {
  const db = deps?.db ?? (await getDb());
  const data = await load(worldId, db);
  const civ = buildCivilizations(data).find((c) => c.id === civilizationId);
  if (!civ) throw notFound("Civiltà");
  const facts = await getCivilizationFacts(db, worldId, civilizationId);
  const entry = data.row?.roster?.entries.find((e) => e.tribeId === civilizationId);
  const identity = getIdentity(civ.identityId);
  const settlementActor = facts.firstSettlement?.actors.find((a) => a.kind === "settlement");
  return worldCivilizationDetailSchema.parse({
    ...civ,
    identity: identity ? toIdentitySummary(identity) : null,
    founding: entry
      ? {
          tick: 0,
          initialLeaderName: entry.initialLeaderName,
          startingTechnologies: [...STARTING_CIVILIZATION_STATE.technologies],
          homeName: entry.homeName,
          startQuality: entry.startQuality,
          startWater: entry.startWater,
        }
      : null,
    firstSettlement:
      settlementActor && facts.firstSettlement
        ? { name: settlementActor.name, year: facts.firstSettlement.year }
        : null,
    realHistoryApplied: false,
    identityUsedAsFlavour: identity !== undefined,
  });
}

export async function getCivilizationHistoryService(
  worldId: string,
  civilizationId: string,
  query: { page: number; pageSize: number },
  deps?: { db: Database },
): Promise<CivilizationHistoryDTO> {
  const db = deps?.db ?? (await getDb());
  const data = await load(worldId, db);
  if (!data.tribes.some((t) => t.id === civilizationId)) throw notFound("Civiltà");
  const [facts, events] = await Promise.all([
    getCivilizationFacts(db, worldId, civilizationId),
    listEvents(db, worldId, { page: query.page, pageSize: query.pageSize, actorId: civilizationId }),
  ]);
  if (query.page > 1 && events.items.length === 0 && events.total > 0)
    throw new AppError("INVALID_INPUT", "Pagina oltre la fine della cronologia");
  const history: CivilizationHistoryDTO = {
    civilizationId,
    discoveries: facts.discoveries.map((d) => ({
      techId: d.techId,
      year: d.discoveredYear,
      method: d.method,
    })),
    leadership: facts.leaders.map((l) => ({ id: l.id, year: l.year, title: l.title, subtype: l.subtype })),
    events: {
      items: events.items.map(toEventDTO),
      page: query.page,
      pageSize: query.pageSize,
      total: events.total,
      totalPages: Math.max(1, Math.ceil(events.total / query.pageSize)),
    },
  };
  // Output contract checked like every other endpoint; the typed object is what is returned.
  civilizationHistorySchema.parse(history);
  return history;
}
