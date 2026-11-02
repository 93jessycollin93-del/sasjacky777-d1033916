/**
 * The trainers critters are battled with: the region's route trainers, its
 * four gym leaders, the rival who picked the starter that beats yours, and the
 * champion at the end of the road (after the gym-and-league shape of the
 * monster-collecting games). Also the wanderers met on open terrain, and the
 * Battle Spire's endless line of challengers.
 *
 * A trainer in the world carries only an id; everything else — name, team,
 * reward, what they say — comes from here, so host and guests agree without
 * sending teams about, and a wanderer's team is the same every time its id
 * is read.
 */
import { makeCritter, pickWild, SPECIES, SPECIES_IDS, STARTERS, type Critter, type CritterType } from "./critters";
import { Rng, seedFromString } from "./rng";

export type TrainerClass =
  | "youngster" | "lass" | "hiker" | "swimmer" | "bug_catcher" | "ace" | "ranger" | "mystic" | "tamer"
  | "gym_leader" | "champion" | "rival" | "professor" | "tower" | "tycoon" | "grunt" | "exec" | "ceo";

export const CLASS_NAMES: Record<TrainerClass, string> = {
  youngster: "Youngster", lass: "Lass", hiker: "Hiker", swimmer: "Swimmer", bug_catcher: "Bug Collector", ace: "Veteran", ranger: "Ranger",
  mystic: "Mystic", tamer: "Drake Tamer", gym_leader: "Leader", champion: "Champion", rival: "Rival", professor: "Professor", tower: "Spire Challenger", tycoon: "Spire Master",
  grunt: "Team Copium Grunt", exec: "Copium Exec", ceo: "Copium CEO",
};

export interface TrainerDef {
  id: string;
  cls: TrainerClass;
  name: string;
  team: [string, number][];
  /** Coins for beating them, per level of their strongest. */
  prize: number;
  intro: string;
  defeat: string;
  /** Gym leaders: the badge they give, and the type their gym keeps to. */
  badge?: string;
  type?: CritterType;
  /** How far down the road they watch for challengers. */
  sight: number;
}

const T = (id: string, cls: TrainerClass, name: string, team: [string, number][], intro: string, defeat: string, extra: Partial<TrainerDef> = {}): TrainerDef => ({
  id, cls, name, team, intro, defeat, sight: 7,
  prize: cls === "champion" ? 200 : cls === "ceo" ? 150 : cls === "gym_leader" ? 100 : cls === "rival" || cls === "exec" ? 60 : cls === "ace" || cls === "tamer" ? 40 : cls === "grunt" ? 25 : 20, ...extra,
});

/** The four badges, in the order the road reaches their gyms. */
export const BADGES = ["Granite Badge", "Tide Badge", "Static Badge", "Lantern Badge"] as const;

