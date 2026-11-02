/**
 * World dimensions and clock rates.
 *
 * The height is 128 rather than the 384 of the game this is modelled on. A
 * chunk column is meshed and lit as one unit, and a browser on a phone has to
 * hold a few hundred of them; three times the height is three times the memory
 * and the meshing time for underground space almost nobody sees. Everything
 * that depends on height (ore bands, cave depth, the deepslate line) is scaled
 * to this number rather than written against the original's coordinates.
 */
export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const CHUNK_MASK = 15;
export const WORLD_HEIGHT = 128;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
export const SEA_LEVEL = 62;
export const DEEPSLATE_LEVEL = 16;

export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
/** A full day, dawn to dawn, in ticks — twenty minutes of play. */
export const DAY_TICKS = 24000;

export const MAX_LIGHT = 15;

/** Index of a block inside a chunk's flat arrays. y is outermost so a column is contiguous in x/z slices. */
export function blockIndex(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function parseChunkKey(key: string): [number, number] {
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}
