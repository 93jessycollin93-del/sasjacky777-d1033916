/**
 * The stars and places of the real Milky Way the map shows by name: every
 * star system within about thirteen light-years (so the Sun's neighbourhood is
 * the real one, not a made-up one), the bright stars everyone knows, the ones
 * famous for their planets or their size, and the clusters, nebulae and
 * remnants that make the landmarks of the local arm.
 *
 * Positions are J2000 right ascension and declination (degrees) with a
 * distance in light-years; luminosities (in Suns) are given where the
 * spectral type alone would put a giant too dim. Values are the commonly
 * published ones (RECONS for the nearest systems, Hipparcos/Gaia-era
 * distances for the rest), rounded — facts, not a catalogue's copyrighted
 * compilation. Distances for the most distant supergiants are uncertain by a
 * good fraction, as they are in the literature.
 */

export interface KnownStar {
  name: string;
  ra: number;
  dec: number;
  /** Light-years from the Sun. */
  ly: number;
  /** Spectral type, as astronomers write it. */
  sp: string;
  /** Luminosity in Suns, where the type alone would not say it well. */
  lum?: number;
  /** Planets known, if any. */
  planets?: number;
  note?: string;
}

export const KNOWN_STARS: KnownStar[] = [
  // ---- the neighbourhood: everything within ~13 light-years ----
  { name: "Proxima Centauri", ra: 217.43, dec: -62.68, ly: 4.246, sp: "M5.5Ve", lum: 0.0017, planets: 2, note: "The nearest star to the Sun, a flare star with a planet in its habitable zone." },
  { name: "Alpha Centauri A", ra: 219.90, dec: -60.83, ly: 4.37, sp: "G2V", lum: 1.52, note: "A Sun-like star; with B, the brightest point of the southern Centaur." },
  { name: "Alpha Centauri B", ra: 219.896, dec: -60.838, ly: 4.37, sp: "K1V", lum: 0.5, note: "Circles A every 80 years." },
  { name: "Barnard's Star", ra: 269.45, dec: 4.69, ly: 5.96, sp: "M4V", lum: 0.0035, planets: 4, note: "The fastest-moving star in our sky, crossing a Moon's width every 180 years." },
  { name: "Wolf 359", ra: 164.12, dec: 7.01, ly: 7.86, sp: "M6V", lum: 0.0014 },
  { name: "Lalande 21185", ra: 165.83, dec: 35.97, ly: 8.31, sp: "M2V", lum: 0.021, planets: 2 },
  { name: "Sirius A", ra: 101.29, dec: -16.72, ly: 8.6, sp: "A1V", lum: 25.4, note: "The brightest star in the night sky." },
  { name: "Sirius B", ra: 101.292, dec: -16.725, ly: 8.6, sp: "DA2", lum: 0.056, note: "A white dwarf the size of the Earth with the mass of the Sun." },
  { name: "Luyten 726-8 (UV Ceti)", ra: 24.76, dec: -17.95, ly: 8.79, sp: "M5.5Ve", lum: 0.0001, note: "The flare star UV Ceti and its twin." },
  { name: "Ross 154", ra: 282.46, dec: -23.84, ly: 9.69, sp: "M3.5Ve", lum: 0.0038 },
  { name: "Ross 248", ra: 355.48, dec: 44.18, ly: 10.3, sp: "M6Ve", lum: 0.0018 },
  { name: "Epsilon Eridani", ra: 53.23, dec: -9.46, ly: 10.5, sp: "K2V", lum: 0.34, planets: 1, note: "A young Sun-like star with a dust disk and a giant planet." },
  { name: "Lacaille 9352", ra: 346.47, dec: -35.85, ly: 10.7, sp: "M0.5V", lum: 0.033, planets: 2 },
  { name: "Ross 128", ra: 176.94, dec: 0.80, ly: 11.0, sp: "M4V", lum: 0.0036, planets: 1 },
  { name: "EZ Aquarii", ra: 339.64, dec: -15.30, ly: 11.1, sp: "M5V", lum: 0.0005 },
  { name: "Procyon A", ra: 114.83, dec: 5.22, ly: 11.46, sp: "F5IV-V", lum: 6.9, note: "The Little Dog's bright star, with a white dwarf companion." },
  { name: "61 Cygni A", ra: 316.73, dec: 38.75, ly: 11.4, sp: "K5V", lum: 0.15, note: "The first star to have its distance measured, by Bessel in 1838." },
  { name: "Struve 2398", ra: 280.69, dec: 59.63, ly: 11.5, sp: "M3V", lum: 0.03, planets: 2 },
  { name: "Groombridge 34", ra: 4.60, dec: 44.02, ly: 11.6, sp: "M1.5V", lum: 0.02, planets: 2 },
  { name: "DX Cancri", ra: 127.45, dec: 26.78, ly: 11.8, sp: "M6.5V", lum: 0.0003 },
  { name: "Epsilon Indi", ra: 330.84, dec: -56.79, ly: 11.9, sp: "K5V", lum: 0.22, planets: 1, note: "With a pair of brown dwarfs in a wide orbit." },
  { name: "Tau Ceti", ra: 26.02, dec: -15.94, ly: 11.9, sp: "G8.5V", lum: 0.52, planets: 4, note: "The nearest lone Sun-like star." },
  { name: "GJ 1061", ra: 54.0, dec: -44.51, ly: 12.0, sp: "M5.5V", lum: 0.0017, planets: 3 },
  { name: "YZ Ceti", ra: 18.13, dec: -17.0, ly: 12.1, sp: "M4.5V", lum: 0.0022, planets: 3 },
  { name: "Luyten's Star", ra: 111.85, dec: 5.23, ly: 12.2, sp: "M3.5V", lum: 0.009, planets: 2 },
  { name: "Teegarden's Star", ra: 43.25, dec: 16.88, ly: 12.5, sp: "M7V", lum: 0.0007, planets: 3 },
  { name: "Kapteyn's Star", ra: 77.92, dec: -45.02, ly: 12.8, sp: "sdM1", lum: 0.012, note: "A halo star passing through the disk, older than almost anything around it." },
  { name: "Lacaille 8760", ra: 319.31, dec: -38.87, ly: 12.9, sp: "M0V", lum: 0.07 },
  { name: "Kruger 60", ra: 337.0, dec: 57.70, ly: 13.1, sp: "M3V", lum: 0.01 },

  // ---- the bright and the famous ----
  { name: "Wolf 1061", ra: 247.58, dec: -12.66, ly: 14.0, sp: "M3V", lum: 0.01, planets: 3 },
  { name: "Gliese 876", ra: 343.32, dec: -14.26, ly: 15.2, sp: "M4V", lum: 0.013, planets: 4 },
  { name: "Altair", ra: 297.70, dec: 8.87, ly: 16.7, sp: "A7V", lum: 10.6, note: "Spins so fast it bulges a fifth wider at its equator." },
  { name: "HD 219134", ra: 348.32, dec: 57.17, ly: 21.3, sp: "K3V", lum: 0.26, planets: 6 },
  { name: "Gliese 667 C", ra: 259.74, dec: -35.0, ly: 23.6, sp: "M1.5V", lum: 0.014, planets: 2, note: "The smallest of three stars bound together." },
  { name: "61 Virginis", ra: 199.60, dec: -18.31, ly: 27.9, sp: "G7V", lum: 0.82, planets: 3 },
  { name: "AU Microscopii", ra: 311.29, dec: -31.34, ly: 31.7, sp: "M1Ve", lum: 0.1, planets: 2, note: "A young flaring star still wrapped in the dusty disk its planets formed from." },
  { name: "Gliese 436", ra: 175.55, dec: 26.71, ly: 31.8, sp: "M2.5V", lum: 0.025, planets: 1 },
  { name: "Gliese 12", ra: 3.95, dec: 13.56, ly: 40.0, sp: "M4V", lum: 0.0026, planets: 1 },
  { name: "HD 40307", ra: 88.52, dec: -60.03, ly: 42.0, sp: "K2.5V", lum: 0.23, planets: 5 },
  { name: "Upsilon Andromedae", ra: 24.20, dec: 41.41, ly: 44.0, sp: "F8V", lum: 3.4, planets: 3 },
  { name: "47 Ursae Majoris", ra: 164.87, dec: 40.43, ly: 45.9, sp: "G1V", lum: 1.54, planets: 3 },
  { name: "GJ 1214", ra: 258.83, dec: 4.96, ly: 48.0, sp: "M4.5V", lum: 0.0035, planets: 1 },
  { name: "LHS 1140", ra: 11.25, dec: -15.27, ly: 48.8, sp: "M4.5V", lum: 0.0044, planets: 2 },
  { name: "Beta Pictoris", ra: 86.82, dec: -51.07, ly: 63.4, sp: "A6V", lum: 8.7, planets: 2, note: "A young star with a great edge-on disk of dust, and giant planets inside it." },
  { name: "HD 189733", ra: 300.18, dec: 22.71, ly: 64.5, sp: "K1.5V", lum: 0.33, planets: 1 },
  { name: "WD 1856+534", ra: 284.41, dec: 53.51, ly: 81, sp: "DC10.7", lum: 0.0001, planets: 1, note: "A cold white dwarf with a giant planet in a day-and-a-half orbit." },
  { name: "TOI-700", ra: 97.10, dec: -65.58, ly: 101.4, sp: "M2V", lum: 0.023, planets: 4 },
  { name: "K2-18", ra: 172.56, dec: 7.59, ly: 124, sp: "M2.5V", lum: 0.023, planets: 1 },
  { name: "HD 10180", ra: 24.47, dec: -60.51, ly: 127, sp: "G1V", lum: 1.49, planets: 6, note: "One of the richest planetary systems known: six planets, perhaps more." },
  { name: "HR 8799", ra: 346.87, dec: 21.13, ly: 133, sp: "A5V", lum: 4.9, planets: 4 },
  { name: "Gliese 581", ra: 229.86, dec: -7.72, ly: 20.5, sp: "M3V", lum: 0.012, planets: 3 },
  { name: "Vega", ra: 279.23, dec: 38.78, ly: 25.0, sp: "A0V", lum: 40, note: "The zero point of the magnitude scale, and the pole star of 12,000 years from now." },
  { name: "Fomalhaut", ra: 344.41, dec: -29.62, ly: 25.1, sp: "A3V", lum: 16.6, note: "Ringed by a disk of debris." },
  { name: "Pollux", ra: 116.33, dec: 28.03, ly: 33.8, sp: "K0III", lum: 43, planets: 1 },
  { name: "Arcturus", ra: 213.92, dec: 19.18, ly: 36.7, sp: "K1.5III", lum: 170, note: "An old red giant, the brightest star of the northern sky." },
  { name: "TRAPPIST-1", ra: 346.62, dec: -5.04, ly: 40.7, sp: "M8V", lum: 0.00055, planets: 7, note: "Seven Earth-sized planets, three in the habitable zone." },
  { name: "55 Cancri", ra: 133.15, dec: 28.33, ly: 41, sp: "G8V", lum: 0.59, planets: 5 },
  { name: "Capella", ra: 79.17, dec: 46.00, ly: 42.9, sp: "G3III", lum: 79, note: "Two yellow giants in a tight orbit." },
  { name: "51 Pegasi", ra: 344.37, dec: 20.77, ly: 50.6, sp: "G2IV", lum: 1.36, planets: 1, note: "The first Sun-like star found with a planet (1995): a hot Jupiter." },
  { name: "Castor", ra: 113.65, dec: 31.89, ly: 51, sp: "A1V", lum: 30, note: "Six stars in three pairs." },
  { name: "Aldebaran", ra: 68.98, dec: 16.51, ly: 65.3, sp: "K5III", lum: 439, note: "The Bull's red eye." },
  { name: "Regulus", ra: 152.09, dec: 11.97, ly: 79.3, sp: "B8IVn", lum: 316 },
  { name: "Achernar", ra: 24.43, dec: -57.24, ly: 139, sp: "B6Vep", lum: 3150, note: "The flattest star known, spinning near breaking point." },
  { name: "HD 209458", ra: 330.80, dec: 18.88, ly: 157, sp: "G0V", lum: 1.77, planets: 1, note: "Its planet was the first seen to cross its star, and the first with a measured air." },
  { name: "Spica", ra: 201.30, dec: -11.16, ly: 250, sp: "B1V", lum: 20500 },
  { name: "Mira", ra: 34.84, dec: -2.98, ly: 300, sp: "M7IIIe", lum: 8400, note: "The wonderful: it brightens and fades a hundredfold every 332 days." },
  { name: "Canopus", ra: 95.99, dec: -52.70, ly: 310, sp: "A9II", lum: 10700, note: "The second-brightest star of the night sky." },
  { name: "Polaris", ra: 37.95, dec: 89.26, ly: 433, sp: "F7Ib", lum: 1260, note: "The pole star, a pulsing Cepheid." },
  { name: "Betelgeuse", ra: 88.79, dec: 7.41, ly: 548, sp: "M1-2Ia", lum: 100000, note: "A red supergiant that would reach past Mars; it will explode as a supernova within the next hundred thousand years." },
  { name: "Antares", ra: 247.35, dec: -26.43, ly: 550, sp: "M1.5Iab", lum: 75900, note: "The rival of Mars: a red supergiant at the Scorpion's heart." },
  { name: "Kepler-186", ra: 298.65, dec: 43.95, ly: 579, sp: "M1V", lum: 0.055, planets: 5, note: "Its fifth planet was the first Earth-sized one found in a habitable zone." },
  { name: "CoRoT-7", ra: 100.95, dec: -1.06, ly: 520, sp: "K0V", lum: 0.5, planets: 2 },
  { name: "Kepler-10", ra: 285.68, dec: 50.24, ly: 608, sp: "G2V", lum: 1.0, planets: 2 },
  { name: "Kepler-22", ra: 289.22, dec: 47.88, ly: 640, sp: "G5V", lum: 0.79, planets: 1 },
  { name: "KELT-9", ra: 307.86, dec: 39.94, ly: 670, sp: "A0V", lum: 53, planets: 1 },
  { name: "Rigel", ra: 78.63, dec: -8.20, ly: 860, sp: "B8Ia", lum: 120000, note: "Orion's blue-white foot." },
  { name: "Kepler-62", ra: 283.21, dec: 45.35, ly: 990, sp: "K2V", lum: 0.21, planets: 5 },
  { name: "WASP-12", ra: 97.64, dec: 29.67, ly: 1410, sp: "G0V", lum: 3.7, planets: 1 },
  { name: "Tabby's Star", ra: 301.56, dec: 44.46, ly: 1470, sp: "F3V", lum: 4.7, note: "Dims by up to a fifth, at random, behind something nobody has pinned down — most likely dust." },
  { name: "Kepler-452", ra: 296.0, dec: 44.28, ly: 1800, sp: "G2V", lum: 1.2, planets: 1, note: "Home of 'Earth's cousin', a planet a little larger than ours in a year of 385 days." },
  { name: "Deneb", ra: 310.36, dec: 45.28, ly: 2600, sp: "A2Ia", lum: 196000, note: "One of the most luminous stars the eye can see." },
  { name: "Kepler-90", ra: 284.43, dec: 49.31, ly: 2840, sp: "G0V", lum: 1.2, planets: 8, note: "Eight planets, as many as the Sun's." },
  { name: "VY Canis Majoris", ra: 110.74, dec: -25.77, ly: 3900, sp: "M3-4Ia+", lum: 270000, note: "A red hypergiant among the largest stars known, shedding its outer layers." },
  { name: "Eta Carinae", ra: 161.26, dec: -59.68, ly: 7500, sp: "LBV", lum: 5000000, note: "A pair of monsters; its 1840s outburst made it the second-brightest star in the sky." },
];

