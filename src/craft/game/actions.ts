/**
 * What the player does to the world: look, aim, mine, place, use, attack,
 * eat, draw a bow, drop things, sleep.
 *
 * Mining time is the original's formula — tool speed against block hardness,
 * divided by 30 when the tool can harvest the block and 100 when it cannot,
 * slowed five-fold underwater or in mid-air — so a player's sense of "stone
 * pickaxe on iron is about a second" holds. Placement respects what each
 * block needs: torches want a wall or floor, crops want farmland, doors want
 * two blocks of room, a slab on a slab makes a double slab.
 */
import { Car } from "../engine/cars";
import { boardsOf, FIRST_WIDE_BLOCK } from "../engine/countyBlocks";
import { clickCountyBlock, type UseHelpers } from "./countyUse";
import * as THREE from "three";
import {
  B, block, CLOCKWISE_FACING, collisionBoxes, CROP_MAX_AGE, Face, FACE_DIRS, FACE_OF_FACING, FACING_DIRS, isBed, isBerryBush, isButton, isCrop, isDoor, isFluid, isLeaves, isPillar,
  isRedstoneTorch, isSlab, isStairs, isTrapdoor, OPPOSITE_FACE, OPPOSITE_FACING, FRAME_EYE,
  type BlockDef,
} from "../engine/blocks";
import { cropDrops, supported } from "../engine/blockRules";
import { isOre, isTrunk, oreVein, treeLogs, type Pos } from "../engine/chains";
import { applyFortune, damageBonus, efficiencyBonus, levelOf, wears } from "../engine/enchanting";
import { AreaCloud, EndCrystal, ItemFrame, PrimedTnt, Projectile, type ProjectileKind } from "../engine/entities";
import { rocketLife, rocketOf } from "../engine/fireworks";
import { itemDef, itemId, resolveDrops, type ItemDef, type ItemStack } from "../engine/items";
import { isArthropod, isUndead, Mob, WOLF_FOOD } from "../engine/mobs";
import { attackPower, canRide, dinoWouldTake } from "../engine/dinoAi";
import { gunOf, stray, tracePellet, type Gun, type Shootable } from "../engine/guns";
import { CREATURES, foodPoints, isDino, TORPOR } from "../engine/creatures";
import { displayName, maxHp } from "../engine/critters";
import { potionOfItem } from "../engine/potions";
import { isRail, neighboursToReshape, placedShape, railShape, RAIL_EXITS } from "../engine/rails";
import { Vehicle } from "../engine/vehicles";
import { compostChance } from "../engine/villages";
import { DIMENSION_INFO } from "../engine/dimension";
import { findPortalFrame } from "../engine/portal";
import type { ThrowExtra } from "../net/session";
import { aabbIntersects, bodyBox } from "../engine/physics";
import { raycastBlocks, rayBox, type BlockHit } from "../engine/raycast";
import { WORLD_HEIGHT } from "../engine/constants";
import type { Entity } from "../engine/entities";
import type { Game, RemotePlayer } from "./game";

export interface Target {
  block: BlockHit | null;
  entity: Entity | null;
  remote: RemotePlayer | null;
}

const FACE_NORMALS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** The seed a harvested crop keeps back to replant itself. */
const REPLANT: Record<number, string> = { [B.WHEAT]: "wheat_seeds", [B.CARROTS]: "carrot", [B.POTATOES]: "potato", [B.NETHER_WART]: "nether_wart" };
const SHEARABLE = new Set<number>([B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.JUNGLE_LEAVES, B.ACACIA_LEAVES, B.SHORT_GRASS, B.FERN, B.DEAD_BUSH, B.COBWEB]);

/** Ticks to break a block with a held item; 0 is instant, Infinity never. */
export function breakTicks(
  def: BlockDef, held: ItemDef | undefined, inWater: boolean, onGround: boolean, stack: ItemStack | null = null, aquaAffinity = false,
): { ticks: number; harvest: boolean } {
  if (def.hardness < 0) return { ticks: Infinity, harvest: false };
  const tool = held?.tool;
  const harvest = def.harvestTier === undefined || (!!tool && tool.type === def.tool && tool.tier >= def.harvestTier);
  if (def.hardness === 0) return { ticks: 0, harvest };
  let speed = 1;
  if (tool && tool.type === def.tool) speed = tool.speed;
  if (tool?.type === "sword" && def.id === B.COBWEB) speed = 15;
  if (tool?.type === "shears") {
    if (isLeaves(def.id) || def.id === B.COBWEB) speed = 15;
    else if (def.material === "wool") speed = 5;
  }
  if (tool?.type === "sword" && (isLeaves(def.id) || def.material === "plant")) speed = 1.5;
  // Efficiency only helps a tool that is already the right one.
  if (speed > 1) speed += efficiencyBonus(stack);
  if (inWater && !aquaAffinity) speed /= 5;
  if (!onGround) speed /= 5;
  const perTick = speed / def.hardness / (harvest ? 30 : 100);
  if (perTick >= 1) return { ticks: 0, harvest };
  return { ticks: Math.ceil(1 / perTick), harvest };
}

/**
 * Whether Silk Touch lifts a block whole: anything that normally drops
 * something other than itself and has an item of its own (stone, ores, glass,
 * leaves, bookshelves), but not the multi-block or stateful things whose item
 * is different (doors, beds, crops, a double slab, a lit lamp).
 */
function silkTouchable(id: number): boolean {
  const def = block(id);
  return def.drops !== undefined && !def.hidden && !!itemDef(id) && !isCrop(id) && !isDoor(id) && !isBed(id) && !isSlab(id);
}

/** The item a door comes away as: the two original doors have items of their own; the county's are their own items. */
function doorItem(id: number): number {
  return id === B.OAK_DOOR ? itemId("oak_door") : id === B.IRON_DOOR ? itemId("iron_door") : id;
}

/** The item a bed comes away as, the same way. */
function bedItem(id: number): number {
  return id === B.RED_BED ? itemId("red_bed") : id;
}

/** Horizontal facing (0 north, 1 south, 2 west, 3 east) the player is looking along. */
export function lookFacing(yaw: number): number {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 3 : 2;
  return fz > 0 ? 1 : 0;
}

function facingOfNormal(face: number): number {
  switch (face) {
    case Face.North: return 0;
    case Face.South: return 1;
    case Face.West: return 2;
    case Face.East: return 3;
    default: return -1;
  }
}

export class Actions {
  target: Target | null = null;

  /** The entity under the crosshair, if any (Primal's creature readout). */
  targetEntity(): Entity | null {
    return this.target?.entity ?? null;
  }
  /** Which of the dragon's parts the crosshair is on (see Mob.hitParts). */
  targetPart: string | undefined;
  private mining: { x: number; y: number; z: number; progress: number; ticks: number } | null = null;
  private swingTick = -1;
  private swingPrev = -1;
  private equip = 0;
  private equipTarget: number | null = null;
  private useCooldown = 0;
  private attackPrev = false;
  private pearlCooldown = 0;
  private usePrev = false;
  /** Ticks until the held gun can fire again. */
  private gunCooldown = 0;
  private creativeCooldown = 0;
  private eating: { ticks: number; slot: number; id: number } | null = null;
  private bow: { ticks: number } | null = null;
  private dir = new THREE.Vector3();

  constructor(private game: Game) {}

  /** The parts of this class the county's fittings borrow (game/countyUse.ts). */
  private countyHelpers: UseHelpers = {
    swing: () => this.swing(),
    consumeHeld: (n) => this.consumeHeld(n),
    replaceHeld: (stack) => this.replaceHeld(stack),
  };

  // ---- per frame -----------------------------------------------------------------------

