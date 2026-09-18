import type { Rng } from "./prng";

const START = [
  "ka",
  "el",
  "ar",
  "na",
  "to",
  "mi",
  "sa",
  "lu",
  "or",
  "ve",
  "da",
  "ti",
  "ro",
  "be",
  "is",
  "an",
  "u",
  "go",
  "ra",
  "ne",
  "sha",
  "vi",
  "lo",
  "du",
  "ma",
  "ke",
  "zi",
  "al",
  "te",
  "yo",
  "bra",
  "tha",
];
const MIDDLE = [
  "re",
  "la",
  "na",
  "ri",
  "mo",
  "ta",
  "si",
  "de",
  "ku",
  "le",
  "va",
  "no",
  "ga",
  "ze",
  "ri",
  "tu",
];
const END = [
  "k",
  "n",
  "r",
  "s",
  "th",
  "l",
  "m",
  "",
  "",
  "",
  "a",
  "o",
  "e",
  "an",
  "el",
  "ir",
  "un",
  "ek",
  "ash",
  "or",
];

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function makeName(rng: Rng, syllables: number): string {
  let name = rng.pick(START);
  for (let i = 1; i < syllables; i++) name += rng.pick(MIDDLE);
  name += rng.pick(END);
  return capitalize(name);
}

export function personName(rng: Rng): string {
  return makeName(rng, rng.int(1, 2));
}

export function tribeName(rng: Rng): string {
  return makeName(rng, rng.int(1, 2));
}

export function settlementName(rng: Rng): string {
  const base = makeName(rng, rng.int(1, 3));
  return rng.chance(0.25) ? `${base}${rng.pick(["dor", "heim", "ra", "via", "mar"])}` : base;
}

export function riverName(rng: Rng): string {
  return makeName(rng, 2);
}

export function civilizationName(rng: Rng, tribeName: string): string {
  const forms = [
    `Regno di ${tribeName}`,
    `Confederazione ${tribeName}`,
    `Lega di ${tribeName}`,
    `Dominio ${tribeName}`,
  ];
  return rng.pick(forms);
}
