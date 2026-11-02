/**
 * The city's shops: what the Bullet Bazaar sells over its counter, and how
 * Yeet Motors prices a car. Each is a list of things for dollars; buying is
 * the buyer's own business (their cash and their pockets live with them),
 * except a car, which the host has to put in the world.
 */
import { CAR_MODEL_IDS, CAR_MODELS, type CarModelId } from "./cars";

export type ShopKind = "guns" | "cars";

export interface ShopItem {
  id: string;
  name: string;
  blurb: string;
  price: number;
  /** What you walk out with: item names and counts. */
  items: [string, number][];
}

/** The Bullet Bazaar. The name is the whole marketing budget. */
export const GUN_SHOP: readonly ShopItem[] = [
  { id: "pistol", name: "Pocket Rocket", blurb: "A pistol and two boxes of rounds. Point the loud end away from you.", price: 300, items: [["pistol", 1], ["pistol_ammo", 24]] },
  { id: "shotgun", name: "Door Knocker", blurb: "A pump shotgun and sixteen shells. Doesn't knock. Opens.", price: 900, items: [["shotgun", 1], ["shotgun_shells", 16]] },
  { id: "hunting_rifle", name: "Long Distance Relationship", blurb: "A bolt-action rifle for talking to people very far away.", price: 1500, items: [["hunting_rifle", 1], ["rifle_ammo", 12]] },
  { id: "assault_rifle", name: "Brrrt-9000", blurb: "Fully automatic. Fully irresponsible. Sixty rounds to start.", price: 3000, items: [["assault_rifle", 1], ["rifle_ammo", 60]] },
  { id: "pistol_ammo", name: "Pistol rounds ×24", blurb: "Refill for the Pocket Rocket.", price: 60, items: [["pistol_ammo", 24]] },
  { id: "rifle_ammo", name: "Rifle rounds ×30", blurb: "For either rifle.", price: 150, items: [["rifle_ammo", 30]] },
  { id: "shotgun_shells", name: "Shells ×16", blurb: "For the Door Knocker.", price: 100, items: [["shotgun_shells", 16]] },
  { id: "bat", name: "Bonk Stick", blurb: "A baseball bat. Bonk first, ask questions never.", price: 80, items: [["baseball_bat", 1]] },
  { id: "vest", name: "Drip Vest", blurb: "Body armour that is also a fit. Stops bullets, starts conversations.", price: 500, items: [["iron_chestplate", 1]] },
  { id: "helmet", name: "Big Brain Helmet", blurb: "Protects the one thing you've never used.", price: 250, items: [["iron_helmet", 1]] },
  { id: "bandages", name: "Bandages ×4", blurb: "For when the Bonk Stick bonks back.", price: 40, items: [["bandage", 4]] },
  { id: "snack", name: "Healthy Snack", blurb: "A golden apple. Doctors hate it. Doctors are right, but still.", price: 150, items: [["golden_apple", 1]] },
];

/** Yeet Motors sells everything on the road except the police's cars. */
export const DEALER_MODELS: readonly CarModelId[] = CAR_MODEL_IDS.filter((m) => m !== "police");

/** The wire code for a car bought for a player: model and colour, in the one number a vehicle's placing carries. */
export const carCode = (model: CarModelId, color: number): number => CAR_MODEL_IDS.indexOf(model) * 32 + Math.max(0, Math.min(31, color));
export function carFromCode(code: number): { model: CarModelId; color: number } | null {
  const model = CAR_MODEL_IDS[Math.floor(code / 32)];
  return model ? { model, color: code % 32 } : null;
}

export const carPrice = (model: CarModelId): number => CAR_MODELS[model].price;