  frameInput(_dt: number): void {
    const g = this.game;
    const c = g.controls;
    const p = g.player;
    const blocked = !!g.screen;
    if (!blocked && !p.dead) {
      if (p.sleeping && (c.jump || c.sneak || c.forward !== 0)) this.wakeUp();
      p.yaw -= c.lookX;
      p.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, p.pitch - c.lookY));
    }
    c.lookX = 0;
    c.lookY = 0;
    for (const a of c.actions.splice(0)) this.handle(a);
  }

  private handle(a: import("./types").GameAction): void {
    const g = this.game;
    const p = g.player;
    const inv = p.inventory;
    if (a.type === "close") {
      // Escape backs out of whatever is open; the death screen stays until a choice is made, a battle until it is
      // run from or won, and a new trainer's first critter until it is chosen.
      if (g.screen?.kind === "battle" || (g.screen?.kind === "starter" && !p.card.party.length)) return;
      // Nobody walks out into the county without having been someone first.
      if (g.screen?.kind === "survivor" && !p.survivor) return;
      // In space, Escape opens the pause menu over the ship's view rather than closing it.
      if (g.screen?.kind === "space") { g.setScreen({ kind: "pause" }); return; }
      // Walking away from a trade calls it off, so the other player is not left waiting on an empty table.
      if (g.screen?.kind === "critter_trade") { g.critters.link.endTrade("You called off the trade."); return; }
      if (g.screen && g.screen.kind !== "death") g.setScreen(null);
      return;
    }
    if (a.type === "party") {
      if (g.screen?.kind === "party") g.setScreen(null);
      else if (!g.screen && !p.dead && g.critters.on) g.setScreen({ kind: "party" });
      return;
    }
    if (a.type === "pause") {
      // Never a toggle: losing the pointer lock and the Escape that caused it can both arrive.
      if (!g.screen) g.setScreen({ kind: "pause" });
      return;
    }
    if (a.type === "chat") { if (!g.screen || g.screen.kind === "space") g.setScreen({ kind: "chat", text: a.text ?? "" }); return; }
    if (a.type === "inventory") {
      const k = g.screen?.kind;
      if (k === "inventory" || k === "crafting" || k === "furnace" || k === "chest" || k === "brewing" || k === "enchanting" || k === "anvil" || k === "smithing" || k === "trade" || k === "backpack" || k === "cooking") g.setScreen(null);
      else if (!g.screen && !p.dead && p.gameMode !== "spectator") g.setScreen({ kind: "inventory" });
      return;
    }
    if (a.type === "map") {
      if (g.screen?.kind === "map") g.setScreen(null);
      else if (!g.screen && !p.dead && g.modOn("minimap")) g.setScreen({ kind: "map" });
      return;
    }
    if (g.screen) return;
    switch (a.type) {
      case "hotbar":
        inv.selected = Math.max(0, Math.min(8, a.slot));
        this.stopUsing();
        g.bumpInv();
        break;
      case "scroll":
        inv.selected = (((inv.selected + Math.sign(a.delta)) % 9) + 9) % 9;
        this.stopUsing();
        g.bumpInv();
        break;
      case "drop": this.dropHeld(a.all); break;
      case "pickBlock": this.pickBlock(); break;
      case "perspective": g.perspective = ((g.perspective + 1) % 3) as 0 | 1 | 2; break;
      case "radio": g.nextStation(); break;
      case "debug": g.debug = !g.debug; break;
      case "hideHud": g.hudHidden = !g.hudHidden; break;
      case "toggleFly":
        if (p.canFly && p.gameMode !== "spectator") p.flying = !p.flying;
        break;
      case "screenshot": {
        const url = g.renderer.screenshot();
        const a2 = document.createElement("a");
        a2.href = url;
        a2.download = `blockcraft-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
        a2.click();
        g.message("Saved screenshot", "#aaffaa");
        break;
      }
    }
  }

  /** Recomputes what the crosshair (or the finger) is on. */
  updateTarget(): void {
    const g = this.game;
    const p = g.player;
    if (p.dead || g.screen || p.sleeping) { this.target = null; return; }
    const b = p.body;
    const ox = b.x, oy = b.y + b.eyeHeight, oz = b.z;
    const aim = g.controls.aim;
    if (aim) {
      const cam = g.renderer.camera;
      this.dir.set(aim.x, aim.y, 0.5).unproject(cam).sub(cam.position).normalize();
    } else {
      this.dir.set(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    }
    const d = this.dir;
    const reach = p.gameMode === "creative" ? 5 : 4.5;
    // Astride a creature, you strike with it: from its back, as far as its bite reaches.
    const mount = g.ridden();
    const entityReach = p.gameMode === "creative" ? 5 : mount instanceof Mob ? 3.5 + mount.body.width : 3;
    const hit = p.gameMode === "spectator" ? null : raycastBlocks(g.world, ox, oy, oz, d.x, d.y, d.z, reach);
    let best: Entity | null = null, bestT = Math.min(entityReach, hit ? hit.distance : Infinity);
    for (const e of g.entities.values()) {
      // Also what can be struck out of the air (a ghast's fireball, a shulker's bullet) and item frames.
      const swattable = e instanceof Projectile && (e.kind === "fireball" || e.kind === "shulker_bullet");
      if (!(e instanceof Mob || e instanceof Vehicle || e instanceof EndCrystal || e instanceof ItemFrame || swattable) || (e instanceof Mob && e.dying)) continue;
      // The vehicle (or creature) you sit on is not in your way.
      if (e.id === p.riding) continue;
      if (Math.abs(e.x - ox) > 14 + e.body.width / 2 || Math.abs(e.z - oz) > 14 + e.body.width / 2) continue;
      // The dragon is struck part by part: its head, neck, body, tail or a wing.
      const parts = e.hitParts();
      if (parts) {
        for (const part of parts) {
          const r = rayBox(ox, oy, oz, d.x, d.y, d.z, part.box, bestT);
          if (r && r.t < bestT) { bestT = r.t; best = e; this.targetPart = part.name; }
        }
        continue;
      }
      const box = e.box();
      const r = rayBox(ox, oy, oz, d.x, d.y, d.z, { ...box, minX: box.minX - 0.1, maxX: box.maxX + 0.1, minZ: box.minZ - 0.1, maxZ: box.maxZ + 0.1 }, bestT);
      if (r && r.t < bestT) { bestT = r.t; best = e; this.targetPart = undefined; }
    }
    let remote: RemotePlayer | null = null;
    for (const r of g.remote.values()) {
      if (r.dead) continue;
      const h = r.sneaking ? 1.5 : 1.8;
      const res = rayBox(ox, oy, oz, d.x, d.y, d.z, { minX: r.x - 0.35, minY: r.y, minZ: r.z - 0.35, maxX: r.x + 0.35, maxY: r.y + h, maxZ: r.z + 0.35 }, bestT);
      if (res && res.t < bestT) { bestT = res.t; remote = r; best = null; }
    }
    this.target = { block: best || remote ? null : hit, entity: best, remote };
  }

  // ---- per tick --------------------------------------------------------------------------

  tick(): void {
    const g = this.game;
    const p = g.player;
    const c = g.controls;
    if (this.swingTick >= 0) { this.swingPrev = this.swingTick; this.swingTick++; if (this.swingTick > 6) { this.swingTick = -1; this.swingPrev = -1; } }
    else this.swingPrev = -1;
    if (this.useCooldown > 0) this.useCooldown--;
    if (this.pearlCooldown > 0) this.pearlCooldown--;
    if (this.creativeCooldown > 0) this.creativeCooldown--;

    // The held item dips and rises when it changes.
    const heldId = p.inventory.held?.id ?? null;
    if (heldId !== this.equipTarget) { this.equip = Math.min(1, this.equip + 0.4); if (this.equip >= 1) this.equipTarget = heldId; }
    else this.equip = Math.max(0, this.equip - 0.25);

    const active = !g.screen && !p.dead && !p.sleeping;
    const attack = active && c.attack;
    const use = active && c.use;

    // At the wheel of a car, the attack button is the horn.
    const car = g.ridden();
    if (car instanceof Car) {
      if (attack && !this.attackPrev) car.honk(g.ctx);
      this.attackPrev = attack;
    } else if (attack && p.gameMode !== "spectator") {
      const t = this.target;
      if (t?.entity || t?.remote) {
        if (!this.attackPrev || p.attackStrength() >= 1) this.attackTarget(t);
        this.mining = null;
      } else if (t?.block) {
        this.mine(t.block);
      } else {
        if (!this.attackPrev) this.swing();
        this.mining = null;
      }
    } else this.mining = null;
    if (!(car instanceof Car)) this.attackPrev = attack;

    if (this.gunCooldown > 0) this.gunCooldown--;
    // Use.
    if (this.eating) {
      if (!use || p.inventory.selected !== this.eating.slot || p.inventory.held?.id !== this.eating.id) this.eating = null;
      else this.eatTick();
    } else if (this.bow) {
      if (!use) this.releaseBow();
      else this.bow.ticks++;
    } else if (use && p.gameMode !== "spectator") {
      if (!this.usePrev || this.useCooldown === 0) {
        this.use(!this.usePrev);
        this.useCooldown = 4;
      }
    }
    this.usePrev = use;
  }

  swing(): void {
    this.swingTick = 0;
    this.swingPrev = 0;
  }

  swingProgress(alpha: number): number {
    if (this.swingTick < 0) return 0;
    return Math.min(1, (this.swingPrev + (this.swingTick - this.swingPrev) * alpha) / 6);
  }

  equipOffset(): number {
    return this.equip;
  }

  crackStage(): number {
    if (!this.mining || this.game.player.gameMode === "creative") return -1;
    return Math.floor(this.mining.progress * 10) - 1;
  }

  breakProgress(): number {
    return this.mining?.progress ?? 0;
  }

  eatingPhase(): number {
    return this.eating ? this.eating.ticks / 20 : 0;
  }

  bowPull(): number {
    if (!this.bow) return 0;
    return Math.min(1, this.bow.ticks / 20);
  }

  bowFov(): number {
    const pull = this.bowPull();
    return 1 - pull * pull * 0.15;
  }

  stopUsing(): void {
    this.eating = null;
    this.bow = null;
    this.mining = null;
  }

  /** Mobile auto-jump: a one-block step straight ahead while walking gets a jump. */
  autoJumpNow(): boolean {
    const g = this.game;
    if (!g.settings.autoJump || !g.isMobile) return false;
    const p = g.player, b = p.body;
    if (!b.onGround || g.controls.forward <= 0.3 || p.flying) return false;
    const ahead = 0.6;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const x = Math.floor(b.x + fx * ahead), z = Math.floor(b.z + fz * ahead), y = Math.floor(b.y + 0.01);
    const front = block(g.world.blockAt(x, y, z));
    if (!front.solid || isFluid(front.id)) return false;
    const boxes = collisionBoxes(front, g.world.getMeta(x, y, z));
    const top = Math.max(0, ...boxes.map((bx) => bx[4])) / 16;
    if (top <= 0.6) return false; // a step handles it
    return !block(g.world.blockAt(x, y + 1, z)).solid && !block(g.world.blockAt(x, y + 2, z)).solid;
  }

  // ---- mining ------------------------------------------------------------------------------

  private mine(hit: BlockHit): void {
    const g = this.game;
    const p = g.player;
    if (p.gameMode === "adventure") return;
    const { x, y, z } = hit;
    const id = g.world.blockAt(x, y, z);
    if (!id) { this.mining = null; return; }
    const def = block(id);
    this.swing();
    // Struck in survival, the dragon egg blinks away rather than breaking.
    if (id === B.DRAGON_EGG && p.gameMode !== "creative") {
      if (!this.attackPrev) g.teleportEgg(x, y, z);
      this.mining = null;
      return;
    }
    if (p.gameMode === "creative") {
      const held = p.inventory.held ? itemDef(p.inventory.held.id) : undefined;
      // Swords cannot break blocks in creative, as in the original.
      if (held?.tool?.type === "sword" || this.creativeCooldown > 0) return;
      this.breakBlock(x, y, z, false);
      this.creativeCooldown = 5;
      return;
    }
    if (!this.mining || this.mining.x !== x || this.mining.y !== y || this.mining.z !== z) {
      this.mining = { x, y, z, progress: 0, ticks: 0 };
    }
    const held = p.inventory.held ? itemDef(p.inventory.held.id) : undefined;
    const aqua = levelOf(p.inventory.armor[0], "aqua_affinity") > 0;
    const { ticks } = breakTicks(def, held, p.body.eyesInWater, p.body.onGround || p.flying, p.inventory.held, aqua);
    if (ticks === Infinity) return;
    const m = this.mining;
    m.ticks++;
    m.progress = ticks === 0 ? 1 : Math.min(1, m.progress + 1 / ticks);
    if (m.ticks % 4 === 1) {
      g.blockSound(def.material, "dig", x + 0.5, y + 0.5, z + 0.5, false);
      g.particles("block", hit.px, hit.py, hit.pz, 2, id, false);
    }
    if (m.progress >= 1) {
      const heldId = p.inventory.held?.id ?? null;
      this.breakBlock(x, y, z, true);
      this.mining = null;
      this.useCooldown = Math.max(this.useCooldown, 0);
      if (held && breakTicks(def, held, false, true).harvest) this.chainBreak(x, y, z, id, held, heldId);
    }
  }

  /**
   * Tree felling and vein mining (engine/chains.ts): an axe brings down the
   * rest of the tree whose trunk it cut, unless the player is sneaking; a
   * pickaxe, while sneaking, follows the vein. Each block is broken as the
   * player's own — dropping, wearing the tool, reaching friends — and it stops
   * with a point of the tool's life left rather than breaking it.
   */
  private chainBreak(x: number, y: number, z: number, id: number, tool: ItemDef, heldId: number | null): void {
    const g = this.game;
    const p = g.player;
    if (!g.modOn("tree_felling") || !tool.tool) return;
    const get = (a: number, b: number, c: number) => g.world.blockAt(a, b, c);
    let more: Pos[] = [];
    if (tool.tool.type === "axe" && isTrunk(id) && !p.sneaking) more = treeLogs(get, x, y, z, id);
    else if (tool.tool.type === "pickaxe" && isOre(id) && p.sneaking) more = oreVein(get, x, y, z, id);
    const b = p.body;
    for (const [bx, by, bz] of more) {
      const held = p.inventory.held;
      if (!held || held.id !== heldId) break;
      if (p.survivalLike && tool.durability && tool.durability - (held.damage ?? 0) <= 1) break;
      // A guest's edits count only near where they stand; the host would refuse the rest.
      if (g.role === "guest" && (Math.abs(bx - b.x) > 11 || Math.abs(by - b.y) > 11 || Math.abs(bz - b.z) > 11)) continue;
      this.breakBlock(bx, by, bz, true, true);
    }
  }

  /** Breaks a block as the player, dropping what the held tool earns. `chained`: one of many at once, heard as one. */
  breakBlock(x: number, y: number, z: number, drops: boolean, chained = false): void {
    const g = this.game;
    const p = g.player;
    const id = g.world.blockAt(x, y, z);
    const meta = g.world.getMeta(x, y, z);
    if (!id) return;
    const def = block(id);
    const held = p.inventory.held ? itemDef(p.inventory.held.id) : undefined;
    const { harvest } = breakTicks(def, held, false, true);
    const silk = levelOf(p.inventory.held, "silk_touch") > 0 && silkTouchable(id);

    let stacks: ItemStack[] = [];
    if (drops && harvest) {
      if (held?.tool?.type === "shears" && SHEARABLE.has(id)) stacks = [{ id, count: 1 }];
      else if (silk) stacks = [{ id, count: 1 }];
      else if (isCrop(id) || id === B.NETHER_WART) stacks = cropDrops(id, meta, Math.random);
      else if (isDoor(id) && meta & 8) stacks = [];
      else if (isBed(id) && meta & 4) stacks = [];
      else if (isSlab(id) && meta === 2) stacks = [{ id, count: 2 }];
      else stacks = applyFortune(resolveDrops(def.drops, id, Math.random), levelOf(p.inventory.held, "fortune"), Math.random, id);
    }
    if (drops) g.dropContainerContents(x, y, z);
    // A creative player breaking a shulker box that holds something still gets the box back, full;
    // a gravestone gives back what it holds to anyone.
    else if (id === B.SHULKER_BOX) g.dropContainerContents(x, y, z, false);
    else if (id === B.GRAVESTONE) g.dropContainerContents(x, y, z);
    else g.world.setEntity(x, y, z, undefined);

    // Two-block things come down together.
    if (isDoor(id)) {
      const other = meta & 8 ? y - 1 : y + 1;
      if (g.world.blockAt(x, other, z) === id) g.world.setBlock(x, other, z, B.AIR, 0, "player");
      if (meta & 8 && drops && harvest) stacks = [{ id: doorItem(id), count: 1 }];
    }
    if (isBed(id)) {
      const [dx, dz] = FACING_DIRS[meta & 3];
      const head = (meta & 4) !== 0;
      const ox = head ? x - dx : x + dx, oz = head ? z - dz : z + dz;
      if (g.world.blockAt(ox, y, oz) === id) g.world.setBlock(ox, y, oz, B.AIR, 0, "player");
      if (head && drops) stacks = [{ id: bedItem(id), count: 1 }];
    }
    // Ice over something turns to water, as it melts in your hands.
    const replacement = id === B.ICE && drops && !silk && block(g.world.blockAt(x, y - 1, z)).solid ? B.WATER : B.AIR;
    g.world.setBlock(x, y, z, replacement, 0, "player");
    // Not broadcast: everyone else plays these from the block change itself, and would hear it twice.
    if (!chained || Math.random() < 0.2) g.blockSound(def.material, "break", x + 0.5, y + 0.5, z + 0.5, false);
    g.particles("block", x + 0.5, y + 0.5, z + 0.5, chained ? 4 : 16, id, false);

    for (const s of stacks) g.dropItem(x + 0.5, y + 0.3, z + 0.5, g.mode?.transformDrop(s) ?? s);
    if (drops && harvest && def.xp && !silk) {
      const [lo, hi] = def.xp;
      g.spawnXp(x + 0.5, y + 0.5, z + 0.5, lo + Math.floor(Math.random() * (hi - lo + 1)));
    }
    if (p.survivalLike) {
      p.addExhaustion(0.005);
      if (held?.durability && def.hardness > 0) this.wearHeld(held.tool?.type === "sword" ? 2 : 1);
    }
  }

  private wearHeld(amount: number): void {
    const g = this.game;
    if (!g.player.survivalLike) return;
    // Unbreaking spares each point of wear by chance, so the saving shows up as uses, not a rounded total.
    let wear = 0;
    for (let i = 0; i < amount; i++) if (wears(g.player.inventory.held, Math.random)) wear++;
    if (!wear) return;
    if (g.player.inventory.damageHeld(wear)) {
      g.sound("break_tool", null, 0, 0, 0.8);
      g.audio.block("wood", "break", g.player.body.x, g.player.body.y, g.player.body.z);
      g.showActionbar("Your tool broke");
    }
    g.bumpInv();
  }

  // ---- combat ------------------------------------------------------------------------------

  private attackTarget(t: Target): void {
    const g = this.game;
    const p = g.player;
    const stack = p.inventory.held;
    const held = stack ? itemDef(stack.id) : undefined;
    const strength = p.attackStrength();
    const kind = t.entity instanceof Mob ? t.entity.kind : null;
    const bonus = damageBonus(stack, kind ? { undead: isUndead(kind), arthropod: isArthropod(kind) } : null);
    // Strength and Weakness shift the base; the enchantment bonus scales with the swing, as in the original.
    let damage = Math.max(0, (held?.damage ?? 1) + p.meleeBonus) * (0.2 + strength * strength * 0.8) + bonus * strength;
    // Riding a creature, its bite is the blow.
    const mount = g.ridden();
    if (mount instanceof Mob && isDino(mount.kind)) damage = attackPower(mount) * (0.4 + strength * 0.6);
    // A club (or a bare fist) knocks out as much as it hurts: Primal's creatures carry torpor.
    const torpor = mount ? 0 : (held?.name === "wooden_club" ? TORPOR.club : held ? 0 : TORPOR.fist) * (0.2 + strength * strength * 0.8);
    const crit = strength > 0.9 && p.body.fallDistance > 0 && !p.body.onGround && !p.body.inWater && !p.body.onLadder;
    if (crit) damage *= 1.5;
    // Ashgrove County: a strong survivor, a weak one, a police officer's training (engine/survivors.ts).
    damage *= p.perks.melee;
    const knockback = levelOf(stack, "knockback") * 0.5;
    const fire = levelOf(stack, "fire_aspect") * 80;
    const looting = levelOf(stack, "looting");
    this.swing();
    p.attackTicks = 0;
    p.addExhaustion(0.1);
    const b = p.body;
    if (t.entity) {
      const e = t.entity;
      if (crit) g.particles("crit", e.x, e.y + e.body.height * 0.7, e.z, 10);
      const part = e instanceof Mob && e.kind === "ender_dragon" ? this.targetPart ?? "body" : undefined;
      if (g.role === "guest") g.net?.attack(e.id, damage, b.x, b.z, knockback, fire, looting, part, torpor);
      else if (e instanceof Vehicle || e instanceof EndCrystal || e instanceof ItemFrame || e instanceof Projectile) e.hurt(g.ctx, damage, "player", b.x, b.z, p.id);
      else if (e instanceof Mob) {
        e.looting = looting;
        e.hurtPart = part as Mob["hurtPart"];
        if (e.hurt(g.ctx, damage, "player", b.x, b.z, p.id, knockback)) {
          if (torpor) e.addTorpor(g.ctx, torpor, p.id);
          if (fire) e.fireTicks = Math.max(e.fireTicks, fire);
          const bane = levelOf(stack, "bane_of_arthropods");
          if (bane && isArthropod(e.kind)) e.applyEffect(g.ctx, "slowness", 1 + Math.random() * 0.5 * bane, 3);
        }
      }
      g.sound("hit", e.x, e.y + 1, e.z, 0.5);
      if (bonus > 0) g.particles("crit", e.x, e.y + e.body.height * 0.7, e.z, 6);
    } else if (t.remote) {
      g.net?.hurtRemote(t.remote.id, damage, "player", b.x, b.z, 0.4 + knockback);
      if (crit) g.particles("crit", t.remote.x, t.remote.y + 1.2, t.remote.z, 10);
    }
    if (held?.durability && held.tool) this.wearHeld(held.tool.type === "sword" ? 1 : 2);
    if (p.sprinting) p.sprinting = false;
  }

  // ---- using -----------------------------------------------------------------------------------

  private use(fresh: boolean): void {
    const g = this.game;
    const p = g.player;
    const inv = p.inventory;
    const held = inv.held;
    const def = held ? itemDef(held.id) : undefined;
    const t = this.target;

    // A gun fires (and an automatic keeps firing while held); it never does anything else.
    if (def?.use === "gun") {
      const gun = gunOf(def.name);
      if (gun && (fresh || gun.auto)) this.fireGun(gun);
      return;
    }

    if (t?.entity instanceof Vehicle && t.entity.rideable && fresh && !p.sneaking) {
      g.mount(t.entity);
      this.swing();
      return;
    }

    if (t?.entity instanceof ItemFrame && fresh) {
      const frame = t.entity;
      const empty = !frame.item;
      if (empty && !held) return;
      if (g.role === "guest") g.net?.interact(frame.id, def?.name ?? null, empty ? { ...held!, count: 1 } : null);
      else frame.use(g.ctx, held);
      if (empty && p.survivalLike) this.consumeHeld();
      this.swing();
      return;
    }

    if (t?.entity instanceof Mob && t.entity.kind === "villager" && fresh && !p.sneaking) {
      // Guests trade from the offers the host sent along with the villager; the host counts the trades.
      const v = t.entity;
      if (v.profession !== "none" && v.offers.length) g.setScreen({ kind: "trade", entityId: v.id });
      else g.sound("villager_no", v.x, v.y + 1.5, v.z, 0.8);
      this.swing();
      return;
    }

    // A trainer: talk to them, which (unless they are beaten) is to battle them.
    if (t?.entity instanceof Mob && t.entity.kind === "trainer" && fresh) {
      if (g.critters.on) g.critters.startTrainer(t.entity);
      this.swing();
      return;
    }

    // A saddled creature of yours: climb on (unless you are feeding it while it is hurt; sneak to tell it to wait).
    if (t?.entity instanceof Mob && fresh && !p.sneaking && canRide(t.entity, p.id, p.name)
      && !(def && isDino(t.entity.kind) && foodPoints(t.entity.kind, def.name) > 0 && t.entity.health < t.entity.maxHealth)) {
      g.mount(t.entity);
      this.swing();
      return;
    }

    // A critter: a wild one is battled; one of your own out of its orb says hello.
    if (t?.entity instanceof Mob && t.entity.kind === "critter" && fresh) {
      const m = t.entity;
      if (!m.owner) { if (g.critters.on) g.critters.startWild(m); }
      else if (m.owner === p.id && !m.battle) {
        const c = p.card.party.find((k) => k.uid === m.partnerUid);
        if (c) g.showActionbar(`${displayName(c)} · Lv ${c.level} · ${c.hp}/${maxHp(c)} health`);
      }
      this.swing();
      return;
    }

    if (t?.entity instanceof Mob && fresh) {
      const name = def?.name ?? null;
      if (g.role === "guest") {
        g.net?.interact(t.entity.id, name);
        if (name === "bucket" && t.entity.kind === "cow") this.replaceHeld({ id: itemId("milk_bucket"), count: 1 });
        else if (name && t.entity.spec.tempt.includes(name)) this.consumeHeld();
        // A bone offered to a wild wolf, or meat to a hungry tame one, is eaten whatever the host decides.
        else if (t.entity.kind === "wolf" && ((name === "bone" && !t.entity.owner) || (name && WOLF_FOOD.has(name) && (t.entity.owner === p.id || t.entity.ownerName === p.name)))) this.consumeHeld();
        // A piglin that is free takes the gold; the host rolls what comes back.
        else if (name === "gold_ingot" && t.entity.kind === "piglin" && t.entity.admiring <= 0 && t.entity.anger <= 0) this.consumeHeld();
        // A creature takes what it would take on the host: a saddle, a narcotic or food while it sleeps, food while hurt.
        else if (name && dinoWouldTake(t.entity, name, p.id, p.name)) this.consumeHeld();
        this.swing();
        return;
      }
      const result = t.entity.interact(g.ctx, name, p.id, p.name);
      if (result) {
        this.swing();
        if (result === "fed" || result === "dyed" || result === "barter" || result === "tamed" || result === "saddled") this.consumeHeld();
        if (result === "tamed") {
          g.advance({ kind: "tame" });
          const what = isDino(t.entity.kind) ? `${CREATURES[t.entity.kind].name} (level ${t.entity.level})` : "wolf";
          g.showActionbar(`The ${what} is yours. Use it to tell it to wait or follow${isDino(t.entity.kind) && CREATURES[t.entity.kind].saddle ? "; saddle it to ride" : ""}.`);
        }
        if (result === "saddled") g.showActionbar("Saddled. Use it to climb on; sneak to get off.");
        if (result === "sat" && isDino(t.entity.kind)) g.showActionbar(t.entity.sitting ? "Waiting here." : "Following you.");
        if (result === "sheared") this.wearHeld(1);
        if (result === "milked") this.replaceHeld({ id: itemId("milk_bucket"), count: 1 });
        if (result === "fed") g.particles("heart", t.entity.x, t.entity.y + t.entity.body.height, t.entity.z, 3);
        return;
      }
    }

    // A casino machine or table: sit down and play.
    if (t?.block && fresh) {
      const cg = g.casinoGameAt(t.block.x, t.block.y, t.block.z);
      if (cg) { g.setScreen({ kind: "casino", game: cg }); this.swing(); return; }
      const shop = g.shopAt(t.block.x, t.block.y, t.block.z);
      if (shop) { g.setScreen({ kind: "shop", shop }); this.swing(); return; }
    }
    if (t?.block) {
      if (this.useOnBlock(t.block, def, fresh)) return;
    } else if (def && fresh) {
      // Buckets aim at fluid surfaces, which the ordinary ray passes through.
      if (def.use === "bucket") { this.fillBucket(); return; }
      if (def.use === "water_bucket" || def.use === "lava_bucket") { this.emptyBucketAtFluid(def); return; }
    }
    if (!def && fresh && g.vitalsRules()?.thirst && p.survivalLike && this.drinkFromWater()) return;
    if (!def || !fresh) return;
    this.useInAir(def);
  }

  private useInAir(def: ItemDef): void {
    const g = this.game;
    const p = g.player;
    if (def.use === "orb") {
      g.showActionbar(g.critters.on ? "Aim at a wild critter and use the orb to battle it." : "There are no critters in this world.");
      return;
    }
    if (def.use === "launch") { g.launch(); return; }
    if (def.use === "critter_medicine") {
      if (g.critters.on && p.card.party.length) g.setScreen({ kind: "party", give: def.name });
      else g.showActionbar("You have no critters to give it to.");
      return;
    }
    if (def.food) {
      if (p.canEat(def.food)) this.eating = { ticks: 0, slot: p.inventory.selected, id: def.id };
      return;
    }
    if (def.use === "read") {
      if (g.read(def.name) && p.survivalLike) this.consumeHeld();
      this.swing();
      return;
    }
    if (def.use === "treat") {
      if (g.treat(def.name) && p.survivalLike) this.consumeHeld();
      this.swing();
      return;
    }
    if (def.use === "milk_bucket" || def.use === "drink") {
      this.eating = { ticks: 0, slot: p.inventory.selected, id: def.id };
      return;
    }
    if (def.use === "splash" || def.use === "xp_bottle") {
      this.throwProjectile(def.use === "splash" ? "potion" : "xp_bottle", 0.7, 1, { item: def.id });
      if (p.survivalLike) this.consumeHeld();
      g.sound("bow", p.body.x, p.body.y + 1.5, p.body.z, 0.4, 0.5);
      this.swing();
      return;
    }
    if (def.use === "bottle") {
      this.fillBottle();
      return;
    }
    if (def.use === "boat") {
      this.putVehicle(def, null);
      return;
    }
    if (def.use === "bow") {
      if (!p.survivalLike || this.nextArrow() !== null) this.bow = { ticks: 0 };
      return;
    }
    if (def.use === "backpack") {
      g.openBackpack(p.inventory.selected);
      return;
    }
    if (def.use === "pearl") {
      // A second's wait between pearls, as in the original.
      if (this.pearlCooldown > 0) return;
      this.pearlCooldown = 20;
      this.throwProjectile("ender_pearl", 1.5);
      if (p.survivalLike) this.consumeHeld();
      g.sound("throw", p.body.x, p.body.y + 1.5, p.body.z, 0.5, 0.4);
      this.swing();
      return;
    }
    if (def.use === "ender_eye") {
      // Eyes only find strongholds in the overworld, and a flat world has none.
      if (g.dimension !== "overworld" || !g.hasStrongholds()) {
        g.showActionbar(g.dimension === "overworld" ? "This world has no strongholds for the eye to find" : "The eye finds strongholds only in the overworld");
        return;
      }
      const b = p.body;
      const x = b.x, y = b.y + b.eyeHeight - 0.1, z = b.z;
      if (g.role === "guest") g.net?.throwItem("eye_of_ender", x, y, z, 0, 0, 0);
      else g.throwEye(x, y, z, p.id);
      if (p.survivalLike) this.consumeHeld();
      this.swing();
      return;
    }
    if (def.use === "rocket") {
      // Fired into the air, a rocket only pushes someone already gliding; on the ground it goes up from a block.
      if (!p.gliding) { g.showActionbar("Set a rocket off from a block, or fire it while gliding"); return; }
      const rocket = rocketOf(p.inventory.held);
      // The push lasts as long as the rocket's flight; its stars, if any, go off on the glider at the end.
      p.boostTicks = rocketLife(rocket.flight, Math.random);
      g.boostBursts = rocket.bursts.length ? rocket : null;
      g.sound("firework_launch", p.body.x, p.body.y, p.body.z, 0.8);
      g.particles("crit", p.body.x, p.body.y, p.body.z, 6);
      if (p.survivalLike) this.consumeHeld();
      this.swing();
      return;
    }
    if (def.use === "throw") {
      const kind = def.name === "egg" ? "egg" : "snowball";
      this.throwProjectile(kind, 1.5);
      if (p.survivalLike) this.consumeHeld();
      g.sound("bow", p.body.x, p.body.y + 1.5, p.body.z, 0.4, 0.6);
      this.swing();
      return;
    }
    if (def.armor) {
      const slot = def.armor.slot;
      const inv = p.inventory;
      const prev = inv.armor[slot];
      inv.armor[slot] = inv.held;
      inv.slots[inv.selected] = prev;
      g.sound("click", null, 0, 0, 0.4);
      g.bumpInv();
      return;
    }
  }

  private throwProjectile(kind: ProjectileKind, speed: number, pull = 1, extra: ThrowExtra = {}): void {
    const g = this.game;
    const p = g.player;
    const d = this.dir;
    const b = p.body;
    const x = b.x + d.x * 0.3, y = b.y + b.eyeHeight - 0.1, z = b.z + d.z * 0.3;
    const spread = 0.0075 * (1 - pull * 0.5);
    const vx = (d.x + (Math.random() - 0.5) * spread) * speed + b.vx;
    const vy = (d.y + (Math.random() - 0.5) * spread) * speed + (b.onGround ? 0 : b.vy);
    const vz = (d.z + (Math.random() - 0.5) * spread) * speed + b.vz;
    // The arrow's damage is settled here, so a guest's and a host's arrows hit the same.
    const damage = kind === "arrow" ? (extra.damage ?? 2) + (pull >= 1 && Math.random() < 0.25 ? 1 : 0) : 0;
    if (g.role === "guest") { g.net?.throwItem(kind, x, y, z, vx, vy, vz, { ...extra, damage }); return; }
    const proj = new Projectile(kind, x, y, z, vx, vy, vz, p.id);
    if (kind === "arrow") {
      proj.damage = damage;
      proj.pickup = p.gameMode !== "creative" && !this.infiniteArrows();
    }
    proj.knockback = extra.knockback ?? 0;
    proj.fire = !!extra.fire;
    proj.item = extra.item ?? 0;
    g.spawn(proj);
  }

  /**
   * A shot: a round from the inventory (none in creative), pellets traced
   * from the eye to the first body or wall, double to the head, a kick of
   * recoil, and a noise the infected hear.
   */
  private fireGun(gun: Gun): void {
    const g = this.game;
    const p = g.player;
    if (this.gunCooldown > 0) return;
    const ammo = itemId(gun.ammo);
    const slot = p.inventory.slots.findIndex((s) => s?.id === ammo);
    const free = !p.survivalLike;
    if (!free && slot < 0) {
      this.gunCooldown = 8;
      g.sound("gun_empty", null, 0, 0, 0.6);
      g.showActionbar(`Out of ${itemDef(ammo)?.displayName ?? gun.ammo}.`);
      return;
    }
    this.gunCooldown = gun.cooldown;
    if (!free) {
      const s = p.inventory.slots[slot]!;
      p.inventory.slots[slot] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
      g.bumpInv();
    }
    const b = p.body;
    const ox = b.x, oy = b.y + b.eyeHeight, oz = b.z;
    const d = this.dir;
    type Body = { mob?: Mob; remote?: RemotePlayer; car?: Car };
    const bodies: Shootable<Body>[] = [];
    for (const e of g.entities.values()) {
      if (e.id === p.riding || Math.abs(e.x - ox) > gun.range + 6 || Math.abs(e.z - oz) > gun.range + 6) continue;
      // A car is shot along its whole length, each of its boxes the same car.
      if (e instanceof Car && !e.wrecked) { const target = { car: e }; for (const part of e.hitParts()) bodies.push({ target, box: part.box }); continue; }
      if (!(e instanceof Mob) || e.dying) continue;
      bodies.push({ target: { mob: e }, box: e.box() });
    }
    for (const r of g.remote.values()) {
      if (r.dead) continue;
      const h = r.sneaking ? 1.5 : 1.8;
      bodies.push({ target: { remote: r }, box: { minX: r.x - 0.35, minY: r.y, minZ: r.z - 0.35, maxX: r.x + 0.35, maxY: r.y + h, maxZ: r.z + 0.35 } });
    }
    // Every pellet that finds the same body adds to one blow: a blow per pellet would meet the
    // invulnerability each hit leaves, and a shotgun would do a pistol's work.
    const blows = new Map<Body, number>();
    for (let i = 0; i < gun.pellets; i++) {
      const [dx, dy, dz] = stray(d.x, d.y, d.z, gun.spread, Math.random);
      const { hit, block: wall } = tracePellet(g.world, ox, oy, oz, dx, dy, dz, gun.range, bodies);
      if (hit) {
        blows.set(hit.target, (blows.get(hit.target) ?? 0) + gun.damage * (hit.headshot ? 2 : 1));
        g.particles("crit", ox + dx * hit.distance, hit.y, oz + dz * hit.distance, hit.headshot ? 6 : 3);
      } else if (wall) {
        g.particles("block", wall.px, wall.py, wall.pz, 4, g.world.blockAt(wall.x, wall.y, wall.z));
      }
    }
    for (const [{ mob: m, remote: r, car }, dmg] of blows) {
      if (car) {
        if (g.role === "guest") g.net?.attack(car.id, dmg, ox, oz, 0, 0, 0);
        else car.hurt(g.ctx, dmg, "arrow", ox, oz, p.id);
      } else if (m) {
        if (g.role === "guest") g.net?.attack(m.id, dmg, ox, oz, 0.1, 0, 0);
        else { m.invulnerable = 0; m.hurt(g.ctx, dmg, "arrow", ox, oz, p.id, 0.1); }
      } else if (r) g.net?.hurtRemote(r.id, dmg, "arrow", ox, oz, 0.2);
    }
    g.particles("smoke", ox + d.x * 0.8, oy - 0.15 + d.y * 0.8, oz + d.z * 0.8, 3);
    g.sound(gun.sound, b.x, b.y + 1.5, b.z, 1, 0.95 + Math.random() * 0.1);
    p.pitch = Math.min(Math.PI / 2 - 0.01, p.pitch + gun.recoil);
    g.makeNoise(b.x, b.y, b.z, gun.noise, p.id);
    this.swing();
  }

  private releaseBow(): void {
    const g = this.game;
    const p = g.player;
    const ticks = this.bow?.ticks ?? 0;
    this.bow = null;
    let f = ticks / 20;
    f = (f * f + f * 2) / 3;
    if (f < 0.1) return;
    f = Math.min(1, f);
    const bow = p.inventory.held;
    const power = levelOf(bow, "power");
    const arrow = this.nextArrow();
    const tipped = arrow ? p.inventory.slotStack(arrow) : null;
    this.throwProjectile("arrow", f * 3, f, {
      damage: 2 + (power ? power * 0.5 + 0.5 : 0),
      knockback: levelOf(bow, "punch"),
      fire: levelOf(bow, "flame") > 0,
      // A tipped arrow carries its potion to whatever it strikes.
      item: tipped && tipped.id !== itemId("arrow") ? tipped.id : 0,
    });
    g.sound("bow", p.body.x, p.body.y + 1.5, p.body.z, 0.8, 1 / (Math.random() * 0.4 + 1.2) + f * 0.5);
    if (p.survivalLike) {
      // Infinity: the arrow is still needed to draw, but never spent.
      // (Infinity spares plain arrows only, as in the original: a tipped one is always spent.)
      if (arrow && (!this.infiniteArrows() || (tipped && tipped.id !== itemId("arrow")))) p.inventory.takeOne(arrow);
      this.wearHeld(1);
    }
    this.swing();
  }

  /** The arrow a bow draws: the off hand first, then the hotbar and pack in order — plain or tipped. */
  private nextArrow(): number | "offhand" | null {
    const inv = this.game.player.inventory;
    const isArrow = (id: number | undefined) => id !== undefined && (id === itemId("arrow") || !!itemDef(id)?.name.startsWith("tipped_arrow_"));
    if (isArrow(inv.offhand?.id)) return "offhand";
    const i = inv.slots.findIndex((st) => isArrow(st?.id));
    return i >= 0 ? i : null;
  }

  private infiniteArrows(): boolean {
    const held = this.game.player.inventory.held;
    return !!held && itemDef(held.id)?.use === "bow" && levelOf(held, "infinity") > 0;
  }

  /** A glass bottle dipped in water becomes a water bottle. */
  private fillBottle(): boolean {
    const g = this.game;
    // The dragon's breath first: stood in its cloud, a bottle takes some of it.
    const b = g.player.body;
    for (const e of g.entities.values()) {
      if (!(e instanceof AreaCloud) || e.potion || e.removed) continue;
      if (Math.hypot(e.x - b.x, e.z - b.z) > e.radius + 1.5 || Math.abs(e.y - b.y) > 3) continue;
      if (g.role === "guest") g.net?.interact(e.id, "glass_bottle");
      else if (!e.bottled()) continue;
      g.sound("bottle_fill_dragonbreath", b.x, b.y + 1, b.z, 0.8);
      this.replaceHeld({ id: itemId("dragon_breath"), count: 1 });
      this.swing();
      return true;
    }
    const hit = this.fluidHit();
    if (!hit || g.world.blockAt(hit.x, hit.y, hit.z) !== B.WATER) return false;
    g.sound("bucket_fill", hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 0.6, 1.4);
    // A canteen holds more than a bottle, and fills to a canteen.
    this.replaceHeld({ id: itemId(this.game.player.inventory.held?.id === itemId("canteen") ? "water_canteen" : "water_bottle"), count: 1 });
    this.swing();
    return true;
  }

  /** With thirst kept, an empty hand at a pond drinks from it (and, with wounds kept, may make you ill). */
  private drinkFromWater(): boolean {
    const g = this.game;
    const hit = this.fluidHit();
    if (!hit || g.world.blockAt(hit.x, hit.y, hit.z) !== B.WATER) return false;
    const b = g.player.body;
    g.sound("drink", b.x, b.y + 1.4, b.z, 0.6, 1);
    g.drank("pond_water", 3);
    this.swing();
    return true;
  }

  /**
   * Composting: each plant or food has the original's chance to raise the
   * level; at the top it turns to bone meal, taken out with an empty click.
   */
  private useComposter(x: number, y: number, z: number, meta: number, held: ItemDef | undefined): boolean {
    const g = this.game;
    const level = meta & 15;
    if (level >= 8) {
      g.world.setBlock(x, y, z, B.COMPOSTER, 0, "player");
      g.dropItem(x + 0.5, y + 1.1, z + 0.5, { id: itemId("bone_meal"), count: 1 });
      g.sound("compost", x + 0.5, y + 0.5, z + 0.5, 0.8, 1.3);
      this.swing();
      return true;
    }
    const chance = held ? compostChance(held.name) : undefined;
    if (chance === undefined) return false;
    this.consumeHeld();
    if (Math.random() < chance) {
      g.world.setBlock(x, y, z, B.COMPOSTER, level + 1 >= 7 ? 8 : level + 1, "player");
      g.particles("crit", x + 0.5, y + 0.9, z + 0.5, 4);
    }
    g.sound("compost", x + 0.5, y + 0.5, z + 0.5, 0.6);
    this.swing();
    return true;
  }

  /** Buckets and bottles in and out of a cauldron: three bottles to a bucket. */
  private useCauldron(x: number, y: number, z: number, meta: number, held: ItemDef | undefined): boolean {
    const g = this.game;
    const level = meta & 3;
    const set = (n: number) => g.world.setBlock(x, y, z, B.CAULDRON, n, "player");
    const name = held?.name;
    if (name === "water_bucket" && level < 3) {
      set(3);
      g.sound("bucket_empty", x + 0.5, y + 0.5, z + 0.5);
      if (g.player.survivalLike) this.replaceHeld({ id: itemId("bucket"), count: 1 });
    } else if (name === "bucket" && level === 3) {
      set(0);
      g.sound("bucket_fill", x + 0.5, y + 0.5, z + 0.5);
      this.replaceHeld({ id: itemId("water_bucket"), count: 1 });
    } else if (name === "glass_bottle" && level > 0) {
      set(level - 1);
      g.sound("bucket_fill", x + 0.5, y + 0.5, z + 0.5, 0.6, 1.4);
      this.replaceHeld({ id: itemId("water_bottle"), count: 1 });
    } else if (name === "water_bottle" && level < 3) {
      set(level + 1);
      g.sound("bucket_empty", x + 0.5, y + 0.5, z + 0.5, 0.6, 1.4);
      if (g.player.survivalLike) this.replaceHeld({ id: itemId("glass_bottle"), count: 1 });
    } else return false;
    this.swing();
    return true;
  }

  private eatTick(): void {
    const g = this.game;
    const p = g.player;
    const e = this.eating!;
    e.ticks++;
    const b = p.body;
    const drinking = itemDef(e.id)?.use === "drink" || itemDef(e.id)?.use === "milk_bucket";
    if (e.ticks % 4 === 0 && e.ticks < 32) {
      g.sound(drinking ? "drink" : "eat", b.x, b.y + 1.4, b.z, 0.5, 0.8 + Math.random() * 0.4);
      const d = this.dir;
      g.particles("block", b.x + d.x * 0.5, b.y + b.eyeHeight - 0.2, b.z + d.z * 0.5, 2, 0, false);
    }
    if (e.ticks < 32) return;
    this.eating = null;
    const held = p.inventory.held;
    if (!held) return;
    const def = itemDef(held.id);
    if (def?.use === "milk_bucket") {
      p.effects = [];
      g.drank("milk_bucket");
      if (p.survivalLike) this.replaceHeld({ id: itemId("bucket"), count: 1 });
      return;
    }
    if (def?.use === "drink") {
      const potion = potionOfItem(def.name);
      for (const fx of potion?.potion.effects ?? []) p.applyEffect(fx.effect, fx.seconds, fx.amp);
      g.drank(def.name);
      if (p.survivalLike) {
        // What the drink came in: a canteen goes back to empty, a carton is crushed, a bottle is kept.
        const empty = def.empty === undefined ? (def.name === "water_canteen" ? "canteen" : "glass_bottle") : def.empty;
        if (empty) this.replaceHeld({ id: itemId(empty), count: 1 });
        else this.consumeHeld();
      }
      g.bumpInv();
      return;
    }
    if (def) g.ate(def.name);
    p.eat(held, Math.random);
    if (p.survivalLike) {
      const remainder = def?.food?.remainder;
      if (remainder) this.replaceHeld({ id: itemId(remainder), count: 1 });
      else this.consumeHeld();
    }
    g.bumpInv();
  }

  private consumeHeld(n = 1): void {
    const g = this.game;
    if (!g.player.survivalLike) return;
    g.player.inventory.consumeHeld(n);
    g.bumpInv();
  }

  /** Swaps the held item for another (full bucket for empty), keeping the rest of a stack. */
  private replaceHeld(stack: ItemStack): void {
    const g = this.game;
    const inv = g.player.inventory;
    const held = inv.held;
    if (!g.player.survivalLike && !(itemDef(stack.id)?.name === "milk_bucket")) return;
    if (held && held.count > 1) {
      held.count--;
      const left = inv.add(stack);
      if (left > 0) this.throwStack({ ...stack, count: left });
    } else inv.slots[inv.selected] = stack;
    g.bumpInv();
  }

  // ---- blocks: interaction and placement ------------------------------------------------------

  /** Returns true when the click did something. */
  private useOnBlock(hit: BlockHit, def: ItemDef | undefined, fresh: boolean): boolean {
    const g = this.game;
    const p = g.player;
    const w = g.world;
    const { x, y, z } = hit;
    const id = w.blockAt(x, y, z);
    const bdef = block(id);
    const meta = w.getMeta(x, y, z);

    // The county's fittings first: a hammer or crowbar at a window or door, and the sneaking uses the vanilla path skips.
    if (fresh && id >= FIRST_WIDE_BLOCK && p.gameMode !== "spectator" && clickCountyBlock(g, this.countyHelpers, x, y, z, id, meta)) return true;
    if ((!p.sneaking || !def) && fresh && bdef.interact) {
      if (this.interactBlock(x, y, z, id, meta, def)) return true;
    }
    if (fresh && !p.sneaking && p.gameMode !== "adventure" && g.modOn("right_click_harvest") && this.harvestCrop(x, y, z, id, meta)) return true;
    // A berry bush in fruit gives up its berries to a hand, and grows more.
    if (fresh && !p.sneaking && isBerryBush(id) && (meta & 1) === 0 && p.gameMode !== "spectator") {
      g.world.setBlock(x, y, z, id, meta | 1, "player");
      const berry = itemId(id === B.MEJOBERRY_BUSH ? "mejoberry" : "narcoberry");
      g.dropItem(x + 0.5, y + 0.5, z + 0.5, { id: berry, count: 2 + Math.floor(Math.random() * 3) });
      g.blockSound(block(id).material, "break", x + 0.5, y + 0.5, z + 0.5, false);
      this.swing();
      return true;
    }
    if (fresh && id === B.DRAGON_EGG && !p.sneaking) {
      g.teleportEgg(x, y, z);
      this.swing();
      return true;
    }
    if (!def) return false;
    if (p.gameMode === "adventure") return false;
    if (fresh && def.use === "ender_eye" && id === B.END_PORTAL_FRAME && (meta & FRAME_EYE) === 0) {
      // Set in the frame; whoever simulates sees the change and lights the ring when it is the twelfth.
      w.setBlock(x, y, z, id, meta | FRAME_EYE, "player");
      g.sound("end_portal_frame_fill", x + 0.5, y + 0.8, z + 0.5, 1);
      g.particles("portal", x + 0.5, y + 1, z + 0.5, 12);
      if (p.survivalLike) this.consumeHeld();
      this.swing();
      return true;
    }
    if (fresh && def.use === "end_crystal") {
      if ((id !== B.OBSIDIAN && id !== B.BEDROCK) || hit.face !== Face.Up || w.blockAt(x, y + 1, z) !== B.AIR || w.blockAt(x, y + 2, z) !== B.AIR) return false;
      if (g.role === "guest") g.net?.placeCrystal?.(x, y, z);
      else g.placeCrystal(x, y, z);
      if (p.survivalLike) this.consumeHeld();
      this.swing();
      return true;
    }

    if (fresh && def.use === "rocket" && !p.gliding) {
      // Set off from the face that was clicked, a hair out from it.
      const [dx, dy, dz] = FACE_DIRS[hit.face];
      const x0 = hit.px + dx * 0.15, y0 = hit.py + dy * 0.15, z0 = hit.pz + dz * 0.15;
      const rocket = rocketOf(p.inventory.held);
      if (g.role === "guest") g.net?.launchFirework?.(x0, y0, z0, rocket);
      else g.launchFirework(x0, y0, z0, rocket, p.id);
      if (p.survivalLike) this.consumeHeld();
      this.swing();
      return true;
    }
    if (fresh && def.use === "item_frame") {
      // Hung on the face that was clicked, in the cell in front of it.
      const [dx, dy, dz] = FACE_DIRS[hit.face];
      const fx = x + dx, fy = y + dy, fz = z + dz;
      if (!bdef.solid || block(w.blockAt(fx, fy, fz)).solid) return false;
      if (g.role === "guest") g.net?.placeFrame?.(hit.face, fx, fy, fz);
      else if (!g.placeFrame(hit.face, fx, fy, fz)) return false;
      if (p.survivalLike) this.consumeHeld();
      this.swing();
      return true;
    }

    // Tools used on blocks.
    if (fresh) {
      if (def.use === "hoe" && (id === B.GRASS || id === B.DIRT || id === B.DIRT_PATH || id === B.COARSE_DIRT) && hit.face !== Face.Down && w.blockAt(x, y + 1, z) === 0) {
        w.setBlock(x, y, z, id === B.COARSE_DIRT ? B.DIRT : B.FARMLAND, 0, "player");
        g.blockSound("dirt", "place", x + 0.5, y + 1, z + 0.5);
        this.swing();
        this.wearHeld(1);
        return true;
      }
      if (def.tool?.type === "shovel" && id === B.GRASS && hit.face !== Face.Down && w.blockAt(x, y + 1, z) === 0) {
        w.setBlock(x, y, z, B.DIRT_PATH, 0, "player");
        g.blockSound("grass", "place", x + 0.5, y + 1, z + 0.5);
        this.swing();
        this.wearHeld(1);
        return true;
      }
      if (def.use === "shears" && id === B.PUMPKIN) {
        w.setBlock(x, y, z, B.CARVED_PUMPKIN, lookFacing(p.yaw) ^ 1, "player");
        g.sound("shear", x + 0.5, y + 0.5, z + 0.5);
        this.swing();
        this.wearHeld(1);
        return true;
      }
      if (def.use === "bone_meal") {
        if (g.role === "guest") return false;
        if (g.rules.boneMeal(x, y, z)) {
          g.particles("heart", x + 0.5, y + 1, z + 0.5, 0);
          g.particles("crit", x + 0.5, y + 0.8, z + 0.5, 8);
          this.consumeHeld();
          this.swing();
          return true;
        }
      }
      if (def.use === "flint_and_steel") {
        // A fire charge is spent where flint and steel only wears.
        const spend = () => { if (def.name === "fire_charge") { if (p.survivalLike) this.consumeHeld(); } else this.wearHeld(1); };
        if (id === B.TNT) {
          w.setBlock(x, y, z, B.AIR, 0, "player");
          if (g.role === "guest") g.net?.primeTnt(x, y, z, 80);
          else g.spawn(new PrimedTnt(x + 0.5, y, z + 0.5, 80));
          g.sound("fuse", x + 0.5, y + 0.5, z + 0.5);
          spend();
          this.swing();
          return true;
        }
        // Fire on the face clicked. Inside an obsidian frame it lights the portal on its first tick
        // (the host's rules do that, so a guest's spark lights it for everyone).
        const [nx, ny, nz] = FACE_NORMALS[hit.face];
        const fx = x + nx, fy = y + ny, fz = z + nz;
        const cur = w.getBlock(fx, fy, fz);
        const inFrame = findPortalFrame((a, b2, c) => w.getBlock(a, b2, c), fx, fy, fz) !== null;
        if (cur === B.AIR && (inFrame || supported(w, fx, fy, fz, B.FIRE, 0))) {
          const soul = !inFrame && (w.blockAt(fx, fy - 1, fz) === B.SOUL_SAND || w.blockAt(fx, fy - 1, fz) === B.SOUL_SOIL);
          w.setBlock(fx, fy, fz, soul ? B.SOUL_FIRE : B.FIRE, 0, "player");
        }
        g.sound(def.name === "fire_charge" ? "fire_charge" : "ignite", x + 0.5, y + 0.5, z + 0.5);
        spend();
        this.swing();
        return true;
      }
      if (def.use === "bucket") return this.fillBucket();
      if (def.use === "bottle" && this.fillBottle()) return true;
      if (def.use === "water_bucket" || def.use === "lava_bucket") return this.emptyBucket(hit, def);
    }

    if (fresh && (def.use === "boat" || def.use === "minecart")) return this.putVehicle(def, hit);
    if (def.places !== undefined) return this.place(hit, def);
    return false;
  }

  /**
   * Puts a boat on water (or on the ground), or a minecart on a rail. The host
   * creates it; a guest asks the host to.
   */
  private putVehicle(def: ItemDef, hit: BlockHit | null): boolean {
    const g = this.game;
    const p = g.player;
    let x: number, y: number, z: number, yaw = p.yaw;
    let kind = def.name;
    let wood = 0;
    if (def.use === "boat") {
      const water = this.fluidHit();
      if (water && g.world.blockAt(water.x, water.y, water.z) === B.WATER && (!hit || water.distance <= hit.distance)) {
        x = water.x + 0.5; y = water.y + 0.75; z = water.z + 0.5;
      } else if (hit && hit.face === Face.Up) {
        x = hit.px; y = hit.y + 1; z = hit.pz;
      } else return false;
      kind = "boat";
      wood = Math.max(0, ["oak", "spruce", "birch", "jungle", "acacia"].indexOf(def.name.replace(/_boat$/, "")));
    } else {
      if (!hit || !isRail(g.world.blockAt(hit.x, hit.y, hit.z))) return false;
      const id = g.world.blockAt(hit.x, hit.y, hit.z);
      const [e1, e2] = RAIL_EXITS[railShape(id, g.world.getMeta(hit.x, hit.y, hit.z))] ?? RAIL_EXITS[0];
      x = hit.x + 0.5; y = hit.y + 0.0625; z = hit.z + 0.5;
      yaw = Math.atan2(-(e2[0] - e1[0]), -(e2[2] - e1[2]));
    }
    if (g.role === "guest") g.net?.placeVehicle?.(kind, x, y, z, yaw, wood);
    else g.placeVehicle(kind, x, y, z, yaw, wood);
    this.consumeHeld();
    this.swing();
    return true;
  }

  private interactBlock(x: number, y: number, z: number, id: number, meta: number, held: ItemDef | undefined): boolean {
    const g = this.game;
    const w = g.world;
    switch (block(id).interact) {
      case "crafting":
        g.setScreen({ kind: "crafting", x, y, z });
        return true;
      case "furnace":
        g.containerAt(x, y, z, "furnace");
        g.setScreen({ kind: "furnace", x, y, z });
        return true;
      case "chest":
        g.lootIfFresh(x, y, z);
        g.containerAt(x, y, z, "chest");
        g.sound("chest_open", x + 0.5, y + 0.5, z + 0.5, 0.5);
        g.setScreen({ kind: "chest", x, y, z });
        return true;
      case "redstone":
        return this.useRedstone(x, y, z, id, meta);
      case "enchanting":
        g.setScreen({ kind: "enchanting", x, y, z });
        return true;
      case "anvil":
        g.setScreen({ kind: "anvil", x, y, z });
        return true;
      case "smithing":
        g.setScreen({ kind: "smithing", x, y, z });
        return true;
      case "waystone":
        g.useWaystone(x, y, z);
        return true;
      case "healing":
        if (g.critters.on) g.setScreen({ kind: "center", x, y, z });
        else g.showActionbar("Its dome glows softly, but there are no critters in this world to heal.");
        return true;
      case "grave":
        g.useGrave(x, y, z);
        this.swing();
        return true;
      case "cooking":
        g.setScreen({ kind: "cooking", x, y, z });
        return true;
      case "brewing":
        g.containerAt(x, y, z, "brewing");
        g.setScreen({ kind: "brewing", x, y, z });
        return true;
      case "cauldron":
        return this.useCauldron(x, y, z, meta, held);
      case "composter":
        return this.useComposter(x, y, z, meta, held);
      case "bell":
        g.sound("bell", x + 0.5, y + 0.5, z + 0.5, 1);
        this.swing();
        return true;
      case "door": {
        if (isTrapdoor(id)) {
          const open = (meta & 4) === 0;
          w.setBlock(x, y, z, id, meta ^ 4, "player");
          g.sound(open ? "door_open" : "door_close", x + 0.5, y + 0.5, z + 0.5, 0.6, 1.2);
          this.swing();
          return true;
        }
        const lowerY = meta & 8 ? y - 1 : y;
        const lower = w.getMeta(x, lowerY, z);
        // Boards nailed across it hold it shut: they have to come off first.
        if (boardsOf(lower) > 0) { g.message("It's boarded up. Pry the boards off first.", "#ffcc55"); return true; }
        const open = (lower & 4) === 0;
        const nl = open ? lower | 4 : lower & ~4;
        w.setBlock(x, lowerY, z, id, nl, "player");
        if (w.blockAt(x, lowerY + 1, z) === id) w.setBlock(x, lowerY + 1, z, id, nl | 8, "player");
        // Double doors (after Couplings): the other of a pair — beside it, facing the same way, hinged
        // on the other side, and in the same state this one was — swings with it.
        if (g.modOn("double_doors")) {
          for (const [dx, dz] of FACING_DIRS) {
            const om = w.getMeta(x + dx, lowerY, z + dz);
            if (w.blockAt(x + dx, lowerY, z + dz) !== id || om & 8 || (om & 3) !== (lower & 3) || (om & 16) === (lower & 16) || (om & 4) !== (lower & 4)) continue;
            const on = open ? om | 4 : om & ~4;
            w.setBlock(x + dx, lowerY, z + dz, id, on, "player");
            if (w.blockAt(x + dx, lowerY + 1, z + dz) === id) w.setBlock(x + dx, lowerY + 1, z + dz, id, on | 8, "player");
            break;
          }
        }
        g.sound(open ? "door_open" : "door_close", x + 0.5, y + 0.5, z + 0.5, 0.8);
        this.swing();
        return true;
      }
      case "bed":
        this.trySleep(x, y, z, meta);
        return true;
      case "tnt":
        // Lit with flint and steel, handled as an item use below.
        void held;
        return false;
      case "noteblock": {
        const pitch = (meta + 1) % 25;
        w.setBlock(x, y, z, id, pitch, "player");
        g.sound("note", x + 0.5, y + 0.5, z + 0.5, 1, 0.5 + pitch / 24 * 1.5);
        g.particles("note", x + 0.5, y + 1.2, z + 0.5, 1);
        this.swing();
        return true;
      }
    }
    return false;
  }

  /**
   * Right-click harvest (after the Right Click Harvest mod): a ripe crop gives
   * its harvest and is replanted where it stood, one seed kept back for it.
   */
  private harvestCrop(x: number, y: number, z: number, id: number, meta: number): boolean {
    const ripe = isCrop(id) ? meta >= CROP_MAX_AGE[id] : id === B.NETHER_WART && (meta & 3) === 3;
    if (!ripe) return false;
    const g = this.game;
    const stacks = cropDrops(id, meta, Math.random);
    const seed = itemId(REPLANT[id]);
    const kept = stacks.find((s) => s.id === seed);
    if (kept) kept.count--;
    g.world.setBlock(x, y, z, id, 0, "player");
    g.blockSound(block(id).material, "break", x + 0.5, y + 0.5, z + 0.5, false);
    g.particles("block", x + 0.5, y + 0.3, z + 0.5, 8, id, false);
    for (const s of stacks) if (s.count > 0) g.dropItem(x + 0.5, y + 0.3, z + 0.5, s);
    g.player.addExhaustion(0.005);
    this.swing();
    return true;
  }

  /** Flicking a lever, pressing a button, setting a repeater's delay or a comparator's mode, inverting a detector. */
  private useRedstone(x: number, y: number, z: number, id: number, meta: number): boolean {
    const g = this.game;
    const w = g.world;
    const click = (pitch: number) => g.sound("click", x + 0.5, y + 0.5, z + 0.5, 0.35, pitch);
    if (id === B.LEVER) {
      w.setBlock(x, y, z, id, meta ^ 8, "player");
      click((meta & 8) !== 0 ? 0.5 : 0.6);
    } else if (isButton(id)) {
      if ((meta & 8) === 0) {
        w.setBlock(x, y, z, id, meta | 8, "player");
        click(0.6);
      }
    } else if (id === B.REPEATER) {
      const delay = ((((meta >> 2) & 3) + 1) & 3) << 2;
      w.setBlock(x, y, z, id, (meta & ~12) | delay, "player");
      click(0.55);
    } else if (id === B.COMPARATOR) {
      w.setBlock(x, y, z, id, meta ^ 4, "player");
      click((meta & 4) !== 0 ? 0.5 : 0.55);
    } else if (id === B.DAYLIGHT_DETECTOR) {
      w.setBlock(x, y, z, id, meta ^ 16, "player");
      click(0.6);
    } else return false;
    this.swing();
    return true;
  }

  /** Six-way facing for a placed block: toward the player, including up or down when looking steeply. */
  private facing6(): number {
    const p = this.game.player;
    if (p.pitch < -0.8) return Face.Up;
    if (p.pitch > 0.8) return Face.Down;
    return FACE_OF_FACING[OPPOSITE_FACING[lookFacing(p.yaw)]];
  }

  private trySleep(x: number, y: number, z: number, meta: number): void {
    const g = this.game;
    const p = g.player;
    const [dx, dz] = FACING_DIRS[meta & 3];
    const hx = meta & 4 ? x : x + dx, hz = meta & 4 ? z : z + dz;
    if (!DIMENSION_INFO[g.dimension].bedsWork) {
      // The original's trap for the unwary: a bed anywhere but the overworld blows up.
      const fx = meta & 4 ? x - dx : x, fz = meta & 4 ? z - dz : z;
      g.world.setBlock(hx, y, hz, B.AIR, 0, "player");
      g.world.setBlock(fx, y, fz, B.AIR, 0, "player");
      if (g.role === "guest") g.net?.primeTnt(hx, y, hz, 1);
      else g.explode(hx + 0.5, y + 0.5, hz + 0.5, 5, null, true);
      return;
    }
    if (!g.isNight() && g.thunder < 0.5) {
      p.spawn = { x: hx, y, z: hz };
      g.showActionbar("Respawn point set — you can only sleep at night or during thunderstorms");
      return;
    }
    const b = p.body;
    if (Math.hypot(b.x - (hx + 0.5), b.z - (hz + 0.5)) > 3) { g.showActionbar("You may not rest now; the bed is too far away"); return; }
    for (const e of g.entities.values()) {
      if (e instanceof Mob && e.spec.hostile && Math.abs(e.x - b.x) < 8 && Math.abs(e.y - b.y) < 5 && Math.abs(e.z - b.z) < 8) {
        g.showActionbar("You may not rest now; there are monsters nearby");
        return;
      }
    }
    p.spawn = { x: hx, y, z: hz };
    p.sleeping = { x: hx, y, z: hz };
    p.sleepTicks = 0;
    b.x = hx + 0.5; b.z = hz + 0.5; b.y = y + 0.6;
    b.vx = b.vy = b.vz = 0;
    g.showActionbar("Respawn point set");
    g.net?.sleeping(true);
  }

  wakeUp(): void {
    const g = this.game;
    const p = g.player;
    if (!p.sleeping) return;
    const s = p.sleeping;
    p.sleeping = null;
    p.sleepTicks = 0;
    p.body.y = s.y + 0.6;
    g.net?.sleeping(false);
  }

  private collidesWithEntity(x: number, y: number, z: number, id: number, meta: number): boolean {
    const g = this.game;
    const boxes = collisionBoxes(block(id), meta);
    if (!boxes.length) return false;
    const bodies = [g.player.body, ...[...g.entities.values()].filter((e) => e instanceof Mob).map((e) => e.body)];
    for (const bx of boxes) {
      const box = { minX: x + bx[0] / 16, minY: y + bx[1] / 16, minZ: z + bx[2] / 16, maxX: x + bx[3] / 16, maxY: y + bx[4] / 16, maxZ: z + bx[5] / 16 };
      for (const b of bodies) {
        if (b === g.player.body && g.player.gameMode === "spectator") continue;
        if (aabbIntersects(box, bodyBox(b))) return true;
      }
      for (const r of g.remote.values()) {
        if (!r.dead && aabbIntersects(box, { minX: r.x - 0.3, minY: r.y, minZ: r.z - 0.3, maxX: r.x + 0.3, maxY: r.y + 1.8, maxZ: r.z + 0.3 })) return true;
      }
    }
    return false;
  }

  private place(hit: BlockHit, item: ItemDef): boolean {
    const g = this.game;
    const p = g.player;
    const w = g.world;
    const id = item.places!;
    const def = block(id);
    const clicked = w.blockAt(hit.x, hit.y, hit.z);
    const clickedMeta = w.getMeta(hit.x, hit.y, hit.z);
    const n = FACE_NORMALS[hit.face];
    const fracY = hit.py - Math.floor(hit.py);

    // A bottom slab clicked on its top (or a top slab from below) becomes a double slab in place.
    if (isSlab(id) && clicked === id && clickedMeta !== 2 && ((clickedMeta === 0 && hit.face === Face.Up) || (clickedMeta === 1 && hit.face === Face.Down))) {
      return this.commit(hit.x, hit.y, hit.z, id, 2, item);
    }

    let x = hit.x, y = hit.y, z = hit.z;
    const replaceTarget = block(clicked).replaceable && clicked !== B.WATER && clicked !== B.LAVA && clicked !== id;
    if (!replaceTarget) { x += n[0]; y += n[1]; z += n[2]; }
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cur = w.getBlock(x, y, z);
    if (cur < 0) return false;
    const curDef = block(cur);
    // Placing into water: only where the new block can hold it back.
    if (!(cur === 0 || curDef.replaceable)) {
      if (isSlab(id) && cur === id && w.getMeta(x, y, z) !== 2) return this.commit(x, y, z, id, 2, item);
      return false;
    }

    let meta = 0;
    const look = lookFacing(p.yaw);
    if (def.facing === "player") meta = OPPOSITE_FACING[look];
    else if (def.facing === "away") {
      meta = look;
      if (isStairs(id) && (hit.face === Face.Down || (hit.face !== Face.Up && fracY > 0.5))) meta |= 4;
    }
    if (isPillar(id)) {
      meta = hit.face === Face.Up || hit.face === Face.Down ? 0 : hit.face === Face.East || hit.face === Face.West ? 1 : 2;
    }
    if (isSlab(id)) meta = hit.face === Face.Down || (hit.face !== Face.Up && fracY > 0.5) ? 1 : 0;
    if (id === B.TORCH || isRedstoneTorch(id)) {
      if (hit.face === Face.Down) return false;
      if (hit.face === Face.Up) meta = 0;
      else meta = 1 + facingOfNormal(hit.face);
      if (!supported(w, x, y, z, id, meta)) {
        // Fall back to standing on the floor if the wall cannot hold it.
        if (supported(w, x, y, z, id, 0)) meta = 0;
        else return false;
      }
    }
    if (id === B.LADDER) {
      if (hit.face === Face.Up || hit.face === Face.Down) return false;
      meta = OPPOSITE_FACING[facingOfNormal(hit.face)];
    }
    if (id === B.LEVER || isButton(id)) {
      // Hangs on the face that was clicked; a floor lever lies along the way the player faces.
      const attach = OPPOSITE_FACE[hit.face];
      meta = attach;
      if (id === B.LEVER && (attach === Face.Down || attach === Face.Up) && look >= 2) meta |= 16;
      if (!supported(w, x, y, z, id, meta)) return false;
    }
    if (def.facing6) {
      // A hopper points into the block it was placed against; a shulker box opens away from it; the rest face the player.
      if (id === B.HOPPER) meta = hit.face === Face.Up || hit.face === Face.Down ? Face.Down : OPPOSITE_FACE[hit.face];
      else if (id === B.SHULKER_BOX) meta = hit.face | ((p.inventory.held?.color ?? 0) << 3);
      else meta = this.facing6();
    }
    if (isTrapdoor(id)) {
      const hinge = facingOfNormal(OPPOSITE_FACE[hit.face]);
      meta = hinge >= 0 ? hinge : OPPOSITE_FACING[look];
      if (hit.face === Face.Down || (hit.face !== Face.Up && fracY > 0.5)) meta |= 8;
    }
    if (isLeaves(id)) meta = 1; // placed leaves never decay
    // An end rod points out of the face it was set against.
    if (id === B.END_ROD) meta = hit.face;

    // Crops go on farmland; lily pads on water.
    if (item.use === "plant" && (isCrop(id))) {
      if (w.blockAt(x, y - 1, z) !== B.FARMLAND) return false;
    }
    if (id === B.LILY_PAD) {
      const fluid = this.fluidHit();
      if (!fluid || w.blockAt(fluid.x, fluid.y, fluid.z) !== B.WATER) return false;
      x = fluid.x; y = fluid.y + 1; z = fluid.z;
      if (w.blockAt(x, y, z) !== 0) return false;
    }
    const selfChecked = id === B.TORCH || isRedstoneTorch(id) || id === B.LADDER || isDoor(id) || isBed(id) || id === B.LEVER || isButton(id);
    if (def.needsSupport && !selfChecked && !supported(w, x, y, z, id, meta)) return false;

    if (isDoor(id)) {
      if (!block(w.blockAt(x, y - 1, z)).opaque) return false;
      const above = w.getBlock(x, y + 1, z);
      if (above < 0 || !(above === 0 || block(above).replaceable)) return false;
      const facing = look;
      // Hinge on the side away from a neighbouring door, so double doors open outward.
      const [lx, lz] = FACING_DIRS[CLOCKWISE_FACING[CLOCKWISE_FACING[CLOCKWISE_FACING[facing]]]];
      const hinge = w.blockAt(x + lx, y, z + lz) === id ? 16 : 0;
      if (this.collidesWithEntity(x, y, z, id, facing) || this.collidesWithEntity(x, y + 1, z, id, facing | 8)) return false;
      w.setBlock(x, y, z, id, facing | hinge, "player");
      w.setBlock(x, y + 1, z, id, facing | 8 | hinge, "player");
      return this.afterPlace(x, y, z, def, item);
    }
    if (isBed(id)) {
      const facing = look;
      const [dx, dz] = FACING_DIRS[facing];
      const hx = x + dx, hz = z + dz;
      const headCur = w.getBlock(hx, y, hz);
      if (headCur < 0 || !(headCur === 0 || block(headCur).replaceable)) return false;
      if (!block(w.blockAt(x, y - 1, z)).solid || !block(w.blockAt(hx, y - 1, hz)).solid) return false;
      w.setBlock(x, y, z, id, facing, "player");
      w.setBlock(hx, y, hz, id, facing | 4, "player");
      return this.afterPlace(x, y, z, def, item);
    }
    if (isRail(id)) {
      // Track joins the track around it, and the ends it meets swing round to it.
      const get = (a: number, b: number, c: number) => w.blockAt(a, b, c);
      const gm = (a: number, b: number, c: number) => w.getMeta(a, b, c);
      meta = placedShape(get, gm, id, x, y, z, look >= 2);
      if (!this.commit(x, y, z, id, meta, item)) return false;
      for (const [nx, ny, nz, nm] of neighboursToReshape(get, gm, x, y, z)) w.setBlock(nx, ny, nz, w.blockAt(nx, ny, nz), nm, "player");
      return true;
    }
    if (this.collidesWithEntity(x, y, z, id, meta)) return false;
    return this.commit(x, y, z, id, meta, item);
  }

  private commit(x: number, y: number, z: number, id: number, meta: number, item: ItemDef): boolean {
    const g = this.game;
    const held = g.player.inventory.held;
    if (!g.world.setBlock(x, y, z, id, meta, "player")) return false;
    const def = block(id);
    if (def.interact === "chest") g.containerAt(x, y, z, "chest");
    // A shulker box unpacks what it carried as it is set down.
    if (id === B.SHULKER_BOX && held?.contents) {
      const box = g.containerAt(x, y, z, "chest");
      if (box.kind === "chest") held.contents.forEach((s, i) => { if (i < box.items.length) box.items[i] = s ? { ...s } : null; });
      g.containerChanged(x, y, z);
    }
    if (def.interact === "furnace") g.containerAt(x, y, z, "furnace");
    return this.afterPlace(x, y, z, def, item);
  }

  private afterPlace(x: number, y: number, z: number, def: BlockDef, _item: ItemDef): boolean {
    const g = this.game;
    g.blockSound(def.material, "place", x + 0.5, y + 0.5, z + 0.5, false);
    this.swing();
    this.consumeHeld();
    return true;
  }

  private fluidHit(): BlockHit | null {
    const g = this.game;
    const p = g.player;
    const b = p.body;
    const d = this.dir;
    return raycastBlocks(g.world, b.x, b.y + b.eyeHeight, b.z, d.x, d.y, d.z, 5, true);
  }

  private fillBucket(): boolean {
    const g = this.game;
    const hit = this.fluidHit();
    if (!hit) return false;
    const id = g.world.blockAt(hit.x, hit.y, hit.z);
    if (!isFluid(id) || (g.world.getMeta(hit.x, hit.y, hit.z) & 15) !== 0) return false;
    g.world.setBlock(hit.x, hit.y, hit.z, B.AIR, 0, "player");
    g.sound("bucket_fill", hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    const full = { id: itemId(id === B.WATER ? "water_bucket" : "lava_bucket"), count: 1 };
    if (g.player.survivalLike) this.replaceHeld(full);
    this.swing();
    return true;
  }

  private emptyBucket(hit: BlockHit, def: ItemDef): boolean {
    const g = this.game;
    const n = FACE_NORMALS[hit.face];
    const clicked = g.world.blockAt(hit.x, hit.y, hit.z);
    let x = hit.x, y = hit.y, z = hit.z;
    if (!block(clicked).replaceable) { x += n[0]; y += n[1]; z += n[2]; }
    const cur = g.world.getBlock(x, y, z);
    if (cur < 0 || !(cur === 0 || block(cur).replaceable || isFluid(cur))) return false;
    const fluid = def.use === "water_bucket" ? B.WATER : B.LAVA;
    if (fluid === B.WATER && DIMENSION_INFO[g.dimension].waterEvaporates) {
      // Too hot for water: it boils off in a puff, as in the original.
      g.sound("fizz", x + 0.5, y + 0.5, z + 0.5, 0.6);
      g.particles("smoke", x + 0.5, y + 0.5, z + 0.5, 8);
      if (g.player.survivalLike) this.replaceHeld({ id: itemId("bucket"), count: 1 });
      this.swing();
      return true;
    }
    g.world.setBlock(x, y, z, fluid, 0, "player");
    g.sound("bucket_empty", x + 0.5, y + 0.5, z + 0.5);
    if (g.player.survivalLike) this.replaceHeld({ id: itemId("bucket"), count: 1 });
    this.swing();
    return true;
  }

  private emptyBucketAtFluid(def: ItemDef): boolean {
    const hit = this.fluidHit();
    return hit ? this.emptyBucket(hit, def) : false;
  }

  // ---- items ---------------------------------------------------------------------------------

  /** Throws a stack out in front of the player. */
  throwStack(stack: ItemStack): void {
    const g = this.game;
    const p = g.player;
    const b = p.body;
    const d = this.dir.lengthSq() > 0 ? this.dir : new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    g.dropItem(b.x, b.y + b.eyeHeight - 0.3, b.z, stack, d.x * 0.3, d.y * 0.3 + 0.1, d.z * 0.3, p.id, 40);
  }

  private dropHeld(all: boolean): void {
    const g = this.game;
    const p = g.player;
    const held = p.inventory.held;
    if (!held || p.dead) return;
    const n = all ? held.count : 1;
    this.throwStack({ ...held, count: n });
    held.count -= n;
    if (held.count <= 0) p.inventory.slots[p.inventory.selected] = null;
    this.swing();
    g.bumpInv();
  }

  private pickBlock(): void {
    const g = this.game;
    const t = this.target?.block;
    if (!t) return;
    const inv = g.player.inventory;
    let id = g.world.blockAt(t.x, t.y, t.z);
    if (id === B.LIT_FURNACE) id = B.FURNACE;
    if (isDoor(id)) id = doorItem(id);
    if (id === B.REDSTONE_WIRE) id = itemId("redstone");
    if (id === B.REDSTONE_TORCH_OFF) id = B.REDSTONE_TORCH;
    if (id === B.REDSTONE_LAMP_ON) id = B.REDSTONE_LAMP;
    if (id === B.PISTON_HEAD) id = (g.world.getMeta(t.x, t.y, t.z) & 8) !== 0 ? B.STICKY_PISTON : B.PISTON;
    if (isBed(id)) id = bedItem(id);
    if (id === B.WHEAT) id = itemId("wheat_seeds");
    if (id === B.CARROTS) id = itemId("carrot");
    if (id === B.POTATOES) id = itemId("potato");
    if (!itemDef(id)) return;
    const inHotbar = inv.slots.findIndex((s, i) => i < 9 && s?.id === id);
    if (inHotbar >= 0) { inv.selected = inHotbar; g.bumpInv(); return; }
    if (g.player.gameMode === "creative") {
      const empty = inv.slots.findIndex((s, i) => i < 9 && !s);
      const slot = empty >= 0 ? empty : inv.selected;
      inv.slots[slot] = { id, count: 1 };
      inv.selected = slot;
      g.bumpInv();
      return;
    }
    const elsewhere = inv.slots.findIndex((s, i) => i >= 9 && s?.id === id);
    if (elsewhere >= 0) {
      const tmp = inv.slots[inv.selected];
      inv.slots[inv.selected] = inv.slots[elsewhere];
      inv.slots[elsewhere] = tmp;
      g.bumpInv();
    }
  }
}

