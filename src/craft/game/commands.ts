/**
 * Chat commands, the familiar set: /time, /gamemode, /give, /tp, /weather,
 * /kill, /seed, /spawnpoint, /difficulty, /gamerule, /clear, /summon, /enchant,
 * /effect, /xp, /setblock, /fill, /mode, /help.
 *
 * World-changing commands need cheats on (as a world option) or creative
 * mode, as in the original. An online guest can only run the ones that affect
 * nobody else — the host owns the world.
 */
import { DUNGEON_REGION, dungeonsInRegion } from "../engine/dungeons";
import { cityInRegion, CITY_REGION, END_SPAWN, EndGenerator } from "../engine/end";
import { nearestStronghold } from "../engine/stronghold";
import { blockByName } from "../engine/blocks";
import { DAY_TICKS, WORLD_HEIGHT } from "../engine/constants";
import { allItems, itemByName, itemDef, type StatusEffect } from "../engine/items";
import { canApply, compatible, enchantDef, enchantLabel, ENCHANTMENTS } from "../engine/enchanting";
import { isCubeMob, Mob, MOB_KINDS, type MobKind } from "../engine/mobs";
import { addCritter, makeCritter, restore, SPECIES, SPECIES_IDS } from "../engine/critters";
import { DIMENSION_INFO, isDimension } from "../engine/dimension";
import { fortressInRegion, FORTRESS_REGION } from "../engine/nether";
import { Generator } from "../engine/worldgen";
import { PROFESSIONS, villageInRegion, VILLAGE_REGION, type Profession } from "../engine/villages";
import type { GameMode } from "../engine/player";
import { modeDef, MODES as GAME_MODES } from "../modes/modes";
import type { Game } from "./game";
import { jdFromMs } from "../space/kepler";
import { nextPhase } from "../space/sky";
import { describeSky, jdOfLocal, localClock, localDay, nextCentralEclipse, nextSeenEclipse, nextShowerPeak, placeText, SHOWER_NAMES } from "../space/skyReport";
import { DEFAULT_RULES, type GameRules } from "./save";

interface Line { text: string; color?: string }

const ERR = "#ff6666";
const OK = "#aaaaaa";

const MODES: Record<string, GameMode> = {
  survival: "survival", s: "survival", "0": "survival",
  creative: "creative", c: "creative", "1": "creative",
  adventure: "adventure", a: "adventure", "2": "adventure",
  spectator: "spectator", sp: "spectator", "3": "spectator",
};

const HELP = [
  "/time set day|noon|night|midnight|<ticks>, /time add <ticks>",
  "/gamemode survival|creative|adventure|spectator",
  "/give <item> [count]   (e.g. /give diamond_pickaxe)",
  "/tp <x> <y> <z>, /tp spawn",
  "/setblock <x> <y> <z> <block>, /fill <x1> <y1> <z1> <x2> <y2> <z2> <block>",
  "/weather clear|rain|thunder",
  "/summon <mob> [size|profession]  (pig, cow, ..., slime 4, villager librarian, iron_golem)",
  "/critter give <species> [level] | wild <species> [level] | heal | coins <n> | list",
  "/battle <player>, /trade <player>, /accept, /decline   (critter link battles and trades)",
  "/space, /space land, /space home   (launch to orbit, and come back down)",
  "/sky   (what is up tonight), /sky now | date <yyyy-mm-dd> [hh:mm] | moon new|full|first|last | eclipse [solar|lunar] | chase [annular] | shower <name> | place [home]",
  "/effect <speed|strength|fire_resistance|...> [seconds] [level] | /effect clear",
  "/enchant <enchantment> [level]   (the held item, e.g. /enchant sharpness 5)",
  "/xp add <amount>, /clear, /kill, /seed, /spawnpoint",
  "/locate village|fortress|stronghold|end_city|catacombs|spider_cave, /dimension overworld|nether|end",
  "/difficulty peaceful|easy|normal|hard, /gamerule <rule> <true|false>",
  "/mode [info|restart|list]   (this world's game mode)",
];

