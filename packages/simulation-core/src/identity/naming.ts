import { deriveRng, type Rng } from "../prng";
import type { Sex } from "../types";
import type { HistoricalIdentityDefinition, NamingProfile } from "./definition";

/**
 * Identity-flavoured names.
 *
 * Every generator here draws from its *own* stream, derived from the world seed and the id
 * of the named entity, never from the simulation RNG. Two consequences, both intended:
 * - a name is reproducible from (seed, id) alone, however many times it is regenerated;
 * - the identity of a people cannot alter the course of the simulation through the RNG:
 *   swapping "Egizi" for "Inca" with modifiers off yields the very same history.
 */

const MAX_ATTEMPTS = 12;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function isReserved(profile: NamingProfile, name: string): boolean {
  const lower = name.toLocaleLowerCase("it");
  return profile.reservedNames.some((r) => r.toLocaleLowerCase("it") === lower);
}

function composeName(profile: NamingProfile, rng: Rng, sex: Sex | null): string {
  let name = rng.pick(profile.starts);
  if (rng.chance(profile.middleChance)) name += rng.pick(profile.middles);
  const ends = sex === "F" && profile.feminineEnds.length > 0 ? profile.feminineEnds : profile.ends;
  name += rng.pick(ends);
  return capitalize(name.replace(/^'+|'+$/g, ""));
}

function composePlace(profile: NamingProfile, rng: Rng): string {
  const stem = capitalize(rng.pick(profile.starts).replace(/'/g, "") + rng.pick(profile.placeEnds));
  const roll = rng.next();
  if (roll < 0.2 && profile.placePrefixes.length > 0) {
    const prefix = rng.pick(profile.placePrefixes);
    return prefix.endsWith("-") ? `${prefix}${stem}` : `${prefix} ${stem}`;
  }
  if (roll < 0.35 && profile.placeSuffixes.length > 0) {
    return `${stem}${rng.pick(profile.placeSuffixes)}`;
  }
  return stem;
}

/** Personal name for a person of the given identity; stable for the same (seed, personId). */
export function identityPersonName(profile: NamingProfile, nameSeed: string, sex: Sex): string {
  const rng = deriveRng(nameSeed, "person-name");
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const name = composeName(profile, rng, sex);
    if (name.length >= 2 && !isReserved(profile, name)) return name;
  }
  // Reserved collisions are rare; a longer name can never match a short reserved one.
  return composeName(profile, rng, sex) + rng.pick(profile.middles);
}

/**
 * Place name (settlement, first camp...) unique among `used`. Real historical cities listed in
 * `reservedNames` are rerolled.
 */
export function identityPlaceName(
  profile: NamingProfile,
  nameSeed: string,
  used: ReadonlySet<string>,
): string {
  const rng = deriveRng(nameSeed, "place-name");
  for (let i = 0; i < MAX_ATTEMPTS * 2; i++) {
    const name = composePlace(profile, rng);
    if (!used.has(name) && !isReserved(profile, name)) return name;
  }
  // Very crowded maps: append an ordinal instead of looping forever.
  const base = composePlace(profile, rng);
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

const DIRECTIONS = [
  { label: "del Nord", dx: 0, dy: -1 },
  { label: "del Sud", dx: 0, dy: 1 },
  { label: "dell'Est", dx: 1, dy: 0 },
  { label: "dell'Ovest", dx: -1, dy: 0 },
] as const;

/**
 * Name of a political instance that splits from another one of the same identity.
 * "Egizi del Nord" first, then "Egizi di <place>": the identity stays readable and the
 * relation with the parent is explicit, never an unrelated second "Egizi".
 */
export function successorName(
  identity: HistoricalIdentityDefinition,
  from: { x: number; y: number },
  to: { x: number; y: number },
  place: string,
  used: ReadonlySet<string>,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dir =
    Math.abs(dx) >= Math.abs(dy)
      ? (DIRECTIONS.find((d) => d.dx === Math.sign(dx) && dx !== 0) ?? null)
      : (DIRECTIONS.find((d) => d.dy === Math.sign(dy)) ?? null);
  const candidates = [
    ...(dir ? [`${identity.displayName} ${dir.label}`] : []),
    `${identity.displayName} di ${place}`,
  ];
  for (const name of candidates) if (!used.has(name)) return name;
  let n = 2;
  while (used.has(`${identity.displayName} di ${place} ${n}`)) n++;
  return `${identity.displayName} di ${place} ${n}`;
}
