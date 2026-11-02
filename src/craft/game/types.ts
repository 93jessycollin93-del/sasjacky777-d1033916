import type { Slot } from "../engine/inventory";
import type { GameMode } from "../engine/player";
import type { LinkKind } from "../net/transport";
import type { CasinoGame } from "../engine/casino";
import type { ShopKind } from "../engine/shops";

/** What the input layer (keyboard/mouse or touch) writes and the game reads each frame. */
export interface Controls {
  forward: number;
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  attack: boolean;
  use: boolean;
  /** Radians of look movement since the game last read them. */
  lookX: number;
  lookY: number;
  /** For tap-to-interact: where on screen (-1..1) the finger is, or null for the crosshair. */
  aim: { x: number; y: number } | null;
  actions: GameAction[];
}

export type GameAction =
  | { type: "hotbar"; slot: number }
  | { type: "scroll"; delta: number }
  | { type: "drop"; all: boolean }
  | { type: "inventory" }
  | { type: "chat"; text?: string }
  | { type: "pause" }
  | { type: "pickBlock" }
  | { type: "perspective" }
  | { type: "debug" }
  | { type: "hideHud" }
  | { type: "screenshot" }
  | { type: "toggleFly" }
  | { type: "map" }
  /** The critter modes: the party (P). */
  | { type: "party" }
  /** At the wheel: the next radio station (R). */
  | { type: "radio" }
  | { type: "close" };

export function emptyControls(): Controls {
  return { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, attack: false, use: false, lookX: 0, lookY: 0, aim: null, actions: [] };
}

export type Screen =
  | { kind: "pause" }
  | { kind: "inventory" }
  | { kind: "crafting"; x: number; y: number; z: number }
  | { kind: "furnace"; x: number; y: number; z: number }
  | { kind: "chest"; x: number; y: number; z: number }
  | { kind: "brewing"; x: number; y: number; z: number }
  | { kind: "enchanting"; x: number; y: number; z: number }
  | { kind: "anvil"; x: number; y: number; z: number }
  | { kind: "smithing"; x: number; y: number; z: number }
  | { kind: "trade"; entityId: number }
  | { kind: "chat"; text: string }
  | { kind: "options" }
  | { kind: "share" }
  | { kind: "death" }
  | { kind: "advancements" }
  /** The poem and credits, the first time home from the End after the dragon. */
  | { kind: "poem" }
  /** The features borrowed from mods, with their switches and credits. */
  | { kind: "mods" }
  /** The world map and its waypoints (M). */
  | { kind: "map" }
  /** A cooking pot (engine/cooking.ts): six ingredients and a bowl, over heat. */
  | { kind: "cooking"; x: number; y: number; z: number }
  /** A backpack in the player's inventory slot `slot`, opened. */
  | { kind: "backpack"; slot: number }
  /** A waystone's list of the others this player has found. */
  | { kind: "waystone"; x: number; y: number; z: number }
  /** Primal's engram list. */
  | { kind: "engrams"; from: "pause" | "inventory" }
  /** The critter modes: a battle; the party (with a medicine to give, or the storage box beside it at a station); the
   *  starter to choose (or the Spire's rentals); a healing station's counter. */
  | { kind: "battle" }
  | { kind: "party"; give?: string; tab?: "party" | "dex" }
  | { kind: "starter"; rentals?: boolean }
  /** Ashgrove County: who this survivor was before (engine/survivors.ts), chosen before the first step and after every death. */
  | { kind: "survivor" }
  | { kind: "center"; x: number; y: number; z: number }
  /** In space (space/): the ship's view and its overview. */
  | { kind: "space" }
  /** Another player's ask to battle or trade, and a critter trade in progress (game/critterLink.ts). */
  | { kind: "link" }
  | { kind: "critter_trade" }
  /** The casino: its lobby, or one game's table. */
  | { kind: "casino"; game: CasinoGame }
  | { kind: "shop"; shop: ShopKind };

/** A game mode's scoreboard: a title and label–value lines, as the classic sidebar shows them. */
export interface Objective {
  title: string;
  lines: [string, string][];
}