const REGION: TrainerDef[] = [
  // Route 1
  T("r1_tom", "youngster", "Tom", [["nibbit", 4], ["chirplet", 4]], "Hey! You've got critters? Let's see 'em!", "Aw, man. Back to training in the long grass."),
  T("r1_ivy", "lass", "Ivy", [["wrigglet", 5], ["mossnail", 5]], "Oh! Are you a new trainer too?", "You're good! I'll catch up, you'll see."),
  // Granite gym (stone)
  T("g1_dale", "hiker", "Dale", [["pebbling", 8], ["bogpup", 9]], "The Leader's rocks are harder than mine. Mine are pretty hard!", "Heh. Solid work."),
  T("g1_brom", "gym_leader", "Brom", [["pebbling", 10], ["bogpup", 11], ["pebbling", 12]],
    "I'm Brom. My critters are stone, and stone doesn't move for anyone. Show me you can!", "You wore my stone down. Take the Granite Badge — you earned it.",
    { badge: "Granite Badge", type: "stone" }),
  // Route 2
  T("r2_finn", "bug_catcher", "Finn", [["wrigglet", 9], ["cocoonix", 10], ["lumoth", 12]], "My bugs are the best bugs!", "My bugs… they're still the best bugs."),
  T("r2_coral", "swimmer", "Coral", [["finnip", 12], ["jellispark", 13]], "The river's my home turf!", "Washed up. Ugh."),
  T("r2_sol", "ranger", "Sol", [["sparkhog", 13], ["galewing", 14]], "I patrol this road. Nobody passes without a battle!", "Fine, fine. Pass."),
  // Tide gym (water)
  T("g2_kai", "swimmer", "Kai", [["finnip", 16], ["bogpup", 17]], "You won't get past me dry!", "Soaked. You win."),
  T("g2_marina", "gym_leader", "Marina", [["finnip", 18], ["jellispark", 19], ["rippajaw", 22]],
    "The tide gives and the tide takes. Let's see what it takes from you!", "You rode the current well. The Tide Badge is yours.",
    { badge: "Tide Badge", type: "water" }),
  // Route 3
  T("r3_rowan", "ace", "Rowan", [["galewing", 22], ["cinderam", 23]], "Only the strongest trainers make it this far.", "…You might be one of them."),
  T("r3_selene", "mystic", "Selene", [["wisplet", 22], ["lumoth", 23]], "The lights over the marsh told me you would come.", "They did not tell me I would lose."),
  T("r3_gus", "hiker", "Gus", [["pebbling", 22], ["bouldron", 26]], "I've been walking this road forty years!", "Forty years, and you beat me on a Tuesday."),
  // Static gym (electric)
  T("g3_ohm", "ace", "Ohm", [["sparkhog", 25], ["jellispark", 26]], "Feel the buzz? That's the Leader's gym!", "Zapped."),
  T("g3_volta", "gym_leader", "Volta", [["sparkhog", 27], ["jellispark", 28], ["stormhog", 31]],
    "I run on lightning, and so do my critters. Try to keep up!", "Shocking! Here — the Static Badge.",
    { badge: "Static Badge", type: "electric" }),
  // Route 4, the long road
  T("r4_jun", "ace", "Jun", [["stormhawk", 36], ["blizzfang", 35]], "Four badges, and the champion at the end. Are you ready for that?", "Maybe you are."),
  T("r4_lin", "ranger", "Lin", [["mireback", 34], ["frostpaw", 33], ["lanternwisp", 35]], "The road gets harder from here.", "And you get stronger. Go on."),
  T("r4_reyes", "tamer", "Reyes", [["scalekin", 32], ["drakeling", 36]], "Dragons answer only to the strong.", "…They answered you."),
  // Lantern gym (spirit)
  T("g4_veil", "gym_leader", "Veil", [["wisplet", 36], ["lanternwisp", 38], ["lanternwisp", 40]],
    "Welcome to the dark. My critters see in it. Do yours?", "You carried your own light through. Take the Lantern Badge.",
    { badge: "Lantern Badge", type: "spirit" }),
  // Team Copium, the region's villains (after the genre's evil teams, though these ones mostly hurt themselves):
  // a start-up that wants every critter turned into a token, run on hype and staffed by the very online.
  T("tc_grunt1", "grunt", "Brayden", [["sussling", 11], ["stonkfish", 12]],
    "Team Copium is here to make everyone cope! Hand over your critters. It's for, uh, research.", "It's fine. I'm fine. This is fine. Losing was part of the plan."),
  T("tc_grunt2", "grunt", "Kayleigh", [["bonkbat", 18], ["copiumite", 20]],
    "Our CEO says critters are just unrealised assets. I don't know what that means, but I'm paid in exposure!", "Can I put this loss on my résumé as 'leadership experience'?"),
  T("tc_hank", "exec", "Hodl Hank", [["stonkfish", 22], ["rickrock", 22], ["moonfin", 25]],
    "I bought the top on every critter I own, and I will never sell. Diamond hands, kid!", "Down ninety percent. Still not selling. See you on the moon."),
  T("tc_grunt3", "grunt", "Jaxon", [["sussling", 30], ["bonkarang", 31], ["copiumite", 32]],
    "You again? Dana said you'd come this way. Dana's been awake since Tuesday.", "Ratio'd. By a kid with a backpack."),
  T("tc_dana", "exec", "Doomscroll Dana", [["sussling", 33], ["vibefrog", 33], ["copiumite", 35], ["wowdoge", 36]],
    "I've been scrolling since four in the morning. Everything is terrible, and now it's your turn to feel it.", "…Okay, that was actually kind of wholesome. Don't post it."),
  T("tc_ceo", "ceo", "Maximus Hype", [["hopium", 44], ["neverroll", 44], ["moonfin", 45], ["susquatch", 45], ["megachonk", 47]],
    "Welcome to the pitch. Team Copium is disrupting the critter space: every critter a token, every trainer a bag-holder. Invest, or be invested in!",
    "A setback. A learning. A pivot. …Team Copium is now Team Hopium. Please clap."),
  // The League
  T("league_aria", "champion", "Aria", [["stormhawk", 50], ["blizzfang", 50], ["mireback", 51], ["lanternwisp", 50], ["wyrmlord", 55]],
    "So you are the trainer everyone is talking about. I'm the Champion. Show me everything!", "…That was the best battle I have had in years. You are the Champion now.",
    { sight: 5 }),
];

