/**
 * An online (or same-device) session: one host, any number of guests.
 *
 * The host owns the world. A guest's block edits are applied at once on the
 * guest (so digging feels instant) and sent to the host, which applies them,
 * stamps them with a sequence number and re-broadcasts them; everyone,
 * including the guest who made the edit, converges on the host's order.
 * Water, sand, mobs, time and weather are simulated only by the host and
 * streamed out.
 *
 * Guests generate every untouched chunk themselves from the seed and fetch
 * only chunks the host reports as modified. Edits that arrive for a chunk
 * still loading are held and replayed once it lands, skipping any the
 * fetched copy already contains (by sequence number).
 *
 * Each client sends at most one batched message per ~125 ms, plus the
 * occasional large chunk transfer split into parts.
 */
import type { BlockEntity } from "../engine/chunk";
import { GAME_NAME } from "../edition";
import { chunkKey } from "../engine/constants";
import {
  AreaCloud, EndCrystal, Entity, FallingBlock, FireworkRocket, isProjectileKind, ItemEntity, ItemFrame, PrimedTnt, Projectile, XpOrb,
  type DamageSource, type EntitySnapshot, type ProjectileKind,
} from "../engine/entities";
import { itemDef, type ItemStack, type StatusEffect } from "../engine/items";
import { sanitizeRocket, type Rocket } from "../engine/fireworks";
import { sanitizeWaystones, type Waystone } from "../engine/waystones";
import { isMapId, type MapId } from "../engine/maps";
import type { ModeState } from "../modes/modes";
import type { ModeTell } from "../game/types";
import { sanitizeStack } from "../engine/inventory";
import { Mob, isMobKind } from "../engine/mobs";
import { TORPOR } from "../engine/creatures";
import { canRide } from "../engine/dinoAi";
import { isVehicleKind, Vehicle, vehicleFromSnapshot } from "../engine/vehicles";
import { Car } from "../engine/cars";
import { B, block, Face } from "../engine/blocks";
import type { PlayerSave } from "../engine/player";
import type { AdvancementEvent } from "../engine/advancements";
import { isDimension, type Dimension } from "../engine/dimension";
import type { BlockChange } from "../engine/world";
import type { Arrival, Game, NetLink, RemotePlayer } from "../game/game";
import { packChunk, toBase64, fromBase64, unpackChunk, type ChunkData, type GameRules } from "../game/save";
import { clientId, connectionId, DeviceTransport, LanTransport, MAX_PART, OnlineTransport, type LinkKind, type NetMessage, type Transport } from "./transport";
import { parseCritterOp, type CritterOp } from "../game/critterPlay";
import { parseLinkMsg, type LinkMsg } from "../game/critterLink";

type Op = unknown[];

export interface Welcome {
  worldName: string;
  seed: number;
  seedText: string;
  type: "default" | "amplified" | "flat" | "large_biomes";
  time: number;
  rain: number;
  thunder: number;
  spawn: { x: number; y: number; z: number } | null;
  rules: GameRules;
  difficulty: 0 | 1 | 2 | 3;
  gameMode: "survival" | "creative" | "adventure" | "spectator";
  hardcore: boolean;
  cheats: boolean;
  modified: string[];
  seq: number;
  player: PlayerSave | null;
  hostId: string;
  hostName: string;
  /** The dimension the host, and so the party, is in. */
  dimension: Dimension;
  /** The host's mod-inspired features switched off (engine/mods.ts), so a guest's seasons and map agree with the host's. */
  disabledMods?: string[];
  /** The world's waystones (engine/waystones.ts). */
  waystones?: Record<string, Waystone>;
  /** The map pack the overworld is built as, which a guest's generator must build too. */
  map?: MapId;
  /** The world's game mode (its state stays with the host). */
  mode?: ModeState;
  /** The real date the world's day 0 fell on (space/sky.ts), so a guest's Moon is the host's Moon. */
  skyEpoch?: number;
  /** Where on the Earth the world has been moved to, if it has (/sky chase). */
  place?: { lat: number; lon: number };
}

const GAME_MODES = ["survival", "creative", "adventure", "spectator"] as const;