/** What a mode running on the host tells one guest (or all): words, a title, a game mode, their scoreboard, the border. */
export interface ModeTell {
  msg?: string;
  color?: string;
  title?: string;
  sub?: string;
  gm?: "survival" | "creative" | "adventure" | "spectator";
  obj?: Objective | null;
  border?: { x: number; z: number; radius: number } | null;
  frozen?: boolean;
  /** At most this much health (One Heart). */
  maxHealth?: number;
  /** A new round: empty hands, full health and food, no effects. */
  reset?: boolean;
  /** A blood moon is up (or has set). */
  bloodMoon?: boolean;
  /** Dollars handed to the player (a mode's stake, a mission's pay). */
  cash?: number;
  /** The player's wanted stars now (the city modes). */
  wanted?: number;
  /** Busted: hand over every gun and round. */
  confiscate?: boolean;
  /** A line of dialogue across the bottom of the screen: who says it, and what. */
  caption?: { who: string; text: string; color: string };
  /** The spots this player's mission marks in the world and on the map (null clears them). */
  markers?: Marker[] | null;
}

/** A mission's mark: a glowing column in the world and a dot on the map. */
export interface Marker {
  x: number;
  y: number;
  z: number;
  color: string;
  /** How close counts as there, and so how wide the column is drawn. */
  r: number;
}

export interface ChatLine {
  id: number;
  text: string;
  color?: string;
  at: number;
}

export interface Hud {
  health: number;
  food: number;
  air: number;
  armor: number;
  xpLevel: number;
  xpProgress: number;
  absorption: number;
  hotbar: Slot[];
  selected: number;
  heldName: string;
  heldNameAt: number;
  gameMode: GameMode;
  hardcore: boolean;
  screen: Screen | null;
  chat: ChatLine[];
  dead: boolean;
  deathMessage: string;
  loading: { done: number; total: number; message: string } | null;
  attackCharge: number;
  breaking: number;
  hurtAt: number;
  sleeping: number;
  hudHidden: boolean;
  /** In space, and a launch's countdown (seconds left). */
  space?: boolean;
  launch?: number | null;
  debug: string[] | null;
  coords: string | null;
  fps: number;
  /** Bumped whenever an inventory or container changes, so open screens re-render. */
  inv: number;
  title: { text: string; sub?: string; at: number } | null;
  actionbar: { text: string; at: number } | null;
  net: { role: "host" | "guest"; room: string; kind: LinkKind; players: string[]; status: string; addresses?: string[] } | null;
  saveProblem: string | null;
  saving: boolean;
  onFire: boolean;
  underwater: boolean;
  /** How far through a portal's four seconds the player is (0 when not in one): the screen swirls purple. */
  portal: number;
  perspective: 0 | 1 | 2;
  /** Active status effects, for the list in the corner. */
  effects: { kind: string; amp: number; seconds: number }[];
  /** Advancements earned in the last few seconds, newest last. */
  toasts: { id: string; title: string; icon: string; at: number }[];
  /** A boss in range (the dragon): its name and health, 0..1. */
  boss: { name: string; health: number } | null;
  /** Hidden hunger made visible (after AppleSkin): saturation, and what the held food would restore. */
  saturation: number | null;
  foodPreview: { food: number; saturation: number } | null;
  /** A game mode's scoreboard (modes/runtime.ts), shown at the right. */
  objective: Objective | null;
  /** Thirst, where the mode keeps it (0..20); null where it does not. */
  water: number | null;
  /** Body temperature and wounds, as short words for the HUD (engine/vitals.ts). */
  vitals: string[];
  /** Primal: what the crosshair rests on, when it is a creature: name, level, torpor, tame. */
  inspect: string | null;
  /** The minimap is showing in the top right corner, so what usually sits there moves down. */
  minimap: boolean;
  /** The critter modes: the party's health at a glance, coins and badges; null elsewhere. */
  critters: { party: { name: string; species: string; level: number; hp: number; max: number; status: string | null }[]; coins: number; badges: number } | null;
  /** The city and casino modes: the player's dollars, shown as the city shows them; null elsewhere. */
  cash: number | null;
  /** In a city: wanted stars, 0 to 5. */
  wanted: number | null;
  /** Someone talking: a contact on the phone, the DJ on the radio. */
  caption: { who: string; text: string; color: string } | null;
  /** At the wheel of a car: its name, speed, how much of it is left (0-1), and its siren. */
  vehicle: { name: string; kmh: number; health: number; siren: boolean; police: boolean } | null;
  /** In a city: the district (announced for a few seconds on the way in) and the street underfoot. */
  zone: { name: string; street: string | null; fresh: boolean } | null;
}
