import { describe, expect, it } from "vitest";
import { DEG, dot, jdFromMs, len } from "@/craft/space/kepler";
import {
  applyMatrix, clockFor, discOverlap, eclipseCentre, eclipseLight, eclipsesFrom, epochForToday, horizonMatrix, nextPhase, showerRates, skyAt, skyJd, solarLongitude,
} from "@/craft/space/sky";
import { compassPoint, describeSky, jdOfLocal, localClock, nextSeenEclipse, nextShowerPeak, phaseName } from "@/craft/space/skyReport";
import { blockToLatLon, placeFor } from "@/craft/space/session";
import { ephemeris } from "@/craft/space/ephemeris";

const jd = (iso: string) => jdFromMs(Date.parse(iso));
const altitude = (v: [number, number, number]) => Math.asin(v[1] / len(v)) / DEG;

describe("the sky's frame", () => {
  it("puts the celestial pole due north at an altitude equal to the latitude", () => {
    for (const lat of [51.5, -33.9, 0]) {
      const pole = applyMatrix(horizonMatrix(lat, 123), [0, 0, 1]);
      expect(altitude(pole)).toBeCloseTo(lat, 6);
      expect(pole[0]).toBeCloseTo(0, 9);
      if (lat > 0) expect(pole[2]).toBeLessThan(0);
    }
  });

  it("makes game noon local noon: the Sun due south and as high as the latitude and season allow", () => {
    // London at the September equinox: the noon Sun about 38.5° up, in the south.
    const epoch = epochForToday(0, jd("2026-09-23T00:00:00Z"));
    const t = skyJd(6000, epoch, -0.1);
    const s = skyAt(t, 51.5, -0.1).sun;
    expect(altitude(s)).toBeGreaterThan(36.5);
    expect(altitude(s)).toBeLessThan(40.5);
    expect(s[2]).toBeGreaterThan(0.7);
    // And at game midnight it is well down.
    expect(altitude(skyAt(skyJd(18000, epoch, -0.1), 51.5, -0.1).sun)).toBeLessThan(-30);
  });

  it("advances the sky a day for every game day", () => {
    const epoch = 2461000.5;
    expect(skyJd(24000 * 7 + 6000, epoch, 0) - skyJd(6000, epoch, 0)).toBeCloseTo(7, 9);
  });
});

describe("the Moon's phases and the eclipses", () => {
  it("finds the full moons and new moons when they happened", () => {
    expect(nextPhase(jd("2024-09-10T00:00:00Z"), 180)).toBeCloseTo(jd("2024-09-18T02:34:00Z"), 1);
    expect(nextPhase(jd("2024-10-10T00:00:00Z"), 180)).toBeCloseTo(jd("2024-10-17T11:26:00Z"), 1);
    expect(nextPhase(jd("2024-04-01T00:00:00Z"), 0)).toBeCloseTo(jd("2024-04-08T18:21:00Z"), 1);
  });

  it("lists 2024's eclipses: a penumbral lunar, the great American total, a partial lunar and an annular", () => {
    const list = eclipsesFrom(jd("2024-01-01T00:00:00Z"), 4);
    const day = (x: number) => new Date((x - 2440587.5) * 86_400_000).toISOString().slice(0, 10);
    expect(list.map((e) => `${e.kind} ${e.type} ${day(e.jd)}`)).toEqual([
      "lunar penumbral 2024-03-25", "solar total 2024-04-08", "lunar partial 2024-09-18", "solar annular 2024-10-02",
    ]);
  });

  it("darkens Dallas at totality on 8 April 2024, and not Sydney", () => {
    const t = jd("2024-04-08T18:42:00Z");
    expect(skyAt(t, 32.78, -96.8).eclipse).toBeGreaterThan(0.95);
    expect(skyAt(t, -33.87, 151.2).eclipse).toBe(0);
  });

  it("lights the Moon by how far it is from the Sun", () => {
    expect(skyAt(jd("2024-09-18T02:34:00Z"), 40, -75).moonLit).toBeGreaterThan(0.98);
    expect(skyAt(jd("2024-04-08T18:21:00Z"), 40, -75).moonLit).toBeLessThan(0.02);
  });

  it("covers the smaller disc by the right share", () => {
    expect(discOverlap(1, 1, 0)).toBe(1);
    expect(discOverlap(1, 1, 2)).toBe(0);
    expect(discOverlap(1, 1.05, 0.02)).toBe(1);
    expect(discOverlap(1, 0.5, 0)).toBeCloseTo(0.25, 9);
    const half = discOverlap(1, 1, 0.8079);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });
});

