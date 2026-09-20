import type { Tribe, WorldState } from "../types";

/**
 * Continuity of identities inside a world.
 *
 * An identity enters a world only through the founding roster. After that it can spread only
 * by descent (a split or a secession keeps `identityId` and records `parentTribeId`) and it
 * survives absorption as an entry of `absorbedIdentityIds`. Nothing ever creates a fresh
 * instance of an identity out of thin air.
 */

/** Keeps the identity of an absorbed or conquered people alive inside the host. */
export function recordAbsorbedIdentity(host: Tribe, absorbed: Tribe) {
  for (const identityId of [absorbed.identityId, ...absorbed.absorbedIdentityIds]) {
    if (!identityId || identityId === host.identityId || host.absorbedIdentityIds.includes(identityId))
      continue;
    host.absorbedIdentityIds.push(identityId);
  }
}

/** Violations of the continuity rules; empty when the world is consistent. */
export function checkIdentityLineage(state: WorldState): string[] {
  const problems: string[] = [];
  const tribes = new Map(state.tribes.map((t) => [t.id, t]));
  const founders = new Map((state.roster?.entries ?? []).map((e) => [e.tribeId, e.identityId]));
  for (const tribe of state.tribes) {
    if (tribe.identityId === null) {
      if (tribe.identityType === "historical")
        problems.push(`tribù ${tribe.id} dichiarata storica ma senza identità`);
      continue;
    }
    if (founders.get(tribe.id) === tribe.identityId) continue;
    // A people born from a fusion carries the composite identity created for it.
    const composite = state.composites?.find((c) => c.id === tribe.identityId);
    if (composite && composite.civilizationId === tribe.id && tribe.identityType === "composite") continue;
    const parent = tribe.parentTribeId ? tribes.get(tribe.parentTribeId) : undefined;
    if (!parent || parent.identityId !== tribe.identityId || parent.seq >= tribe.seq)
      problems.push(
        `identità ${tribe.identityId} della tribù ${tribe.id} non discende dal roster di fondazione`,
      );
  }
  for (const civ of state.civilizations) {
    const founder = tribes.get(civ.founderTribeId);
    if (founder && civ.identityId !== founder.identityId)
      problems.push(`civiltà ${civ.id} con identità diversa dalla tribù fondatrice`);
  }
  for (const tribe of state.tribes) {
    if (tribe.absorbedByTribeId && tribe.status !== "extinct")
      problems.push(`tribù ${tribe.id} assorbita ma ancora attiva`);
  }
  // Two living polities never share a name: a split always gets a distinct, related name.
  const active = new Set<string>();
  for (const tribe of state.tribes) {
    if (tribe.status === "extinct") continue;
    if (active.has(tribe.name)) problems.push(`due tribù attive si chiamano «${tribe.name}»`);
    active.add(tribe.name);
  }
  return problems;
}
