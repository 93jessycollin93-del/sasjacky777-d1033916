import { describe, expect, it } from "vitest";
import { B, block, isBed, isDoor } from "@/craft/engine/blocks";
import { COUNTY_BLOCKS as C } from "@/craft/engine/countyBlocks";
import { blockIndex, CHUNK_VOLUME, SEA_LEVEL } from "@/craft/engine/constants";
import { BASE, CORDON, County, GROUND, ROAD_HALF, TOWNS, waterDepth } from "@/craft/engine/county";
import { housePlan } from "@/craft/engine/countyBuild";
import { mapLayout, MapGenerator } from "@/craft/engine/maps";
import { Generator } from "@/craft/engine/worldgen";

const county = new County(4242);

/** Reads blocks anywhere in the county, building chunks as they are needed. */
function world(c: County) {
  const chunks = new Map<string, { blocks: Uint16Array; meta: Uint8Array; biomes: Uint8Array }>();
  const chunk = (x: number, z: number) => {
    const k = `${x >> 4},${z >> 4}`;
    let ch = chunks.get(k);
    if (!ch) {
      ch = { blocks: new Uint16Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME), biomes: new Uint8Array(256) };
      c.fill(x >> 4, z >> 4, ch);
      chunks.set(k, ch);
    }
    return ch;
  };
  return {
    id: (x: number, y: number, z: number) => chunk(x, z).blocks[blockIndex(x & 15, y, z & 15)],
    meta: (x: number, y: number, z: number) => chunk(x, z).meta[blockIndex(x & 15, y, z & 15)],
  };
}

describe("Ashgrove County's layout", () => {
  it("builds five towns full of houses, and the shops and services every town has", () => {
    for (const t of TOWNS) {
      const lots = county.lots.filter((l) => l.town === t.name);
      expect(lots.filter((l) => l.kind === "house").length, t.name).toBeGreaterThan(30);
    }
    const kinds = new Set(county.lots.map((l) => l.kind));
    for (const k of ["grocery", "pharmacy", "hardware", "gun_store", "police", "fire_station", "school", "church", "clinic", "gas_station", "diner", "warehouse", "farm", "trailer", "cabin", "checkpoint"]) {
      expect(kinds.has(k as never), k).toBe(true);
    }
    expect(county.lots.length).toBeGreaterThan(600);
  });

  it("keeps every lot off every road, out of the water and inside the fence", () => {
    for (const l of county.lots) {
      expect(Math.max(Math.abs(l.x0), Math.abs(l.x1), Math.abs(l.z0), Math.abs(l.z1))).toBeLessThan(CORDON);
      for (const r of county.roads) {
        const h = ROAD_HALF[r.kind];
        const [rx0, rz0, rx1, rz1] = r.axis === "x" ? [r.from, r.at - h, r.to, r.at + h] : [r.at - h, r.from, r.at + h, r.to];
        const overlap = l.x1 >= rx0 && l.x0 <= rx1 && l.z1 >= rz0 && l.z0 <= rz1;
        expect(overlap, `${l.kind} ${l.id} on ${r.name}`).toBe(false);
      }
      expect(waterDepth((l.x0 + l.x1) >> 1, (l.z0 + l.z1) >> 1)).toBe(0);
    }
  });

  it("lays out the same county from the same seed, and a different one from another", () => {
    const again = new County(4242), other = new County(99);
    expect(again.lots.map((l) => [l.x0, l.z0, l.kind])).toEqual(county.lots.map((l) => [l.x0, l.z0, l.kind]));
    expect(again.spawn).toEqual(county.spawn);
    // The roads and towns are the county's own; the houses on them are the seed's.
    expect(other.roads).toEqual(county.roads);
    expect(other.lots.map((l) => l.seed)).not.toEqual(county.lots.map((l) => l.seed));
  });

  it("names where you are: a town, a road, the river, the camp, or outside the fence", () => {
    expect(county.placeName(0, 200)).toBe("Millbrook");
    expect(county.placeName(-600, -560)).toBe("Westford");
    expect(county.placeName(BASE.x0 + 50, BASE.z0 + 50)).toBe("Camp Hadley");
    expect(county.placeName(0, -700 + 0)).toMatch(/river|Route 31/);
    expect(county.placeName(CORDON + 20, 0)).toBe("Outside the quarantine zone");
  });
});