/** A host's mode message, kept to what it may say: short words, a known game mode, a sane scoreboard and border. */
export function sanitizeModeTell(v: unknown): ModeTell {
  const t = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const str = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : undefined);
  const out: ModeTell = {};
  if (str(t.msg, 200)) { out.msg = str(t.msg, 200); out.color = /^#[0-9a-f]{6}$/i.test(String(t.color)) ? String(t.color) : undefined; }
  if (str(t.title, 60)) { out.title = str(t.title, 60); out.sub = str(t.sub, 100); }
  if ((GAME_MODES as readonly unknown[]).includes(t.gm)) out.gm = t.gm as ModeTell["gm"];
  if (t.obj === null) out.obj = null;
  else if (t.obj && typeof t.obj === "object") {
    const o = t.obj as { title?: unknown; lines?: unknown };
    const lines = Array.isArray(o.lines) ? o.lines.slice(0, 15).map((l): [string, string] => [String((l as unknown[])?.[0] ?? "").slice(0, 40), String((l as unknown[])?.[1] ?? "").slice(0, 40)]) : [];
    out.obj = { title: String(o.title ?? "").slice(0, 40), lines };
  }
  if (t.border === null) out.border = null;
  else if (t.border && typeof t.border === "object") {
    const b = t.border as { x?: unknown; z?: unknown; radius?: unknown };
    if (finite(b.x, b.z, b.radius)) out.border = { x: b.x as number, z: b.z as number, radius: Math.max(1, b.radius as number) };
  }
  if (typeof t.frozen === "boolean") out.frozen = t.frozen;
  if (finite(t.maxHealth)) out.maxHealth = Math.max(1, Math.min(20, t.maxHealth as number));
  if (t.reset === true) out.reset = true;
  if (typeof t.bloodMoon === "boolean") out.bloodMoon = t.bloodMoon;
  if (finite(t.cash)) out.cash = Math.max(-1_000_000, Math.min(1_000_000, Math.floor(t.cash as number)));
  if (finite(t.wanted)) out.wanted = Math.max(0, Math.min(5, Math.floor(t.wanted as number)));
  if (t.confiscate === true) out.confiscate = true;
  const c = t.caption as { who?: unknown; text?: unknown; color?: unknown } | undefined;
  if (c && typeof c.who === "string" && typeof c.text === "string") out.caption = { who: c.who.slice(0, 40), text: c.text.slice(0, 300), color: typeof c.color === "string" && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#ffffff" };
  if (t.markers === null) out.markers = null;
  else if (Array.isArray(t.markers)) {
    out.markers = t.markers.slice(0, 16).flatMap((m: unknown) => {
      const k = m as Record<string, unknown>;
      if (!finite(k?.x, k?.y, k?.z, k?.r)) return [];
      return [{ x: k.x as number, y: k.y as number, z: k.z as number, r: Math.max(0.5, Math.min(12, k.r as number)), color: typeof k.color === "string" && /^#[0-9a-f]{6}$/i.test(k.color) ? k.color : "#ffffff" }];
    });
  }
  return out;
}

// 2: dimensions (the "dm" and "mk" ops, and the welcome's dimension).
// 3: End cities grown into towers and ships, and catacombs and spider caves — ground an older copy
//    would generate differently, so a guest on it would walk through walls the host sees — plus
//    shulkers, fireworks, waystones, gravestones and the mod switches (the "wz", "wr", "wn", "gr",
//    "gc", "md" and "fw" ops, and the welcome's disabledMods and waystones).
// 4: game modes and map packs, Primal creatures and riding, the infected, guns, vitals and blood moons
//    (the "nz" op, and the tell's reset and bloodMoon) — a guest on 3 would see none of it.
// 5: critters, their trainers and the critter maps (the "ck" op, and the critter and trainer mob kinds) — a guest on 4
//    would see neither, and the world's new healing station block would be a block it has never heard of.
// 6: the cities — cars (a vehicle kind), citizens and cops (mob kinds), and the tell's cash, wanted stars,
//    confiscations, captions and mission markers — a guest on 5 could not build a single one of them.
// 7: link battles and critter trades between players (the "cv" op), Team Copium, and the meme critters — a
//    guest on 6 would meet species and trainers it has never heard of, and could not answer a challenge.
// 8: the Starship item (a new item id) and the space trip it starts — a guest on 7 would hold an item it cannot draw.
// 9: the real sky (the welcome's and the "env" op's skyEpoch and place) — a guest on 8 would see its own date's Moon and stars,
//    and the Sun rise and set by the clock while the host's rose by the season.
// 10: sixteen-bit block ids — a chunk now travels as two bytes a block, which a guest on 9 would read as garbage.
// 11: Ashgrove County's shamblers and crawlers (mob kinds) and spoiled food (a new item id) — a guest on 10 would
//     be shown mobs and an item it has never heard of.
const PROTOCOL = 11;
const FLUSH_TICKS = 2;
const ENTITY_TICKS = 4;
const ENV_TICKS = 40;
const PERSIST_TICKS = 200;
const TIMEOUT_MS = 20000;

const finite = (...v: unknown[]) => v.every((n) => typeof n === "number" && Number.isFinite(n));
const int = (v: unknown) => typeof v === "number" && Number.isInteger(v);

/** `address` is the relay's host:port, and only LAN links have one. */
export function makeTransport(kind: LinkKind, room: string, address?: string): Transport {
  if (kind === "online") return new OnlineTransport(room);
  if (kind === "lan") {
    if (!address) throw new Error("Type the host's address (shown on their Play Together screen) to join over the local network.");
    return new LanTransport(address, room);
  }
  return new DeviceTransport(room);
}

async function linked(t: Transport): Promise<void> {
  if (t instanceof OnlineTransport || t instanceof LanTransport) await t.ready;
}

export class NetSession implements NetLink {
  readonly role: "host" | "guest";
  readonly room: string;
  readonly kind: LinkKind;
  /** Where others on the network reach a LAN host (host:port for each of its addresses); empty otherwise. */
  shareAddresses: string[] = [];
  private game: Game | null = null;
  private out: Op[] = [];
  private stateOp: Op | null = null;
  private ticks = 0;
  private seq = 0;
  private hostId: string | null = null;
  private lastHost = performance.now();
  private modified = new Set<string>();
  private pendingOps = new Map<string, { seq: number; op: Op }[]>();
  private chunkRequests = new Map<string, { resolve: (d: ChunkData | null) => void; parts: string[]; received: number; timer: ReturnType<typeof setTimeout> }>();
  private requestIds = 0;
  private closed = false;
  private names = new Map<string, string>();
  /** Connection id → the guest's stable player id, which their saved state is filed under. */
  private playerIds = new Map<string, string>();
  status = "connected";

  private constructor(role: "host" | "guest", readonly transport: Transport, room: string, readonly myId: string) {
    this.role = role;
    this.room = room;
    this.kind = transport.kind;
    transport.onMessage((m) => this.receive(m));
    transport.onStatus?.((live) => {
      this.status = live ? "connected" : "reconnecting";
      this.updateStatus();
      const other = this.kind === "lan" ? (this.role === "host" ? "the LAN relay" : "the host") : "the online server";
      this.game?.message(live ? `Reconnected to ${other}.` : `Lost ${other} — reconnecting. Edits made meanwhile are sent when it is back.`, live ? "#aaffaa" : "#ffcc55");
    });
  }

  // ---- setup ------------------------------------------------------------------------------

  /** Opens the host's running world to others. */
  static async host(game: Game, kind: LinkKind, room: string, lan?: { address: string; share: string[] }): Promise<NetSession> {
    const t = makeTransport(kind, room, lan?.address);
    await linked(t);
    const s = new NetSession("host", t, room, game.player.id);
    s.shareAddresses = lan?.share ?? [];
    const keys = await game.saves.savedChunkKeys(game.meta.id, game.dimension).catch(() => [] as string[]);
    for (const k of game.pendingChunkKeys(game.dimension)) s.modified.add(k);
    for (const k of keys) s.modified.add(k);
    for (const c of game.world.loadedChunks()) if (c.modified) s.modified.add(chunkKey(c.cx, c.cz));
    s.attach(game);
    return s;
  }

  /**
   * Joins a room and waits for the host's welcome. Resolves with the session
   * (not yet attached to a game) and what the guest needs to build one; the
   * guest's Player must use `session.myId` so the host's messages reach it.
   */
  static async join(kind: LinkKind, room: string, name: string, skin: number, address?: string): Promise<{ session: NetSession; welcome: Welcome }> {
    const t = makeTransport(kind, room, address);
    await linked(t);
    const myId = connectionId();
    const s = new NetSession("guest", t, room, myId);
    const pid = clientId();
    const welcome = await new Promise<Welcome>((resolve, reject) => {
      const hello = () => t.send({ t: "hello", from: myId, pid, name, skin, v: PROTOCOL });
      hello();
      const again = setInterval(hello, 1500);
      const fail = setTimeout(() => {
        clearInterval(again);
        t.close();
        reject(new Error(`No world is open with the code ${room} right now. Check the code, and that the host has chosen "${kind === "online" ? "Open online" : "Open to tabs on this device"}".`));
      }, 15000);
      s.onWelcome = (w) => {
        clearInterval(again);
        clearTimeout(fail);
        resolve(w);
      };
      s.onRefused = (reason) => {
        clearInterval(again);
        clearTimeout(fail);
        t.close();
        reject(new Error(reason));
      };
    });
    s.hostId = welcome.hostId;
    s.seq = welcome.seq;
    for (const k of welcome.modified) s.modified.add(k);
    s.names.set(welcome.hostId, welcome.hostName);
    return { session: s, welcome };
  }

  private onWelcome: ((w: Welcome) => void) | null = null;
  private onRefused: ((reason: string) => void) | null = null;

  attach(game: Game): void {
    this.game = game;
    game.net = this;
    this.lastHost = performance.now();
    this.updateStatus();
    // Edits broadcast between the welcome and the guest's world existing.
    for (const { from, ops } of this.early.splice(0)) this.onBatch(from, ops);
    game.syncBackground();
  }
  private early: { from: string; ops: Op[] }[] = [];

  /** Guest: pending while the host reads which chunks of the dimension just entered it has changed. */
  keysReady: Promise<void> | null = null;
  private keysDone: (() => void) | null = null;
  get hostConnection(): string | null {
    return this.hostId;
  }

  /**
   * Host: the party goes with it. Guests hear at once and wait before loading
   * any chunk; the list of chunks changed there follows as soon as the save
   * has been read.
   */
  dimensionChanged(dim: Dimension, x: number, y: number, z: number): void {
    if (this.role !== "host" || !this.game) return;
    const g = this.game;
    this.modified.clear();
    this.push(["dm", dim, r2(x), r2(y), r2(z)]);
    this.flush();
    void g.saves.savedChunkKeys(g.meta.id, dim).catch(() => [] as string[]).then((keys) => {
      if (this.closed || g.dimension !== dim) return;
      for (const k of keys) this.modified.add(k);
      for (const k of g.pendingChunkKeys(dim)) this.modified.add(k);
      this.push(["mk", dim, [...this.modified]]);
      this.flush();
    });
  }

  partyLanded(x: number, y: number, z: number): void {
    if (this.role !== "host") return;
    this.push(["dp", r2(x), r2(y), r2(z)]);
    this.flush();
  }

  /** Guest: the host went to another dimension; follow it. */
  private onDimension(op: Op): void {
    const g = this.game!;
    const dim = op[1];
    if (!isDimension(dim) || !finite(op[2], op[3], op[4])) return;
    this.modified.clear();
    this.pendingOps.clear();
    this.chunkSeq.clear();
    // Chunks asked for in the old dimension are not wanted any more.
    for (const [rid, req] of this.chunkRequests) { clearTimeout(req.timer); req.resolve(null); this.chunkRequests.delete(rid); }
    this.keysReady = new Promise<void>((resolve) => {
      this.keysDone = resolve;
      // A host that never sends the list must not freeze the guest's world: load what it can after a while.
      setTimeout(() => { if (this.keysDone === resolve) { this.keysDone = null; this.keysReady = null; resolve(); } }, 8000);
    });
    // Wait up to fifteen seconds for the host to say where it came out.
    g.changeDimension(dim, { kind: "exact", x: op[2] as number, y: op[3] as number, z: op[4] as number, wait: performance.now() + 15000 });
  }

  private onModifiedKeys(op: Op): void {
    if (!isDimension(op[1]) || op[1] !== this.game?.dimension || !Array.isArray(op[2])) return;
    for (const k of op[2] as unknown[]) if (typeof k === "string") this.modified.add(k);
    const done = this.keysDone;
    this.keysDone = null;
    this.keysReady = null;
    done?.();
  }

  close(): void {
    if (this.closed) return;
    // A guest's inventory lives on the host: hand over the latest before leaving.
    if (this.role === "guest" && this.game) this.push(["ps", this.game.player.toJSON()]);
    this.flush();
    this.closed = true;
    this.transport.send({ t: "bye", from: this.myId });
    this.transport.close();
    if (this.game) {
      this.game.remote.clear();
      this.game.setNetStatus(null);
      if (this.game.net === this) this.game.net = null;
    }
  }

  private updateStatus(): void {
    const g = this.game;
    if (!g) return;
    const players = [g.player.name, ...[...g.remote.values()].map((r) => r.name)];
    g.setNetStatus({ role: this.role, room: this.room, kind: this.kind, players, status: this.status, addresses: this.shareAddresses });
  }

  // ---- sending ------------------------------------------------------------------------------

  private push(op: Op): void {
    if (!this.closed) this.out.push(op);
  }

  private send(msg: Omit<NetMessage, "from">): void {
    if (!this.closed) this.transport.send({ ...msg, from: this.myId } as NetMessage);
  }

  private flush(): void {
    const ops = this.out.splice(0);
    if (this.stateOp) { ops.unshift(this.stateOp); this.stateOp = null; }
    if (!ops.length) return;
    // Keep each broadcast comfortably under the payload limit.
    let batch: Op[] = [];
    let size = 0;
    for (const op of ops) {
      const len = JSON.stringify(op).length;
      if (size + len > MAX_PART && batch.length) { this.send({ t: "b", ops: batch }); batch = []; size = 0; }
      batch.push(op);
      size += len;
    }
    if (batch.length) this.send({ t: "b", ops: batch });
  }

  tick(): void {
    const g = this.game;
    if (!g || this.closed) return;
    this.ticks++;
    const p = g.player;
    const b = p.body;
    this.stateOp = ["st", r2(b.x), r2(b.y), r2(b.z), r2(p.yaw), r2(p.pitch), r2(p.walkDist), r2(Math.hypot(b.x - p.prevX, b.z - p.prevZ)),
      r2(g.actions.swingProgress(1)), p.sneaking ? 1 : 0, p.inventory.held?.id ?? -1, g.settings.skin, p.name, p.hurtTime > 0 ? 1 : 0,
      p.dead ? 1 : 0, p.gameMode, p.sleeping ? 1 : 0, p.hasEffect("invisibility") ? 1 : 0, p.riding !== null ? 1 : 0,
      p.inventory.armor.some((a) => !!a && itemDef(a.id)?.armor?.material === "golden") ? 1 : 0,
      p.gliding ? 1 : 0, p.inventory.armor[0]?.id === B.CARVED_PUMPKIN ? 1 : 0];
    if (this.role === "host") {
      if (this.ticks % ENTITY_TICKS === 0 && g.remote.size) this.push(["en", this.entitySnapshots()]);
      if (this.ticks % ENV_TICKS === 0) this.push(["env", g.time, r2(g.rain), r2(g.thunder), g.meta.difficulty, g.meta.skyEpoch ?? null, g.meta.place?.lat ?? null, g.meta.place?.lon ?? null]);
      const now = performance.now();
      for (const [id, r] of g.remote) {
        if (now - r.lastSeen > TIMEOUT_MS) {
          g.remote.delete(id);
          g.message(`${r.name} left the game`, "#ffff55");
          this.updateStatus();
        }
      }
    } else {
      if (this.ticks % PERSIST_TICKS === 0) this.push(["ps", p.toJSON()]);
      if (performance.now() - this.lastHost > TIMEOUT_MS && this.status !== "lost") {
        this.status = "lost";
        this.updateStatus();
        g.onFatal?.("Lost connection to the host. The world stays on the host's side; you can rejoin with the same code.");
      }
    }
    if (this.ticks % FLUSH_TICKS === 0 || this.out.length > 50) this.flush();
  }

  private entitySnapshots(): EntitySnapshot[] {
    const g = this.game!;
    const out: EntitySnapshot[] = [];
    const centres = [...g.remote.values()];
    for (const e of g.entities.values()) {
      if (e.removed) continue;
      if (!centres.some((c) => Math.abs(c.x - e.x) < 96 && Math.abs(c.z - e.z) < 96)) continue;
      out.push(e.snapshot());
      if (out.length >= 300) break;
    }
    return out;
  }

  blockChanged(c: BlockChange): void {
    const key = chunkKey(c.x >> 4, c.z >> 4);
    this.modified.add(key);
    if (this.role === "host") {
      this.seq++;
      this.push(["bl", this.seq, c.x, c.y, c.z, c.id, c.meta]);
    } else if (c.cause === "player") {
      this.push(["ed", c.x, c.y, c.z, c.id, c.meta]);
    }
  }

  chat(text: string): void {
    this.push(["ch", text, this.game?.player.name ?? "?"]);
  }

  // Guest → host actions.
  attack(entityId: number, damage: number, fx: number, fz: number, knockback = 0, fire = 0, looting = 0, part?: string, torpor = 0): void {
    this.push(["at", entityId, r2(damage), r2(fx), r2(fz), r2(knockback), fire, looting, part, r2(torpor)]);
  }
  /** `stack` goes along when the whole stack matters (hung in an item frame, enchantments and all). */
  interact(entityId: number, item: string | null, stack?: ItemStack | null): void { this.push(["in", entityId, item, stack ?? undefined]); }
  drops(x: number, y: number, z: number, stacks: ItemStack[], xp: number): void { this.push(["dr", r2(x), r2(y), r2(z), stacks, xp]); }
  throwItem(kind: ProjectileKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, extra: ThrowExtra = {}): void {
    this.push(["th", kind, r2(x), r2(y), r2(z), r3(vx), r3(vy), r3(vz), extra.item ?? 0, r2(extra.damage ?? 0), extra.knockback ?? 0, extra.fire ? 1 : 0]);
  }
  primeTnt(x: number, y: number, z: number, fuse: number): void { this.push(["tn", x, y, z, fuse]); }
  blockEntity(x: number, y: number, z: number, e: BlockEntity | null): void { this.push(["be", x, y, z, e]); }
  sleeping(on: boolean): void { this.push(["sl", on ? 1 : 0]); }

  // Host → guests (and player-versus-player from anyone).
  hurtRemote(id: string, amount: number, source: DamageSource, fx: number, fz: number, kb: number, attacker?: number): void {
    this.push(["hu", id, r2(amount), source, r2(fx), r2(fz), r2(kb), attacker ?? -1]);
  }
  /** A splash potion reached a guest: they own their effects, so the host only tells them. */
  effectRemote(id: string, effect: StatusEffect, seconds: number, amp: number): void { this.push(["ef", id, effect, seconds, amp]); }
  giveRemote(id: string, stack: ItemStack): void { this.push(["gv", id, stack]); }
  advanceRemote(id: string, event: AdvancementEvent): void { this.push(["av", id, event]); }
  pushRemote(id: string, dx: number, dy: number, dz: number): void { this.push(["pu", id, dx, dy, dz]); }
  noise(x: number, y: number, z: number, radius: number): void { if (this.role === "guest") this.push(["nz", r2(x), r2(y), r2(z), r2(radius)]); }
  /** Guest → host: something a battle needs the world to show (game/critterPlay.ts). */
  critter(op: CritterOp): void { if (this.role === "guest") this.push(["ck", op]); }
  /** To one other player, host or guest: a link battle's or a trade's message. Everyone hears it; only they act on it. */
  link(to: string, msg: LinkMsg): void { this.push(["cv", to, msg]); }
  teleportRemote(id: string, to: Arrival): void { this.push(["tp", id, to]); }
  placeCrystal(x: number, y: number, z: number): void { this.push(["ec", x, y, z]); }
  mount(entityId: number, on: boolean): void { if (this.role === "guest") this.push(["mo", entityId, on ? 1 : 0]); }
  trade(entityId: number, offer: number): void { this.push(["tr", entityId, offer]); }
  vehiclePose(v: Vehicle | Mob): void {
    const b = v.body;
    // A car's driver also reports what their crashes cost it: the host is the one that sets it burning.
    this.push(["vp", v.id, r3(b.x), r3(b.y), r3(b.z), r3(v.yaw), r3(b.vx), r3(b.vy), r3(b.vz), ...(v instanceof Car ? [Math.round(v.health)] : [])]);
  }
  launchFirework(x: number, y: number, z: number, rocket: Rocket): void {
    this.push(["fw", r3(x), r3(y), r3(z), rocket]);
  }
  placeFrame(face: number, x: number, y: number, z: number): void {
    this.push(["pf", face, x, y, z]);
  }
  waystonesChanged(): void { if (this.role === "host") this.push(["wz", this.game?.meta.waystones ?? {}]); }
  modsChanged(): void { if (this.role === "host") this.push(["md", this.game?.meta.disabledMods ?? []]); }
  modeTell(target: string | null, t: ModeTell): void { if (this.role === "host") this.push(["mt", target, t]); }
  registerWaystone(x: number, y: number, z: number): void { if (this.role === "guest") this.push(["wr", x, y, z]); }
  renameWaystone(key: string, name: string): void { if (this.role === "guest") this.push(["wn", key, name]); }
  placeGrave(x: number, y: number, z: number, items: (ItemStack | null)[], owner: string, yaw: number): void {
    if (this.role === "guest") this.push(["gr", r3(x), r3(y), r3(z), items, owner, r3(yaw)]);
  }
  collectGrave(x: number, y: number, z: number): void { if (this.role === "guest") this.push(["gc", x, y, z]); }
  placeVehicle(kind: string, x: number, y: number, z: number, yaw: number, wood: number): void {
    this.push(["pv", kind, r3(x), r3(y), r3(z), r3(yaw), wood]);
  }
  xpRemote(id: string, amount: number): void { this.push(["xp", id, amount]); }
  effect(kind: "sound" | "particles" | "explosion", data: unknown[]): void {
    if (this.role === "host") this.push(["fx", kind, ...data]);
  }

  isModified(cx: number, cz: number): boolean {
    return this.modified.has(chunkKey(cx, cz));
  }

  requestChunk(cx: number, cz: number): Promise<ChunkData | null> {
    const key = chunkKey(cx, cz);
    const rid = ++this.requestIds;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // The host did not answer: fall back to generating it, and say so once.
        this.chunkRequests.delete(`${rid}`);
        this.game?.message(`The host did not send chunk ${key} in time; showing it as generated.`, "#ffcc55");
        resolve(null);
      }, 10000);
      this.chunkRequests.set(`${rid}`, { resolve, parts: [], received: 0, timer });
      this.send({ t: "creq", to: this.hostId ?? undefined, cx, cz, rid });
    });
  }

  chunkLoaded(cx: number, cz: number, _fromSave: boolean): void {
    const key = chunkKey(cx, cz);
    const ops = this.pendingOps.get(key);
    if (!ops) return;
    this.pendingOps.delete(key);
    const after = this.chunkSeq.get(key) ?? -1;
    this.chunkSeq.delete(key);
    for (const { seq, op } of ops) if (seq > after) this.applyBlock(op);
  }
  private chunkSeq = new Map<string, number>();

  // ---- receiving --------------------------------------------------------------------------------

  private receive(m: NetMessage): void {
    if (this.closed || !m || typeof m.t !== "string" || m.from === this.myId) return;
    if (m.to && m.to !== this.myId) return;
    try {
      switch (m.t) {
        case "hello": if (this.role === "host") void this.onHello(m); break;
        case "welcome": if (this.role === "guest" && this.onWelcome) this.onWelcome(m.w as Welcome); break;
        case "refuse": if (this.onRefused) this.onRefused(String(m.reason)); break;
        case "creq": if (this.role === "host") void this.onChunkRequest(m); break;
        case "chunk": if (this.role === "guest") void this.onChunk(m); break;
        case "bye": this.onBye(m.from); break;
        case "b": this.onBatch(m.from, (m.ops as Op[]) ?? []); break;
      }
    } catch (err) {
      console.warn("[blockcraft] bad message", m.t, err);
    }
  }

  private async onHello(m: NetMessage): Promise<void> {
    const g = this.game;
    if (!g) return;
    if (m.v !== PROTOCOL) {
      this.send({ t: "refuse", to: m.from, reason: `The host is running a different version of ${GAME_NAME}. Both players should reload the page (or update the app).` });
      return;
    }
    const name = String(m.name ?? "Player").slice(0, 16) || "Player";
    const pid = typeof m.pid === "string" && m.pid ? m.pid.slice(0, 40) : m.from;
    this.playerIds.set(m.from, pid);
    const saved = g.meta.players[pid] ?? null;
    const w: Welcome = {
      worldName: g.meta.name, seed: g.meta.seed, seedText: g.meta.seedText, type: g.meta.type, time: g.time,
      rain: g.rain, thunder: g.thunder, spawn: g.worldSpawn(), rules: g.meta.rules, difficulty: g.meta.difficulty,
      gameMode: g.meta.gameMode, hardcore: g.meta.hardcore, cheats: g.meta.cheats, modified: [...this.modified], seq: this.seq,
      // Saved in another dimension than the party is in now: the guest comes in beside the host instead.
      player: saved && (saved.dimension ?? "overworld") !== g.dimension
        ? { ...saved, x: g.player.body.x + 1, y: g.player.body.y, z: g.player.body.z }
        : saved,
      hostId: this.myId, hostName: g.player.name, dimension: g.dimension, disabledMods: g.meta.disabledMods ?? [],
      waystones: g.meta.waystones ?? {},
      map: g.meta.map, mode: g.meta.mode ? { id: g.meta.mode.id, data: {} } : undefined, skyEpoch: g.meta.skyEpoch,
      place: g.meta.place,
    };
    this.send({ t: "welcome", to: m.from, w });
    if (!g.remote.has(m.from)) {
      g.message(`${name} joined the game`, "#ffff55");
      this.push(["ch", `\u0000join:${name} joined the game`, g.player.name]);
      this.names.set(m.from, name);
      const b = w.spawn ?? { x: 0, y: 80, z: 0 };
      this.touchRemote(m.from, { name, x: saved?.x ?? b.x, y: saved?.y ?? b.y, z: saved?.z ?? b.z });
      this.updateStatus();
    }
  }

  private async onChunkRequest(m: NetMessage): Promise<void> {
    const g = this.game;
    if (!g || !int(m.cx) || !int(m.cz)) return;
    const cx = m.cx as number, cz = m.cz as number;
    const data = await g.chunkForGuest(cx, cz);
    // Numbered edits go out ahead of the copy that already contains them, so the guest sees them as included.
    this.flush();
    if (!data) { this.send({ t: "chunk", to: m.from, rid: m.rid, cx, cz, none: true }); return; }
    const { data: bytes, gz } = await packChunk(data);
    const b64 = toBase64(bytes);
    const parts = Math.max(1, Math.ceil(b64.length / MAX_PART));
    for (let i = 0; i < parts; i++) {
      this.send({
        t: "chunk", to: m.from, rid: m.rid, cx, cz, gz, seq: this.seq, part: i, parts,
        data: b64.slice(i * MAX_PART, (i + 1) * MAX_PART), entities: i === 0 ? data.entities : undefined,
      });
    }
  }

  private async onChunk(m: NetMessage): Promise<void> {
    const req = this.chunkRequests.get(`${m.rid}`);
    if (!req) return;
    if (m.none) {
      clearTimeout(req.timer);
      this.chunkRequests.delete(`${m.rid}`);
      req.resolve(null);
      return;
    }
    const parts = Number(m.parts), part = Number(m.part);
    req.parts[part] = String(m.data ?? "");
    req.received++;
    if (part === 0) (req as unknown as { entities: unknown }).entities = m.entities;
    if (req.received < parts) return;
    clearTimeout(req.timer);
    this.chunkRequests.delete(`${m.rid}`);
    try {
      const { blocks, meta } = await unpackChunk(fromBase64(req.parts.join("")), !!m.gz);
      this.chunkSeq.set(chunkKey(m.cx as number, m.cz as number), Number(m.seq));
      req.resolve({ cx: m.cx as number, cz: m.cz as number, blocks, meta, entities: ((req as unknown as { entities?: [number, BlockEntity][] }).entities) ?? [] });
    } catch (err) {
      this.game?.message(`A chunk from the host could not be read (${(err as Error).message}); showing it as generated.`, "#ffcc55");
      req.resolve(null);
    }
  }

  private onBye(from: string): void {
    const g = this.game;
    if (!g) return;
    if (this.role === "guest" && from === this.hostId) {
      this.status = "host left";
      this.updateStatus();
      g.onFatal?.("The host closed the world.");
      return;
    }
    const r = g.remote.get(from);
    if (r) {
      g.remote.delete(from);
      g.message(`${r.name} left the game`, "#ffff55");
      this.updateStatus();
    }
  }

  private touchRemote(id: string, init?: Partial<RemotePlayer>): RemotePlayer {
    const g = this.game!;
    let r = g.remote.get(id);
    const now = performance.now();
    if (!r) {
      r = {
        id, name: this.names.get(id) ?? "Player", x: 0, y: 0, z: 0, yaw: 0, pitch: 0, px: 0, py: 0, pz: 0, pyaw: 0, walk: 0, speed: 0,
        swing: 0, sneaking: false, held: null, variant: 0, hurt: false, dead: false, gameMode: "survival", sleeping: false,
        invisible: false, riding: false, goldArmor: false, gliding: false, pumpkin: false, lastSeen: now, receivedAt: 0, ...init,
      };
      r.px = r.x; r.py = r.y; r.pz = r.z;
      g.remote.set(id, r);
      this.updateStatus();
    }
    r.lastSeen = now;
    return r;
  }

  private onBatch(from: string, ops: Op[]): void {
    const g = this.game;
    if (!g) {
      if (this.role === "guest" && this.early.length < 500) this.early.push({ from, ops });
      return;
    }
    const fromHost = from === this.hostId;
    if (this.role === "guest" && fromHost) this.lastHost = performance.now();
    if (this.role === "host") this.touchRemote(from);
    for (const op of ops) {
      if (!Array.isArray(op)) continue;
      const [type] = op;
      switch (type) {
        case "st": this.onState(from, op); break;
        case "ch": {
          const text = String(op[1] ?? "").slice(0, 256);
          if (text.startsWith("\u0000")) {
            // System lines (joins, deaths, advancements): shown as the game's words, not as chat.
            const [kind, msg] = text.slice(1).split(/:(.*)/s);
            if (msg) g.message(msg, kind === "adv" ? "#55ff55" : kind === "death" ? "#ff8888" : "#ffff55");
            // A guest's death is the host's mode's business (out of the Survival Games, a wave run over).
            if (kind === "death" && this.role === "host") g.mode?.onPlayerDeath(from);
          } else g.message(`<${String(op[2] ?? "?").slice(0, 16)}> ${text}`);
          break;
        }
        case "bl": if (this.role === "guest" && fromHost) this.onRemoteBlock(op); break;
        case "ed": if (this.role === "host") this.onGuestEdit(from, op); break;
        case "en": if (this.role === "guest" && fromHost) this.onEntities(op[1] as EntitySnapshot[]); break;
        case "env":
          if (this.role === "guest" && fromHost && finite(op[1], op[2], op[3])) {
            const t = op[1] as number;
            if (Math.abs(t - g.time) > 40) g.time = t;
            g.rain = op[2] as number; g.thunder = op[3] as number;
            if (int(op[4])) g.meta.difficulty = op[4] as 0 | 1 | 2 | 3;
            if (finite(op[5])) g.meta.skyEpoch = op[5] as number;
            if (finite(op[6], op[7]) && Math.abs(op[6] as number) <= 90) g.meta.place = { lat: op[6] as number, lon: op[7] as number };
            g.audio.setRain(g.rain);
          }
          break;
        case "fx": if (this.role === "guest" && fromHost) this.onEffect(op); break;
        case "hu":
          if (op[1] === this.myId && finite(op[2], op[4], op[5], op[6])) {
            g.hurtLocal(op[2] as number, op[3] as DamageSource, op[4] as number, op[5] as number, op[6] as number, int(op[7]) && (op[7] as number) >= 0 ? (op[7] as number) : undefined);
          }
          break;
        case "ef":
          if (op[1] === this.myId && fromHost && typeof op[2] === "string" && finite(op[3], op[4])) {
            g.player.applyEffect(op[2] as StatusEffect, Math.min(600, op[3] as number), Math.max(0, Math.min(4, op[4] as number)));
          }
          break;
        case "gv":
          if (op[1] === this.myId) {
            const st = sanitizeStack(op[2]);
            if (st) {
              const left = g.player.inventory.add(st);
              if (left > 0) this.drops(g.player.body.x, g.player.body.y + 1, g.player.body.z, [{ ...st, count: left }], 0);
              g.audio.play("pop", null, 0, 0, 0.25, 1.6);
              g.bumpInv();
            }
          }
          break;
        case "xp": if (op[1] === this.myId && finite(op[2])) g.collectXp(op[2] as number); break;
        case "ck": {
          // A guest's battle, shown in the world: the host holds the wild critter still, sends out theirs, sparks the hits.
          const c = this.role === "host" ? parseCritterOp(op[1]) : null;
          if (c) g.critters.host(from, g.remote.get(from)?.name ?? "?", c);
          break;
        }
        case "cv": {
          // Another player's link battle or trade, for this player only: checked as a stranger's words.
          const lm = op[1] === this.myId ? parseLinkMsg(op[2]) : null;
          if (lm) g.critters.link.receive(from, lm);
          break;
        }
        case "nz":
          // A guest's gunshot: the host's infected hear it — not from further than a rifle carries.
          if (this.role === "host" && finite(op[1], op[2], op[3], op[4])) g.makeNoise(op[1] as number, op[2] as number, op[3] as number, Math.min(96, op[4] as number), from);
          break;
        case "pu":
          // Shoved by a piston on the host.
          if (op[1] === this.myId && fromHost && finite(op[2], op[3], op[4])) {
            const b = g.player.body;
            b.x += Math.max(-1, Math.min(1, op[2] as number)); b.y += Math.max(-1.1, Math.min(1.1, op[3] as number)); b.z += Math.max(-1, Math.min(1, op[4] as number));
          }
          break;
        case "av": {
          const ev = op[2] as AdvancementEvent | null;
          if (op[1] === this.myId && fromHost && ev && (ev.kind === "kill" || ev.kind === "sleep" || ev.kind === "eat" || ev.kind === "dragon")) g.advance(ev);
          break;
        }
        case "be": this.onBlockEntity(from, op); break;
        case "at": if (this.role === "host") this.onAttack(from, op); break;
        case "in": if (this.role === "host") this.onInteract(from, op); break;
        case "dr": if (this.role === "host") this.onDrops(op); break;
        case "th": if (this.role === "host") this.onThrow(from, op); break;
        case "mo": if (this.role === "host") this.onMount(from, op); break;
        case "tr": if (this.role === "host") this.onTrade(from, op); break;
        case "vp": if (this.role === "host") this.onVehiclePose(from, op); break;
        case "pv": if (this.role === "host") this.onPlaceVehicle(from, op); break;
        case "pf": if (this.role === "host") this.onPlaceFrame(from, op); break;
        case "wz": if (this.role === "guest" && fromHost) g.meta.waystones = sanitizeWaystones(op[1]); break;
        case "mt":
          if (this.role === "guest" && fromHost && (op[1] === null || op[1] === this.myId)) g.applyModeTell(sanitizeModeTell(op[2]));
          break;
        case "md":
          if (this.role === "guest" && fromHost && Array.isArray(op[1])) {
            g.meta.disabledMods = (op[1] as unknown[]).filter((m): m is string => typeof m === "string").slice(0, 64);
            g.store.set({ minimap: g.modOn("minimap") });
          }
          break;
        case "wr": if (this.role === "host") this.onRegisterWaystone(from, op); break;
        case "gr": if (this.role === "host") this.onGuestGrave(from, op); break;
        case "gc": if (this.role === "host") this.onCollectGrave(from, op); break;
        case "wn": if (this.role === "host" && typeof op[1] === "string" && typeof op[2] === "string") g.renameWaystone(op[1], op[2]); break;
        case "fw": if (this.role === "host") this.onFirework(from, op); break;
        case "tp": if (op[1] === this.myId && fromHost) this.onTeleport(op[2]); break;
        case "ec":
          // A guest's end crystal, set on a block near them.
          if (this.role === "host" && finite(op[1], op[2], op[3])) {
            const r = g.remote.get(from);
            if (!r || Math.hypot(r.x - (op[1] as number), r.y - (op[2] as number), r.z - (op[3] as number)) <= 8) g.placeCrystal(op[1] as number, op[2] as number, op[3] as number);
          }
          break;
        case "tn": if (this.role === "host" && finite(op[1], op[2], op[3])) g.spawn(new PrimedTnt((op[1] as number) + 0.5, op[2] as number, (op[3] as number) + 0.5, 80)); break;
        case "sl": if (this.role === "host") { const r = g.remote.get(from); if (r) r.sleeping = op[1] === 1; } break;
        case "ps":
          if (this.role === "host" && op[1] && typeof op[1] === "object") {
            g.meta.players[this.playerIds.get(from) ?? from] = { ...(op[1] as PlayerSave), name: g.remote.get(from)?.name ?? "Player", dimension: g.dimension };
          }
          break;
        case "dm": if (this.role === "guest" && fromHost) this.onDimension(op); break;
        case "mk": if (this.role === "guest" && fromHost) this.onModifiedKeys(op); break;
        case "dp": if (this.role === "guest" && fromHost && finite(op[1], op[2], op[3])) g.partyPosition(op[1] as number, op[2] as number, op[3] as number); break;
      }
    }
  }

  private onState(from: string, op: Op): void {
    if (!finite(op[1], op[2], op[3], op[4], op[5])) return;
    const r = this.touchRemote(from);
    const now = performance.now();
    const x = op[1] as number, y = op[2] as number, z = op[3] as number;
    if (r.receivedAt === 0) {
      // First state from this player: appear there, rather than gliding in from the spawn guess.
      r.px = x; r.py = y; r.pz = z; r.pyaw = op[4] as number;
    } else {
      // Interpolate from wherever they are drawn right now, so a late packet never makes them jump back.
      const t = Math.min(1, (now - r.receivedAt) / 120);
      r.px += (r.x - r.px) * t; r.py += (r.y - r.py) * t; r.pz += (r.z - r.pz) * t; r.pyaw = r.yaw;
    }
    r.x = x; r.y = y; r.z = z;
    r.yaw = op[4] as number; r.pitch = op[5] as number;
    r.walk = Number(op[6]) || 0; r.speed = Number(op[7]) || 0; r.swing = Number(op[8]) || 0;
    r.sneaking = op[9] === 1;
    r.held = int(op[10]) && (op[10] as number) >= 0 ? (op[10] as number) : null;
    r.variant = int(op[11]) ? (op[11] as number) : 0;
    const name = String(op[12] ?? "").slice(0, 16);
    if (name && name !== r.name) { r.name = name; this.names.set(from, name); this.updateStatus(); }
    r.hurt = op[13] === 1;
    r.dead = op[14] === 1;
    r.gameMode = String(op[15] ?? "survival");
    r.sleeping = op[16] === 1;
    r.invisible = op[17] === 1;
    r.riding = op[18] === 1;
    r.goldArmor = op[19] === 1;
    r.gliding = op[20] === 1;
    r.pumpkin = op[21] === 1;
    r.receivedAt = now;
  }

  private onRemoteBlock(op: Op): void {
    const [, seq, x, y, z, id, meta] = op;
    if (!finite(seq, x, y, z, id, meta)) return;
    this.seq = Math.max(this.seq, seq as number);
    const key = chunkKey((x as number) >> 4, (z as number) >> 4);
    this.modified.add(key);
    const g = this.game!;
    if (!g.world.isLoaded(x as number, z as number)) {
      const list = this.pendingOps.get(key) ?? [];
      list.push({ seq: seq as number, op });
      this.pendingOps.set(key, list);
      return;
    }
    this.applyBlock(op);
  }

  private applyBlock(op: Op): void {
    const g = this.game!;
    const [, , x, y, z, id, meta] = op as number[];
    if (!block(id) || y < 0 || y > 127) return;
    const prev = g.world.blockAt(x, y, z);
    if (g.world.setBlock(x, y, z, id, meta, "remote")) this.remoteEditEffects(x, y, z, prev, id);
  }

  private remoteEditEffects(x: number, y: number, z: number, prev: number, id: number): void {
    const g = this.game!;
    const b = g.player.body;
    if (Math.abs(b.x - x) > 24 || Math.abs(b.z - z) > 24) return;
    if (prev && !id) {
      g.audio.block(block(prev).material, "break", x + 0.5, y + 0.5, z + 0.5);
      g.renderer.particles.emit("block", x + 0.5, y + 0.5, z + 0.5, 12, prev);
    } else if (id && !prev) {
      g.audio.block(block(id).material, "place", x + 0.5, y + 0.5, z + 0.5);
    }
  }

  private onGuestEdit(from: string, op: Op): void {
    const g = this.game!;
    const [, x, y, z, id, meta] = op;
    if (!finite(x, y, z, id, meta) || !int(id) || !int(meta) || (y as number) < 0 || (y as number) > 127) return;
    const r = g.remote.get(from);
    // A guest can only edit near where they are standing.
    if (r && (Math.abs(r.x - (x as number)) > 12 || Math.abs(r.z - (z as number)) > 12 || Math.abs(r.y - (y as number)) > 12)) return;
    const prev = g.world.blockAt(x as number, y as number, z as number);
    // setBlock with a non-"remote" cause re-broadcasts it to everyone, stamped.
    if (g.world.setBlock(x as number, y as number, z as number, id as number, meta as number, "player")) {
      this.remoteEditEffects(x as number, y as number, z as number, prev, id as number);
    }
  }

  private onBlockEntity(from: string, op: Op): void {
    const g = this.game!;
    const [, x, y, z, data] = op;
    if (!finite(x, y, z)) return;
    if (this.role === "guest" && from !== this.hostId) return;
    const kind = data && typeof data === "object" ? (data as BlockEntity).kind : undefined;
    const e = kind === "chest" || kind === "furnace" || kind === "brewing" ? (data as BlockEntity) : undefined;
    g.world.setEntity(x as number, y as number, z as number, e);
    if (this.role === "host") this.push(["be", x, y, z, e ?? null]);
    const s = g.screen;
    if (s && (s.kind === "chest" || s.kind === "furnace" || s.kind === "brewing") && s.x === x && s.y === y && s.z === z) g.bumpInv();
  }

  private onEntities(list: EntitySnapshot[]): void {
    const g = this.game!;
    if (!Array.isArray(list)) return;
    const seen = new Set<number>();
    for (const s of list) {
      if (!s || !int(s.id) || !finite(s.x, s.y, s.z)) continue;
      seen.add(s.id);
      let e = g.entities.get(s.id);
      if (!e) {
        const created = entityFromSnapshot(s);
        if (!created) continue;
        e = created;
        g.entities.set(e.id, e);
      } else if ((e instanceof Vehicle || e instanceof Mob) && g.player.riding === e.id) {
        // This guest drives it: keep its own motion, and only hear who the host says is riding.
        const rider = s.data?.r;
        if (typeof rider === "string" && rider !== g.player.id) g.dismount();
      } else {
        e.beginTick();
        e.applySnapshot(s);
      }
    }
    for (const [id] of g.entities) if (!seen.has(id)) g.entities.delete(id);
  }

  private onEffect(op: Op): void {
    const g = this.game!;
    const [, kind, ...d] = op;
    if (kind === "sound") {
      const [name, x, y, z, v, p] = d as [string, number, number, number, number, number];
      if (typeof name !== "string") return;
      if (name.startsWith("block:")) {
        const [, material, what] = name.split(":");
        g.audio.block(material as never, what as never, x, y, z);
      } else g.audio.play(name, x, y, z, v, p);
    } else if (kind === "particles") {
      const [name, x, y, z, count, data] = d as [string, number, number, number, number, number];
      g.renderer.particles.emit(name, x, y, z, Math.min(64, count), data);
    } else if (kind === "explosion") {
      if (d[0] === "lightning") { g.lightning = 1; return; }
      const [x, y, z] = d as number[];
      g.renderer.particles.emit("explosion", x, y, z, 24);
      g.audio.play("explode", x, y, z, 1, 1);
    }
  }

  private onAttack(from: string, op: Op): void {
    const g = this.game!;
    const [, id, dmg, fx, fz, kb, fire, looting, part, torpor] = op;
    if (!finite(id, dmg, fx, fz)) return;
    const e = g.entities.get(id as number);
    if (e instanceof Vehicle || e instanceof EndCrystal || e instanceof ItemFrame || e instanceof Projectile) { e.hurt(g.ctx, Math.min(40, dmg as number), "player", fx as number, fz as number, from); return; }
    if (e instanceof Mob) {
      e.looting = int(looting) ? Math.max(0, Math.min(3, looting as number)) : 0;
      // Which of the dragon's parts the guest's blow landed on; anything unrecognised counts as the body.
      if (e.kind === "ender_dragon") e.hurtPart = part === "head" || part === "neck" || part === "tail" || part === "wing" ? part : "body";
      const took = e.hurt(g.ctx, Math.min(40, dmg as number), "player", fx as number, fz as number, from, Math.min(2, Math.max(0, Number(kb) || 0)));
      // Fire Aspect from a guest's sword: the host owns the mob, so it lights it here.
      if (took && finite(fire) && (fire as number) > 0) e.fireTicks = Math.max(e.fireTicks, Math.min(200, fire as number));
      // A guest's club or fist: torpor, no more than a club gives.
      if (took && finite(torpor) && (torpor as number) > 0) e.addTorpor(g.ctx, Math.min(TORPOR.club, torpor as number), from);
    }
  }

  private onInteract(from: string, op: Op): void {
    const g = this.game!;
    const [, id, item, stack] = op;
    const e = g.entities.get(id as number);
    if (e instanceof Mob) {
      const result = e.interact(g.ctx, typeof item === "string" ? item : null, from, g.remote.get(from)?.name);
      if (result === "tamed") g.net?.advanceRemote?.(from, { kind: "tame" });
    }
    // The guest has already given up the item it hung; the frame takes the stack it sent.
    if (e instanceof ItemFrame) e.use(g.ctx, sanitizeStack(stack));
    if (e instanceof AreaCloud && item === "glass_bottle") e.bottled();
  }

  private onDrops(op: Op): void {
    const g = this.game!;
    const [, x, y, z, stacks, xp] = op;
    if (!finite(x, y, z)) return;
    if (Array.isArray(stacks)) {
      for (const raw of stacks.slice(0, 64)) {
        const s = sanitizeStack(raw);
        if (s) g.dropItem(x as number, y as number, z as number, { ...s, count: Math.min(64, s.count) });
      }
    }
    if (finite(xp) && (xp as number) > 0) g.spawnXp(x as number, y as number, z as number, Math.min(1000, xp as number));
  }

  private onMount(from: string, op: Op): void {
    const [, id, on] = op;
    const g = this.game!;
    const v = g.entities.get(id as number);
    // A creature carries only its owner, and only saddled and awake.
    if (v instanceof Mob) {
      if (on === 1 && canRide(v, from, g.remote.get(from)?.name)) v.rider = from;
      else if (on === 0 && v.rider === from) v.rider = null;
      return;
    }
    if (!(v instanceof Vehicle) || !v.rideable) return;
    // First come, first seated; a guest can only climb out of their own seat.
    if (on === 1 && (v.rider === null || v.rider === from)) {
      v.rider = from;
      if (v instanceof Car) g.carjack(v, from);
    } else if (on === 0 && v.rider === from) v.rider = null;
  }

  private onTrade(from: string, op: Op): void {
    const g = this.game!;
    const [, id, index] = op;
    const v = g.entities.get(id as number);
    const r = g.remote.get(from);
    if (!(v instanceof Mob) || v.kind !== "villager" || !int(index)) return;
    // A trade from a guest the host cannot place is refused, not waved through.
    if (!r || Math.hypot(r.x - v.x, r.z - v.z) > 10) return;
    const offer = v.offers[index as number];
    if (!offer || offer.uses >= offer.maxUses) return;
    if (v.traded(index as number)) g.particles("potion", v.x, v.y + 2.2, v.z, 12, 0x50e050);
  }

  private onVehiclePose(from: string, op: Op): void {
    const [, id, x, y, z, yaw, vx, vy, vz, hp] = op;
    const v = this.game!.entities.get(id as number);
    if (!(v instanceof Vehicle || v instanceof Mob) || v.rider !== from || !finite(x, y, z, yaw, vx, vy, vz)) return;
    const b = v.body;
    // A rider reports where their vehicle went; a jump further than a fast car could go is not believed.
    if (Math.hypot((x as number) - b.x, (z as number) - b.z) > 4) return;
    // Damage the driver's crashes did is believed; repairs are not.
    if (v instanceof Car && typeof hp === "number" && Number.isFinite(hp) && hp < v.health) v.damageBy(this.game!.ctx, v.health - Math.max(0, hp));
    b.x = x as number; b.y = y as number; b.z = z as number;
    b.vx = vx as number; b.vy = vy as number; b.vz = vz as number;
    v.yaw = yaw as number;
  }

  private onPlaceVehicle(from: string, op: Op): void {
    const g = this.game!;
    const [, kind, x, y, z, yaw, wood] = op;
    if (!isVehicleKind(kind) || !finite(x, y, z, yaw)) return;
    const r = g.remote.get(from);
    if (r && Math.hypot(r.x - (x as number), r.y - (y as number), r.z - (z as number)) > 8) return;
    g.placeVehicle(kind, x as number, y as number, z as number, yaw as number, int(wood) ? (wood as number) : 0);
  }

  private onFirework(from: string, op: Op): void {
    const g = this.game!;
    const [, x, y, z, raw] = op;
    const rocket = sanitizeRocket(raw);
    if (!finite(x, y, z) || !rocket) return;
    const r = g.remote.get(from);
    if (r && Math.hypot(r.x - (x as number), r.y - (y as number), r.z - (z as number)) > 8) return;
    // flight 0: a glider's spent rocket, bursting where they are.
    if ((raw as { flight?: unknown }).flight === 0) g.spawn(new FireworkRocket(x as number, y as number, z as number, rocket, 0, 0, 0, 0, from));
    else g.launchFirework(x as number, y as number, z as number, rocket, from);
  }

  /**
   * A guest died: the host lays their gravestone where they fell (near where
   * the host last saw them), or, with nowhere to lay it, drops their things there.
   */
  private onGuestGrave(from: string, op: Op): void {
    const g = this.game!;
    const [, x, y, z, raw, owner, yaw] = op;
    if (!finite(x, y, z, yaw) || !Array.isArray(raw)) return;
    const r = g.remote.get(from);
    if (r && Math.hypot(r.x - (x as number), r.y - (y as number), r.z - (z as number)) > 16) return;
    const items = raw.slice(0, 64).map((s) => sanitizeStack(s));
    if (!items.some(Boolean)) return;
    const name = typeof owner === "string" ? owner : r?.name ?? "Player";
    if (!g.placeGrave(x as number, y as number, z as number, items, name, yaw as number)) {
      for (const s of items) if (s) g.dropItem(x as number, (y as number) + 1, z as number, s);
    }
  }

  private onCollectGrave(from: string, op: Op): void {
    const g = this.game!;
    const [, x, y, z] = op;
    if (!int(x) || !int(y) || !int(z)) return;
    const r = g.remote.get(from);
    if (r && Math.hypot(r.x - (x as number), r.y - (y as number), r.z - (z as number)) > 8) return;
    g.collectGrave(x as number, y as number, z as number, from);
  }

  /** A guest found a waystone the world did not list: the host checks it is there, near them, and lists it. */
  private onRegisterWaystone(from: string, op: Op): void {
    const g = this.game!;
    const [, x, y, z] = op;
    if (!int(x) || !int(y) || !int(z)) return;
    const r = g.remote.get(from);
    if (r && Math.hypot(r.x - (x as number), r.y - (y as number), r.z - (z as number)) > 8) return;
    g.addWaystone(x as number, y as number, z as number);
  }

  private onPlaceFrame(from: string, op: Op): void {
    const g = this.game!;
    const [, face, x, y, z] = op;
    if (!int(face) || (face as number) < 0 || (face as number) > 5 || !int(x) || !int(y) || !int(z)) return;
    const r = g.remote.get(from);
    if (r && Math.hypot(r.x - (x as number), r.y - (y as number), r.z - (z as number)) > 8) return;
    g.placeFrame(face as number, x as number, y as number, z as number);
  }

  /** The host moved this player: a pearl landed (at once), or a gateway flung them (land once it loads). */
  private onTeleport(data: unknown): void {
    const g = this.game!;
    const a = data as { kind?: unknown; x?: unknown; y?: unknown; z?: unknown; index?: unknown; inner?: unknown } | null;
    if (!a || !finite(a.x, a.y, a.z)) return;
    const [x, y, z] = [a.x as number, a.y as number, a.z as number];
    if (a.kind === "gateway" && int(a.index)) g.arriveAt({ kind: "gateway", x, y, z, index: a.index as number, inner: a.inner === true });
    else g.teleportLocal(x, y, z);
  }

  private onThrow(from: string, op: Op): void {
    const g = this.game!;
    const [, kind, x, y, z, vx, vy, vz, item, damage, knockback, fire] = op;
    // Fireballs are the Nether's and the dragon's to throw, never a guest's.
    if (!isProjectileKind(kind) || kind === "fireball" || kind === "small_fireball" || kind === "dragon_fireball" || !finite(x, y, z, vx, vy, vz)) return;
    // An eye of ender needs the host's plan of the strongholds to know where to fly.
    if (kind === "eye_of_ender") { g.throwEye(x as number, y as number, z as number, from); return; }
    const p = new Projectile(kind, x as number, y as number, z as number, vx as number, vy as number, vz as number, from);
    if (kind === "potion") {
      if (!int(item) || !itemDef(item as number)) return;
      p.item = item as number;
    }
    // A guest's bow enchantments ride along, bounded so a message cannot forge a one-shot arrow.
    if (kind === "arrow" && finite(damage) && (damage as number) > 0) p.damage = Math.min(6, damage as number);
    if (finite(knockback)) p.knockback = Math.max(0, Math.min(2, knockback as number));
    p.fire = fire === 1;
    g.spawn(p);
  }
}

