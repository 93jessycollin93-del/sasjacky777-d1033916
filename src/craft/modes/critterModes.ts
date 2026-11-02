/**
 * The critter modes' runtimes (after Pokémon, and the Minecraft mods Pixelmon
 * and Cobblemon). Battles themselves are each player's own and run on their
 * own machine (game/critterPlay.ts); what runs here, on the host, is the
 * world they happen in: the region's trainers standing at their posts, the
 * legend on its summit, wanderers on open terrain, the park's clock and score.
 */
import { Mob } from "../engine/mobs";
import { SPECIES, wildLevelAt } from "../engine/critters";
import { biomeDef } from "../engine/biomes";
import { block, isFluid } from "../engine/blocks";
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime } from "./runtime";

/** Trainers stand at their posts only while someone is near enough to meet them. */
const NPC_NEAR = 64, NPC_FAR = 112;

class RegionRuntime extends ModeRuntime {
  private where = new Map<string, string>();

  start(): void {
    const oneLife = !!this.def.critters?.nuzlocke;
    this.title(null, this.def.name, oneLife ? "One catch per area. A fainted critter is gone." : "Gotta meet them all.");
    this.tell(null, "Professor Wren's lab is by the road — choose your first critter. Right-click a wild critter to battle it; weaken it, then throw an orb from your bag.", "#aaffaa");
    this.tell(null, "Trainers along the road will challenge you when you walk into their sight. Heal at the white halls with red roofs. P opens your party.", "#aaffaa");
    if (oneLife) this.tell(null, "One-life rules: only the first critter you battle in each area may be caught, and any that faints is released.", "#ffaa66");
  }

  second(): void {
    if (!this.home) return;
    const l = this.layout();
    if (!l) return;
    const g = this.game;
    const players = this.alive();
    // The region's trainers: at their posts when someone is near, gone when nobody is (and never twice).
    const have = new Map<string, Mob[]>();
    for (const e of g.entities.values()) {
      if (e instanceof Mob && e.kind === "trainer" && e.trainerId && e.partnerUid !== "npc") (have.get(e.trainerId) ?? have.set(e.trainerId, []).get(e.trainerId)!).push(e);
    }
    for (const n of l.npcs ?? []) {
      const list = have.get(n.id) ?? [];
      for (const extra of list.slice(1)) extra.removed = true;
      const d = Math.min(Infinity, ...players.map((p) => Math.hypot(p.x - n.x, p.z - n.z)));
      if (!list.length && d < NPC_NEAR && g.world.isLoaded(Math.floor(n.x), Math.floor(n.z))) {
        const m = new Mob("trainer", n.x, n.y, n.z);
        m.trainerId = n.id;
        m.home = { x: n.x, z: n.z };
        m.homeYaw = n.yaw;
        m.yaw = n.yaw;
        g.spawn(m);
      } else if (list.length && d > NPC_FAR) list[0].removed = true;
    }
    // The legend, on its summit, until someone catches it.
    if (l.legend && this.data.legend !== true) {
      const [lx, ly, lz] = l.legend;
      const near = players.some((p) => Math.hypot(p.x - lx, p.z - lz) < 48);
      const there = [...g.entities.values()].some((e) => e instanceof Mob && e.kind === "critter" && e.species === "glaciarch" && !e.owner);
      if (near && !there && g.world.isLoaded(Math.floor(lx), Math.floor(lz))) {
        const m = new Mob("critter", lx, ly, lz);
        m.setSpecies("glaciarch", 60);
        m.persistent = true;
        g.spawn(m);
        this.tell(null, "A cold wind comes down from the summit. Something is up there.", "#aaddff");
      }
    }
    // Where each player is: the name of a town or a route as they come into it.
    for (const p of players) {
      const a = (l.areas ?? []).find((r) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1);
      const name = a?.name ?? "";
      if (name && this.where.get(p.id) !== name) this.tell(p.id, `— ${name[0].toUpperCase()}${name.slice(1)} —`, "#e8e0b0");
      this.where.set(p.id, name);
    }
  }

  onCritterCaught(player: string, species: string): void {
    if (species !== "glaciarch") return;
    this.data.legend = true;
    const who = this.players().find((p) => p.id === player)?.name ?? "Someone";
    this.title(null, "Glaciarch was caught!", `by ${who}`);
  }
}

/** Critter Craft: open terrain. A healing station to start a base with, and trainers wandering the land. */
class CraftRuntime extends ModeRuntime {
  private nextWanderer = 40;

  start(): void {
    this.title(null, "Critter Craft", "Every land has its own critters.");
    this.tell(null, "Choose your first critter, then go and find the rest: each lives in its own kind of land. Right-click one to battle it; P opens your party.", "#aaffaa");
    this.tell(null, "You have a healing station — put it down at your base. Orbs and medicine can be crafted, or bought with coins won from trainers.", "#aaffaa");
    this.giveAll([["healing_station", 1], ["capture_orb", 5]]);
  }