/** The rival picked the starter that beats yours: water over fire, grass over water, fire over grass. */
export function rivalStarter(playerStarter: string | undefined): string {
  const line = playerStarter && STARTERS.includes(playerStarter) ? playerStarter : "emberkit";
  return line === "emberkit" ? "axolittle" : line === "axolittle" ? "sproutling" : "emberkit";
}

/** A starter at a level, grown into its line's stage. */
function grown(species: string, level: number): string {
  let s = species;
  for (let e = SPECIES[s].evolves; e && level >= e.level; e = SPECIES[s].evolves) s = e.to;
  return s;
}

function rival(stage: 1 | 2 | 3, playerStarter: string | undefined): TrainerDef {
  const st = rivalStarter(playerStarter);
  const teams: Record<1 | 2 | 3, [string, number][]> = {
    1: [[st, 6]],
    2: [["galewing", 22], ["sparkhog", 22], [grown(st, 25), 25]],
    3: [["stormhawk", 44], ["stormhog", 44], ["bouldron", 45], ["lanternwisp", 45], [grown(st, 48), 48]],
  };
  const lines: Record<1 | 2 | 3, [string, string]> = {
    1: ["Wait up! Professor Wren gave us both critters — let's see whose is better!", "What? I picked the one that beats yours!"],
    2: ["Still at it? I've got two badges more than you. Well, one. Let's go!", "Hmph. I'll train harder."],
    3: ["I got here first. Before you face the Champion, you face me.", "…Go on, then. Beat the Champion for both of us."],
  };
  return T(`rival${stage}`, "rival", "Kit", teams[stage], lines[stage][0], lines[stage][1]);
}

const FIRST_NAMES = ["Ada", "Bo", "Cy", "Dee", "Eli", "Fay", "Gil", "Hana", "Ira", "Jo", "Kai", "Lu", "Max", "Nell", "Oz", "Pia", "Quin", "Rae", "Sam", "Tess", "Uma", "Vic", "Wes", "Yan", "Zoe"];
const WANDER_CLASSES: TrainerClass[] = ["youngster", "lass", "hiker", "bug_catcher", "ranger", "ace", "mystic"];
/** A Copium grunt met in the wilds brings the start-up's own critters, grown to the land's level. */
const COPIUM_POOL = ["sussling", "stonkfish", "bonkbat", "copiumite", "chonklet", "dogeling", "rickrock", "froggo"];
const COPIUM_LINES: [string, string][] = [
  ["Stop right there! Team Copium needs your critters for our next funding round!", "We'll call it a strategic retreat. Very strategic."],
  ["Have you heard the good news about Copium? It's a critter, a lifestyle and a coin.", "The coin just dropped ninety percent. Not because of you. Mostly."],
  ["The CEO says if I win ten battles I get equity! This is battle one.", "Zero for one. Still early!"],
  ["Touch grass? I'd rather touch your wallet. Battle me!", "Okay, I'll go touch some grass."],
];
const WANDER_LINES: [string, string][] = [
  ["Our eyes met! That means we battle!", "Good match. I'll remember that one."],
  ["I've been waiting all day for someone to battle!", "Worth the wait."],
  ["You look like you've been training. Let's see!", "You have been training."],
  ["Nobody walks past me without a battle!", "…Except you, apparently."],
];

/**
 * A trainer by id: the region's, the rival (whose team depends on the
 * player's own starter), a wanderer ("w:<seed>:<level>:<biome>"), or a Battle
 * Spire challenger ("tower:<number>:<seed>").
 */
