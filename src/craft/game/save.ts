/**
 * Saving worlds in this browser (IndexedDB), and moving them in and out as
 * files.
 *
 * Only chunks someone changed are stored; everything else regenerates from
 * the seed, so a world explored for hours but built on in one corner stays a
 * few hundred kilobytes. Chunks are gzip-compressed where the browser has
 * CompressionStream (all current ones) — a 64 KB chunk is usually 3-6 KB.
 *
 * If IndexedDB is unavailable (some private-browsing modes) the store falls
 * back to memory and says so: `persistent` is false and the UI warns that the
 * world will be lost when the tab closes. Pretending to save would be worse
 * than not saving.
 */
import type { EndState } from "./endFight";
import type { BlockEntity } from "../engine/chunk";
import type { EntitySnapshot } from "../engine/entities";
import type { GameMode, PlayerSave } from "../engine/player";
import type { WorldType } from "../engine/worldgen";
import type { Dimension } from "../engine/dimension";
import type { Waystone } from "../engine/waystones";
import type { MapId } from "../engine/maps";
import type { ModeState } from "../modes/modes";
import { GAME_NAME } from "../edition";
import { MapStore } from "./mapStore";
import { CHUNK_VOLUME } from "../engine/constants";

export interface GameRules {
  keepInventory: boolean;
  doDaylightCycle: boolean;
  doMobSpawning: boolean;
  doWeatherCycle: boolean;
  naturalRegeneration: boolean;
  mobGriefing: boolean;
  doFallDamage: boolean;
  /** Fire spreads and burns out. Absent in worlds saved before fire existed, which reads as on. */
  doFireTick?: boolean;
}

export const DEFAULT_RULES: GameRules = {
  keepInventory: false,
  doDaylightCycle: true,
  doMobSpawning: true,
  doWeatherCycle: true,
  naturalRegeneration: true,
  mobGriefing: true,
  doFallDamage: true,
  doFireTick: true,
};

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  seedText: string;
  type: WorldType;
  gameMode: GameMode;
  difficulty: 0 | 1 | 2 | 3;
  hardcore: boolean;
  cheats: boolean;
  created: number;
  lastPlayed: number;
  playTime: number;
  time: number;
  day: number;
  weather: { rain: number; thunder: number; rainTimer: number; thunderTimer: number };
  spawn: { x: number; y: number; z: number } | null;
  rules: GameRules;
  player: PlayerSave | null;
  /** Online guests' saved state, by their stable client id (and the dimension it was saved in). */
  players: Record<string, PlayerSave & { name: string; dimension?: Dimension }>;
  entities: EntitySnapshot[];
  /** Villages already given their villagers and golem, by region key, so none is populated twice. */
  villages?: string[];
  /**
   * One-time structure spawns already made (an End city's shulkers, its ship's
   * frame), by kind and cell — so a chunk that is generated again, never having
   * been saved, does not people its city a second time.
   */
  spawned?: string[];
  /** The map pack the overworld is built as (engine/maps.ts); absent is open terrain. */
  map?: MapId;
  /** The game mode played in this world (modes/modes.ts) and what it has kept track of. */
  mode?: ModeState;
  /** Mod-inspired features switched off for this world (engine/mods.ts ids); everything else is on. */
  disabledMods?: string[];
  /**
   * The real date (a Julian day, at midnight) the world's day 0 fell on: the sky (space/sky.ts) counts a real day
   * for every game day from it. Set the first time the world is played, so its first day is that real day.
   */
  skyEpoch?: number;
  /** Where on the Earth the world's origin is, when it has been moved from where its seed put it (/sky chase). */
  place?: { lat: number; lon: number };
  /** Every waystone in the world, by key (engine/waystones.ts). Who has found which is on each player. */
  waystones?: Record<string, Waystone>;
  /** The dimension the player (online, the host) is in; absent is the overworld. */
  dimension?: Dimension;
  /** Entities of the dimensions not loaded, waiting for someone to come back. */
  otherEntities?: Partial<Record<Dimension, EntitySnapshot[]>>;
  /** Every lit portal, by dimension (its bottom-left inner block and axis), so a trip links to the one it came through. */
  portals?: Partial<Record<Dimension, [number, number, number, number][]>>;
  /** The dragon fight: begun, won (ever), gateways opened. */
  end?: EndState;
  thumbnail?: string;
  version: 1;
}

