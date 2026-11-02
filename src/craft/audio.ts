/**
 * Every sound in the game, synthesized with WebAudio — no sample files.
 *
 * Block sounds are shaped noise, tuned per material (stone clicks bright and
 * short, wood knocks low, gravel crunches, glass rings), mobs are small
 * oscillator voices, and the music is a slow generative piano on a pentatonic
 * scale that plays now and then and leaves long silences, the way the
 * original's score does. Sounds are placed by distance and stereo pan from the
 * listener; a full HRTF panner per footstep costs more than it adds.
 *
 * Browsers only start audio after a user gesture, so the context is created
 * lazily and resumed on the first click or key.
 */
import { djLine, STATIONS, type Station } from "./engine/radio";
import type { AmbientCue } from "./engine/ambience";
import type { Material } from "./engine/blocks";


const MATERIAL_TONE: Record<Material, { freq: number; q: number; len: number; type: BiquadFilterType; gain: number }> = {
  stone: { freq: 2200, q: 1.2, len: 0.09, type: "bandpass", gain: 0.7 },
  wood: { freq: 700, q: 2.5, len: 0.12, type: "bandpass", gain: 0.9 },
  dirt: { freq: 900, q: 0.8, len: 0.1, type: "lowpass", gain: 0.8 },
  grass: { freq: 3500, q: 0.6, len: 0.1, type: "highpass", gain: 0.45 },
  sand: { freq: 1600, q: 0.7, len: 0.12, type: "bandpass", gain: 0.6 },
  gravel: { freq: 1300, q: 0.9, len: 0.14, type: "bandpass", gain: 0.75 },
  glass: { freq: 4200, q: 3, len: 0.18, type: "bandpass", gain: 0.6 },
  wool: { freq: 600, q: 0.5, len: 0.12, type: "lowpass", gain: 0.5 },
  metal: { freq: 3000, q: 6, len: 0.2, type: "bandpass", gain: 0.6 },
  plant: { freq: 4000, q: 0.5, len: 0.08, type: "highpass", gain: 0.35 },
  leaves: { freq: 3000, q: 0.5, len: 0.1, type: "highpass", gain: 0.4 },
  snow: { freq: 1800, q: 0.5, len: 0.12, type: "lowpass", gain: 0.5 },
  water: { freq: 900, q: 1, len: 0.2, type: "lowpass", gain: 0.5 },
  lava: { freq: 400, q: 1, len: 0.3, type: "lowpass", gain: 0.6 },
  none: { freq: 1000, q: 1, len: 0.05, type: "lowpass", gain: 0 },
};

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private rainNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  private nextMusic = 60;
  private musicPlaying = false;
  volumes = { master: 0.8, sfx: 1, music: 0.5 };
  enabled = true;

  /** Must be called from a user gesture the first time. */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.music = ctx.createGain();
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(3.5);
      this.music.connect(this.reverb);
      this.reverb.connect(this.master);
      this.music.connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfx.gain.value = this.volumes.sfx;
    this.music.gain.value = this.volumes.music * 0.5;
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw;
  }

  /** A node chain that places a sound in the world: distance fade and stereo pan. */
  private placed(x: number | null, y: number, z: number, volume: number, range = 16): AudioNode | null {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    let gain = volume;
    let pan = 0;
    if (x !== null) {
      const dx = x - this.listener.x, dy = y - this.listener.y, dz = z - this.listener.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > range) return null;
      gain *= Math.max(0, 1 - dist / range) ** 1.5;
      // Right of the listener is +x rotated by yaw.
      const rx = Math.cos(this.listener.yaw), rz = -Math.sin(this.listener.yaw);
      pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / Math.max(1, dist)));
    }
    g.gain.value = gain;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan * 0.8;
      g.connect(p);
      p.connect(this.sfx);
    } else g.connect(this.sfx);
    return g;
  }

  private noiseBurst(out: AudioNode, t: number, len: number, filter: BiquadFilterType, freq: number, q: number, gain: number, sweep = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (sweep !== 1) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + len);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5, len + 0.05);
  }

  private tone(out: AudioNode, t: number, type: OscillatorType, from: number, to: number, len: number, gain: number, attack = 0.01): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(out);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  /** A block sound: kind is dig (a mining tick), break, place or step. */
  block(material: Material, kind: "dig" | "break" | "place" | "step", x: number, y: number, z: number): void {
    if (!this.ready()) return;
    const tone = MATERIAL_TONE[material] ?? MATERIAL_TONE.stone;
    const vol = kind === "step" ? 0.18 : kind === "dig" ? 0.25 : 0.5;
    const out = this.placed(x, y, z, vol * tone.gain);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const len = tone.len * (kind === "break" ? 1.8 : kind === "step" ? 0.8 : 1);
    this.noiseBurst(out, t, len, tone.type, tone.freq * (0.9 + Math.random() * 0.2), tone.q, 0.9);
    if (material === "wood" || material === "dirt") this.tone(out, t, "sine", 160, 90, len, 0.4);
    if (material === "glass" && kind === "break") {
      for (let i = 0; i < 4; i++) this.tone(out, t + i * 0.03, "sine", 2400 + Math.random() * 1800, 1800, 0.25, 0.15);
    }
    if (material === "metal") this.tone(out, t, "triangle", 1400, 1300, 0.25, 0.2);
    if (kind === "break") this.noiseBurst(out, t + 0.03, len, tone.type, tone.freq * 0.7, tone.q, 0.6);
  }

  play(name: string, x: number | null = null, y = 0, z = 0, volume = 1, pitch = 1): void {
    if (!this.ready()) return;
    // The dragon and the End's portals carry across the island; most sounds only a few blocks.
    const far = name === "explode" || name === "siren_wail" || name.startsWith("firework_") && name !== "firework_launch" || name === "thunder" || name.startsWith("ender_dragon") || name === "end_portal_spawn" || name === "end_gateway_spawn";
    const out = this.placed(x, y, z, volume, far ? 96 : 16);
    if (!out) return;
    const t = this.ctx!.currentTime;
    const p = pitch;
    switch (name) {
      case "pop": this.tone(out, t, "sine", 500 * p, 900 * p, 0.08, 0.35); break;
      case "orb": this.tone(out, t, "sine", 1300 * p, 1700 * p, 0.12, 0.2); this.tone(out, t + 0.05, "sine", 2000 * p, 2400 * p, 0.1, 0.1); break;
      case "levelup":
        [523, 659, 784, 1047].forEach((f, i) => this.tone(out, t + i * 0.09, "triangle", f, f, 0.35, 0.25));
        break;
      case "hurt": this.tone(out, t, "triangle", 260 * p, 150 * p, 0.18, 0.5); this.noiseBurst(out, t, 0.08, "lowpass", 800, 1, 0.3); break;
      case "eat": for (let i = 0; i < 2; i++) this.noiseBurst(out, t + i * 0.07, 0.06, "bandpass", 1800 + Math.random() * 800, 1.5, 0.5); break;
      case "burp": this.tone(out, t, "sawtooth", 140, 90, 0.35, 0.3); break;
      case "bow": this.tone(out, t, "triangle", 420 * p, 180, 0.2, 0.4); this.noiseBurst(out, t, 0.12, "highpass", 3000, 1, 0.3); break;
      case "arrow_hit": this.noiseBurst(out, t, 0.08, "bandpass", 900, 2, 0.6); this.tone(out, t, "sine", 180, 90, 0.1, 0.3); break;
      case "fizz": this.noiseBurst(out, t, 0.4, "highpass", 4000, 0.7, 0.5, 0.5); break;
      case "splash": this.noiseBurst(out, t, 0.5, "bandpass", 1400, 0.8, 0.8, 0.4); break;
      case "swim": this.noiseBurst(out, t, 0.25, "lowpass", 900, 0.8, 0.3, 0.6); break;
      case "explode":
        this.noiseBurst(out, t, 1.6, "lowpass", 900, 0.8, 1, 0.15);
        this.tone(out, t, "sine", 90, 30, 1.2, 0.9);
        break;
      case "thunder":
        this.noiseBurst(out, t, 3.5, "lowpass", 400, 0.5, 1, 0.3);
        this.noiseBurst(out, t + 0.3, 2.5, "lowpass", 250, 0.5, 0.8, 0.5);
        break;
      case "fuse": case "creeper_hiss": this.noiseBurst(out, t, 1.5, "highpass", 2500, 0.8, 0.6, 1.2); break;
      case "door_open": case "door_close":
        this.noiseBurst(out, t, 0.12, "bandpass", name === "door_open" ? 600 : 450, 3, 0.8);
        this.tone(out, t, "sine", 150, 80, 0.12, 0.4);
        break;
      case "chest_open": this.tone(out, t, "sawtooth", 90, 140, 0.4, 0.15, 0.05); this.noiseBurst(out, t, 0.2, "bandpass", 700, 4, 0.3); break;
      case "chest_close": this.noiseBurst(out, t, 0.1, "bandpass", 500, 3, 0.8); this.tone(out, t, "sine", 120, 70, 0.1, 0.5); break;
      case "click": this.tone(out, t, "square", 900, 800, 0.03, 0.12); break;
      case "shear": this.noiseBurst(out, t, 0.06, "highpass", 5000, 1, 0.6); this.noiseBurst(out, t + 0.08, 0.06, "highpass", 5000, 1, 0.6); break;
      case "milk": this.noiseBurst(out, t, 0.4, "lowpass", 1200, 1, 0.4, 0.5); break;
      case "note": {
        const f = 185 * Math.pow(2, (pitch - 1) * 2);
        this.tone(out, t, "triangle", f, f, 0.6, 0.4);
        this.tone(out, t, "sine", f * 2, f * 2, 0.4, 0.15);
        break;
      }
      case "leaves": this.noiseBurst(out, t, 0.15, "highpass", 3000, 0.6, 0.3); break;
      case "chicken_egg": this.tone(out, t, "sine", 300, 200, 0.1, 0.3); break;
      case "bucket_fill": this.noiseBurst(out, t, 0.3, "bandpass", 1000, 1.2, 0.6, 1.6); break;
      case "bucket_empty": this.noiseBurst(out, t, 0.35, "bandpass", 1400, 1.2, 0.6, 0.5); break;
      case "fire": this.noiseBurst(out, t, 0.3, "bandpass", 1200, 0.8, 0.4, 0.8); break;
      case "ignite": this.noiseBurst(out, t, 0.2, "highpass", 3000, 1, 0.5); this.tone(out, t, "square", 1500, 1000, 0.05, 0.1); break;
      case "drink": this.noiseBurst(out, t, 0.12, "lowpass", 500, 1.5, 0.35, 0.7); this.tone(out, t, "sine", 180 * p, 120 * p, 0.1, 0.2); break;
      case "brew":
        for (let i = 0; i < 5; i++) this.tone(out, t + i * 0.07, "sine", 300 + Math.random() * 400, 200 + Math.random() * 200, 0.06, 0.12);
        break;
      case "helicopter":
        // Rotor blades far overhead: a low thud-thud-thud under a turbine's whine, fading in and out.
        for (let i = 0; i < 12; i++) this.noiseBurst(out, t + i * 0.09, 0.07, "lowpass", 220, 1, 0.5 * Math.sin((i / 12) * Math.PI) + 0.1);
        this.tone(out, t, "sawtooth", 880, 900, 1.1, 0.03, 0.3);
        break;
      case "glass_break":
        this.noiseBurst(out, t, 0.25, "highpass", 3500, 0.7, 0.5);
        for (let i = 0; i < 4; i++) this.tone(out, t + i * 0.03, "triangle", 2400 + i * 500, 1800 + i * 400, 0.08, 0.1);
        break;
      case "enchant":
        // A rising shimmer: the table's pages turning into light.
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(out, t + i * 0.06, "sine", f, f * 1.01, 0.5, 0.12));
        break;
      case "anvil_use": this.tone(out, t, "square", 1100 * p, 1050 * p, 0.25, 0.18); this.tone(out, t, "triangle", 2250 * p, 2200 * p, 0.35, 0.12); this.noiseBurst(out, t, 0.05, "highpass", 4000, 1, 0.3); break;
      case "anvil_break": this.noiseBurst(out, t, 0.5, "bandpass", 900, 0.8, 0.6); this.tone(out, t, "square", 400, 150, 0.4, 0.2); break;
      // A struck bell: two inharmonic partials ringing out over two seconds.
      case "bell":
        this.tone(out, t, "sine", 880 * p, 878 * p, 2.2, 0.35);
        this.tone(out, t, "sine", 2270 * p, 2265 * p, 1.2, 0.12);
        this.tone(out, t, "triangle", 440 * p, 439 * p, 1.6, 0.1);
        break;
      case "compost": this.noiseBurst(out, t, 0.18, "lowpass", 900 * p, 1.2, 0.5, 0.7); break;
      // The portal: a low hum swelling as the four seconds run, and a rushing whoosh on the way through.
      case "portal_trigger":
        this.tone(out, t, "sine", 110, 220, 3.8, 0.18, 1.2);
        this.tone(out, t, "sine", 165, 330, 3.8, 0.1, 1.2);
        break;
      case "portal_travel": this.noiseBurst(out, t, 1.6, "bandpass", 600, 0.5, 0.7, 0.8); this.tone(out, t, "sawtooth", 80, 400, 1.4, 0.12, 0.3); break;
      case "fire_charge": this.noiseBurst(out, t, 0.35, "bandpass", 1500, 0.8, 0.6, 0.6); break;
      case "throw": this.noiseBurst(out, t, 0.15, "highpass", 2200 * p, 0.8, 0.3, 0.5); break;
      // The End: an eye set in a frame clicks and chimes; the last one opens the portal with a deep swell.
      case "end_portal_frame_fill": this.tone(out, t, "square", 700, 650, 0.05, 0.12); this.tone(out, t + 0.03, "sine", 1320, 1320, 0.5, 0.12); break;
      case "end_portal_spawn":
        this.tone(out, t, "sine", 55, 110, 3, 0.35, 0.5);
        [262, 330, 392, 523].forEach((f, i) => this.tone(out, t + 0.4 + i * 0.25, "triangle", f, f, 1.5, 0.12));
        break;
      case "end_gateway_spawn": this.noiseBurst(out, t, 1.2, "bandpass", 500, 0.6, 0.7, 0.3); this.tone(out, t, "sine", 70, 40, 1.4, 0.4); break;
      case "eye_of_ender_launch": this.tone(out, t, "sine", 500, 1100, 0.4, 0.15); break;
      case "eye_of_ender_death": this.noiseBurst(out, t, 0.2, "highpass", 3000, 1, 0.3); this.tone(out, t, "triangle", 900, 500, 0.3, 0.15); break;
      case "chorus_fruit_teleport": case "enderman_teleport":
        this.tone(out, t, "sawtooth", 200 * p, 1200 * p, 0.25, 0.12);
        this.tone(out, t + 0.05, "sine", 900 * p, 300 * p, 0.3, 0.12);
        break;
      case "firework_launch": this.noiseBurst(out, t, 0.6, "highpass", 1800, 0.6, 0.5, 1.5); break;
      // A burst: a sharp crack, a deeper boom for a large ball, and a crackle of little pops for a twinkle.
      case "firework_blast": this.noiseBurst(out, t, 0.5, "lowpass", 1600, 0.7, 0.9, 0.2); this.tone(out, t, "sine", 160, 60, 0.35, 0.4); break;
      case "firework_large_blast": this.noiseBurst(out, t, 1.1, "lowpass", 900, 0.7, 1, 0.25); this.tone(out, t, "sine", 90, 35, 0.9, 0.5); break;
      case "firework_twinkle": for (let i = 0; i < 9; i++) this.noiseBurst(out, t + 0.5 + i * 0.07 + Math.random() * 0.05, 0.03, "highpass", 3500, 1, 0.35); break;
      case "bottle_fill_dragonbreath": this.noiseBurst(out, t, 0.35, "bandpass", 1500, 1, 0.5, 1.5); this.tone(out, t, "sine", 500, 900, 0.3, 0.12); break;
      case "dragon_fireball_explode": this.noiseBurst(out, t, 1, "lowpass", 700, 0.8, 0.8, 0.3); this.tone(out, t, "sine", 120, 50, 0.8, 0.4); break;
      // Item frames: a wooden tap to hang, a click to turn, a pop as the item comes out.
      case "item_frame_place": case "item_frame_break": this.noiseBurst(out, t, 0.1, "bandpass", 700, 2, 0.6); this.tone(out, t, "sine", 180, 110, 0.1, 0.3); break;
      case "item_frame_add": this.noiseBurst(out, t, 0.08, "bandpass", 1300, 2, 0.4); break;
      case "item_frame_rotate": this.tone(out, t, "square", 1100, 1000, 0.03, 0.1); break;
      case "item_frame_remove": this.tone(out, t, "sine", 600, 950, 0.08, 0.3); break;
      // Game modes: a horn for a wave, the arena's cannon for a fallen tribute, a beep for a countdown.
      case "horn": this.tone(out, t, "sawtooth", 110, 116, 1.6, 0.25, 0.3); this.tone(out, t, "sawtooth", 165, 172, 1.6, 0.12, 0.3); break;
      case "cannon": this.noiseBurst(out, t, 1.4, "lowpass", 260, 0.7, 1, 0.1); this.tone(out, t, "sine", 70, 28, 1.2, 0.6); break;
      case "countdown": this.tone(out, t, "square", 880 * p, 880 * p, 0.12, 0.12); break;
      // Gunfire: a sharp crack over a thump, heavier for the rifle and the shotgun.
      case "gun_pistol": this.noiseBurst(out, t, 0.18, "highpass", 1200, 0.7, 0.9, 0.3); this.tone(out, t, "sine", 180, 60, 0.12, 0.6); break;
      case "gun_rifle": this.noiseBurst(out, t, 0.5, "lowpass", 3000, 0.6, 1, 0.5); this.tone(out, t, "sine", 120, 40, 0.3, 0.8); break;
      case "gun_assault": this.noiseBurst(out, t, 0.14, "highpass", 900, 0.7, 0.8, 0.3); this.tone(out, t, "sine", 150, 60, 0.1, 0.5); break;
      case "gun_shotgun": this.noiseBurst(out, t, 0.6, "lowpass", 2200, 0.5, 1, 0.4); this.tone(out, t, "sine", 90, 35, 0.35, 0.9); break;
      case "gun_empty": this.tone(out, t, "square", 1800, 1700, 0.03, 0.15); break;
      case "zombie_break": this.noiseBurst(out, t, 0.15, "bandpass", 500, 1.5, 0.5); this.tone(out, t, "sine", 120, 80, 0.12, 0.3); break;
      case "purchase": [523, 659, 784].forEach((f, i) => this.tone(out, t + i * 0.06, "square", f, f, 0.1, 0.1)); break;
      // Critters: a chirruping cry pitched to the critter's size, blows landing, the orb's throw, wobble and click.
      case "critter_cry": case "critter_hurt":
        this.tone(out, t, "triangle", 700 * p, 1100 * p, 0.09, 0.25); this.tone(out, t + 0.09, "triangle", 1000 * p, 650 * p, 0.12, 0.2);
        break;
      case "critter_death": case "critter_faint": this.tone(out, t, "triangle", 600 * p, 180 * p, 0.5, 0.3); break;
      case "critter_move": this.noiseBurst(out, t, 0.18, "bandpass", 1600 * p, 0.9, 0.35, 0.5); break;
      case "critter_hit": this.noiseBurst(out, t, 0.12, "lowpass", 1400 * p, 1, 0.7); this.tone(out, t, "square", 220 * p, 110 * p, 0.08, 0.25); break;
      case "orb_throw": this.noiseBurst(out, t, 0.2, "highpass", 2500, 0.8, 0.35, 0.6); this.tone(out, t + 0.15, "sine", 900, 500, 0.12, 0.2); break;
      case "orb_shake": this.tone(out, t, "square", 320 * p, 300 * p, 0.05, 0.18); this.tone(out, t + 0.07, "square", 300 * p, 280 * p, 0.05, 0.14); break;
      case "orb_open": this.tone(out, t, "sine", 500, 1400, 0.15, 0.25); this.noiseBurst(out, t, 0.15, "highpass", 3000, 1, 0.25); break;
      case "orb_catch": [784, 988, 1175, 1568].forEach((f, i) => this.tone(out, t + i * 0.08, "square", f, f, 0.12, 0.1)); break;
      case "heal_jingle": [659, 784, 988, 784, 1319].forEach((f, i) => this.tone(out, t + i * 0.13, "triangle", f, f, 0.2, 0.2)); break;
      case "level_up": [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(out, t + i * 0.07, "square", f, f, 0.12, 0.1)); break;
      case "battle_start": [220, 277, 330, 440, 330, 440, 554].forEach((f, i) => this.tone(out, t + i * 0.06, "sawtooth", f, f, 0.08, 0.1)); break;
      // The casino: chips clacking, cards snapping down, reels whirring and thunking to a stop, the ball's rattle,
      // wins from a bright chime to a full jackpot fanfare, and the crash game's rising whine and its crash.
      case "chip": this.tone(out, t, "square", 2400 * p, 2200 * p, 0.03, 0.12); this.noiseBurst(out, t, 0.04, "highpass", 5000, 1, 0.25); break;
      case "card": this.noiseBurst(out, t, 0.06, "bandpass", 3000 * p, 1.5, 0.45); break;
      case "reel_spin": for (let i = 0; i < 6; i++) this.tone(out, t + i * 0.05, "square", 520 + (i % 2) * 90, 480, 0.03, 0.06); break;
      case "reel_stop": this.tone(out, t, "square", 180 * p, 120 * p, 0.07, 0.3); this.noiseBurst(out, t, 0.05, "lowpass", 900, 1, 0.3); break;
      case "ball": for (let i = 0; i < 10; i++) this.noiseBurst(out, t + i * (0.05 + i * 0.012), 0.03, "bandpass", 4200 - i * 150, 3, 0.25); break;
      case "win_small": [784, 1047, 1319].forEach((f, i) => this.tone(out, t + i * 0.07, "triangle", f, f, 0.14, 0.18)); break;
      case "win_big": [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(out, t + i * 0.09, "square", f, f, 0.16, 0.12)); break;
      case "jackpot":
        for (let r = 0; r < 3; r++) [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(out, t + r * 0.42 + i * 0.08, "square", f, f, 0.18, 0.12));
        this.noiseBurst(out, t, 1.2, "highpass", 6000, 0.6, 0.2, 0.8);
        break;
      case "lose": this.tone(out, t, "sawtooth", 300 * p, 140 * p, 0.35, 0.15); break;
      case "crash_boom": this.noiseBurst(out, t, 0.8, "lowpass", 700, 0.8, 0.7, 0.2); this.tone(out, t, "sawtooth", 400, 50, 0.6, 0.25); break;
      case "cashout": [880, 1175, 1760].forEach((f, i) => this.tone(out, t + i * 0.05, "square", f, f, 0.08, 0.14)); break;
      // The streets: a two-note horn (lower for the big ones), the police whoop, a crunch of metal and glass, a dent.
      case "car_horn": this.tone(out, t, "sawtooth", 415 * p, 415 * p, 0.35, 0.16); this.tone(out, t, "sawtooth", 523 * p, 523 * p, 0.35, 0.12); break;
      // Mission passed: a rising fanfare with a sting at the end. Failed: two sagging notes.
      case "mission_passed":
        [392, 523, 659, 784].forEach((f, i) => this.tone(out, t + i * 0.1, "square", f, f, 0.14, 0.12));
        this.tone(out, t + 0.42, "sawtooth", 1047, 1047, 0.6, 0.12, 0.02);
        this.tone(out, t + 0.42, "square", 523, 523, 0.6, 0.08, 0.02);
        break;
      case "mission_failed": this.tone(out, t, "sawtooth", 392, 370, 0.35, 0.14); this.tone(out, t + 0.35, "sawtooth", 294, 262, 0.7, 0.14); break;
      // A cruiser's wail: up and down, carried a long way.
      case "siren_wail": this.tone(out, t, "square", 650, 1250, 0.45, 0.08, 0.05); this.tone(out, t + 0.45, "square", 1250, 650, 0.45, 0.08, 0.05); break;
      case "siren_whoop": this.tone(out, t, "square", 600, 1500, 0.35, 0.14); this.tone(out, t + 0.35, "square", 1500, 700, 0.3, 0.12); break;
      case "car_crash":
        this.noiseBurst(out, t, 0.45, "lowpass", 1100 * p, 0.8, 0.9, 0.35);
        this.tone(out, t, "square", 140 * p, 60 * p, 0.3, 0.3);
        for (let i = 0; i < 5; i++) this.tone(out, t + 0.04 + i * 0.03, "sine", 2600 + Math.random() * 2400, 2000, 0.12, 0.08);
        break;
      case "car_hit": this.tone(out, t, "triangle", 900 * p, 500 * p, 0.12, 0.3); this.noiseBurst(out, t, 0.08, "bandpass", 2200, 2, 0.3); break;
      case "trainer_spot": this.tone(out, t, "square", 1047, 1047, 0.08, 0.2); this.tone(out, t + 0.1, "square", 1397, 1397, 0.18, 0.2); break;
      default:
        this.mob(name, out, t, p);
    }
  }

  private mob(name: string, out: AudioNode, t: number, p: number): void {
    // "iron_golem_hurt" is the golem's, not an "iron" mob's: two-word kinds are matched whole.
    const long = ["iron_golem", "zombified_piglin", "magma_cube", "wither_skeleton", "ender_dragon"].find((k) => name.startsWith(`${k}_`) || name === k);
    const [kind, what] = long ? [long, name.slice(long.length + 1)] : name.split("_");
    const death = what === "death";
    const low = death ? 0.75 : 1;
    switch (kind) {
      case "pig": this.tone(out, t, "sawtooth", 320 * p * low, 200 * p * low, 0.22, 0.25); this.tone(out, t + 0.12, "sawtooth", 300 * p * low, 180 * p * low, 0.18, 0.2); break;
      case "cow": this.tone(out, t, "sawtooth", 150 * p * low, 110 * p * low, 0.8, 0.25, 0.1); break;
      case "sheep": {
        const ctx = this.ctx!;
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(420 * p * low, t);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 18;
        const depth = ctx.createGain();
        depth.gain.value = 25;
        lfo.connect(depth); depth.connect(o.frequency);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1400;
        o.connect(f); f.connect(g); g.connect(out);
        o.start(t); lfo.start(t); o.stop(t + 0.65); lfo.stop(t + 0.65);
        break;
      }
      case "chicken": for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.08, "square", 900 * p * low, 700 * p * low, 0.05, 0.12); break;
      case "zombie": this.tone(out, t, "sawtooth", 110 * p * low, 80 * p * low, 0.9, 0.3, 0.2); this.noiseBurst(out, t, 0.8, "lowpass", 500, 1, 0.2); break;
      case "skeleton": for (let i = 0; i < 4; i++) this.noiseBurst(out, t + i * 0.05, 0.03, "bandpass", 2500, 4, 0.5); break;
      case "creeper": this.noiseBurst(out, t, 0.4, "highpass", 2000, 0.8, 0.4); break;
      case "spider": this.noiseBurst(out, t, 0.3, "bandpass", 1600, 3, 0.4, 0.6); this.tone(out, t, "square", 200, 150, 0.2, 0.1); break;
      // A wet slap: a low thump under a short band of noise, pitched by the slime's size.
      case "slime": this.tone(out, t, "sine", 180 * p * low, 90 * p * low, 0.15, 0.4); this.noiseBurst(out, t, 0.12, "bandpass", 700 * p, 2, 0.35, 0.8); break;
      // The villager's "hmm": a nasal hum that rises for yes, falls for no, and wobbles otherwise.
      case "villager": {
        const [from, to] = what === "yes" ? [190, 260] : what === "no" ? [230, 150] : [210 * low, 180 * low];
        this.tone(out, t, "sawtooth", from * p, to * p, what === "death" ? 0.6 : 0.35, 0.18, 0.05);
        this.tone(out, t, "square", from * 2 * p, to * 2 * p, 0.3, 0.05, 0.05);
        break;
      }
      // Piglins snort; the zombified ones grunt lower and wetter.
      case "piglin": case "zombified_piglin": {
        const z = kind === "zombified_piglin" ? 0.7 : 1;
        const f = (what === "admire" ? 1.3 : 1) * z * p * low;
        this.tone(out, t, "sawtooth", 260 * f, 170 * f, 0.18, 0.22);
        this.tone(out, t + 0.1, "sawtooth", 230 * f, 150 * f, 0.16, 0.18);
        this.noiseBurst(out, t, 0.15, "lowpass", 700 * z, 1, 0.25);
        break;
      }
      // A person: an "oof" when hurt, a longer fall-away when it is the end of them.
      case "citizen": this.tone(out, t, "triangle", (death ? 300 : 360) * p, (death ? 120 : 220) * p, death ? 0.5 : 0.16, 0.35, 0.02); this.noiseBurst(out, t, 0.06, "lowpass", 900, 1, 0.2); break;
      case "hoglin": this.tone(out, t, "sawtooth", 110 * p * low, 70 * p * low, 0.4, 0.3, 0.05); this.noiseBurst(out, t, 0.3, "lowpass", 400, 1, 0.3); break;
      // A wolf barks when hurt, whines as it dies, and pants or yips otherwise.
      case "wolf":
        if (what === "hurt") { this.tone(out, t, "sawtooth", 520 * p, 300 * p, 0.12, 0.25); this.noiseBurst(out, t, 0.1, "bandpass", 1200, 2, 0.3); }
        else if (death) this.tone(out, t, "sine", 900 * p, 400 * p, 0.8, 0.15, 0.05);
        else for (let i = 0; i < 3; i++) this.noiseBurst(out, t + i * 0.16, 0.08, "bandpass", 900, 1.5, 0.12);
        break;
      case "deer": this.tone(out, t, "sawtooth", 700 * p * low, 500 * p * low, 0.25, 0.12, 0.02); break;
      // Primal's creatures: each its own voice, lower for the big ones, a roar for the rex.
      case "dodo": this.tone(out, t, "square", 700 * p * low, 480 * p * low, 0.14, 0.12); this.tone(out, t + 0.16, "square", 650 * p * low, 450 * p * low, 0.12, 0.1); break;
      case "dilo":
        if (what === "spit") { this.noiseBurst(out, t, 0.25, "bandpass", 2400, 1.5, 0.5); break; }
        this.tone(out, t, "sawtooth", 900 * p * low, 1300 * p * low, 0.2, 0.12); this.noiseBurst(out, t, 0.2, "highpass", 2500, 1, 0.2);
        break;
      case "parasaur": this.tone(out, t, "sawtooth", 220 * p * low, 260 * p * low, 0.8, 0.2, 0.1); this.tone(out, t, "sine", 440 * p * low, 520 * p * low, 0.8, 0.08, 0.1); break;
      case "raptor": this.tone(out, t, "sawtooth", 950 * p * low, 600 * p * low, 0.28, 0.16); this.noiseBurst(out, t, 0.2, "bandpass", 1800, 2, 0.25); break;
      case "trike": this.tone(out, t, "sawtooth", 120 * p * low, 90 * p * low, 0.6, 0.3, 0.05); this.noiseBurst(out, t, 0.5, "lowpass", 400, 1, 0.3); break;
      case "stego": this.tone(out, t, "sawtooth", 100 * p * low, 80 * p * low, 0.9, 0.28, 0.1); break;
      case "rex":
        // The roar: a long falling growl under a rush of breath.
        this.tone(out, t, "sawtooth", (what === "roar" ? 120 : 95) * p * low, 55 * p * low, what === "roar" ? 1.8 : 0.9, 0.45, 0.15);
        this.noiseBurst(out, t, what === "roar" ? 1.7 : 0.8, "lowpass", 600, 0.7, 0.55, 0.4);
        break;
      case "bronto": this.tone(out, t, "sine", 65 * p * low, 45 * p * low, 2, 0.5, 0.4); this.tone(out, t + 0.1, "sawtooth", 90 * p * low, 70 * p * low, 1.6, 0.12, 0.4); break;
      case "ptero": this.tone(out, t, "square", 1250 * p * low, 900 * p * low, 0.3, 0.1); this.tone(out, t + 0.12, "square", 1100 * p * low, 800 * p * low, 0.25, 0.08); break;
      case "gigantoraptor": this.tone(out, t, "sawtooth", 320 * p * low, 200 * p * low, 0.7, 0.22, 0.1); this.noiseBurst(out, t, 0.4, "bandpass", 900, 1.5, 0.2); break;
      // The infected: groans and gurgles; a runner's rasp; a brute's roar; a screamer's shriek; a bloater's wet pop.
      case "infected": this.tone(out, t, "sawtooth", 130 * p * low, 90 * p * low, 0.8, 0.28, 0.2); this.noiseBurst(out, t, 0.7, "lowpass", 600, 1, 0.22); break;
      // Ashgrove's dead: a slower, lower moan, and from the floor a wet, breathy rattle.
      case "shambler": this.tone(out, t, "sawtooth", 105 * p * low, 75 * p * low, 1.1, 0.26, 0.3); this.noiseBurst(out, t, 0.9, "lowpass", 500, 1, 0.2, 0.2); break;
      case "crawler": this.tone(out, t, "sawtooth", 150 * p * low, 110 * p * low, 0.6, 0.18, 0.1); this.noiseBurst(out, t, 0.6, "bandpass", 700, 2.5, 0.28); break;
      case "runner": this.tone(out, t, "sawtooth", 260 * p * low, 180 * p * low, 0.4, 0.22, 0.05); this.noiseBurst(out, t, 0.35, "bandpass", 1600, 1.2, 0.3); break;
      case "brute": this.tone(out, t, "sawtooth", 80 * p * low, 55 * p * low, 1.1, 0.45, 0.2); this.noiseBurst(out, t, 1, "lowpass", 400, 0.8, 0.4); break;
      case "spitter":
        if (what === "spit") { this.noiseBurst(out, t, 0.3, "bandpass", 2200, 1.4, 0.5); break; }
        this.tone(out, t, "sawtooth", 180 * p * low, 140 * p * low, 0.6, 0.2, 0.1); this.noiseBurst(out, t, 0.5, "bandpass", 1200, 3, 0.3);
        break;
      case "screamer":
        if (what === "scream") { this.tone(out, t, "sawtooth", 900, 1500, 1.4, 0.35, 0.2); this.tone(out, t, "square", 1300, 2000, 1.3, 0.12, 0.2); break; }
        this.tone(out, t, "sawtooth", 500 * p * low, 380 * p * low, 0.5, 0.2, 0.1);
        break;
      case "bloater":
        if (what === "burst") { this.noiseBurst(out, t, 0.8, "lowpass", 500, 0.7, 0.9, 0.3); this.tone(out, t, "sine", 90, 40, 0.5, 0.5); break; }
        this.tone(out, t, "sawtooth", 95 * p * low, 70 * p * low, 1, 0.3, 0.2); this.noiseBurst(out, t, 0.9, "bandpass", 300, 2, 0.3);
        break;
      // A tribute is only a person: a grunt when struck, a cry when they fall, nothing idle.
      case "tribute":
        if (what === "hurt") { this.tone(out, t, "triangle", 250 * p, 150 * p, 0.18, 0.4); this.noiseBurst(out, t, 0.08, "lowpass", 800, 1, 0.25); }
        else if (death) this.tone(out, t, "triangle", 300, 110, 0.7, 0.35, 0.1);
        break;
      case "bear": this.tone(out, t, "sawtooth", 85 * p * low, 60 * p * low, 0.9, 0.35, 0.1); this.noiseBurst(out, t, 0.8, "lowpass", 300, 1, 0.3, 0.6); break;
      case "wither_skeleton": for (let i = 0; i < 4; i++) this.noiseBurst(out, t + i * 0.06, 0.04, "bandpass", 1400, 4, 0.5); break;
      // A ghast's long mournful cry; a shriek when hurt; a cough of fire when it spits.
      case "ghast":
        if (what === "shoot") { this.noiseBurst(out, t, 0.5, "lowpass", 1200, 0.8, 0.6, 0.7); this.tone(out, t, "sawtooth", 160, 60, 0.4, 0.3); }
        else if (what === "warn" || what === "hurt") this.tone(out, t, "triangle", 900 * p, 1300 * p, 0.6, 0.25, 0.05);
        else { this.tone(out, t, "sine", 520 * p * low, 380 * p * low, 1.6, 0.18, 0.3); this.tone(out, t + 0.2, "sine", 780 * p * low, 540 * p * low, 1.4, 0.08, 0.3); }
        break;
      // Blazes breathe in rasps of fire.
      case "blaze":
        if (what === "shoot") this.noiseBurst(out, t, 0.3, "bandpass", 1800, 0.8, 0.5, 0.4);
        else if (what === "charge") this.noiseBurst(out, t, 0.8, "highpass", 2500, 0.6, 0.35, 1.2);
        else { this.noiseBurst(out, t, 0.6, "bandpass", 700, 1.5, 0.35, 0.8); this.tone(out, t, "square", 120 * p, 90 * p, 0.3, 0.08); }
        break;
      case "magma": case "magma_cube":
        this.tone(out, t, "sine", 120 * p * low, 60 * p * low, 0.2, 0.45);
        this.noiseBurst(out, t, 0.15, "lowpass", 500 * p, 2, 0.4, 0.8);
        break;
      // Endermen: warbling, backwards-sounding murmurs; a shriek when stared at.
      case "enderman":
        if (what === "scream" || what === "stare") { this.tone(out, t, "sawtooth", 600 * p, 1500 * p, 0.7, 0.25, 0.05); this.tone(out, t, "square", 310 * p, 760 * p, 0.7, 0.1, 0.05); }
        else { this.tone(out, t, "triangle", 260 * p * low, 380 * p * low, 0.35, 0.2); this.tone(out, t + 0.15, "triangle", 420 * p * low, 220 * p * low, 0.4, 0.15); }
        break;
      // Shulkers: the lid's hollow clack, a soft blip as a bullet leaves, a chime where it lands.
      case "shulker":
        if (what === "open" || what === "close") this.noiseBurst(out, t, 0.12, "bandpass", what === "open" ? 900 : 650, 3, 0.4);
        else if (what === "shoot") this.tone(out, t, "sine", 700 * p, 1400 * p, 0.15, 0.2);
        else if (what === "bullet") { this.tone(out, t, "triangle", 1500, 900, 0.2, 0.2); this.noiseBurst(out, t, 0.1, "highpass", 3000, 1, 0.2); }
        else if (what === "teleport") { this.tone(out, t, "sawtooth", 300 * p, 1100 * p, 0.2, 0.1); }
        else { this.noiseBurst(out, t, 0.15, "bandpass", 1100 * p, 2.5, 0.4); this.tone(out, t, "square", 300 * p * low, 200 * p * low, 0.15, 0.1); }
        break;
      case "silverfish": for (let i = 0; i < 3; i++) this.noiseBurst(out, t + i * 0.05, 0.04, "bandpass", 3200, 5, 0.3); break;
      // The dragon: a low roar with a rasp over it; a gurgle before it spits.
      case "ender_dragon":
        if (what === "shoot") { this.noiseBurst(out, t, 0.6, "bandpass", 900, 0.8, 0.6, 0.5); this.tone(out, t, "sawtooth", 180, 90, 0.5, 0.3); }
        else if (what === "hurt") this.tone(out, t, "sawtooth", 240 * p, 120 * p, 0.5, 0.4, 0.05);
        else {
          this.tone(out, t, "sawtooth", 70 * p * low, 45 * p * low, death ? 4 : 1.8, 0.4, 0.3);
          this.noiseBurst(out, t, death ? 4 : 1.6, "lowpass", 500, 0.7, 0.5, 0.5);
        }
        break;
      // Clanking iron: a hollow knock under metallic ringing.
      case "iron_golem":
        this.tone(out, t, "square", 90 * low, 60 * low, 0.3, 0.3);
        this.noiseBurst(out, t, 0.25, "bandpass", 1800, 5, 0.4);
        this.tone(out, t, "sine", 1250 * p, 1240 * p, 0.5, 0.08);
        break;
    }
  }

  /**
   * One ambient sound (engine/ambience.ts), at x, y, z — somewhere around
   * the listener, so a bird is off to one side rather than inside the head.
   */
  ambient(cue: AmbientCue, x: number, y: number, z: number): void {
    if (!this.ready()) return;
    const out = this.placed(x, y, z, 1, 24);
    if (!out) return;
    const t = this.ctx!.currentTime + 0.02;
    const r = Math.random;
    switch (cue) {
      case "birds": {
        // A short song: two to five chirps, each a quick upward sweep.
        const base = 2400 + r() * 1400;
        const n = 2 + Math.floor(r() * 4);
        for (let i = 0; i < n; i++) this.tone(out, t + i * (0.09 + r() * 0.08), "sine", base * (0.9 + r() * 0.2), base * (1.2 + r() * 0.3), 0.07, 0.05);
        break;
      }
      case "crickets":
        for (let i = 0; i < 6; i++) this.tone(out, t + i * 0.05, "square", 4600, 4550, 0.03, 0.012);
        for (let i = 0; i < 6; i++) this.tone(out, t + 0.6 + i * 0.05, "square", 4600, 4550, 0.03, 0.012);
        break;
      case "owl":
        this.tone(out, t, "sine", 400, 360, 0.35, 0.06, 0.05);
        this.tone(out, t + 0.5, "sine", 380, 330, 0.6, 0.06, 0.05);
        break;
      case "frogs":
        for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.18, "triangle", 170 + r() * 30, 120, 0.12, 0.08);
        break;
      case "waves": this.noiseBurst(out, t, 2.6, "lowpass", 500, 0.5, 0.06, 2.2); break;
      case "wind": this.noiseBurst(out, t, 3.2, "bandpass", 380, 0.8, 0.05, 2.4); break;
      case "leaves": this.noiseBurst(out, t, 0.9, "highpass", 3200, 0.6, 0.025, 1.3); break;
      case "cave_drip":
        this.tone(out, t, "sine", 1900 + r() * 600, 700, 0.09, 0.07);
        this.tone(out, t + 0.28, "sine", 1500 + r() * 400, 600, 0.07, 0.025);
        break;
      case "cave_rumble": this.noiseBurst(out, t, 3, "lowpass", 140, 0.7, 0.12, 0.6); break;
      case "nether_moan":
        this.tone(out, t, "sine", 95 + r() * 20, 65, 3, 0.1, 0.8);
        this.noiseBurst(out, t, 2.5, "lowpass", 220, 0.6, 0.05, 0.7);
        break;
      case "end_hum": this.tone(out, t, "sine", 55, 52, 4, 0.08, 1.2); this.tone(out, t, "sine", 110.5, 104, 4, 0.03, 1.5); break;
    }
  }

  /** Ongoing rain, 0..1. */
  setRain(level: number): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    if (level > 0 && !this.rainNode) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 2200;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.sfx);
      src.start();
      this.rainNode = { src, gain: g };
    }
    if (this.rainNode) {
      this.rainNode.gain.gain.setTargetAtTime(level * 0.12, ctx.currentTime, 0.5);
      if (level <= 0.001) {
        const node = this.rainNode;
        setTimeout(() => { try { node.src.stop(); } catch { /* already stopped */ } }, 2000);
        this.rainNode = null;
      }
    }
  }

  /** Called every second or so; starts a short generative piece now and then. */
  // ---- the car radio (engine/radio.ts has the stations) --------------------------------------

  private tuned: {
    station: number; out: GainNode; next: number; step: number; bar: number; song: number; shift: number;
    melody: number[]; crackle: AudioBufferSourceNode | null; talkAt: number;
  } | null = null;
  /** Called with the DJ's words (for a caption) when a station comes on and between tunes. */
  onDj: ((who: string, text: string) => void) | null = null;

  /**
   * Plays a station, writing its music as it goes a quarter-second ahead;
   * null turns the radio off. Called every frame while at the wheel.
   */
  radio(station: number | null): void {
    if (station === null || !this.ready() || this.volumes.music <= 0) { this.radioOff(); return; }
    const ctx = this.ctx!;
    const s = STATIONS[station % STATIONS.length];
    if (!this.tuned || this.tuned.station !== station) {
      this.radioOff();
      const out = ctx.createGain();
      out.gain.value = 0.5;
      let node: AudioNode = out;
      if (s.lofi) {
        const f = ctx.createBiquadFilter();
        f.type = "lowpass"; f.frequency.value = 2200;
        out.connect(f);
        node = f;
      }
      node.connect(this.music);
      let crackle: AudioBufferSourceNode | null = null;
      if (s.lofi) {
        crackle = ctx.createBufferSource();
        crackle.buffer = this.noise; crackle.loop = true;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 5000;
        const g = ctx.createGain(); g.gain.value = 0.025;
        crackle.connect(hp); hp.connect(g); g.connect(out);
        crackle.start();
      }
      this.tuned = { station, out, next: ctx.currentTime + 0.15, step: 0, bar: 0, song: Math.floor(Math.random() * 8), shift: 0, melody: this.writeMelody(s), crackle, talkAt: ctx.currentTime + 1 };
      this.onDj?.(s.dj, djLine(s, this.tuned.song, Math.random));
    }
    const st = this.tuned;
    if (s.talk) {
      // Talk radio: the host never stops, and a jingle between rants.
      if (ctx.currentTime >= st.talkAt) {
        st.talkAt = ctx.currentTime + 9 + Math.random() * 5;
        [523, 659, 784].forEach((f, i) => this.tone(st.out, ctx.currentTime + i * 0.12, "sine", f, f, 0.18, 0.08));
        if (st.bar++ > 0) this.onDj?.(s.dj, djLine(s, 0, Math.random));
      }
      return;
    }
    const step = 60 / s.bpm / 4;
    while (st.next < ctx.currentTime + 0.25) {
      this.radioStep(s, st, st.next, step);
      st.next += step;
      if (++st.step % 16 === 0) {
        st.bar++;
        // Every sixteen bars a new tune: a new key nearby, a new melody, and a word from the DJ.
        if (st.bar % 16 === 0) {
          st.song++;
          st.shift = [0, 2, -2, 3, -3, 5][Math.floor(Math.random() * 6)];
          st.melody = this.writeMelody(s);
          this.onDj?.(s.dj, djLine(s, st.song, Math.random));
        }
      }
    }
  }

  private radioOff(): void {
    if (!this.tuned) return;
    const t = this.tuned;
    this.tuned = null;
    try { t.crackle?.stop(); } catch { /* already stopped */ }
    if (this.ctx) t.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    setTimeout(() => t.out.disconnect(), 400);
  }

  /** Two bars of eighth notes, scale degrees or rests (-1), for a melodic station to repeat and vary. */
  private writeMelody(s: Station): number[] {
    const out: number[] = [];
    let d = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < 16; i++) {
      if (Math.random() < (s.arp ? 0.1 : 0.35)) { out.push(-1); continue; }
      d = Math.max(0, Math.min(11, d + Math.floor(Math.random() * 5) - 2));
      out.push(d);
    }
    return out;
  }

  private radioStep(s: Station, st: NonNullable<typeof this.tuned>, t: number, len: number): void {
    const i = st.step % 16;
    const chord = s.chords[st.bar % s.chords.length];
    const freq = (deg: number, octave: number) => {
      const n = s.scale.length;
      const semis = s.scale[((deg % n) + n) % n] + 12 * Math.floor(deg / n) + st.shift;
      return s.root * Math.pow(2, semis / 12 + octave);
    };
    const out = st.out;
    if (s.kick[i] === "x") this.tone(out, t, "sine", 130, 42, 0.22, 0.55, 0.002);
    if (s.snare[i] === "x") this.noiseBurst(out, t, 0.14, "bandpass", 1800, 0.9, 0.35, 0.5);
    if (s.hat[i] === "x") this.noiseBurst(out, t, 0.04, "highpass", 7000, 0.8, 0.12);
    if (i === 0) for (const k of [0, 2, 4]) this.tone(out, t, s.pad, freq(chord + k, 0), freq(chord + k, 0), len * 15, 0.035, 0.3);
    if (i % 8 === 0 || (s.arp && i % 4 === 2)) this.tone(out, t, s.bass, freq(chord, -1), freq(chord, -1), len * (s.arp ? 1.8 : 3.5), 0.16, 0.01);
    if (s.arp) {
      // An arpeggio up and down the chord, an octave up.
      const pattern = [0, 2, 4, 7, 4, 2];
      this.tone(out, t, s.lead, freq(chord + pattern[st.step % pattern.length], 1), freq(chord + pattern[st.step % pattern.length], 1), len * 0.9, 0.05);
      // The tune over it, on the eighths, every other bar.
      const m = st.melody[(st.step >> 1) % 16];
      if (i % 2 === 0 && st.bar % 2 === 1 && m >= 0) this.tone(out, t, "square", freq(m, 1), freq(m, 1), len * 1.8, 0.045);
    } else if (i % 2 === 0) {
      const m = st.melody[(st.step >> 1) % 16];
      if (m >= 0) this.tone(out, t, s.lead, freq(m, 1), freq(m, 1), len * 3, 0.08, 0.02);
    }
  }

  private motor: { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  /**
   * The engine of the car being driven: a growl whose pitch climbs with the
   * speed through four gears, and dips as each one changes. Null stops it.
   */
  engine(state: { speed: number; top: number; throttle: number } | null): void {
    if (!state) {
      if (this.motor && this.ctx) {
        const m = this.motor, t = this.ctx.currentTime;
        m.gain.gain.setTargetAtTime(0, t, 0.1);
        m.osc.stop(t + 0.5); m.sub.stop(t + 0.5);
        this.motor = null;
      }
      return;
    }
    if (!this.ready()) return;
    const ctx = this.ctx!;
    if (!this.motor) {
      const osc = ctx.createOscillator(), sub = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
      osc.type = "sawtooth"; sub.type = "square";
      filter.type = "lowpass"; filter.frequency.value = 600;
      gain.gain.value = 0;
      osc.connect(filter); sub.connect(filter); filter.connect(gain); gain.connect(this.sfx);
      osc.start(); sub.start();
      this.motor = { osc, sub, gain, filter };
    }
    const f = Math.min(1, Math.abs(state.speed) / Math.max(0.1, state.top));
    // Four gears: within each the revs climb, and fall back a little at the change.
    const gear = Math.min(3, Math.floor(f * 4));
    const rev = f * 4 - gear;
    const hz = 45 + gear * 8 + rev * 55;
    const t = ctx.currentTime;
    this.motor.osc.frequency.setTargetAtTime(hz, t, 0.05);
    this.motor.sub.frequency.setTargetAtTime(hz / 2, t, 0.05);
    this.motor.filter.frequency.setTargetAtTime(400 + rev * 500 + state.throttle * 400, t, 0.08);
    this.motor.gain.gain.setTargetAtTime(0.05 + state.throttle * 0.04 + f * 0.03, t, 0.1);
  }

  tickMusic(dt: number, calm: boolean): void {
    if (!this.ready() || this.volumes.music <= 0) return;
    this.nextMusic -= dt;
    if (this.nextMusic > 0 || this.musicPlaying) return;
    this.nextMusic = 180 + Math.random() * 240;
    this.playPiece(calm);
  }

  private playPiece(calm: boolean): void {
    const ctx = this.ctx!;
    this.musicPlaying = true;
    const roots = calm ? [196, 220, 261.6, 174.6] : [146.8, 164.8];
    const root = roots[Math.floor(Math.random() * roots.length)];
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19];
    let t = ctx.currentTime + 0.5;
    const notes = 24 + Math.floor(Math.random() * 16);
    let idx = Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      idx = Math.max(0, Math.min(scale.length - 1, idx + Math.floor(Math.random() * 5) - 2));
      const f = root * Math.pow(2, scale[idx] / 12);
      this.pianoNote(f, t, 0.12 + Math.random() * 0.06);
      if (i % 4 === 0) this.pianoNote(root / 2 * Math.pow(2, scale[Math.floor(Math.random() * 3)] / 12), t, 0.08);
      t += [0.6, 0.9, 1.2, 1.8][Math.floor(Math.random() * 4)];
    }
    setTimeout(() => { this.musicPlaying = false; }, (t - ctx.currentTime + 4) * 1000);
  }

  private pianoNote(freq: number, t: number, gain: number): void {
    const ctx = this.ctx!;
    for (const [mult, g0, type] of [[1, 1, "triangle"], [2, 0.3, "sine"], [3, 0.1, "sine"]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * g0, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      o.connect(g); g.connect(this.music);
      o.start(t); o.stop(t + 3);
    }
  }

  private ready(): boolean {
    return this.enabled && !!this.ctx && this.ctx.state === "running";
  }

  dispose(): void {
    if (this.rainNode) { try { this.rainNode.src.stop(); } catch { /* stopped */ } }
    void this.ctx?.close();
    this.ctx = null;
  }
}

