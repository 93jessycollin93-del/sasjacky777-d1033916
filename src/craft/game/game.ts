/**
 * One running world: the loop that ties the engine, the renderer, the audio,
 * saving and the network together.
 *
 * The simulation runs at a fixed 20 ticks a second and the renderer
 * interpolates between ticks, so the game plays identically at 30 fps on a
 * phone and 144 on a desktop. A tab in the background is throttled by the
 * browser; when it comes back, at most five ticks are caught up so a long
 * absence does not freeze the tab replaying minutes of world.
 *
 * Role decides who owns the world. "local" and "host" simulate everything:
 * block rules, mobs, weather, time. A "guest" simulates only its own player
 * and asks the host for everything else, so there is exactly one answer to
 * where the water went.
 */
import { B, block, boxColorOf, containerSize, FACE_DIRS, isBed, isFluid, isLeaves, isLog, OPPOSITE_FACING, type Material } from "../engine/blocks";
import { Redstone, type Body as RedstoneBody, type RedstoneContext } from "../engine/redstone";
import { chunkId, entityStacks, newBrewing, newChest, newFurnace, type BlockEntity, type BrewingEntity, type Chunk, type FurnaceEntity } from "../engine/chunk";
import { DAY_TICKS, SEA_LEVEL, TICK_MS, WORLD_HEIGHT } from "../engine/constants";
import { BlockRules, tickDelay } from "../engine/blockRules";
import { COOK_TICKS, fuelTicks, smeltResult } from "../engine/crafting";
import {
  AreaCloud, bumpEntityIds, EndCrystal, FallingBlock, FireworkRocket, ItemEntity, ItemFrame, PrimedTnt, Projectile, XpOrb, xpOrbValues,
  type DamageSource, type Entity, type EntityContext, type EntitySnapshot, type PlayerRef, type ProjectileKind,
} from "../engine/entities";
import { blastImpact, explosionBlocks, exposure } from "../engine/explosion";
import { itemByName, itemDef, itemId, itemLight, maxStack, resolveDrops, type ItemStack, type StatusEffect } from "../engine/items";
import { COUNTY_BLOCKS as C, LIGHT_OFF, LIGHT_ON } from "../engine/countyBlocks";
import { BOOK_SKILLS } from "../engine/countyItems";
import { invalid, occupation, type Survivor } from "../engine/survivors";
import {
  countyDay, GENERATOR_CAN, GENERATOR_REACH, GENERATOR_TANK, hasPower, hasWater, READ_IDLE, READ_TEACHES, SKILL_LESSON, spoiled, utilities,
} from "../engine/countyLife";
import { modEnabled } from "../engine/mods";
import { WorldMap } from "./worldMap";
import { withDeathPoint } from "../engine/waypoints";
import { graveSpot, packGrave, unpackGrave } from "../engine/graves";
import { ambientCue } from "../engine/ambience";
import { POT_SLOTS } from "../engine/cooking";
import { pickWildlife } from "../engine/wildlife";
import { dungeonLoot } from "../engine/dungeons";
import { fillLoot, MapGenerator, mapLayout, mapLoot } from "../engine/maps";
import { GROUND, type County } from "../engine/county";
import { COUNTY_LOOT, countyLootTable } from "../engine/countyLoot";
import type { CasinoGame } from "../engine/casino";
import { luckyOutcome } from "../engine/lucky";
import { createRuntime, modeDef, type ModeRuntime } from "../modes";
import { travelCost, WAYSTONE_NAME_MAX, waystoneKey, waystoneName, type Waystone } from "../engine/waystones";
import { seasonAt, seasonLabel, seasonTint, snowsHere, warmBiome, type Season } from "../engine/seasons";
import { MAX_DYNAMIC_LIGHTS } from "../render/materials";
import { isSlimeChunk, Mob, MOB_KINDS, MOB_SPECS, type MobKind } from "../engine/mobs";
import { isDino, pickCreatures } from "../engine/creatures";
import { canLearn, engramFor, ENGRAMS, type Engram } from "../engine/engrams";
import { CritterPlay, type CritterOp } from "./critterPlay";
import type { LinkMsg } from "./critterLink";
import { SpaceSession, blockToLatLon, placeFor } from "../space/session";
import { clockFor, eclipseLight, epochForToday, skyAt, skyJd, type SkyObjects } from "../space/sky";
import { jdFromMs } from "../space/kepler";
import { localClock, placeText } from "../space/skyReport";
import { SpaceView } from "../space/spaceView";
import { GalaxyView } from "../space/galaxyView";
import type { Star } from "../space/galaxy";
import { BREAK_FALL, knoxStage, knoxWound, SICKNESS_TICKS, sicknessChance, statusLine, vitalsSecond, waterFrom, type VitalsRules } from "../engine/vitals";
import { CREATURES, maxTorpor } from "../engine/creatures";
import { favouriteFoods } from "../engine/dinoAi";
import { countyGroup, countyInfectedCap, isInfected, pickCountyInfected, pickInfected } from "../engine/infected";
import { groundBlock } from "../engine/physics";
import { Player, type PlayerEvent } from "../engine/player";
import { Generator, type ChunkGenerator } from "../engine/worldgen";
import { createGenerator } from "../engine/generators";
import { DIMENSION_INFO, isDimension, type Dimension } from "../engine/dimension";
import { buildAtlas, type AtlasData } from "../engine/atlas";
import { WorkerPool } from "../engine/workerPool";
import { World, type BlockChange } from "../engine/world";
import { BiomeId, biomeDef } from "../engine/biomes";
import { newlyEarned, type AdvancementEvent } from "../engine/advancements";
import { GameAudio } from "../audio";
import { WorldRenderer, type RemotePlayerView } from "../render/renderer";
import { bottleBits, tickBrewing } from "../engine/brewing";
import { levelOf } from "../engine/enchanting";
import { potionOfItem, splashSeconds } from "../engine/potions";
import { Boat, Minecart, Vehicle, vehicleFromSnapshot } from "../engine/vehicles";
import { Car, kmh, type CarModelId } from "../engine/cars";
import { STATIONS } from "../engine/radio";
import { carCode, carFromCode, type ShopKind } from "../engine/shops";
import type { City } from "../engine/city";
import { CARJACK_QUIPS, pick as pickQuip, toughCitizen } from "../engine/citizens";
import { golemParts, villageLoot } from "../engine/villages";
import { fortressesTouching, fortressLoot, inFortress, NETHER_LAVA_LEVEL, SPAWNER_MOBS } from "../engine/nether";
import { planPortal, type PortalAxis } from "../engine/portal";
import { findEndPortal, inStronghold, nearestStronghold, strongholdLoot } from "../engine/stronghold";
import { rocketLife, rocketOf, type Rocket } from "../engine/fireworks";
import { buildGateway, cityLoot, END_SPAWN, EndGenerator, endCitiesTouching, GATEWAY_COUNT, gatewayPosition, type EndCity } from "../engine/end";
import { EndFight } from "./endFight";
import { FRAME_EYE } from "../engine/blocks";
import { hash4, Rng } from "../engine/rng";
import { Actions, lookFacing } from "./actions";
import type { ThrowExtra } from "../net/session";
import type { LinkKind } from "../net/transport";
import { GAME_SHORT } from "../edition";
import { runCommand } from "./commands";
import { SaveStore, type ChunkData, type WorldMeta } from "./save";
import { effectiveControls, saveSettings, type Settings } from "./settings";
import { Store } from "./store";
import { Streamer } from "./streamer";
import { emptyControls, type ChatLine, type Controls, type Hud, type Marker, type ModeTell, type Objective, type Screen } from "./types";
import { sanitizeStack, type Slot } from "../engine/inventory";

export type Role = "local" | "host" | "guest";

/** What the game needs from an online session. Implemented by net/session.ts. */
export interface NetLink {
  readonly role: "host" | "guest";
  readonly room: string;
  readonly kind: LinkKind;
  tick(): void;
  blockChanged(change: BlockChange): void;
  chat(text: string): void;
  // guest → host
  requestChunk(cx: number, cz: number): Promise<ChunkData | null>;
  isModified(cx: number, cz: number): boolean;
  attack(entityId: number, damage: number, fromX: number, fromZ: number, knockback?: number, fire?: number, looting?: number, part?: string, torpor?: number): void;
  interact(entityId: number, item: string | null, stack?: ItemStack | null): void;
  drops(x: number, y: number, z: number, stacks: ItemStack[], xp: number): void;
  throwItem(kind: ProjectileKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, extra?: ThrowExtra): void;
  primeTnt(x: number, y: number, z: number, fuse: number): void;
  blockEntity(x: number, y: number, z: number, e: BlockEntity | null): void;
  sleeping(on: boolean): void;
  chunkLoaded?(cx: number, cz: number, fromSave: boolean): void;
  // host → guests
  hurtRemote(id: string, amount: number, source: DamageSource, fx: number, fz: number, kb: number, attacker?: number): void;
  effectRemote?(id: string, effect: StatusEffect, seconds: number, amp: number): void;
  giveRemote(id: string, stack: ItemStack): void;
  xpRemote(id: string, amount: number): void;
  effect(kind: "sound" | "particles" | "explosion", data: unknown[]): void;
  /** A guest earned an advancement through something only the host simulates (a kill, a night slept through). */
  advanceRemote?(id: string, event: AdvancementEvent): void;
  /** A piston shoved a guest: move them on their own screen, which owns their position. */
  pushRemote?(id: string, dx: number, dy: number, dz: number): void;
  /** Guest → host: climb into, or out of, a vehicle; where the vehicle a guest drives went; put one down. */
  mount?(entityId: number, on: boolean): void;
  /** Guest → host: a trade was made with a villager (the host owns its experience and stock). */
  trade?(entityId: number, offer: number): void;
  vehiclePose?(v: Vehicle | Mob): void;
  placeVehicle?(kind: string, x: number, y: number, z: number, yaw: number, wood: number): void;
  placeFrame?(face: number, x: number, y: number, z: number): void;
  launchFirework?(x: number, y: number, z: number, rocket: Rocket): void;
  /** Host: the party moves to another dimension, arriving around x, y, z. */
  dimensionChanged?(dim: Dimension, x: number, y: number, z: number): void;
  /** Host: where it actually landed there (by the portal it came out of), for guests to land beside. */
  partyLanded?(x: number, y: number, z: number): void;
  /** Host → guest: carry this player somewhere (their pearl landed, or went through a gateway). */
  teleportRemote?(id: string, to: Arrival): void;
  /** Guest → host: set an end crystal on the block at x, y, z. */
  placeCrystal?(x: number, y: number, z: number): void;
  /** Guest → host: a noise the infected should hear (a gunshot). */
  noise?(x: number, y: number, z: number, radius: number): void;
  /** Guest → host: a battle's needs in the world (game/critterPlay.ts). */
  critter?(op: CritterOp): void;
  /** To one other player: a link battle's or a trade's message (game/critterLink.ts). */
  link?(to: string, msg: LinkMsg): void;
  /** Host → guests: the world's mod switches changed. */
  modsChanged?(): void;
  /** Host → guests: the world's waystones changed (one found, named or broken). */
  waystonesChanged?(): void;
  /** Guest → host: a waystone the world did not know of yet, found at x, y, z. */
  registerWaystone?(x: number, y: number, z: number): void;
  /** Guest → host: a waystone's new name. */
  renameWaystone?(key: string, name: string): void;
  /** Guest → host: lay a gravestone for my death at x, y, z. */
  placeGrave?(x: number, y: number, z: number, items: Slot[], owner: string, yaw: number): void;
  /** Guest → host: give me the gravestone at x, y, z. */
  collectGrave?(x: number, y: number, z: number): void;
  /** Host → a guest (or all): what the game mode wants them to see or be. */
  modeTell?(target: string | null, t: ModeTell): void;
  /** Guest: settles once the host has said which chunks of the new dimension it changed. */
  readonly keysReady?: Promise<void> | null;
  /** Guest: the host's connection id. */
  readonly hostConnection?: string | null;
  close(): void;
}

/** Where a player lands after changing dimension. */
/** "51.5°N 0.1°W", for a place on Earth. */
export function latLonText(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
}

export type Arrival =
  /** Through a portal: into the recorded one at x,y,z when `known`, else a new one built near there. */
  | { kind: "portal"; x: number; y: number; z: number; axis: PortalAxis; known: boolean }
  /** Respawning: at the world spawn or a bed, on the ground. `solo`: a trip of one player's own (the map), not the party's. */
  | { kind: "spawn"; x: number; y: number; z: number; solo?: boolean }
  /** Exactly here (a guest following the host, a waypoint, a waystone); `wait` until the host has said where it landed. */
  | { kind: "exact"; x: number; y: number; z: number; wait?: number; solo?: boolean }
  /** Into the End: onto the obsidian platform, built fresh (and cleared) each time, as in the original. */
  | { kind: "platform"; x: number; y: number; z: number }
  /** Through a gateway: on top of gateway `index`'s cage by the main island (`inner`), or on the ground under its far end. */
  | { kind: "gateway"; x: number; y: number; z: number; index: number; inner: boolean };

export interface RemotePlayer {
  id: string;
  name: string;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  px: number; py: number; pz: number; pyaw: number;
  walk: number; speed: number;
  swing: number;
  sneaking: boolean;
  held: number | null;
  variant: number;
  hurt: boolean;
  dead: boolean;
  gameMode: string;
  sleeping: boolean;
  /** Drank invisibility: drawn as nothing. */
  invisible: boolean;
  /** Seated in a boat or a cart. */
  riding: boolean;
  /** Wearing gold, which piglins respect. */
  goldArmor: boolean;
  /** On elytra, drawn lying along the flight. */
  gliding: boolean;
  /** A carved pumpkin on the head, which hides them from endermen's stares. */
  pumpkin: boolean;
  lastSeen: number;
  receivedAt: number;
}

export interface GameOptions {
  meta: WorldMeta;
  canvas: HTMLCanvasElement;
  settings: Settings;
  saves: SaveStore;
  playerId: string;
  playerName: string;
  role: Role;
}

const AUTOSAVE_TICKS = 600;
/** A wad of cash, which in a city is money the moment it is picked up. */
const CASH_ID = itemByName("cash").id;
const MAX_HOSTILE = 14;
const MAX_PASSIVE = 10;
/** Primal's creatures per player: enough that the wilds feel alive, few enough to keep a phone smooth. */
const MAX_FAUNA = 16;
/** Dead Zone's infected per player: a real threat, but not a wall of them. */
const MAX_INFECTED = 18;
/** Warmth a block gives off, 0..1, for body temperature (engine/vitals.ts). */
const HEAT: Record<number, number> = {
  [B.FIRE]: 1, [B.SOUL_FIRE]: 0.8, [B.LAVA]: 1, [B.LIT_FURNACE]: 0.8, [B.MAGMA_BLOCK]: 0.5,
  [B.TORCH]: 0.35, [B.LANTERN]: 0.35, [B.JACK_O_LANTERN]: 0.25,
};
/** Slots in a backpack: a chest's worth. */
const BACKPACK_SLOTS = 27;

export class Game {
  readonly meta: WorldMeta;
  readonly role: Role;
  settings: Settings;
  /** The dimension loaded now: the one the player (online, the host) is in. */
  dimension: Dimension;
  // The world and everything bound to it are rebuilt when the player changes dimension.
  world!: World;
  generator!: ChunkGenerator;
  pool!: WorkerPool;
  readonly renderer: WorldRenderer;
  readonly audio = new GameAudio();
  streamer!: Streamer;
  rules!: BlockRules;
  redstone!: Redstone;
  private atlas: AtlasData;
  private worldUnsubs: (() => void)[] = [];
  readonly saves: SaveStore;
  readonly player: Player;
  readonly controls: Controls = emptyControls();
  readonly entities = new Map<number, Entity>();
  readonly remote = new Map<string, RemotePlayer>();
  readonly store: Store<Hud>;
  readonly actions: Actions;
  /** The critter modes' battles, party and trainers (game/critterPlay.ts). */
  readonly critters: CritterPlay;
  net: NetLink | null = null;
  /** The stars of the rocket pushing this player's glide, to go off on them when it is spent. */
  boostBursts: Rocket | null = null;
  private boostWas = 0;
  /** Where the current dose of levitation began, for the advancement. */
  private levitatedFrom: number | null = null;

  time: number;
  rain = 0;
  thunder = 0;
  lightning = 0;
  tickCount = 0;
  screen: Screen | null = null;
  cursor: Slot = null;
  craftGrid: Slot[] = [null, null, null, null];
  /** The name typed into an open anvil, or null when untouched. */
  anvilName: string | null = null;
  perspective: 0 | 1 | 2 = 0;
  hudHidden = false;
  debug = false;
  /** A trip to space (space/session.ts): while it lasts, the player's body waits where they launched, out of harm's way. */
  space: SpaceSession | null = null;
  private spaceView: SpaceView | null = null;
  /** The galaxy map's renderer, made the first time the map is opened. */
  private galaxyView: GalaxyView | null = null;
  /** Seconds left of a launch's countdown. */
  private launchCountdown: number | null = null;
  /** How the starship flies: real physics (gravity, orbits) or the arcade's EVE rules. Kept between trips. */
  spacePhysics: "newton" | "arcade" = "newton";
  /** The real sky last worked out (space/sky.ts), and the latitude it was for. */
  private skyCache: { sky: SkyObjects; lat: number } | null = null;
  /** What the sky has done that has been told already (an eclipse, a shower's night), so it is told once. */
  private skyTold = new Set<string>();
  /** A slowed clock's fraction of a tick (advanceClock). */
  private slowClock = 0;
  hurtTilt = 0;
  lastHurtAt = 0;
  private running = false;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private hudTimer = 0;
  private chatLines: ChatLine[] = [];
  private chatId = 0;
  private dirtySave = new Set<number>();
  /** Changed chunks on their way to the save, by dimension and chunk id, so reading one back never finds the older copy. */
  private unloaded = new Map<string, ChunkData>();
  private pendingKey(id: number, dim: Dimension = this.dimension): string {
    return `${dim}|${id}`;
  }
  private saveTimer = 0;
  private savingNow = false;
  private stepDist = 0;
  private spawnPlaced = false;
  /** The player has been set down on the ground they spawn on (a starter screen waits for it). */
  get spawnReady(): boolean { return this.spawnPlaced; }
  private startedAt = performance.now();
  private playTimeBase: number;
  private title: Hud["title"] = null;
  private actionbar: Hud["actionbar"] = null;
  private heldNameAt = 0;
  private lastSelected = -1;
  private lastHeldId: number | null = null;
  private sleepCounter = 0;
  private unsubscribers: (() => void)[] = [];
  onExit: (() => void) | null = null;
  /** Called when the world can no longer continue (lost host, fatal error), with words for the screen. */
  onFatal: ((message: string) => void) | null = null;
  readonly ctx: EntityContext;
  readonly endFight = new EndFight(this);
  /** Everywhere this world's players have been, for the minimap and the world map (M). */
  readonly worldMap = new WorldMap();
  /** The world's game mode at play (modes/runtime.ts), where the world is simulated; guests hear it from the host. */
  mode: ModeRuntime | null = null;
  /** A square border (half-width `radius`) round the overworld's play area, set by a mode; outside it hurts. */
  border: { x: number; z: number; radius: number } | null = null;
  /** A mode's countdown: players look about but cannot move. */
  frozen = false;
  /** At most this much health, a mode's rule (One Heart). */
  maxHealth = 20;
  private objectiveNow: Objective | null = null;
  private objectiveSent = new Map<string, string>();

  constructor(opts: GameOptions) {
    this.meta = opts.meta;
    this.role = opts.role;
    this.settings = opts.settings;
    this.saves = opts.saves;
    this.time = opts.meta.time;
    this.rain = opts.meta.weather.rain;
    this.thunder = opts.meta.weather.thunder;
    this.playTimeBase = opts.meta.playTime;
    this.dimension = isDimension(opts.meta.dimension) ? opts.meta.dimension : "overworld";
    // A world first played today starts its sky today; one from before the sky was real starts it now too.
    if (!Number.isFinite(opts.meta.skyEpoch)) opts.meta.skyEpoch = epochForToday(this.time, jdFromMs(Date.now()));
    this.atlas = buildAtlas();
    this.ctx = this.makeContext();
    this.buildDimension();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, opts.settings.maxPixelRatio);
    this.renderer = new WorldRenderer(opts.canvas, this.world, pixelRatio);

    this.player = new Player(opts.playerId, opts.playerName);
    this.player.setGameMode(opts.meta.gameMode);
    if (opts.meta.player) this.player.load(opts.meta.player);
    else {
      const s = this.worldSpawn();
      this.player.body.x = s.x; this.player.body.y = s.y; this.player.body.z = s.z;
      this.needsSurface = true;
    }
    this.player.name = opts.playerName;
    this.applySettings(opts.settings);

    for (const s of opts.meta.entities ?? []) this.restoreEntity(s);

    this.store = new Store<Hud>(this.hudSnapshot());
    // The radio's DJ talks in captions.
    this.audio.onDj = (who, text) => this.caption(who, text, "#9ad8ff");
    this.actions = new Actions(this);
    this.critters = new CritterPlay(this);