export interface ChunkData {
  cx: number;
  cz: number;
  blocks: Uint16Array;
  meta: Uint8Array;
  entities: [number, BlockEntity][];
}

interface StoredChunk {
  key: string;
  world: string;
  /** Absent for the overworld, which is how every chunk saved before the Nether reads. */
  dim?: Dimension;
  cx: number;
  cz: number;
  /** blocks followed by meta, possibly gzipped. */
  data: Uint8Array;
  gz: boolean;
  entities: [number, BlockEntity][];
}

const DB_NAME = "blockcraft";
const DB_VERSION = 1;

/** Overworld keys keep the old form; the others are prefixed, still under the world's key range. */
const DIM_PREFIX: Record<Dimension, string> = { overworld: "", nether: "n:", end: "e:" };
export const chunkStoreKey = (world: string, cx: number, cz: number, dim: Dimension = "overworld") => `${world}|${DIM_PREFIX[dim]}${cx},${cz}`;
const dimOfKey = (part: string): Dimension => (part.startsWith("n:") ? "nether" : part.startsWith("e:") ? "end" : "overworld");

async function gzip(data: Uint8Array): Promise<{ data: Uint8Array; gz: boolean }> {
  if (typeof CompressionStream === "undefined") return { data, gz: false };
  try {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("gzip"));
    return { data: new Uint8Array(await new Response(stream).arrayBuffer()), gz: true };
  } catch {
    return { data, gz: false };
  }
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read compressed saves (no DecompressionStream).");
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A chunk as stored and sent: its block ids two bytes each (low byte first),
 * then its meta a byte each, gzipped where the browser can.
 *
 * Chunks saved before block ids went past 255 hold one byte per block; they
 * are told apart by length and read as they were written, so no save made
 * before the change loses a block.
 */
export async function packChunk(c: ChunkData): Promise<{ data: Uint8Array; gz: boolean }> {
  const n = c.blocks.length;
  const raw = new Uint8Array(n * 2 + c.meta.length);
  for (let i = 0; i < n; i++) {
    const id = c.blocks[i];
    raw[i * 2] = id & 0xff;
    raw[i * 2 + 1] = id >> 8;
  }
  raw.set(c.meta, n * 2);
  return gzip(raw);
}

export async function unpackChunk(data: Uint8Array, gz: boolean): Promise<{ blocks: Uint16Array; meta: Uint8Array }> {
  const raw = gz ? await gunzip(data) : data;
  if (raw.length === CHUNK_VOLUME * 2) return { blocks: Uint16Array.from(raw.subarray(0, CHUNK_VOLUME)), meta: raw.slice(CHUNK_VOLUME) };
  if (raw.length !== CHUNK_VOLUME * 3) {
    throw new Error(`A saved chunk is ${raw.length} bytes, which is neither the old layout (${CHUNK_VOLUME * 2}) nor the current one (${CHUNK_VOLUME * 3}); it cannot be read.`);
  }
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let i = 0; i < CHUNK_VOLUME; i++) blocks[i] = raw[i * 2] | (raw[i * 2 + 1] << 8);
  return { blocks, meta: raw.slice(CHUNK_VOLUME * 2) };
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted (storage full?)"));
  });
}

export class SaveStore {
  private db: Promise<IDBDatabase> | null = null;
  /** The world maps, kept in a database of their own (mapStore.ts says why). */
  readonly maps = new MapStore();
  private memoryWorlds = new Map<string, WorldMeta>();
  private memoryChunks = new Map<string, StoredChunk>();
  persistent = true;
  /** Why saving is not persistent, in words for the screen. */
  problem: string | null = null;

