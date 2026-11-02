/**
 * Particles: block debris when mining, smoke, hearts, splashes, explosions.
 *
 * One Points object with a fixed pool, simulated on the CPU and drawn from the
 * texture atlas. Block debris samples a random 4×4 corner of the block's own
 * texture, so breaking grass throws green-and-brown chips and breaking stone
 * throws grey ones without any per-block particle art.
 */
import * as THREE from "three";
import { block, faceTexture } from "../engine/blocks";
import { layerOf } from "../engine/atlas";
import type { World } from "../engine/world";
import type { SharedUniforms } from "./materials";
import { DYE_RGB, parseBurstParticle, type Burst } from "../engine/fireworks";

const MAX = 3000;

interface Kind {
  layer: string;
  gravity: number;
  life: [number, number];
  size: [number, number];
  drag: number;
  collide: boolean;
  grow?: number;
  fullTexture?: boolean;
  /** Coloured by the emit call's data (0xRRGGBB), or this default. */
  tint?: number;
  /** Starting speed; drifting kinds barely move. */
  speed?: number;
  /** Lit by itself, not the world: fireworks in the night sky. */
  glow?: boolean;
}

const KINDS: Record<string, Kind> = {
  smoke: { layer: "particle_smoke", gravity: -0.3, life: [0.6, 1.4], size: [0.15, 0.3], drag: 0.96, collide: false, grow: 1.5, fullTexture: true },
  poof: { layer: "particle_smoke", gravity: -0.5, life: [0.4, 0.9], size: [0.2, 0.35], drag: 0.9, collide: false, fullTexture: true },
  explosion: { layer: "particle_smoke", gravity: -0.4, life: [0.6, 1.4], size: [0.6, 1.4], drag: 0.92, collide: false, grow: 1.2, fullTexture: true },
  heart: { layer: "particle_heart", gravity: -0.6, life: [0.8, 1.2], size: [0.2, 0.25], drag: 0.95, collide: false, fullTexture: true },
  flame: { layer: "particle_flame", gravity: -0.2, life: [0.3, 0.6], size: [0.08, 0.12], drag: 0.95, collide: false, fullTexture: true },
  crit: { layer: "particle_spark", gravity: 2, life: [0.3, 0.6], size: [0.08, 0.14], drag: 0.9, collide: false, fullTexture: true },
  bubble: { layer: "particle_bubble", gravity: -3, life: [0.4, 1.0], size: [0.06, 0.1], drag: 0.85, collide: false, fullTexture: true },
  splash: { layer: "water_still", gravity: 9, life: [0.3, 0.7], size: [0.06, 0.1], drag: 0.98, collide: true },
  snow: { layer: "snow", gravity: 6, life: [0.4, 0.8], size: [0.06, 0.1], drag: 0.98, collide: true },
  egg: { layer: "egg", gravity: 9, life: [0.3, 0.7], size: [0.06, 0.1], drag: 0.98, collide: true },
  slime: { layer: "slime_ball", gravity: 9, life: [0.3, 0.7], size: [0.06, 0.12], drag: 0.98, collide: true },
  // A burst of potion mist; tinted per potion through the particle's data colour.
  potion: { layer: "particle_smoke", gravity: -0.6, life: [0.5, 1.2], size: [0.06, 0.12], drag: 0.88, collide: false, fullTexture: true },
  note: { layer: "particle_note", gravity: -0.5, life: [0.8, 1.0], size: [0.2, 0.2], drag: 0.9, collide: false, fullTexture: true },
  block: { layer: "stone", gravity: 14, life: [0.4, 1.2], size: [0.07, 0.12], drag: 0.98, collide: true },
  // The Nether: sparks off a portal, and what drifts in each biome's air.
  portal: { layer: "particle_spark", gravity: -0.4, life: [0.8, 1.6], size: [0.06, 0.1], drag: 0.9, collide: false, fullTexture: true, tint: 0xb070ff, speed: 1.2 },
  ash: { layer: "particle_smoke", gravity: 0.25, life: [3, 5], size: [0.04, 0.07], drag: 0.99, collide: true, fullTexture: true, tint: 0x8a8580, speed: 0.15 },
  crimson_spores: { layer: "particle_spark", gravity: 0.08, life: [3, 6], size: [0.04, 0.06], drag: 0.99, collide: false, fullTexture: true, tint: 0xd03a2a, speed: 0.15 },
  warped_spores: { layer: "particle_spark", gravity: -0.08, life: [3, 6], size: [0.04, 0.06], drag: 0.99, collide: false, fullTexture: true, tint: 0x3ce6b8, speed: 0.15 },
  soul: { layer: "particle_spark", gravity: -0.35, life: [1, 2], size: [0.08, 0.12], drag: 0.96, collide: false, fullTexture: true, tint: 0x6ae8ff, speed: 0.3 },
  // The End: the dragon's breath, and the white motes an end rod gives off.
  dragon_breath: { layer: "particle_spark", gravity: -0.15, life: [0.8, 1.6], size: [0.08, 0.14], drag: 0.94, collide: false, fullTexture: true, tint: 0xd060ff, speed: 0.4 },
  end_rod: { layer: "particle_spark", gravity: -0.05, life: [1, 2], size: [0.05, 0.08], drag: 0.97, collide: false, fullTexture: true, tint: 0xf4f0ff, speed: 0.2 },
  lava_spark: { layer: "particle_flame", gravity: 6, life: [0.5, 1.2], size: [0.06, 0.1], drag: 0.99, collide: true, fullTexture: true, speed: 2 },
  // Fireworks: the sparks of a burst (shaped and coloured by burst()), and the rocket's trail.
  // Big enough to read as a burst from thirty blocks away, as the original's are.
  firework: { layer: "particle_spark", gravity: 0.6, life: [1.4, 2.2], size: [0.3, 0.45], drag: 0.92, collide: false, fullTexture: true, tint: 0xffffff, glow: true },
  firework_trail: { layer: "particle_spark", gravity: 0.4, life: [0.4, 0.8], size: [0.14, 0.22], drag: 0.95, collide: false, fullTexture: true, tint: 0xffe6b8, glow: true, speed: 0.15 },
};

