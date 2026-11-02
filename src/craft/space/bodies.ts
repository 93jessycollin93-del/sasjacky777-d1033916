/**
 * The Solar System's catalogue: every body the space view draws and the
 * overview lists, with its size, its spin, its orbit and a paragraph to read
 * in its "show info".
 *
 * The numbers are the real ones, rounded to what shows. Sizes, masses (as GM),
 * spins and poles: NASA/JPL planetary physical parameters and the IAU
 * Working Group on Cartographic Coordinates and Rotational Elements. Planet
 * orbits: JPL's Keplerian elements for approximate positions (Standish),
 * computed in ephemeris.ts. Asteroids, dwarf planets and comets: osculating
 * elements from the Minor Planet Center and JPL's small-body database (J2000
 * ecliptic, or B1950 where a historical catalogue gives them and `frame`
 * says so — ephemeris.ts precesses those). Moons: their mean orbits — size,
 * shape, tilt to the planet's equator and period — with their places along
 * them approximate, except our own Moon, which has a lunar theory of its own.
 */
import { jdFromCalendar, type Conic } from "./kepler";
import type { WorldInfo } from "./worlds";

export type BodyKind = "star" | "planet" | "dwarf" | "moon" | "asteroid" | "comet" | "interstellar" | "probe";

export type Orbit =
  /** The Sun: the origin. */
  | { kind: "fixed" }
  /** A planet (or Pluto): row `index` of JPL's table. */
  | { kind: "planet"; index: number }
  /** The Moon, from the lunar theory. */
  | { kind: "moon" }
  /** Around the Sun, in AU. */
  | { kind: "conic"; conic: Conic; frame?: "B1950" }
  /**
   * Around the parent, in its equatorial plane: semi-major axis (km),
   * eccentricity, inclination to that plane (over 90° goes the other way
   * round), node and argument of periapsis, mean longitude at J2000
   * (degrees), and the sidereal period (days). `libration` adds a slow swing
   * to the mean longitude, amplitude·sin(rate·(year − epoch)) in degrees, for a
   * moon locked in resonance with another (Mimas with Tethys swings ±44° over
   * 71 years, Meeus ch. 46). `nodeRate` (degrees a day) turns the node, for an
   * orbit whose plane precesses fast enough to matter (Triton's, half a degree
   * a year).
   */
  | { kind: "equatorial"; a: number; e: number; i: number; node: number; peri: number; L0: number; period: number; libration?: [number, number, number]; nodeRate?: number }
  /** A craft on a straight line out of the Solar System: direction (RA, Dec), distance in AU at a date and AU a year, from a date on. */
  | { kind: "escape"; ra: number; dec: number; r0: number; t0: number; rate: number; from: number }
  /** A telescope parked a distance (km) behind the Earth from the Sun: the second Lagrange point. */
  | { kind: "l2"; distance: number }
  /**
   * A world of another star (systems.ts), round its parent in the system's
   * own reference plane: semi-major axis (km), eccentricity, inclination,
   * node and argument of periapsis, mean anomaly at J2000 (degrees), and the
   * period (days) — which Kepler's third law ties to the axis and the masses.
   */
  | { kind: "kepler"; a: number; e: number; i: number; node: number; peri: number; M0: number; period: number };

/** Which painter makes its surface (textures.ts), and its colours. */
export type Look =
  | "sun" | "mercury" | "venus" | "earth" | "moon" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune"
  | "io" | "europa" | "ganymede" | "callisto" | "titan" | "enceladus" | "iapetus" | "mimas" | "triton" | "pluto" | "charon"
  | "rock" | "ice" | "ceres" | "vesta" | "comet" | "probe"
  /** Another star's world, painted from its WorldInfo (textures.ts). */
  | "gen";

export interface BodyDef {
  id: string;
  name: string;
  kind: BodyKind;
  parent: string | null;
  /** Equatorial radius, km. */
  radius: number;
  /** How much shorter the polar radius is, as a fraction: the gas giants' spin flattens them. */
  flattening?: number;
  /** Gravitational parameter, km³/s². */
  gm?: number;
  /** Sidereal day in hours; negative turns backwards. Tidally locked moons face their planet instead. */
  rotation?: number;
  locked?: boolean;
  /** North pole's right ascension and declination (J2000, degrees). */
  pole?: [number, number];
  orbit: Orbit;
  color: string;
  look: Look;
  rings?: { inner: number; outer: number; style: "saturn" | "uranus" | "neptune" | "jupiter" };
  atmosphere?: { color: string; height: number; density: number };
  /** A comet's activity: how bright its coma and how long its tails, at one AU. */
  activity?: number;
  facts: string;
  /** What it is like to stand on (worlds.ts): every world with ground, and every world of another star. */
  world?: WorldInfo;
}

const AUd = 149_597_870.7;

/**
 * Halley's perihelia from 240 BC to 2134 (Yeomans & Kiang 1981, MNRAS 197, 633; the 2061 and 2134 predictions from
 * JPL), as calendar dates in TT — Julian before 1582, Gregorian after; astronomical years, so −239 is 240 BC.
 */
const HALLEY_RETURNS: number[] = ([
  [-239, 5, 25.1], [-163, 11, 12], [-86, 8, 6], [-11, 10, 10], [66, 1, 25], [141, 3, 22], [218, 5, 17], [295, 4, 20],
  [374, 2, 16], [451, 6, 28], [530, 9, 27], [607, 3, 15], [684, 10, 2], [760, 5, 20], [837, 2, 28], [912, 7, 18],
  [989, 9, 5], [1066, 3, 20.93], [1145, 4, 18], [1222, 9, 28], [1301, 10, 25], [1378, 11, 10], [1456, 6, 9.6],
  [1531, 8, 26.2], [1607, 10, 27.5], [1682, 9, 15.28], [1759, 3, 13.06], [1835, 11, 16.44], [1910, 4, 20.18],
  [1986, 2, 9.46], [2061, 7, 28.13], [2134, 3, 27.6],
] as const).map(([y, m, d]) => jdFromCalendar(y, m, d));