  private open(): Promise<IDBDatabase> | null {
    if (!this.persistent) return null;
    if (this.db) return this.db;
    if (typeof indexedDB === "undefined") {
      this.fallback("This browser has no IndexedDB");
      return null;
    }
    this.db = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("worlds")) db.createObjectStore("worlds", { keyPath: "id" });
        if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("could not open the save database"));
      req.onblocked = () => reject(new Error("the save database is open in another tab with an older version"));
    }).catch((err: Error) => {
      this.fallback(err.message);
      throw err;
    });
    return this.db;
  }

  private fallback(reason: string): void {
    this.persistent = false;
    this.problem = `${reason} — worlds are kept in memory only and will be lost when this tab closes. Export a world to keep it.`;
    this.db = null;
  }

  private async store(name: "worlds" | "chunks", mode: IDBTransactionMode): Promise<{ os: IDBObjectStore; tx: IDBTransaction } | null> {
    const p = this.open();
    if (!p) return null;
    try {
      const db = await p;
      const tx = db.transaction(name, mode);
      return { os: tx.objectStore(name), tx };
    } catch {
      return null;
    }
  }

  async listWorlds(): Promise<WorldMeta[]> {
    const s = await this.store("worlds", "readonly");
    const list = s ? await request(s.os.getAll() as IDBRequest<WorldMeta[]>) : [...this.memoryWorlds.values()];
    return list.sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  async getWorld(id: string): Promise<WorldMeta | null> {
    const s = await this.store("worlds", "readonly");
    if (!s) return this.memoryWorlds.get(id) ?? null;
    return (await request(s.os.get(id) as IDBRequest<WorldMeta | undefined>)) ?? null;
  }

  async putWorld(meta: WorldMeta): Promise<void> {
    const s = await this.store("worlds", "readwrite");
    if (!s) { this.memoryWorlds.set(meta.id, structuredClone(meta)); return; }
    s.os.put(meta);
    await done(s.tx);
  }

  async deleteWorld(id: string): Promise<void> {
    await this.maps.deleteWorld(id);
    const w = await this.store("worlds", "readwrite");
    if (!w) {
      this.memoryWorlds.delete(id);
      for (const k of [...this.memoryChunks.keys()]) if (k.startsWith(`${id}|`)) this.memoryChunks.delete(k);
      return;
    }
    w.os.delete(id);
    await done(w.tx);
    const c = await this.store("chunks", "readwrite");
    if (c) {
      c.os.delete(IDBKeyRange.bound(`${id}|`, `${id}|￿`));
      await done(c.tx);
    }
  }

  async getChunk(world: string, cx: number, cz: number, dim: Dimension = "overworld"): Promise<ChunkData | null> {
    const key = chunkStoreKey(world, cx, cz, dim);
    const s = await this.store("chunks", "readonly");
    const stored = s ? await request(s.os.get(key) as IDBRequest<StoredChunk | undefined>) : this.memoryChunks.get(key);
    if (!stored) return null;
    const { blocks, meta } = await unpackChunk(stored.data, stored.gz);
    return { cx, cz, blocks, meta, entities: stored.entities ?? [] };
  }

  async putChunks(world: string, chunks: ChunkData[], dim: Dimension = "overworld"): Promise<void> {
    if (!chunks.length) return;
    const packed: StoredChunk[] = [];
    for (const c of chunks) {
      const { data, gz } = await packChunk(c);
      packed.push({ key: chunkStoreKey(world, c.cx, c.cz, dim), world, dim: dim === "overworld" ? undefined : dim, cx: c.cx, cz: c.cz, data, gz, entities: c.entities });
    }
    const s = await this.store("chunks", "readwrite");
    if (!s) { for (const p of packed) this.memoryChunks.set(p.key, p); return; }
    for (const p of packed) s.os.put(p);
    await done(s.tx);
  }

  /** Keys ("cx,cz") of every chunk this world has saved in a dimension — what an online guest must fetch rather than generate. */
  async savedChunkKeys(world: string, dim: Dimension = "overworld"): Promise<string[]> {
    const s = await this.store("chunks", "readonly");
    const all = s
      ? (await request(s.os.getAllKeys(IDBKeyRange.bound(`${world}|`, `${world}|￿`)))) as string[]
      : [...this.memoryChunks.keys()].filter((k) => k.startsWith(`${world}|`));
    const prefix = DIM_PREFIX[dim];
    return all.map((k) => k.split("|")[1]).filter((part) => dimOfKey(part) === dim).map((part) => part.slice(prefix.length));
  }

  async allChunks(world: string): Promise<StoredChunk[]> {
    const s = await this.store("chunks", "readonly");
    if (!s) return [...this.memoryChunks.values()].filter((c) => c.world === world);
    return request(s.os.getAll(IDBKeyRange.bound(`${world}|`, `${world}|￿`)) as IDBRequest<StoredChunk[]>);
  }

  // ---- files ----------------------------------------------------------------------

  /** The world as an export file's text — what a download writes and a cloud upload sends. */
  async exportText(id: string): Promise<string> {
    const meta = await this.getWorld(id);
    if (!meta) throw new Error("That world is not in this browser any more.");
    const chunks = await this.allChunks(id);
    const file: ExportFile = {
      format: "blockcraft-world",
      version: 1,
      meta,
      chunks: chunks.map((c) => ({ cx: c.cx, cz: c.cz, dim: c.dim, gz: c.gz, data: toBase64(c.data), entities: c.entities })),
    };
    return JSON.stringify(file);
  }

  async exportWorld(id: string): Promise<Blob> {
    return new Blob([await this.exportText(id)], { type: "application/json" });
  }

  /**
   * Adds a world from an export file. A file becomes a new world with its own
   * id, so importing twice gives two worlds; `keepId` keeps the file's id
   * instead (a cloud download replacing its own local copy, so uploading it
   * again updates the same cloud row).
   */
  async importWorld(text: string, opts: { keepId?: boolean } = {}): Promise<WorldMeta> {
    let file: ExportFile;
    try {
      file = JSON.parse(text);
    } catch {
      throw new Error(`That file is not a ${GAME_NAME} world (it is not JSON).`);
    }
    if (file?.format !== "blockcraft-world" || !file.meta || !Array.isArray(file.chunks)) {
      throw new Error(`That file is not a ${GAME_NAME} world export.`);
    }
    const keep = opts.keepId && typeof file.meta.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(file.meta.id);
    const id = keep ? file.meta.id : newWorldId();
    // Decoded before anything is replaced: a damaged file must not cost the copy already here.
    const stored: StoredChunk[] = file.chunks.map((c) => {
      const dim: Dimension = c.dim === "nether" || c.dim === "end" ? c.dim : "overworld";
      return {
        key: chunkStoreKey(id, c.cx, c.cz, dim), world: id, dim: dim === "overworld" ? undefined : dim, cx: c.cx, cz: c.cz,
        gz: !!c.gz, data: fromBase64(c.data), entities: c.entities ?? [],
      };
    });
    if (keep) await this.deleteWorld(id);
    const others = (await this.listWorlds()).filter((w) => w.id !== id);
    const meta: WorldMeta = { ...file.meta, id, name: uniqueName(file.meta.name, others), lastPlayed: Date.now() };
    await this.putWorld(meta);
    const s = await this.store("chunks", "readwrite");
    if (!s) for (const c of stored) this.memoryChunks.set(c.key, c);
    else {
      for (const c of stored) s.os.put(c);
      await done(s.tx);
    }
    return meta;
  }
}

export interface ExportFile {
  format: "blockcraft-world";
  version: 1;
  meta: WorldMeta;
  chunks: { cx: number; cz: number; dim?: Dimension; gz: boolean; data: string; entities: [number, BlockEntity][] }[];
}

export function newWorldId(): string {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueName(name: string, existing: WorldMeta[]): string {
  const taken = new Set(existing.map((w) => w.name));
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`)) return `${name} (${i})`;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function newWorldMeta(opts: {
  name: string; seed: number; seedText: string; type: WorldType; gameMode: GameMode; difficulty: 0 | 1 | 2 | 3;
  hardcore: boolean; cheats: boolean;
}): WorldMeta {
  const now = Date.now();
  return {
    id: newWorldId(),
    ...opts,
    created: now,
    lastPlayed: now,
    playTime: 0,
    // Early morning, as "/time set day" means: tick 0 is the moment of sunrise, still half dark.
    time: 1000,
    day: 0,
    weather: { rain: 0, thunder: 0, rainTimer: 12000 + Math.floor(Math.random() * 168000), thunderTimer: 12000 + Math.floor(Math.random() * 168000) },
    spawn: null,
    rules: { ...DEFAULT_RULES },
    player: null,
    players: {},
    entities: [],
    version: 1,
  };
}