export function runCommand(game: Game, line: string): Line[] {
  const [cmd, ...args] = line.trim().split(/\s+/);
  const p = game.player;
  const cheats = game.meta.cheats || p.gameMode === "creative";
  const guest = game.role === "guest";
  const needCheats = (): Line[] | null => (cheats ? null : [{ text: "Cheats are off in this world. Turn on \"Allow cheats\" when creating a world.", color: ERR }]);
  const needHost = (): Line[] | null => (guest ? [{ text: "Only the host can change the world online.", color: ERR }] : null);
  const num = (v: string | undefined, rel: number) => {
    if (v === undefined) return NaN;
    if (v.startsWith("~")) return rel + (v.length > 1 ? Number(v.slice(1)) : 0);
    return Number(v);
  };

  switch ((cmd ?? "").toLowerCase()) {
    case "help": case "?":
      return HELP.map((text) => ({ text, color: OK }));
    case "mode": {
      const def = modeDef(game.meta.mode?.id);
      const sub = (args[0] ?? "info").toLowerCase();
      if (sub === "list") return GAME_MODES.map((m) => ({ text: `${m.name} (${m.id}) — ${m.goal}`, color: OK }));
      if (!def) return [{ text: "This world has no game mode: it is plain survival or creative. Pick one when creating a world." }];
      if (sub === "restart") {
        const denied = needHost();
        if (denied) return denied;
        if (!game.mode) return [{ text: "The mode is not running here.", color: ERR }];
        return [{ text: game.mode.restart() }];
      }
      return [
        { text: `${def.name}: ${def.description}` },
        { text: `Goal: ${def.goal}`, color: OK },
        ...(def.inspiredBy ? [{ text: `Inspired by ${def.inspiredBy}.`, color: OK }] : []),
      ];
    }
    case "seed":
      return [{ text: `Seed: ${game.meta.seed}${game.meta.seedText && game.meta.seedText !== String(game.meta.seed) ? ` ("${game.meta.seedText}")` : ""}` }];
    case "time": {
      const denied = needCheats() ?? needHost();
      if (denied) return denied;
      const named: Record<string, number> = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 };
      const [op, value] = args;
      const day = Math.floor(game.time / DAY_TICKS) * DAY_TICKS;
      if (op === "set") {
        const t = named[value] ?? Number(value);
        if (!Number.isFinite(t)) return [{ text: "Usage: /time set day|noon|night|midnight|<ticks>", color: ERR }];
        game.time = day + (t % DAY_TICKS);
        return [{ text: `Set the time to ${t}` }];
      }
      if (op === "add") {
        const t = Number(value);
        if (!Number.isFinite(t)) return [{ text: "Usage: /time add <ticks>", color: ERR }];
        game.time += t;
        return [{ text: `Added ${t} to the time` }];
      }
      return [{ text: `The time is ${game.time % DAY_TICKS} (day ${Math.floor(game.time / DAY_TICKS)})` }];
    }
    case "gamemode": case "gm": {
      const denied = needCheats();
      if (denied) return denied;
      const mode = MODES[(args[0] ?? "").toLowerCase()];
      if (!mode) return [{ text: "Usage: /gamemode survival|creative|adventure|spectator", color: ERR }];
      p.setGameMode(mode);
      game.bumpInv();
      return [{ text: `Set own game mode to ${mode[0].toUpperCase()}${mode.slice(1)} Mode` }];
    }
    case "give": {
      const denied = needCheats();
      if (denied) return denied;
      const name = (args[0] ?? "").replace(/^minecraft:/, "").toLowerCase();
      let def;
      try { def = itemByName(name); } catch {
        const near = allItems().filter((i) => i.name.includes(name)).slice(0, 5).map((i) => i.name);
        return [{ text: `Unknown item "${name}".${near.length ? ` Did you mean: ${near.join(", ")}?` : ""}`, color: ERR }];
      }
      const count = Math.max(1, Math.min(64 * 36, Number(args[1] ?? 1) || 1));
      let left = count;
      while (left > 0) {
        const n = Math.min(left, def.maxStack);
        const rest = p.inventory.add({ id: def.id, count: n });
        if (rest > 0) { game.actions.throwStack({ id: def.id, count: rest }); }
        left -= n;
      }
      game.bumpInv();
      return [{ text: `Gave ${count} [${def.displayName}] to ${p.name}` }];
    }
    case "tp": case "teleport": {
      const denied = needCheats();
      if (denied) return denied;
      const b = p.body;
      if (args[0] === "spawn") {
        const s = game.worldSpawn();
        b.x = s.x; b.z = s.z; b.y = game.surfaceAt(s.x, s.z);
      } else {
        const x = num(args[0], b.x), y = num(args[1], b.y), z = num(args[2], b.z);
        if (![x, y, z].every(Number.isFinite)) return [{ text: "Usage: /tp <x> <y> <z> (~ for relative)", color: ERR }];
        b.x = x; b.y = y; b.z = z;
      }
      b.vx = b.vy = b.vz = 0;
      b.fallDistance = 0;
      p.prevX = b.x; p.prevY = b.y; p.prevZ = b.z;
      return [{ text: `Teleported ${p.name} to ${b.x.toFixed(1)}, ${b.y.toFixed(1)}, ${b.z.toFixed(1)}` }];
    }
    case "weather": {
      const denied = needCheats() ?? needHost();
      if (denied) return denied;
      const w = game.meta.weather;
      const kind = args[0];
      if (kind === "clear") { w.rain = 0; w.thunder = 0; w.rainTimer = 12000 + Math.floor(Math.random() * 168000); }
      else if (kind === "rain") { w.rain = 1; w.thunder = 0; w.rainTimer = 12000 + Math.floor(Math.random() * 12000); }
      else if (kind === "thunder") { w.rain = 1; w.thunder = 1; w.rainTimer = 12000; w.thunderTimer = 12000; }
      else return [{ text: "Usage: /weather clear|rain|thunder", color: ERR }];
      return [{ text: `Set the weather to ${kind}` }];
    }
    case "setblock": case "fill": {
      const denied = needCheats() ?? needHost();
      if (denied) return denied;
      const fill = cmd.toLowerCase() === "fill";
      const n = fill ? 6 : 3;
      const b = p.body;
      const here = [b.x, b.y, b.z];
      const c = args.slice(0, n).map((v, i) => Math.floor(num(v, here[i % 3])));
      const usage = fill ? "Usage: /fill <x1> <y1> <z1> <x2> <y2> <z2> <block> (~ for relative)" : "Usage: /setblock <x> <y> <z> <block> (~ for relative)";
      if (c.length < n || !c.every(Number.isFinite)) return [{ text: usage, color: ERR }];
      const name = (args[n] ?? "").replace(/^minecraft:/, "").toLowerCase();
      let id: number;
      try { id = name === "air" ? 0 : blockByName(name).id; } catch { return [{ text: `Unknown block "${name}".`, color: ERR }]; }
      const [x1, y1, z1] = c, [x2, y2, z2] = fill ? c.slice(3) : c;
      const lo = [Math.min(x1, x2), Math.max(0, Math.min(y1, y2)), Math.min(z1, z2)];
      const hi = [Math.max(x1, x2), Math.min(WORLD_HEIGHT - 1, Math.max(y1, y2)), Math.max(z1, z2)];
      const volume = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
      if (volume > 32768) return [{ text: `Too many blocks in the specified area (${volume} > 32768)`, color: ERR }];
      let changed = 0, unloaded = 0;
      for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) {
        if (!game.world.isLoaded(x, z)) { unloaded++; continue; }
        if (game.world.setBlock(x, y, z, id, 0, "player")) changed++;
      }
      // Blocks outside the loaded world are not silently "done": say how many were skipped.
      const skipped = unloaded ? ` (${unloaded} in unloaded chunks were not changed — go closer)` : "";
      return [{ text: fill ? `Successfully filled ${changed} block(s)${skipped}` : changed ? `Changed the block at ${x1}, ${y1}, ${z1}` : `Could not set the block${skipped}`, color: unloaded ? ERR : undefined }];
    }
    case "kill":
      p.hurt(1000, "void");
      return [];
    case "clear": {
      const denied = needCheats();
      if (denied) return denied;
      p.inventory.clear();
      game.bumpInv();
      return [{ text: `Removed all items from ${p.name}` }];
    }
    case "spawnpoint": {
      const denied = needCheats();
      if (denied) return denied;
      const b = p.body;
      p.spawn = { x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z) };
      return [{ text: `Set spawn point to ${p.spawn.x}, ${p.spawn.y}, ${p.spawn.z}` }];
    }
    case "setworldspawn": {
      const denied = needCheats() ?? needHost();
      if (denied) return denied;
      const b = p.body;
      game.meta.spawn = { x: Math.floor(b.x) + 0.5, y: Math.floor(b.y), z: Math.floor(b.z) + 0.5 };
      return [{ text: "Set the world spawn point" }];
    }
    case "difficulty": {
      const denied = needCheats() ?? needHost();
      if (denied) return denied;
      const names = ["peaceful", "easy", "normal", "hard"];
      const d = names.indexOf((args[0] ?? "").toLowerCase());
      if (d < 0) return [{ text: `The difficulty is ${names[game.meta.difficulty]}` }];
      if (game.meta.hardcore) return [{ text: "Difficulty is locked to hard in hardcore worlds", color: ERR }];
      game.meta.difficulty = d as 0 | 1 | 2 | 3;
      return [{ text: `The difficulty has been set to ${names[d]}` }];
    }
    case "gamerule": {
      const denied = needCheats() ?? needHost();
      if (denied) return denied;
      const rules = game.meta.rules;
      const key = args[0] as keyof GameRules;
      // Against the defaults, so a rule added since the world was made can still be set.
      const all = { ...DEFAULT_RULES, ...rules };
      if (!key || !(key in DEFAULT_RULES)) return [{ text: `Game rules: ${Object.entries(all).map(([k, v]) => `${k}=${v}`).join(", ")}` }];
      if (args[1] === undefined) return [{ text: `${key} = ${all[key]}` }];
      if (args[1] !== "true" && args[1] !== "false") return [{ text: "Use true or false", color: ERR }];
      rules[key] = args[1] === "true";
      return [{ text: `Game rule ${key} is now set to ${args[1]}` }];
    }
    case "summon": {
      const denied = needCheats() ?? needHost();
      if (denied) return denied;
      const kind = (args[0] ?? "").replace(/^minecraft:/, "") as MobKind;
      if (!MOB_KINDS.includes(kind)) return [{ text: `Usage: /summon ${MOB_KINDS.join("|")}`, color: ERR }];
      const b = p.body;
      const d = 2;
      const mob = new Mob(kind, b.x - Math.sin(p.yaw) * d, b.y, b.z - Math.cos(p.yaw) * d);
      if (isCubeMob(kind) && args[1] !== undefined) {
        const size = Number(args[1]);
        if (size !== 1 && size !== 2 && size !== 4) return [{ text: `A ${kind.replace("_", " ")}'s size is 1, 2 or 4`, color: ERR }];
        mob.setSize(size);
      }
      if (kind === "villager" && args[1] !== undefined) {
        const job = args[1].toLowerCase() as Profession;
        if (!PROFESSIONS.includes(job)) return [{ text: `A villager's profession is one of ${PROFESSIONS.join(", ")}`, color: ERR }];
        mob.setProfession(job);
      }
      // A summoned villager or golem keeps to where it was summoned, as one from a village keeps to its well.
      if (kind === "villager" || kind === "iron_golem") mob.home = { x: mob.body.x, z: mob.body.z };
      game.spawn(mob);
      return [{ text: `Summoned new ${kind}` }];
    }
    case "battle": case "trade": {
      // Asking another player for a link battle or a trade: no cheats needed, it is how the modes are played.
      const who = args.join(" ").trim();
      const what = cmd.toLowerCase() === "battle" ? "battle" : "trade";
      if (!who) return [{ text: `Usage: /${what} <player>`, color: ERR }];
      const r = game.critters.link.byName(who);
      if (!r) return [{ text: `No player called ${who} here.`, color: ERR }];
      return [{ text: game.critters.link.ask(r.id, what) }];
    }
    case "space": {
      // Straight to orbit, or straight home: a starship without the crafting.
      const denied = needCheats();
      if (denied) return denied;
      const sub = (args[0] ?? "").toLowerCase();
      if (sub === "land" || sub === "home") {
        if (!game.space) return [{ text: "You are not in space.", color: ERR }];
        game.land(sub === "home");
        return [{ text: "Coming down." }];
      }
      if (game.space) return [{ text: "Already in space. /space land comes down where you are, /space home at the launch site." }];
      game.launch();
      return [{ text: "Launch sequence started." }];
    }
    case "sky": return skyCommand(game, args, needCheats, needHost);
    case "accept": return [{ text: game.critters.link.accept() }];
    case "decline": return [{ text: game.critters.link.decline() }];
    case "critter": {
      // The critter modes' cheats: a critter for the party or in the wild, a full heal, coins, and the species list.
      const denied = needCheats();
      if (denied) return denied;
      const sub = (args[0] ?? "").toLowerCase();
      if (sub === "list") return [{ text: SPECIES_IDS.join(", ") }];
      if (sub === "heal") { for (const c of p.card.party) restore(c); game.bumpInv(); return [{ text: "Your critters are healed." }]; }
      if (sub === "coins") {
        const n = Math.floor(Number(args[1]));
        if (!Number.isFinite(n) || n < 0) return [{ text: "Usage: /critter coins <n>", color: ERR }];
        p.card.coins = Math.min(9_999_999, n);
        game.bumpInv();
        return [{ text: `You have ${p.card.coins} coins.` }];
      }
      if (sub === "give" || sub === "wild") {
        const species = (args[1] ?? "").toLowerCase();
        if (!SPECIES[species]) return [{ text: `No such critter. One of: ${SPECIES_IDS.join(", ")}`, color: ERR }];
        const level = Math.max(1, Math.min(100, Math.floor(Number(args[2] ?? 5)) || 5));
        if (sub === "give") {
          const c = makeCritter(species, level, Math.random, { ot: p.name, met: "a command" });
          const where = addCritter(p.card, c);
          if (!p.card.starter && SPECIES[species].starter) p.card.starter = species;
          game.bumpInv();
          return [{ text: `${SPECIES[species].name} (level ${level}) joined your ${where === "full" ? "— no, your party and box are full" : where}.` }];
        }
        const deniedHost = needHost();
        if (deniedHost) return deniedHost;
        const b = p.body;
        const m = new Mob("critter", b.x - Math.sin(p.yaw) * 4, b.y, b.z - Math.cos(p.yaw) * 4);
        m.setSpecies(species, level);
        game.spawn(m);
        return [{ text: `A wild ${SPECIES[species].name} (level ${level}) appeared.` }];
      }
      return [{ text: "Usage: /critter give <species> [level] | wild <species> [level] | heal | coins <n> | list", color: ERR }];
    }
    case "locate": {
      // The nearest village (overworld) or fortress (Nether), searched region by region outward.
      const what = (args[0] ?? "").toLowerCase();
      const b = p.body;
      if (what === "village") {
        const gen = game.terrainGenerator();
        if (!gen) return [{ text: "Villages are in the overworld's open terrain.", color: ERR }];
        const size = VILLAGE_REGION * 16;
        const hit = nearestInRegions(b.x, b.z, size, (rx, rz) => villageInRegion(gen, game.meta.seed, rx, rz));
        return hit ? [{ text: `The nearest village is at ${hit.x}, ${hit.y}, ${hit.z} (${Math.round(Math.hypot(hit.x - b.x, hit.z - b.z))} blocks away)` }]
          : [{ text: "No village within 4000 blocks.", color: ERR }];
      }
      if (what === "fortress") {
        if (game.dimension !== "nether") return [{ text: "Fortresses are in the Nether.", color: ERR }];
        const size = FORTRESS_REGION * 16;
        const hit = nearestInRegions(b.x, b.z, size, (rx, rz) => {
          const f = fortressInRegion(game.meta.seed, rx, rz);
          return f ? { x: (f.x0 + f.x1) >> 1, y: f.y, z: (f.z0 + f.z1) >> 1 } : null;
        });
        return hit ? [{ text: `The nearest fortress is at ${hit.x}, ${hit.y}, ${hit.z} (${Math.round(Math.hypot(hit.x - b.x, hit.z - b.z))} blocks away)` }]
          : [{ text: "No fortress within 4000 blocks.", color: ERR }];
      }
      if (what === "stronghold") {
        if (game.dimension !== "overworld" || !game.hasStrongholds()) return [{ text: "Strongholds are in the overworld (and not in a flat world or most map packs).", color: ERR }];
        const hit = nearestStronghold(game.meta.seed, b.x, b.z);
        return [{ text: `The nearest stronghold's portal room is at ${hit.x}, ${hit.y}, ${hit.z} (${Math.round(Math.hypot(hit.x - b.x, hit.z - b.z))} blocks away)` }];
      }
      if (what === "end_city") {
        if (game.dimension !== "end" || !(game.generator instanceof EndGenerator)) return [{ text: "End cities are in the End, out past the void.", color: ERR }];
        const gen = game.generator;
        const size = CITY_REGION * 16;
        const hit = nearestInRegions(b.x, b.z, size, (rx, rz) => {
          const c = cityInRegion(gen, rx, rz);
          return c ? { x: c.x, y: c.y, z: c.z } : null;
        });
        return hit ? [{ text: `The nearest End city is at ${hit.x}, ${hit.y}, ${hit.z} (${Math.round(Math.hypot(hit.x - b.x, hit.z - b.z))} blocks away)` }]
          : [{ text: "No End city within 4000 blocks.", color: ERR }];
      }
      if (what === "catacombs" || what === "spider_cave") {
        const gen = game.terrainGenerator();
        if (!gen || !gen.dungeons || game.meta.type === "flat") {
          return [{ text: "Dungeons are under the overworld (and not in a flat world, or one that switched them off).", color: ERR }];
        }
        const hit = nearestInRegions(b.x, b.z, DUNGEON_REGION, (rx, rz) => {
          const d = dungeonsInRegion(game.meta.seed, rx, rz).find((x) => x.kind === what);
          return d ? { x: d.x, y: d.y, z: d.z } : null;
        });
        const name = what === "catacombs" ? "catacombs" : "spider cave";
        return hit ? [{ text: `The nearest ${name} is at ${hit.x}, ${hit.y}, ${hit.z} (${Math.round(Math.hypot(hit.x - b.x, hit.z - b.z))} blocks away)` }]
          : [{ text: `No ${name} within 4000 blocks.`, color: ERR }];
      }
      return [{ text: "Usage: /locate village|fortress|stronghold|end_city|catacombs|spider_cave", color: ERR }];
    }
    case "dimension": {
      const denied = needCheats() ?? needHost();
      if (denied) return denied;
      const to = (args[0] ?? "").toLowerCase();
      if (!isDimension(to)) return [{ text: "Usage: /dimension overworld|nether|end", color: ERR }];
      if (to === game.dimension) return [{ text: `Already in ${DIMENSION_INFO[to].title}.` }];
      if (to === "end") {
        game.changeDimension("end", { kind: "platform", ...END_SPAWN });
        return [{ text: "Taking you to the End" }];
      }
      if (game.dimension === "end") {
        // Out of the End the way its exit portal goes: home.
        const s = game.worldSpawn();
        game.changeDimension("overworld", { kind: "spawn", ...s });
        if (to === "overworld") return [{ text: "Taking you home" }];
        return [{ text: "Taking you home first; from there, /dimension nether" }];
      }
      // As if through a portal: at the matching spot, stepping out of a new one.
      const b = p.body;
      const scale = DIMENSION_INFO[game.dimension].scale / DIMENSION_INFO[to].scale;
      game.changeDimension(to, { kind: "portal", x: Math.floor(b.x * scale), y: to === "nether" ? 64 : Math.max(64, Math.floor(b.y)), z: Math.floor(b.z * scale), axis: 0, known: false });
      return [{ text: `Taking you to ${DIMENSION_INFO[to].title}` }];
    }
    case "effect": {
      const denied = needCheats();
      if (denied) return denied;
      if (args[0] === "clear") { p.effects = []; return [{ text: "Removed every effect" }]; }
      const kinds: StatusEffect[] = [
        "regeneration", "hunger", "poison", "absorption", "speed", "night_vision", "slowness", "strength", "weakness",
        "fire_resistance", "invisibility", "water_breathing", "instant_health", "instant_damage", "levitation", "blindness",
      ];
      const kind = args[0] as StatusEffect;
      if (!kinds.includes(kind)) return [{ text: `Usage: /effect ${kinds.join("|")} [seconds] [level], or /effect clear`, color: ERR }];
      p.applyEffect(kind, Math.max(1, Number(args[1] ?? 30) || 30), Math.max(0, Math.min(4, (Number(args[2] ?? 1) || 1) - 1)));
      game.bumpInv();
      return [{ text: `Applied ${kind} to ${p.name}` }];
    }
    case "enchant": {
      const denied = needCheats();
      if (denied) return denied;
      const held = p.inventory.held;
      const name = (args[0] ?? "").replace(/^minecraft:/, "");
      const e = enchantDef(name);
      if (!e) return [{ text: `Usage: /enchant <${ENCHANTMENTS.map((x) => x.name).join("|")}> [level]`, color: ERR }];
      const def = held ? itemDef(held.id) : undefined;
      if (!held || !def) return [{ text: "Hold the item to enchant in your hand.", color: ERR }];
      if (!canApply(e, def)) return [{ text: `${enchantLabel(e.name, 1)} cannot go on ${def.displayName}.`, color: ERR }];
      const level = Math.max(1, Math.min(e.maxLevel, Number(args[1] ?? 1) || 1));
      const clash = Object.keys(held.ench ?? {}).find((n) => !compatible(n, e.name));
      if (clash) return [{ text: `${enchantLabel(e.name, level)} cannot be combined with ${enchantLabel(clash, held.ench![clash])}.`, color: ERR }];
      p.inventory.slots[p.inventory.selected] = { ...held, ench: { ...(held.ench ?? {}), [e.name]: level } };
      game.bumpInv();
      return [{ text: `Applied ${enchantLabel(e.name, level)} to ${def.displayName}` }];
    }
    case "xp": case "experience": {
      const denied = needCheats();
      if (denied) return denied;
      const amount = Number(args[1] ?? args[0]);
      if (!Number.isFinite(amount)) return [{ text: "Usage: /xp add <amount>", color: ERR }];
      if ((args[2] ?? "").startsWith("level")) p.xpLevel += amount;
      else game.addXp(amount);
      return [{ text: `Gave ${amount} experience to ${p.name}` }];
    }
    case "me":
      game.net?.chat(`* ${p.name} ${args.join(" ")}`);
      return [{ text: `* ${p.name} ${args.join(" ")}`, color: "#dddddd" }];
    default:
      return [{ text: `Unknown command "/${cmd}". Type /help for the list.`, color: ERR }];
  }
}

