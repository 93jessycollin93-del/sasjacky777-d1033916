/**
 * Ashgrove County: the main world's map, a small American county sealed off
 * at the start of an outbreak.
 *
 * Five towns — Millbrook strung along the highway, Westford on the river,
 * Cedar Bend's big houses upstream, Rosedale out east, Harlow Heights'
 * subdivision to the south-west — joined by a highway, two state roads and
 * the county roads, with farms between them, a lake with cabins, a trailer
 * park, the army's Camp Hadley, and the quarantine fence round the whole of
 * it with a checkpoint wherever a road meets it. About 1,800 blocks across,
 * and flat, the way river country is.
 *
 * Like the cities (engine/city.ts), the county is a function rather than a
 * list of blocks: the roads, towns and lots are laid out once from the seed
 * (the same layout in every worker), and `fill` builds any one chunk from
 * them on demand. Every building is decided from its lot's own seed, so a
 * house that straddles four chunks comes out the same in each.
 *
 * The towns and roads are placed by hand — the county is a place to learn,
 * not a new one every game — and everything on them (which house is where,
 * what colour, who left what in the fridge) comes from the seed.
 */
import { B } from "./blocks";
import { COUNTY_BLOCKS as C } from "./countyBlocks";
import { blockIndex, SEA_LEVEL } from "./constants";
import { Simplex } from "./noise";
import { hash4, hashFloat, Rng } from "./rng";
import { buildTree } from "./trees";
import { Clip } from "./city";
import type { GeneratedChunk } from "./worldgen";
import type { BuildingKind } from "./countyLoot";
import { housePlan, stampLot } from "./countyBuild";

/** The top block of the ground; feet stand a block above it. */
export const GROUND = SEA_LEVEL + 1;
/** The quarantine fence stands this far from the middle on every side. */
export const CORDON = 895;
/** The county's own seed offset, so its lots are not the terrain generator's numbers. */
const SALT = 0x5eed_a5;

export type RoadKind = "highway" | "main" | "street" | "county" | "dirt";

/** Half the width of the whole corridor, sidewalks and shoulders included. */
export const ROAD_HALF: Record<RoadKind, number> = { highway: 6, main: 6, street: 4, county: 3, dirt: 1 };

export interface CountyRoad {
  /** Which way it runs: along x (east–west) or along z (north–south). */
  axis: "x" | "z";
  /** Its centre line, on the other axis. */
  at: number;
  from: number;
  to: number;
  kind: RoadKind;
  name: string;
}

export type LotKind = BuildingKind | "park" | "farm" | "cabin" | "water_tower" | "cemetery" | "campground";

export interface Lot {
  id: number;
  x0: number; z0: number; x1: number; z1: number;
  /** The way its front faces — toward its road: 0 north, 1 south, 2 west, 3 east. */
  face: 0 | 1 | 2 | 3;
  kind: LotKind;
  town: string | null;
  seed: number;
  /** Camp Hadley's gate, as a distance along its frontage (the camp is one lot of its own). */
  gate?: number;
}

export interface Town {
  name: string;
  x0: number; z0: number; x1: number; z1: number;
  /** How its houses are built: old brick, plain suburban, big and rich, small-town. */
  style: "old" | "suburban" | "rich" | "small";
}

export const TOWNS: Town[] = [
  { name: "Millbrook", x0: -190, z0: -30, x1: 190, z1: 455, style: "suburban" },
  { name: "Westford", x0: -800, z0: -672, x1: -380, z1: -420, style: "old" },
  { name: "Cedar Bend", x0: 220, z0: -672, x1: 580, z1: -460, style: "rich" },
  { name: "Rosedale", x0: 400, z0: -25, x1: 735, z1: 190, style: "small" },
  { name: "Harlow Heights", x0: -560, z0: 360, x1: -215, z1: 610, style: "suburban" },
];

/** Camp Hadley, the army's post in the south-east corner. */
export const BASE = { x0: 610, z0: 590, x1: 860, z1: 860, gateZ: 700 };
/** The lake, and the cabins on its southern shore. */
export const LAKE = { x: -720, z: 170, r: 70 };

// ---- the river ---------------------------------------------------------------------------------------

/** The river's centre line (z) at a given x, and its half-width there. */
export function riverAt(x: number): { z: number; half: number } {
  return { z: -705 + 22 * Math.sin(x / 190) + 9 * Math.sin(x / 61 + 1.3), half: 24 + 6 * Math.sin(x / 97 + 0.4) };
}

