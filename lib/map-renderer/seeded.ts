/**
 * Deterministic hashing for visual variation. Nothing in the renderer uses `Math.random()`:
 * the same world seed and entity ids always produce the same picture.
 */

/** 32-bit FNV-1a hash of a string. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mixes integers into a well-distributed 32-bit value (murmur3 finaliser). */
export function hashInts(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h ^= Math.imul((v | 0) ^ (v >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Hash to a float in [0, 1). */
export function unitFloat(hash: number): number {
  return (hash >>> 0) / 4294967296;
}

/** Small seeded generator (mulberry32) for sequences that must be reproducible. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