export function trainerById(id: string, playerStarter?: string): TrainerDef | null {
  const fixed = REGION.find((t) => t.id === id);
  if (fixed) return fixed;
  if (id === "rival1" || id === "rival2" || id === "rival3") return rival(Number(id.slice(5)) as 1 | 2 | 3, playerStarter);
  if (id === "professor") return T("professor", "professor", "Wren", [], "Welcome! The world is full of critters. Choose your first, and go and meet them all.", "", { sight: 0 });
  const w = /^w:(-?\d+):(\d+):(.{1,32})$/.exec(id);
  if (w) {
    const rng = new Rng(Number(w[1]) | 0);
    const level = Math.max(2, Math.min(70, Number(w[2])));
    // One wanderer in seven is a Team Copium grunt. Read from its own stream, so the rest are who they always were.
    if (new Rng((Number(w[1]) ^ 0xc0b1) | 0).next() < 1 / 7) return copiumWanderer(id, rng, level);
    const cls = WANDER_CLASSES[rng.int(WANDER_CLASSES.length)];
    const n = 1 + rng.int(level > 20 ? 3 : 2);
    const team: [string, number][] = [];
    for (let i = 0; i < n; i++) {
      const lv = Math.max(2, level - 2 + rng.int(4));
      const s = pickWild(w[3], lv, () => rng.next()) ?? pickWild("Plains", lv, () => rng.next()) ?? "nibbit";
      team.push([s, lv]);
    }
    const [intro, defeat] = WANDER_LINES[rng.int(WANDER_LINES.length)];
    return T(id, cls, FIRST_NAMES[rng.int(FIRST_NAMES.length)], team, intro, defeat);
  }
  const t = /^tower:(\d+):(-?\d+)$/.exec(id);
  if (t) return towerTrainer(Number(t[1]), Number(t[2]) | 0);
  return null;
}

function copiumWanderer(id: string, rng: Rng, level: number): TrainerDef {
  const n = 1 + rng.int(level > 20 ? 3 : 2);
  const team: [string, number][] = [];
  for (let i = 0; i < n; i++) {
    const lv = Math.max(2, level - 2 + rng.int(4));
    team.push([grown(COPIUM_POOL[rng.int(COPIUM_POOL.length)], lv), lv]);
  }
  const [intro, defeat] = COPIUM_LINES[rng.int(COPIUM_LINES.length)];
  return T(id, "grunt", FIRST_NAMES[rng.int(FIRST_NAMES.length)], team, intro, defeat);
}

/** Final forms and single-stage critters: what a Spire challenger brings. */
const TOWER_POOL = SPECIES_IDS.filter((s) => !SPECIES[s].evolves && SPECIES[s].rarity !== "legendary");

/** The nth challenger of a Spire run: three critters at level 50; every seventh, the Master, with a stronger hand. */
export function towerTrainer(n: number, seed: number): TrainerDef {
  const rng = new Rng((seed ^ Math.imul(n + 1, 0x9e3779b1)) | 0);
  const tycoon = n > 0 && n % 7 === 0;
  const pool = [...TOWER_POOL];
  const team: [string, number][] = [];
  for (let i = 0; i < 3; i++) team.push([pool.splice(rng.int(pool.length), 1)[0], tycoon ? 55 : 50]);
  const cls: TrainerClass = tycoon ? "tycoon" : "tower";
  const name = tycoon ? "Ozias" : FIRST_NAMES[rng.int(FIRST_NAMES.length)];
  return T(`tower:${n}:${seed}`, cls, name, team,
    tycoon ? "Seven wins in a row. Now you face me — the Master of this Spire." : `Challenger number ${n}. Let's battle!`,
    tycoon ? "Magnificent. The Spire bows to you." : "Your streak goes on…", { prize: 0 });
}

/** A trainer's team, ready to battle: fresh critters of the listed species and levels. */
export function trainerTeam(t: TrainerDef): Critter[] {
  const rng = new Rng(seedFromString(t.id));
  return t.team.map(([s, l]) => makeCritter(s, l, rng, { shiny: false }));
}

/** "Leader Brom", "Youngster Tom". */
export const trainerTitle = (t: TrainerDef): string => `${CLASS_NAMES[t.cls]} ${t.name}`;

/** Coins for beating a trainer. */
export function prizeFor(t: TrainerDef): number {
  return t.prize * Math.max(1, ...t.team.map(([, l]) => l));
}

/** Every region trainer, for the map and the tests. */
export function regionTrainers(): TrainerDef[] {
  return [...REGION, rival(1, undefined), rival(2, undefined), rival(3, undefined)];
}

/** Rental critters for a Spire run: six to choose three from, at level 50. */
export function towerRentals(seed: number): string[] {
  const rng = new Rng(seed | 0);
  const pool = [...TOWER_POOL];
  const out: string[] = [];
  for (let i = 0; i < 6; i++) out.push(pool.splice(rng.int(pool.length), 1)[0]);
  return out;
}