/** How deep the water is over a column: 0 on dry land. */
export function waterDepth(x: number, z: number): number {
  const r = riverAt(x);
  const d = Math.abs(z - r.z);
  if (d < r.half) return 1 + Math.floor(6 * (1 - (d / r.half) ** 2));
  const lx = x - LAKE.x, lz = z - LAKE.z;
  const edge = LAKE.r + 8 * Math.sin(Math.atan2(lz, lx) * 3) + 5 * Math.sin(Math.atan2(lz, lx) * 7 + 1);
  const dl = Math.hypot(lx, lz);
  if (dl < edge) return 1 + Math.floor(5 * (1 - (dl / edge) ** 2));
  return 0;
}

/** Sand along the water's edge. */
function shore(x: number, z: number): boolean {
  if (waterDepth(x, z)) return false;
  for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2], [2, -2], [-2, 2]]) if (waterDepth(x + dx, z + dz)) return true;
  return false;
}

// ---- the layout ----------------------------------------------------------------------------------------

const LINE_Z = 0, LINE_X = 2;

export class County {
  readonly roads: CountyRoad[] = [];
  readonly lots: Lot[] = [];
  private lotBuckets = new Map<number, Lot[]>();
  private roadBuckets = new Map<number, CountyRoad[]>();
  private forest: Simplex;
  private meadow: Simplex;
  /** Where the player first wakes: inside a house in Millbrook. */
  readonly spawn: [number, number, number];
  readonly spawnLot: Lot;

  constructor(readonly seed: number) {
    this.forest = new Simplex(seed ^ 0x2f0e57);
    this.meadow = new Simplex(seed ^ 0x3ead0);
    this.layRoads();
    this.layTowns();
    this.layCountryside();
    for (const r of this.roads) this.index(this.roadBuckets, r, r.axis === "x" ? r.from : r.at - ROAD_HALF[r.kind], r.axis === "x" ? r.at - ROAD_HALF[r.kind] : r.from,
      r.axis === "x" ? r.to : r.at + ROAD_HALF[r.kind], r.axis === "x" ? r.at + ROAD_HALF[r.kind] : r.to);
    // Home: the house nearest the middle of Millbrook's third street.
    const homes = this.lots.filter((l) => l.kind === "house" && l.town === "Millbrook");
    const home = homes.reduce((best, l) => (Math.hypot((l.x0 + l.x1) / 2 + 60, (l.z0 + l.z1) / 2 - 150) < Math.hypot((best.x0 + best.x1) / 2 + 60, (best.z0 + best.z1) / 2 - 150) ? l : best), homes[0]);
    this.spawnLot = home;
    const plan = housePlan(home);
    const [sx, sz] = plan.spawn;
    this.spawn = [sx, GROUND + 1, sz];
  }

