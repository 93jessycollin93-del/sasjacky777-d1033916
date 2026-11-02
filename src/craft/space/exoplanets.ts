/**
 * The planets astronomers have actually found round the stars the map shows
 * by name: orbital periods, masses (for most, the minimum mass the star's
 * wobble allows, m sin i), radii where a planet crosses its star and so could
 * be measured, and the year each was announced. Values are the published ones,
 * rounded to what shows — the NASA Exoplanet Archive's and the discovery
 * papers' — facts, not any catalogue's own compilation. Candidates that are
 * disputed are marked so.
 *
 * Only what was measured is here. What a planet's ground is like, the game
 * works out from these numbers the same way it does for every other world
 * (systems.ts) — so a landing on TRAPPIST-1 e is this game's imagining of a
 * real place, and the ship's panel says so.
 */

export interface KnownPlanet {
  letter: string;
  /** The IAU's name for it, where it has one. */
  name?: string;
  /** Days. */
  period: number;
  /** AU, where the papers give it; otherwise worked out from the period and the star's mass. */
  a?: number;
  /** Earth masses (the minimum mass, for a planet found by its star's wobble). */
  mass?: number;
  /** Earth radii, for a planet seen crossing its star. */
  radius?: number;
  e?: number;
  /** Surface pressure (bar) where observations constrain it: 0 for a planet found to have no thick air. */
  air?: number;
  year: number;
  candidate?: boolean;
  note?: string;
}

export interface KnownSystem {
  /** The star's mass in Suns, so its planets' orbits and periods agree. */
  mass: number;
  planets: KnownPlanet[];
}

const MJ = 317.83;
const RJ = 11.21;