/** Rebuilds an entity a host described, on a guest. */
/** What travels with a thrown or shot projectile beyond its path: the potion inside, the bow's enchantments. */
export interface ThrowExtra { item?: number; damage?: number; knockback?: number; fire?: boolean }

export function entityFromSnapshot(s: EntitySnapshot): Entity | null {
  let e: Entity | null = null;
  if (isMobKind(s.kind)) e = new Mob(s.kind, s.x, s.y, s.z, s.id);
  else if (s.kind === "item") {
    const st = sanitizeStack(s.data?.stack);
    if (st) e = new ItemEntity(s.x, s.y, s.z, st, 0, s.id);
  } else if (s.kind === "xp") e = new XpOrb(s.x, s.y, s.z, Number(s.data?.value ?? 1), s.id);
  else if (isProjectileKind(s.kind)) e = new Projectile(s.kind, s.x, s.y, s.z, s.vx ?? 0, s.vy ?? 0, s.vz ?? 0, null, s.id);
  else if (isVehicleKind(s.kind)) e = vehicleFromSnapshot(s);
  else if (s.kind === "falling_block") e = new FallingBlock(s.x, s.y, s.z, Number(s.data?.b ?? 12), Number(s.data?.m ?? 0), s.id);
  else if (s.kind === "tnt") e = new PrimedTnt(s.x, s.y, s.z, Number(s.data?.fuse ?? 80), s.id);
  else if (s.kind === "end_crystal") e = new EndCrystal(s.x, s.y, s.z, s.data?.b !== 0, s.id);
  else if (s.kind === "area_cloud") e = new AreaCloud(s.x, s.y, s.z, Number(s.data?.r ?? 3), Number(s.data?.d ?? 600), null, s.id);
  else if (s.kind === "item_frame") e = new ItemFrame(Face.North, Math.floor(s.x), Math.floor(s.y), Math.floor(s.z), null, 0, s.id);
  else if (s.kind === "firework_rocket") e = new FireworkRocket(s.x, s.y, s.z, { flight: 1, bursts: [] }, 0, 0, 0, 1000, null, s.id);
  if (e) {
    e.applySnapshot(s);
    e.prevX = e.x; e.prevY = e.y; e.prevZ = e.z;
  }
  return e;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

