/**
 * The car radio: five stations of music made up as it plays, after the
 * crime-sandbox games' stations — their eras and their DJs, not their songs.
 * Each station is a style (tempo, key, chords, instruments, drums), and the
 * audio (audio.ts) writes a new tune in it every sixteen bars. Between tunes
 * the DJ says something, shown as a caption: the song that was, the song that
 * is, and a hot take nobody asked for.
 *
 * All the artists and songs are made up.
 */

export interface Station {
  id: string;
  name: string;
  genre: string;
  bpm: number;
  /** The key's root, in Hz, and the scale's steps in semitones. */
  root: number;
  scale: number[];
  /** Chords as scale degrees, one a bar. */
  chords: number[];
  lead: OscillatorType;
  bass: OscillatorType;
  pad: OscillatorType;
  /** Sixteen steps a bar: kick, snare and hat, as "x" for a hit. */
  kick: string;
  snare: string;
  hat: string;
  /** Arpeggios on sixteenths (synth, chip) or a melody on eighths with rests. */
  arp: boolean;
  /** Muffled, with the crackle of an old record. */
  lofi?: boolean;
  /** Talk only: no music, the DJ never stops. */
  talk?: boolean;
  dj: string;
  songs: string[];
  lines: string[];
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

export const STATIONS: readonly Station[] = [
  {
    id: "synth", name: "Synth City 88.8", genre: "synthwave", bpm: 108, root: 110, scale: MINOR, chords: [0, 5, 2, 6], lead: "sawtooth", bass: "sawtooth", pad: "sawtooth",
    kick: "x...x...x...x...", snare: "....x.......x...", hat: "..x...x...x...x.", arp: true, dj: "DJ Laser Grid",
    songs: ["Neon Tears — Pixel Horizon", "Overdrive to Nowhere — The Chromeheads", "Sunset Protocol — VHS Lover", "Palm Trees in the Rain — Magenta Drive", "Night Shift at the Arcade — Kid Cathode"],
    lines: ["It's always 1986 somewhere, and that somewhere is this frequency.", "If your car doesn't have a neon underglow, is it even a car?", "Remember: the speed limit is a suggestion. That was a joke. The NBPD listens to this station.", "Synth City: all synths, all night, no refunds."],
  },
  {
    id: "vapor", name: "Vapor FM 94.2", genre: "vaporwave", bpm: 72, root: 146.8, scale: MAJOR, chords: [3, 4, 2, 5], lead: "triangle", bass: "sine", pad: "triangle",
    kick: "x.......x.......", snare: "........x.......", hat: "................", arp: false, lofi: true, dj: "ＡＥＳＴＨＥＴＩＣ ＧＲＥＧ",
    songs: ["Mall Fountain at 3AM — Plaza Dreams", "Dial-Up Heartbreak — 私の心", "Windows 95 Startup (Extended) — Beige Tower", "Food Court Nostalgia — Escalator Kid"],
    lines: ["You are now entering the mall of your memories. Please mind the escalator.", "This song has been slowed down to 70 percent. So has my life.", "Vapor FM: it's not a genre, it's a mood.", "Stay hydrated. This message was not sponsored. We wish it were."],
  },
  {
    id: "bonk", name: "Bonk Radio 101.1", genre: "chiptune", bpm: 150, root: 130.8, scale: MAJOR, chords: [0, 4, 5, 3], lead: "square", bass: "triangle", pad: "square",
    kick: "x...x...x...x...", snare: "....x.......x..x", hat: "x.x.x.x.x.x.x.x.", arp: true, dj: "8-Bit Brenda",
    songs: ["Extra Life (Continue?) — Save State", "Boss Rush Hour — The Pixelated", "Coin Door — NES Mess", "Speedrun Any% — Frame Perfect"],
    lines: ["Bonk Radio, where every song is a boss fight.", "Press start to continue. Press anything else to also continue.", "Fun fact: this station runs on two AA batteries.", "Go touch grass. In-game grass counts."],
  },
  {
    id: "lofi", name: "Lo-Fi Beats to Evade Police To 77.7", genre: "lo-fi hip hop", bpm: 82, root: 164.8, scale: DORIAN, chords: [0, 3, 6, 4], lead: "sine", bass: "sine", pad: "triangle",
    kick: "x......x..x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", arp: false, lofi: true, dj: "Chill Anime Study Girl (Probably)",
    songs: ["Rainy Window, Five Stars — beats.exe", "Studying for My Getaway — lofi.cop", "Three A.M. Burrito — sleepy tofu", "Cozy Chase Scene — chillhop ghost"],
    lines: ["Relax. Breathe. The helicopter can't hear this.", "Beats to evade police to. Also to study to. Mostly the first one.", "If you're hearing this, you've lost them. Or they've gotten really quiet.", "Remember to hydrate between car chases."],
  },
  {
    id: "talk", name: "Copium Talk 99.9", genre: "talk radio", bpm: 60, root: 110, scale: MINOR, chords: [0], lead: "sine", bass: "sine", pad: "sine",
    kick: "................", snare: "................", hat: "................", arp: false, talk: true, dj: "Ron Rant",
    songs: [],
    lines: [
      "Caller, you're on Copium Talk. — Yeah, I think the Stonks Tower is a hologram. — Bold. Next caller.",
      "Today's topic: is Mid Town actually mid? The answer is yes. That's the whole show.",
      "They say the pigeons at Touch Grass Park are government drones. I say: why would the government want grass?",
      "My financial advice: buy high, sell low, and never, ever read the whitepaper.",
      "A listener writes: 'Ron, my car got stolen outside my crib.' Buddy, in Neon Bay that's called a loan.",
      "The NBPD would like to remind drivers that hitting pedestrians is still illegal. They were very firm about the 'still'.",
      "Breaking: the Lucky Doge casino reports record profits. Experts baffled. The house, it turns out, always wins.",
      "I've been on hold with Grandma Glitch's tech support for six hours. Best conversation I've had all year.",
      "Somebody spray-painted 'WEN LAMBO' on the sea wall. Kid, I've been asking that since the nineties.",
    ],
  },
];

/** The DJ's line between tunes: what played, what's next, and a thought. */
export function djLine(s: Station, song: number, random: () => number): string {
  const take = s.lines[Math.floor(random() * s.lines.length)];
  if (s.talk || !s.songs.length) return take;
  const now = s.songs[song % s.songs.length];
  return `${s.name}. Up next: ${now}. ${take}`;
}