/** By the star's name as the map shows it (nearStars.ts). */
export const KNOWN_SYSTEMS: Record<string, KnownSystem> = {
  "Proxima Centauri": {
    mass: 0.122,
    planets: [
      { letter: "d", period: 5.122, a: 0.02885, mass: 0.26, year: 2022, note: "Found by ESPRESSO in 2022: a quarter of the Earth's mass, among the lightest planets ever found by a star's wobble." },
      { letter: "b", period: 11.187, a: 0.04857, mass: 1.07, year: 2016, note: "The nearest planet beyond the Solar System, in its star's habitable zone — but under the flares of a red dwarf, with one face turned to it for ever." },
    ],
  },
  "Barnard's Star": {
    mass: 0.162,
    planets: [
      { letter: "d", period: 2.340, mass: 0.26, year: 2025 },
      { letter: "b", period: 3.154, mass: 0.30, year: 2024, note: "Found in 2024 after decades of false alarms about this star; three more followed within months." },
      { letter: "c", period: 4.124, mass: 0.34, year: 2025 },
      { letter: "e", period: 6.739, mass: 0.19, year: 2025 },
    ],
  },
  "Lalande 21185": {
    mass: 0.39,
    planets: [
      { letter: "b", period: 12.95, mass: 2.7, year: 2019 },
      { letter: "c", period: 2946, mass: 13.6, year: 2021 },
    ],
  },
  "Epsilon Eridani": {
    mass: 0.82,
    planets: [{ letter: "b", name: "AEgir", period: 2692, a: 3.48, mass: 0.66 * MJ, e: 0.07, year: 2000, note: "A giant a little smaller than Jupiter, in a star's young dust disk." }],
  },
  "Lacaille 9352": {
    mass: 0.49,
    planets: [
      { letter: "b", period: 9.262, mass: 4.2, year: 2020 },
      { letter: "c", period: 21.79, mass: 7.6, year: 2020 },
    ],
  },
  "Ross 128": {
    mass: 0.17,
    planets: [{ letter: "b", period: 9.866, a: 0.0496, mass: 1.4, year: 2017, note: "A temperate world round a quiet red dwarf — one that rarely flares." }],
  },
  "Groombridge 34": {
    mass: 0.38,
    planets: [
      { letter: "b", period: 11.44, mass: 3.0, year: 2014 },
      { letter: "c", period: 7600, mass: 36, year: 2018 },
    ],
  },
  "Epsilon Indi": {
    mass: 0.76,
    planets: [{ letter: "b", period: 62000, a: 28, mass: 6.3 * MJ, year: 2024, note: "Photographed by the James Webb Space Telescope in 2024: a cold giant six times Jupiter's mass." }],
  },
  "Tau Ceti": {
    mass: 0.78,
    planets: [
      { letter: "g", period: 20.0, mass: 1.75, year: 2017, candidate: true },
      { letter: "h", period: 49.41, mass: 1.83, year: 2017, candidate: true },
      { letter: "e", period: 162.9, mass: 3.93, year: 2017, candidate: true },
      { letter: "f", period: 636.1, mass: 3.93, year: 2017, candidate: true },
    ],
  },
  "GJ 1061": {
    mass: 0.12,
    planets: [
      { letter: "b", period: 3.204, mass: 1.37, year: 2019 },
      { letter: "c", period: 6.689, mass: 1.74, year: 2019 },
      { letter: "d", period: 13.03, mass: 1.64, year: 2019 },
    ],
  },
  "YZ Ceti": {
    mass: 0.13,
    planets: [
      { letter: "b", period: 2.021, mass: 0.70, year: 2017 },
      { letter: "c", period: 3.060, mass: 1.14, year: 2017 },
      { letter: "d", period: 4.656, mass: 1.09, year: 2017 },
    ],
  },
  "Luyten's Star": {
    mass: 0.29,
    planets: [
      { letter: "c", period: 4.723, mass: 1.18, year: 2017 },
      { letter: "b", period: 18.65, mass: 2.89, year: 2017, note: "A super-Earth in the habitable zone, 12 light-years away; a message was beamed toward it in 2017." },
    ],
  },
  "Teegarden's Star": {
    mass: 0.097,
    planets: [
      { letter: "b", period: 4.910, mass: 1.05, year: 2019, note: "Among the most Earth-like planets known by mass and sunlight." },
      { letter: "c", period: 11.42, mass: 1.11, year: 2019 },
      { letter: "d", period: 26.13, mass: 0.82, year: 2024 },
    ],
  },
  "Gliese 581": {
    mass: 0.31,
    planets: [
      { letter: "e", period: 3.149, mass: 1.7, year: 2009 },
      { letter: "b", period: 5.369, mass: 15.8, year: 2005 },
      { letter: "c", period: 12.92, mass: 5.5, year: 2007 },
    ],
  },
  "Pollux": {
    mass: 1.9,
    planets: [{ letter: "b", name: "Thestias", period: 589.6, a: 1.64, mass: 2.3 * MJ, e: 0.02, year: 2006 }],
  },
  "TRAPPIST-1": {
    mass: 0.0898,
    planets: [
      { letter: "b", period: 1.51088, a: 0.01154, radius: 1.116, mass: 1.374, air: 0, year: 2016, note: "JWST measured its day side at about 230 °C: bare rock, with no thick air to carry the heat round." },
      { letter: "c", period: 2.42180, a: 0.01580, radius: 1.097, mass: 1.308, air: 0, year: 2016, note: "JWST found no thick carbon-dioxide air: not a second Venus." },
      { letter: "d", period: 4.04978, a: 0.02227, radius: 0.788, mass: 0.388, year: 2016 },
      { letter: "e", period: 6.09963, a: 0.02925, radius: 0.920, mass: 0.692, air: 1, year: 2017, note: "The one most likely to hold water on its surface, if any of them do." },
      { letter: "f", period: 9.20668, a: 0.03849, radius: 1.045, mass: 1.039, year: 2017 },
      { letter: "g", period: 12.35294, a: 0.04683, radius: 1.129, mass: 1.321, year: 2017 },
      { letter: "h", period: 18.76712, a: 0.06189, radius: 0.755, mass: 0.326, year: 2017 },
    ],
  },
  "55 Cancri": {
    mass: 0.95,
    planets: [
      { letter: "e", name: "Janssen", period: 0.7365, radius: 1.88, mass: 7.99, year: 2004, note: "Round its star in under eighteen hours, so close that its day side is molten rock." },
      { letter: "b", name: "Galileo", period: 14.652, mass: 0.83 * MJ, year: 1996 },
      { letter: "c", name: "Brahe", period: 44.40, mass: 54, year: 2004 },
      { letter: "f", name: "Harriot", period: 259.9, mass: 45, year: 2007 },
      { letter: "d", name: "Lipperhey", period: 4825, a: 5.46, mass: 3.9 * MJ, e: 0.13, year: 2002 },
    ],
  },
  "51 Pegasi": {
    mass: 1.11,
    planets: [{ letter: "b", name: "Dimidium", period: 4.2308, a: 0.0527, mass: 0.46 * MJ, year: 1995, note: "The first planet found round a Sun-like star (Mayor and Queloz, Nobel Prize 2019): a giant so close its year is four days." }],
  },
  "HD 209458": {
    mass: 1.12,
    planets: [{ letter: "b", name: "Osiris", period: 3.5247, a: 0.0475, mass: 0.69 * MJ, radius: 1.38 * RJ, year: 1999, note: "The first planet seen crossing its star, and the first whose air was measured — it is boiling off into a comet-like tail." }],
  },
  "Kepler-186": {
    mass: 0.54,
    planets: [
      { letter: "b", period: 3.887, radius: 1.07, year: 2014 },
      { letter: "c", period: 7.267, radius: 1.25, year: 2014 },
      { letter: "d", period: 13.34, radius: 1.40, year: 2014 },
      { letter: "e", period: 22.41, radius: 1.27, year: 2014 },
      { letter: "f", period: 129.9, radius: 1.17, year: 2014, note: "The first Earth-sized planet found in a habitable zone." },
    ],
  },
  "Kepler-452": {
    mass: 1.04,
    planets: [{ letter: "b", period: 384.8, a: 1.046, radius: 1.63, year: 2015, note: "'Earth's older cousin': a year of 385 days round a Sun-like star a billion and a half years older than ours." }],
  },
  "Wolf 1061": {
    mass: 0.29,
    planets: [
      { letter: "b", period: 4.577, mass: 1.9, year: 2015 },
      { letter: "c", period: 17.87, mass: 3.4, year: 2015 },
      { letter: "d", period: 217.2, mass: 7.7, year: 2015 },
    ],
  },
  "Gliese 876": {
    mass: 0.37,
    planets: [
      { letter: "d", period: 1.938, mass: 6.8, year: 2005 },
      { letter: "c", period: 30.1, mass: 0.71 * MJ, year: 2001 },
      { letter: "b", period: 61.1, mass: 2.28 * MJ, year: 1998, note: "The first planet found round a red dwarf." },
      { letter: "e", period: 124.3, mass: 14.6, year: 2010 },
    ],
  },
  "Gliese 667 C": {
    mass: 0.33,
    planets: [
      { letter: "b", period: 7.2, mass: 5.6, year: 2009 },
      { letter: "c", period: 28.14, mass: 3.8, year: 2011, note: "In the habitable zone of the smallest star of a triple system." },
    ],
  },
  "HD 219134": {
    mass: 0.79,
    planets: [
      { letter: "b", period: 3.093, radius: 1.60, mass: 4.7, year: 2015 },
      { letter: "c", period: 6.765, radius: 1.51, mass: 4.4, year: 2015 },
      { letter: "f", period: 22.72, mass: 7.3, year: 2015 },
      { letter: "d", period: 46.86, mass: 16.2, year: 2015 },
      { letter: "g", period: 94.2, mass: 11, year: 2015 },
      { letter: "h", period: 2198, mass: 108, year: 2015 },
    ],
  },
  "61 Virginis": {
    mass: 0.95,
    planets: [
      { letter: "b", period: 4.215, mass: 5.1, year: 2009 },
      { letter: "c", period: 38.02, mass: 18.2, year: 2009 },
      { letter: "d", period: 123.0, mass: 22.9, year: 2009 },
    ],
  },
  "Gliese 436": {
    mass: 0.45,
    planets: [{ letter: "b", period: 2.644, radius: 4.2, mass: 22.1, year: 2004, note: "A warm Neptune trailing a vast tail of hydrogen, like a comet the size of a planet." }],
  },
  "AU Microscopii": {
    mass: 0.5,
    planets: [
      { letter: "b", period: 8.463, radius: 4.1, mass: 10, year: 2020 },
      { letter: "c", period: 18.86, radius: 3.2, mass: 14, year: 2021 },
    ],
  },
  "Gliese 12": {
    mass: 0.24,
    planets: [{ letter: "b", period: 12.76, radius: 0.96, year: 2024, note: "An Earth-sized world 40 light-years off, warmer than the Earth and cooler than Venus." }],
  },
  "HD 40307": {
    mass: 0.77,
    planets: [
      { letter: "b", period: 4.31, mass: 4.0, year: 2008 },
      { letter: "c", period: 9.62, mass: 6.6, year: 2008 },
      { letter: "d", period: 20.46, mass: 9.5, year: 2008 },
      { letter: "f", period: 51.76, mass: 5.2, year: 2012 },
      { letter: "g", period: 197.8, mass: 7.1, year: 2012 },
    ],
  },
  "Upsilon Andromedae": {
    mass: 1.27,
    planets: [
      { letter: "b", name: "Saffar", period: 4.617, mass: 0.69 * MJ, year: 1996 },
      { letter: "c", name: "Samh", period: 241.3, mass: 1.98 * MJ, e: 0.26, year: 1999 },
      { letter: "d", name: "Majriti", period: 1276, mass: 4.1 * MJ, e: 0.30, year: 1999, note: "Part of the first multi-planet system found round a Sun-like star." },
    ],
  },
  "47 Ursae Majoris": {
    mass: 1.03,
    planets: [
      { letter: "b", name: "Taphao Thong", period: 1078, mass: 2.53 * MJ, year: 1996 },
      { letter: "c", name: "Taphao Kaew", period: 2391, mass: 0.54 * MJ, year: 2002 },
      { letter: "d", period: 14002, mass: 1.64 * MJ, year: 2010 },
    ],
  },
  "GJ 1214": {
    mass: 0.18,
    planets: [{ letter: "b", period: 1.5804, radius: 2.74, mass: 8.2, year: 2009, note: "A hazy sub-Neptune whose clouds are so thick JWST could not see beneath them." }],
  },
  "LHS 1140": {
    mass: 0.18,
    planets: [
      { letter: "c", period: 3.778, radius: 1.27, mass: 1.9, year: 2018 },
      { letter: "b", period: 24.74, radius: 1.73, mass: 5.6, air: 1, year: 2017, note: "In the habitable zone, and light for its size: perhaps a world of deep water under ice." },
    ],
  },
  "Beta Pictoris": {
    mass: 1.75,
    planets: [
      { letter: "c", period: 1200, a: 2.7, mass: 8.9 * MJ, year: 2019 },
      { letter: "b", period: 8600, a: 9.9, mass: 11.9 * MJ, year: 2008, note: "Photographed directly, moving round a young star inside its disk of dust." },
    ],
  },
  "HD 189733": {
    mass: 0.8,
    planets: [{ letter: "b", period: 2.2186, radius: 1.14 * RJ, mass: 1.13 * MJ, year: 2005, note: "A deep blue giant where winds of 8,000 km/h may drive rain of molten glass sideways." }],
  },
  "WD 1856+534": {
    mass: 0.52,
    planets: [{ letter: "b", period: 1.4079, radius: 0.93 * RJ, mass: 5 * MJ, year: 2020, note: "A giant planet hugging a white dwarf: it survived its star's death." }],
  },
  "TOI-700": {
    mass: 0.42,
    planets: [
      { letter: "b", period: 9.977, radius: 0.91, year: 2020 },
      { letter: "c", period: 16.05, radius: 2.6, year: 2020 },
      { letter: "e", period: 27.81, radius: 0.95, year: 2023 },
      { letter: "d", period: 37.42, radius: 1.07, year: 2020, note: "TESS's first Earth-sized planet in a habitable zone." },
    ],
  },
  "K2-18": {
    mass: 0.36,
    planets: [{ letter: "b", period: 32.94, radius: 2.61, mass: 8.6, year: 2015, note: "Water vapour and methane in its air; perhaps an ocean under hydrogen." }],
  },
  "HD 10180": {
    mass: 1.06,
    planets: [
      { letter: "c", period: 5.760, mass: 13, year: 2010 },
      { letter: "d", period: 16.36, mass: 12, year: 2010 },
      { letter: "e", period: 49.75, mass: 25, year: 2010 },
      { letter: "f", period: 122.7, mass: 23, year: 2010 },
      { letter: "g", period: 602, mass: 21, year: 2010 },
      { letter: "h", period: 2222, mass: 65, year: 2010 },
    ],
  },
  "HR 8799": {
    mass: 1.5,
    planets: [
      { letter: "e", period: 19700, a: 16.4, mass: 7.4 * MJ, year: 2010 },
      { letter: "d", period: 41800, a: 27, mass: 9 * MJ, year: 2008 },
      { letter: "c", period: 84000, a: 43, mass: 8.3 * MJ, year: 2008 },
      { letter: "b", period: 167000, a: 68, mass: 7 * MJ, year: 2008, note: "Four giants photographed round one star: the first family portrait of another planetary system." },
    ],
  },
  "CoRoT-7": {
    mass: 0.93,
    planets: [
      { letter: "b", period: 0.8536, radius: 1.58, mass: 4.7, year: 2009, note: "The first rocky planet found by the light it blocks; its day side is a sea of lava." },
      { letter: "c", period: 3.698, mass: 13.6, year: 2009 },
    ],
  },
  "Kepler-10": {
    mass: 0.91,
    planets: [
      { letter: "b", period: 0.8375, radius: 1.47, mass: 3.3, year: 2011, note: "Kepler's first confirmed rocky planet: a world of iron and lava." },
      { letter: "c", period: 45.29, radius: 2.35, mass: 7.4, year: 2011 },
    ],
  },
  "Kepler-22": {
    mass: 0.97,
    planets: [{ letter: "b", period: 289.9, radius: 2.1, year: 2011, note: "The first planet Kepler found in a Sun-like star's habitable zone." }],
  },
  "KELT-9": {
    mass: 2.5,
    planets: [{ letter: "b", period: 1.4811, radius: 1.89 * RJ, mass: 2.88 * MJ, year: 2017, note: "The hottest planet known: 4,000 °C on its day side, hotter than many stars." }],
  },
  "Kepler-62": {
    mass: 0.69,
    planets: [
      { letter: "b", period: 5.715, radius: 1.31, year: 2013 },
      { letter: "c", period: 12.44, radius: 0.54, year: 2013 },
      { letter: "d", period: 18.16, radius: 1.95, year: 2013 },
      { letter: "e", period: 122.4, radius: 1.61, year: 2013 },
      { letter: "f", period: 267.3, radius: 1.41, year: 2013 },
    ],
  },
  "WASP-12": {
    mass: 1.43,
    planets: [{ letter: "b", period: 1.0914, radius: 1.94 * RJ, mass: 1.47 * MJ, year: 2008, note: "Stretched into an egg by its star and spiralling in: it will be swallowed in about three million years." }],
  },
  "Kepler-90": {
    mass: 1.13,
    planets: [
      { letter: "b", period: 7.008, radius: 1.31, year: 2013 },
      { letter: "c", period: 8.719, radius: 1.18, year: 2013 },
      { letter: "i", period: 14.45, radius: 1.32, year: 2017, note: "Found by a neural network sifting Kepler's data, making this the first system to match our own eight planets." },
      { letter: "d", period: 59.74, radius: 2.88, year: 2013 },
      { letter: "e", period: 91.94, radius: 2.67, year: 2013 },
      { letter: "f", period: 124.9, radius: 2.89, year: 2013 },
      { letter: "g", period: 210.6, radius: 8.13, year: 2013 },
      { letter: "h", period: 331.6, radius: 11.32, year: 2013 },
    ],
  },
};
