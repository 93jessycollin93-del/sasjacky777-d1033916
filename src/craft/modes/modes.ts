/**
 * Game modes: the ways to play a world, from the classics to the minigames
 * that made servers famous — SkyBlock, OneBlock, the Survival Games, wave
 * defence, parkour, TNT Run, UHC, speedruns, lucky blocks — and challenges
 * that bend a normal world (random drops, one heart).
 *
 * A mode is chosen when a world is created and kept in its meta: which map
 * pack it is built on (engine/maps.ts), the game mode and rules it starts
 * with, and what it has kept track of since (`ModeState.data`). What a mode
 * does while it runs lives in its runtime (modes/runtime.ts and the files
 * beside it); this file is only what it is, so the create screen, the tests
 * and a guest can read it without the game.
 */
import type { GameRules, WorldMeta } from "../game/save";
import type { GameMode } from "../engine/player";
import type { MapId } from "../engine/maps";
import type { WorldType } from "../engine/worldgen";

export type ModeCategory = "classic" | "minigame" | "challenge" | "primal" | "zombie" | "critter" | "city";

/** The order the create screen lists categories in. Every category must be here, or its modes cannot be chosen. */
export const CATEGORY_ORDER: ModeCategory[] = ["classic", "minigame", "challenge", "primal", "zombie", "critter", "city"];

export const CATEGORY_NAMES: Record<ModeCategory, string> = {
  classic: "Classic", minigame: "Minigames", challenge: "Challenges", primal: "Primal", zombie: "Zombies", critter: "Critters", city: "City & Casino",
};

export interface ModeDef {
  id: string;
  name: string;
  category: ModeCategory;
  /** Item drawn on its card. */
  icon: string;
  description: string;
  /** What winning (or doing well) looks like, in a line. */
  goal: string;
  /** The game or server tradition it comes from. */
  inspiredBy?: string;
  map?: MapId;
  type?: WorldType;
  gameMode: GameMode;
  difficulty?: 0 | 1 | 2 | 3;
  hardcore?: boolean;
  cheats?: boolean;
  rules?: Partial<GameRules>;
  /** Lucky blocks scattered through the terrain (engine/lucky.ts). */
  lucky?: boolean;
  /** Good with friends; playable alone (bots or a score to beat) either way. */
  multiplayer?: boolean;
  /** Who roams the wilds instead of the overworld's usual mobs: Primal's creatures, the infected, or critters. */
  fauna?: "primal" | "infected" | "critters";
  /** The critter modes' own rules: one life and one catch per area; the park's orbs only; the Spire's rentals. */
  critters?: { nuzlocke?: boolean; safari?: boolean; spire?: boolean };
  /** Primal's rules: Evolved's, or Ascended's gentler taming and wider roster. */
  primal?: "evolved" | "ascended";
  /** Survival beyond hunger: thirst, body temperature, and wounds (bleeding, sickness, broken bones). */
  vitals?: { thirst?: boolean; temperature?: boolean; wounds?: boolean; knox?: boolean };
  /** Recipes past the stone age are learned, a level at a time (engine/engrams.ts). */
  engrams?: boolean;
}

/** A world's mode and what it has kept track of: counters, times, bests. */
export interface ModeState {
  id: string;
  /** Set once the mode has given its kit and set its stage, so reloading does not do it again. */
  started?: boolean;
  data: Record<string, unknown>;
}