/** The nearest of whatever each region holds, searching rings of regions out to about 4000 blocks. */
function nearestInRegions(
  x: number, z: number, regionBlocks: number, at: (rx: number, rz: number) => { x: number; y: number; z: number } | null,
): { x: number; y: number; z: number } | null {
  const rx0 = Math.floor(x / regionBlocks), rz0 = Math.floor(z / regionBlocks);
  const rings = Math.ceil(4000 / regionBlocks);
  let best: { x: number; y: number; z: number } | null = null, bestD = Infinity;
  for (let r = 0; r <= rings; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const hit = at(rx0 + dx, rz0 + dz);
      if (!hit) continue;
      const d = Math.hypot(hit.x - x, hit.z - z);
      if (d < bestD) { best = hit; bestD = d; }
    }
    // A ring further out can hold nothing nearer than this one's best.
    if (best && bestD < r * regionBlocks) break;
  }
  return best;
}

/**
 * /sky: the real sky over the player (space/sky.ts) in words, and — with cheats, and only for the host, whose clock
 * the world keeps — jumps through it: to a date, a phase of the Moon, the next eclipse seen from here, a shower's
 * peak night, or the next total eclipse anywhere, taking the world to stand under its path.
 */
function skyCommand(game: Game, args: string[], needCheats: () => Line[] | null, needHost: () => Line[] | null): Line[] {
  if (game.dimension !== "overworld") return [{ text: "There is no sky here.", color: ERR }];
  if (!game.realSky()) return [{ text: "This world keeps the old sky: switch on The Real Sky in its Mods.", color: ERR }];
  const sub = (args[0] ?? "").toLowerCase();
  const { lat, lon } = game.latLon();
  const jd = game.skyDate();
  if (!sub) return describeSky(jd, lat, lon).map((text) => ({ text }));
  if (sub === "place" && !args[1]) return [{ text: `This spot is ${placeText(lat, lon)}${game.meta.place ? " (the world has been moved; /sky place home puts it back)" : ""}.` }];
  const denied = needCheats() ?? needHost();
  if (denied) return denied;
  const went = (what: string): Line[] => [{ text: `${what} — ${localClock(game.skyDate(), game.latLon().lon)} local mean time.` }];
  switch (sub) {
    case "now":
      game.setSkyDate(jdFromMs(Date.now()));
      return went("The sky is the real one, right now");
    case "date": {
      const [h, m] = (args[2] ?? "").split(":").map(Number);
      const hours = args[2] ? (Number.isFinite(h) ? h : 0) + (Number.isFinite(m) ? m : 0) / 60 : ((game.time % 24000) / 1000 + 6) % 24;
      const target = jdOfLocal(args[1] ?? "", hours, lon);
      if (!args[1] || target === null) return [{ text: "Usage: /sky date <yyyy-mm-dd> [hh:mm]   (local mean time; before 1582, the Julian calendar; 585 BC as -584-05-28 or 585BC-05-28)", color: ERR }];
      game.setSkyDate(target);
      return went("The sky has moved");
    }
    case "moon": {
      const phases: Record<string, number> = { new: 0, first: 90, full: 180, last: 270 };
      const want = phases[(args[1] ?? "").toLowerCase()];
      if (want === undefined) return [{ text: "Usage: /sky moon new|full|first|last", color: ERR }];
      game.setSkyDate(nextPhase(jd, want));
      return went(`The Moon is ${args[1]!.toLowerCase()}`);
    }
    case "eclipse": {
      const which = args[1]?.toLowerCase() === "solar" ? "solar" : args[1]?.toLowerCase() === "lunar" ? "lunar" : null;
      const seen = nextSeenEclipse(jd, lat, lon, which);
      if (!seen) return [{ text: "No eclipse can be seen from here in the next twenty years or so. /sky chase goes to one.", color: ERR }];
      // Start a while before the deepest moment, so it can be watched coming on.
      game.setSkyDate(seen.at - (seen.eclipse.kind === "solar" ? 25 : 50) / 1440);
      return went(`A ${seen.kind} eclipse is coming${seen.eclipse.kind === "solar" ? ` (${Math.round(seen.coverage * 100)}% of the Sun at its deepest)` : ""}`);
    }
    case "chase": {
      const type = args[1]?.toLowerCase() === "annular" ? "annular" : "total";
      const next = nextCentralEclipse(jd, type);
      if (!next) return [{ text: `No ${type} eclipse found ahead.`, color: ERR }];
      game.moveWorldTo(next.lat, next.lon);
      game.setSkyDate(next.jd - 25 / 1440, next.lon);
      return went(`The world has moved to ${placeText(next.lat, next.lon)}, under the path of the ${type} eclipse of ${localDay(next.jd, next.lon)}. /sky place home moves it back`);
    }
    case "shower": {
      const peak = nextShowerPeak(jd, args.slice(1).join(" ") || "x");
      if (!peak) return [{ text: `Usage: /sky shower <name>   (${SHOWER_NAMES.join(", ")})`, color: ERR }];
      // Two in the morning nearest the peak: the radiant is high, and the side of the Earth we stand on faces
      // forward along its orbit, into the stream.
      const local = peak.jd + lon / 360;
      const twoAm = Math.floor(local - 0.5) + 0.5 + 2 / 24;
      const best = Math.abs(twoAm + 1 - local) < Math.abs(twoAm - local) ? twoAm + 1 : twoAm;
      game.setSkyDate(best - lon / 360);
      return went(`The ${peak.name} are at their peak tonight`);
    }
    case "place": {
      if (args[1]?.toLowerCase() !== "home") return [{ text: "Usage: /sky place [home]", color: ERR }];
      game.meta.place = undefined;
      return [{ text: `The world is back where its seed put it: this spot is ${placeText(game.latLon().lat, game.latLon().lon)}.` }];
    }
  }
  return [{ text: "Usage: /sky, /sky now | date <yyyy-mm-dd> [hh:mm] | moon new|full|first|last | eclipse [solar|lunar] | chase [annular] | shower <name> | place [home]", color: ERR }];
}