export const BODIES: BodyDef[] = [
  // ---- the Sun --------------------------------------------------------------------------------------------------
  {
    id: "sun", name: "Sun", kind: "star", parent: null, radius: 695_700, gm: 1.32712440018e11, rotation: 609.12, pole: [286.13, 63.87],
    orbit: { kind: "fixed" }, color: "#fff4d6", look: "sun",
    facts: "A G-type main-sequence star, 4.6 billion years old and halfway through its life. It holds 99.86% of the Solar System's mass; light leaving its surface reaches Earth 8 minutes 20 seconds later. Its core burns at 15 million kelvin, fusing 600 million tonnes of hydrogen every second.",
  },

  // ---- the planets ----------------------------------------------------------------------------------------------
  {
    id: "mercury", name: "Mercury", kind: "planet", parent: "sun", radius: 2439.7, gm: 22031.86, rotation: 1407.6, pole: [281.01, 61.42],
    orbit: { kind: "planet", index: 0 }, color: "#a8a39d", look: "mercury",
    facts: "The smallest planet and the closest to the Sun. It turns three times for every two trips around the Sun, so a day from noon to noon lasts 176 Earth days. The sunlit side reaches 430 °C; the night side falls to −180 °C, and ice survives in its shadowed polar craters.",
  },
  {
    id: "venus", name: "Venus", kind: "planet", parent: "sun", radius: 6051.8, gm: 324858.59, rotation: -5832.5, pole: [272.76, 67.16],
    orbit: { kind: "planet", index: 1 }, color: "#e8d9a8", look: "venus", atmosphere: { color: "#f2dca0", height: 250, density: 1.4 },
    facts: "Earth's twin in size and the hottest planet: a carbon dioxide atmosphere 92 times as thick as ours traps a surface at 465 °C beneath clouds of sulphuric acid. It spins backwards, so slowly that its day is longer than its year.",
  },
  {
    id: "earth", name: "Earth", kind: "planet", parent: "sun", radius: 6378.137, flattening: 1 / 298.257, gm: 398600.435, rotation: 23.9345, pole: [0, 90],
    orbit: { kind: "planet", index: 2 }, color: "#4f7fd6", look: "earth", atmosphere: { color: "#6aa6ff", height: 120, density: 1 },
    facts: "Home — the only world known to hold life, and liquid water on its surface. Its axis leans 23.4°, which gives it seasons; its one large moon steadies that lean. Seen from the Moon it is a blue marble 3.7 times the Moon's width in our sky.",
  },
  {
    id: "mars", name: "Mars", kind: "planet", parent: "sun", radius: 3396.2, flattening: 0.00589, gm: 42828.37, rotation: 24.6229, pole: [317.68, 52.89],
    orbit: { kind: "planet", index: 3 }, color: "#c1440e", look: "mars", atmosphere: { color: "#d99a6c", height: 60, density: 0.25 },
    facts: "The red planet: iron oxide dust over a cold desert with a sky of butterscotch. It holds the Solar System's tallest volcano, Olympus Mons (22 km), and a canyon, Valles Marineris, as long as the United States is wide. Rovers still drive there.",
  },
  {
    id: "jupiter", name: "Jupiter", kind: "planet", parent: "sun", radius: 71_492, flattening: 0.06487, gm: 126_686_534, rotation: 9.925, pole: [268.06, 64.5],
    orbit: { kind: "planet", index: 4 }, color: "#d8b48a", look: "jupiter",
    atmosphere: { color: "#e8d2b0", height: 1200, density: 0.5 },
    facts: "The giant: two and a half times the mass of every other planet put together. Its Great Red Spot is a storm wider than the Earth that has raged for at least 190 years. It turns in under ten hours, flattening itself visibly, and holds 95 known moons.",
  },
  {
    id: "saturn", name: "Saturn", kind: "planet", parent: "sun", radius: 60_268, flattening: 0.09796, gm: 37_931_187, rotation: 10.656, pole: [40.59, 83.54],
    orbit: { kind: "planet", index: 5 }, color: "#e3cf9a", look: "saturn", rings: { inner: 66_900, outer: 140_220, style: "saturn" },
    atmosphere: { color: "#f0e0b8", height: 1500, density: 0.5 },
    facts: "The ringed planet. Its rings are 280,000 km across and mostly less than 100 metres thick — water ice, from grains to boulders. Saturn is the least dense planet: it would float in a big enough ocean. Titan, its largest moon, is bigger than Mercury.",
  },
  {
    id: "uranus", name: "Uranus", kind: "planet", parent: "sun", radius: 25_559, flattening: 0.02293, gm: 5_793_939, rotation: -17.24, pole: [257.31, -15.18],
    orbit: { kind: "planet", index: 6 }, color: "#9fd6dd", look: "uranus", rings: { inner: 41_837, outer: 51_149, style: "uranus" },
    atmosphere: { color: "#b6eef2", height: 800, density: 0.6 },
    facts: "An ice giant knocked on its side: its axis tilts 98°, so each pole gets 42 years of daylight and then 42 of night. Methane in its air soaks up red light and leaves it this pale cyan. It was the first planet found with a telescope, by William Herschel in 1781.",
  },
  {
    id: "neptune", name: "Neptune", kind: "planet", parent: "sun", radius: 24_764, flattening: 0.01708, gm: 6_836_529, rotation: 16.11, pole: [299.36, 43.46],
    orbit: { kind: "planet", index: 7 }, color: "#3f66d8", look: "neptune",
    atmosphere: { color: "#6f95ff", height: 800, density: 0.6 },
    facts: "The windiest world: gusts of 2,100 km/h, the fastest measured anywhere. Found in 1846 by mathematics before anyone saw it — Le Verrier worked out where it had to be from the way it pulled on Uranus. One trip round the Sun takes 165 years.",
  },

  // ---- the dwarf planets --------------------------------------------------------------------------------------------
  {
    id: "pluto", name: "Pluto", kind: "dwarf", parent: "sun", radius: 1188.3, gm: 869.6, rotation: 153.2935, pole: [132.99, -6.16],
    orbit: { kind: "planet", index: 8 }, color: "#d9c3a6", look: "pluto", atmosphere: { color: "#bcd4ff", height: 40, density: 0.15 },
    facts: "The ninth planet from 1930 to 2006, and still the largest known body beyond Neptune. New Horizons flew past in 2015 and found a heart-shaped glacier of nitrogen ice, Tombaugh Regio, mountains of water ice, and blue haze in a thin sky.",
  },
  {
    id: "ceres", name: "Ceres", kind: "dwarf", parent: "sun", radius: 469.7, gm: 62.63, rotation: 9.074, pole: [291.42, 66.76],
    orbit: { kind: "conic", conic: { q: 2.7656157 * (1 - 0.0795763), e: 0.0795763, i: 10.58789, node: 80.24963, peri: 73.29974, tp: 2461000.5 - 231.53975 / 0.21429712, n: 0.21429712 } },
    color: "#8f8a84", look: "ceres",
    facts: "The largest object in the asteroid belt, and the first found (Piazzi, 1801). A third of the belt's whole mass. Dawn orbited it from 2015 to 2018 and saw bright salt deposits in Occator crater — the remains of brine that welled up from below.",
  },
  {
    id: "eris", name: "Eris", kind: "dwarf", parent: "sun", radius: 1163, gm: 1108, rotation: 378.9,
    orbit: { kind: "conic", conic: { q: 68.1040789 * (1 - 0.434306), e: 0.434306, i: 43.77787, node: 36.06369, peri: 150.71804, tp: 2460600.5 - 210.56621 / 0.00175366, n: 0.00175366 } },
    color: "#e6e2dc", look: "ice",
    facts: "The discovery that ended Pluto's planethood: almost exactly Pluto's size and more massive. Its orbit reaches 97 AU from the Sun and tilts 44° from the planets'; a year there lasts 559 of ours. Its surface is frozen methane, one of the brightest in the Solar System.",
  },
  {
    id: "haumea", gm: 267.4, name: "Haumea", kind: "dwarf", parent: "sun", radius: 816, rotation: 3.915,
    orbit: { kind: "conic", conic: { q: 42.9203649 * (1 - 0.1983178), e: 0.1983178, i: 28.20847, node: 121.86591, peri: 240.99593, tp: 2460600.5 - 220.88163 / 0.00350517, n: 0.00350517 } },
    color: "#ecebe8", look: "ice",
    facts: "A dwarf planet spinning so fast — once every four hours — that it has stretched into an egg twice as long as it is wide. It has a ring and two moons, and a coat of crystalline water ice.",
  },
  {
    id: "makemake", name: "Makemake", kind: "dwarf", parent: "sun", radius: 715, rotation: 22.83,
    orbit: { kind: "conic", conic: { q: 45.3841905 * (1 - 0.1635304), e: 0.1635304, i: 29.03373, node: 79.26068, peri: 296.7554, tp: 2460600.5 - 168.41459 / 0.00322364, n: 0.00322364 } },
    color: "#d8b6a0", look: "ice",
    facts: "A reddish dwarf planet of the Kuiper belt, found around Easter 2005 and named after the creator god of the people of Rapa Nui. Its surface is methane and ethane ice.",
  },
  {
    id: "sedna", name: "Sedna", kind: "dwarf", parent: "sun", radius: 500, rotation: 10.3,
    orbit: { kind: "conic", conic: { q: 552.1531164 * (1 - 0.8618058), e: 0.8618058, i: 11.92774, node: 144.39469, peri: 310.87403, tp: 2460600.5 - 358.59443 / 7.597e-5, n: 7.597e-5 } },
    color: "#b5553a", look: "ice",
    facts: "One of the reddest objects known, on an orbit that takes it out to about 1,000 AU and 11,400 years to go round. Nothing we know of could have flung it there: some think a passing star did, early on; some think a planet no one has found yet still does.",
  },
  {
    id: "quaoar", name: "Quaoar", kind: "dwarf", parent: "sun", radius: 555, rotation: 17.68,
    orbit: { kind: "conic", conic: { q: 43.1934847 * (1 - 0.0376011), e: 0.0376011, i: 7.9912, node: 189.04724, peri: 163.15048, tp: 2460600.5 - 290.95514 / 0.00347198, n: 0.00347198 } },
    color: "#b89a88", look: "ice",
    facts: "A Kuiper-belt world with a ring far outside where rings should be able to survive — at seven times its own radius, beyond the distance at which a moon's tides ought to have pulled the ring together into a moon.",
  },

  // ---- moons ------------------------------------------------------------------------------------------------------
  // Mean longitudes at J2000 are fitted to the standard theories, and checked against them from 2000 to 2035
  // (src/test/craft-moons.test.ts): ESAPHO/ESADE for Phobos and Deimos, Lieske's E5 for the Galilean moons, TASS 1.7
  // for Saturn's, GUST86 for Uranus's, all as PyEphem computes them; the IAU rotation models (Archinal et al. 2018)
  // for Charon, which keeps Pluto's prime meridian, and Triton, which faces Neptune. Before, most were placed at
  // invented points on their orbits — Io on the wrong side of Jupiter, Charon going round backwards.
  {
    id: "moon", name: "Moon", kind: "moon", parent: "earth", radius: 1737.4, gm: 4902.8, locked: true, pole: [269.99, 66.54],
    orbit: { kind: "moon" }, color: "#b8b5ae", look: "moon",
    facts: "The fifth-largest moon, and the only other world people have walked on (twelve of them, 1969–1972). It turns once per orbit, so the same face always looks at us. It drifts 3.8 cm further from the Earth every year, and it is exactly the right size and distance to cover the Sun in a total eclipse.",
  },
  {
    id: "phobos", gm: 7.087e-4, name: "Phobos", kind: "moon", parent: "mars", radius: 11.1, locked: true,
    orbit: { kind: "equatorial", a: 9376, e: 0.0151, i: 1.08, node: 169, peri: 150, L0: 213.0, period: 0.31891 },
    color: "#7f746a", look: "rock",
    facts: "Mars's larger moon, a lumpy potato 27 km long, orbiting so low that it goes round faster than Mars turns — it rises in the west twice a day. Tides are pulling it in: in about 50 million years it will break up into a ring or hit Mars.",
  },
  {
    id: "deimos", gm: 9.62e-5, name: "Deimos", kind: "moon", parent: "mars", radius: 6.2, locked: true,
    orbit: { kind: "equatorial", a: 23_463, e: 0.00033, i: 1.79, node: 55, peri: 260, L0: 257.9, period: 1.2624407},
    color: "#8a7f73", look: "rock",
    facts: "Mars's smaller moon, 15 km across and smoothed over by fine dust. From Mars it looks like a bright star that takes two and a half days to cross the sky.",
  },
  {
    id: "io", name: "Io", kind: "moon", parent: "jupiter", radius: 1821.6, gm: 5959.9, locked: true,
    orbit: { kind: "equatorial", a: 421_700, e: 0.0041, i: 0.05, node: 0, peri: 0, L0: 19.3, period: 1.769138 },
    color: "#e8d05a", look: "io",
    facts: "The most volcanic world known: some 400 active volcanoes, fed by the tides Jupiter raises in its rock as Europa and Ganymede tug it back and forth. Its plumes throw sulphur 400 km up, and it paints its own surface yellow, orange and white.",
  },
  {
    id: "europa", name: "Europa", kind: "moon", parent: "jupiter", radius: 1560.8, gm: 3202.7, locked: true,
    orbit: { kind: "equatorial", a: 671_034, e: 0.0094, i: 0.471, node: 0, peri: 0, L0: 213.5, period: 3.551181 },
    color: "#d8cfbd", look: "europa",
    facts: "A shell of ice over an ocean with twice the water of all Earth's oceans. Its surface is crossed by long reddish cracks and barely cratered — young, and still moving. One of the best places in the Solar System to look for life.",
  },
  {
    id: "ganymede", name: "Ganymede", kind: "moon", parent: "jupiter", radius: 2634.1, gm: 9887.8, locked: true,
    orbit: { kind: "equatorial", a: 1_070_412, e: 0.0013, i: 0.204, node: 0, peri: 0, L0: 221.8, period: 7.154553 },
    color: "#9d9285", look: "ganymede",
    facts: "The largest moon in the Solar System — bigger than Mercury — and the only one with its own magnetic field, which makes aurorae. Dark ancient terrain alternates with lighter grooved bands, and a salty ocean hides deep under the ice.",
  },
  {
    id: "callisto", name: "Callisto", kind: "moon", parent: "jupiter", radius: 2410.3, gm: 7179.3, locked: true,
    orbit: { kind: "equatorial", a: 1_882_709, e: 0.0074, i: 0.205, node: 0, peri: 0, L0: 80.2, period: 16.689018 },
    color: "#6f6456", look: "callisto",
    facts: "The most heavily cratered surface in the Solar System: four billion years of impacts on ice and rock that never melted or moved. It orbits outside Jupiter's worst radiation, which makes it the likeliest place for a human base out there.",
  },
  {
    id: "amalthea", gm: 0.138, name: "Amalthea", kind: "moon", parent: "jupiter", radius: 83.5, locked: true,
    orbit: { kind: "equatorial", a: 181_366, e: 0.003, i: 0.37, node: 0, peri: 0, L0: 120, period: 0.498179 },
    color: "#a8553a", look: "rock",
    facts: "The reddest object in the Solar System: a lumpy moon 250 km long, dusted with sulphur from Io, whirling round Jupiter in under twelve hours.",
  },
  {
    id: "mimas", gm: 2.5026, name: "Mimas", kind: "moon", parent: "saturn", radius: 198.2, locked: true,
    orbit: { kind: "equatorial", a: 185_539, e: 0.0196, i: 1.574, node: 0, peri: 0, L0: 159.3, period: 0.942422, libration: [-43.57, 5.095, 1866.39] },
    color: "#c9c6c0", look: "mimas",
    facts: "The small moon with the enormous crater: Herschel, 130 km wide on a moon 396 km across, which makes it look uncannily like a certain battle station. The impact nearly broke Mimas apart.",
  },
  {
    id: "enceladus", gm: 7.2027, name: "Enceladus", kind: "moon", parent: "saturn", radius: 252.1, locked: true,
    orbit: { kind: "equatorial", a: 237_948, e: 0.0047, i: 0.009, node: 0, peri: 0, L0: 181.8, period: 1.370218 },
    color: "#f4f6f8", look: "enceladus",
    facts: "The whitest world known, reflecting almost all the light that hits it. Geysers at its south pole spray water from an ocean underneath into space, feeding Saturn's E ring. Cassini flew through the plumes and tasted salt, silica and organic molecules.",
  },
  {
    id: "tethys", gm: 41.2067, name: "Tethys", kind: "moon", parent: "saturn", radius: 531.1, locked: true,
    orbit: { kind: "equatorial", a: 294_619, e: 0.0001, i: 1.12, node: 0, peri: 0, L0: 188.5, period: 1.887802 },
    color: "#dedbd6", look: "ice",
    facts: "Almost pure water ice. A canyon, Ithaca Chasma, runs three quarters of the way around it, and a crater, Odysseus, is two fifths of its width.",
  },
  {
    id: "dione", gm: 73.1146, name: "Dione", kind: "moon", parent: "saturn", radius: 561.4, locked: true,
    orbit: { kind: "equatorial", a: 377_396, e: 0.0022, i: 0.019, node: 0, peri: 0, L0: 177.0, period: 2.736915 },
    color: "#d0ccc6", look: "ice",
    facts: "An icy moon streaked with bright cliffs of ice hundreds of metres high on its trailing side — fractures, not frost, as was once thought.",
  },
  {
    id: "rhea", gm: 153.9426, name: "Rhea", kind: "moon", parent: "saturn", radius: 763.8, locked: true,
    orbit: { kind: "equatorial", a: 527_108, e: 0.001, i: 0.345, node: 0, peri: 0, L0: 52.35, period: 4.5175026},
    color: "#cdc8c1", look: "ice",
    facts: "Saturn's second-largest moon: a dirty snowball of ice and rock, 1,527 km across, cratered all over.",
  },
  {
    id: "titan", name: "Titan", kind: "moon", parent: "saturn", radius: 2574.7, gm: 8978.1, locked: true,
    orbit: { kind: "equatorial", a: 1_221_870, e: 0.0288, i: 0.34854, node: 0, peri: 186, L0: 7.9, period: 15.945421 },
    color: "#d9a54a", look: "titan", atmosphere: { color: "#e0a040", height: 600, density: 2.2 },
    facts: "The only moon with a thick atmosphere — denser than Earth's — and the only place besides Earth with rivers, lakes and seas on its surface. They are liquid methane and ethane, under an orange smog. The Huygens probe landed there in 2005.",
  },
  {
    id: "hyperion", gm: 0.3727, name: "Hyperion", kind: "moon", parent: "saturn", radius: 135,
    orbit: { kind: "equatorial", a: 1_481_010, e: 0.123, i: 0.568, node: 0, peri: 0, L0: 297.9, period: 21.276609 },
    color: "#b39b7c", look: "rock",
    facts: "A porous, sponge-like moon that tumbles chaotically: no one can predict which way it will be facing a few months from now.",
  },
  {
    id: "iapetus", gm: 120.5038, name: "Iapetus", kind: "moon", parent: "saturn", radius: 734.5, locked: true,
    orbit: { kind: "equatorial", a: 3_560_820, e: 0.0286, i: 15.97, node: 253.64, peri: 0, L0: 86.1, period: 79.3215 },
    color: "#8e8578", look: "iapetus",
    facts: "The two-faced moon: its leading side is as dark as coal and its trailing side as bright as snow. A ridge 20 km high runs round its equator, giving it the look of a walnut.",
  },
  {
    id: "miranda", gm: 4.4, name: "Miranda", kind: "moon", parent: "uranus", radius: 235.8, locked: true,
    orbit: { kind: "equatorial", a: 129_390, e: 0.0013, i: 175.768, node: 0, peri: 0, L0: 148.4, period: 1.413479 },
    color: "#bdbab4", look: "ice",
    facts: "A patchwork moon of grooved and cratered terrains jammed together, with Verona Rupes — a cliff some 20 km high, perhaps the tallest in the Solar System.",
  },
  {
    id: "ariel", gm: 83.5, name: "Ariel", kind: "moon", parent: "uranus", radius: 578.9, locked: true,
    orbit: { kind: "equatorial", a: 191_020, e: 0.0012, i: 179.74, node: 0, peri: 0, L0: 23.3, period: 2.520379 },
    color: "#c4c0ba", look: "ice",
    facts: "The brightest of Uranus's moons, its surface young and cut by long valleys.",
  },
  {
    id: "umbriel", gm: 85.1, name: "Umbriel", kind: "moon", parent: "uranus", radius: 584.7, locked: true,
    orbit: { kind: "equatorial", a: 266_000, e: 0.0039, i: 179.795, node: 0, peri: 0, L0: 71.0, period: 4.144177 },
    color: "#7a7672", look: "rock",
    facts: "The darkest of Uranus's large moons, with one bright ring on it — the crater Wunda — like a lost wedding band.",
  },
  {
    id: "titania", gm: 226.9, name: "Titania", kind: "moon", parent: "uranus", radius: 788.4, locked: true,
    orbit: { kind: "equatorial", a: 435_910, e: 0.0011, i: 179.66, node: 0, peri: 0, L0: 101.6, period: 8.705872 },
    color: "#b3aca4", look: "ice",
    facts: "Uranus's largest moon, cracked by canyons as if it once swelled from inside.",
  },
  {
    id: "oberon", gm: 205.3, name: "Oberon", kind: "moon", parent: "uranus", radius: 761.4, locked: true,
    orbit: { kind: "equatorial", a: 583_520, e: 0.0014, i: 179.942, node: 0, peri: 0, L0: 172.2, period: 13.463239 },
    color: "#a39d96", look: "rock",
    facts: "The outermost of the five large moons of Uranus: old, cratered, with a mountain some 11 km high on its limb.",
  },
  {
    id: "triton", name: "Triton", kind: "moon", parent: "neptune", radius: 1353.4, gm: 1427.6, locked: true,
    orbit: { kind: "equatorial", a: 354_759, e: 0.000016, i: 156.829, node: 177.848, peri: 0, L0: 239.17, period: 5.876578, nodeRate: 1.437943e-3 },
    color: "#d7cfc8", look: "triton", atmosphere: { color: "#c8d8ff", height: 20, density: 0.1 },
    facts: "A captured world: the only large moon that orbits backwards. Probably a dwarf planet from the Kuiper belt that Neptune caught. Voyager 2 saw geysers of nitrogen on its pinkish, cantaloupe-textured surface at −235 °C. Tides are slowly dragging it down.",
  },
  {
    id: "proteus", name: "Proteus", kind: "moon", parent: "neptune", radius: 210, locked: true,
    orbit: { kind: "equatorial", a: 117_647, e: 0.0005, i: 0.524, node: 0, peri: 0, L0: 90, period: 1.122315 },
    color: "#6e6862", look: "rock",
    facts: "About as big as a body can be without gravity pulling it round: a dark, boxy moon 420 km across.",
  },
  {
    id: "nereid", name: "Nereid", kind: "moon", parent: "neptune", radius: 170,
    orbit: { kind: "equatorial", a: 5_513_818, e: 0.7507, i: 7.09, node: 0, peri: 280, L0: 30, period: 360.13 },
    color: "#8f8a85", look: "rock",
    facts: "The moon with the most stretched-out orbit known: it swings from 1.4 to 9.7 million km from Neptune once a year.",
  },
  {
    id: "charon", name: "Charon", kind: "moon", parent: "pluto", radius: 606, gm: 106.1, locked: true,
    orbit: { kind: "equatorial", a: 19_591, e: 0.0002, i: 0.08, node: 0, peri: 0, L0: 302.695, period: 6.3872274},
    color: "#a29b93", look: "charon",
    facts: "Half Pluto's size, so the two circle a point in the space between them: a double world, each always showing the other the same face. Charon's north pole wears a reddish cap of material escaped from Pluto's air.",
  },
  {
    id: "nix", name: "Nix", kind: "moon", parent: "pluto", radius: 25,
    orbit: { kind: "equatorial", a: 48_694, e: 0.002, i: 0.13, node: 0, peri: 0, L0: 120, period: 24.85463 },
    color: "#d9d4ce", look: "ice",
    facts: "A small, bright moon of Pluto, tumbling as it goes round the Pluto–Charon pair.",
  },
  {
    id: "hydra", name: "Hydra", kind: "moon", parent: "pluto", radius: 25,
    orbit: { kind: "equatorial", a: 64_738, e: 0.0059, i: 0.24, node: 0, peri: 0, L0: 230, period: 38.20177 },
    color: "#e6e1db", look: "ice",
    facts: "Pluto's outermost moon, coated in almost pure water ice and spinning once every ten hours.",
  },

  // ---- asteroids ------------------------------------------------------------------------------------------------------
  {
    id: "vesta", gm: 17.288, name: "Vesta", kind: "asteroid", parent: "sun", radius: 262.7, rotation: 5.342,
    orbit: { kind: "conic", conic: { q: 2.3615413 * (1 - 0.0901676), e: 0.0901676, i: 7.14406, node: 103.70232, peri: 151.53712, tp: 2461000.5 - 26.80968 / 0.27158812, n: 0.27158812 } },
    color: "#a8a295", look: "vesta",
    facts: "The brightest asteroid — at times visible to the naked eye — and a survivor from the planet-building era with a crust, mantle and core. A giant impact at its south pole blasted out Rheasilvia, a crater with a central mountain twice as high as Everest.",
  },
  {
    id: "pallas", gm: 13.665, name: "Pallas", kind: "asteroid", parent: "sun", radius: 256, rotation: 7.813,
    orbit: { kind: "conic", conic: { q: 2.7699258 * (1 - 0.230643), e: 0.230643, i: 34.92833, node: 172.88859, peri: 310.9334, tp: 2461000.5 - 211.52977 / 0.21379713, n: 0.21379713 } },
    color: "#8d8a86", look: "rock",
    facts: "The second asteroid found (1802), on an orbit tilted 35° — so steeply that no spacecraft has visited it.",
  },
  {
    id: "juno", name: "Juno", kind: "asteroid", parent: "sun", radius: 123.3, rotation: 7.21,
    orbit: { kind: "conic", conic: { q: 2.6708791 * (1 - 0.2558258), e: 0.2558258, i: 12.98604, node: 169.81989, peri: 247.88367, tp: 2461000.5 - 217.59095 / 0.22579938, n: 0.22579938 } },
    color: "#9c958c", look: "rock",
    facts: "The third asteroid found, in 1804: a stony body some 250 km across.",
  },
  {
    id: "hygiea", name: "Hygiea", kind: "asteroid", parent: "sun", radius: 217, rotation: 13.8,
    orbit: { kind: "conic", conic: { q: 3.1475914 * (1 - 0.1082238), e: 0.1082238, i: 3.83294, node: 283.12164, peri: 312.60583, tp: 2461000.5 - 216.69031 / 0.17649669, n: 0.17649669 } },
    color: "#5c5854", look: "rock",
    facts: "The fourth-largest asteroid, and round enough that it may one day be counted a dwarf planet: a dark, carbon-rich world.",
  },
  {
    id: "psyche", gm: 1.53, name: "Psyche", kind: "asteroid", parent: "sun", radius: 111, rotation: 4.196,
    orbit: { kind: "conic", conic: { q: 2.9233145 * (1 - 0.1343462), e: 0.1343462, i: 3.09729, node: 150.00988, peri: 229.75341, tp: 2461000.5 - 40.63883 / 0.19719267, n: 0.19719267 } },
    color: "#9a948a", look: "rock",
    facts: "A metal-rich asteroid, perhaps the exposed core of a baby planet. NASA's Psyche spacecraft is on its way, due in 2029.",
  },
  {
    id: "eros", gm: 4.463e-4, name: "Eros", kind: "asteroid", parent: "sun", radius: 8.4, rotation: 5.27,
    orbit: { kind: "conic", conic: { q: 1.458121 * (1 - 0.222836), e: 0.222836, i: 10.82847, node: 304.27008, peri: 178.92978, tp: 2461000.5 - 310.55432 / 0.5597753, n: 0.5597753 } },
    color: "#a08c70", look: "rock",
    facts: "A near-Earth asteroid shaped like a peanut, 34 km long — the first asteroid orbited (NEAR Shoemaker, 2000) and the first landed on, in 2001.",
  },
  {
    id: "bennu", gm: 4.892e-9, name: "Bennu", kind: "asteroid", parent: "sun", radius: 0.245, rotation: 4.296,
    orbit: { kind: "conic", conic: { q: 1.1259697 * (1 - 0.203731), e: 0.203731, i: 6.0332, node: 1.98793, peri: 66.37026, tp: 2460400.5 - 132.53139 / 0.82492421, n: 0.82492421 } },
    color: "#4d4944", look: "rock",
    facts: "A rubble pile of boulders 490 m across. OSIRIS-REx touched down in 2020 and brought 121 grams of it home in 2023. It has a small chance of hitting Earth in the late 2100s.",
  },
  {
    id: "ryugu", name: "Ryugu", kind: "asteroid", parent: "sun", radius: 0.45, rotation: 7.63,
    orbit: { kind: "conic", conic: { q: 1.1910091 * (1 - 0.1911163), e: 0.1911163, i: 5.86663, node: 251.29445, peri: 211.61036, tp: 2460600.5 - 327.32794 / 0.75828325, n: 0.75828325 } },
    color: "#46423e", look: "rock",
    facts: "A diamond-shaped rubble pile Hayabusa2 visited, shot a crater into and brought samples of home in 2020 — samples holding amino acids.",
  },
  {
    id: "apophis", name: "Apophis", kind: "asteroid", parent: "sun", radius: 0.17, rotation: 30.56,
    orbit: { kind: "conic", conic: { q: 0.922382 * (1 - 0.1911496), e: 0.1911496, i: 3.34099, node: 203.90419, peri: 126.67242, tp: 2460600.5 - 227.7639 / 1.11259693, n: 1.11259693 } },
    color: "#8c8378", look: "rock",
    facts: "On 13 April 2029 this 340-metre asteroid will pass 32,000 km above the Earth — inside the ring of geostationary satellites, and bright enough to see without a telescope. It will not hit us.",
  },
  {
    id: "phaethon", name: "Phaethon", kind: "asteroid", parent: "sun", radius: 2.9, rotation: 3.604,
    orbit: { kind: "conic", conic: { q: 1.2714723 * (1 - 0.8898057), e: 0.8898057, i: 22.31117, node: 265.09637, peri: 322.30537, tp: 2460600.5 - 248.97654 / 0.68745416, n: 0.68745416 } },
    color: "#6c6560", look: "rock",
    facts: "An asteroid that behaves like a dead comet: it swoops to 0.14 AU from the Sun, hot enough to crack its rock, and the debris it sheds is the Geminid meteor shower every December.",
  },

  // ---- comets -----------------------------------------------------------------------------------------------------------
  {
    id: "halley", name: "1P/Halley", kind: "comet", parent: "sun", radius: 5.5, rotation: 52.8, activity: 1,
    // The 1986 return's elements, timed return by return: the planets stretch its period between 74 and 79 years, and a
    // single ellipse missed 1910 by four months and 1066 by fourteen years.
    orbit: { kind: "conic", conic: { q: 0.5871036, e: 0.9672769, i: 162.24217, node: 58.86013, peri: 111.86566, tp: 2446470.95895, returns: HALLEY_RETURNS } },
    color: "#c9d6e8", look: "comet",
    facts: "The comet everyone knows: back every 75 or 76 years, seen at every return since at least 240 BC and stitched into the Bayeux Tapestry in 1066. Edmond Halley predicted its 1758 return — the first proof that comets orbit the Sun. Its dust makes two meteor showers, the Eta Aquariids in May and the Orionids in October. Next perihelion: 28 July 2061.",
  },
  // Periodic comets from Marsden's catalogue (B1950) are timed between two of their perihelia, like Halley's.
  {
    id: "encke", name: "2P/Encke", kind: "comet", parent: "sun", radius: 2.4, rotation: 11, activity: 0.35,
    orbit: { kind: "conic", frame: "B1950", conic: { q: 0.339009, e: 0.847061, i: 12.3594, node: 334.7189, peri: 185.2301, tp: 2437336.0949, n: (360 * 19) / (2460240.1 - 2437336.0949) } },
    color: "#b8c4d4", look: "comet",
    facts: "The comet with the shortest period of the bright ones: back every 3.3 years. Its debris makes the Taurid meteors every autumn — and perhaps, some think, the Tunguska blast of 1908.",
  },
  {
    id: "swifttuttle", name: "109P/Swift–Tuttle", kind: "comet", parent: "sun", radius: 13, rotation: 67, activity: 1.3,
    orbit: { kind: "conic", frame: "B1950", conic: { q: 0.9582163, e: 0.9635892, i: 113.43189, node: 138.74394, peri: 152.99742, tp: 2448968.82426, n: 360 / (2497757.5 - 2448968.82426) } },
    color: "#c6d2e2", look: "comet",
    facts: "The largest object known to pass repeatedly near the Earth: a 26-km nucleus on a 133-year orbit. Every August the Earth crosses its trail of dust — the Perseids. It returns in 2126.",
  },
  {
    id: "tempeltuttle", name: "55P/Tempel–Tuttle", kind: "comet", parent: "sun", radius: 1.8, activity: 0.5,
    orbit: { kind: "conic", frame: "B1950", conic: { q: 0.981656, e: 0.904433, i: 162.7106, node: 234.4357, peri: 172.5795, tp: 2438880.501, n: 360 / (2450872.5 - 2438880.501) } },
    color: "#b9c6d6", look: "comet",
    facts: "Parent of the Leonids, the November meteors that every 33 years or so become a storm — thousands an hour in 1833, 1966 and 1999.",
  },
  {
    id: "halebopp", name: "C/1995 O1 Hale–Bopp", kind: "comet", parent: "sun", radius: 30, rotation: 11.3, activity: 3,
    orbit: { kind: "conic", conic: { q: 0.91413353, e: 0.99508172, i: 89.43015, node: 282.47085, peri: 130.58949, tp: 2450539.6373 } },
    color: "#d7e2f0", look: "comet",
    facts: "The Great Comet of 1997, seen by more people than any comet in history: visible to the naked eye for 18 months, with a blue ion tail and a white dust tail. Its nucleus is some 60 km wide. It will not be back for about 2,400 years.",
  },
  {
    id: "hyakutake", name: "C/1996 B2 Hyakutake", kind: "comet", parent: "sun", radius: 2.1, activity: 1.2,
    orbit: { kind: "conic", conic: { q: 0.23022925, e: 0.99989902, i: 124.92275, node: 188.04523, peri: 130.17407, tp: 2450204.89407 } },
    color: "#c7d6ec", look: "comet",
    facts: "The Great Comet of 1996, which passed just 15 million km from the Earth and stretched a tail across a third of the sky. Ulysses flew through that tail 570 million km from the comet — the longest comet tail known.",
  },
  {
    id: "mcnaught", name: "C/2006 P1 McNaught", kind: "comet", parent: "sun", radius: 12.5, activity: 2,
    orbit: { kind: "conic", conic: { q: 0.17073644, e: 1.00001907, i: 77.83699, node: 267.41479, peri: 155.97496, tp: 2454113.29885 } },
    color: "#e2dcc8", look: "comet",
    facts: "The Great Comet of 2007, brightest in 40 years, visible in daylight, with a curved dust tail that fanned out in striae across the southern sky. Its orbit is open: it is leaving the Solar System for good.",
  },
  {
    id: "neowise", name: "C/2020 F3 NEOWISE", kind: "comet", parent: "sun", radius: 2.5, activity: 1.1,
    orbit: { kind: "conic", conic: { q: 0.294934, e: 0.999132, i: 128.9699, node: 61.0213, peri: 37.2926, tp: 2459034.1265 } },
    color: "#d7dce6", look: "comet",
    facts: "The comet of the 2020 lockdown summer, bright to the naked eye in the northern evening sky. It will be back in about 6,800 years.",
  },
  {
    id: "cg67p", name: "67P/Churyumov–Gerasimenko", kind: "comet", parent: "sun", radius: 2, rotation: 12.4, activity: 0.3,
    orbit: { kind: "conic", frame: "B1950", conic: { q: 1.3000348, e: 0.6301925, i: 7.10965, node: 50.3507, peri: 11.34336, tp: 2450100.16177, n: (360 * 4) / (2459520.5 - 2450100.16177) } },
    color: "#6d6964", look: "comet",
    facts: "The rubber-duck comet: Rosetta orbited it for two years (2014–2016) and dropped the Philae lander on its surface — the first landing on a comet.",
  },

  // ---- from interstellar space ------------------------------------------------------------------------------------------------------
  {
    id: "oumuamua", name: "1I/ʻOumuamua", kind: "interstellar", parent: "sun", radius: 0.1,
    orbit: { kind: "conic", conic: { q: 0.25383, e: 1.1956, i: 122.545, node: 24.6056, peri: 241.43, tp: 2458005.961 } },
    color: "#a07060", look: "rock",
    facts: "The first object seen passing through the Solar System from another star, in 2017: long and thin, reddish, tumbling, and speeding up very slightly as it left without showing a comet's gas. Its orbit is open; it is already beyond Neptune, never to return.",
  },
  {
    id: "borisov", name: "2I/Borisov", kind: "interstellar", parent: "sun", radius: 0.4, activity: 0.4,
    orbit: { kind: "conic", conic: { q: 1.940202, e: 3.079483, i: 44.678, node: 307.5378, peri: 210.6978, tp: 2458827.7323958 } },
    color: "#c0ccd8", look: "comet",
    facts: "The first interstellar comet, found by an amateur astronomer in 2019: a visitor from another star, rich in carbon monoxide, on a hyperbola so open that the Sun barely bent its path.",
  },

  // ---- our own ------------------------------------------------------------------------------------------------------------------------
  {
    id: "jwst", name: "James Webb Space Telescope", kind: "probe", parent: "earth", radius: 0.011,
    orbit: { kind: "l2", distance: 1_500_000 }, color: "#e8c050", look: "probe",
    facts: "The largest telescope in space, parked 1.5 million km beyond the Earth at the second Lagrange point, where the Sun, the Earth and the Moon all stay behind its tennis-court-sized sunshield. It sees in infrared, back to the first galaxies.",
  },
  {
    id: "voyager1", name: "Voyager 1", kind: "probe", parent: "sun", radius: 0.002,
    orbit: { kind: "escape", ra: 257.5, dec: 12.1, r0: 165.5, t0: 2460676.5, rate: 3.58, from: 2447892.5 },
    color: "#d0d0d0", look: "probe",
    facts: "The farthest human-made object, launched in 1977: past Jupiter and Saturn, and since 2012 in interstellar space. Its radio signals take nearly a day to reach Earth. It carries a golden record of sounds and pictures from Earth.",
  },
  {
    id: "voyager2", name: "Voyager 2", kind: "probe", parent: "sun", radius: 0.002,
    orbit: { kind: "escape", ra: 300.5, dec: -58.6, r0: 138.6, t0: 2460676.5, rate: 3.23, from: 2447892.5 },
    color: "#d0d0d0", look: "probe",
    facts: "The only spacecraft to have visited Uranus (1986) and Neptune (1989). It crossed into interstellar space in 2018, heading south of the ecliptic.",
  },
];

export const BODY: Record<string, BodyDef> = Object.fromEntries(BODIES.map((b) => [b.id, b]));

/** A body's moons, largest first. */
export function moonsOf(id: string): BodyDef[] {
  return BODIES.filter((b) => b.parent === id && b.kind === "moon").sort((a, b) => b.radius - a.radius);
}

/** "Planet", "Moon of Saturn", "Comet"… for the overview's type column. */
export function kindLabel(b: BodyDef): string {
  switch (b.kind) {
    case "star": return "Star";
    case "planet": return "Planet";
    case "dwarf": return "Dwarf planet";
    case "moon": return `Moon of ${BODY[b.parent!]?.name ?? "?"}`;
    case "asteroid": return "Asteroid";
    case "comet": return "Comet";
    case "interstellar": return "Interstellar object";
    case "probe": return "Spacecraft";
  }
}

export { AUd as AU_KM };