  private index<T>(buckets: Map<number, T[]>, item: T, x0: number, z0: number, x1: number, z1: number): void {
    for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) {
      const k = ((cx & 0xffff) << 16) | (cz & 0xffff);
      let list = buckets.get(k);
      if (!list) buckets.set(k, (list = []));
      list.push(item);
    }
  }

  private road(axis: "x" | "z", at: number, from: number, to: number, kind: RoadKind, name: string): void {
    this.roads.push({ axis, at, from: Math.min(from, to), to: Math.max(from, to), kind, name });
  }

  /** The highway, the state roads and the county roads, split where they run through a town and become its main street. */
  private layRoads(): void {
    const E = CORDON - 12;
    this.road("z", 0, -E, E, "highway", "Route 31");
    this.road("x", -560, -E, -800, "county", "River Road");
    this.road("x", -560, -800, -380, "main", "River Road");
    this.road("x", -560, -380, 220, "county", "River Road");
    this.road("x", -560, 220, 580, "main", "River Road");
    this.road("x", -560, 580, E, "county", "River Road");
    this.road("x", 80, -E, E, "highway", "Route 60");
    this.road("x", 500, -E, -560, "county", "South Road");
    this.road("x", 500, -560, -215, "main", "South Road");
    this.road("x", 500, -215, E, "county", "South Road");
    this.road("z", -560, -560, 500, "county", "Old Mill Road");
    this.road("z", 560, -560, E, "county", "Hadley Road");
    // Into Camp Hadley's gate.
    this.road("x", BASE.gateZ, 560, BASE.x0 + 6, "street", "Post Road");
    // To the lake's cabins, and the trailer park off Millbrook.
    this.road("z", -700, 80, 268, "dirt", "Lake Lane");
    this.road("x", 268, -830, -600, "dirt", "Shore Drive");
    this.road("x", 175, -330, -190, "street", "Pine Court");
  }

  private layTowns(): void {
    const street = (axis: "x" | "z", at: number, from: number, to: number, name: string) => this.road(axis, at, from, to, "street", name);
    const numbered = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"} Street`;
    const trees = ["Oak", "Elm", "Maple", "Walnut", "Cherry", "Hickory", "Chestnut", "Poplar", "Sycamore", "Willow", "Birch", "Laurel"];

    // Millbrook: side streets off the highway, and a back street each side.
    const mbZ = [-10, 35, 125, 170, 215, 260, 305, 350, 395, 440];
    mbZ.forEach((z, i) => street("x", z, -175, 175, numbered(i + 1)));
    for (const x of [-175, -90, 90, 175]) street("z", x, -10, 440, x < 0 ? (x === -175 ? "West Avenue" : "Mill Street") : x === 90 ? "Church Street" : "East Avenue");
    // Westford: an old grid on the river.
    for (const [i, z] of [-650, -605, -515, -470, -435].entries()) street("x", z, -790, -390, ["Front Street", "Water Street", "Court Street", "High Street", "Hill Street"][i]);
    for (const [i, x] of [-780, -700, -620, -480, -400].entries()) street("z", x, -650, -435, trees[i]);
    this.road("z", -560, -650, -560, "street", "Old Mill Road");
    // Cedar Bend: long lots on long streets.
    for (const [i, z] of [-640, -600, -515, -480].entries()) street("x", z, 230, 570, ["Riverview Drive", "Bluff Road", "Cedar Lane", "Orchard Lane"][i]);
    for (const [i, x] of [240, 330, 420, 500].entries()) street("z", x, -640, -480, trees[i + 5]);
    // Rosedale.
    for (const [i, z] of [-10, 35, 125, 170].entries()) street("x", z, 410, 725, ["Depot Street", "Main Street", "Park Street", "School Street"][i]);
    for (const [i, x] of [420, 500, 640, 725].entries()) street("z", x, -10, 170, trees[i + 3]);
    // Harlow Heights.
    for (const [i, z] of [380, 425, 470, 545, 590].entries()) street("x", z, -550, -220, ["Harlow Drive", "Meadow Lane", "Sunset Drive", "Brookside Drive", "Ridge Road"][i]);
    for (const [i, x] of [-550, -460, -380, -300, -220].entries()) street("z", x, 380, 590, trees[i + 7]);

    // The businesses, on each town's main road, the ones every town has first.
    const shops = (town: string, road: { axis: "x" | "z"; at: number; kind: RoadKind }, from: number, to: number, kinds: BuildingKind[]) => {
      let i = 0;
      for (const side of [1, -1] as const) {
        let along = from;
        while (along < to - 14) {
          const kind = kinds[i] ?? this.pick(["office", "diner", "bar", "clothing", "house", "office", "liquor"] as BuildingKind[], along * 7 + side);
          const big = kind === "school" || kind === "warehouse" || kind === "police" || kind === "motel" || kind === "fire_station";
          const w = big ? 34 : kind === "gas_station" ? 26 : 18 + Math.floor(hashFloat(this.seed, along, side) * 8);
          const d = big ? 34 : 28;
          const lot = this.frontLot(road, side, along, w, d, kind, town);
          if (lot) { i++; along += w + 2; } else along += 4;
        }
      }
    };
    const R31 = { axis: "z" as const, at: 0, kind: "highway" as const };
    shops("Millbrook", R31, -5, 450, ["gas_station", "diner", "grocery", "pharmacy", "hardware", "police", "fire_station", "school", "church", "motel",
      "bar", "liquor", "gun_store", "clinic", "office", "library", "warehouse", "warehouse", "gas_station", "office"]);
    const RR = { axis: "x" as const, at: -560, kind: "main" as const };
    shops("Westford", RR, -790, -385, ["grocery", "pharmacy", "gun_store", "bookstore", "liquor", "bar", "diner", "clothing", "hardware", "police", "clinic",
      "library", "church", "fire_station", "school", "gas_station", "office", "office"]);
    shops("Cedar Bend", RR, 225, 575, ["church", "school", "clinic", "grocery", "gas_station", "office", "diner"]);
    const R60 = { axis: "x" as const, at: 80, kind: "highway" as const };
    shops("Rosedale", R60, 405, 730, ["police", "fire_station", "school", "church", "diner", "grocery", "gas_station", "hardware", "bar", "clinic", "office"]);
    const SR = { axis: "x" as const, at: 500, kind: "main" as const };
    shops("Harlow Heights", SR, -555, -215, ["grocery", "pharmacy", "diner", "clothing", "bookstore", "liquor", "gas_station", "church", "school", "office"]);
    // Westford's warehouses, on the riverfront.
    const front = { axis: "x" as const, at: -650, kind: "street" as const };
    for (let along = -785; along < -400; along += 42) this.frontLot(front, -1, along, 38, 20, "warehouse", "Westford");

    // Houses on every other street in town, a few with gardens given over to parks.
    for (const road of this.roads) {
      if (road.kind !== "street") continue;
      const town = this.townAt(road.axis === "x" ? (road.from + road.to) / 2 : road.at, road.axis === "x" ? road.at : (road.from + road.to) / 2);
      if (!town) continue;
      const rich = town.style === "rich";
      for (const side of [1, -1] as const) {
        let along = road.from + ROAD_HALF.street + 2;
        while (along < road.to - 12) {
          const w = rich ? 22 + Math.floor(hashFloat(this.seed, along, road.at + side) * 6) : 13 + Math.floor(hashFloat(this.seed, along, road.at + side) * 5);
          const d = rich ? 24 : 18;
          const roll = hashFloat(this.seed ^ 0x51, along, road.at * 3 + side);
          const kind: LotKind = roll < 0.03 ? "park" : roll < 0.035 ? "water_tower" : "house";
          const lot = this.frontLot(road, side, along, w, d, kind, town.name);
          along += lot ? w + 1 : 3;
        }
      }
    }
    // The trailer park on Pine Court.
    const pine = this.roads.find((r) => r.name === "Pine Court")!;
    for (const side of [1, -1] as const) for (let along = pine.from + 4; along < pine.to - 10; along += 11) this.frontLot(pine, side, along, 10, 15, "trailer", "Millbrook");
    // Rosedale's cemetery.
    this.frontLot({ axis: "x", at: 170, kind: "street" }, 1, 560, 60, 30, "cemetery", "Rosedale");
  }

  private layCountryside(): void {
    // Farms along the country roads, with gaps of woods between them.
    for (const road of this.roads) {
      if (road.kind !== "county" && road.kind !== "highway") continue;
      for (const side of [1, -1] as const) {
        let along = road.from + 20;
        while (along < road.to - 60) {
          const mid = road.axis === "x" ? [along, road.at] : [road.at, along];
          if (this.townAt(mid[0], mid[1]) || this.nearTown(mid[0], mid[1], 70)) { along += 30; continue; }
          const roll = hashFloat(this.seed ^ 0xfa, along, road.at * 5 + side);
          if (roll < 0.35) {
            const w = 48 + Math.floor(roll * 40), d = 44 + Math.floor(hashFloat(this.seed, along, side) * 16);
            const lot = this.frontLot(road, side, along, w, d, "farm", null);
            along += lot ? w + 25 + Math.floor(roll * 60) : 20;
          } else if (roll < 0.42) {
            // A lone house by the road, or a filling station.
            const kind: LotKind = roll < 0.405 ? "gas_station" : "house";
            const lot = this.frontLot(road, side, along, kind === "gas_station" ? 26 : 18, kind === "gas_station" ? 28 : 20, kind, null);
            along += lot ? 60 : 20;
          } else along += 45;
        }
      }
    }
    // Cabins on Shore Drive, between the road and the lake, and a campground.
    const shoreRoad = this.roads.find((r) => r.name === "Shore Drive")!;
    for (let along = shoreRoad.from + 4; along < shoreRoad.to - 12; along += 17) {
      this.frontLot(shoreRoad, -1, along, 14, 14, along > -640 && along < -620 ? "campground" : "cabin", "Lake Ashgrove");
    }
    // Checkpoints where the roads leave the county.
    for (const r of this.roads) {
      if (r.kind === "dirt" || r.kind === "street") continue;
      for (const end of [r.from, r.to]) {
        if (Math.abs(end) < CORDON - 20) continue;
        const inward = end > 0 ? -1 : 1;
        const along = end + inward * 30 - (inward < 0 ? 16 : 0);
        this.frontLot(r, 1, along, 16, 14, "checkpoint", null);
      }
    }
  }

  private pick<T>(list: T[], salt: number): T {
    return list[Math.floor(hashFloat(this.seed, salt, 0x11) * list.length)];
  }

  /** Makes a lot fronting a road on one side, if it is clear of every road, lot and the water. */
  private frontLot(road: { axis: "x" | "z"; at: number; kind: RoadKind }, side: 1 | -1, along: number, w: number, d: number, kind: LotKind, town: string | null): Lot | null {
    const h = ROAD_HALF[road.kind];
    let x0: number, z0: number, x1: number, z1: number, face: Lot["face"];
    if (road.axis === "x") {
      x0 = along; x1 = along + w - 1;
      if (side === 1) { z0 = road.at + h + 1; z1 = z0 + d - 1; face = 0; } else { z1 = road.at - h - 1; z0 = z1 - d + 1; face = 1; }
    } else {
      z0 = along; z1 = along + w - 1;
      if (side === 1) { x0 = road.at + h + 1; x1 = x0 + d - 1; face = 2; } else { x1 = road.at - h - 1; x0 = x1 - d + 1; face = 3; }
    }
    if (Math.max(Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1)) > CORDON - 6) return null;
    if (x1 > BASE.x0 - 4 && x0 < BASE.x1 + 4 && z1 > BASE.z0 - 4 && z0 < BASE.z1 + 4) return null;
    for (const r of this.roads) {
      const rh = ROAD_HALF[r.kind];
      const [rx0, rz0, rx1, rz1] = r.axis === "x" ? [r.from, r.at - rh, r.to, r.at + rh] : [r.at - rh, r.from, r.at + rh, r.to];
      if (x1 >= rx0 && x0 <= rx1 && z1 >= rz0 && z0 <= rz1) return null;
    }
    for (let cx = (x0 - 2) >> 4; cx <= (x1 + 2) >> 4; cx++) for (let cz = (z0 - 2) >> 4; cz <= (z1 + 2) >> 4; cz++) {
      for (const o of this.lotBuckets.get(((cx & 0xffff) << 16) | (cz & 0xffff)) ?? []) {
        if (x1 >= o.x0 - 1 && x0 <= o.x1 + 1 && z1 >= o.z0 - 1 && z0 <= o.z1 + 1) return null;
      }
    }
    for (let x = x0; x <= x1; x += 3) for (let z = z0; z <= z1; z += 3) if (waterDepth(x, z) || shore(x, z)) return null;
    const lot: Lot = { id: this.lots.length, x0, z0, x1, z1, face, kind, town, seed: hash4(this.seed ^ SALT, x0, z0, this.lots.length) };
    this.lots.push(lot);
    this.index(this.lotBuckets, lot, x0, z0, x1, z1);
    return lot;
  }

  // ---- questions the game asks ----------------------------------------------------------------------------

  townAt(x: number, z: number): Town | null {
    return TOWNS.find((t) => x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1) ?? null;
  }

  private nearTown(x: number, z: number, margin: number): boolean {
    return TOWNS.some((t) => x >= t.x0 - margin && x <= t.x1 + margin && z >= t.z0 - margin && z <= t.z1 + margin);
  }

  lotAt(x: number, z: number): Lot | null {
    for (const l of this.lotBuckets.get((((x >> 4) & 0xffff) << 16) | ((z >> 4) & 0xffff)) ?? []) {
      if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) return l;
    }
    return null;
  }

  /** The building a container stands in, for its loot. */
  buildingAt(x: number, z: number): BuildingKind | null {
    const l = this.lotAt(x, z);
    if (l) return l.kind === "farm" ? "farmhouse" : l.kind === "cabin" ? "house" : l.kind === "park" || l.kind === "water_tower" || l.kind === "cemetery" || l.kind === "campground" ? null : l.kind;
    if (x >= BASE.x0 && x <= BASE.x1 && z >= BASE.z0 && z <= BASE.z1) return "military";
    return null;
  }

  roadAt(x: number, z: number): CountyRoad | null {
    for (const r of this.roadBuckets.get((((x >> 4) & 0xffff) << 16) | ((z >> 4) & 0xffff)) ?? []) {
      const h = ROAD_HALF[r.kind];
      const along = r.axis === "x" ? x : z, across = r.axis === "x" ? z - r.at : x - r.at;
      if (along >= r.from && along <= r.to && Math.abs(across) <= h) return r;
    }
    return null;
  }

  /** Where the player is, in words: a town, a road, or the woods. */
  placeName(x: number, z: number): string {
    if (Math.abs(x) > CORDON || Math.abs(z) > CORDON) return "Outside the quarantine zone";
    if (x >= BASE.x0 && x <= BASE.x1 && z >= BASE.z0 && z <= BASE.z1) return "Camp Hadley";
    const t = this.townAt(x, z);
    if (t) return t.name;
    const lot = this.lotAt(x, z);
    if (lot?.town) return lot.town;
    if (lot?.kind === "farm") return "a farm";
    if (waterDepth(x, z)) return Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 20 ? "Lake Ashgrove" : "the river";
    const r = this.roadAt(x, z);
    if (r) return r.name;
    return "the woods of Ashgrove County";
  }

  /** Nothing built here: woods, fields, verges — where trees grow. */
  private wild(x: number, z: number): boolean {
    if (waterDepth(x, z) || this.lotAt(x, z)) return false;
    // A tree's crown reaches a few blocks out: keep trunks back from anything built, so no leaves grow inside a house.
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3]]) if (this.lotAt(x + dx, z + dz)) return false;
    if (x >= BASE.x0 - 3 && x <= BASE.x1 + 3 && z >= BASE.z0 - 3 && z <= BASE.z1 + 3) return false;
    if (Math.abs(Math.abs(x) - CORDON) < 3 || Math.abs(Math.abs(z) - CORDON) < 3) return false;
    for (const r of this.roadBuckets.get((((x >> 4) & 0xffff) << 16) | ((z >> 4) & 0xffff)) ?? []) {
      const along = r.axis === "x" ? x : z, across = r.axis === "x" ? z - r.at : x - r.at;
      if (along >= r.from - 3 && along <= r.to + 3 && Math.abs(across) <= ROAD_HALF[r.kind] + 3) return false;
    }
    return !this.townAt(x, z) || hashFloat(this.seed, x, z) < 0.02;
  }

  // ---- building a chunk -----------------------------------------------------------------------------------

  fill(cx: number, cz: number, out: GeneratedChunk): void {
    const c = new Clip(cx, cz, out);
    const x0 = cx * 16, z0 = cz * 16;
    // The ground: flat river country, the water cut into it.
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const x = x0 + lx, z = z0 + lz;
      const depth = waterDepth(x, z);
      out.blocks[blockIndex(lx, 0, lz)] = B.BEDROCK;
      const top = depth ? SEA_LEVEL - depth : GROUND;
      for (let y = 1; y <= top; y++) out.blocks[blockIndex(lx, y, lz)] = y < top - 4 ? B.STONE : y < top ? B.DIRT : depth ? (depth > 3 ? B.GRAVEL : B.SAND) : shore(x, z) ? B.SAND : B.GRASS;
      for (let y = top + 1; y <= SEA_LEVEL && depth; y++) out.blocks[blockIndex(lx, y, lz)] = B.WATER;
    }
    // Roads, crossings first so a junction is plain asphalt.
    this.fillRoads(c, x0, z0);
    // Lots: houses, shops, farms and the rest.
    for (const lot of this.lotBuckets.get(((cx & 0xffff) << 16) | (cz & 0xffff)) ?? []) stampLot(c, lot, this);
    if (c.touches(BASE.x0, BASE.z0, BASE.x1, BASE.z1)) stampLot(c, this.baseLot(), this);
    // The fence round it all.
    this.fillCordon(c, x0, z0);
    // Woods and fields.
    this.fillWild(c, cx, cz);
  }

  private base: Lot | null = null;
  private baseLot(): Lot {
    // Facing west onto Hadley Road: its frontage runs north–south, so the gate is as far along it as Post Road is from its south end.
    return (this.base ??= { id: -1, x0: BASE.x0, z0: BASE.z0, x1: BASE.x1, z1: BASE.z1, face: 2, kind: "military", town: "Camp Hadley", seed: hash4(this.seed, 0xba5e), gate: BASE.z1 - BASE.gateZ });
  }

  private fillRoads(c: Clip, x0: number, z0: number): void {
    const roads = this.roadBuckets.get((((x0 >> 4) & 0xffff) << 16) | ((z0 >> 4) & 0xffff)) ?? [];
    if (!roads.length) return;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const x = x0 + lx, z = z0 + lz;
      let best: { r: CountyRoad; across: number; along: number } | null = null, count = 0;
      for (const r of roads) {
        const along = r.axis === "x" ? x : z, across = r.axis === "x" ? z - r.at : x - r.at;
        if (along < r.from || along > r.to || Math.abs(across) > ROAD_HALF[r.kind]) continue;
        count++;
        if (!best || ROAD_HALF[r.kind] > ROAD_HALF[best.r.kind]) best = { r, across, along };
      }
      if (!best) continue;
      const { r, across, along } = best;
      const a = Math.abs(across), junction = count > 1;
      const lineMeta = r.axis === "z" ? LINE_Z : LINE_X;
      let id: number = C.ASPHALT, meta = 0;
      switch (r.kind) {
        case "highway":
          if (a === 6) id = B.GRAVEL;
          else if (junction) id = C.ASPHALT;
          else if (a === 0) { id = C.ASPHALT_YELLOW_LINE; meta = lineMeta; }
          else if (a === 5) { id = C.ASPHALT_WHITE_LINE; meta = lineMeta; }
          break;
        case "main":
          if (a >= 5) id = C.SIDEWALK;
          else if (!junction && a === 0 && along % 8 < 5) { id = C.ASPHALT_YELLOW_LINE; meta = lineMeta; }
          break;
        case "street":
          if (a === 4) id = C.SIDEWALK;
          else if (junction && a <= 3 && count === 2 && this.crosswalk(x, z, roads)) { id = C.CROSSWALK; meta = lineMeta; }
          break;
        case "county":
          if (!junction && a === 0 && along % 10 < 5) { id = C.ASPHALT_YELLOW_LINE; meta = lineMeta; }
          else if (hashFloat(this.seed, x, z) < 0.05) id = C.CRACKED_ASPHALT;
          break;
        case "dirt":
          id = C.DIRT_ROAD;
          break;
      }
      // A road over the river is a bridge: the deck at ground level, the water under it, guard rails on the edges.
      c.set(x, GROUND, z, id, meta);
      for (let y = GROUND + 1; y <= GROUND + 3; y++) c.set(x, y, z, B.AIR);
      if (waterDepth(x, z)) {
        c.set(x, GROUND - 1, z, B.WATER);
        if (a === ROAD_HALF[r.kind]) c.set(x, GROUND + 1, z, C.GUARD_RAIL, r.axis === "z" ? 2 : 0);
        if (along % 12 === 0 && a <= 1) for (let y = 2; y < GROUND; y++) c.set(x, y, z, C.CONCRETE);
      }
      // Lamps along the streets in town, poles along the country roads.
      const town = this.townAt(x, z);
      if (town && (r.kind === "main" || r.kind === "street") && a === ROAD_HALF[r.kind] && along % 18 === 9 && !junction) {
        for (let y = GROUND + 1; y <= GROUND + 3; y++) c.set(x, y, z, C.LAMP_POST);
        c.set(x, GROUND + 4, z, C.STREET_LAMP);
      }
    }
    // Utility poles a little off the country roads, and stop signs where a street meets something bigger.
    for (const r of roads) {
      if (r.kind === "county" || r.kind === "highway") {
        const off = ROAD_HALF[r.kind] + 2;
        for (let along = Math.ceil(r.from / 28) * 28; along <= r.to; along += 28) {
          const [px, pz] = r.axis === "x" ? [along, r.at - off] : [r.at + off, along];
          if (!c.touches(px, pz, px, pz) || this.townAt(px, pz) || waterDepth(px, pz) || this.lotAt(px, pz) || this.roadAt(px, pz)) continue;
          for (let y = GROUND + 1; y <= GROUND + 7; y++) c.set(px, y, pz, C.POWER_POLE);
        }
      }
    }
  }

  /** Stripes across a street's mouth, where it meets another, a couple of blocks back from the crossing. */
  private crosswalk(x: number, z: number, roads: CountyRoad[]): boolean {
    return roads.filter((r) => {
      const along = r.axis === "x" ? x : z, across = r.axis === "x" ? z - r.at : x - r.at;
      return along >= r.from && along <= r.to && Math.abs(across) <= ROAD_HALF[r.kind];
    }).every((r) => r.kind === "street") && (x + z) % 2 === 0;
  }

  private fillCordon(c: Clip, x0: number, z0: number): void {
    if (Math.abs(x0) < CORDON - 16 && Math.abs(x0 + 15) < CORDON - 16 && Math.abs(z0) < CORDON - 16 && Math.abs(z0 + 15) < CORDON - 16) return;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const x = x0 + lx, z = z0 + lz;
      const onX = Math.abs(x) === CORDON && Math.abs(z) <= CORDON, onZ = Math.abs(z) === CORDON && Math.abs(x) <= CORDON;
      if (!onX && !onZ) continue;
      const meta = onX ? 2 : 0;
      const base = waterDepth(x, z) ? SEA_LEVEL - waterDepth(x, z) + 1 : GROUND + 1;
      for (let y = base; y <= GROUND + 4; y++) c.set(x, y, z, C.CORDON_FENCE, meta);
      c.set(x, GROUND + 5, z, C.BARBED_WIRE);
      // Floodlights every so often, as along any line the army holds.
      if ((onX ? z : x) % 40 === 0) c.set(x, GROUND + 5, z, C.STREET_LAMP);
    }
  }

  private fillWild(c: Clip, cx: number, cz: number): void {
    const x0 = cx * 16, z0 = cz * 16;
    const place = (x: number, y: number, z: number, id: number, meta = 0) => {
      const cur = c.get(x, y, z);
      if (cur === B.AIR || cur === B.SHORT_GRASS || cur === B.OAK_LEAVES || cur === B.BIRCH_LEAVES || cur === B.SPRUCE_LEAVES) c.set(x, y, z, id, meta);
    };
    // Undergrowth: grass, ferns in the woods, flowers in the fields.
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const x = x0 + lx, z = z0 + lz;
      if (c.get(x, GROUND, z) !== B.GRASS || c.get(x, GROUND + 1, z) !== B.AIR || !this.wild(x, z)) continue;
      const woods = this.forest.fbm2(x / 260, z / 260, 3) > 0.05;
      const r = hashFloat(this.seed ^ 0x9a55, x, z);
      if (r < (woods ? 0.35 : 0.25)) c.set(x, GROUND + 1, z, woods && r < 0.08 ? B.FERN : B.SHORT_GRASS);
      else if (!woods && r < 0.27) c.set(x, GROUND + 1, z, [B.DANDELION, B.POPPY, B.OXEYE_DAISY, B.CORNFLOWER][Math.floor(r * 1000) % 4]);
      else if (woods && r > 0.985) c.set(x, GROUND, z, B.PODZOL);
    }
    // Trees on a jittered grid, so neighbouring chunks agree about the ones that straddle them.
    const CELL = 7;
    for (let gx = Math.floor((x0 - 4) / CELL); gx <= Math.floor((x0 + 20) / CELL); gx++) {
      for (let gz = Math.floor((z0 - 4) / CELL); gz <= Math.floor((z0 + 20) / CELL); gz++) {
        const h = hash4(this.seed ^ 0x7ee, gx, gz);
        const tx = gx * CELL + (h & 7) % CELL, tz = gz * CELL + ((h >>> 3) & 7) % CELL;
        const woods = this.forest.fbm2(tx / 260, tz / 260, 3) > 0.05;
        const chance = woods ? 0.75 : this.meadow.noise2(tx / 90, tz / 90) > 0.45 ? 0.3 : 0.05;
        if (((h >>> 8) & 1023) / 1024 >= chance || !this.wild(tx, tz)) continue;
        const kindRoll = ((h >>> 20) & 255) / 256;
        const kind = kindRoll < 0.55 ? "oak" : kindRoll < 0.8 ? "birch" : "spruce";
        buildTree(kind, (x, y, z, id, meta) => { if (y > GROUND) place(x, y, z, id, meta ?? 0); }, tx, GROUND + 1, tz, new Rng(h));
      }
    }
  }
}

const CACHE = new Map<number, County>();
/** The county for a seed, laid out once per worker and kept. */
export function countyOf(seed: number): County {
  let c = CACHE.get(seed);
  if (!c) { c = new County(seed); CACHE.set(seed, c); }
  return c;
}