  second(): void {
    if (!this.home) return;
    const g = this.game;
    const players = this.alive();
    // Wanderers leave once nobody is near.
    const wanderers = [...g.entities.values()].filter((e): e is Mob => e instanceof Mob && e.kind === "trainer" && !!e.trainerId?.startsWith("w:"));
    for (const w of wanderers) if (!players.some((p) => Math.hypot(p.x - w.x, p.z - w.z) < 80)) w.removed = true;
    if (--this.nextWanderer > 0 || !players.length) return;
    this.nextWanderer = 60 + Math.floor(Math.random() * 60);
    if (wanderers.length >= players.length * 2) return;
    const who = players[Math.floor(Math.random() * players.length)];
    const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 12;
    const x = Math.floor(who.x + Math.cos(a) * r), z = Math.floor(who.z + Math.sin(a) * r);
    const chunk = g.world.chunkAt(x, z);
    if (!chunk) return;
    const top = g.world.topSolid(x, z);
    if (top < 1 || !block(g.world.blockAt(x, top, z)).solid || isFluid(g.world.blockAt(x, top + 1, z))) return;
    const biome = biomeDef(chunk.biomes[((z & 15) << 4) | (x & 15)]).name;
    const spawn = g.worldSpawn();
    const level = wildLevelAt(Math.hypot(x - spawn.x, z - spawn.z), Math.random) + 2;
    const m = new Mob("trainer", x + 0.5, top + 1, z + 0.5);
    m.trainerId = `w:${(Math.random() * 0x7fffffff) | 0}:${level}:${biome}`;
    m.home = { x: x + 0.5, z: z + 0.5 };
    // Facing the player they were sent near, so they notice them.
    m.homeYaw = m.yaw = Math.atan2(-(who.x - x), -(who.z - z));
    g.spawn(m);
  }
}

/** Points for a catch in the park: rarer is worth more; a rare colour most of all. */
export function safariPoints(species: string, shiny = false): number {
  const r = SPECIES[species]?.rarity;
  return (r === "legendary" ? 30 : r === "rare" ? 8 : r === "uncommon" ? 3 : 1) + (shiny ? 10 : 0);
}

const SAFARI_SECONDS = 600;

class SafariRuntime extends ModeRuntime {
  private get scores(): Record<string, number> { return ((this.data.scores as Record<string, number> | undefined) ??= {}); }
  private get given(): string[] { return ((this.data.given as string[] | undefined) ??= []); }

  start(): void {
    this.data.left = SAFARI_SECONDS;
    this.title(null, "Safari Park", "Ten minutes. Thirty orbs. Go!");
    this.tell(null, "Walk up to a critter and use it. No battles here: throw an orb, or bait to calm it, or mud to make it easier to hit — and harder to keep.", "#aaffaa");
  }

  second(): void {
    if (!this.home) return;
    // Everyone gets their thirty orbs, whenever they arrive.
    for (const p of this.players()) {
      if (this.given.includes(p.name)) continue;
      this.given.push(p.name);
      const s = ModeRuntime.stack("park_orb", 30);
      if (s) this.give(p.id, s);
    }
    if (this.data.over) return;
    const left = ((this.data.left as number | undefined) ?? SAFARI_SECONDS) - 1;
    this.data.left = left;
    if (left === 60) this.tell(null, "One minute left in the park!", "#ffdd55");
    if (left > 0) return;
    this.data.over = true;
    const ranked = Object.entries(this.scores).sort((a, b) => b[1] - a[1]);
    if (ranked.length) this.title(null, `${ranked[0][0]} wins!`, `${ranked[0][1]} points`);
    else this.title(null, "Time's up!", "Nobody caught anything. The critters win.");
    this.tell(null, "\"/mode restart\" for another round.", "#aaffaa");
  }

  onCritterCaught(player: string, species: string): void {
    if (this.data.over) return;
    const p = this.players().find((x) => x.id === player);
    if (!p) return;
    const pts = safariPoints(species);
    this.scores[p.name] = (this.scores[p.name] ?? 0) + pts;
    this.tell(null, `${p.name} caught a ${SPECIES[species]?.name ?? species} (+${pts})`, "#e8e0b0");
  }

  objective(): Objective {
    const left = (this.data.left as number | undefined) ?? SAFARI_SECONDS;
    const ranked = Object.entries(this.scores).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      title: "Safari Park",
      lines: [[this.data.over ? "Finished" : "Time left", ModeRuntime.clock(Math.max(0, left))], ...ranked.map(([n, s]): [string, string] => [n, String(s)])],
    };
  }

  restart(): string {
    this.data.left = SAFARI_SECONDS;
    this.data.over = false;
    this.data.scores = {};
    this.data.given = [];
    this.title(null, "Safari Park", "A new round: thirty more orbs each.");
    return "The park reopens.";
  }
}

/** The Battle Spire: the battles are the players' own; the spire only tells them how it works. */
class SpireRuntime extends ModeRuntime {
  start(): void {
    this.title(null, "Battle Spire", "How far can you go?");
    this.tell(null, "Pick three rentals, then step onto the emerald pad for your next challenger. Your critters are healed between battles; lose once and the run is over.", "#aaffaa");
  }
}

registerRuntime("critter_quest", (g, d, s) => new RegionRuntime(g, d, s));
registerRuntime("critter_nuzlocke", (g, d, s) => new RegionRuntime(g, d, s));
registerRuntime("critter_craft", (g, d, s) => new CraftRuntime(g, d, s));
registerRuntime("critter_safari", (g, d, s) => new SafariRuntime(g, d, s));
registerRuntime("battle_spire", (g, d, s) => new SpireRuntime(g, d, s));
