/**
 * The features this game borrowed from the modding community, each in its
 * own words and art, with the mod that had the idea first. The Mods screen
 * lists them with a switch each (per world), and the credits after the dragon
 * thank them by name.
 *
 * `rule` is the world's GameRules-style switch that turns the feature off;
 * a feature without one is always on (it changes nothing unless used).
 */
export interface ModFeature {
  id: string;
  /** What it is called here. */
  name: string;
  /** The mod (or mods) the idea comes from. */
  inspiredBy: string;
  /** Where to read about the original. */
  url: string;
  description: string;
  /** Can be switched off per world. */
  toggle: boolean;
}

export const MODS: readonly ModFeature[] = [
  {
    id: "dynamic_lights", name: "Dynamic Lights", inspiredBy: "LambDynamicLights", url: "https://github.com/LambdAurora/LambDynamicLights",
    description: "A torch in your hand lights the cave around you as you walk; so do burning mobs, blazes, dropped glowstone and rockets.", toggle: true,
  },
  {
    id: "minimap", name: "Minimap, World Map & Waypoints", inspiredBy: "Xaero's Minimap and World Map, JourneyMap", url: "https://www.curseforge.com/minecraft/mc-mods/xaeros-minimap",
    description: "A map in the corner, a full map of everywhere you have been (M), and waypoints you can name, see from afar and — with cheats — teleport to. Dying leaves one.", toggle: true,
  },
  {
    id: "waystones", name: "Waystones", inspiredBy: "Waystones", url: "https://www.curseforge.com/minecraft/mc-mods/waystones",
    description: "Stones you name and activate; from any one, travel to another you have found, for a little experience. Villages keep one by the well.", toggle: true,
  },
  {
    id: "recipe_viewer", name: "Recipe Viewer", inspiredBy: "Just Enough Items (JEI)", url: "https://www.curseforge.com/minecraft/mc-mods/jei",
    description: "Every item, searchable, beside your inventory: how to make it (crafting, smelting, brewing) and what it is used for.", toggle: true,
  },
  {
    id: "seasons", name: "Seasons", inspiredBy: "Serene Seasons, Fabric Seasons", url: "https://www.curseforge.com/minecraft/mc-mods/serene-seasons",
    description: "Spring, summer, autumn and winter, a week each: leaves turn, snow falls where it rained, and crops slow in autumn and stop in winter.", toggle: true,
  },
  {
    id: "gravestones", name: "Gravestones", inspiredBy: "Gravestone Mod, Corail Tombstone", url: "https://www.curseforge.com/minecraft/mc-mods/gravestone-mod",
    description: "Dying leaves a headstone holding everything you carried, safe from lava and despawning; use it and each thing goes back where it was.", toggle: true,
  },
  {
    id: "backpacks", name: "Backpacks", inspiredBy: "Traveler's Backpack, Sophisticated Backpacks", url: "https://www.curseforge.com/minecraft/mc-mods/travelers-backpack",
    description: "A leather backpack with a chest's worth of room, opened from your hand wherever you are.", toggle: true,
  },
  {
    id: "tree_felling", name: "Tree Felling & Vein Mining", inspiredBy: "FallingTree, Veinminer", url: "https://www.curseforge.com/minecraft/mc-mods/falling-tree",
    description: "Cut a trunk with an axe and the whole tree comes down (sneak to take one log); sneak with a pickaxe and a whole ore vein comes out.", toggle: true,
  },
  {
    id: "right_click_harvest", name: "Right-Click Harvest", inspiredBy: "Right Click Harvest", url: "https://modrinth.com/mod/rightclickharvest",
    description: "Use a ripe crop to harvest it and replant it in one go.", toggle: true,
  },
  {
    id: "double_doors", name: "Double Doors", inspiredBy: "Couplings", url: "https://www.curseforge.com/minecraft/mc-mods/couplings",
    description: "Open one of a pair of doors and the other swings with it.", toggle: true,
  },
  {
    id: "inventory_sort", name: "Inventory Sorting", inspiredBy: "Inventory Profiles Next, Mouse Tweaks", url: "https://www.curseforge.com/minecraft/mc-mods/inventory-profiles-next",
    description: "A button to tidy a chest, a backpack or your inventory: like stacks merged, kinds together.", toggle: true,
  },
  {
    id: "appleskin", name: "Hunger Preview", inspiredBy: "AppleSkin", url: "https://www.curseforge.com/minecraft/mc-mods/appleskin",
    description: "The hunger bar shows your hidden saturation, and — holding food — what eating it would fill.", toggle: true,
  },
  {
    id: "clumps", name: "Experience Clumps", inspiredBy: "Clumps", url: "https://www.curseforge.com/minecraft/mc-mods/clumps",
    description: "Experience orbs that meet merge into one, so a busy farm stays smooth.", toggle: false,
  },
  {
    id: "ambient_sounds", name: "Ambient Sounds", inspiredBy: "AmbientSounds, Dynamic Surroundings", url: "https://www.curseforge.com/minecraft/mc-mods/ambientsounds",
    description: "Birds in the forest, crickets and owls at night, frogs in the swamp, surf, wind on the peaks, drips in caves, the Nether's moan.", toggle: true,
  },
  {
    id: "dungeons", name: "Catacombs & Spider Caves", inspiredBy: "YUNG's Better Dungeons, When Dungeons Arise", url: "https://www.curseforge.com/minecraft/mc-mods/yungs-better-dungeons",
    description: "Mazes of crypt rooms under the overworld — spawners, bone pillars, grave goods and a ladder shaft to the surface — and web-strung spider caves. /locate catacombs finds one.", toggle: true,
  },
  {
    id: "cooking", name: "Cooking Pot", inspiredBy: "Farmer's Delight", url: "https://www.curseforge.com/minecraft/mc-mods/farmers-delight",
    description: "An iron pot set over fire, lava or a lit furnace turns vegetables, meat and a bowl into soups and stews worth far more than their parts.", toggle: false,
  },
  {
    id: "wildlife", name: "Wildlife", inspiredBy: "Alex's Mobs, Naturalist", url: "https://www.curseforge.com/minecraft/mc-mods/alexs-mobs",
    description: "Wolf packs to tame with bones — they sit, follow and fight for you — skittish deer to stalk, and bears best left alone.", toggle: true,
  },
  {
    id: "real_sky", name: "The Real Sky", inspiredBy: "Stellarium, Enhanced Celestials", url: "https://stellarium.org",
    description: "The sky over the world is the real one over its place on Earth: the Sun keeps real hours for the season, the Moon runs through its phases, and the stars, planets, comets, meteor showers and eclipses come when they really do.", toggle: true,
  },
];

/** Whether a feature is on in a world: everything is, unless the world switched it off. */
export function modEnabled(disabled: readonly string[] | undefined, id: string): boolean {
  return !disabled?.includes(id);
}