export class Particles {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private gravity = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private grow = new Float32Array(MAX);
  private baseSize = new Float32Array(MAX);
  private collide = new Uint8Array(MAX);
  private attrPos: THREE.BufferAttribute;
  private attrData: THREE.BufferAttribute;
  private attrTex: THREE.BufferAttribute;
  private data = new Float32Array(MAX * 4); // size, alpha, light, unused
  private tex = new Float32Array(MAX * 4); // layer, u offset, v offset, span
  private color = new Float32Array(MAX * 3).fill(1);
  // Per spark of a firework: the colour it fades to, whether it glows, twinkles or trails.
  private startColor = new Float32Array(MAX * 3);
  private fadeColor = new Float32Array(MAX * 3);
  private fades = new Uint8Array(MAX);
  private glows = new Uint8Array(MAX);
  private twinkles = new Uint8Array(MAX);
  private trails = new Uint8Array(MAX);
  private attrColor: THREE.BufferAttribute;
  private next = 0;
  budget = 1;

  constructor(shared: SharedUniforms, public world: World) {
    const g = new THREE.BufferGeometry();
    this.attrPos = new THREE.BufferAttribute(this.pos, 3);
    this.attrData = new THREE.BufferAttribute(this.data, 4);
    this.attrTex = new THREE.BufferAttribute(this.tex, 4);
    this.attrColor = new THREE.BufferAttribute(this.color, 3);
    this.attrColor.setUsage(THREE.DynamicDrawUsage);
    this.attrPos.setUsage(THREE.DynamicDrawUsage);
    this.attrData.setUsage(THREE.DynamicDrawUsage);
    this.attrTex.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.attrPos);
    g.setAttribute("aData", this.attrData);
    g.setAttribute("aTex", this.attrTex);
    g.setAttribute("aColor", this.attrColor);
    const m = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: `
        precision highp float;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        uniform float uScale;
        in vec3 position;
        in vec4 aData;
        in vec4 aTex;
        in vec3 aColor;
        out vec4 vTex;
        out float vAlpha;
        out float vLight;
        out vec3 vColor;
        void main() {
          vTex = aTex;
          vColor = aColor;
          vAlpha = aData.y;
          vLight = aData.z;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aData.y > 0.0 ? aData.x * uScale / max(0.1, -mv.z) : 0.0;
        }`,
      fragmentShader: `
        precision highp float;
        precision highp sampler2DArray;
        uniform sampler2DArray uAtlas;
        in vec4 vTex;
        in float vAlpha;
        in float vLight;
        in vec3 vColor;
        out vec4 outColor;
        void main() {
          vec2 uv = vTex.yz + vec2(gl_PointCoord.x, gl_PointCoord.y) * vTex.w;
          vec4 t = texture(uAtlas, vec3(uv, vTex.x));
          if (t.a * vAlpha < 0.1) discard;
          outColor = vec4(t.rgb * vColor * vLight, t.a * vAlpha);
        }`,
      uniforms: { uAtlas: shared.uAtlas, uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  setViewportHeight(h: number, fov: number): void {
    (this.points.material as THREE.RawShaderMaterial).uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));
  }

  /** `blockId` is the block for "block" particles and an 0xRRGGBB tint for "potion" ones. */
  emit(kind: string, x: number, y: number, z: number, count = 1, blockId = 0, spread = 0.3): void {
    if (kind.startsWith("fw|")) {
      const b = parseBurstParticle(kind);
      if (b) this.burst(b, x, y, z);
      return;
    }
    const k = KINDS[kind] ?? KINDS.smoke;
    const n = Math.max(1, Math.round(count * this.budget));
    let layer = layerOf(k.layer);
    if (kind === "block" && blockId > 0) layer = layerOf(faceTexture(block(blockId), 0, 4));
    for (let i = 0; i < n; i++) {
      const p = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[p * 3] = x + (Math.random() - 0.5) * spread * 2;
      this.pos[p * 3 + 1] = y + (Math.random() - 0.5) * spread * 2;
      this.pos[p * 3 + 2] = z + (Math.random() - 0.5) * spread * 2;
      const speed = k.speed ?? (kind === "explosion" ? 4 : kind === "block" || kind === "splash" || kind === "crit" || kind === "potion" ? 3 : 0.6);
      this.vel[p * 3] = (Math.random() - 0.5) * speed;
      this.vel[p * 3 + 1] = (Math.random() * 0.8 + (kind === "block" || kind === "splash" ? 0.6 : 0.1)) * speed;
      this.vel[p * 3 + 2] = (Math.random() - 0.5) * speed;
      const life = k.life[0] + Math.random() * (k.life[1] - k.life[0]);
      this.life[p] = life;
      this.maxLife[p] = life;
      this.gravity[p] = k.gravity;
      this.drag[p] = k.drag;
      this.grow[p] = k.grow ?? 1;
      this.collide[p] = k.collide ? 1 : 0;
      this.baseSize[p] = k.size[0] + Math.random() * (k.size[1] - k.size[0]);
      const span = k.fullTexture ? 1 : 0.25;
      this.tex[p * 4] = layer;
      this.tex[p * 4 + 1] = k.fullTexture ? 0 : Math.floor(Math.random() * 4) * 0.25;
      this.tex[p * 4 + 2] = k.fullTexture ? 0 : Math.floor(Math.random() * 4) * 0.25;
      this.tex[p * 4 + 3] = span;
      this.data[p * 4] = this.baseSize[p];
      this.data[p * 4 + 1] = 1;
      this.data[p * 4 + 2] = 1;
      const tint = kind === "potion" ? blockId : k.tint !== undefined ? (blockId || k.tint) : 0xffffff;
      this.color[p * 3] = ((tint >> 16) & 255) / 255;
      this.color[p * 3 + 1] = ((tint >> 8) & 255) / 255;
      this.color[p * 3 + 2] = (tint & 255) / 255;
      this.glows[p] = k.glow ? 1 : 0;
      this.fades[p] = 0; this.twinkles[p] = 0; this.trails[p] = 0;
      if (k.glow) this.data[p * 4 + 2] = 1;
    }
    this.attrColor.needsUpdate = true;
  }

  /**
   * A firework star going off: sparks thrown out in its shape — a ball, a
   * bigger ball, a five-pointed star, or a ragged burst — each in one of its
   * colours, fading to a fade colour if it has one, twinkling or trailing.
   */
  burst(b: Burst, x: number, y: number, z: number): void {
    const base = b.shape === "large" ? 150 : b.shape === "small" ? 80 : 90;
    const n = Math.max(12, Math.round(base * this.budget));
    const dirs: [number, number, number][] = [];
    if (b.shape === "star") {
      // Points along a five-pointed star's outline, in a plane turned at random.
      const turn = Math.random() * Math.PI * 2, tilt = (Math.random() - 0.5) * 0.8;
      const outline: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 0.45 : 1;
        outline.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      for (let i = 0; i < n; i++) {
        const e = (i / n) * 10, k = Math.floor(e), f = e - k;
        const [ax, ay] = outline[k % 10], [bx, by] = outline[(k + 1) % 10];
        const u = ax + (bx - ax) * f, v = ay + (by - ay) * f;
        dirs.push([Math.cos(turn) * u, -v * Math.cos(tilt), Math.sin(turn) * u + v * Math.sin(tilt)]);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const zc = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - zc * zc);
        const reach = b.shape === "burst" ? Math.random() * 1.1 : 0.92 + Math.random() * 0.08;
        dirs.push([Math.cos(a) * r * reach, zc * reach, Math.sin(a) * r * reach]);
      }
    }
    const speed = b.shape === "large" ? 9 : b.shape === "star" ? 6.5 : b.shape === "burst" ? 7 : 4.5;
    const k = KINDS.firework;
    const layer = layerOf(k.layer);
    for (const [dx, dy, dz] of dirs) {
      const p = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[p * 3] = x; this.pos[p * 3 + 1] = y; this.pos[p * 3 + 2] = z;
      this.vel[p * 3] = dx * speed; this.vel[p * 3 + 1] = dy * speed; this.vel[p * 3 + 2] = dz * speed;
      const life = k.life[0] + Math.random() * (k.life[1] - k.life[0]);
      this.life[p] = life; this.maxLife[p] = life;
      this.gravity[p] = k.gravity; this.drag[p] = k.drag; this.grow[p] = 1; this.collide[p] = 0;
      this.baseSize[p] = k.size[0] + Math.random() * (k.size[1] - k.size[0]);
      this.tex[p * 4] = layer; this.tex[p * 4 + 1] = 0; this.tex[p * 4 + 2] = 0; this.tex[p * 4 + 3] = 1;
      this.data[p * 4] = this.baseSize[p]; this.data[p * 4 + 1] = 1; this.data[p * 4 + 2] = 1;
      const c = DYE_RGB[b.colors[Math.floor(Math.random() * b.colors.length)]] ?? 0xffffff;
      for (let j = 0; j < 3; j++) this.startColor[p * 3 + j] = this.color[p * 3 + j] = ((c >> (16 - j * 8)) & 255) / 255;
      this.fades[p] = b.fades?.length ? 1 : 0;
      if (b.fades?.length) {
        const f = DYE_RGB[b.fades[Math.floor(Math.random() * b.fades.length)]] ?? 0xffffff;
        for (let j = 0; j < 3; j++) this.fadeColor[p * 3 + j] = ((f >> (16 - j * 8)) & 255) / 255;
      }
      this.glows[p] = 1;
      this.twinkles[p] = b.twinkle ? 1 : 0;
      this.trails[p] = b.trail ? 1 : 0;
    }
    this.attrColor.needsUpdate = true;
  }

  update(dt: number, daylight: number, ambient = 0): void {
    let fading = false;
    for (let p = 0; p < MAX; p++) {
      if (this.life[p] <= 0) { this.data[p * 4 + 1] = 0; continue; }
      this.life[p] -= dt;
      const i = p * 3;
      this.vel[i + 1] -= this.gravity[p] * dt;
      const d = Math.pow(this.drag[p], dt * 20);
      this.vel[i] *= d; this.vel[i + 1] *= d; this.vel[i + 2] *= d;
      let nx = this.pos[i] + this.vel[i] * dt, ny = this.pos[i + 1] + this.vel[i + 1] * dt, nz = this.pos[i + 2] + this.vel[i + 2] * dt;
      if (this.collide[p]) {
        const id = this.world.blockAt(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (id && block(id).solid) {
          ny = this.pos[i + 1];
          this.vel[i + 1] = 0;
          this.vel[i] *= 0.5; this.vel[i + 2] *= 0.5;
          nx = this.pos[i]; nz = this.pos[i + 2];
        }
      }
      this.pos[i] = nx; this.pos[i + 1] = ny; this.pos[i + 2] = nz;
      const t = this.life[p] / this.maxLife[p];
      this.data[p * 4] = this.baseSize[p] * (1 + (1 - t) * (this.grow[p] - 1));
      this.data[p * 4 + 1] = Math.min(1, t * 3);
      if (this.fades[p]) {
        const f = Math.max(0, Math.min(1, (0.75 - t) / 0.5));
        for (let j = 0; j < 3; j++) this.color[i + j] = this.startColor[i + j] + (this.fadeColor[i + j] - this.startColor[i + j]) * f;
        fading = true;
      }
      // A twinkle crackles in its last half: sparks blinking on and off.
      if (this.twinkles[p] && t < 0.5) this.data[p * 4 + 1] = Math.random() < 0.5 ? 1 : 0.15;
      if (this.trails[p] && (this.frame + p) % 3 === 0 && t > 0.2) {
        const q = this.next;
        this.next = (this.next + 1) % MAX;
        if (q !== p) {
          this.pos[q * 3] = nx; this.pos[q * 3 + 1] = ny; this.pos[q * 3 + 2] = nz;
          this.vel[q * 3] = this.vel[q * 3 + 1] = this.vel[q * 3 + 2] = 0;
          this.life[q] = this.maxLife[q] = 0.5;
          this.gravity[q] = 0.8; this.drag[q] = 0.9; this.grow[q] = 1; this.collide[q] = 0;
          this.baseSize[q] = this.baseSize[p] * 0.6;
          for (let j = 0; j < 4; j++) this.tex[q * 4 + j] = this.tex[p * 4 + j];
          for (let j = 0; j < 3; j++) this.color[q * 3 + j] = this.color[i + j];
          this.data[q * 4] = this.baseSize[q]; this.data[q * 4 + 1] = 1; this.data[q * 4 + 2] = 1;
          this.glows[q] = 1; this.fades[q] = 0; this.twinkles[q] = 0; this.trails[q] = 0;
          fading = true;
        }
      }
      if (this.glows[p]) this.data[p * 4 + 2] = 1;
      else if (p % 8 === (this.frame & 7)) {
        const l = this.world.getLight(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        const lv = Math.max(l < 0 ? 15 * daylight : Math.max((l >> 4) * daylight, l & 15), ambient * 15);
        this.data[p * 4 + 2] = 0.15 + (lv / 15) * 0.85;
      }
    }
    this.frame++;
    if (fading) this.attrColor.needsUpdate = true;
    this.attrPos.needsUpdate = true;
    this.attrData.needsUpdate = true;
    this.attrTex.needsUpdate = true;
  }
  private frame = 0;

  clear(): void {
    this.life.fill(0);
    this.data.fill(0);
  }
}