describe("meteor showers", () => {
  it("brings the Perseids in mid-August and the Geminids in mid-December, each from its own radiant", () => {
    const aug = solarLongitude(ephemeris(jd("2024-08-12T12:00:00Z")).get("earth")!);
    expect(aug).toBeCloseTo(140, 0);
    expect(showerRates(aug)[0].name).toBe("Perseids");
    const dec = solarLongitude(ephemeris(jd("2024-12-14T00:00:00Z")).get("earth")!);
    expect(showerRates(dec)[0].name).toBe("Geminids");
    expect(showerRates(solarLongitude(ephemeris(jd("2024-07-01T00:00:00Z")).get("earth")!)).every((s) => s.zhr < 30)).toBe(true);
  });

  it("counts a shower's meteors only while its radiant is up", () => {
    // Perseid peak night seen from mid-northern latitudes: the radiant is high before dawn.
    const s = skyAt(jd("2024-08-12T09:00:00Z"), 40, -100);
    const per = s.showers.find((x) => x.name === "Perseids")!;
    expect(per.rate).toBeGreaterThan(40);
    expect(dot(per.radiant, [0, 1, 0])).toBeGreaterThan(0.5);
  });
});

describe("comets in the sky", () => {
  it("shows Hale–Bopp bright with a long tail in spring 1997, and nothing of it today", () => {
    const s = skyAt(jd("1997-03-25T20:00:00Z"), 40, -75);
    const hb = s.comets.find((c) => c.id === "halebopp");
    expect(hb).toBeDefined();
    expect(hb!.mag).toBeLessThan(1);
    expect(hb!.tailDeg).toBeGreaterThan(5);
    expect(skyAt(jd("2026-09-27T00:00:00Z"), 40, -75).comets.find((c) => c.id === "halebopp")).toBeUndefined();
  });

  it("brings Halley back into the evening sky in the summer of 2061", () => {
    const s = skyAt(jd("2061-07-29T21:00:00Z"), 40, -75);
    const h = s.comets.find((c) => c.id === "halley");
    expect(h).toBeDefined();
    expect(h!.mag).toBeLessThan(2);
  });

  it("puts Venus near the Sun and bright — but never brighter than its real −4.9 — and never more than 47° from it", () => {
    for (let d = 0; d < 600; d += 37) {
      const s = skyAt(2461000 + d, 30, 0);
      const v = s.planets.find((p) => p.id === "venus")!;
      expect(Math.acos(dot(v.dir, s.sun)) / DEG).toBeLessThan(47.5);
      expect(v.mag).toBeLessThan(-3);
      expect(v.mag).toBeGreaterThan(-5);
    }
  });
});

describe("the Earth's shadow on the Moon", () => {
  it("puts the whole Moon in the umbra at the total lunar eclipse of 8 November 2022, and none of it at a penumbral one", () => {
    expect(skyAt(jd("2022-11-08T10:59:00Z"), 40, -120).umbra).toBeGreaterThan(0.99);
    expect(skyAt(jd("2024-03-25T07:13:00Z"), 40, -100).umbra).toBe(0);
    // 18 September 2024: a partial one, with only a small bite (magnitude 0.08) out of the Moon's northern edge.
    const partial = skyAt(jd("2024-09-18T02:44:00Z"), 40, -75).umbra;
    expect(partial).toBeGreaterThan(0.005);
    expect(partial).toBeLessThan(0.1);
  });

  it("keeps the Moon among its true stars once it is well away from the Sun", () => {
    const s = skyAt(jd("2024-09-18T02:34:00Z"), 40, -75);
    expect(Math.acos(Math.min(1, dot(s.moon, s.moonDrawn))) / DEG).toBeLessThan(0.05);
  });
});