    if (this.saves.problem) this.message(this.saves.problem, "#ffcc55");
    if (this.role !== "guest") {
      this.mode = createRuntime(this);
      this.mode?.resume();
    }
    // A guest's map is for the visit: the world, and so its saved map, is the host's.
    if (this.role !== "guest") {
      void this.saves.maps.load(this.meta.id).then((regions) => this.worldMap.merge(regions)).catch(() => {});
    }
  }

  /**
   * Builds the world for `this.dimension` and everything bound to it: its
   * generator and workers, block rules, redstone and the chunk streamer. The
   * renderer, audio, player and network link carry across.
   */
  private buildDimension(): void {
    const dim = this.dimension;
    const info = DIMENSION_INFO[dim];
    const world = new World();
    world.simulates = this.role !== "guest";
    this.world = world;
    // Dungeons are part of the terrain, so a guest's generator must be told the host's choice too (its meta carries it).
    const settings = { seed: this.meta.seed, type: this.meta.type, dimension: dim, dungeons: this.modOn("dungeons"), map: this.meta.map, lucky: !!modeDef(this.meta.mode?.id)?.lucky,
      berries: modeDef(this.meta.mode?.id)?.fauna === "primal" };
    this.generator = createGenerator(settings);
    this.pool = new WorkerPool({ kind: "init", settings, layers: this.atlas.layers });
    this.rules = new BlockRules(world, {
      dropItems: (x, y, z, stacks) => { for (const s of stacks) this.dropItem(x, y, z, s); },
      spawnFalling: (x, y, z, id, meta) => this.spawn(new FallingBlock(x, y, z, id, meta)),
      sound: (name, x, y, z, v, p) => this.sound(name, x, y, z, v, p),
      isRaining: () => this.rain > 0.5 && info.hasSky,
      random: Math.random,
      igniteTnt: (x, y, z) => { this.spawn(new PrimedTnt(x + 0.5, y, z + 0.5, 80)); this.sound("fuse", x + 0.5, y + 0.5, z + 0.5); },
      portalLit: (x, y, z, axis) => this.recordPortal(this.dimension, x, y, z, axis),
      fireSpreads: () => this.meta.rules.doFireTick !== false,
      season: () => (this.world === world ? this.season() : null),
    }, { lavaFast: info.lavaFast, portals: dim !== "end" });
    this.redstone = new Redstone(world, this.redstoneContext());
    const streamer = new Streamer(
      world, this.pool,
      { load: (cx, cz) => this.loadChunk(cx, cz), unload: (c) => this.unloadChunk(c) },
      { setChunk: (id, cx, cz, mesh) => this.renderer.setChunk(id, cx, cz, mesh), removeChunk: (id) => this.renderer.removeChunk(id) },
      this.settings.renderDistance,
      (chunk, fromSave) => {
        // A chunk the old dimension asked for, arriving after the player left it.
        if (this.world !== world) return;
        this.net?.chunkLoaded?.(chunk.cx, chunk.cz, fromSave);
        if (this.modOn("minimap")) this.worldMap.paintChunk(dim, chunk);
        if (this.simulates) this.redstone.onChunkLoaded(chunk);
        if (this.simulates && !fromSave) this.settleStructures(chunk.cx, chunk.cz);
        // A house the player first reaches after the power failed is dark: it was built with its lights on.
        if (this.county() && !this.powered()) this.darkenChunk(chunk);
      },
    );
    streamer.fancyLeaves = this.settings.graphics === "fancy";
    streamer.smoothLighting = this.settings.smoothLighting;
    this.streamer = streamer;
    for (const u of this.worldUnsubs.splice(0)) u();
    this.worldUnsubs.push(world.onChange((c) => this.redstone.onChange(c)));
    this.worldUnsubs.push(world.onChange((c) => this.onBlockChange(c)));
  }

  // ---- lifecycle --------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    document.addEventListener("visibilitychange", this.syncBackground);
    this.syncBackground();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      try {
        this.frame(t);
      } catch (err) {
        // One bad frame must not take the tab down, but it must not be silent either.
        console.error("[blockcraft] frame failed", err);
        this.message(`Something went wrong this frame: ${(err as Error).message}`, "#ff6666");
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  async stop(save = true): Promise<void> {
    this.running = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.syncBackground);
    if (this.backgroundTimer) clearInterval(this.backgroundTimer);
    this.backgroundTimer = null;
    if (save && this.role !== "guest") await this.saveNow().catch((e: Error) => console.error("[blockcraft] final save failed", e));
    this.net?.close();
    this.net = null;
    for (const u of this.unsubscribers) u();
    for (const u of this.worldUnsubs.splice(0)) u();
    this.pool.dispose();
    this.renderer.dispose();
    this.audio.dispose();
  }

  applySettings(s: Settings): void {
    this.settings = s;
    saveSettings(s);
    if (this.streamer.radius !== s.renderDistance) this.streamer.setRadius(s.renderDistance);
    const fancy = s.graphics === "fancy";
    if (this.streamer.fancyLeaves !== fancy || this.streamer.smoothLighting !== s.smoothLighting) {
      this.streamer.fancyLeaves = fancy;
      this.streamer.smoothLighting = s.smoothLighting;
      this.streamer.invalidate();
    }
    this.renderer.shared.uGamma.value = s.brightness;
    this.renderer.particles.budget = s.particles === "all" ? 1 : s.particles === "decreased" ? 0.5 : 0.15;
    this.audio.volumes = { master: s.masterVolume, sfx: s.soundVolume, music: s.musicVolume };
    this.audio.applyVolumes();
    this.resize();
  }

  resize(): void {
    const c = this.renderer.canvas;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.resize(w, h, Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio));
    this.spaceView?.resize(w, h);
  }

  get isMobile(): boolean {
    return effectiveControls(this.settings) === "mobile";
  }

  get simulates(): boolean {
    return this.role !== "guest";
  }

  // ---- chunks ---------------------------------------------------------------------------

  private async loadChunk(cx: number, cz: number): Promise<ChunkData | null> {
    const id = chunkId(cx, cz);
    const pending = this.unloaded.get(this.pendingKey(id));
    if (pending) return { ...pending, blocks: pending.blocks.slice(), meta: pending.meta.slice() };
    if (this.role === "guest") {
      // Just after the party changed dimension the host is still reading which chunks it changed there.
      if (this.net?.keysReady) await this.net.keysReady;
      if (this.net && this.net.isModified(cx, cz)) return this.net.requestChunk(cx, cz);
      return null;
    }
    return this.saves.getChunk(this.meta.id, cx, cz, this.dimension);
  }

  private unloadChunk(c: Chunk): void {
    if (this.role === "guest") return;
    this.persistChunks([this.chunkData(c)], this.dimension);
    this.dirtySave.delete(c.id);
  }

  /**
   * Writes chunks of a dimension, keeping each in memory until the save lands
   * so walking straight back never reads the older copy from disk.
   */
  private persistChunks(list: ChunkData[], dim: Dimension): void {
    if (!list.length) return;
    const keys = list.map((d) => this.pendingKey(chunkId(d.cx, d.cz), dim));
    list.forEach((d, i) => this.unloaded.set(keys[i], d));
    void this.saves.putChunks(this.meta.id, list, dim)
      .then(() => list.forEach((d, i) => { if (this.unloaded.get(keys[i]) === d) this.unloaded.delete(keys[i]); }))
      .catch((e: Error) => this.message(`Could not save part of the world: ${e.message}`, "#ff6666"));
  }

  chunkData(c: Chunk): ChunkData {
    return { cx: c.cx, cz: c.cz, blocks: c.blocks.slice(), meta: c.meta.slice(), entities: [...c.entities.entries()].map(([i, e]) => [i, structuredClone(e)]) };
  }

  /** Keys ("cx,cz") of a dimension's chunks still on their way to the save: changed, but not yet listed by it. */
  pendingChunkKeys(dim: Dimension): string[] {
    const out: string[] = [];
    for (const [key, d] of this.unloaded) if (key.startsWith(`${dim}|`)) out.push(`${d.cx},${d.cz}`);
    return out;
  }

  /** Current contents of a chunk if this game holds it (loaded or awaiting save) — the host answers guests from this. */
  async chunkForGuest(cx: number, cz: number): Promise<ChunkData | null> {
    const c = this.world.chunk(cx, cz);
    if (c) return this.chunkData(c);
    const pending = this.unloaded.get(this.pendingKey(chunkId(cx, cz)));
    if (pending) return pending;
    return this.saves.getChunk(this.meta.id, cx, cz, this.dimension);
  }

  // ---- dimensions ---------------------------------------------------------------------------

  /** Where the player lands once the destination's chunks are in. */
  private arrival: Arrival | null = null;
  /** Ticks stood in a portal. */
  portalTimer = 0;
  /**
   * Set on arriving in (or being refused) a portal: it cannot fire again until
   * the player steps out. Set from the start too — a world saved while standing
   * in a portal would otherwise send the player through the moment it loads.
   */
  private portalLock = true;
  private loadingSince = performance.now();

  /** Notes a lit portal so a trip from the other side comes out of it rather than building another. */
  recordPortal(dim: Dimension, x: number, y: number, z: number, axis: PortalAxis): void {
    const all = (this.meta.portals ??= {});
    const list = (all[dim] ??= []);
    if (!list.some(([px, py, pz]) => Math.abs(px - x) <= 1 && Math.abs(py - y) <= 2 && Math.abs(pz - z) <= 1)) list.push([x, y, z, axis]);
    if (list.length > 200) list.shift();
  }

  /** Mobs, items and vehicles worth keeping when their dimension goes out of memory. */
  private persistentEntities(): EntitySnapshot[] {
    return [...this.entities.values()]
      // A dragon keeps even its death throes: reloading mid-fall finishes the fall rather than losing the reward.
      // The city's own cars (traffic, the parked ones) are its to make again, not the save's to keep.
      .filter((e) => (e instanceof Mob && e.persistent && (!e.dying || e.kind === "ender_dragon")) || e instanceof ItemEntity || (e instanceof Vehicle && !(e instanceof Car && e.ambient)) || e instanceof EndCrystal || e instanceof ItemFrame)
      .slice(0, 600)
      .map((e) => e.snapshot());
  }

  /**
   * Moves the player — online, the whole party — to another dimension: the
   * one being left is saved (its changed chunks and its entities), the new
   * one is built, and the player lands at `arrival` once its chunks are in.
   */
  changeDimension(to: Dimension, arrival: Arrival): void {
    if (to === this.dimension) return;
    const from = this.dimension;
    this.dismount();
    this.actions.stopUsing();
    if (this.screen && this.screen.kind !== "death") this.setScreen(null);
    // Home from the End with the dragon slain: the poem, once, while home loads behind it.
    const poem = from === "end" && to === "overworld" && this.player.advancements.has("dragon") && !this.player.poemSeen;
    if (this.simulates) {
      const changed: ChunkData[] = [];
      for (const c of this.world.loadedChunks()) if (c.modified) changed.push(this.chunkData(c));
      this.persistChunks(changed, from);
      const others = (this.meta.otherEntities ??= {});
      others[from] = this.persistentEntities();
      this.entities.clear();
      for (const snap of others[to] ?? []) this.restoreEntity(snap);
      delete others[to];
    } else this.entities.clear();
    this.dirtySave.clear();
    this.golemChecks = [];
    this.spawners.clear();
    this.streamer.close();
    this.pool.dispose();
    this.dimension = to;
    this.meta.dimension = to;
    this.buildDimension();
    this.renderer.setWorld(this.world);
    const p = this.player, b = p.body;
    b.x = arrival.x; b.y = arrival.y; b.z = arrival.z;
    b.vx = b.vy = b.vz = 0;
    b.fallDistance = 0;
    p.prevX = b.x; p.prevY = b.y; p.prevZ = b.z;
    this.arrival = arrival;
    this.spawnPlaced = false;
    this.needsSurface = false;
    this.loadingSince = performance.now();
    this.portalTimer = 0;
    this.portalLock = true;
    this.net?.dimensionChanged?.(to, arrival.x, arrival.y, arrival.z);
    this.advance({ kind: "dimension", dimension: to });
    if (poem) {
      this.player.poemSeen = true;
      this.setScreen({ kind: "poem" });
    }
  }

  /** Guest: the host landed here after a change of dimension; come in beside it. */
  partyPosition(x: number, y: number, z: number): void {
    if (this.arrival?.kind === "exact") {
      this.arrival = { kind: "exact", x, y, z };
      return;
    }
    const p = this.player, b = p.body;
    b.x = x + 1; b.y = y; b.z = z;
    b.vx = b.vy = b.vz = 0;
    p.prevX = b.x; p.prevY = b.y; p.prevZ = b.z;
  }

  /** The portal timer ran out: through to the other side, linked to a portal already there if one is near. */
  private portalTravel(): void {
    const b = this.player.body;
    const to: Dimension = this.dimension === "nether" ? "overworld" : "nether";
    const scale = DIMENSION_INFO[this.dimension].scale / DIMENSION_INFO[to].scale;
    const tx = b.x * scale, tz = b.z * scale;
    const here = this.world.blockAt(Math.floor(b.x), Math.floor(b.y + 0.5), Math.floor(b.z));
    const axis = (here === B.NETHER_PORTAL ? this.world.getMeta(Math.floor(b.x), Math.floor(b.y + 0.5), Math.floor(b.z)) & 1 : 0) as PortalAxis;
    // The original's link distances: 128 blocks out in the overworld, 16 in the Nether.
    const radius = to === "nether" ? 16 : 128;
    let best: [number, number, number, number] | null = null, bestD = Infinity;
    for (const q of this.meta.portals?.[to] ?? []) {
      const d = Math.max(Math.abs(q[0] - tx), Math.abs(q[2] - tz));
      if (d <= radius && d < bestD) { best = q; bestD = d; }
    }
    const y = to === "nether" ? Math.max(NETHER_LAVA_LEVEL + 3, Math.min(110, b.y)) : Math.max(SEA_LEVEL, b.y);
    this.changeDimension(to, best
      ? { kind: "portal", x: best[0], y: best[1], z: best[2], axis: best[3] as PortalAxis, known: true }
      : { kind: "portal", x: Math.floor(tx), y: Math.floor(y), z: Math.floor(tz), axis, known: false });
  }

  /**
   * Portals: a Nether portal takes four seconds stood in it (at once in
   * creative); an End portal takes the player the moment they drop into it,
   * as in the original. Gateways are checked here too.
   */
  private tickPortal(): void {
    const p = this.player, b = p.body;
    const fx = Math.floor(b.x), fz = Math.floor(b.z);
    const at = (dy: number) => this.world.blockAt(fx, Math.floor(b.y + dy), fz);
    const endPortal = at(0.05) === B.END_PORTAL || at(0.6) === B.END_PORTAL;
    const netherPortal = at(0.2) === B.NETHER_PORTAL || at(1.2) === B.NETHER_PORTAL;
    const inside = endPortal || netherPortal;
    if (!inside || p.dead || p.riding !== null) {
      this.portalLock = this.portalLock && inside;
      this.portalTimer = 0;
      this.tickGateway();
      return;
    }
    if (this.portalLock) return;
    if (endPortal) {
      this.portalLock = true;
      if (this.role === "guest") {
        this.showActionbar("Online, portals take the party when the host steps through");
        return;
      }
      this.sound("portal_travel", null, 0, 0, 0.6);
      if (this.dimension === "end") this.leaveEnd();
      else this.changeDimension("end", { kind: "platform", ...END_SPAWN });
      return;
    }
    if (this.portalTimer === 0) this.sound("portal_trigger", b.x, b.y + 1, b.z, 0.6);
    this.portalTimer++;
    if (this.portalTimer < (p.gameMode === "creative" ? 1 : 80)) return;
    this.portalTimer = 0;
    this.portalLock = true;
    if (this.role === "guest") {
      this.showActionbar("Online, portals take the party when the host steps through");
      return;
    }
    this.sound("portal_travel", null, 0, 0, 0.6);
    this.portalTravel();
  }

  /** Out of the End through its exit portal: home to the player's bed, or the world spawn. */
  private leaveEnd(): void {
    const bed = this.player.spawn;
    const target = bed ? { x: bed.x + 0.5, y: bed.y + 0.6, z: bed.z + 0.5 } : this.worldSpawn();
    this.changeDimension("overworld", bed ? { kind: "exact", ...target } : { kind: "spawn", ...target });
  }

  private gatewayCooldown = 0;

  /** Touching a gateway (it is caged top and bottom, so this means reaching in from the side) flings the player through. */
  private tickGateway(): void {
    if (this.dimension !== "end") return;
    if (this.gatewayCooldown > 0) { this.gatewayCooldown--; return; }
    const p = this.player, b = p.body;
    if (p.dead || p.riding !== null || this.arrival) return;
    const reach = b.width / 2 + 0.3;
    for (let y = Math.floor(b.y - 0.3); y <= Math.floor(b.y + b.height + 0.3); y++) {
      for (let z = Math.floor(b.z - reach); z <= Math.floor(b.z + reach); z++) {
        for (let x = Math.floor(b.x - reach); x <= Math.floor(b.x + reach); x++) {
          if (this.world.blockAt(x, y, z) !== B.END_GATEWAY) continue;
          const exit = this.gatewayExit(x, z);
          if (!exit) return;
          this.gatewayCooldown = 60;
          this.sound("portal_travel", null, 0, 0, 0.5);
          this.arriveAt(exit);
          this.advance({ kind: "gateway" });
          return;
        }
      }
    }
  }

  /**
   * Where a gateway at x, z leads: from one by the main island, to the ground
   * under its far end out on the islands; from a far end, onto the top of its
   * partner by the main island.
   */
  gatewayExit(x: number, z: number): Arrival | null {
    const g = this.generator;
    if (!(g instanceof EndGenerator)) return null;
    let best = 0, bestD = Infinity;
    const inner = Math.hypot(x, z) < 400;
    for (let i = 0; i < GATEWAY_COUNT; i++) {
      const [px, , pz] = inner ? gatewayPosition(i) : g.gatewayExit(i).gateway;
      const d = Math.hypot(px - x, pz - z);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (inner) {
      const [lx, ly, lz] = g.gatewayExit(best).land;
      return { kind: "gateway", x: lx + 0.5, y: ly, z: lz + 0.5, index: best, inner: false };
    }
    const [px, py, pz] = gatewayPosition(best);
    return { kind: "gateway", x: px + 0.5, y: py + 3, z: pz + 0.5, index: best, inner: true };
  }

  /** Sends this player somewhere that may not be loaded yet: they hold there until it is, then land. */
  arriveAt(a: Arrival): void {
    const p = this.player, b = p.body;
    b.x = a.x; b.y = a.y; b.z = a.z;
    b.vx = b.vy = b.vz = 0;
    b.fallDistance = 0;
    p.prevX = b.x; p.prevY = b.y; p.prevZ = b.z;
    p.gliding = false;
    this.arrival = a;
    this.spawnPlaced = false;
  }

  /** Moves this player at once, to a spot already loaded (a pearl's landing, a chorus fruit's jump), lifted clear of any wall. */
  teleportLocal(x: number, y: number, z: number): void {
    const p = this.player, b = p.body, w = this.world;
    let ty = y;
    for (let i = 0; i < 3 && (block(w.blockAt(Math.floor(x), Math.floor(ty), Math.floor(z))).solid || block(w.blockAt(Math.floor(x), Math.floor(ty + 1), Math.floor(z))).solid); i++) ty = Math.floor(ty) + 1;
    b.x = x; b.y = ty; b.z = z;
    b.vx = b.vy = b.vz = 0;
    b.fallDistance = 0;
    p.prevX = b.x; p.prevY = b.y; p.prevZ = b.z;
  }

  /** An ender pearl came down: its thrower goes there (taking five points of fall), or, if it struck a gateway, through it. */
  private pearlLanded(id: string, x: number, y: number, z: number, gateway: [number, number, number] | null): void {
    const exit = gateway ? this.gatewayExit(gateway[0], gateway[2]) : null;
    if (id === this.player.id) {
      if (this.player.dead) return;
      if (exit) { this.arriveAt(exit); this.advance({ kind: "gateway" }); }
      else { this.teleportLocal(x, y, z); this.hurtLocal(5, "fall"); }
    } else {
      if (!this.remote.has(id)) return;
      this.net?.teleportRemote?.(id, exit ?? { kind: "exact", x, y, z });
      if (!exit) this.net?.hurtRemote(id, 5, "fall", x, z, 0);
      else this.net?.advanceRemote?.(id, { kind: "gateway" });
    }
    this.sound("enderman_teleport", x, y, z, 0.8);
  }

  /** A chorus fruit eaten: up to sixteen tries at a spot within eight blocks with a floor and room to stand. */
  private chorusTeleport(): void {
    const p = this.player, b = p.body, w = this.world;
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(b.x + (Math.random() - 0.5) * 16), z = Math.floor(b.z + (Math.random() - 0.5) * 16);
      let y = Math.max(2, Math.min(WORLD_HEIGHT - 3, Math.floor(b.y + (Math.random() - 0.5) * 16)));
      if (!w.isLoaded(x, z)) continue;
      while (y > 1 && !block(w.blockAt(x, y - 1, z)).solid) y--;
      const floor = w.blockAt(x, y - 1, z);
      if (!block(floor).solid || floor === B.LAVA || block(w.blockAt(x, y, z)).solid || block(w.blockAt(x, y + 1, z)).solid || isFluid(w.blockAt(x, y, z))) continue;
      this.particles("portal", b.x, b.y + 1, b.z, 16);
      this.teleportLocal(x + 0.5, y, z + 0.5);
      this.sound("chorus_fruit_teleport", x + 0.5, y, z + 0.5, 0.8);
      return;
    }
  }

  /** Frames that just took an eye: the one that completes a ring of twelve fills it with portal. */
  private lightEndPortals(): void {
    const w = this.world;
    for (const [x, y, z] of this.endPortalChecks.splice(0)) {
      const cells = findEndPortal((a, b2, c) => w.blockAt(a, b2, c), (a, b2, c) => w.getMeta(a, b2, c), x, y, z);
      if (!cells) continue;
      for (const [cx, cy, cz] of cells) w.setBlock(cx, cy, cz, B.END_PORTAL, 0, "world");
      this.sound("end_portal_spawn", x + 0.5, y + 0.5, z + 0.5, 3);
    }
  }

  /** Throws an eye of ender from here toward the nearest stronghold (the host's, or a guest's thrown for them). */
  throwEye(x: number, y: number, z: number, owner: string): void {
    const eye = new Projectile("eye_of_ender", x, y, z, 0, 0, 0, owner);
    eye.item = itemId("eye_of_ender");
    const s = nearestStronghold(this.meta.seed, x, z);
    eye.signalTo(s.x + 0.5, s.y, s.z + 0.5, Math.random);
    this.spawn(eye);
    this.sound("eye_of_ender_launch", x, y, z, 1);
  }

  /** Sets an end crystal on the block top at x, y, z; four on the exit portal's rim summon the dragon again. */
  placeCrystal(x: number, y: number, z: number): void {
    if (!this.simulates) return;
    const cx = x + 0.5, cy = y + 1, cz = z + 0.5;
    if ([...this.entities.values()].some((e) => e instanceof EndCrystal && Math.abs(e.x - cx) < 1 && Math.abs(e.y - cy) < 1 && Math.abs(e.z - cz) < 1)) return;
    this.spawn(new EndCrystal(cx, cy, cz));
    if (this.dimension === "end") this.endFight.crystalPlaced();
  }

  /** The dragon egg flees a touch: it blinks to a free spot up to eight blocks away. */
  teleportEgg(x: number, y: number, z: number): void {
    const w = this.world;
    for (let i = 0; i < 200; i++) {
      const tx = x + Math.floor(Math.random() * 17) - 8, ty = y + Math.floor(Math.random() * 9) - 4, tz = z + Math.floor(Math.random() * 17) - 8;
      if (ty < 1 || ty >= WORLD_HEIGHT - 1 || w.getBlock(tx, ty, tz) !== B.AIR) continue;
      w.setBlock(x, y, z, B.AIR, 0, "player");
      w.setBlock(tx, ty, tz, B.DRAGON_EGG, 0, "player");
      this.particles("portal", x + 0.5, y + 0.5, z + 0.5, 16);
      this.particles("portal", tx + 0.5, ty + 0.5, tz + 0.5, 16);
      return;
    }
  }

  /** Lands the player once the destination has loaded. Returns false while still waiting. */
  private settleArrival(a: Arrival): boolean {
    const w = this.world;
    const x = Math.floor(a.x), z = Math.floor(a.z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!w.isLoaded(x + dx * 16, z + dz * 16)) return false;
    const b = this.player.body;
    if (a.kind === "portal") {
      let spot: { x: number; y: number; z: number; axis: PortalAxis } | null = null;
      if (a.known && w.blockAt(a.x, a.y, a.z) === B.NETHER_PORTAL) spot = a;
      else if (a.known) {
        // Broken since: forget it, and build a new one where it stood.
        const list = this.meta.portals?.[this.dimension];
        if (list) this.meta.portals![this.dimension] = list.filter(([px, py, pz]) => px !== a.x || py !== a.y || pz !== a.z);
      }
      if (!spot) {
        const [yMin, yMax] = this.dimension === "nether" ? [NETHER_LAVA_LEVEL + 2, 116] : [2, WORLD_HEIGHT - 8];
        const plan = planPortal((px, py, pz) => w.getBlock(px, py, pz), a.x, a.y, a.z, a.axis, 16, yMin, yMax);
        for (const [px, py, pz, id, m] of plan.blocks) w.setBlock(px, py, pz, id, m, "world");
        this.recordPortal(this.dimension, plan.x, plan.y, plan.z, plan.axis);
        spot = plan;
      }
      b.x = spot.x + (spot.axis === 0 ? 1 : 0.5);
      b.z = spot.z + (spot.axis === 0 ? 0.5 : 1);
      b.y = spot.y;
    } else if (a.kind === "platform") {
      // A five-by-five obsidian floor over the void, with room cleared above it: built fresh every arrival.
      const px = Math.floor(a.x), py = Math.floor(a.y), pz = Math.floor(a.z);
      if (this.simulates) {
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          w.setBlock(px + dx, py - 1, pz + dz, B.OBSIDIAN, 0, "world");
          for (let dy = 0; dy <= 2; dy++) w.setBlock(px + dx, py + dy, pz + dz, B.AIR, 0, "world");
        }
      }
      b.x = px + 0.5; b.y = py; b.z = pz + 0.5;
      // Facing the island.
      this.player.yaw = Math.PI / 2;
    } else if (a.kind === "gateway") {
      if (a.inner) {
        // Onto the top of the gateway's cage; if this pair's near end never opened, it opens now.
        const [gx, gy, gz] = gatewayPosition(a.index);
        if (w.blockAt(gx, gy + 2, gz) !== B.BEDROCK && this.simulates) buildGateway((px, py, pz, id, m = 0) => { w.setBlock(px, py, pz, id, m, "world"); }, gx, gy, gz);
        if (w.blockAt(gx, gy + 2, gz) === B.BEDROCK) { b.x = gx + 0.5; b.y = gy + 3; b.z = gz + 0.5; }
        else { const ground = this.groundNear(x, z); if (ground) { b.x = ground.x; b.y = ground.y; b.z = ground.z; } }
      } else {
        const ground = this.groundNear(x, z);
        if (ground) { b.x = ground.x; b.y = ground.y; b.z = ground.z; }
      }
    } else if (a.kind === "exact") {
      // A guest waits (a while) to hear where the host landed, rather than guessing and falling.
      if (a.wait !== undefined && performance.now() < a.wait) return false;
      // The nearest spot beside the host with floor under it and room to stand (portals are walked through);
      // failing that, straight up out of whatever is solid.
      const hy = Math.floor(a.y);
      const free = (fx: number, fy: number, fz: number) =>
        !block(w.blockAt(fx, fy, fz)).solid && !block(w.blockAt(fx, fy + 1, fz)).solid && block(w.blockAt(fx, fy - 1, fz)).solid
        && !isFluid(w.blockAt(fx, fy, fz)) && !isFluid(w.blockAt(fx, fy - 1, fz));
      let spot: [number, number, number] | null = null;
      for (let r = 1; r <= 3 && !spot; r++) {
        for (const dy of [0, 1, -1, 2]) for (let dz = -r; dz <= r && !spot; dz++) for (let dx = -r; dx <= r && !spot; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) === r && free(x + dx, hy + dy, z + dz)) spot = [x + dx, hy + dy, z + dz];
        }
      }
      if (spot) { b.x = spot[0] + 0.5; b.y = spot[1]; b.z = spot[2] + 0.5; }
      else {
        let y = hy;
        while (y < WORLD_HEIGHT - 2 && (block(w.blockAt(x, y, z)).solid || block(w.blockAt(x, y + 1, z)).solid)) y++;
        b.x = a.x; b.y = y; b.z = a.z;
      }
    } else {
      const ground = this.groundNear(x, z);
      if (ground) { b.x = ground.x; b.y = ground.y; b.z = ground.z; }
    }
    this.player.prevX = b.x; this.player.prevY = b.y; this.player.prevZ = b.z;
    b.vx = b.vy = b.vz = 0;
    return true;
  }

  // ---- spawners ----------------------------------------------------------------------------

  /** Spawner blocks in loaded chunks and ticks until each next breeds. */
  private spawners = new Map<string, number>();

  private findSpawners(cx: number, cz: number): void {
    const c = this.world.chunk(cx, cz);
    if (!c) return;
    for (let i = c.blocks.indexOf(B.SPAWNER); i >= 0; i = c.blocks.indexOf(B.SPAWNER, i + 1)) {
      const x = cx * 16 + (i & 15), z = cz * 16 + ((i >> 4) & 15), y = i >> 8;
      this.spawners.set(`${x},${y},${z}`, 100 + Math.floor(Math.random() * 400));
    }
  }

  /** A spawner with a player within sixteen blocks breeds up to four of its mob every ten to forty seconds. */
  private tickSpawners(refs: PlayerRef[]): void {
    for (const [key, delay] of this.spawners) {
      const [x, y, z] = key.split(",").map(Number);
      if (!this.world.isLoaded(x, z)) { this.spawners.delete(key); continue; }
      if (this.world.blockAt(x, y, z) !== B.SPAWNER) { this.spawners.delete(key); continue; }
      if (!refs.some((r) => Math.hypot(r.x - x, r.y - y, r.z - z) <= 16)) continue;
      if (this.tickCount % 10 === 0) this.particles("flame", x + 0.5, y + 0.5, z + 0.5, 1, 0, false);
      if (delay > 0) { this.spawners.set(key, delay - 1); continue; }
      this.spawners.set(key, 200 + Math.floor(Math.random() * 600));
      if (this.meta.difficulty === 0) continue;
      const kind = SPAWNER_MOBS[this.world.getMeta(x, y, z) % SPAWNER_MOBS.length] as MobKind;
      if (!MOB_KINDS.includes(kind)) continue;
      const near = [...this.entities.values()].filter((e) => e instanceof Mob && e.kind === kind && Math.hypot(e.x - x, e.z - z) < 9).length;
      for (let n = 0; n < 4 && near + n < 6; n++) {
        const sx = x + Math.floor((Math.random() - 0.5) * 8), sy = y + Math.floor(Math.random() * 3) - 1, sz = z + Math.floor((Math.random() - 0.5) * 8);
        if (block(this.world.blockAt(sx, sy, sz)).solid || block(this.world.blockAt(sx, sy + 1, sz)).solid) continue;
        if (!block(this.world.blockAt(sx, sy - 1, sz)).solid && kind !== "blaze") continue;
        this.spawn(new Mob(kind, sx + 0.5, sy, sz + 0.5));
        this.particles("smoke", sx + 0.5, sy + 0.5, sz + 0.5, 8);
      }
    }
  }

  // ---- entities -----------------------------------------------------------------------------

  spawn(e: Entity): void {
    if (!this.simulates) return;
    this.entities.set(e.id, e);
  }

  dropItem(x: number, y: number, z: number, stack: ItemStack, vx?: number, vy?: number, vz?: number, thrower: string | null = null, delay = 10): void {
    if (stack.count <= 0) return;
    if (this.role === "guest") {
      this.net?.drops(x, y, z, [stack], 0);
      return;
    }
    const e = new ItemEntity(x, y, z, { ...stack }, delay);
    e.body.vx = vx ?? (Math.random() - 0.5) * 0.2;
    e.body.vy = vy ?? 0.2;
    e.body.vz = vz ?? (Math.random() - 0.5) * 0.2;
    e.thrower = thrower;
    this.spawn(e);
  }

  spawnXp(x: number, y: number, z: number, amount: number): void {
    if (amount <= 0) return;
    if (this.role === "guest") { this.net?.drops(x, y, z, [], amount); return; }
    for (const v of xpOrbValues(amount)) this.spawn(new XpOrb(x, y, z, v));
  }

  private restoreEntity(s: EntitySnapshot): void {
    let e: Entity | null = null;
    if (MOB_KINDS.includes(s.kind as MobKind)) {
      const m = new Mob(s.kind as MobKind, s.x, s.y, s.z, s.id);
      m.applySnapshot(s);
      e = m;
    } else if (s.kind === "item") {
      const st = sanitizeStack(s.data?.stack);
      if (st) e = new ItemEntity(s.x, s.y, s.z, st, 0, s.id);
    } else if (s.kind === "xp") {
      e = new XpOrb(s.x, s.y, s.z, Number(s.data?.value ?? 1), s.id);
    } else if (s.kind === "end_crystal") {
      e = new EndCrystal(s.x, s.y, s.z, s.data?.b !== 0, s.id);
    } else if (s.kind === "item_frame") {
      e = new ItemFrame(0, Math.floor(s.x), Math.floor(s.y), Math.floor(s.z), null, 0, s.id);
      e.applySnapshot(s);
      // Nobody is riding anything when a world opens, creatures included.
      if (e instanceof Mob) e.rider = null;
    } else if (s.kind === "firework_rocket") {
      return;
    } else {
      e = vehicleFromSnapshot(s);
      // Nobody is riding anything when a world opens.
      if (e instanceof Vehicle) e.rider = null;
    }
    if (e) {
      bumpEntityIds(e.id);
      this.entities.set(e.id, e);
    }
  }

  private redstoneContext(): RedstoneContext {
    return {
      sound: (name, x, y, z, v, p) => this.sound(name, x, y, z, v, p),
      particles: (kind, x, y, z, count) => this.particles(kind, x, y, z, count ?? 1),
      dropItems: (x, y, z, stacks) => { for (const s of stacks) this.dropItem(x, y, z, s); },
      primeTnt: (x, y, z) => {
        this.spawn(new PrimedTnt(x + 0.5, y, z + 0.5, 80));
        this.sound("fuse", x + 0.5, y + 0.5, z + 0.5);
      },
      bodies: () => this.redstoneBodies(),
      takeItemsIn: (x0, y0, z0, x1, y1, z1, take) => {
        for (const e of this.entities.values()) {
          if (!(e instanceof ItemEntity) || e.removed || e.pickupDelay > 0) continue;
          const b = e.body;
          if (b.x < x0 || b.x >= x1 || b.y < y0 || b.y >= y1 || b.z < z0 || b.z >= z1) continue;
          const n = take(e.stack);
          if (n >= e.stack.count) e.removed = true;
          else if (n > 0) e.stack = { ...e.stack, count: e.stack.count - n };
        }
      },
      dispense: (x, y, z, face, stack) => this.dispense(x, y, z, face, stack),
      dropOne: (x, y, z, face, stack) => {
        const [dx, dy, dz] = FACE_DIRS[face];
        this.dropItem(x + 0.5 + dx * 0.7, y + 0.35 + dy * 0.7, z + 0.5 + dz * 0.7, { ...stack, count: 1 },
          dx * 0.25 + (Math.random() - 0.5) * 0.05, 0.1 + dy * 0.25, dz * 0.25 + (Math.random() - 0.5) * 0.05, null, 5);
      },
      sunlight: () => this.sunlight(),
      containerChanged: (x, y, z) => this.containerChanged(x, y, z),
      ensureContainer: (x, y, z) => this.containerAt(x, y, z, "chest"),
    };
  }

  /** Players (here and online) and entities, as things a pressure plate feels and a piston shoves. */
  private redstoneBodies(): RedstoneBody[] {
    const out: RedstoneBody[] = [];
    const p = this.player, pb = p.body;
    if (!p.dead && p.gameMode !== "spectator") {
      out.push({ x: pb.x, y: pb.y, z: pb.z, width: pb.width, height: pb.height, mob: true, move: (dx, dy, dz) => { pb.x += dx; pb.y += dy; pb.z += dz; } });
    }
    for (const r of this.remote.values()) {
      if (r.dead || r.gameMode === "spectator") continue;
      out.push({ x: r.x, y: r.y, z: r.z, width: 0.6, height: 1.8, mob: true, move: (dx, dy, dz) => this.net?.pushRemote?.(r.id, dx, dy, dz) });
    }
    for (const e of this.entities.values()) {
      if (e.removed) continue;
      const b = e.body;
      out.push({ x: b.x, y: b.y, z: b.z, width: b.width, height: b.height, mob: e instanceof Mob, cart: e instanceof Minecart, move: (dx, dy, dz) => { b.x += dx; b.y += dy; b.z += dz; } });
    }
    return out;
  }

  /**
   * What a dispenser does with an item: arrows and snowballs fly, buckets fill
   * and empty, TNT is lit, bone meal grows what is in front. Returns what is
   * left in the slot, or undefined to have the item simply dropped.
   */
  private dispense(x: number, y: number, z: number, face: number, stack: ItemStack): Slot | undefined {
    const name = itemDef(stack.id)?.name;
    const [dx, dy, dz] = FACE_DIRS[face];
    const fx = x + dx, fy = y + dy, fz = z + dz;
    const less: Slot = stack.count > 1 ? { ...stack, count: stack.count - 1 } : null;
    const w = this.world;
    const use = itemDef(stack.id)?.use;
    if (use === "rocket") {
      // A dispenser fires a rocket out of its face, flying on the way it points.
      const rocket = rocketOf(stack);
      const life = rocketLife(rocket.flight, Math.random);
      this.spawn(new FireworkRocket(x + 0.5 + dx * 0.7, y + 0.5 + dy * 0.7, z + 0.5 + dz * 0.7, rocket, dx * 0.5, dy * 0.5 || 0.02, dz * 0.5, life));
      this.sound("firework_launch", x + 0.5, y + 0.5, z + 0.5, 1);
      return less;
    }
    if (name === "arrow" || name === "snowball" || name === "egg" || use === "splash" || use === "xp_bottle") {
      const kind: ProjectileKind = use === "splash" ? "potion" : use === "xp_bottle" ? "xp_bottle" : (name as ProjectileKind);
      const speed = name === "arrow" ? 1.1 : kind === "potion" || kind === "xp_bottle" ? 0.6 : 0.9;
      const spread = () => (Math.random() - 0.5) * 0.08;
      const proj = new Projectile(kind, x + 0.5 + dx * 0.7, y + 0.5 + dy * 0.7, z + 0.5 + dz * 0.7,
        dx * speed + spread(), dy * speed + 0.1 + spread(), dz * speed + spread(), null);
      proj.item = kind === "potion" ? stack.id : 0;
      this.spawn(proj);
      this.sound(name === "arrow" ? "bow" : "throw", x + 0.5, y + 0.5, z + 0.5, 0.6);
      return less;
    }
    if (name === "water_bucket" || name === "lava_bucket") {
      const cur = w.blockAt(fx, fy, fz);
      if (cur !== 0 && !(block(cur).replaceable && !isFluid(cur))) return undefined;
      if (name === "water_bucket" && DIMENSION_INFO[this.dimension].waterEvaporates) {
        this.sound("fizz", fx + 0.5, fy + 0.5, fz + 0.5, 0.6);
        return { id: itemId("bucket"), count: 1 };
      }
      w.setBlock(fx, fy, fz, name === "water_bucket" ? B.WATER : B.LAVA, 0, "world");
      this.sound("bucket_empty", fx + 0.5, fy + 0.5, fz + 0.5);
      return { id: itemId("bucket"), count: 1 };
    }
    if (name === "bucket") {
      const cur = w.blockAt(fx, fy, fz);
      if (!isFluid(cur) || (w.getMeta(fx, fy, fz) & 15) !== 0) return undefined;
      w.setBlock(fx, fy, fz, B.AIR, 0, "world");
      const full: ItemStack = { id: itemId(cur === B.WATER ? "water_bucket" : "lava_bucket"), count: 1 };
      this.sound("bucket_fill", fx + 0.5, fy + 0.5, fz + 0.5);
      if (stack.count === 1) return full;
      this.dropItem(fx + 0.5, fy + 0.3, fz + 0.5, full);
      return less;
    }
    if (name === "bone_meal") {
      if (this.rules.boneMeal(fx, fy, fz)) {
        this.particles("crit", fx + 0.5, fy + 0.8, fz + 0.5, 8);
        return less;
      }
      return stack;
    }
    if (name === "tnt") {
      if (w.blockAt(fx, fy, fz) !== 0 && block(w.blockAt(fx, fy, fz)).solid) return undefined;
      this.spawn(new PrimedTnt(fx + 0.5, fy, fz + 0.5, 80));
      this.sound("fuse", fx + 0.5, fy + 0.5, fz + 0.5);
      return less;
    }
    if (name === "flint_and_steel") {
      if (w.blockAt(fx, fy, fz) === B.AIR) {
        // Sets fire in front, as the original's dispenser does.
        w.setBlock(fx, fy, fz, B.FIRE, 0, "world");
        this.sound("ignite", fx + 0.5, fy + 0.5, fz + 0.5);
      } else if (w.blockAt(fx, fy, fz) !== B.TNT) return stack;
      else {
        w.setBlock(fx, fy, fz, B.AIR, 0, "world");
        this.spawn(new PrimedTnt(fx + 0.5, fy, fz + 0.5, 80));
        this.sound("fuse", fx + 0.5, fy + 0.5, fz + 0.5);
      }
      const used = (stack.damage ?? 0) + 1;
      return used >= (itemDef(stack.id)?.durability ?? 64) ? null : { ...stack, damage: used };
    }
    return undefined;
  }

  /** How bright the sun itself is (0 at night): daylight without the floor that keeps nights visible. */
  sunlight(): number {
    const sky = this.celestial();
    const d = Math.max(0, Math.min(1, this.sunHeight(sky) * 2.2 + 0.2));
    return d * (1 - this.rain * 0.25 - this.thunder * 0.25) * (sky ? eclipseLight(sky.eclipse) : 1);
  }

  private makeContext(): EntityContext {
    // The getters below run with `this` bound to the object literal, so they need the game by name.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const game = this;
    return {
      // A getter: the world is replaced when the player changes dimension.
      get world() { return game.world; },
      get tick() { return game.tickCount; },
      get daylight() { return game.daylight(); },
      get difficulty() { return game.meta.difficulty; },
      random: Math.random,
      players: () => this.playerRefs(),
      hurtPlayer: (id, amount, source, fx, fz, kb, attacker) => {
        if (id === this.player.id) this.hurtLocal(amount, source, fx, fz, kb, attacker);
        else this.net?.hurtRemote(id, amount, source, fx, fz, kb, attacker);
      },
      givePlayer: (id, stack) => {
        // Cash picked up in a city goes to the player's money, not their pockets.
        if (stack.id === CASH_ID && modeDef(this.meta.mode?.id)?.category === "city") {
          if (id === this.player.id) { this.player.cash += stack.count; this.sound("cashout", null, 0, 0, 0.5, 1.2); }
          else this.net?.modeTell(id, { cash: stack.count });
          return 0;
        }
        if (id === this.player.id) {
          const left = this.player.inventory.add(stack);
          if (left < stack.count) this.bumpInv();
          return left;
        }
        this.net?.giveRemote(id, stack);
        return 0;
      },
      giveXp: (id, amount) => {
        if (id === this.player.id) this.collectXp(amount);
        else this.net?.xpRemote(id, amount);
      },
      splashPotion: (item, x, y, z, direct, owner) => this.splashPotion(item, x, y, z, direct, owner),
      effectPlayer: (id, effect, seconds, amp) => {
        if (id === this.player.id) this.player.applyEffect(effect, seconds, amp);
        else this.net?.effectRemote?.(id, effect, seconds, amp);
      },
      spawn: (e) => this.spawn(e),
      dropItem: (x, y, z, stack, vx, vy, vz) => this.dropItem(x, y, z, stack, vx, vy, vz),
      explode: (x, y, z, power, cause, fire, blocks) => this.explode(x, y, z, power, cause, fire, blocks),
      sound: (name, x, y, z, v, p) => this.sound(name, x, y, z, v, p),
      particles: (kind, x, y, z, count, data) => this.particles(kind, x, y, z, count, data),
      entitiesNear: (x, y, z, r) => {
        const out: Entity[] = [];
        for (const e of this.entities.values()) {
          if (Math.abs(e.x - x) <= r && Math.abs(e.y - y) <= r && Math.abs(e.z - z) <= r) out.push(e);
        }
        return out;
      },
      placeBlock: (x, y, z, id, meta) => this.world.setBlock(x, y, z, id, meta, "world"),
      creditKill: (id, hostile, kind) => {
        if (id === this.player.id) this.advance({ kind: "kill", hostile });
        else this.net?.advanceRemote?.(id, { kind: "kill", hostile });
        if (kind) this.mode?.onKill(id, kind);
      },
      creditHit: (id, victim) => { if (this.meta.mode?.started) this.mode?.onHit(id, victim); },
      transformLoot: (s) => this.mode?.transformDrop(s) ?? s,
      pearlLanded: (id, x, y, z, gateway) => this.pearlLanded(id, x, y, z, gateway),
      crystalDestroyed: (crystal, attacker) => { if (crystal instanceof EndCrystal) this.endFight.crystalDestroyed(crystal, attacker); },
      dragonDefeated: () => this.endFight.defeated(),
      get mobGriefing() { return game.meta.rules.mobGriefing; },
      get raining() { return DIMENSION_INFO[game.dimension].hasSky && game.rain > 0.5; },
      get primal() { return modeDef(game.meta.mode?.id)?.primal; },
      get bloodMoon() { return game.bloodMoon; },
    };
  }

  playerRefs(): PlayerRef[] {
    const p = this.player;
    const refs: PlayerRef[] = [];
    if (!p.dead) {
      refs.push({
        id: p.id, name: p.name, x: p.body.x, y: p.body.y, z: p.body.z, width: p.body.width, height: p.body.height,
        targetable: p.survivalLike, heldItem: p.inventory.held?.id ?? -1, sneaking: p.sneaking, invisible: p.hasEffect("invisibility"),
        goldArmor: p.inventory.armor.some((a) => !!a && itemDef(a.id)?.armor?.material === "golden"),
        yaw: p.yaw, pitch: p.pitch, pumpkin: p.inventory.armor[0]?.id === B.CARVED_PUMPKIN, riding: p.riding !== null,
      });
    }
    for (const r of this.remote.values()) {
      if (r.dead) continue;
      refs.push({
        id: r.id, name: r.name, x: r.x, y: r.y, z: r.z, width: 0.6, height: r.sneaking ? 1.5 : 1.8,
        targetable: r.gameMode === "survival" || r.gameMode === "adventure", heldItem: r.held ?? -1, sneaking: r.sneaking, invisible: r.invisible,
        goldArmor: r.goldArmor, yaw: r.yaw, pitch: r.pitch, pumpkin: r.pumpkin, riding: r.riding,
      });
    }
    return refs;
  }

  // ---- effects ---------------------------------------------------------------------------

  sound(name: string, x: number | null, y = 0, z = 0, volume = 1, pitch = 1): void {
    // Space is silent: the world's sounds go on, but not for someone in orbit.
    if (!this.space || x === null) this.audio.play(name, x, y, z, volume, pitch);
    // A local world opened to others mid-game is hosting too: the link, not the role it started with, decides.
    if (x !== null) this.net?.effect("sound", [name, round2(x), round2(y), round2(z), volume, pitch]);
  }

  blockSound(material: Material, kind: "dig" | "break" | "place" | "step", x: number, y: number, z: number, broadcast = true): void {
    this.audio.block(material, kind, x, y, z);
    if (broadcast && kind !== "step" && kind !== "dig" && this.net) this.net.effect("sound", [`block:${material}:${kind}`, round2(x), round2(y), round2(z), 1, 1]);
  }

  particles(kind: string, x: number, y: number, z: number, count = 1, data = 0, broadcast = true): void {
    this.renderer.particles.emit(kind, x, y, z, count, data);
    if (broadcast) this.net?.effect("particles", [kind, round2(x), round2(y), round2(z), count, data]);
  }

  /** `fire` leaves flames among the rubble (a bed in the Nether, a ghast's fireball). */
  explode(x: number, y: number, z: number, power: number, cause: Entity | null, fire = false, blocks = true): void {
    if (!this.simulates) return;
    this.makeNoise(x, y, z, 24 + power * 8, null);
    this.sound("explode", x, y, z, 1, 0.9 + Math.random() * 0.2);
    this.particles("explosion", x, y, z, 24, 0, false);
    this.net?.effect("explosion", [round2(x), round2(y), round2(z), power]);
    const griefing = blocks && (this.meta.rules.mobGriefing || !(cause instanceof Mob));
    if (griefing) {
      for (const [bx, by, bz] of explosionBlocks(this.world, x, y, z, power, Math.random)) {
        const id = this.world.blockAt(bx, by, bz);
        if (!id || id === B.BEDROCK) continue;
        if (id === B.TNT) {
          this.world.setBlock(bx, by, bz, B.AIR, 0, "world");
          this.spawn(new PrimedTnt(bx + 0.5, by, bz + 0.5, 10 + Math.floor(Math.random() * 20)));
          continue;
        }
        const def = block(id);
        if (Math.random() < 1 / power) {
          for (const s of resolveDrops(def.drops, id, Math.random)) this.dropItem(bx + 0.5, by + 0.5, bz + 0.5, s);
        }
        this.dropContainerContents(bx, by, bz);
        this.world.setBlock(bx, by, bz, B.AIR, 0, "world");
        if (isLog(id)) this.rules.logRemoved(bx, by, bz);
      }
    }
    if (fire) {
      const r = Math.ceil(power);
      for (let n = 0; n < power * 6; n++) {
        const fx = Math.floor(x + (Math.random() - 0.5) * 2 * r), fy = Math.floor(y + (Math.random() - 0.5) * 2 * r), fz = Math.floor(z + (Math.random() - 0.5) * 2 * r);
        if (this.world.blockAt(fx, fy, fz) === B.AIR && block(this.world.blockAt(fx, fy - 1, fz)).solid && Math.random() < 0.34) {
          this.world.setBlock(fx, fy, fz, B.FIRE, 1, "world");
        }
      }
    }
    // Entities and players in range.
    for (const e of this.entities.values()) {
      if (e === cause || e.removed) continue;
      const box = e.box();
      const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2, cz = (box.minZ + box.maxZ) / 2;
      const d = Math.hypot(cx - x, cy - y, cz - z);
      const hit = blastImpact(power, d, exposure(this.world, x, y, z, box));
      if (hit.damage <= 0) continue;
      // A crystal's blast never touches the dragon it serves; another crystal it sets off.
      if (e instanceof Mob && e.kind === "ender_dragon" && cause instanceof EndCrystal) continue;
      if (e instanceof Mob || e instanceof Vehicle || e instanceof EndCrystal) e.hurt(this.ctx, hit.damage, "explosion", x, z);
      // A blast takes a frame down whole, item and all.
      if (e instanceof ItemFrame && !e.removed) { e.hurt(this.ctx); if (!e.removed) e.hurt(this.ctx); }
      else if (e instanceof ItemEntity || e instanceof XpOrb) { if (hit.damage > 4) e.removed = true; }
      const n = d || 1;
      e.body.vx += ((cx - x) / n) * hit.push; e.body.vy += ((cy - y) / n) * hit.push; e.body.vz += ((cz - z) / n) * hit.push;
    }
    for (const p of this.playerRefs()) {
      const box = { minX: p.x - 0.3, minY: p.y, minZ: p.z - 0.3, maxX: p.x + 0.3, maxY: p.y + p.height, maxZ: p.z + 0.3 };
      const d = Math.hypot(p.x - x, p.y + p.height / 2 - y, p.z - z);
      const hit = blastImpact(power, d, exposure(this.world, x, y, z, box));
      if (hit.damage > 0) this.ctx.hurtPlayer(p.id, hit.damage, "explosion", x, z, hit.push);
    }
  }

  // ---- blocks ------------------------------------------------------------------------------

  private onBlockChange(c: BlockChange): void {
    const chunk = this.world.chunkAt(c.x, c.z);
    if (chunk) { this.dirtySave.add(chunk.id); this.mapDirty.add(chunk.id); }
    if (this.simulates && this.meta.mode?.started) this.mode?.onBlockChange(c);
    if (this.simulates && c.prevId === B.LUCKY_BLOCK && c.id !== B.LUCKY_BLOCK && c.cause !== "world") this.luckyOutcome(c.x, c.y, c.z);
    if (this.simulates && c.prevId === B.WAYSTONE && c.id !== B.WAYSTONE) this.waystoneBroken(c.x, c.y, c.z);
    if (c.cause !== "remote") this.net?.blockChanged(c);
    if (this.simulates && isLog(c.prevId) && c.id !== c.prevId) this.rules.logRemoved(c.x, c.y, c.z);
    // A pumpkin set on a T of iron blocks may wake a golem; checked after the change settles.
    if (this.simulates && (c.id === B.CARVED_PUMPKIN || c.id === B.JACK_O_LANTERN)) this.golemChecks.push([c.x, c.y, c.z]);
    // An eye set in a frame, here or by a guest: the twelfth lights the portal.
    if (this.simulates && c.id === B.END_PORTAL_FRAME && (c.meta & FRAME_EYE) !== 0 && (c.prevMeta & FRAME_EYE) === 0) this.endPortalChecks.push([c.x, c.y, c.z]);
  }

  private golemChecks: [number, number, number][] = [];
  private endPortalChecks: [number, number, number][] = [];

  /** Iron blocks in a T with a pumpkin for a head come alive as an iron golem, as in the original. */
  private buildGolems(): void {
    const w = this.world;
    for (const [x, y, z] of this.golemChecks.splice(0)) {
      const parts = golemParts((a, b, c) => w.blockAt(a, b, c), x, y, z);
      if (!parts) continue;
      for (const [px, py, pz] of parts) {
        w.setBlock(px, py, pz, B.AIR, 0, "world");
        this.particles("block", px + 0.5, py + 0.5, pz + 0.5, 8, B.IRON_BLOCK);
      }
      const golem = new Mob("iron_golem", x + 0.5, y - 2, z + 0.5);
      golem.home = { x: x + 0.5, z: z + 0.5 };
      this.spawn(golem);
      this.sound("anvil_use", x + 0.5, y - 1, z + 0.5, 0.8, 0.6);
    }
  }

  /** A freshly generated chunk's structures come alive: villages here, fortresses in the Nether. */
  private settleStructures(cx: number, cz: number): void {
    if (this.dimension === "overworld") {
      this.settleVillages(cx, cz);
      if (this.generator instanceof MapGenerator) {
        this.fillChests(cx, cz, this.generator.chestsIn(cx, cz).map(([x, y, z, table]) => [x, y, z, (items) => mapLoot(items, hash4(this.meta.seed ^ 0x3a, x, y, z), table)]));
      }
      const terrain = this.terrainGenerator();
      if (terrain) {
        for (const s of terrain.strongholdsAt(cx, cz)) this.fillChests(cx, cz, s.chests.map(([x, y, z, room]) => [x, y, z, (items) => strongholdLoot(items, hash4(this.meta.seed ^ 0x57, x, y, z), room)]));
        for (const d of terrain.dungeonsAt(cx, cz)) this.fillChests(cx, cz, d.chests.map(([x, y, z]) => [x, y, z, (items) => dungeonLoot(items, hash4(this.meta.seed ^ 0xd9, x, y, z), d.kind)]));
      }
    }
    else if (this.dimension === "nether") {
      const w = this.world;
      for (const f of fortressesTouching(this.meta.seed, cx, cz)) {
        this.fillChests(cx, cz, f.chests.map(([x, y, z]) => [x, y, z, (items) => fortressLoot(items, hash4(this.meta.seed ^ 0x4e, x, y, z))]));
      }
    }
    if (this.dimension === "end" && this.generator instanceof EndGenerator) {
      for (const c of endCitiesTouching(this.generator, cx, cz)) {
        this.fillChests(cx, cz, c.chests.map(([x, y, z, kind]) => [x, y, z, (items) => cityLoot(items, hash4(this.meta.seed ^ 0xe7, x, y, z), kind === "ship")]));
        this.settleCity(c, cx, cz);
      }
    }
    this.findSpawners(cx, cz);
  }

  /**
   * The part of an End city in a freshly generated chunk: its brewing stands
   * get two potions of Healing II, and — once only, whatever happens to the
   * chunk later — its shulkers take their places and the ship's frame is hung
   * with the elytra.
   */
  private settleCity(c: EndCity, cx: number, cz: number): void {
    const w = this.world;
    const here = (x: number, z: number) => x >> 4 === cx && z >> 4 === cz;
    const spawned = (this.meta.spawned ??= []);
    const once = (key: string) => {
      if (spawned.includes(key)) return false;
      spawned.push(key);
      if (spawned.length > 4000) spawned.splice(0, spawned.length - 4000);
      return true;
    };
    for (const [x, y, z] of c.brewing) {
      if (!here(x, z) || w.blockAt(x, y, z) !== B.BREWING_STAND || w.getEntity(x, y, z)) continue;
      const stand = newBrewing();
      stand.bottles = [{ id: itemId("strong_potion_healing"), count: 1 }, null, { id: itemId("strong_potion_healing"), count: 1 }];
      w.setEntity(x, y, z, stand);
    }
    for (const [x, y, z, face] of c.shulkers) {
      if (!here(x, z) || !once(`shulker:${x},${y},${z}`)) continue;
      const s = new Mob("shulker", x + 0.5, y, z + 0.5);
      s.attach = face;
      this.spawn(s);
    }
    const f = c.frame;
    if (f && here(f.x, f.z) && once(`frame:${f.x},${f.y},${f.z}`)) {
      this.spawn(new ItemFrame(f.face, f.x, f.y, f.z, { id: itemId("elytra"), count: 1 }));
    }
  }

  /** Puts loot in a structure's chests that stand in chunk (cx, cz) and are still empty chests there. */
  private fillChests(cx: number, cz: number, chests: [number, number, number, (items: (ItemStack | null)[]) => void][]): void {
    const w = this.world;
    for (const [x, y, z, fill] of chests) {
      if (x >> 4 !== cx || z >> 4 !== cz || w.blockAt(x, y, z) !== B.CHEST || w.getEntity(x, y, z)) continue;
      const chest = newChest(27);
      fill(chest.items);
      w.setEntity(x, y, z, chest);
    }
  }

  /**
   * A freshly generated chunk's share of any village: loot in its house chests,
   * and — once per village, when its well's chunk first appears — its
   * villagers at their stations and an iron golem by the well.
   */
  private settleVillages(cx: number, cz: number): void {
    const w = this.world;
    const terrain = this.terrainGenerator();
    if (!terrain) return;
    const done = (this.meta.villages ??= []);
    for (const v of terrain.villagesAt(cx, cz)) {
      for (const h of v.houses) {
        if (!h.chest) continue;
        const [x, y, z] = h.chest;
        if (x >> 4 !== cx || z >> 4 !== cz || w.blockAt(x, y, z) !== B.CHEST || w.getEntity(x, y, z)) continue;
        const chest = newChest(27);
        villageLoot(chest.items, hash4(this.meta.seed, x, y, z));
        w.setEntity(x, y, z, chest);
      }
      if (v.x >> 4 !== cx || v.z >> 4 !== cz || done.includes(v.key)) continue;
      done.push(v.key);
      for (const h of v.houses) {
        const [jx, jy, jz] = h.job;
        // One step from the station toward the door: the station stands against the back wall.
        const m = new Mob("villager", jx + 0.5 + (h.front === 3 ? 1 : h.front === 2 ? -1 : 0), jy, jz + 0.5 + (h.front === 1 ? 1 : h.front === 0 ? -1 : 0));
        m.setProfession(h.profession);
        m.job = h.job;
        m.home = { x: v.x, z: v.z };
        this.spawn(m);
      }
      const golem = new Mob("iron_golem", v.x + 3.5, v.y + 1, v.z + 3.5);
      golem.home = { x: v.x, z: v.z };
      this.spawn(golem);
    }
  }

  /**
   * Spills a container's contents when it is broken — except a shulker box,
   * which keeps them: it drops as one box item carrying its inventory and
   * colour. `always` drops even an empty box (a survival player's mining;
   * in creative only a box with something in it comes away).
   */
  dropContainerContents(x: number, y: number, z: number, always = true): void {
    if (this.world.blockAt(x, y, z) === B.SHULKER_BOX) {
      const e = this.world.getEntity(x, y, z);
      const items = e?.kind === "chest" ? e.items.map((s) => (s ? { ...s } : null)) : [];
      const stack: ItemStack = { id: B.SHULKER_BOX, count: 1 };
      const color = boxColorOf(this.world.getMeta(x, y, z));
      if (color) stack.color = color;
      if (items.some(Boolean)) stack.contents = items;
      if (always || stack.contents) this.dropItem(x + 0.5, y + 0.5, z + 0.5, stack);
      this.world.setEntity(x, y, z, undefined);
      return;
    }
    const e = this.world.getEntity(x, y, z);
    if (!e) return;
    const stacks = entityStacks(e);
    for (const s of stacks) if (s) this.dropItem(x + 0.5, y + 0.5, z + 0.5, s);
    if (e.kind === "furnace" && e.xp > 0) this.spawnXp(x + 0.5, y + 0.5, z + 0.5, Math.floor(e.xp));
    this.world.setEntity(x, y, z, undefined);
  }

  containerAt(x: number, y: number, z: number, kind: "chest" | "furnace" | "brewing"): BlockEntity {
    let e = this.world.getEntity(x, y, z);
    if (!e || e.kind !== kind) {
      e = kind === "chest" ? newChest(containerSize(this.world.blockAt(x, y, z)) || 27) : kind === "brewing" ? newBrewing() : newFurnace();
      this.world.setEntity(x, y, z, e);
    }
    return e;
  }

  /** The county this world is built on (engine/county.ts), if it is one. */
  county(): County | null {
    return this.dimension === "overworld" && this.generator instanceof MapGenerator ? this.generator.layout.county ?? null : null;
  }

  /** Where a point is in the county, in words; empty anywhere else. */
  countyPlace(x: number, z: number): string {
    return this.county()?.placeName(Math.floor(x), Math.floor(z)) ?? "";
  }

  /**
   * A county cupboard, fridge or shelf nobody has opened yet is filled as it is
   * first opened (engine/countyLoot.ts says why not before), from what it is
   * and the building it stands in, seeded by its place so everyone who opens
   * it finds the same things. Once it has been opened it keeps what is in it.
   */
  lootIfFresh(x: number, y: number, z: number): void {
    const county = this.county();
    if (!county || this.world.getEntity(x, y, z)) return;
    const loot = block(this.world.blockAt(x, y, z)).loot;
    if (!loot) return;
    const table = COUNTY_LOOT[countyLootTable(loot, county.buildingAt(x, z))];
    const e = this.containerAt(x, y, z, "chest");
    if (e.kind !== "chest" || !table) return;
    fillLoot(e.items, new Rng(hash4(this.meta.seed ^ 0xc0117, x, y, z)), table, false);
    // What has been sitting in a cupboard, or a fridge since the power went, has gone off.
    const fridge = loot === "fridge" || loot === "freezer" || loot === "cooler";
    const day = countyDay(this.time), off = utilities(this.meta.seed).powerOffDay;
    for (let i = 0; i < e.items.length; i++) {
      const s = e.items[i];
      const name = s ? itemDef(s.id)?.name : undefined;
      if (s && name && spoiled(name, day, fridge, off)) e.items[i] = { id: itemId("spoiled_food"), count: s.count };
    }
    this.containerChanged(x, y, z);
  }

  // ---- the county's utilities (engine/countyLife.ts) ----------------------------------------------

  /** The county's grid is still up: lights, stoves, pumps and televisions work anywhere. Outside the county the grid never fails. */
  powered(): boolean {
    return !this.county() || hasPower(this.meta.seed, this.time);
  }

  /** The county's taps still run (and anywhere else's always do). */
  watered(): boolean {
    return !this.county() || hasWater(this.meta.seed, this.time);
  }

  /** Power here: the grid, or a running generator within reach of its cable. */
  poweredAt(x: number, y: number, z: number): boolean {
    if (this.powered()) return true;
    return this.generators().some((gen) => gen.fuel > 0 && Math.hypot(gen.x - x, gen.y - y, gen.z - z) <= GENERATOR_REACH);
  }

  /** The generators someone has fuelled and started, kept with the mode's own state so they survive a save. */
  private generators(): { x: number; y: number; z: number; fuel: number }[] {
    const data = this.meta.mode?.data;
    if (!data) return [];
    return ((data.generators as { x: number; y: number; z: number; fuel: number }[] | undefined) ??= []);
  }

  /**
   * Fuelling, starting and stopping a generator. As in the reference game,
   * it takes knowing how: someone who has not read the Generator Guide cannot
   * connect one without risking the house. It is loud, and the dead come.
   */
  workGenerator(x: number, y: number, z: number, h: { swing(): void; replaceHeld(stack: ItemStack): void }): boolean {
    if (!this.simulates) { this.showActionbar("Only the world's host can run a generator."); return true; }
    if (!this.hasRead("generator_guide")) { this.showActionbar("You don't know how to hook it up safely. A Generator Guide would show you."); return true; }
    const gens = this.generators();
    let gen = gens.find((g) => g.x === x && g.y === y && g.z === z);
    const held = itemDef(this.player.inventory.held?.id ?? 0)?.name;
    if (held === "full_gas_can") {
      if (!gen) gens.push((gen = { x, y, z, fuel: 0 }));
      gen.fuel = Math.min(GENERATOR_TANK, gen.fuel + GENERATOR_CAN);
      h.replaceHeld({ id: itemId("gas_can"), count: 1 });
      this.message(`The generator coughs into life. Fuel for about ${Math.round(gen.fuel / 60)} minutes.`, "#aaffaa");
      this.relight(x, y, z, true);
    } else if (gen && gen.fuel > 0) {
      gens.splice(gens.indexOf(gen), 1);
      this.message("You shut the generator off.", "#cccccc");
      this.relight(x, y, z, false);
    } else {
      this.showActionbar("It needs fuel: a full gas can.");
      return true;
    }
    this.sound("fuse", x + 0.5, y + 0.5, z + 0.5, 0.8, 0.5);
    h.swing();
    return true;
  }

  /** Every light in a generator's reach on (it is running) or off (it is not, and nor is the grid). */
  private relight(x: number, y: number, z: number, on: boolean): void {
    if (!on && this.poweredAt(x, y, z)) return;
    const table = on ? LIGHT_ON : LIGHT_OFF;
    const r = GENERATOR_REACH;
    for (let dy = -4; dy <= 6; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const id = this.world.blockAt(x + dx, y + dy, z + dz);
      const to = table[id];
      if (to !== undefined) this.world.setBlock(x + dx, y + dy, z + dz, to, this.world.getMeta(x + dx, y + dy, z + dz), "world");
    }
  }

  /** Every mains light in a chunk goes dark: done as a chunk arrives after the power has failed. */
  private darkenChunk(chunk: Chunk): void {
    const bx = chunk.cx << 4, bz = chunk.cz << 4;
    for (let i = 0; i < chunk.blocks.length; i++) {
      const off = LIGHT_OFF[chunk.blocks[i]];
      if (off === undefined) continue;
      this.world.setBlock(bx + (i & 15), i >> 8, bz + ((i >> 4) & 15), off, chunk.meta[i], "world");
    }
  }

  /** Whether the power was up at the last county second, to catch the moment it fails. */
  private gridWas: boolean | null = null;

  /** Once a second in the county: the grid failing, generators burning fuel and making noise. */
  private tickCounty(): void {
    if (!this.county()) return;
    const up = this.powered();
    if (this.gridWas === true && !up) {
      this.message("The lights flicker and go out. The fridge falls silent. The power is gone.", "#ffcc55");
      for (const c of [...this.world.loadedChunks()]) this.darkenChunk(c);
      for (const gen of this.generators()) if (gen.fuel > 0) this.relight(gen.x, gen.y, gen.z, true);
    }
    if (this.gridWas === true && hasWater(this.meta.seed, this.time - 20) && !this.watered()) {
      this.message("Somewhere in the house a pipe knocks, and the taps run dry. The water is off.", "#ffcc55");
    }
    this.gridWas = up;
    if (!this.simulates) return;
    const gens = this.generators();
    for (let i = gens.length - 1; i >= 0; i--) {
      const gen = gens[i];
      if (this.world.blockAt(gen.x, gen.y, gen.z) !== C.GENERATOR) { gens.splice(i, 1); this.relight(gen.x, gen.y, gen.z, false); continue; }
      if (!this.world.chunkAt(gen.x, gen.z)) continue;
      gen.fuel--;
      // Its racket carries: every few seconds, everything dead in forty blocks turns toward it.
      if (gen.fuel % 5 === 0) this.makeNoise(gen.x + 0.5, gen.y + 0.5, gen.z + 0.5, 40, null);
      if (gen.fuel <= 0) {
        gens.splice(i, 1);
        this.message("The generator sputters and dies. It's out of fuel.", "#ffcc55");
        this.relight(gen.x, gen.y, gen.z, false);
      }
    }
  }

  /**
   * Becoming someone: the occupation and traits chosen on the survivor
   * screen. Returns why not, or null — and on success the job's kit goes into
   * the pockets and what it taught is known from the first moment.
   */
  chooseSurvivor(s: Survivor): string | null {
    const why = invalid(s);
    if (why) return why;
    const p = this.player;
    p.setSurvivor({ occupation: s.occupation, traits: [...s.traits] });
    for (const [name, count] of p.perks.kit) {
      const id = itemByName(name)?.id;
      if (id === undefined) continue;
      const left = p.inventory.add({ id, count });
      if (left > 0) this.dropItem(p.body.x, p.body.y + 1, p.body.z, { id, count: left });
    }
    this.bumpInv();
    this.setScreen(null);
    const job = occupation(s.occupation)!;
    // What the picker hid: the day, and how the county works, said again now that someone is here to hear it.
    const day = Math.floor(countyDay(this.time)) + 1;
    this.showTitle("Ashgrove County", day === 1 ? "Day one. The county has been sealed." : `Day ${day}. Somebody new wakes up.`);
    this.message(job.id === "unemployed" ? "You wake with nothing but yourself. That will have to do." : `You were a ${job.name.toLowerCase()}. Whatever you are now, that still counts for something.`, "#aaffaa");
    this.message("Search the houses: kitchens, bathrooms and garages hold what you need. Close doors behind you. The infected hear everything.", "#aaffaa");
    return null;
  }

  /** What this player has read, of the books and magazines that teach something (engine/countyItems.ts). */
  private readLocal = new Set<string>();
  private readList(): Set<string> {
    const data = this.meta.mode?.data;
    if (!data || !this.simulates) return this.readLocal;
    const all = ((data.read as Record<string, string[]> | undefined) ??= {});
    return new Set(all[this.player.name] ?? []);
  }

  /**
   * Whether this player has learnt a thing: a skill (any volume of its book
   * counts), or a magazine's one lesson by its item name.
   */
  hasRead(what: string): boolean {
    // What the player knew before, from their job or their traits (engine/survivors.ts), counts as read.
    if (this.player.perks.knows.includes(what)) return true;
    const read = this.readList();
    return read.has(what) || [...read].some((r) => r.startsWith(`${what}_book_`));
  }

  /** Reading something: a skill book or a magazine teaches, and is kept; the paper and the comics pass the time and are used up. */
  read(item: string): boolean {
    const skill = BOOK_SKILLS.find(([k]) => item.startsWith(`${k}_book_`));
    const teaches = !!skill || READ_TEACHES[item] !== undefined;
    if (!teaches) {
      this.message(READ_IDLE[item] ?? "You read it cover to cover. It takes your mind off things, for a while.", "#cccccc");
      this.player.applyEffect("regeneration", 6, 0);
      return true;
    }
    if (this.hasRead(item) || (skill && this.hasRead(skill[0]))) { this.showActionbar("You have read this already."); return false; }
    const data = this.meta.mode?.data;
    if (data && this.simulates) {
      const all = ((data.read as Record<string, string[]> | undefined) ??= {});
      (all[this.player.name] ??= []).push(item);
    } else this.readLocal.add(item);
    this.message(skill ? `You study ${itemDef(itemId(item))?.displayName ?? "the book"}. ${SKILL_LESSON[skill[0]] ?? ""}` : READ_TEACHES[item], "#aaffaa");
    this.sound("click", null, 0, 0, 0.4, 1.6);
    return false;
  }

  /** A mode's chest at x, y, z — placed if missing, emptied if not — filled by `fill`, and sent to everyone. */
  placeChest(x: number, y: number, z: number, fill: (items: (ItemStack | null)[]) => void): void {
    if (this.world.blockAt(x, y, z) !== B.CHEST) this.world.setBlock(x, y, z, B.CHEST, 0, "world");
    const e = this.containerAt(x, y, z, "chest");
    if (e.kind !== "chest") return;
    e.items.fill(null);
    fill(e.items);
    this.containerChanged(x, y, z);
  }

  /** A container changed from this client: save it and tell the others. */
  containerChanged(x: number, y: number, z: number): void {
    const c = this.world.chunkAt(x, z);
    if (c) { c.modified = true; this.dirtySave.add(c.id); }
    this.net?.blockEntity(x, y, z, this.world.getEntity(x, y, z) ?? null);
    // Comparators reading this container look again.
    if (this.simulates) this.redstone.containerChanged(x, y, z);
    const s = this.screen;
    if (s && (s.kind === "chest" || s.kind === "furnace" || s.kind === "brewing") && s.x === x && s.y === y && s.z === z) this.bumpInv();
  }

  private tickFurnaces(): void {
    for (const c of this.world.loadedChunks()) {
      for (const [index, e] of c.entities) {
        const x = c.cx * 16 + (index & 15), z = c.cz * 16 + ((index >> 4) & 15), y = index >> 8;
        if (e.kind === "brewing") { this.tickBrewingStand(c, e, x, y, z); continue; }
        if (e.kind !== "furnace") continue;
        if (this.tickFurnace(e, x, y, z)) {
          c.modified = true;
          this.dirtySave.add(c.id);
          if (this.tickCount % 10 === 0) {
            this.net?.blockEntity(x, y, z, e);
            this.redstone.containerChanged(x, y, z);
          }
          if (this.screen?.kind === "furnace" && this.screen.x === x && this.screen.y === y && this.screen.z === z) this.bumpInv();
        }
      }
    }
  }

  private tickBrewingStand(c: Chunk, e: BrewingEntity, x: number, y: number, z: number): void {
    if (this.world.blockAt(x, y, z) !== B.BREWING_STAND) return;
    const r = tickBrewing(e);
    // The stand shows a bottle for each filled slot; keep its look in step with what it holds.
    const bits = bottleBits(e);
    if ((this.world.getMeta(x, y, z) & 7) !== bits) {
      this.world.setBlock(x, y, z, B.BREWING_STAND, bits, "world");
      this.world.setEntity(x, y, z, e);
    }
    if (!r.changed) return;
    c.modified = true;
    this.dirtySave.add(c.id);
    if (r.finished) {
      this.sound("brew", x + 0.5, y + 0.5, z + 0.5, 0.8);
      this.net?.blockEntity(x, y, z, e);
      this.redstone.containerChanged(x, y, z);
      // Whoever has the stand open saw it done.
      if (this.screen?.kind === "brewing" && this.screen.x === x && this.screen.y === y && this.screen.z === z) this.advance({ kind: "brew" });
    } else if (this.tickCount % 10 === 0) this.net?.blockEntity(x, y, z, e);
    if (this.screen?.kind === "brewing" && this.screen.x === x && this.screen.y === y && this.screen.z === z) this.bumpInv();
  }

  /** One tick of a furnace, the original's rules: fuel burns only while there is something to smelt. Returns whether anything changed. */
  tickFurnace(f: FurnaceEntity, x: number, y: number, z: number): boolean {
    const wasLit = f.burn > 0;
    let changed = false;
    if (f.burn > 0) { f.burn--; changed = true; }
    const recipe = f.input ? smeltResult(f.input.id) : null;
    const outId = recipe ? itemId(recipe.output) : -1;
    const room = recipe && (!f.output || (f.output.id === outId && f.output.count < maxStack(outId)));
    if (recipe && room) {
      if (f.burn === 0 && f.fuel && fuelTicks(f.fuel.id) > 0) {
        f.burn = f.burnTotal = fuelTicks(f.fuel.id);
        const fuelDef = itemDef(f.fuel.id);
        f.fuel.count--;
        if (f.fuel.count <= 0) f.fuel = fuelDef?.name === "lava_bucket" ? { id: itemId("bucket"), count: 1 } : null;
        changed = true;
      }
      if (f.burn > 0) {
        f.cook++;
        changed = true;
        if (f.cook >= COOK_TICKS) {
          f.cook = 0;
          f.output = f.output ? { ...f.output, count: f.output.count + 1 } : { id: outId, count: 1 };
          f.xp += recipe.xp;
          f.input!.count--;
          if (f.input!.count <= 0) f.input = null;
        }
      } else if (f.cook > 0) { f.cook = Math.max(0, f.cook - 2); changed = true; }
    } else if (f.cook > 0) { f.cook = 0; changed = true; }
    const lit = f.burn > 0;
    if (lit !== wasLit) {
      const id = this.world.blockAt(x, y, z);
      if (id === B.FURNACE || id === B.LIT_FURNACE) {
        const meta = this.world.getMeta(x, y, z);
        const e = this.world.getEntity(x, y, z);
        this.world.setBlock(x, y, z, lit ? B.LIT_FURNACE : B.FURNACE, meta, "world");
        // setBlock clears the entity when the id changes; put the same one back.
        if (e) this.world.setEntity(x, y, z, e);
      }
    }
    return changed;
  }

  // ---- players ------------------------------------------------------------------------------

  hurtLocal(amount: number, source: DamageSource, fx?: number, fz?: number, kb = 0, attacker?: number): void {
    if (!this.meta.rules.doFallDamage && source === "fall") return;
    // In space the body left behind is out of reach: nothing on the ground can hurt someone in orbit.
    if (this.space || this.launchCountdown !== null) return;
    const dealt = this.player.hurt(amount, source, fx, fz, kb);
    if (dealt > 0) this.wound(amount, source, attacker);
    // A fireball's heat stays: the player burns for a few seconds after the hit.
    if (source === "fireball" && dealt > 0 && !this.player.hasEffect("fire_resistance")) this.player.fireTicks = Math.max(this.player.fireTicks, 100);
    if (dealt > 0 || kb > 0) {
      this.lastHurtAt = performance.now();
      this.hurtTilt = 1;
    }
    if (dealt > 0 && attacker !== undefined) this.thorns(attacker);
  }

  /** Thorns: each piece has a chance to hurt the mob that struck, at the cost of extra wear. */
  private thorns(attacker: number): void {
    const inv = this.player.inventory;
    let damage = 0;
    inv.armor = inv.armor.map((a) => {
      const lvl = levelOf(a, "thorns");
      if (!a || !lvl || Math.random() >= 0.15 * lvl) return a;
      damage += 1 + Math.floor(Math.random() * 4);
      const max = itemDef(a.id)?.durability ?? 0;
      const worn = (a.damage ?? 0) + 2;
      return max && worn >= max ? null : { ...a, damage: worn };
    });
    if (!damage) return;
    const b = this.player.body;
    const mob = this.entities.get(attacker);
    // The host owns every mob; a guest asks it to deal the damage.
    if (this.role === "guest") this.net?.attack(attacker, damage, b.x, b.z);
    else if (mob instanceof Mob) mob.hurt(this.ctx, damage, "player", b.x, b.z, this.player.id);
    this.bumpInv();
  }

  /** Experience picked up: Mending spends it on worn gear first, two durability a point, as in the original. */
  collectXp(amount: number): void {
    const inv = this.player.inventory;
    const mendable = () => [inv.selected, -1, -2, -3, -4, -5].filter((i) => {
      const s = i >= 0 ? inv.slots[i] : i === -1 ? inv.offhand : inv.armor[-i - 2];
      return !!s && levelOf(s, "mending") > 0 && (s.damage ?? 0) > 0;
    });
    let left = amount;
    for (let guard = 0; left > 0 && guard < 20; guard++) {
      const slots = mendable();
      if (!slots.length) break;
      const i = slots[Math.floor(Math.random() * slots.length)];
      const s = (i >= 0 ? inv.slots[i] : i === -1 ? inv.offhand : inv.armor[-i - 2])!;
      const repaired = Math.min(s.damage ?? 0, left * 2);
      const mended = { ...s, damage: (s.damage ?? 0) - repaired || undefined };
      if (!mended.damage) delete mended.damage;
      if (i >= 0) inv.slots[i] = mended; else if (i === -1) inv.offhand = mended; else inv.armor[-i - 2] = mended;
      left -= Math.ceil(repaired / 2);
    }
    if (left < amount) this.bumpInv();
    if (left > 0) this.addXp(left);
  }

  /**
   * A splash potion burst: every mob and player within four blocks takes its
   * effects, weaker with distance; whatever it struck takes the full dose.
   */
  splashPotion(item: number, x: number, y: number, z: number, direct: Entity | PlayerRef | null, owner: string | null): void {
    const def = itemDef(item);
    const potion = def ? potionOfItem(def.name) : undefined;
    this.sound("glass_break", x, y, z, 0.8);
    this.particles("potion", x, y, z, 24, potion ? parseInt(potion.potion.color.slice(1), 16) : 0x385dc6);
    if (!potion) return;
    // A lingering potion leaves a cloud of itself where it broke, for half a minute.
    if (potion.form === "lingering") {
      const cloud = new AreaCloud(x, Math.floor(y + 0.2), z, 3, 600, owner);
      cloud.potion = potion.potion.key;
      this.spawn(cloud);
      return;
    }
    const effects = potion.potion.effects;
    const strength = (ex: number, ey: number, ez: number, hit: boolean) => {
      if (hit) return 1;
      const d = Math.hypot(ex - x, ey - y, ez - z);
      return d > 4 ? 0 : 1 - d / 4;
    };
    const attacker = owner && !owner.startsWith("mob:") ? owner : undefined;
    for (const e of this.entities.values()) {
      if (!(e instanceof Mob) || e.dying) continue;
      const f = strength(e.x, e.y + e.body.height / 2, e.z, e === direct);
      if (f <= 0) continue;
      for (const fx of effects) {
        const instant = fx.effect === "instant_health" || fx.effect === "instant_damage";
        // Instant effects scale by distance; lasting ones shorten with it.
        if (instant) { if (f > 0.5 || e === direct) e.applyEffect(this.ctx, fx.effect, 0, fx.amp, attacker); }
        else e.applyEffect(this.ctx, fx.effect, Math.floor(splashSeconds(fx.seconds) * f), fx.amp, attacker);
      }
    }
    for (const p of this.playerRefs()) {
      const hit = direct !== null && !(direct instanceof Mob) && "id" in direct && typeof direct.id === "string" && direct.id === p.id;
      const f = strength(p.x, p.y + 0.9, p.z, hit);
      if (f <= 0) continue;
      for (const fx of effects) {
        const instant = fx.effect === "instant_health" || fx.effect === "instant_damage";
        if (instant && f <= 0.5 && !hit) continue;
        const seconds = instant ? 0 : Math.floor(splashSeconds(fx.seconds) * f);
        if (!instant && seconds <= 0) continue;
        if (p.id === this.player.id) this.player.applyEffect(fx.effect, seconds, fx.amp);
        else this.net?.effectRemote?.(p.id, fx.effect, seconds, fx.amp);
      }
    }
    this.bumpInv();
  }

  addXp(amount: number): void {
    const before = this.player.xpLevel;
    this.player.addXp(amount);
    if (this.player.xpLevel > before) this.sound("levelup", null, 0, 0, 0.6);
  }

  bumpInv(): void {
    this.store.set({ inv: this.store.get().inv + 1, hotbar: this.player.inventory.slots.slice(0, 9) });
  }

  message(text: string, color?: string): void {
    this.chatLines.push({ id: this.chatId++, text, color, at: performance.now() });
    if (this.chatLines.length > 100) this.chatLines.shift();
    this.store.set({ chat: this.chatLines.slice(-50) });
  }

  showTitle(text: string, sub?: string): void {
    this.title = { text, sub, at: performance.now() };
  }

  showActionbar(text: string): void {
    this.actionbar = { text, at: performance.now() };
  }

  /** Chat input: a command if it starts with "/", else a message to everyone. */
  submitChat(text: string): void {
    const t = text.trim();
    if (!t) return;
    if (t.startsWith("/")) {
      const out = runCommand(this, t.slice(1));
      for (const line of out) this.message(line.text, line.color);
      return;
    }
    this.message(`<${this.player.name}> ${t}`);
    this.net?.chat(t);
  }

  daylight(): number {
    // No sun where there is no sky: the Nether and the End sit in one unchanging dusk.
    if (!DIMENSION_INFO[this.dimension].hasSky) return 0.12;
    const sky = this.celestial();
    let d = Math.max(0, Math.min(1, this.sunHeight(sky) * 2.2 + 0.45));
    d *= 1 - this.rain * 0.25 - this.thunder * 0.25;
    // Totality is dusk at noon: the undead stop burning and the day's light goes out of the world with it.
    if (sky) d *= eclipseLight(sky.eclipse);
    return Math.max(0.12, d);
  }

  isNight(): boolean {
    // Under the real sky, night is when the Sun is down, however long the season makes it.
    const sky = this.celestial();
    if (sky) return sky.sun[1] < -0.035;
    const t = this.time % DAY_TICKS;
    return t > 12542 && t < 23460;
  }

  /** The sine of the Sun's altitude: the real one's, or the clock's. */
  private sunHeight(sky: SkyObjects | null): number {
    if (sky) return sky.sun[1];
    return Math.sin(((this.time % DAY_TICKS) / DAY_TICKS) * Math.PI * 2);
  }

  /** Whether this world shows the real sky: the overworld, with the switch on (engine/mods.ts). */
  realSky(): boolean {
    return this.dimension === "overworld" && this.modOn("real_sky") && Number.isFinite(this.meta.skyEpoch);
  }

  /** Where the player stands on the Earth, as the sky and the space trip both see it. */
  latLon(): { lat: number; lon: number } {
    return blockToLatLon(this.meta.seed, this.player.body.x, this.player.body.z, this.meta.place);
  }

  /**
   * Moves the sky to a moment (a Julian date) over a longitude, keeping the world's count of days: the clock goes to
   * that local solar time, and the epoch shifts so today is that date.
   */
  setSkyDate(jd: number, lon = this.latLon().lon): void {
    const c = clockFor(jd, lon, this.time);
    this.time = c.time;
    this.meta.skyEpoch = c.epoch;
    this.skyCache = null;
  }

  /** Moves the world to another place on the Earth, so the block the player stands on is at that latitude and longitude. */
  moveWorldTo(lat: number, lon: number): void {
    this.meta.place = placeFor(this.player.body.x, this.player.body.z, lat, lon);
    this.skyCache = null;
  }

  /**
   * One tick of the clock — or a twelfth of one while the Moon all but covers the Sun: the sky runs seventy-two
   * times faster than life, and the three minutes of a totality would otherwise be gone in three seconds.
   */
  private advanceClock(): void {
    const sky = this.celestial();
    if (sky && sky.eclipse > 0.97 && sky.sun[1] > -0.02) {
      this.slowClock += 1 / 12;
      if (this.slowClock < 1) return;
      this.slowClock -= 1;
    }
    this.time++;
  }

  /** The sky's date and time over the player (a Julian date) at a moment of the world's clock. */
  skyDate(time = this.time): number {
    return skyJd(time, this.meta.skyEpoch ?? 0, this.latLon().lon);
  }

  /**
   * The real sky over the player, or null where the world keeps the old one.
   * A frame asks for its own exact moment; everything else (a mob asking
   * whether the Sun is up) takes the last one worked out if it is within a
   * few minutes of sky time, which a frame keeps it.
   */
  celestial(time = this.time, exact = false): SkyObjects | null {
    if (!this.realSky()) return null;
    const { lat, lon } = this.latLon();
    const jd = skyJd(time, this.meta.skyEpoch!, lon);
    const c = this.skyCache;
    if (c && Math.abs(c.lat - lat) < 0.01 && Math.abs(c.sky.jd - jd) < (exact ? 1e-9 : 0.003)) return c.sky;
    const sky = skyAt(jd, lat, lon);
    this.skyCache = { sky, lat };
    return sky;
  }

  /**
   * The first moment from `time` the real Sun is up, within the morning:
   * sleeping to the game's six o'clock would wake the player in the dark
   * of a northern winter, with the night's monsters still about.
   */
  private sunriseFrom(time: number): number {
    if (!this.realSky()) return time;
    for (let t = time; t < time + 8000; t += 100) {
      if (this.celestial(t, true)!.sun[1] > -0.0145) return t;
    }
    return time;
  }

  /** Tells the player what the sky is doing, once each: an eclipse, the Moon in the Earth's shadow, a shower's night. */
  private skyNews(): void {
    const sky = this.celestial();
    if (!sky) return;
    const day = Math.round(sky.jd);
    if (sky.eclipse > 0.02 && sky.sun[1] > 0 && !this.skyTold.has(`e${day}`)) {
      this.skyTold.add(`e${day}`);
      this.message("The Moon is moving across the Sun: an eclipse has begun. Don't look at it without a filter.", "#ffd76a");
    }
    if (sky.eclipse > 0.995 && sky.sun[1] > 0 && !this.skyTold.has(`t${day}`)) {
      this.skyTold.add(`t${day}`);
      this.message("Totality. The corona is out, and the stars with it.", "#ffd76a");
      this.advance({ kind: "totality" });
    }
    if (sky.umbra > 0.05 && sky.moon[1] > 0 && !this.skyTold.has(`l${day}`)) {
      this.skyTold.add(`l${day}`);
      this.message(sky.umbra > 0.99 ? "The Moon is wholly in the Earth's shadow, lit red by every sunset on the Earth at once: a total lunar eclipse." : "The Earth's shadow is taking a bite out of the Moon: a lunar eclipse.", "#ff9a6a");
    }
    const top = sky.showers[0];
    if (top && top.zhr >= 10 && sky.sun[1] < -0.1 && !this.skyTold.has(`s${top.name}${day}`)) {
      this.skyTold.add(`s${top.name}${day}`);
      const [x, , z] = top.radiant;
      const compass = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(((Math.atan2(x, -z) / Math.PI) * 180 + 360) % 360 / 45) % 8];
      this.message(`The ${top.name} are falling tonight — up to ${Math.round(top.zhr)} an hour under a dark sky, out of the ${compass}${top.radiant[1] < 0 ? " once their radiant rises" : ""}: dust from ${top.parent}.`, "#9ff0ff");
    }
  }

  setScreen(screen: Screen | null): void {
    // In space, closing whatever is open (the pause menu, the chat) goes back to the ship.
    if (!screen && this.space) screen = { kind: "space" };
    const was = this.screen;
    if (was && (was.kind === "inventory" || was.kind === "crafting" || was.kind === "enchanting" || was.kind === "anvil" || was.kind === "smithing" || was.kind === "cooking")) this.returnGrid();
    if (this.cursor && (!screen || screen.kind === "pause")) {
      const left = this.player.inventory.add(this.cursor);
      if (left > 0) this.actions.throwStack({ ...this.cursor, count: left });
      this.cursor = null;
    }
    if (screen?.kind === "crafting") this.craftGrid = new Array(9).fill(null);
    else if (screen?.kind === "inventory") this.craftGrid = [null, null, null, null];
    // The enchanting table and the anvil hold their two stacks only while open, like a crafting grid.
    else if (screen?.kind === "enchanting" || screen?.kind === "anvil" || screen?.kind === "smithing") { this.craftGrid = [null, null]; this.anvilName = null; }
    else if (screen?.kind === "cooking") this.craftGrid = new Array(POT_SLOTS).fill(null);
    if (was?.kind === "chest" && screen?.kind !== "chest") this.sound("chest_close", was.x + 0.5, was.y + 0.5, was.z + 0.5, 0.5);
    if (was?.kind === "backpack" && screen?.kind !== "backpack") this.closeBackpack(was.slot);
    this.screen = screen;
    if (screen) { this.controls.attack = false; this.controls.use = false; this.actions.stopUsing(); }
    this.store.set({ screen, inv: this.store.get().inv + 1 });
  }

  /** Items left in a crafting grid go back to the inventory when it closes (or on the floor if full). */
  private returnGrid(): void {
    for (const s of this.craftGrid) {
      if (!s) continue;
      const left = this.player.inventory.add(s);
      if (left > 0) this.actions.throwStack({ ...s, count: left });
    }
    this.craftGrid = this.craftGrid.map(() => null);
  }

  respawn(): void {
    const p = this.player;
    // In the county, whoever died is gone: the next to wake in the house is somebody new, with a past of their own.
    if (this.vitalsRules()?.knox) p.setSurvivor(null);
    // Beds are in the overworld: death anywhere else sends the player home (online, a guest respawns by the host).
    if (this.dimension !== "overworld") {
      const host = this.role === "guest" && this.net?.hostConnection ? this.remote.get(this.net.hostConnection) : undefined;
      if (host) {
        p.respawn(host.x + 1, host.y, host.z);
        this.arrival = { kind: "exact", x: host.x + 1, y: host.y, z: host.z };
        this.spawnPlaced = false;
        this.setScreen(null);
        return;
      }
      if (this.simulates) {
        const bed = p.spawn;
        const target = bed ? { x: bed.x + 0.5, y: bed.y + 0.6, z: bed.z + 0.5 } : this.worldSpawn();
        this.changeDimension("overworld", { kind: "spawn", ...target });
      }
    }
    let spawn = p.spawn;
    if (spawn && !isBed(this.world.blockAt(Math.floor(spawn.x), Math.floor(spawn.y), Math.floor(spawn.z)))) {
      if (this.world.isLoaded(Math.floor(spawn.x), Math.floor(spawn.z))) {
        this.message("Your home bed was missing or obstructed", "#ffcc55");
        p.spawn = null;
        spawn = null;
      }
    }
    const s = spawn ? { x: spawn.x + 0.5, y: spawn.y + 0.6, z: spawn.z + 0.5 } : this.worldSpawn();
    p.respawn(s.x, s.y, s.z);
    this.needsSurface = !spawn;
    // A respawn that changed dimension lands through its arrival, on the ground by the spawn.
    if (this.arrival) { this.arrival = { kind: spawn ? "exact" : "spawn", ...s }; this.needsSurface = false; }
    if (this.meta.hardcore) p.setGameMode("spectator");
    this.spawnPlaced = false;
    this.setScreen(null);
    if (this.simulates) this.mode?.onRespawn();
  }

  worldSpawn(): { x: number; y: number; z: number } {
    if (!this.meta.spawn) {
      // Asked from another dimension before the overworld ever settled one: the middle of the map, landed on its ground.
      if (this.dimension !== "overworld") return { x: 0.5, y: SEA_LEVEL + 2, z: 0.5 };
      this.meta.spawn = this.generator.findSpawn();
    }
    return { ...this.meta.spawn };
  }

  /** Moves the player to the top of the ground at their spawn column once that chunk has loaded. */
  private placeAtSpawnIfNeeded(): boolean {
    if (this.spawnPlaced) return true;
    if (this.arrival) {
      if (!this.settleArrival(this.arrival)) return false;
      // A gateway moves only whoever stepped in it; the party follows only a change of dimension.
      const alone = this.arrival.kind === "gateway" || ("solo" in this.arrival && this.arrival.solo === true);
      this.arrival = null;
      this.spawnPlaced = true;
      if (this.net?.role === "host" && !alone) {
        const b = this.player.body;
        this.net.partyLanded?.(b.x, b.y, b.z);
      }
      return true;
    }
    const b = this.player.body;
    const x = Math.floor(b.x), z = Math.floor(b.z);
    if (!this.world.isLoaded(x, z)) return false;
    // A fresh world, or a respawn at world spawn, stands the player on the
    // ground once the area exists — the generator's height estimate does not
    // know about trees, and a new player dropped on a forest canopy is stuck
    // in the leaves before they have punched anything.
    if (this.needsSurface || b.y < 1) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.world.isLoaded(x + dx * 16, z + dz * 16)) return false;
      // A spawn that is already somewhere to stand is kept: snapping to the
      // highest block would put a player spawned indoors, like the casino
      // floor, up on its roof.
      const ground = this.standableAt(x, Math.floor(b.y), z) ?? this.groundNear(x, z);
      if (ground) {
        b.x = ground.x; b.z = ground.z; b.y = ground.y;
        if (this.needsSurface) this.meta.spawn = { ...ground };
      } else {
        const y = this.world.topSolid(x, z);
        b.y = (y < 0 ? SEA_LEVEL : y) + 1;
      }
      this.player.prevX = b.x; this.player.prevY = b.y; this.player.prevZ = b.z;
      this.needsSurface = false;
    }
    this.spawnPlaced = true;
    return true;
  }

  /** This exact spot, when the player's feet and head are clear and the block under them is ground rather than leaves. */
  private standableAt(x: number, y: number, z: number): { x: number; y: number; z: number } | null {
    if (y < 1 || y >= WORLD_HEIGHT - 2) return null;
    const under = this.world.blockAt(x, y - 1, z);
    if (!block(under).solid || isLeaves(under) || isFluid(under)) return null;
    const feet = this.world.blockAt(x, y, z), head = this.world.blockAt(x, y + 1, z);
    if (block(feet).solid || block(head).solid || isFluid(feet) || isFluid(head)) return null;
    return { x: x + 0.5, y, z: z + 0.5 };
  }

  /** The nearest column, spiralling out, whose top is ground to stand on: not leaves, a trunk or water. */
  private groundNear(x: number, z: number): { x: number; y: number; z: number } | null {
    for (let r = 0; r <= 16; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = x + dx, cz = z + dz;
          if (!this.world.isLoaded(cx, cz)) continue;
          const y = this.world.topSolid(cx, cz);
          if (y < 0 || y >= WORLD_HEIGHT - 2) continue;
          const top = this.world.blockAt(cx, y, cz);
          if (isLeaves(top) || isLog(top) || isFluid(top) || !block(top).solid) continue;
          return { x: cx + 0.5, y: y + 1, z: cz + 0.5 };
        }
      }
    }
    return null;
  }
  private needsSurface = false;

  // ---- the loop ------------------------------------------------------------------------------

  /**
   * A hidden tab gets no animation frames. Alone that is a pause, but online
   * it would freeze the host's world for every guest (and time a hidden guest
   * out), and a second tab on the same device is always hidden. So while
   * linked, a timer keeps the ticks going — browsers slow it to about once a
   * second, and each call catches up the ticks it missed.
   */
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  /** Re-checked when the tab's visibility or the link changes. */
  readonly syncBackground = (): void => {
    if (document.visibilityState === "hidden" && this.net && this.running) {
      if (!this.backgroundTimer) this.backgroundTimer = setInterval(() => this.background(performance.now()), 50);
    } else if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  };

  private background(now: number): void {
    if (!this.running || !this.net) { this.syncBackground(); return; }
    const dt = Math.min(5000, now - this.lastFrame);
    this.lastFrame = now;
    if (!this.placeAtSpawnIfNeeded()) return;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 100) {
      this.tick();
      this.acc -= TICK_MS;
      steps++;
    }
    if (steps === 100) this.acc = 0;
    this.streamer.update(this.streamCentres(), now);
  }

  private streamCentres(): { x: number; z: number }[] {
    const b = this.player.body;
    const out = [{ x: b.x, z: b.z }];
    // The host keeps the world loaded around every guest: their edits and the mobs near them run here.
    if (this.net?.role === "host") for (const r of this.remote.values()) out.push({ x: r.x, z: r.z });
    return out;
  }

  private frame(now: number): void {
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsTime); this.fpsFrames = 0; this.fpsTime = 0; }

    this.actions.frameInput(dt);

    const loaded = this.placeAtSpawnIfNeeded();
    this.acc += dt * 1000;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 5) {
      if (loaded) this.tick();
      this.acc -= TICK_MS;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    const alpha = Math.min(1, this.acc / TICK_MS);

    const p = this.player;
    const b = p.body;
    this.streamer.update(this.streamCentres(), now);

    this.actions.updateTarget();
    this.hurtTilt = Math.max(0, this.hurtTilt - dt * 3);

    const ix = p.prevX + (b.x - p.prevX) * alpha, iy = p.prevY + (b.y - p.prevY) * alpha, iz = p.prevZ + (b.z - p.prevZ) * alpha;
    const eye = iy + b.eyeHeight;
    const walk = p.prevWalkDist + (p.walkDist - p.prevWalkDist) * alpha;
    const speed = Math.hypot(b.x - p.prevX, b.z - p.prevZ);
    const bobAmount = this.settings.viewBobbing && b.onGround && !p.flying ? Math.min(1, speed * 5) : 0;
    const eyeBlock = this.world.blockAt(Math.floor(ix), Math.floor(eye), Math.floor(iz));
    const heldId = p.inventory.held?.id ?? null;
    const lightAt = this.world.getLight(Math.floor(ix), Math.floor(eye), Math.floor(iz));
    const [sky, worldBlock] = lightAt < 0 ? [1, 0] : [(lightAt >> 4) / 15, (lightAt & 15) / 15];
    // The hand holding a torch is lit by it, as the cave around it is (dynamic lights).
    const held = this.modOn("dynamic_lights") ? Math.max(itemLight(p.inventory.held?.id ?? -1), itemLight(p.inventory.offhand?.id ?? -1)) : 0;
    const blockLight = Math.max(worldBlock, held / 15);
    const biome = biomeDef(this.world.chunkAt(Math.floor(b.x), Math.floor(b.z))?.biomes[((Math.floor(b.z) & 15) << 4) | (Math.floor(b.x) & 15)] ?? 7);

    const ridingNow = p.riding !== null ? this.entities.get(p.riding) : undefined;
    const localCar = ridingNow instanceof Car ? ridingNow : null;
    const local: RemotePlayerView = {
      id: p.id, name: p.name, x: ix, y: iy, z: iz, yaw: p.yaw, pitch: p.pitch, walk, speed, swing: this.actions.swingProgress(alpha),
      sneaking: p.sneaking, heldItem: heldId, variant: this.settings.skin, hurt: p.hurtTime > 0, dead: p.dead,
      sitting: p.riding !== null, gliding: p.gliding, inCar: localCar !== null,
    };
    const carRiders = new Set<string>();
    for (const e of this.entities.values()) if (e instanceof Car && e.rider) carRiders.add(e.rider);
    const remote: RemotePlayerView[] = [];
    for (const r of this.remote.values()) {
      const t = Math.min(1, (now - r.receivedAt) / 120);
      remote.push({
        id: r.id, name: r.name, x: r.px + (r.x - r.px) * t, y: r.py + (r.y - r.py) * t, z: r.pz + (r.z - r.pz) * t,
        yaw: r.pyaw + angleDiff(r.pyaw, r.yaw) * t, pitch: r.pitch, walk: r.walk, speed: r.speed, swing: r.swing,
        sneaking: r.sneaking, heldItem: r.held, variant: r.variant, hurt: r.hurt, dead: r.dead || r.gameMode === "spectator",
        invisible: r.invisible, sitting: r.riding, gliding: r.gliding, inCar: carRiders.has(r.id),
      });
    }

    const info = DIMENSION_INFO[this.dimension];
    // What drifts in the air of a Nether biome, scattered around the player.
    if (biome.airborne && !this.hudHidden) {
      const n = Math.random() < dt * 30 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const px = ix + (Math.random() - 0.5) * 24, py = eye + (Math.random() - 0.5) * 12, pz = iz + (Math.random() - 0.5) * 24;
        if (this.world.blockAt(Math.floor(px), Math.floor(py), Math.floor(pz)) === B.AIR) this.renderer.particles.emit(biome.airborne, px, py, pz, 1, 0, 0);
      }
    }
    const target = this.actions.target?.block ?? null;
    if (this.launchCountdown !== null) this.countdown(dt);
    if (this.space) {
      this.renderSpace(dt);
    } else this.renderer.render({
      dt, alpha,
      // Behind a car the camera rides higher and further back, as a chase camera does.
      camera: { x: ix, y: eye + (localCar && this.perspective !== 0 ? 1.2 : 0), z: iz, yaw: p.yaw, pitch: p.pitch, fov: this.settings.fov * (p.sprinting ? 1.1 : 1) * (this.actions.bowFov()) * (localCar ? 1 + Math.min(0.15, Math.abs(localCar.speed) * 0.1) : 1) },
      perspective: this.perspective,
      cameraDistance: localCar ? localCar.spec.l + 3.5 : 4,
      bob: { walk, amount: bobAmount },
      hurtTilt: this.hurtTilt,
      time: this.time + alpha,
      rain: info.hasSky ? this.rain : 0,
      thunder: info.hasSky ? this.thunder : 0,
      lightning: this.lightning,
      snowing: info.hasSky && snowsHere(this.season(), biome.id, !!biome.snowy),
      renderDistance: this.settings.renderDistance,
      underwater: eyeBlock === B.WATER,
      inLava: eyeBlock === B.LAVA,
      nightVision: p.hasEffect("night_vision"),
      blind: p.hasEffect("blindness"),
      // Re-iterable, so a screenshot can draw the same frame again.
      entities: { [Symbol.iterator]: () => this.entities.values() },
      localPlayer: local,
      remotePlayers: remote,
      target: target ? { x: target.x, y: target.y, z: target.z } : null,
      crack: this.actions.crackStage(),
      hand: {
        itemId: heldId, swing: this.actions.swingProgress(alpha), equip: this.actions.equipOffset(), walk, bob: bobAmount,
        sky, block: blockLight, eating: this.actions.eatingPhase(), bowPull: this.actions.bowPull(), skinVariant: this.settings.skin,
        hurt: p.hurtTime > 0,
      },
      showHand: !this.hudHidden && !p.dead && p.gameMode !== "spectator",
      clouds: this.settings.clouds,
      wave: this.settings.graphics === "fancy",
      dimension: info.hasSky ? undefined : { fog: biome.fog ?? 0x330808, ambient: info.ambient, sky: info.skyLight, open: info.open },
      dynamicLights: this.dynamicLights(ix, eye, iz),
      season: this.season() ? seasonTint(this.time, warmBiome(biome.id)) : undefined,
      bloodMoon: this.bloodMoon && this.dimension === "overworld",
      celestial: this.celestial(this.time + alpha, true),
      border: this.dimension === "overworld" ? this.border : null,
      markers: this.dimension === "overworld" ? this.markers : [],
    });
    this.lightning = 0;
    this.audio.setListener(ix, eye, iz, p.yaw);
    this.audio.engine(localCar && !localCar.wrecked && !this.screen ? { speed: localCar.speed, top: localCar.spec.top, throttle: Math.abs(this.controls.forward) } : null);
    this.audio.radio(localCar && !localCar.wrecked && this.radioStation >= 0 ? this.radioStation : null);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.store.set(this.hudSnapshot());
    }
  }

  private tick(): void {
    this.tickCount++;
    const p = this.player;
    p.beginTick();
    for (const e of this.entities.values()) e.beginTick();
    for (const r of this.remote.values()) if (r.hurt && performance.now() - r.lastSeen > 500) r.hurt = false;

    const b = p.body;
    const inputBlocked = !!this.screen && this.screen.kind !== "chat";
    const c = this.controls;
    // A mode's countdown holds everyone on their pads, as does ground that has not loaded yet.
    const frozen = !this.world.isLoaded(Math.floor(b.x), Math.floor(b.z)) || (this.frozen && p.gameMode !== "spectator");
    const rules = { difficulty: this.meta.difficulty, naturalRegeneration: this.meta.rules.naturalRegeneration, raining: this.rain > 0.5 };
    const vehicle = this.ridden();
    if (!frozen && vehicle) {
      // Sneak climbs out; everything else steers.
      if (!inputBlocked && c.sneak) this.dismount();
      else {
        vehicle.input = {
          forward: inputBlocked ? 0 : c.forward, strafe: inputBlocked ? 0 : c.strafe, yaw: p.yaw,
          jump: !inputBlocked && c.jump, pitch: p.pitch,
        };
        p.tickRiding(this.world, rules);
      }
    } else if (!frozen) {
      p.tick(this.world, {
        forward: inputBlocked ? 0 : c.forward, strafe: inputBlocked ? 0 : c.strafe,
        jump: !inputBlocked && (c.jump || this.actions.autoJumpNow()), sneak: !inputBlocked && c.sneak, sprint: !inputBlocked && c.sprint,
      }, rules);
    }
    this.handlePlayerEvents(p.events.splice(0));
    this.actions.tick();
    if (!frozen) this.tickPortal();

    // Footsteps.
    if (b.onGround && !p.sneaking) {
      this.stepDist += Math.hypot(b.x - p.prevX, b.z - p.prevZ);
      if (this.stepDist > 1.7) {
        this.stepDist = 0;
        const g = groundBlock(this.world, b);
        if (g) this.blockSound(block(g).material, "step", b.x, b.y, b.z, false);
      }
    }
    if (b.inWater && Math.hypot(b.vx, b.vz) > 0.05 && this.tickCount % 12 === 0) this.audio.play("swim", b.x, b.y, b.z, 0.3);

    if (this.simulates) this.simulate();
    else this.guestTick();
    this.seatRider();

    this.net?.tick();

    if (this.role !== "guest" && ++this.saveTimer >= AUTOSAVE_TICKS) {
      this.saveTimer = 0;
      void this.saveNow().catch((e: Error) => this.message(`Autosave failed: ${e.message}`, "#ff6666"));
    }
    if (this.tickCount % 20 === 0) this.audio.tickMusic(1, !this.isNight());
    if (this.tickCount % 20 === 11) this.repaintMap();
    if (this.tickCount % 20 === 13 && this.modOn("ambient_sounds")) this.ambience();
    if (this.tickCount % 40 === 7 && !this.space) this.skyNews();
    if (this.tickCount % 20 === 17) this.tickVitals();
    if (this.tickCount % 20 === 9) this.tickCounty();
    // Running is loud where the infected roam: they hear it from a few blocks off.
    if (this.tickCount % 20 === 3 && p.sprinting && !p.dead && modeDef(this.meta.mode?.id)?.fauna === "infected") this.makeNoise(b.x, b.y, b.z, 10 * p.perks.noise, p.id);
    this.borderTick();
    this.critters.tick();
    if (p.health > this.maxHealth) p.health = this.maxHealth;
    if (this.simulates && this.mode) {
      if (!this.meta.mode!.started && this.spawnPlaced) { this.meta.mode!.started = true; this.mode.start(); }
      if (this.meta.mode!.started) {
        this.mode.tick();
        if (this.tickCount % 20 === 0) { this.mode.second(); this.pushObjectives(); }
      }
    }
    if (this.tickCount % 10 === 0) this.advance();
    // The City at the End of the Game: inside a city's bounds, above its island.
    if (this.tickCount % 20 === 7 && this.dimension === "end" && this.generator instanceof EndGenerator && !this.player.advancements.has("city")) {
      const b = this.player.body;
      for (const c of endCitiesTouching(this.generator, Math.floor(b.x) >> 4, Math.floor(b.z) >> 4)) {
        if (b.x >= c.x0 && b.x <= c.x1 + 1 && b.z >= c.z0 && b.z <= c.z1 + 1 && b.y >= c.y - 2) this.advance({ kind: "city" });
      }
    }
    // A rocket with stars, spent while gliding, bursts on the glider.
    if (this.boostWas > 0 && this.player.boostTicks === 0 && this.boostBursts) {
      const b = this.player.body;
      const r = new FireworkRocket(b.x, b.y + 0.9, b.z, this.boostBursts, 0, 0, 0, 0, this.player.id);
      if (this.role === "guest") this.net?.launchFirework?.(b.x, b.y + 0.9, b.z, { ...this.boostBursts, flight: 0 });
      else this.spawn(r);
      this.boostBursts = null;
    }
    this.boostWas = this.player.boostTicks;
    // Great View From Up Here: fifty blocks up on one dose of levitation.
    if (this.player.hasEffect("levitation")) {
      this.levitatedFrom ??= this.player.body.y;
      if (this.player.body.y - this.levitatedFrom >= 50) this.advance({ kind: "levitate" });
    } else this.levitatedFrom = null;
    // Eye Spy: standing in a stronghold's halls.
    if (this.tickCount % 20 === 5 && this.dimension === "overworld" && !this.player.advancements.has("stronghold") && this.hasStrongholds()
      && inStronghold(this.meta.seed, this.player.body.x, this.player.body.y, this.player.body.z)) this.advance({ kind: "stronghold" });
  }

  private handlePlayerEvents(events: PlayerEvent[]): void {
    const p = this.player;
    for (const ev of events) {
      switch (ev.type) {
        case "hurt":
          if (ev.amount > 0) this.sound("hurt", null, 0, 0, 0.8, 0.9 + Math.random() * 0.2);
          break;
        case "death":
          this.message(ev.message, "#ff8888");
          this.net?.chat(`\u0000death:${ev.message}`);
          if (this.modOn("minimap")) p.waypoints = withDeathPoint(p.waypoints, p.body.x, p.body.y, p.body.z, this.dimension);
          this.onDeath();
          if (this.simulates) this.mode?.onPlayerDeath(p.id);
          break;
        case "land":
          if (ev.distance > 1.5 && ev.block > 0) this.blockSound(block(ev.block).material, "step", p.body.x, p.body.y, p.body.z, false);
          if (ev.distance > 3 && p.survivalLike) this.particles("block", p.body.x, p.body.y + 0.1, p.body.z, 8, ev.block, false);
          // Trampled farmland.
          if (ev.distance > 1 && ev.block === B.FARMLAND && p.survivalLike) {
            const x = Math.floor(p.body.x), y = Math.floor(p.body.y - 0.2), z = Math.floor(p.body.z);
            if (Math.random() < ev.distance - 0.5) this.world.setBlock(x, y, z, B.DIRT, 0, "player");
          }
          break;
        case "splash":
          this.sound("splash", p.body.x, p.body.y, p.body.z, 0.6);
          this.particles("splash", p.body.x, p.body.y + 0.5, p.body.z, 12);
          break;
        case "levelup":
          this.sound("levelup", null, 0, 0, 0.8);
          break;
        case "eat":
          this.sound("burp", null, 0, 0, 0.4, 0.9 + Math.random() * 0.2);
          this.advance({ kind: "eat" });
          if (itemDef(ev.item)?.name === "chorus_fruit") this.chorusTeleport();
          break;
      }
    }
  }

  private onDeath(): void {
    const p = this.player;
    const b = p.body;
    this.actions.stopUsing();
    if (!this.meta.rules.keepInventory) {
      const inv = p.inventory;
      // A gravestone keeps it all together where they fell (engine/graves.ts); without one, it scatters.
      const grave = this.modOn("gravestones") ? packGrave(inv, [this.cursor, ...this.craftGrid]) : null;
      if (grave && this.role === "guest") {
        this.net?.placeGrave?.(b.x, b.y, b.z, grave, p.name, p.yaw);
        this.message("Your things rest in a gravestone where you fell.", "#c0c0c0");
      } else if (grave && this.placeGrave(b.x, b.y, b.z, grave, p.name, p.yaw)) {
        this.message("Your things rest in a gravestone where you fell. Use it to take them back.", "#c0c0c0");
      } else {
        for (const s of [...inv.slots, ...inv.armor, inv.offhand]) {
          if (s) this.dropItem(b.x, b.y + 1, b.z, s, (Math.random() - 0.5) * 0.5, 0.2 + Math.random() * 0.2, (Math.random() - 0.5) * 0.5);
        }
        if (this.cursor) this.dropItem(b.x, b.y + 1, b.z, this.cursor);
        for (const s of this.craftGrid) if (s) this.dropItem(b.x, b.y + 1, b.z, s);
      }
      inv.clear();
      this.cursor = null;
      this.craftGrid = this.craftGrid.map(() => null);
      this.spawnXp(b.x, b.y + 1, b.z, p.deathXp());
      p.xpLevel = 0; p.xpPoints = 0;
    }
    this.bumpInv();
    this.setScreen({ kind: "death" });
  }

  /** The host's (or single player's) share of each tick: the world itself. */
  private simulate(): void {
    const world = this.world;
    world.tick++;
    if (this.meta.rules.doDaylightCycle) this.advanceClock();
    this.weatherTick();

    // Scheduled block updates, budgeted so a lava lake settling cannot stall a frame.
    const due = world.takeDue(2000);
    for (const [x, y, z] of due) this.rules.onTick(x, y, z);
    this.redstone.step(world.tick);
    this.rules.randomTicks(this.playerRefs().map((r) => ({ x: r.x, z: r.z })), 4);
    this.tickFurnaces();

    const ctx = this.ctx;
    if (this.dimension === "end") this.endFight.tick();
    for (const e of this.entities.values()) {
      // The dragon flies over chunks nobody has loaded; everything else waits for its ground.
      if (!world.isLoaded(Math.floor(e.x), Math.floor(e.z)) && e.kind !== "ender_dragon") continue;
      // A guest drives the vehicle they ride and reports where it went.
      if ((e instanceof Vehicle || e instanceof Mob) && e.rider && e.rider !== this.player.id && this.remote.has(e.rider)) continue;
      e.tick(ctx);
    }
    // Cars run into things only here, where the world is simulated — whoever is at the wheel.
    let refs: PlayerRef[] | null = null;
    for (const e of this.entities.values()) {
      if (!(e instanceof Car) || e.removed || e.wrecked) continue;
      refs ??= this.playerRefs();
      e.impacts(ctx, ctx.entitiesNear(e.x, e.y, e.z, 6), refs);
    }
    // A vehicle whose rider left the game is free again.
    for (const e of this.entities.values()) {
      if ((e instanceof Vehicle || e instanceof Mob) && e.rider && e.rider !== this.player.id && !this.remote.has(e.rider)) e.rider = null;
    }
    for (const [id, e] of this.entities) if (e.removed) this.entities.delete(id);

    if (this.golemChecks.length) this.buildGolems();
    if (this.endPortalChecks.length) this.lightEndPortals();
    if (this.tickCount % 20 === 0) this.spawnMobs();
    if (this.spawners.size) this.tickSpawners(this.playerRefs());
    this.sleepTick();
  }

  /** The vehicle this player rides, or null — letting go of one that vanished or was taken. */
  ridden(): Vehicle | Mob | null {
    const p = this.player;
    if (p.riding === null) return null;
    const v = this.entities.get(p.riding);
    const mount = (v instanceof Vehicle && v.rideable) || (v instanceof Mob && v.saddled && !v.dying && !v.unconscious);
    if (!mount || v.removed || p.dead || (v.rider !== null && v.rider !== p.id) || (v.rider === null && this.simulates)) {
      this.dismount();
      return null;
    }
    return v;
  }

  /** Climbs into a vehicle, or onto a saddled creature: at once here, and on the host too when this is a guest. */
  mount(v: Vehicle | Mob): void {
    const p = this.player;
    if (v.rider && v.rider !== p.id) return;
    if (p.riding !== null) this.dismount();
    v.rider = p.id;
    p.riding = v.id;
    p.sleeping = null;
    this.net?.mount?.(v.id, true);
    if (v instanceof Car) {
      if (this.simulates) this.carjack(v, p.id);
      // Driving is done from behind the car, the way the city games do it.
      if (this.perspective === 0) { this.perspective = 1; this.carCamera = true; }
      this.showActionbar(`${v.spec.name} — sneak to get out`);
    } else this.showActionbar("Sneak to get out");
  }

  /** Set when getting into a car switched the view to behind it, so getting out switches it back. */
  private carCamera = false;

  /** The car radio's station (engine/radio.ts), or -1 for off; kept from car to car. */
  radioStation = 0;
  /** Tunes the car radio to the next station, and round to off. */
  nextStation(): void {
    this.radioStation = this.radioStation + 1 >= STATIONS.length ? -1 : this.radioStation + 1;
    const s = STATIONS[this.radioStation];
    this.showActionbar(s ? `Radio: ${s.name} — ${s.genre}` : "Radio off");
  }

  private captionNow: { who: string; text: string; color: string; at: number } | null = null;
  /** A line of dialogue across the bottom of the screen, for as long as it takes to read. */
  caption(who: string, text: string, color = "#ffffff"): void {
    this.captionNow = { who, text, color, at: performance.now() };
    this.store.set({ caption: { who, text, color } });
  }

  /** The spots the player's mission marks (the city runtime's, or the host's word for a guest). */
  markers: Marker[] = [];

  /**
   * Taking a car somebody is driving: they are pulled out of the other side,
   * and they are not happy about it — most run, some swing.
   */
  carjack(car: Car, by: string): void {
    car.lastDriver = by;
    if (!car.npc) return;
    car.npc = false;
    const side = car.spec.w / 2 + 0.8;
    const x = car.x - Math.cos(car.yaw) * side, z = car.z + Math.sin(car.yaw) * side;
    const m = new Mob("citizen", x, car.y, z);
    m.say(pickQuip(CARJACK_QUIPS, Math.random));
    if (toughCitizen(m)) { m.targetId = by; m.anger = 400; } else { m.panic = 160; m.scare = { x: car.x, z: car.z }; }
    this.spawn(m);
    if (this.meta.mode?.started) this.mode?.onCarjack(by);
  }

  /** Climbs out, onto a free spot beside the vehicle. */
  dismount(): void {
    const p = this.player;
    if (p.riding === null) return;
    const v = this.entities.get(p.riding);
    p.riding = null;
    if (this.carCamera) { this.perspective = 0; this.carCamera = false; }
    if (!(v instanceof Vehicle || v instanceof Mob)) return;
    if (v.rider === p.id) v.rider = null;
    this.net?.mount?.(v.id, false);
    const b = p.body;
    const x = Math.floor(v.x), y = Math.floor(v.y + 0.5), z = Math.floor(v.z);
    const free = (bx: number, by: number, bz: number) =>
      !block(this.world.blockAt(bx, by, bz)).solid && !block(this.world.blockAt(bx, by + 1, bz)).solid && block(this.world.blockAt(bx, by - 1, bz)).solid;
    const spots: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]];
    const spot = spots.find(([dx, dy, dz]) => free(x + dx, y + dy, z + dz));
    if (spot) { b.x = x + spot[0] + 0.5; b.y = y + spot[1]; b.z = z + spot[2] + 0.5; }
    else b.y = v.y + v.body.height + 0.05;
    b.vx = b.vy = b.vz = 0;
    p.prevX = b.x; p.prevY = b.y; p.prevZ = b.z;
  }

  /** Keeps a rider on their seat after the vehicle moved. */
  private seatRider(): void {
    const v = this.ridden();
    if (!v) return;
    const b = this.player.body;
    if (v instanceof Car) {
      const seat = v.seat();
      b.x = seat.x; b.y = seat.y; b.z = seat.z;
    } else {
      b.x = v.x; b.y = v.riderY(); b.z = v.z;
    }
    // A boat or a car turns its rider (and so the camera) with it.
    if (v instanceof Boat || v instanceof Car) this.player.yaw += angleDiff(v.prevYaw, v.yaw);
  }

  /** Sets a rocket off from (x, y, z), straight up (the host's half of firing one). */
  launchFirework(x: number, y: number, z: number, rocket: Rocket, owner: string | null): void {
    this.spawn(FireworkRocket.launch(x, y, z, rocket, Math.random, owner));
    this.sound("firework_launch", x, y, z, 1);
  }

  // ---- waystones -----------------------------------------------------------------------------

  /** Every waystone in this world (engine/waystones.ts). */
  get waystones(): Record<string, Waystone> {
    return (this.meta.waystones ??= {});
  }

  /**
   * A waystone at x, y, z joins the world's list, under a name of its own,
   * unless it is already on it. The host's list is the one that counts; a
   * guest adds it to its own copy at once, so its screen is not empty while
   * the host's answer is on its way.
   */
  addWaystone(x: number, y: number, z: number): Waystone | null {
    if (this.world.blockAt(x, y, z) !== B.WAYSTONE) return null;
    const key = waystoneKey(this.dimension, x, y, z);
    let w = this.waystones[key];
    if (!w) {
      w = { name: waystoneName(x, y, z), x, y, z, dim: this.dimension };
      this.waystones[key] = w;
      if (this.role === "guest") this.net?.registerWaystone?.(x, y, z);
      else this.net?.waystonesChanged?.();
    }
    return w;
  }

  /** Using a waystone: it wakes for this player (the first time), and its list of destinations opens. */
  useWaystone(x: number, y: number, z: number): void {
    if (!this.modOn("waystones")) { this.message("Waystones are switched off in this world.", "#ffcc55"); return; }
    const w = this.addWaystone(x, y, z);
    if (!w) return;
    const key = waystoneKey(this.dimension, x, y, z);
    if (!this.player.waystones.has(key)) {
      this.player.waystones.add(key);
      this.message(`Waystone found: ${w.name}`, "#55ffff");
      this.sound("levelup", x + 0.5, y + 0.5, z + 0.5, 0.6, 1.6);
      this.particles("portal", x + 0.5, y + 1, z + 0.5, 30);
    }
    this.setScreen({ kind: "waystone", x, y, z });
  }

  renameWaystone(key: string, name: string): void {
    const w = this.waystones[key];
    const clean = name.trim().slice(0, WAYSTONE_NAME_MAX);
    if (!w || !clean || clean === w.name) return;
    w.name = clean;
    if (this.role === "guest") this.net?.renameWaystone?.(key, clean);
    else this.net?.waystonesChanged?.();
  }

  /**
   * Travels from the waystone at `from` to the one at `to`: both must stand,
   * be in this dimension, and `to` must have been found by this player. Costs
   * experience levels (engine/waystones.ts travelCost). Says why when it cannot.
   */
  travelByWaystone(from: string, to: string): boolean {
    const p = this.player;
    const a = this.waystones[from], b = this.waystones[to];
    if (!a || !b || from === to) return false;
    if (b.dim !== this.dimension) { this.message(`${b.name} is in another dimension; waystones only reach within one.`, "#ff8888"); return false; }
    if (!p.waystones.has(to)) return false;
    if (this.world.isLoaded(b.x, b.z) && this.world.blockAt(b.x, b.y, b.z) !== B.WAYSTONE) {
      delete this.waystones[to];
      if (this.role !== "guest") this.net?.waystonesChanged?.();
      this.message(`${b.name} is gone — someone broke it.`, "#ff8888");
      return false;
    }
    const cost = travelCost(a, b, p.gameMode === "creative" || p.gameMode === "spectator");
    if (p.xpLevel < cost) { this.message(`That trip costs ${cost} level${cost === 1 ? "" : "s"} of experience; you have ${p.xpLevel}.`, "#ff8888"); return false; }
    p.xpLevel -= cost;
    const bb = p.body;
    this.particles("portal", bb.x, bb.y + 1, bb.z, 40);
    this.sound("chorus_fruit_teleport", bb.x, bb.y, bb.z, 0.8);
    this.setScreen(null);
    this.travelTo(b.x + 0.5, b.y, b.z + 0.5);
    this.sound("chorus_fruit_teleport", null, 0, 0, 0.8);
    this.advance({ kind: "waystone" });
    return true;
  }

  /** Host: a waystone was broken, so it leaves the world's list. */
  private waystoneBroken(x: number, y: number, z: number): void {
    const key = waystoneKey(this.dimension, x, y, z);
    if (!this.waystones[key]) return;
    delete this.waystones[key];
    this.net?.waystonesChanged?.();
  }

  /**
   * AppleSkin's view of hunger: the saturation the bar hides, and — holding
   * food — the bar as it would be after eating it. Nothing when switched off.
   */
  private hungerPreview(): Pick<Hud, "saturation" | "foodPreview"> {
    const p = this.player;
    if (!this.modOn("appleskin")) return { saturation: null, foodPreview: null };
    const food = itemDef(p.inventory.held?.id ?? -1)?.food;
    const preview = food && p.food < 20
      ? { food: Math.min(20, p.food + food.hunger), saturation: Math.min(Math.min(20, p.food + food.hunger), p.saturation + food.saturation) }
      : null;
    return { saturation: p.saturation, foodPreview: preview };
  }

  /** Once a second: perhaps a sound of the place the player is in (engine/ambience.ts). */
  private ambience(): void {
    const b = this.player.body;
    const x = Math.floor(b.x), y = Math.floor(b.y + 1.5), z = Math.floor(b.z);
    const l = this.world.getLight(x, y, z);
    const biome = biomeDef(this.world.chunkAt(x, z)?.biomes[((z & 15) << 4) | (x & 15)] ?? 7);
    let nearWater = false;
    for (let dz = -8; dz <= 8 && !nearWater; dz += 4) for (let dx = -8; dx <= 8 && !nearWater; dx += 4) {
      const top = this.world.topSolid(x + dx, z + dz);
      nearWater = top >= 0 && this.world.blockAt(x + dx, top, z + dz) === B.WATER;
    }
    const cue = ambientCue({
      dimension: this.dimension, biome: biome.name, night: this.isNight(), raining: this.rain > 0.5 && this.dimension === "overworld",
      underground: l >= 0 && l >> 4 < 4 && y < SEA_LEVEL - 4, y: b.y, nearWater,
    }, Math.random);
    if (cue) this.audio.ambient(cue, b.x + (Math.random() - 0.5) * 16, b.y + 2 + Math.random() * 4, b.z + (Math.random() - 0.5) * 16);
  }

  // ---- gravestones ----------------------------------------------------------------------------

  /**
   * Host: lays a gravestone for a death at x, y, z, holding `items`, facing
   * the way its player looked. False when there is nowhere open near enough.
   */
  placeGrave(x: number, y: number, z: number, items: Slot[], owner: string, yaw: number): boolean {
    const spot = graveSpot((a, b, c) => this.world.blockAt(a, b, c), x, y, z);
    if (!spot) return false;
    const [gx, gy, gz] = spot;
    this.world.setBlock(gx, gy, gz, B.GRAVESTONE, OPPOSITE_FACING[lookFacing(yaw)], "world");
    this.world.setEntity(gx, gy, gz, { kind: "chest", items: items.map((s) => (s ? { ...s } : null)), owner: owner.slice(0, 16) });
    this.containerChanged(gx, gy, gz);
    return true;
  }

  /** Using a gravestone: here, its things go back where they were carried; a guest asks the host. */
  useGrave(x: number, y: number, z: number): void {
    if (this.role === "guest") this.net?.collectGrave?.(x, y, z);
    else this.collectGrave(x, y, z, null);
  }

  /**
   * Host: empties a gravestone into a player — this one (`who` null), each
   * thing into the slot it came from, or a guest by connection — and clears it away.
   */
  collectGrave(x: number, y: number, z: number, who: string | null): void {
    if (this.world.blockAt(x, y, z) !== B.GRAVESTONE) return;
    const e = this.world.getEntity(x, y, z);
    const items = e?.kind === "chest" ? e.items : [];
    this.world.setEntity(x, y, z, undefined);
    this.world.setBlock(x, y, z, B.AIR, 0, "world");
    if (who === null) {
      for (const s of unpackGrave(items, this.player.inventory)) this.dropItem(x + 0.5, y + 0.5, z + 0.5, s);
      this.bumpInv();
    } else for (const s of items) if (s) this.net?.giveRemote(who, s);
    this.sound("chest_open", x + 0.5, y + 0.5, z + 0.5, 0.6, 0.7);
    this.particles("block", x + 0.5, y + 0.6, z + 0.5, 16, B.GRAVESTONE);
  }

  // ---- backpacks ------------------------------------------------------------------------------

  /** Opens the backpack in inventory slot `slot`: its 27 slots become the open container. */
  openBackpack(slot: number): void {
    const pack = this.player.inventory.slots[slot];
    if (!pack || itemDef(pack.id)?.use !== "backpack" || !this.modOn("backpacks")) return;
    const items = pack.contents ?? [];
    pack.contents = Array.from({ length: BACKPACK_SLOTS }, (_, i) => items[i] ?? null);
    this.sound("chest_open", null, 0, 0, 0.4, 1.3);
    this.setScreen({ kind: "backpack", slot });
  }

  /** An empty backpack carries no contents list, so it stacks and compares as a fresh one does. */
  private closeBackpack(slot: number): void {
    const pack = this.player.inventory.slots[slot];
    if (pack?.contents && !pack.contents.some(Boolean)) delete pack.contents;
    this.sound("chest_close", null, 0, 0, 0.4, 1.3);
    this.bumpInv();
  }

  // ---- game modes ------------------------------------------------------------------------------

  /** Once a second: this player's scoreboard, and each guest's own, sent only when it changed. */
  private pushObjectives(): void {
    if (!this.mode) return;
    const mine = this.mode.objective(this.player.id);
    if (JSON.stringify(mine) !== JSON.stringify(this.objectiveNow)) { this.objectiveNow = mine; this.store.set({ objective: mine }); }
    for (const r of this.remote.values()) {
      const obj = this.mode.objective(r.id);
      const key = JSON.stringify([obj, this.border, this.frozen, this.maxHealth, this.bloodMoon]);
      if (this.objectiveSent.get(r.id) === key) continue;
      this.objectiveSent.set(r.id, key);
      this.modeTell(r.id, { obj, border: this.border, frozen: this.frozen, maxHealth: this.maxHealth, bloodMoon: this.bloodMoon });
    }
  }

  /** Host → a guest (or all, with null): what a mode wants them to see or be. */
  modeTell(target: string | null, t: ModeTell): void {
    if (this.role === "guest") return;
    this.net?.modeTell?.(target, t);
  }

  /** A new round of a mode for this player: empty-handed, healed, fed, and rid of every effect. */
  resetForRound(): void {
    const p = this.player;
    p.inventory.clear();
    p.health = this.maxHealth;
    p.food = 20;
    p.saturation = 5;
    p.effects = [];
    p.fireTicks = 0;
    this.bumpInv();
  }

  /** A guest hears from the host's mode. */
  applyModeTell(t: ModeTell): void {
    if (t.reset) this.resetForRound();
    if (t.msg) this.message(t.msg, t.color ?? "#ffff55");
    if (t.title) this.showTitle(t.title, t.sub);
    if (t.gm) { this.player.setGameMode(t.gm); this.bumpInv(); }
    if (t.obj !== undefined) { this.objectiveNow = t.obj; this.store.set({ objective: t.obj }); }
    if (t.border !== undefined) this.border = t.border;
    if (t.frozen !== undefined) this.frozen = t.frozen;
    if (t.maxHealth !== undefined) this.maxHealth = t.maxHealth;
    if (t.bloodMoon !== undefined) this.bloodMoon = t.bloodMoon;
    if (t.cash) { this.player.cash = Math.max(0, this.player.cash + t.cash); this.bumpInv(); }
    if (t.wanted !== undefined) this.player.wanted = t.wanted;
    if (t.caption) this.caption(t.caption.who, t.caption.text, t.caption.color);
    if (t.markers !== undefined) this.markers = t.markers ?? [];
    if (t.confiscate) this.confiscateGuns();
  }

  /** Busted: the police keep every gun and round on you. */
  confiscateGuns(): void {
    const inv = this.player.inventory;
    const seized = (id: number) => { const d = itemDef(id); return d?.use === "gun" || ["pistol_ammo", "rifle_ammo", "shotgun_shells"].includes(d?.name ?? ""); };
    inv.slots.forEach((s, i) => { if (s && seized(s.id)) inv.slots[i] = null; });
    if (inv.offhand && seized(inv.offhand.id)) inv.offhand = null;
    this.bumpInv();
  }

  // ---- the casino (engine/casino.ts, ui/CasinoScreens.tsx) -------------------------------------------------

  private casinoCache: Map<string, CasinoGame> | null = null;

  /** The casino game whose machine or table stands at a block, on a map that has a casino. */
  casinoGameAt(x: number, y: number, z: number): CasinoGame | null {
    if (!this.casinoCache) {
      this.casinoCache = new Map();
      const m = this.meta;
      if (m.map) for (const c of mapLayout(m.map, m.seed, new Generator({ seed: m.seed, type: m.type, dimension: "overworld" })).casino ?? []) this.casinoCache.set(`${c.x},${c.y},${c.z}`, c.game);
    }
    return this.dimension === "overworld" ? this.casinoCache.get(`${x},${y},${z}`) ?? null : null;
  }

  private shopCache: Map<string, ShopKind> | null = null;
  /** The shop whose counter stands at a block (the city's gun shop and car dealer). */
  shopAt(x: number, y: number, z: number): ShopKind | null {
    if (!this.shopCache) {
      this.shopCache = new Map();
      const m = this.meta;
      if (m.map) for (const c of mapLayout(m.map, m.seed, new Generator({ seed: m.seed, type: m.type, dimension: "overworld" })).shops ?? []) this.shopCache.set(`${c.x},${c.y},${c.z}`, c.shop);
    }
    return this.dimension === "overworld" ? this.shopCache.get(`${x},${y},${z}`) ?? null : null;
  }

  /**
   * A car bought at the dealer: put in the world beside the buyer, facing the
   * street, and theirs to keep. A guest's is put there by the host.
   */
  deliverCar(model: CarModelId, color: number): void {
    const b = this.player.body;
    const x = Math.floor(b.x) + 0.5, z = Math.floor(b.z) + 4.5;
    if (this.role === "guest") this.net?.placeVehicle?.("car", x, b.y, z, Math.PI, carCode(model, color));
    else this.placeVehicle("car", x, b.y, z, Math.PI, carCode(model, color));
  }

  /** A casino game paid out: the advancements that come of winning, and a million. */
  casinoResult(paid: number, stake: number): void {
    if (paid > stake) this.advance({ kind: "casino_win" });
    if (stake > 0 && paid >= stake * 100) this.advance({ kind: "jackpot" });
    if (this.player.cash >= 1_000_000 && !this.player.advancements.has("millionaire")) {
      this.advance({ kind: "millionaire" });
      this.showTitle("MILLIONAIRE", "Number go up.");
    }
  }

  /** Changes the world's border (host); guests hear it with their next scoreboard. */
  setBorder(border: { x: number; z: number; radius: number } | null): void {
    this.border = border;
    this.objectiveSent.clear();
  }

  /** Outside a mode's border, in the overworld, a survival player takes a point of harm a second. */
  private borderTick(): void {
    const bd = this.border, p = this.player, b = p.body;
    if (!bd || this.dimension !== "overworld" || !p.survivalLike || p.dead) return;
    const out = Math.max(Math.abs(b.x - bd.x), Math.abs(b.z - bd.z)) - bd.radius;
    if (out <= 0) return;
    if (this.tickCount % 20 === 0) {
      p.hurt(Math.min(4, 1 + Math.floor(out / 8)), "magic");
      this.showActionbar("You are outside the border — get back inside!");
    }
  }

  /** A bolt from the blue at x, y, z: a flash, thunder, fire where it lands, and a hard blow to anyone close. */
  strikeLightning(x: number, y: number, z: number): void {
    this.lightning = 1;
    this.net?.effect("explosion", ["lightning"]);
    this.sound("thunder", x, y + 4, z, 1, 1);
    const fx = Math.floor(x), fz = Math.floor(z);
    if (this.world.blockAt(fx, Math.floor(y), fz) === B.AIR && block(this.world.blockAt(fx, Math.floor(y) - 1, fz)).solid) this.world.setBlock(fx, Math.floor(y), fz, B.FIRE, 0, "world");
    for (const r of this.playerRefs()) {
      if (Math.hypot(r.x - x, r.y - y, r.z - z) > 3) continue;
      if (r.id === this.player.id) { this.player.hurt(5, "fire", x, z); this.player.fireTicks = Math.max(this.player.fireTicks, 100); }
      else this.net?.hurtRemote(r.id, 5, "fire", x, z, 0.3);
    }
  }

  /** A lucky block broke at x, y, z: whatever luck it held happens there (engine/lucky.ts). */
  private luckyOutcome(x: number, y: number, z: number): void {
    const o = luckyOutcome(Math.random);
    const near = this.playerRefs().sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    const tellNear = (text: string) => {
      if (!near || near.id === this.player.id) this.showActionbar(text);
      else this.modeTell(near.id, { msg: text, color: o.mood === "bad" ? "#ff8888" : "#ffff55" });
    };
    tellNear(`Lucky block: ${o.message}`);
    this.particles("firework_spark", cx, cy, cz, 20);
    for (const a of o.actions) {
      switch (a.kind) {
        case "drop": for (const s of a.stacks) this.dropItem(cx, cy, cz, s); break;
        case "spawn":
          for (let i = 0; i < a.count; i++) {
            const m = new Mob(a.mob, cx + (Math.random() - 0.5) * 3, y, cz + (Math.random() - 0.5) * 3);
            if (a.baby) m.setBaby();
            if (a.tame && near) { m.owner = near.id; m.ownerName = near.name; m.health = m.maxHealth; m.persistent = true; }
            this.spawn(m);
          }
          break;
        case "tnt": for (let i = 0; i < a.count; i++) this.spawn(new PrimedTnt(cx + (Math.random() - 0.5) * 2, y + 1 + i, cz + (Math.random() - 0.5) * 2, a.fuse)); break;
        case "blocks":
          for (const [dx, dy, dz, id, m] of a.list) {
            const bx = x + dx, by = y + dy, bz = z + dz;
            if (by > 0 && by < WORLD_HEIGHT - 1 && (block(this.world.blockAt(bx, by, bz)).replaceable || this.world.blockAt(bx, by, bz) === B.AIR)) this.world.setBlock(bx, by, bz, id, m, "world");
          }
          break;
        case "effect":
          if (!near || near.id === this.player.id) this.player.addEffect(a.effect, a.seconds, a.amp);
          else this.net?.effectRemote?.(near.id, a.effect, a.seconds, a.amp);
          break;
        case "xp": this.spawnXp(cx, cy, cz, a.amount); break;
        case "fireworks":
          for (let i = 0; i < a.count; i++) this.launchFirework(cx + (Math.random() - 0.5) * 6, cy, cz + (Math.random() - 0.5) * 6, { flight: 1 + (i % 2), bursts: [{ shape: (["small", "large", "star", "burst"] as const)[i % 4], colors: [1 + (i % 7)] }] }, null);
          break;
        case "lightning": this.strikeLightning(cx, y, cz); break;
        case "launch":
          if (!near || near.id === this.player.id) { this.player.body.vy = Math.sqrt(2 * 0.08 * a.height) * 1.1; }
          else this.net?.pushRemote?.(near.id, 0, Math.sqrt(2 * 0.08 * a.height) * 1.1, 0);
          break;
      }
    }
  }

  /** The ordinary terrain generator of the overworld, where there is one: open terrain, or a map pack that keeps it. */
  terrainGenerator(): Generator | null {
    if (this.dimension !== "overworld") return null;
    if (this.generator instanceof MapGenerator) return this.generator.terrain;
    return this.generator instanceof Generator ? this.generator : null;
  }

  /** Whether this world has strongholds: real terrain, and not superflat. */
  hasStrongholds(): boolean {
    return this.meta.type !== "flat" && (!this.meta.map || this.meta.map === "sg_arena" || this.meta.map === "primal_island" || this.meta.map === "dead_zone");
  }

  // ---- vitals (engine/vitals.ts) ------------------------------------------------------------

  /** Which vitals this world keeps, or null for none. */
  vitalsRules(): VitalsRules | null {
    const v = modeDef(this.meta.mode?.id)?.vitals;
    return v && (v.thirst || v.temperature || v.wounds) ? v : null;
  }

  /** Once a second: thirst, temperature, bleeding, sickness, a broken leg — for this player, here or online. */
  private tickVitals(): void {
    const rules = this.vitalsRules();
    const p = this.player;
    if (!rules || p.dead || !p.survivalLike) return;
    // Ashgrove County asks who you were before you take a step: the choice shapes everything after.
    if (rules.knox && !p.survivor && !this.screen && this.spawnReady) { this.setScreen({ kind: "survivor" }); return; }
    const b = p.body, fx = Math.floor(b.x), fy = Math.floor(b.y), fz = Math.floor(b.z);
    const biome = biomeDef(this.world.chunkAt(fx, fz)?.biomes[((fz & 15) << 4) | (fx & 15)] ?? 7);
    // Warmth nearby: the strongest source within four blocks, fading with distance.
    let heat = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const s = HEAT[this.world.blockAt(fx + dx, fy + dy, fz + dz)];
      if (s) heat = Math.max(heat, s * (1 - Math.hypot(dx, dy, dz) / 4.5));
    }
    const insulation = Math.min(1, p.perks.warmth + p.inventory.armor.reduce((t, a) => t + (!a ? 0 : itemDef(a.id)?.armor?.material === "leather" ? 0.25 : 0.12), 0));
    const second = ++this.vitalSecond;
    const events = vitalsSecond(p.vitals, rules, {
      biome: biome.name, dimension: this.dimension, night: this.isNight(), raining: this.rain > 0.5 && this.world.seesSky(fx, fy + 2, fz),
      inWater: b.inWater, y: b.y, heat, insulation, sprinting: p.sprinting,
    }, second);
    for (const e of events) {
      if (e.kind === "hurt") this.hurtLocal(e.amount, e.cause);
      else if (e.kind === "hunger") p.addExhaustion(4 * e.amount);
      else if (e.kind === "message") this.message(e.text, "#aaffaa");
      else if (e.kind === "cough") { this.sound("hurt", null, 0, 0, 0.5, 0.6); this.showActionbar("You cough. You feel feverish."); }
      else if (e.kind === "turn") { this.turn(); return; }
    }
    if (rules.wounds && p.vitals.broken) p.applyEffect("slowness", 3, 1);
    if (rules.temperature && second % 30 === 0) {
      if (p.vitals.temp < 35.2) this.showActionbar("You are freezing — find warmth, or wear hide.");
      else if (p.vitals.temp > 39.3) this.showActionbar("You are overheating — find shade and water.");
    }
    if (rules.thirst && p.vitals.water < 4 && second % 30 === 15) this.showActionbar("You are parched — drink from water, or fill a bottle.");
  }
  private vitalSecond = 0;

  /**
   * The infection has run its course. The player dies of it — and where they
   * fell, one more of the dead gets up, in their clothes, carrying nothing
   * (what they carried falls, or goes to their grave, as any death's does).
   */
  private turn(): void {
    const p = this.player;
    const { x, y, z } = p.body;
    p.vitals.infection = 0;
    this.message("The infection has taken you.", "#ff5555");
    this.hurtLocal(1000, "infection");
    if (!p.dead) return;
    // Only the world's host makes mobs; a guest who turns leaves their things, and the host's county is one short.
    if (this.simulates) this.spawn(new Mob("shambler", x, y, z));
  }

  /** Something was drunk: water back, and with wounds kept, a chance a pond made you ill. */
  drank(item: string, water = waterFrom(item)): void {
    const rules = this.vitalsRules();
    if (!rules) return;
    const v = this.player.vitals;
    if (rules.thirst) v.water = Math.min(20, v.water + water);
    if (rules.wounds && Math.random() < sicknessChance(item) * this.player.perks.sickness && !v.sick) { v.sick = SICKNESS_TICKS; this.message("That water was bad. You feel sick.", "#ffaa55"); }
  }

  /** Something was eaten: juicy food quenches a little; raw or rotten may make you ill. */
  ate(item: string): void {
    const rules = this.vitalsRules();
    if (!rules) return;
    const v = this.player.vitals;
    if (rules.thirst) v.water = Math.min(20, v.water + waterFrom(item));
    if (rules.wounds && Math.random() < sicknessChance(item) * this.player.perks.sickness && !v.sick) { v.sick = SICKNESS_TICKS; this.message("Your stomach turns. You feel sick — antibiotics would help.", "#ffaa55"); }
  }

  /** A bandage, a splint or antibiotics used on yourself. Returns whether it did anything (and so is used up). */
  treat(item: string): boolean {
    const v = this.player.vitals;
    const done = (text: string) => {
      this.message(text, "#aaffaa");
      this.sound("item_frame_add", null, 0, 0, 0.6, 1.2);
      // Someone who has read up on first aid dresses a wound so it heals, not just so it stops.
      if (this.hasRead("first_aid")) this.player.applyEffect("regeneration", 5, 0);
      return true;
    };
    if (item === "bandage") return v.bleeding ? ((v.bleeding = 0), done("The bleeding stops.")) : (this.showActionbar("You are not bleeding."), false);
    if (item === "splint") return v.broken ? ((v.broken = false), (this.player.effects = this.player.effects.filter((e) => e.kind !== "slowness")), done("Your leg is set.")) : (this.showActionbar("Nothing is broken."), false);
    if (item === "antibiotics") return v.sick ? ((v.sick = 0), done("The fever breaks.")) : (this.showActionbar(v.infection ? "Antibiotics will not touch what you have." : "You are not sick."), false);
    // Ashgrove County's medicine cabinet. None of it touches the infection; the reference game's cruelty is that nothing does.
    const p = this.player;
    switch (item) {
      case "sterile_bandage": case "suture_needle":
        return v.bleeding ? ((v.bleeding = 0), done(item === "suture_needle" ? "You stitch the wound shut." : "The clean bandage stops the bleeding.")) : (this.showActionbar("You are not bleeding."), false);
      case "disinfectant": case "alcohol_wipes":
        // Cleaning a wound keeps it from going bad: an ordinary infection, not the county's.
        return v.bleeding || v.sick ? ((v.sick = 0), done("It stings. The wound is clean.")) : (this.showActionbar("You have no wound to clean."), false);
      case "tweezers":
        return v.bleeding ? ((v.bleeding = Math.max(0, v.bleeding - 1)), done("You pick the glass out of the cut.")) : (this.showActionbar("There is nothing to pick out."), false);
      case "painkillers":
        p.applyEffect("regeneration", 12, 0);
        return done(v.infection && knoxStage(v) >= 3 ? "It dulls the fever. It does not stop it." : "The ache fades.");
      case "vitamins":
        p.applyEffect("absorption", 60, 0);
        return done("You feel a little stronger.");
      case "beta_blockers": case "antidepressants":
        // Steadier hands and a clearer head: a little more force behind every swing.
        p.applyEffect("strength", 30, 0);
        return done(item === "beta_blockers" ? "Your heart stops hammering." : "The dread lifts a little.");
      case "sleeping_pills":
        p.applyEffect("slowness", 20, 1);
        return done("You feel heavy and slow. Find a bed.");
      case "first_aid_kit": {
        if (!v.bleeding && !v.broken && p.health >= 20) { this.showActionbar("Nothing needs seeing to."); return false; }
        v.bleeding = 0;
        v.broken = false;
        p.effects = p.effects.filter((e) => e.kind !== "slowness");
        p.applyEffect("regeneration", 8, 1);
        return done("You clean up, bandage and splint what needs it.");
      }
    }
    return false;
  }

  /** A hit or a fall, with wounds kept: a cut that bleeds, a bite that infects, a leg that breaks. */
  private wound(amount: number, source: DamageSource, attacker?: number): void {
    const rules = this.vitalsRules();
    const p = this.player;
    if (!rules?.wounds || !p.survivalLike || p.dead) return;
    const v = p.vitals;
    if (source === "fall" && amount >= BREAK_FALL - 3 && !v.broken) {
      v.broken = true;
      this.message("You broke your leg. A splint (two sticks and string) will set it.", "#ff8888");
    }
    if (source === "mob" || source === "arrow" || source === "player") {
      const mob = attacker !== undefined ? this.entities.get(attacker) : undefined;
      const infected = mob instanceof Mob && isInfected(mob.kind);
      if (rules.knox && infected && source === "mob") {
        // The county's rule: every blow from the dead is a scratch, a tear or a bite, and any of them may carry it.
        const w = knoxWound(Math.random, p.perks.infection);
        if (w.bleeds && v.bleeding < 3) v.bleeding++;
        if (w.infects && !v.infection) v.infection = 1;
        this.message(w.wound === "bite"
          ? "You've been bitten. You know what that means."
          : w.wound === "laceration" ? "It tore your arm open. Bandage it — and hope." : "It scratched you. Clean it, and hope.", w.wound === "bite" ? "#ff5555" : "#ff8888");
        return;
      }
      if (Math.random() < (infected ? 0.35 : 0.18) && v.bleeding < 3) {
        v.bleeding++;
        this.message("You're bleeding! A bandage will stop it.", "#ff5555");
      }
      if (infected && !v.sick && Math.random() < 0.08) { v.sick = SICKNESS_TICKS; this.message("The bite burns. You feel feverish — antibiotics would help.", "#ffaa55"); }
    }
  }

  /** What the crosshair rests on, if it is one of Primal's creatures: for the line under the crosshair. */
  private inspectLine(): string | null {
    const e = this.actions?.targetEntity();
    if (!(e instanceof Mob) || !isDino(e.kind) || e.dying) return null;
    const c = CREATURES[e.kind];
    const parts = [`${c.name} · Lv ${e.level}`];
    if (e.owner) parts.push(e.ownerName ? `${e.ownerName}'s` : "Tamed", e.saddled ? "Saddled" : c.saddle ? "No saddle" : "", e.sitting ? "Waiting" : "Following");
    else {
      parts.push(`Torpor ${Math.round(e.torpor)}/${Math.round(maxTorpor(e.kind, e.level))}`);
      if (e.unconscious) parts.push(`Taming ${Math.floor(e.taming * 100)}%`, `Effectiveness ${Math.round(e.tameEffect * 100)}%`);
      // Ascended tells you what a creature likes; Evolved leaves you to find out.
      if (modeDef(this.meta.mode?.id)?.primal === "ascended") parts.push(`Eats ${favouriteFoods(e.kind).join(", ")}`);
    }
    return parts.filter(Boolean).join(" · ");
  }

  // ---- the infected (Dead Zone) ------------------------------------------------------------

  /** A blood moon is up (the Blood Moon mode): the infected dig, and the sky runs red. */
  bloodMoon = false;

  /**
   * Something loud at x, y, z — a gunshot, an explosion, a sprint — that the
   * infected within `radius` hear: they turn toward whoever made it, and
   * track them for a while without needing to see them. A guest's noise goes
   * to the host, whose infected they are.
   */
  makeNoise(x: number, y: number, z: number, radius: number, by: string | null): void {
    if (!this.simulates) { this.net?.noise?.(x, y, z, radius); return; }
    // In a city a shot or a blast scatters everyone who hears it, and a shot is the police's business.
    if (radius >= 24 && this.cityNow()) {
      for (const e of this.entities.values()) {
        if (!(e instanceof Mob) || e.kind !== "citizen" || e.dying || Math.hypot(e.x - x, e.z - z) > radius / 2) continue;
        e.panic = Math.max(e.panic, 140);
        e.scare = { x, z };
      }
      if (by && this.meta.mode?.started) this.mode?.onNoise(by, x, z, radius);
    }
    const who = by ?? this.playerRefs().sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0]?.id ?? null;
    if (!who) return;
    for (const e of this.entities.values()) {
      if (!(e instanceof Mob) || !e.infected || e.dying) continue;
      if (Math.hypot(e.x - x, e.y - y, e.z - z) > radius) continue;
      if (!e.targetId || e.alert <= 0) e.targetId = who;
      e.alert = Math.max(e.alert, 300);
    }
  }

  /** Dead Zone: a group of the infected, day or night, out of sight but not far. */
  private trySpawnInfected(origin: PlayerRef): void {
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 28;
    const x = Math.floor(origin.x + Math.cos(a) * r), z = Math.floor(origin.z + Math.sin(a) * r);
    if (!this.world.chunkAt(x, z)) return;
    const top = this.world.topSolid(x, z);
    if (top < 1 || !block(this.world.blockAt(x, top, z)).solid || isFluid(this.world.blockAt(x, top + 1, z))) return;
    if (block(this.world.blockAt(x, top + 1, z)).solid || block(this.world.blockAt(x, top + 2, z)).solid) return;
    // Fewer by day than by night, as the dark brings them out.
    if (!this.isNight() && Math.random() < 0.4) return;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.spawn(new Mob(pickInfected(Math.random), x + 0.5 + (Math.random() - 0.5) * 3, top + 1, z + 0.5 + (Math.random() - 0.5) * 3));
  }

  /**
   * Ashgrove County: the dead where people were. They come up at street level
   * and on the ground floor of houses — never on a roof, which is where
   * topSolid would put them in a town — thick in town and thin outside it.
   */
  private trySpawnCountyDead(origin: PlayerRef, county: County): void {
    const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 30;
    const x = Math.floor(origin.x + Math.cos(a) * r), z = Math.floor(origin.z + Math.sin(a) * r);
    if (!this.world.chunkAt(x, z)) return;
    const inTown = !!county.townAt(x, z);
    if (!inTown && Math.random() < 0.5) return;
    if (!this.isNight() && Math.random() < 0.3) return;
    const clear = (y: number) => !block(this.world.blockAt(x, y, z)).solid && !isFluid(this.world.blockAt(x, y, z));
    let y = -1;
    for (let yy = GROUND + 1; yy <= GROUND + 3 && y < 0; yy++) if (block(this.world.blockAt(x, yy - 1, z)).solid && clear(yy) && clear(yy + 1)) y = yy;
    if (y < 0) return;
    const n = countyGroup(inTown, Math.random);
    for (let i = 0; i < n; i++) {
      const sx = x + 0.5 + (Math.random() - 0.5) * 2, sz = z + 0.5 + (Math.random() - 0.5) * 2;
      // Each of a group stands somewhere it fits, or does not come at all: no one wedged into a wall.
      if (block(this.world.blockAt(Math.floor(sx), y, Math.floor(sz))).solid || block(this.world.blockAt(Math.floor(sx), y + 1, Math.floor(sz))).solid) continue;
      this.spawn(new Mob(pickCountyInfected(Math.random), sx, y, sz));
    }
  }

  /** Whether this world asks for engrams (Primal). */
  engramsOn(): boolean {
    return !!modeDef(this.meta.mode?.id)?.engrams;
  }

  /** The engram an item's recipe waits on for this player, or null when they may make it. */
  engramLocking(item: string): Engram | null {
    if (!this.engramsOn() || this.player.gameMode === "creative") return null;
    const e = engramFor(item);
    return e && !this.player.engrams.has(e.id) ? e : null;
  }

  /** Learns an engram, if this player's level and points allow; says why not otherwise. */
  learnEngram(id: string): string | null {
    const e = ENGRAMS.find((x) => x.id === id);
    if (!e) return "No such engram.";
    const ok = canLearn(e, this.player.xpLevel, this.player.engrams);
    if (ok !== true) return ok;
    this.player.engrams.add(e.id);
    this.sound("levelup", null, 0, 0, 0.5, 1.4);
    this.message(`Learned the ${e.name} engram.`, "#55ffff");
    this.bumpInv();
    return null;
  }

  /** Cheats: the world allows them, or the player is in creative. */
  cheatsAllowed(): boolean {
    return this.meta.cheats || this.player.gameMode === "creative";
  }

  /**
   * Moves the player within this dimension — to a waypoint, a waystone, a
   * spot on the map — and lands them once the ground there has loaded: beside
   * `y` when it is known, else on the surface. Only this player goes.
   */
  travelTo(x: number, y: number | null, z: number): void {
    const p = this.player, b = p.body;
    b.x = x; b.z = z; b.y = y ?? WORLD_HEIGHT - 2;
    b.vx = b.vy = b.vz = 0;
    b.fallDistance = 0;
    p.prevX = b.x; p.prevY = b.y; p.prevZ = b.z;
    this.arrival = y === null ? { kind: "spawn", x, y: b.y, z, solo: true } : { kind: "exact", x, y, z, solo: true };
    this.spawnPlaced = false;
    this.loadingSince = performance.now();
  }

  // ---- space -------------------------------------------------------------------------------------

  /**
   * Starts a launch from where the player stands: a countdown, then up — into
   * orbit 400 km above the same spot on Earth (space/session.ts places this
   * world on the globe). Only from the overworld: the Nether and the End are
   * not under the sky.
   */
  launch(): void {
    if (this.space || this.launchCountdown !== null) return;
    if (this.dimension !== "overworld") { this.showActionbar("There is no sky to launch into here."); return; }
    if (this.player.dead) return;
    this.launchCountdown = 4;
    this.sound("countdown", null, 0, 0, 0.9, 0.8);
    this.showTitle("T minus 3", "Launch sequence started");
  }

  /** The countdown's seconds: fire and smoke under the ship, then the climb. */
  private countdown(dt: number): void {
    const before = this.launchCountdown!;
    const t = Math.max(0, before - dt);
    this.launchCountdown = t;
    const b = this.player.body;
    for (const mark of [3, 2, 1]) if (before > mark && t <= mark) { this.showTitle(mark === 1 ? "Liftoff!" : `T minus ${mark - 1}`, mark === 1 ? "" : "Launch sequence started"); this.sound("countdown", null, 0, 0, 0.9, mark === 1 ? 1.4 : 0.8); }
    if (t < 3) {
      this.renderer.particles.emit("smoke", b.x + (Math.random() - 0.5) * 2, b.y, b.z + (Math.random() - 0.5) * 2, 3, 0);
      this.renderer.particles.emit("flame", b.x + (Math.random() - 0.5), b.y, b.z + (Math.random() - 0.5), 2, 0);
      this.hurtTilt = Math.min(0.4, 0.1 + (3 - t) * 0.1);
    }
    if (before > 1 && t <= 1) this.sound("firework_launch", null, 0, 0, 1, 0.5);
    if (t <= 0) {
      this.launchCountdown = null;
      const { lat, lon } = blockToLatLon(this.meta.seed, b.x, b.z, this.meta.place);
      this.spaceView ??= new SpaceView(this.renderer.renderer);
      const c = this.renderer.canvas;
      this.spaceView.resize(c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight);
      // The trip starts on the world's own date, so the sky out there is the one the world was under.
      this.space = new SpaceSession(this.meta.seed, { lat, lon }, this.realSky() ? this.skyDate() : jdFromMs(Date.now()), this.meta.place, this.spacePhysics);
      this.space.say(`In orbit, 400 km above ${latLonText(lat, lon)}`);
      this.setScreen({ kind: "space" });
      this.advance({ kind: "space" });
    }
  }

  /** One frame in space: the session moves on, and the space view is drawn instead of the world. */
  private renderSpace(dt: number): void {
    const s = this.space!;
    // Paused alone, the clock stops; online, the Solar System goes on without the menu.
    const paused = this.screen?.kind === "pause" && !this.net;
    if (!paused) s.update(dt);
    if (s.galaxy) {
      // The map is drawn instead of the Solar System; the ship flies on underneath it.
      s.galaxy.tick();
      const c = this.renderer.canvas;
      this.galaxyView ??= new GalaxyView(this.renderer.renderer);
      this.galaxyView.resize(c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight);
      this.galaxyView.render(s.galaxy);
    } else this.spaceView!.render(s.frame(paused ? 0 : dt));
    // Down under a parachute (real physics) or through the arcade's re-entry: into the world where the ship came down.
    if (s.landing === 0 || s.ship.landed) this.land();
  }

  /** The overlay the galaxy map draws its names and scale on. */
  setGalaxyOverlay(canvas: HTMLCanvasElement | null): void {
    this.galaxyView?.setOverlay(canvas);
    if (canvas && !this.galaxyView) {
      this.galaxyView = new GalaxyView(this.renderer.renderer);
      this.galaxyView.setOverlay(canvas);
    }
  }

  /** The star under a point of the galaxy map. */
  galaxyPick(x: number, y: number): Star | null {
    const map = this.space?.galaxy;
    return map && this.galaxyView ? this.galaxyView.pick(map, x, y) : null;
  }

  /** The overlay the space view draws its orbits and brackets on. */
  setSpaceOverlay(canvas: HTMLCanvasElement | null): void {
    this.spaceView?.setOverlay(canvas);
  }

  /** The body under a point of the screen, for clicks in space. */
  spacePick(x: number, y: number): string | null {
    return this.spaceView?.pick(x, y) ?? null;
  }

  spaceDirection(x: number, y: number): [number, number, number] | null {
    return this.spaceView?.directionAt(x, y) ?? null;
  }

  /**
   * Comes down wherever on Earth the ship is — which is somewhere in this
   * world — and, playing alone or hosting, sets the day to the sun's hour
   * there. `home` lands at the launch site instead.
   */
  land(home = false): void {
    const s = this.space;
    if (!s) return;
    const site = home ? null : s.landingBlock();
    const b = this.player.body;
    const x = site ? site.x + 0.5 : b.x, z = site ? site.z + 0.5 : b.z;
    const where = site ? latLonText(site.lat, site.lon) : "the launch site";
    if (this.simulates && site && this.realSky()) {
      // The world's sky picks up where the trip's left off, however long it ran and however fast.
      this.setSkyDate(s.jd, site.lon);
    } else if (this.simulates && site) {
      // Noon is 6000 ticks into the day; each hour of solar time is a thousand ticks.
      const hours = s.solarHours(site.lon);
      this.time = Math.floor(this.time / 24000) * 24000 + Math.round(((hours - 6 + 24) % 24) * 1000);
    }
    this.space = null;
    this.setScreen(null);
    this.travelTo(x, null, z);
    this.showTitle("Welcome home", `Landed at ${where}`);
    this.sound("portal_travel", null, 0, 0, 0.6, 1.3);
  }

  /** Chunks edited since they were last painted onto the map, a few repainted each second. */
  private readonly mapDirty = new Set<number>();

  private repaintMap(): void {
    if (!this.modOn("minimap")) { this.mapDirty.clear(); return; }
    let n = 0;
    for (const id of this.mapDirty) {
      this.mapDirty.delete(id);
      const c = this.world.chunks.get(id);
      if (c) this.worldMap.paintChunk(this.dimension, c);
      if (++n >= 6) break;
    }
  }

  /** The host (or a single player) switches mod-inspired features for this world; guests are told. */
  setDisabledMods(list: string[]): void {
    if (this.role === "guest") return;
    this.meta.disabledMods = [...new Set(list)];
    this.net?.modsChanged?.();
    this.bumpInv();
    this.store.set({ minimap: this.modOn("minimap") });
  }

  /** Whether a mod-inspired feature (engine/mods.ts) is on in this world. */
  modOn(id: string): boolean {
    return modEnabled(this.meta.disabledMods, id);
  }

  /** The overworld's season, or null where there are none (other dimensions, or the world switched them off). */
  season(): Season | null {
    return this.dimension === "overworld" && this.modOn("seasons") ? seasonAt(this.time).season : null;
  }

  /**
   * The moving lights near the camera, nearest first: what the player and
   * others hold, dropped glowing items, burning mobs, blazes, magma cubes,
   * rockets and fireballs — as [x, y, z, level].
   */
  dynamicLights(cx: number, cy: number, cz: number): [number, number, number, number][] {
    if (!this.modOn("dynamic_lights")) return [];
    const out: [number, number, number, number][] = [];
    const p = this.player;
    const held = Math.max(itemLight(p.inventory.held?.id ?? -1), itemLight(p.inventory.offhand?.id ?? -1));
    if (held > 0 && !p.dead) out.push([p.body.x, p.body.y + 1.2, p.body.z, held]);
    for (const r of this.remote.values()) {
      const l = r.held !== null ? itemLight(r.held) : 0;
      if (l > 0 && !r.dead) out.push([r.x, r.y + 1.2, r.z, l]);
    }
    for (const e of this.entities.values()) {
      if (e.removed) continue;
      let l = 0;
      if (e instanceof ItemEntity) l = itemLight(e.stack.id) - 1;
      else if (e instanceof FireworkRocket) l = 12;
      else if (e instanceof Projectile) l = e.kind === "fireball" || e.kind === "dragon_fireball" ? 13 : e.kind === "small_fireball" ? 11 : e.fire ? 8 : 0;
      else if (e instanceof Mob) l = e.kind === "blaze" ? 10 : e.kind === "magma_cube" ? 8 : e.fireTicks > 0 ? 12 : 0;
      else if (e instanceof PrimedTnt) l = 8;
      if (l > 0) out.push([e.x, e.y + e.body.height / 2, e.z, l]);
    }
    if (out.length <= MAX_DYNAMIC_LIGHTS) return out;
    const d = (a: number[]) => (a[0] - cx) ** 2 + (a[1] - cy) ** 2 + (a[2] - cz) ** 2;
    return out.sort((a, b) => d(a) - d(b)).slice(0, MAX_DYNAMIC_LIGHTS);
  }

  /** Hangs an item frame on a face of a block (the host's half); false when the spot is taken or unsupported. */
  placeFrame(face: number, x: number, y: number, z: number): boolean {
    const [dx, dy, dz] = FACE_DIRS[face];
    if (block(this.world.blockAt(x, y, z)).solid || !block(this.world.blockAt(x - dx, y - dy, z - dz)).solid) return false;
    for (const e of this.entities.values()) if (e instanceof ItemFrame && !e.removed && e.face === face && e.bx === x && e.by === y && e.bz === z) return false;
    this.spawn(new ItemFrame(face, x, y, z));
    this.sound("item_frame_place", x + 0.5, y + 0.5, z + 0.5, 0.8);
    return true;
  }

  /** Puts a vehicle into the world (the host's half of placing one). */
  placeVehicle(kind: string, x: number, y: number, z: number, yaw: number, wood: number): Vehicle | null {
    let v: Vehicle | null = null;
    if (kind === "boat") v = new Boat(x, y, z, wood);
    else if (kind === "minecart" || kind === "tnt_minecart") v = new Minecart(kind, x, y, z);
    else if (kind === "car") {
      // Only bought cars are placed this way, and only in a city.
      const car = carFromCode(wood);
      if (!car || !this.cityNow()) return null;
      const c = new Car(x, y, z, car.model, car.color);
      c.ambient = false;
      v = c;
    }
    if (!v) return null;
    v.yaw = yaw;
    v.prevYaw = yaw;
    this.spawn(v);
    return v;
  }

  private guestTick(): void {
    this.advanceClock();
    const own = this.ridden();
    if (own) {
      // The guest drives its own vehicle here, and tells the host.
      own.tick(this.ctx);
      this.net?.vehiclePose?.(own);
    }
    // Between host snapshots, carry entities along their last velocity.
    for (const e of this.entities.values()) {
      if (e === own) continue;
      const b = e.body;
      b.x += b.vx; b.y += b.vy * 0.5; b.z += b.vz;
      e.walkDist += Math.hypot(b.vx, b.vz);
    }
  }

  private weatherTick(): void {
    const w = this.meta.weather;
    if (this.meta.rules.doWeatherCycle) {
      if (--w.rainTimer <= 0) {
        const raining = w.rain > 0.5;
        w.rain = raining ? 0 : 1;
        w.rainTimer = raining ? 12000 + Math.floor(Math.random() * 168000) : 12000 + Math.floor(Math.random() * 12000);
      }
      if (--w.thunderTimer <= 0) {
        const thundering = w.thunder > 0.5;
        w.thunder = thundering ? 0 : 1;
        w.thunderTimer = thundering ? 12000 + Math.floor(Math.random() * 168000) : 3600 + Math.floor(Math.random() * 12000);
      }
    }
    const targetRain = w.rain, targetThunder = w.rain > 0.5 ? w.thunder : 0;
    this.rain += Math.sign(targetRain - this.rain) * Math.min(0.01, Math.abs(targetRain - this.rain));
    this.thunder += Math.sign(targetThunder - this.thunder) * Math.min(0.01, Math.abs(targetThunder - this.thunder));
    const sky = DIMENSION_INFO[this.dimension].hasSky;
    this.audio.setRain(sky ? this.rain : 0);
    if (sky && this.thunder > 0.9 && Math.random() < 1 / 400) {
      this.lightning = 1;
      const delay = 200 + Math.random() * 1500;
      setTimeout(() => this.sound("thunder", this.player.body.x + (Math.random() - 0.5) * 60, this.player.body.y + 20, this.player.body.z + (Math.random() - 0.5) * 60, 1, 0.8), delay);
      this.net?.effect("explosion", ["lightning"]);
    }
  }

  private spawnMobs(): void {
    const refs = this.playerRefs();
    if (!refs.length || !this.meta.rules.doMobSpawning) return;
    let hostile = 0, passive = 0, fauna = 0;
    for (const e of this.entities.values()) {
      // Villagers and golems belong to their village: they neither count against animals nor despawn.
      if (!(e instanceof Mob) || e.kind === "villager" || e.kind === "iron_golem" || e.kind === "ender_dragon") continue;
      // A wild critter wanders off once nobody is near; one in a battle, a partner, or a trainer, never.
      if (e.kind === "critter" || e.kind === "trainer") {
        if (e.kind === "trainer" || e.persistent || e.battle) continue;
        fauna++;
        const nearest = Math.min(...refs.map((r) => Math.hypot(r.x - e.x, r.z - e.z)));
        if (nearest > 96) e.removed = true;
        continue;
      }
      // Primal's creatures roam far: a wild one goes only once nobody is anywhere near (or, a hunter, in peaceful).
      if (isDino(e.kind)) {
        fauna++;
        if (e.persistent) continue;
        const nearest = Math.min(...refs.map((r) => Math.hypot(r.x - e.x, r.z - e.z)));
        if (nearest > 112 || (this.meta.difficulty === 0 && e.spec.hostile)) e.removed = true;
        continue;
      }
      if (e.spec.hostile) {
        hostile++;
        // Despawn monsters nobody is near; peaceful removes them all.
        const nearest = Math.min(...refs.map((r) => Math.hypot(r.x - e.x, r.z - e.z)));
        if (this.meta.difficulty === 0 || nearest > 128 || (nearest > 32 && Math.random() < 1 / 40)) e.removed = true;
      } else passive++;
    }
    const origin = refs[Math.floor(Math.random() * refs.length)];
    // A Dead Zone world's monsters are the infected, by day as by night; its animals are the usual.
    if (modeDef(this.meta.mode?.id)?.fauna === "infected" && this.dimension === "overworld") {
      const county = this.county();
      if (county) {
        const cap = countyInfectedCap(!!county.townAt(Math.floor(origin.x), Math.floor(origin.z)), this.isNight()) * refs.length;
        if (this.meta.difficulty > 0 && hostile < cap) for (let attempt = 0; attempt < 3; attempt++) this.trySpawnCountyDead(origin, county);
      } else if (this.meta.difficulty > 0 && hostile < MAX_INFECTED * refs.length) for (let attempt = 0; attempt < 3; attempt++) this.trySpawnInfected(origin);
      // The county's livestock are on its farms and in its fields, not wandering the streets of a town.
      if (county?.townAt(Math.floor(origin.x), Math.floor(origin.z))) return;
      if (passive < MAX_PASSIVE * refs.length && (this.tickCount % 400 === 0 || this.tickCount < 200)) for (let attempt = 0; attempt < 4; attempt++) this.trySpawn(origin, false);
      return;
    }
    // A critter world's wilds hold critters, and its farm animals; no monsters come out to interrupt a battle.
    if (modeDef(this.meta.mode?.id)?.fauna === "critters" && this.dimension === "overworld") {
      this.critters.trySpawn(origin, fauna, refs.length);
      if (passive < MAX_PASSIVE * refs.length && (this.tickCount % 400 === 0 || this.tickCount < 200)) for (let attempt = 0; attempt < 4; attempt++) this.trySpawn(origin, false);
      return;
    }
    // A Primal world's wilds hold its creatures, not the overworld's usual night monsters and farm animals.
    if (modeDef(this.meta.mode?.id)?.fauna === "primal" && this.dimension === "overworld") {
      if (fauna < MAX_FAUNA * refs.length) for (let attempt = 0; attempt < 3; attempt++) this.trySpawnCreatures(origin);
      return;
    }
    if (this.dimension !== "overworld") {
      // Elsewhere, spawning ignores light and follows each biome's list; there are no animals.
      if (hostile < (MAX_HOSTILE + 6) * refs.length) for (let attempt = 0; attempt < 3; attempt++) this.trySpawnElsewhere(origin);
      return;
    }
    if (this.meta.difficulty > 0 && hostile < MAX_HOSTILE * refs.length) {
      for (let attempt = 0; attempt < 3; attempt++) this.trySpawn(origin, true);
    }
    if (passive < MAX_PASSIVE * refs.length && (this.tickCount % 400 === 0 || this.tickCount < 200)) {
      for (let attempt = 0; attempt < 4; attempt++) this.trySpawn(origin, false);
    }
  }

  /** Primal: a group of the biome's creatures, out of sight but not far, on open ground (flyers above it). */
  private trySpawnCreatures(origin: PlayerRef): void {
    const a = Math.random() * Math.PI * 2, r = 28 + Math.random() * 36;
    const x = Math.floor(origin.x + Math.cos(a) * r), z = Math.floor(origin.z + Math.sin(a) * r);
    const chunk = this.world.chunkAt(x, z);
    if (!chunk) return;
    const top = this.world.topSolid(x, z);
    if (top < 1) return;
    const below = this.world.blockAt(x, top, z);
    if (!block(below).solid || isFluid(this.world.blockAt(x, top + 1, z))) return;
    const biome = biomeDef(chunk.biomes[((z & 15) << 4) | (x & 15)]);
    const pick = pickCreatures(biome.name, Math.random, modeDef(this.meta.mode?.id)?.primal === "ascended");
    if (!pick) return;
    const flyer = MOB_SPECS[pick.kind].flies;
    for (let i = 0; i < pick.count; i++) {
      const m = new Mob(pick.kind, x + 0.5 + (Math.random() - 0.5) * 4, top + 1 + (flyer ? 10 + i * 2 : 0), z + 0.5 + (Math.random() - 0.5) * 4);
      // A group shares a rough level, as a pack or a herd does.
      if (i > 0) m.level = Math.max(5, m.level);
      m.health = m.maxHealth;
      this.spawn(m);
    }
  }

  private trySpawn(origin: PlayerRef, hostile: boolean): void {
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 24;
    const x = Math.floor(origin.x + Math.cos(a) * r), z = Math.floor(origin.z + Math.sin(a) * r);
    const chunk = this.world.chunkAt(x, z);
    if (!chunk) return;
    const top = this.world.topSolid(x, z);
    if (top < 1) return;
    const daylight = this.daylight();
    let y: number;
    if (hostile) {
      // Anywhere dark: the surface at night, or a cave by day.
      y = Math.random() < 0.5 ? top + 1 : 1 + Math.floor(Math.random() * top);
    } else y = top + 1;
    const below = this.world.blockAt(x, y - 1, z);
    if (!block(below).opaque || block(this.world.blockAt(x, y, z)).solid || block(this.world.blockAt(x, y + 1, z)).solid) return;
    if (isFluid(this.world.blockAt(x, y, z))) return;
    const l = this.world.getLight(x, y, z);
    if (l < 0) return;
    const sky = (l >> 4) * daylight, blockLight = l & 15;
    const biome = biomeDef(chunk.biomes[((z & 15) << 4) | (x & 15)]);
    if (hostile) {
      // Slime chunks breed slimes deep underground whatever the light, which is what makes them findable.
      if (y < 40 && isSlimeChunk(this.meta.seed, x >> 4, z >> 4) && Math.random() < 0.3) {
        this.spawn(new Mob("slime", x + 0.5, y, z + 0.5));
        return;
      }
      if (blockLight > 0 || sky >= 8) return;
      // Swamps add slimes to the night's surface spawns.
      const swamp = biome.id === BiomeId.Swamp && y > SEA_LEVEL - 4;
      const kinds: MobKind[] = swamp ? ["zombie", "skeleton", "creeper", "spider", "slime", "slime"] : ["zombie", "skeleton", "creeper", "spider"];
      // One spawn in twelve is an enderman, alone or in a pair: rarer than the rest, as in the original.
      const kind = Math.random() < 1 / 12 ? "enderman" : kinds[Math.floor(Math.random() * kinds.length)];
      if (kind === "enderman" && (block(this.world.blockAt(x, y + 2, z)).solid)) return;
      const group = kind === "enderman" ? 1 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < group; i++) this.spawn(new Mob(kind, x + 0.5 + (i % 2), y, z + 0.5 + Math.floor(i / 2)));
    } else {
      if (below !== B.GRASS || (l >> 4) < 9) return;
      // A share of the day's animals are wild ones, where the biome keeps any (engine/wildlife.ts).
      const wild = this.modOn("wildlife") && Math.random() < 0.4 ? pickWildlife(biome.name, Math.random) : null;
      if (wild) {
        const n = wild.min + Math.floor(Math.random() * (wild.max - wild.min + 1));
        for (let i = 0; i < n; i++) {
          const m = new Mob(wild.kind, x + 0.5 + (Math.random() - 0.5) * 3, y, z + 0.5 + (Math.random() - 0.5) * 3);
          if (wild.kind !== "wolf" && Math.random() < 0.15) m.setBaby();
          this.spawn(m);
        }
        return;
      }
      if (!biome.passive.length) return;
      const kind = biome.passive[Math.floor(Math.random() * biome.passive.length)] as MobKind;
      if (!MOB_KINDS.includes(kind)) return;
      const group = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < group; i++) {
        const m = new Mob(kind, x + 0.5 + (Math.random() - 0.5) * 3, y, z + 0.5 + (Math.random() - 0.5) * 3);
        if (Math.random() < 0.1) m.setBaby();
        this.spawn(m);
      }
    }
  }

  /**
   * A spawn attempt outside the overworld: a floor 24 to 48 blocks out, a mob
   * from the biome's list — or, inside a fortress, from the fortress's own.
   */
  private trySpawnElsewhere(origin: PlayerRef): void {
    const w = this.world;
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 24;
    const x = Math.floor(origin.x + Math.cos(a) * r), z = Math.floor(origin.z + Math.sin(a) * r);
    const chunk = w.chunkAt(x, z);
    if (!chunk) return;
    // A floor: somewhere solid (not lava) with two blocks of air above it, found by walking down.
    let y = Math.floor(origin.y + (Math.random() - 0.5) * 48);
    y = Math.max(2, Math.min(WORLD_HEIGHT - 3, y));
    while (y > 1 && !block(w.blockAt(x, y - 1, z)).solid) y--;
    if (y <= 1 || block(w.blockAt(x, y, z)).solid || block(w.blockAt(x, y + 1, z)).solid || isFluid(w.blockAt(x, y, z))) return;
    const biome = biomeDef(chunk.biomes[((z & 15) << 4) | (x & 15)]);
    const fortress = this.dimension === "nether" && inFortress(this.meta.seed, x, y, z);
    const table: [string, number][] = fortress
      ? [["blaze", 10], ["wither_skeleton", 8], ["zombified_piglin", 5], ["skeleton", 2], ["magma_cube", 3]]
      : biome.spawns ?? [];
    const kinds = table.filter(([k]) => MOB_KINDS.includes(k as MobKind) && (this.meta.difficulty > 0 || !new Mob(k as MobKind, 0, 0, 0).spec.hostile));
    if (!kinds.length) return;
    let roll = Math.random() * kinds.reduce((t, [, wgt]) => t + wgt, 0);
    let kind = kinds[0][0] as MobKind;
    for (const [k, wgt] of kinds) { roll -= wgt; if (roll < 0) { kind = k as MobKind; break; } }
    // Ghasts need room to float: a clear column well above the floor.
    if (kind === "ghast") {
      y += 3;
      for (let dy = 0; dy < 5; dy++) if (block(w.blockAt(x, y + dy, z)).solid) return;
    }
    const group = kind === "ghast" || kind === "blaze" ? 1 : 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < group; i++) {
      const gx = x + (i % 2), gz = z + Math.floor(i / 2);
      if (block(w.blockAt(gx, y, gz)).solid || block(w.blockAt(gx, y + 1, gz)).solid) continue;
      // An enderman stands three blocks tall.
      if (kind === "enderman" && block(w.blockAt(gx, y + 2, gz)).solid) continue;
      this.spawn(new Mob(kind, gx + 0.5, y, gz + 0.5));
    }
  }

  private sleepTick(): void {
    const sleepers = (this.player.sleeping ? 1 : 0) + [...this.remote.values()].filter((r) => r.sleeping).length;
    const total = 1 + this.remote.size;
    if (sleepers > 0 && sleepers === total) {
      this.sleepCounter++;
      if (this.sleepCounter >= 100) {
        this.time = this.sunriseFrom(Math.ceil(this.time / DAY_TICKS) * DAY_TICKS);
        this.meta.weather.rain = 0; this.meta.weather.thunder = 0;
        this.rain = 0; this.thunder = 0;
        if (this.player.sleeping) this.advance({ kind: "sleep" });
        for (const r of this.remote.values()) if (r.sleeping) this.net?.advanceRemote?.(r.id, { kind: "sleep" });
        this.actions.wakeUp();
        this.sleepCounter = 0;
      }
    } else this.sleepCounter = 0;
  }

  // ---- saving ------------------------------------------------------------------------------

  async saveNow(): Promise<void> {
    if (this.role === "guest" || this.savingNow) return;
    this.savingNow = true;
    this.store.set({ saving: true });
    try {
      const chunks: ChunkData[] = [];
      for (const id of this.dirtySave) {
        const c = this.world.chunks.get(id);
        if (c) chunks.push(this.chunkData(c));
      }
      this.dirtySave.clear();
      await this.saves.putChunks(this.meta.id, chunks, this.dimension);
      const meta = this.meta;
      meta.time = this.time;
      meta.lastPlayed = Date.now();
      meta.playTime = this.playTimeBase + (performance.now() - this.startedAt) / 1000;
      meta.player = this.player.toJSON();
      meta.dimension = this.dimension;
      meta.entities = this.persistentEntities();
      await this.saves.putWorld(meta);
      // The map is kept apart from the world (mapStore.ts): failing to keep it costs the map, never the save.
      await this.saves.maps.save(meta.id, this.worldMap.takeDirty()).catch(() => {});
    } finally {
      this.savingNow = false;
      this.store.set({ saving: false });
    }
  }

  async thumbnail(): Promise<void> {
    try {
      const src = this.renderer.screenshot("image/jpeg", 0.8);
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src; });
      const c = document.createElement("canvas");
      c.width = 160; c.height = 90;
      c.getContext("2d")!.drawImage(img, 0, 0, 160, 90);
      this.meta.thumbnail = c.toDataURL("image/jpeg", 0.7);
    } catch {
      /* a missing thumbnail is cosmetic */
    }
  }

  // ---- HUD ------------------------------------------------------------------------------------

  private hudSnapshot(): Hud {
    const p = this.player;
    const inv = p.inventory;
    if (inv.selected !== this.lastSelected || (inv.held?.id ?? null) !== this.lastHeldId) {
      this.lastSelected = inv.selected;
      this.lastHeldId = inv.held?.id ?? null;
      this.heldNameAt = performance.now();
    }
    const b = p.body;
    const ready = this.streamer.readiness(Math.floor(b.x) >> 4, Math.floor(b.z) >> 4, Math.min(2, this.settings.renderDistance), (id) => this.renderer.chunks.has(id));
    const arriving = this.arrival !== null || (this.dimension !== "overworld" && this.loadingSince > this.startedAt);
    const loading = ready.done < ready.total || !this.spawnPlaced
      ? {
        done: ready.done, total: ready.total,
        message: arriving ? (this.dimension === "overworld" ? "Returning to the Overworld" : `Entering ${DIMENSION_INFO[this.dimension].title}`)
          : this.role === "guest" ? "Joining world" : "Building terrain",
      }
      : null;
    const prev = this.store?.get();
    return {
      health: p.health,
      food: p.food,
      ...this.hungerPreview(),
      air: p.air,
      armor: p.armor,
      xpLevel: p.xpLevel,
      xpProgress: p.xpProgress,
      absorption: p.hasEffect("absorption") ? 4 : 0,
      hotbar: inv.slots.slice(0, 9),
      selected: inv.selected,
      heldName: inv.held ? inv.held.name ?? itemDef(inv.held.id)?.displayName ?? "" : "",
      effects: p.effects.map((e) => ({ kind: e.kind, amp: e.amp, seconds: Math.ceil(e.ticks / 20) })),
      heldNameAt: this.heldNameAt,
      gameMode: p.gameMode,
      hardcore: this.meta.hardcore,
      screen: this.screen,
      chat: this.chatLines.slice(-50),
      dead: p.dead,
      deathMessage: p.deathMessage,
      loading: loading && performance.now() - this.loadingSince < 60000 ? loading : null,
      portal: this.portalTimer > 0 ? Math.min(1, this.portalTimer / 80) : 0,
      attackCharge: p.attackStrength(),
      breaking: this.actions?.breakProgress() ?? 0,
      hurtAt: this.lastHurtAt,
      sleeping: p.sleeping ? Math.min(1, p.sleepTicks / 100) : 0,
      hudHidden: this.hudHidden,
      space: !!this.space,
      launch: this.launchCountdown,
      debug: this.debug ? this.debugLines() : null,
      coords: this.settings.showCoordinates ? `${Math.floor(b.x)}, ${Math.floor(b.y)}, ${Math.floor(b.z)}` : null,
      fps: this.fps,
      inv: prev?.inv ?? 0,
      title: this.title && performance.now() - this.title.at < 4000 ? this.title : null,
      actionbar: this.actionbar && performance.now() - this.actionbar.at < 2500 ? this.actionbar : null,
      net: prev?.net ?? null,
      saveProblem: this.saves.problem,
      saving: prev?.saving ?? false,
      onFire: p.fireTicks > 0,
      underwater: p.body.eyesInWater,
      perspective: this.perspective,
      toasts: this.toasts.filter((t) => performance.now() - t.at < 5000),
      boss: this.endFight.bossBar(),
      objective: this.objectiveNow,
      water: this.vitalsRules()?.thirst ? p.vitals.water : null,
      vitals: this.vitalsRules() ? statusLine(p.vitals, this.vitalsRules()!) : [],
      inspect: this.inspectLine(),
      minimap: this.modOn("minimap"),
      critters: this.critters?.hud() ?? null,
      cash: modeDef(this.meta.mode?.id)?.category === "city" ? p.cash : null,
      wanted: this.cityNow() ? p.wanted : null,
      caption: this.captionNow && performance.now() - this.captionNow.at < 2500 + this.captionNow.text.length * 55 ? { who: this.captionNow.who, text: this.captionNow.text, color: this.captionNow.color } : null,
      vehicle: this.carHud(),
      zone: this.zoneHud(),
    };
  }

  /** The car being driven: its name, speed and state, for the speedometer. */
  private carHud(): Hud["vehicle"] {
    const p = this.player;
    const v = p.riding !== null ? this.entities.get(p.riding) : undefined;
    if (!(v instanceof Car)) return null;
    return { name: v.spec.name, kmh: kmh(v.speed), health: Math.max(0, v.health / v.spec.health), siren: v.siren, police: v.model === "police" };
  }

  private zoneSeen: { name: string; at: number } | null = null;
  /** The district the player is in, announced on the way in, and the street under them. */
  private zoneHud(): Hud["zone"] {
    const city = this.cityNow();
    if (!city) return null;
    const b = this.player.body;
    const d = city.districtAt(Math.floor(b.x), Math.floor(b.z));
    if (!this.zoneSeen || this.zoneSeen.name !== d.name) this.zoneSeen = { name: d.name, at: performance.now() };
    return { name: d.name, street: city.streetAt(Math.floor(b.x), Math.floor(b.z)), fresh: performance.now() - this.zoneSeen.at < 4000 };
  }

  private cityCache: City | null | undefined;
  /** The city this world is played in (a city map pack, in the overworld), or null. */
  cityNow(): City | null {
    if (this.dimension !== "overworld") return null;
    if (this.cityCache === undefined) {
      const m = this.meta;
      this.cityCache = m.map ? mapLayout(m.map, m.seed, new Generator({ seed: m.seed, type: m.type, dimension: "overworld" })).city ?? null : null;
    }
    return this.cityCache;
  }

  private debugLines(): string[] {
    const p = this.player, b = p.body;
    const x = Math.floor(b.x), y = Math.floor(b.y), z = Math.floor(b.z);
    const chunk = this.world.chunkAt(x, z);
    const biome = chunk ? biomeDef(chunk.biomes[((z & 15) << 4) | (x & 15)]).name : "?";
    const l = this.world.getLight(x, y, z);
    const facing = ["south", "west", "north", "east"][Math.round(((-p.yaw / (Math.PI / 2)) % 4 + 4 + 2) % 4) % 4];
    const stats = this.renderer.stats();
    const t = this.actions.target?.block;
    return [
      `${GAME_SHORT} — ${this.fps} fps · ${this.role}${this.net ? ` · ${this.net.kind} ${this.net.room}` : ""}`,
      `XYZ: ${b.x.toFixed(3)} / ${b.y.toFixed(3)} / ${b.z.toFixed(3)}`,
      `Block: ${x} ${y} ${z}   Chunk: ${x >> 4} ${z >> 4}`,
      `Facing: ${facing} (${(((p.yaw * 180) / Math.PI) % 360).toFixed(1)} / ${((p.pitch * 180) / Math.PI).toFixed(1)})`,
      `Biome: ${biome}`,
      `Light: ${l < 0 ? "?" : `${l >> 4} sky, ${l & 15} block`}   Day ${Math.floor(this.time / DAY_TICKS)}, time ${this.time % DAY_TICKS}${this.season() ? `   ${seasonLabel(this.time)}` : ""}${this.realSky() ? `   Sky ${localClock(this.skyDate(), this.latLon().lon)} at ${placeText(this.latLon().lat, this.latLon().lon)}` : ""}`,
      `Chunks: ${this.world.chunks.size} loaded, ${stats.chunks} drawn, ${this.streamer.busy} in flight (${this.pool.mode})`,
      `Draw: ${stats.calls} calls, ${(stats.triangles / 1000).toFixed(0)}k tris, ${(stats.quads / 1000).toFixed(0)}k quads`,
      `Entities: ${this.entities.size}   Players: ${1 + this.remote.size}`,
      `Seed: ${this.meta.seed}   Type: ${this.meta.type}`,
      ...(t ? [`Target: ${block(this.world.blockAt(t.x, t.y, t.z)).name} @ ${t.x} ${t.y} ${t.z} meta ${this.world.getMeta(t.x, t.y, t.z)}`] : []),
      ...(this.streamer.lastError ? [`Last chunk error: ${this.streamer.lastError}`] : []),
    ];
  }

  private toasts: Hud["toasts"] = [];

  /** Records and announces whatever the player has just earned. */
  advance(event?: AdvancementEvent): void {
    const p = this.player;
    if (p.gameMode === "spectator") return;
    for (const a of newlyEarned(p.advancements, { inventory: p.inventory, y: p.body.y, level: p.xpLevel, dimension: this.dimension }, event)) {
      p.advancements.add(a.id);
      this.toasts = [...this.toasts.filter((t) => performance.now() - t.at < 5000), { id: a.id, title: a.title, icon: a.icon, at: performance.now() }];
      this.message(`${p.name} has made the advancement [${a.title}]`, "#55ff55");
      this.net?.chat(`\u0000adv:${p.name} has made the advancement [${a.title}]`);
      this.sound("pop", null, 0, 0, 0.6, 0.7);
    }
  }

  setNetStatus(net: Hud["net"]): void {
    this.store.set({ net });
  }

  /** Where the world's top is near the player (for /tp and respawns). */
  surfaceAt(x: number, z: number): number {
    const y = this.world.topSolid(Math.floor(x), Math.floor(z));
    return y < 0 ? WORLD_HEIGHT : y + 1;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