export interface Landmark {
  name: string;
  kind: "cluster" | "globular" | "nebula" | "remnant" | "black hole";
  ra: number;
  dec: number;
  ly: number;
  note: string;
}

export const LANDMARKS: Landmark[] = [
  { name: "Hyades", kind: "cluster", ra: 66.75, dec: 15.87, ly: 153, note: "The nearest open cluster: the V of the Bull's face." },
  { name: "Pleiades", kind: "cluster", ra: 56.87, dec: 24.11, ly: 444, note: "The Seven Sisters: a thousand young blue stars in a passing dust cloud." },
  { name: "Vela Pulsar", kind: "remnant", ra: 128.84, dec: -45.18, ly: 936, note: "The spinning core left by a supernova 11,000 years ago, turning eleven times a second." },
  { name: "Orion Nebula", kind: "nebula", ra: 83.82, dec: -5.39, ly: 1344, note: "The nearest great nursery of stars, lit by the young Trapezium." },
  { name: "Crab Nebula", kind: "remnant", ra: 83.63, dec: 22.01, ly: 6500, note: "What is left of the supernova of 1054, which was bright enough to see by day for three weeks." },
  { name: "Cygnus X-1", kind: "black hole", ra: 299.59, dec: 35.20, ly: 7200, note: "The first black hole found: 21 Suns' worth, feeding on a blue supergiant." },
  { name: "47 Tucanae", kind: "globular", ra: 6.02, dec: -72.08, ly: 14700, note: "A million old stars packed into a ball 120 light-years wide." },
  { name: "Omega Centauri", kind: "globular", ra: 201.70, dec: -47.48, ly: 17090, note: "The Milky Way's largest globular cluster — perhaps the stripped core of a swallowed galaxy." },
  { name: "M13 (Hercules Cluster)", kind: "globular", ra: 250.42, dec: 36.46, ly: 22200, note: "The great globular of the northern sky; the Arecibo message was sent toward it in 1974." },
];
