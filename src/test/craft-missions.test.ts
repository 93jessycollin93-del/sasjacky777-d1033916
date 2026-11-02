import { describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { City, GROUND, isRoadBlock, NEON_BAY, PITCH, STREET, SIDEWALK, CURB } from "@/craft/engine/city";
import { blockIndex, CHUNK_VOLUME } from "@/craft/engine/constants";
import { ALL_MISSIONS, boostPay, CONTACTS, contactSpot, nextMission, placeSpot, raceRoute } from "@/craft/engine/missions";
import { djLine, STATIONS } from "@/craft/engine/radio";
import { Rng } from "@/craft/engine/rng";
import { sanitizeModeTell } from "@/craft/net/session";

const city = new City(NEON_BAY, 2024);

/** The block at a spot, built the way the world builds it. */
function blockAt(x: number, y: number, z: number): number {
  const out = { blocks: new Uint16Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME), biomes: new Uint8Array(256) };
  city.fill(Math.floor(x) >> 4, Math.floor(z) >> 4, out);
  return out.blocks[blockIndex(Math.floor(x) & 15, y, Math.floor(z) & 15)];
}

describe("the contacts and their jobs", () => {
  it("has four contacts with three jobs each, all named, all paid", () => {
    expect(CONTACTS).toHaveLength(4);
    expect(ALL_MISSIONS).toHaveLength(12);
    expect(new Set(ALL_MISSIONS.map((m) => m.mission.id)).size).toBe(12);
    for (const { mission } of ALL_MISSIONS) {
      expect(mission.pay).toBeGreaterThan(0);
      expect(mission.brief.length).toBeGreaterThan(0);
      if (mission.kind === "boost") expect(mission.car && mission.to).toBeTruthy();
      if (mission.kind === "hit") expect(mission.target && mission.from).toBeTruthy();
      if (mission.kind === "delivery") expect(mission.cargo && mission.from && mission.to).toBeTruthy();
      if (mission.kind === "race") expect(mission.checkpoints).toBeGreaterThan(2);
    }
  });

  it("hands them out in order, and nothing after the last", () => {
    const c = CONTACTS[0];
    expect(nextMission(c, 0)?.id).toBe(c.missions[0].id);
    expect(nextMission(c, 2)?.id).toBe(c.missions[2].id);
    expect(nextMission(c, 3)).toBeNull();
  });

  it("puts every pick-up, drop-off and contact on the sidewalk, in the open", () => {
    const spots: [string, [number, number, number]][] = CONTACTS.map((c) => [`contact ${c.id}`, contactSpot(city, c)]);
    for (const { mission } of ALL_MISSIONS) {
      if (mission.from) spots.push([`${mission.id} from`, placeSpot(city, mission.from, 7)]);
      if (mission.to) spots.push([`${mission.id} to`, placeSpot(city, mission.to, 8)]);
    }
    for (const [what, [x, y, z]] of spots) {
      expect(y, what).toBe(STREET);
      expect([SIDEWALK, CURB], what).toContain(blockAt(x, GROUND, z));
      expect(blockAt(x, STREET, z), what).toBe(B.AIR);
    }
    expect(new Set(CONTACTS.map((c) => contactSpot(city, c).join(","))).size).toBe(CONTACTS.length);
  });

  it("lays a race from junction to neighbouring junction, on the road, never doubling back", () => {
    const route = raceRoute(city, 0, 0, 12, () => new Rng(3).next());
    expect(route).toHaveLength(12);
    for (let i = 1; i < route.length; i++) expect(Math.hypot(route[i][0] - route[i - 1][0], route[i][2] - route[i - 1][2])).toBeCloseTo(PITCH, 5);
    for (let i = 2; i < route.length; i++) expect(route[i].join()).not.toBe(route[i - 2].join());
    for (const [x, , z] of route) {
      expect(city.inside(x, z)).toBe(true);
      expect(isRoadBlock(blockAt(x, GROUND, z))).toBe(true);
    }
  });

  it("pays in full for a clean car and a quarter for a wreck-in-waiting", () => {
    expect(boostPay(4000, "sedan", 1000)).toBe(4000);
    expect(boostPay(4000, "sedan", 0)).toBe(1000);
    expect(boostPay(4000, "sedan", 500)).toBe(2500);
  });
});

describe("the radio", () => {
  it("has five stations, each with a key, a beat and something to say", () => {
    expect(STATIONS).toHaveLength(5);
    for (const s of STATIONS) {
      expect(s.lines.length).toBeGreaterThan(2);
      if (s.talk) continue;
      expect(s.songs.length).toBeGreaterThan(2);
      for (const pattern of [s.kick, s.snare, s.hat]) expect(pattern).toHaveLength(16);
      for (const d of s.chords) expect(d).toBeLessThan(s.scale.length);
      expect(s.bpm).toBeGreaterThan(50);
    }
  });

  it("has the DJ name the station and the next song between tunes", () => {
    const s = STATIONS[0];
    const line = djLine(s, 1, () => 0);
    expect(line).toContain(s.name);
    expect(line).toContain(s.songs[1]);
    expect(djLine(STATIONS.find((x) => x.talk)!, 0, () => 0)).not.toContain("Up next");
  });
});

describe("mission words and marks on the wire", () => {
  it("carries a caption, clipped, with a colour it can trust", () => {
    const t = sanitizeModeTell({ caption: { who: "Big Stonks", text: "x".repeat(900), color: "red; background: url(x)" } });
    expect(t.caption?.text).toHaveLength(300);
    expect(t.caption?.color).toBe("#ffffff");
    expect(sanitizeModeTell({ caption: { who: 3, text: "hi" } }).caption).toBeUndefined();
  });

  it("carries a handful of marks, and nothing that is not a number where a number goes", () => {
    const marks = Array.from({ length: 40 }, (_, i) => ({ x: i, y: 64, z: 2, r: 3, color: "#ff0000" }));
    expect(sanitizeModeTell({ markers: marks }).markers).toHaveLength(16);
    expect(sanitizeModeTell({ markers: [{ x: "1", y: 2, z: 3, r: 1, color: "#fff" }] }).markers).toEqual([]);
    expect(sanitizeModeTell({ markers: null }).markers).toBeNull();
    expect(sanitizeModeTell({ markers: [{ x: 1, y: 2, z: 3, r: 999, color: "#123456" }] }).markers?.[0].r).toBe(12);
  });
});
