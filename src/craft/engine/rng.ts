/**
 * Seeded randomness.
 *
 * Everything the world generator decides has to be a pure function of the seed
 * and a position. Two players joining the same online world generate the
 * untouched chunks themselves rather than downloading them, so a single call to
 * Math.random() anywhere in generation would give them different worlds that
 * only disagree where nobody has looked yet.
 */

/** Turns any text seed into a 32-bit integer. A numeric string is used as-is so "12345" means 12345. */
export function seedFromString(text: string): number {
  const trimmed = text.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n)) return n | 0;
  }
  let h = 1779033703 ^ trimmed.length;
  for (let i = 0; i < trimmed.length; i++) {
    h = Math.imul(h ^ trimmed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) | 0;
}

export function randomSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

/** A 32-bit integer hash of up to four integers. Stable across platforms. */
export function hash4(a: number, b: number, c = 0, d = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= Math.imul(c | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  h ^= Math.imul(d | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** A float in [0, 1) from a hash of the inputs. */
export function hashFloat(a: number, b: number, c = 0, d = 0): number {
  return hash4(a, b, c, d) / 4294967296;
}

/** Small, fast, seedable generator (mulberry32). */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  range(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}