describe("eclipses as the world sees them", () => {
  it("leaves the day nearly whole through a partial eclipse and takes it at totality", () => {
    expect(eclipseLight(0)).toBe(1);
    expect(eclipseLight(0.5)).toBeGreaterThan(0.9);
    expect(eclipseLight(0.9)).toBeGreaterThan(0.55);
    expect(eclipseLight(1)).toBeLessThan(0.15);
    for (let c = 0; c < 1; c += 0.01) expect(eclipseLight(c + 0.01)).toBeLessThanOrEqual(eclipseLight(c) + 1e-12);
  });

  it("finds where a total eclipse is greatest: Mexico in 2024, off Iceland in 2026", () => {
    const a = eclipseCentre(nextPhase(jd("2024-04-01T00:00:00Z"), 0))!;
    expect(a.lat).toBeCloseTo(25.3, 0);
    expect(Math.abs(a.lon - -104.1)).toBeLessThan(1.5);
    expect(skyAt(a.jd, a.lat, a.lon).eclipse).toBe(1);
    const b = eclipseCentre(nextPhase(jd("2026-08-01T00:00:00Z"), 0))!;
    expect(Math.abs(b.lat - 65.2)).toBeLessThan(1);
    expect(Math.abs(b.lon - -25.2)).toBeLessThan(1.5);
  });

  it("sends a watcher in Dallas to the 2024 totality, and one in Sydney past it", () => {
    const dallas = nextSeenEclipse(jd("2024-04-01T00:00:00Z"), 32.78, -96.8, "solar")!;
    expect(dallas.kind).toBe("total solar");
    expect(Math.abs(dallas.at - jd("2024-04-08T18:42:00Z")) * 1440).toBeLessThan(10);
    const sydney = nextSeenEclipse(jd("2024-04-01T00:00:00Z"), -33.87, 151.2, "solar");
    expect(sydney === null || sydney.at > jd("2024-05-01T00:00:00Z")).toBe(true);
  });

  it("finds the next Perseid peak in mid-August", () => {
    const p = nextShowerPeak(jd("2024-06-01T00:00:00Z"), "perseids")!;
    expect(p.name).toBe("Perseids");
    expect(localClock(p.jd, 0).slice(0, 7)).toBe("2024-08");
    expect(Math.abs(p.jd - jd("2024-08-12T12:00:00Z"))).toBeLessThan(1.5);
  });
});

describe("the world's clock and place under the sky", () => {
  it("moves the sky to a moment without changing the world's count of days", () => {
    for (const [target, lon, time] of [[jd("2024-04-08T18:42:00Z"), -96.8, 24000 * 12 + 17000], [jd("1997-03-25T03:00:00Z"), 139.7, 5]] as const) {
      const c = clockFor(target, lon, time);
      expect(Math.floor(c.time / 24000)).toBe(Math.floor(time / 24000));
      expect(Math.abs(skyJd(c.time, c.epoch, lon) - target) * 1440).toBeLessThan(0.1);
    }
  });

  it("reads and writes local solar time the same way", () => {
    const t = jdOfLocal("2024-04-08", 13.5, -96.8)!;
    expect(localClock(t, -96.8)).toBe("2024-04-08 13:30");
    expect(jdOfLocal("not a date", 0, 0)).toBeNull();
  });

  it("can stand the world anywhere, with the player's block exactly on the spot", () => {
    const place = placeFor(1200, -340, 25.3, -104.1);
    const here = blockToLatLon(42, 1200, -340, place);
    expect(here.lat).toBeCloseTo(25.3, 9);
    expect(here.lon).toBeCloseTo(-104.1, 9);
  });

  it("names the Moon's phase and which way to face", () => {
    expect(phaseName(3)).toBe("new");
    expect(phaseName(180)).toBe("full");
    expect(phaseName(120)).toBe("waxing gibbous");
    expect(phaseName(300)).toBe("a waning crescent");
    expect(compassPoint([0, 0, -1])).toBe("north");
    expect(compassPoint([1, 0, 0])).toBe("east");
    expect(compassPoint([-0.7, 0.2, 0.7])).toBe("south-west");
  });

  it("describes the sky in words: the Sun, the Moon, the planets and what is coming", () => {
    const lines = describeSky(jd("2024-08-12T08:00:00Z"), 40, -100);
    expect(lines[0]).toContain("local mean time");
    expect(lines.some((l) => l.includes("The Moon is"))).toBe(true);
    expect(lines.some((l) => l.includes("Perseids"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Next eclipses:"))).toBe(true);
  });
});