export const MODES: readonly ModeDef[] = [
  // ---- the classics -------------------------------------------------------------------------
  { id: "survival", name: "Survival", category: "classic", icon: "iron_pickaxe", gameMode: "survival",
    description: "Gather, craft, build and survive the night — then go to the Nether and the End.", goal: "Slay the Ender Dragon, or just live well." },
  { id: "creative", name: "Creative", category: "classic", icon: "grass_block", gameMode: "creative", cheats: true,
    description: "Every block, free flight, no hunger or harm.", goal: "Build anything." },
  { id: "hardcore", name: "Hardcore", category: "classic", icon: "golden_apple", gameMode: "survival", hardcore: true, difficulty: 3,
    description: "Survival on the hardest difficulty, with one life.", goal: "Don't die. Ever." },
  { id: "peaceful", name: "Peaceful Builder", category: "classic", icon: "red_tulip", gameMode: "survival", difficulty: 0,
    description: "Survival without monsters: gather and build at your own pace.", goal: "Build a home worth living in." },
  { id: "superflat", name: "Superflat Creative", category: "classic", icon: "dirt", gameMode: "creative", type: "flat", cheats: true,
    description: "A flat world to the horizon, with every block in hand.", goal: "Build big." },
  { id: "void_builder", name: "Void Builder", category: "classic", icon: "glass", gameMode: "creative", map: "void", cheats: true,
    rules: { doMobSpawning: false, doWeatherCycle: false },
    description: "A single platform in an empty sky.", goal: "Fill the void." },

  // ---- minigames ----------------------------------------------------------------------------
  { id: "skyblock", name: "SkyBlock", category: "minigame", icon: "oak_sapling", gameMode: "survival", map: "skyblock", inspiredBy: "SkyBlock (Hypixel, SkyBlock maps)",
    description: "A tiny island over the void, a chest and a tree. Every challenge you finish pays out something you cannot find.", goal: "Complete every island challenge.", multiplayer: true },
  { id: "oneblock", name: "OneBlock", category: "minigame", icon: "grass_block", gameMode: "survival", map: "oneblock", inspiredBy: "OneBlock",
    description: "One block. Break it and it comes back as something else — through plains, caves, snow, ocean, jungle, desert, the Nether and the End.", goal: "Break your way to the End phase.", multiplayer: true },
  { id: "survival_games", name: "Survival Games", category: "minigame", icon: "iron_sword", gameMode: "survival", map: "sg_arena", difficulty: 2, inspiredBy: "The Survival Games, Battle Royale",
    rules: { doMobSpawning: false, naturalRegeneration: true },
    description: "Twelve pads round a cornucopia of chests. Eleven tributes want what you have. The border closes in.", goal: "Be the last one standing.", multiplayer: true },
  { id: "waves", name: "Wave Defense", category: "minigame", icon: "bow", gameMode: "survival", map: "colosseum", difficulty: 2, inspiredBy: "Mob Arena",
    rules: { doMobSpawning: false, doDaylightCycle: false, doWeatherCycle: false },
    description: "Hold the colosseum against wave after wave, each worse than the last. Gear comes between rounds.", goal: "Survive as many waves as you can.", multiplayer: true },
  { id: "parkour", name: "Parkour", category: "minigame", icon: "gold_block", gameMode: "adventure", map: "parkour", difficulty: 0, inspiredBy: "Parkour maps and servers",
    rules: { doMobSpawning: false, doWeatherCycle: false, doDaylightCycle: false, doFallDamage: false },
    description: "Forty-eight jumps in the sky over four stages, with checkpoints. The clock is running.", goal: "Reach the diamond finish, faster every time.", multiplayer: true },
  { id: "tnt_run", name: "TNT Run", category: "minigame", icon: "tnt", gameMode: "adventure", map: "tnt_run", difficulty: 0, inspiredBy: "TNT Run",
    rules: { doMobSpawning: false, doWeatherCycle: false, doDaylightCycle: false, doFallDamage: false },
    description: "Three floors over the void. Every block you step on falls away a moment later. Keep moving.", goal: "Stay up the longest.", multiplayer: true },
  { id: "uhc", name: "UHC", category: "minigame", icon: "golden_apple", gameMode: "survival", difficulty: 2, inspiredBy: "Ultra Hardcore",
    rules: { naturalRegeneration: false },
    description: "No natural healing — only golden apples and potions — and a border closing in over an hour.", goal: "Slay the Ender Dragon before the border takes you.", multiplayer: true },
  { id: "speedrun", name: "Speedrun", category: "minigame", icon: "eye_of_ender", gameMode: "survival", difficulty: 2, inspiredBy: "Any% speedrunning",
    description: "A clock from the first second, with splits at every milestone on the way to the dragon.", goal: "Beat the dragon, faster than last time.", multiplayer: true },
  { id: "lucky_blocks", name: "Lucky Blocks", category: "minigame", icon: "lucky_block", gameMode: "survival", lucky: true, inspiredBy: "The Lucky Block mod",
    description: "Yellow ? blocks all over the world. Break one: diamonds, a pet, a feast — or TNT, a horde, a trap.", goal: "Push your luck.", multiplayer: true },

  // ---- challenges ---------------------------------------------------------------------------
  { id: "randomizer", name: "Random Drops", category: "challenge", icon: "chest", gameMode: "survival", inspiredBy: "Block Randomizer challenges",
    description: "Every block and every mob drops something else — the same something every time in this world. Learn the table.", goal: "Find what drops iron, and beat the game." },
  { id: "one_heart", name: "One Heart", category: "challenge", icon: "poppy", gameMode: "survival", difficulty: 2, inspiredBy: "One-heart challenges",
    description: "Survival with a single heart. Everything is lethal.", goal: "Slay the Ender Dragon on one heart." },
  { id: "lucky_skyblock", name: "Lucky SkyBlock", category: "challenge", icon: "lucky_block", gameMode: "survival", map: "skyblock", lucky: true,
    description: "SkyBlock, but your chest holds lucky blocks instead of seeds.", goal: "Build an island from luck alone." },

  // ---- primal (after ARK: Survival Evolved and Ascended) ------------------------------------
  { id: "primal_evolved", name: "Primal: Survival Evolved", category: "primal", icon: "wooden_club", gameMode: "survival", map: "primal_island", difficulty: 2,
    fauna: "primal", primal: "evolved", vitals: { thirst: true, temperature: true }, engrams: true, multiplayer: true,
    inspiredBy: "ARK: Survival Evolved (Studio Wildcard, 2017)",
    description: "Wake on the Island's beach with nothing. Dodos, raptors, trikes, a rex. Knock them out, feed them, tame them, saddle and ride them. Learn engrams as you level; mind your water and warmth; supply drops fall from the sky.",
    goal: "Tame a rex." },
  { id: "primal_ascended", name: "Primal: Survival Ascended", category: "primal", icon: "saddle", gameMode: "survival", map: "primal_island", difficulty: 2,
    fauna: "primal", primal: "ascended", vitals: { thirst: true, temperature: true }, engrams: true, multiplayer: true,
    inspiredBy: "ARK: Survival Ascended (Studio Wildcard, 2023)",
    description: "The Island, remade: taming goes faster, every creature tells you what it eats, and the great feathered Gigantoraptor walks the plains.",
    goal: "Tame a rex and a gigantoraptor." },
  { id: "primal_wilds", name: "Primal Wilds", category: "primal", icon: "raw_meat", gameMode: "survival",
    fauna: "primal", primal: "evolved", vitals: { thirst: true },
    description: "Primal's creatures on ordinary terrain, no engrams to learn: tame and ride at your own pace in a world with villages and the End.",
    goal: "Ride something with wings." },

  // ---- zombies ----------------------------------------------------------------------------------
  { id: "dead_zone", name: "Dead Zone", category: "zombie", icon: "pistol", gameMode: "survival", map: "dead_zone", difficulty: 2,
    fauna: "infected", vitals: { thirst: true, temperature: true, wounds: true }, multiplayer: true,
    inspiredBy: "DayZ (Bohemia Interactive, 2018; the Arma 2 mod, 2012)",
    description: "Fresh spawn with nothing. Abandoned towns, a hospital, a military base; the infected hear every shot. Thirst, cold, bleeding, fever and broken bones. Helicopters come down with crates in the wreck.",
    goal: "Last as many days as you can." },
  { id: "zombie_rounds", name: "Zombie Rounds", category: "zombie", icon: "shotgun", gameMode: "survival", map: "zombie_bunker", difficulty: 2, multiplayer: true,
    rules: { doMobSpawning: false, doDaylightCycle: false, doWeatherCycle: false, keepInventory: true },
    inspiredBy: "Call of Duty's zombies (Treyarch, 2008 on)",
    description: "The bunker, round after round. Earn points for kills and for boarding up windows; spend them on guns on the walls, the mystery box, Tough Skin and the doors to the other rooms. Grab the power-ups.",
    goal: "Reach round 20." },
  { id: "blood_moon", name: "Blood Moon", category: "zombie", icon: "redstone", gameMode: "survival", difficulty: 2,
    fauna: "infected", vitals: { thirst: true, wounds: true }, multiplayer: true,
    inspiredBy: "7 Days to Die (The Fun Pimps, 2013)",
    description: "An open world with the infected in it. Loot, build, fortify — every seventh night the moon turns red and a horde hunts you down, digging through whatever you hide behind.",
    goal: "Survive four blood moons." },
  { id: "infection", name: "Infection", category: "zombie", icon: "rotten_flesh", gameMode: "survival", map: "colosseum", difficulty: 2, multiplayer: true,
    rules: { doMobSpawning: false, doDaylightCycle: false, doWeatherCycle: false, keepInventory: true },
    inspiredBy: "Infection game types (Halo, and many servers' zombie tag)",
    description: "Survivors against the infected in the colosseum: whoever falls rises infected. Alone, hold out against the stream through the gates.",
    goal: "Be a survivor when the five minutes are up." },
  { id: "ashgrove", name: "Ashgrove County", category: "zombie", icon: "spiked_bat", gameMode: "survival", map: "county", difficulty: 2,
    fauna: "infected", vitals: { thirst: true, temperature: true, wounds: true, knox: true }, multiplayer: true,
    inspiredBy: "The zombie survival sandboxes, Project Zomboid above all (The Indie Stone, 2013 on)",
    description: "You wake in your own house in Millbrook, the morning after the county was sealed. Five towns of houses and shops to search, farms, a lake, an army camp gone quiet, and the fence the soldiers will not let anyone cross. The power and the water will not last.",
    goal: "Survive. Count the days." },
  { id: "outbreak", name: "Outbreak", category: "zombie", icon: "baseball_bat", gameMode: "survival", difficulty: 2, fauna: "infected", multiplayer: true,
    inspiredBy: "Zombie survival sandboxes (Project Zomboid, State of Decay)",
    description: "An ordinary world, overrun: the infected by day and by night in place of the usual monsters. No thirst or wounds — just survive and build.",
    goal: "Make a fortress that holds." },

  // ---- critters (after Pokémon, and Pixelmon and Cobblemon) -------------------------------------
  { id: "critter_quest", name: "Critter Quest", category: "critter", icon: "capture_orb", gameMode: "survival", map: "critter_region", difficulty: 1,
    fauna: "critters", multiplayer: true, rules: { keepInventory: true },
    inspiredBy: "Pokémon Red and Blue, and the games since (Game Freak, 1996 on)",
    description: "Choose your first critter from the professor, then take the long road north: wild critters in the grass, trainers on every route, a rival who picked the one that beats yours, four gyms and their badges, and the Champion at the end.",
    goal: "Win four badges and beat the Champion." },
  { id: "critter_craft", name: "Critter Craft", category: "critter", icon: "silver_orb", gameMode: "survival", difficulty: 1,
    fauna: "critters", multiplayer: true,
    inspiredBy: "Pixelmon and Cobblemon (Minecraft mods)",
    description: "An ordinary world full of critters, each in its own lands: catch them, battle wandering trainers, ride the big ones, build a healing station at your base.",
    goal: "Catch twenty kinds of critter." },
  { id: "critter_nuzlocke", name: "One-Life Run", category: "critter", icon: "revival_herb", gameMode: "survival", map: "critter_region", difficulty: 1,
    fauna: "critters", critters: { nuzlocke: true }, rules: { keepInventory: true },
    inspiredBy: "The Nuzlocke Challenge (fan-made rules, 2010)",
    description: "Critter Quest by the hardest rules there are: only the first critter you meet in each area may be caught, and a critter that faints is gone for good.",
    goal: "Beat the Champion without losing everything." },
  { id: "critter_safari", name: "Safari Park", category: "critter", icon: "park_orb", gameMode: "adventure", map: "safari_park", difficulty: 1,
    fauna: "critters", critters: { safari: true }, multiplayer: true, rules: { keepInventory: true, doDaylightCycle: false },
    inspiredBy: "The safari zones of the monster-collecting games",
    description: "No battles, just thirty Park Orbs, bait and mud. Rarer critters score more; a rare colour scores most. Ten minutes on the clock.",
    goal: "Score the most in ten minutes." },
  { id: "battle_spire", name: "Battle Spire", category: "critter", icon: "star_orb", gameMode: "adventure", map: "battle_spire", difficulty: 1,
    fauna: "critters", critters: { spire: true }, rules: { doMobSpawning: false, doDaylightCycle: false, keepInventory: true },
    inspiredBy: "The battle towers of the monster-collecting games",
    description: "Pick three rental critters at level 50 and face challenger after challenger at the top of the spire. Every seventh is the Spire Master.",
    goal: "Win as many battles in a row as you can." },

  // ---- city and casino ---------------------------------------------------------------------------
  { id: "high_roller", name: "High Roller", category: "city", icon: "gold_block", gameMode: "adventure", map: "high_roller", difficulty: 0, multiplayer: true,
    rules: { doMobSpawning: false, doDaylightCycle: false, keepInventory: true },
    inspiredBy: "The casinos of Las Vegas, and every game that ever put one in a city",
    description: "A thousand dollars and the run of the Golden Stonk: slots, blackjack, roulette, video poker, the wheel, and Stonks the crash game. Real odds; play money.",
    goal: "Turn $1,000 into $1,000,000." },
  { id: "neon_bay", name: "Neon Bay", category: "city", icon: "cash", gameMode: "adventure", map: "neon_bay", difficulty: 1, multiplayer: true,
    rules: { doMobSpawning: false, keepInventory: true },
    inspiredBy: "The seaside crime-sandbox games of the 2000s, and the city they set in the 1980s",
    description: "An island city of pastel hotels, glass towers and palm trees, with traffic on the streets and people on the sidewalks. Five hundred dollars and a Boomer Blaster outside your crib — and any other car you can get into.",
    goal: "Drive it, jack it, wreck it, own it." },
  { id: "golden_coast", name: "Golden Coast", category: "city", icon: "cactus", gameMode: "adventure", map: "golden_coast", difficulty: 1, multiplayer: true,
    rules: { doMobSpawning: false, keepInventory: true },
    inspiredBy: "The sunny-state crime-sandbox game of the 2000s: its sprawl, its desert and its gambling town",
    description: "San Yeeto: suburbs of lawns and palms, a downtown of towers, desert motels and gas stations, and the Yeet Strip's casinos glittering out of the sand. Same contacts, same police, bigger sky.",
    goal: "Drive it, jack it, wreck it, own it — in the sun." },
  { id: "street_racing", name: "Street Racing", category: "city", icon: "firework_rocket", gameMode: "adventure", map: "neon_bay", difficulty: 0, multiplayer: true,
    rules: { doMobSpawning: false, keepInventory: true },
    inspiredBy: "Street races in every crime-sandbox game, and the racing games they borrowed from",
    description: "A Gigachad GT each and one course through Neon Bay's traffic: twelve checkpoints from the junction by your crib. The same course for everyone in the world, so a time means something. No police; it's a sport here.",
    goal: "Set the record, then beat it." },
  { id: "rampage", name: "Rampage", category: "city", icon: "assault_rifle", gameMode: "adventure", map: "golden_coast", difficulty: 1, multiplayer: true,
    rules: { doMobSpawning: false, keepInventory: true },
    inspiredBy: "The rampages of the crime-sandbox games",
    description: "Three minutes, a Brrrt-9000 and a Bonk Stick, and San Yeeto's crowded streets. Ten points a person, twenty-five a cop, thirty a car. The police are not amused.",
    goal: "Top your best score, three minutes at a time." },
  { id: "cops_and_robbers", name: "Cops & Robbers", category: "city", icon: "iron_bars", gameMode: "adventure", map: "golden_coast", difficulty: 1, multiplayer: true,
    rules: { doMobSpawning: false, keepInventory: true },
    inspiredBy: "Cops and robbers, the oldest game there is, played the crime-sandbox way",
    description: "Six stores around San Yeeto, each with a till to empty. Every hold-up adds a wanted star. Bank the bag at your crib before the police take it off you.",
    goal: "Bank more than anyone." },
];

export function modeDef(id: string | undefined): ModeDef | undefined {
  return id ? MODES.find((m) => m.id === id) : undefined;
}

/** A mode for the Random button: any minigame or challenge (the classics are not a surprise). */
export function randomMode(random: () => number): ModeDef {
  const pool = MODES.filter((m) => m.category !== "classic");
  return pool[Math.floor(random() * pool.length)];
}

/**
 * A new world, set up for a mode: its map pack, world type, rules and the
 * mode itself. Game mode, difficulty and cheats are the create screen's to
 * set (it starts them at the mode's), so they are left as they came.
 */
export function applyMode(meta: WorldMeta, def: ModeDef): WorldMeta {
  meta.mode = { id: def.id, data: {} };
  if (def.map) { meta.map = def.map; meta.type = "default"; }
  else if (def.type) meta.type = def.type;
  if (def.rules) meta.rules = { ...meta.rules, ...def.rules };
  if (def.hardcore) { meta.hardcore = true; meta.difficulty = 3; meta.cheats = false; }
  return meta;
}