describe("building the county", () => {
  const w = world(county);

  it("wakes you standing inside your front door, in a house in Millbrook", () => {
    const [x, y, z] = county.spawn;
    const fx = Math.floor(x), fz = Math.floor(z);
    expect(county.spawnLot.town).toBe("Millbrook");
    expect(w.id(fx, y, fz)).toBe(B.AIR);
    expect(w.id(fx, y + 1, fz)).toBe(B.AIR);
    expect(block(w.id(fx, y - 1, fz)).solid).toBe(true);
    // A roof overhead, somewhere above.
    let roofed = false;
    for (let dy = 2; dy < 12; dy++) if (w.id(fx, y + dy, fz) !== B.AIR) roofed = true;
    expect(roofed).toBe(true);
  });

  it("furnishes a house with a kitchen, a bed, a bathroom, windows, doors and lights", () => {
    const lot = county.spawnLot;
    const seen = new Set<number>();
    for (let x = lot.x0; x <= lot.x1; x++) for (let z = lot.z0; z <= lot.z1; z++) for (let y = GROUND; y <= GROUND + 4; y++) seen.add(w.id(x, y, z));
    for (const id of [C.FRIDGE, C.STOVE, C.COUNTER_SINK, C.TOILET, C.HOUSE_WINDOW, C.FRONT_DOOR, C.PANEL_DOOR, C.CEILING_LIGHT, C.TELEVISION]) {
      expect(seen.has(id), block(id).name).toBe(true);
    }
    expect([...seen].some(isBed)).toBe(true);
  });

  it("stands every door upright in two halves, and hangs every window pane in a wall", () => {
    const lot = county.spawnLot;
    for (let x = lot.x0; x <= lot.x1; x++) for (let z = lot.z0; z <= lot.z1; z++) {
      const id = w.id(x, GROUND + 1, z);
      if (isDoor(id)) {
        expect(w.id(x, GROUND + 2, z)).toBe(id);
        expect(w.meta(x, GROUND + 2, z) & 8).toBe(8);
      }
    }
    const plan = housePlan(lot);
    expect(plan.doors.filter((d) => d.id === C.FRONT_DOOR)).toHaveLength(1);
    expect(plan.rooms.map((r) => r.kind)).toEqual(expect.arrayContaining(["living", "kitchen", "bedroom"]));
  });

  it("paves the highway with a centre line and fills the river under a bridge", () => {
    expect(w.id(0, GROUND, 250)).toBe(C.ASPHALT_YELLOW_LINE);
    expect(w.id(5, GROUND, 250)).toBe(C.ASPHALT_WHITE_LINE);
    // Where Route 31 crosses the river: the deck at ground level, water beneath it.
    let bridged = false;
    for (let z = -760; z < -640; z++) if (waterDepth(0, z) > 2 && w.id(0, GROUND, z) !== B.WATER && w.id(0, SEA_LEVEL, z) === B.WATER) bridged = true;
    expect(bridged).toBe(true);
  });

  it("closes the county in with a fence nobody can break", () => {
    expect(w.id(CORDON, GROUND + 2, 300)).toBe(C.CORDON_FENCE);
    expect(block(C.CORDON_FENCE).hardness).toBe(-1);
  });

  it("builds any chunk the same way twice, whatever was built before it", () => {
    const a = world(new County(4242)), b = world(new County(4242));
    const [x, , z] = county.spawn;
    for (let dx = -20; dx < 20; dx += 3) b.id(x + dx * 5, GROUND, z + 40);
    for (let dx = -8; dx <= 8; dx++) for (let y = GROUND; y < GROUND + 10; y++) {
      expect(a.id(Math.floor(x) + dx, y, Math.floor(z))).toBe(b.id(Math.floor(x) + dx, y, Math.floor(z)));
    }
  });

  it("builds a chunk quickly enough to stream while walking", () => {
    const [x, , z] = county.spawn;
    const t = performance.now();
    for (let i = 0; i < 25; i++) county.fill((Math.floor(x) >> 4) + (i % 5) - 2, (Math.floor(z) >> 4) + Math.floor(i / 5) - 2, { blocks: new Uint16Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME), biomes: new Uint8Array(256) });
    expect((performance.now() - t) / 25).toBeLessThan(40);
  });

  it("is a map pack like the others: the generator builds it and knows where to wake", () => {
    const base = new Generator({ seed: 4242, type: "default" });
    const gen = new MapGenerator("county", base);
    expect(gen.findSpawn()).toEqual({ x: county.spawn[0], y: county.spawn[1], z: county.spawn[2] });
    expect(mapLayout("county", 4242, base).county).toBeDefined();
    const out = gen.generate(Math.floor(county.spawn[0]) >> 4, Math.floor(county.spawn[2]) >> 4);
    expect(out.blocks.some((id) => id >= 4096)).toBe(true);
  });
});
