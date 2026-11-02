/**
 * Drawing the Solar System at its real size.
 *
 * Nothing about it fits a depth buffer: the ship is 42 metres long and Neptune
 * 4.5 billion kilometres away. So nothing is drawn where it really is. Every
 * position is worked out in double precision relative to the camera, and each
 * body that shows as more than a dot gets a pass of its own, far to near, with
 * a depth range made for it alone — and, when it is far, shrunk toward the
 * camera by the same factor as its distance, which leaves it exactly the same
 * size on the screen. Behind them all, the sky: the real stars to magnitude 6
 * and the Milky Way's real outline, with everything too small to be a disc
 * (asteroids, far planets) as points on it. Over it all, a 2D layer: orbits,
 * brackets and names, projected in double precision too.
 *
 * Axes: the physics uses the J2000 ecliptic (z up); three.js wants y up, so
 * (x, y, z) is drawn at (x, z, −y).
 */
import * as THREE from "three";
import type { BodyDef } from "./bodies";
import type { StarSystem } from "./starSystem";
import { AU, cross, DEG, dot, eqToEcl, fromDate, gast, J2000, len, norm, raDecToEcl, scale, sub, type Vec3 } from "./kepler";
import { beltPositions } from "./belts";
import { apparentMagnitude, galacticToEquatorial, SUN_POS } from "./galaxy";
import { cityLightsCanvas, cloudCanvas, detailCanvas, milkyWayCanvas, surfaceCanvas } from "./textures";
import { bvColor, starField } from "./starField";
import type { Ship } from "./flight";
import { comaSize, cometActivity, tailLength } from "./comets";
import { Simplex } from "../engine/noise";
import { Rng } from "../engine/rng";

const toThree = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v[0], v[2], -v[1]);

export interface SpaceCameraState {
  /** What the camera circles: the ship, or a body. */
  target: string;
  yaw: number;
  pitch: number;
  /** Distance from what it circles, km. */
  dist: number;
}

export interface SpaceFrame {
  jd: number;
  dt: number;
  positions: Map<string, Vec3>;
  ship: Ship;
  shipHelio: Vec3;
  camera: SpaceCameraState;
  selected: string | null;
  hovered: string | null;
  /** Which kinds get their orbits drawn. */
  orbits: Set<string>;
  /** The bodies the overview lists, which get brackets. */
  listed: Set<string>;
  /** Under real physics, the ship's path ahead round the body it is near (session.ts pathAhead), relative to that body. */
  path?: { frame: string; points: Vec3[]; hits: boolean; leaves: boolean; pe: Vec3 | null; ap: Vec3 | null; peAlt: number; apAlt: number; air: boolean };
  /** The star system the ship is in (starSystem.ts): its bodies are the ones drawn. */
  system: StarSystem;
  /** A jump under way: how far through its spool or its hyperspace crossing, and where to. */
  jump?: { phase: "spool" | "tunnel"; t: number; total: number; target: string };
}

/** Where a bracket landed on the screen, for clicking. */
export interface Bracket { id: string; x: number; y: number; r: number }

const FAR = 1e5;
const FOV = 55;

// ---- shaders ------------------------------------------------------------------------------------------------------

const BODY_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BODY_FRAG = /* glsl */ `
uniform sampler2D map; uniform sampler2D clouds; uniform float hasClouds; uniform float cloudShift; uniform sampler2D lights; uniform float hasLights; uniform sampler2D detail; uniform float detailStrength; uniform vec2 detailScale;
uniform vec3 sunDir; uniform vec3 atmo; uniform float atmoStrength; uniform float emissive;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(-vP);
  vec3 base = texture2D(map, vUv).rgb;
  if (detailStrength > 0.0) {
    // Two scales of the same tile, so its repeat does not show.
    float d1 = texture2D(detail, vUv * detailScale).r, d2 = texture2D(detail, vUv * detailScale * 5.37 + 0.31).r;
    base *= 1.0 + ((d1 - 0.5) * 0.9 + (d2 - 0.5) * 0.6) * detailStrength;
  }
  if (emissive > 0.5) {
    // The Sun: darker and redder toward its limb, as the eye sees into cooler, higher layers there.
    float mu = max(dot(n, v), 0.0);
    vec3 c = base * (0.4 + 0.6 * pow(mu, 0.45));
    gl_FragColor = vec4(mix(vec3(1.0, 0.55, 0.25), c * vec3(1.0, 0.96, 0.86), pow(mu, 0.3)) * 1.25, 1.0);
    return;
  }
  float ndl = dot(n, sunDir);
  float day = smoothstep(-0.06, 0.12, ndl) * clamp(ndl * 1.25 + 0.1, 0.0, 1.0);
  if (hasClouds > 0.5) {
    float cl = texture2D(clouds, vec2(vUv.x + cloudShift, vUv.y)).a;
    base = mix(base, vec3(0.97), cl * 0.9);
  }
  vec3 c = base * (day + 0.012);
  // The night side of the Earth: its cities, dimmed where cloud covers them.
  if (hasLights > 0.5) {
    float night = 1.0 - smoothstep(-0.12, 0.04, ndl);
    float cover = hasClouds > 0.5 ? texture2D(clouds, vec2(vUv.x + cloudShift, vUv.y)).a : 0.0;
    c += texture2D(lights, vUv).rgb * night * (1.0 - cover * 0.7) * 1.3;
  }
  // The air lit edge-on at the limb, reddened at the terminator.
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.5) * atmoStrength;
  float lit = smoothstep(-0.25, 0.3, ndl);
  vec3 twilight = mix(vec3(1.0, 0.45, 0.2), atmo, smoothstep(0.0, 0.35, ndl));
  c += twilight * rim * lit * 0.9;
  gl_FragColor = vec4(c, 1.0);
}`;

const HALO_FRAG = /* glsl */ `
uniform vec3 sunDir; uniform vec3 atmo; uniform float strength; uniform vec3 center; uniform float radius;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main() {
  vec3 v = normalize(-vP);
  // How close this line of sight passes to the planet, in planet radii: the glow is brightest just above the limb.
  vec3 toC = center;
  float along = dot(toC, v);
  float miss = length(toC - v * along) / radius;
  float h = clamp((miss - 1.0) / 0.035, 0.0, 1.0);
  float glow = (1.0 - h) * (1.0 - h) * step(0.985, miss);
  vec3 up = normalize(v * along - toC);
  float lit = smoothstep(-0.35, 0.25, dot(up, sunDir));
  gl_FragColor = vec4(atmo * glow * lit * strength, 1.0);
}`;

const RING_VERT = /* glsl */ `
varying vec3 vLocal; varying vec3 vP;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const RING_FRAG = /* glsl */ `
uniform sampler2D bands; uniform float inner; uniform float outer; uniform vec3 sunDir; uniform vec3 normalW;
uniform vec3 center; uniform float radius;
varying vec3 vLocal; varying vec3 vP;
void main() {
  float r = length(vLocal.xy);
  float t = (r - inner) / (outer - inner);
  if (t < 0.0 || t > 1.0) discard;
  vec4 b = texture2D(bands, vec2(t, 0.5));
  // Lit from either face, a little brighter on the Sun's; black where the planet's shadow falls.
  float light = 0.35 + 0.65 * abs(dot(normalW, sunDir));
  vec3 rel = vP - center;
  float tt = dot(rel, sunDir);
  float off = length(rel - sunDir * tt);
  float shadow = (tt < 0.0 && off < radius) ? 0.06 : 1.0;
  gl_FragColor = vec4(b.rgb * light * shadow, b.a);
}`;

const POINTS_VERT = /* glsl */ `
attribute float size; attribute vec3 color; varying vec3 vColor;
void main() {
  vColor = color;
  gl_PointSize = size;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const POINTS_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  float a = exp(-r * 3.0);
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

/** Points sized in world units, for comet tails: they shrink with distance. */
const WORLD_POINTS_VERT = /* glsl */ `
attribute float size; attribute float alpha; uniform float scale; uniform float tint; varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vA = alpha * tint;
  gl_PointSize = clamp(size * scale / -mv.z, 1.0, 64.0);
  gl_Position = projectionMatrix * mv;
}`;

const WORLD_POINTS_FRAG = /* glsl */ `
uniform vec3 color; varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 10.0) * vA;
  gl_FragColor = vec4(color * a, 1.0);
}`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SKY_FRAG = /* glsl */ `
uniform sampler2D mw; uniform float brightness;
varying vec3 vDir;
const float EPS = 0.40909280;
void main() {
  // Three.js's axes back to the ecliptic's, then up to the equator's: the map is laid out in right ascension and declination.
  vec3 d = normalize(vDir);
  vec3 ecl = vec3(d.x, -d.z, d.y);
  vec3 eq = vec3(ecl.x, ecl.y * cos(EPS) - ecl.z * sin(EPS), ecl.y * sin(EPS) + ecl.z * cos(EPS));
  float ra = atan(eq.y, eq.x);
  if (ra < 0.0) ra += 6.2831853;
  float dec = asin(clamp(eq.z, -1.0, 1.0));
  vec3 c = texture2D(mw, vec2(ra / 6.2831853, 0.5 + dec / 3.1415927)).rgb;
  gl_FragColor = vec4(c * brightness, 1.0);
}`;

// ---- colours ------------------------------------------------------------------------------------------------------

const KIND_COLORS: Record<string, string> = {
  star: "#ffd76a", planet: "#8fd0ff", dwarf: "#b8c8ff", moon: "#c8d0d8", asteroid: "#c8a878", comet: "#9ff0ff", interstellar: "#ff9a6a", probe: "#e8e070",
};
export const kindColor = (k: string): string => KIND_COLORS[k] ?? "#ffffff";

/**
 * A distance for people: metres, kilometres, or AU. `short` spells millions of km as "6.3M km" for the overview's
 * narrow column, where "million km" wrapped every row round a red dwarf, whose planets all sit closer than 0.1 AU.
 */
export function distanceText(km: number, short = false): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 1e5) return `${km < 100 ? km.toFixed(1) : Math.round(km).toLocaleString("en")} km`;
  if (km < 0.1 * AU) return `${(km / 1e6).toFixed(km < 1e6 ? 2 : 1)}${short ? "M km" : " million km"}`;
  return `${(km / AU).toFixed(km < 10 * AU ? 2 : 1)} AU`;
}

export function speedText(kms: number): string {
  if (kms < 1) return `${Math.round(kms * 1000)} m/s`;
  if (kms < 0.01 * AU) return `${kms < 100 ? kms.toFixed(1) : Math.round(kms).toLocaleString("en")} km/s`;
  return `${(kms / AU).toFixed(2)} AU/s`;
}

// ---- the view -----------------------------------------------------------------------------------------------------

interface BodyView {
  def: BodyDef;
  group: THREE.Group;
  /** The sphere, which turns with the body; rings and halos do not. */
  globe: THREE.Mesh | null;
  body: THREE.ShaderMaterial | null;
  halo: THREE.ShaderMaterial | null;
  ring: THREE.ShaderMaterial | null;
  ringMesh: THREE.Mesh | null;
  /** The furthest anything of it reaches from its centre, km: its rings, or its comet tail. */
  extent: number;
  comet?: { coma: THREE.Sprite; ion: THREE.Points; dust: THREE.Points; ionMat: THREE.ShaderMaterial; dustMat: THREE.ShaderMaterial };
}

export class SpaceView {
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 10);
  private readonly skyCamera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 10);
  private readonly sky = new THREE.Scene();
  private readonly passScene = new THREE.Scene();
  private readonly views = new Map<string, BodyView>();
  private stars!: THREE.Points;
  private dots!: THREE.Points;
  private dotIds: string[] = [];
  private belts: { points: THREE.Points; pos: Float64Array }[] = [];
  private beltJd = NaN;
  private sunGlow!: THREE.Sprite;
  /** The Sun, seen as a star from another system's sky. */
  private homeStar!: THREE.Sprite;
  /** The system whose bodies, belts and star are built. */
  private system: StarSystem | null = null;
  private shipGroup = new THREE.Group();
  /** The glow of the air burning round the ship on re-entry, and the parachute over it. */
  private plasma!: THREE.Sprite;
  private canopy!: THREE.Mesh;
  private shipLight = new THREE.DirectionalLight(0xffffff, 2.6);
  private fillLight = new THREE.DirectionalLight(0xbfd8ff, 0.7);
  private dust!: THREE.Points;
  private dustSeed: Float32Array = new Float32Array(0);
  private streaks!: THREE.LineSegments;
  private width = 1;
  private height = 1;
  private camHelio: Vec3 = [0, 0, 0];
  private orbitCache = new Map<string, { jd: number; around: string; points: Vec3[] }>();
  brackets: Bracket[] = [];
  private overlay: CanvasRenderingContext2D | null = null;
  private time = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.buildSky();
    this.buildShip();
    // The ship's own floodlights and the planet's glow: a hull backlit by the Sun still shows its shape, as EVE's ships do.
    this.passScene.add(this.shipGroup, this.shipLight, new THREE.AmbientLight(0xffffff, 0.55), this.fillLight);
    this.shipGroup.visible = false;
  }

  setOverlay(canvas: HTMLCanvasElement | null): void {
    this.overlay = canvas?.getContext("2d") ?? null;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    for (const c of [this.camera, this.skyCamera]) { c.aspect = this.width / this.height; c.updateProjectionMatrix(); }
  }

  // ---- building ------------------------------------------------------------------------------------------------

  private buildSky(): void {
    // The Milky Way (textures.ts), on a sphere read by right ascension and declination.
    const canvas = milkyWayCanvas()!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(5, 64, 32), new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { mw: { value: tex }, brightness: { value: 0.85 } }, side: THREE.BackSide, depthWrite: false,
    }));
    this.sky.add(sphere);

    // The real stars, and fainter ones scattered thickest along the Milky Way.
    const field = starField();
    const pos = new Float32Array(field.count * 3), col = new Float32Array(field.count * 3), size = new Float32Array(field.count);
    for (let i = 0; i < field.count; i++) {
      const t = toThree(raDecToEcl(field.ra[i], field.dec[i])).multiplyScalar(4);
      pos.set([t.x, t.y, t.z], i * 3);
      const s = Math.sqrt(Math.pow(10, -0.4 * (field.mag[i] - 1.5)));
      size[i] = (1.5 + 2.8 * Math.min(1.6, s)) * (this.renderer.getPixelRatio?.() ?? 1);
      const a = Math.min(1.25, 0.14 + 0.9 * s), rgb = bvColor(field.bv[i]);
      col.set([rgb[0] * a, rgb[1] * a, rgb[2] * a], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("size", new THREE.BufferAttribute(size, 1));
    this.stars = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.stars.frustumCulled = false;
    this.sky.add(this.stars);

    // The star's glare, drawn on the sky so it shows from anywhere in the system (coloured by setSystem).
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([255, 240, 210]), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    this.sky.add(this.sunGlow);
    // From another star, the Sun is a star among the rest.
    this.homeStar = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([255, 244, 214]), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    this.homeStar.visible = false;
    this.sky.add(this.homeStar);
  }

  /**
   * The parts of the view that belong to a star system — a dot for each of
   * its bodies, its belts, its star's glare in the star's own colour — built
   * for the system the ship is in, and built again after a jump, the old
   * system's bodies and orbits thrown away.
   */
  private setSystem(sys: StarSystem): void {
    this.system = sys;
    for (const v of this.views.values()) { this.passScene.remove(v.group); disposeTree(v.group); }
    this.views.clear();
    this.orbitCache.clear();
    for (const b of this.belts) { this.sky.remove(b.points); disposeTree(b.points); }
    this.belts = [];
    this.beltJd = NaN;
    for (const b of sys.belts) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(b.count * 3), 3));
      bg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(b.count * 3), 3));
      bg.setAttribute("size", new THREE.BufferAttribute(new Float32Array(b.count), 1));
      const pts = new THREE.Points(bg, new THREE.ShaderMaterial({ vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      pts.frustumCulled = false;
      this.sky.add(pts);
      this.belts.push({ points: pts, pos: new Float64Array(b.count * 3) });
    }
    // Everything too small to be a disc: a dot, as bright as it would look.
    if (this.dots) { this.sky.remove(this.dots); disposeTree(this.dots); }
    this.dotIds = sys.bodies.map((b) => b.id);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.dotIds.length * 3), 3));
    dg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.dotIds.length * 3), 3));
    dg.setAttribute("size", new THREE.BufferAttribute(new Float32Array(this.dotIds.length), 1));
    this.dots = new THREE.Points(dg, new THREE.ShaderMaterial({ vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.dots.frustumCulled = false;
    this.sky.add(this.dots);
    // The star's glare in its own colour: white-gold for the Sun, orange for a K dwarf, deep red for an M.
    const c = new THREE.Color(sys.body("sun")?.color ?? "#fff4d6");
    const mat = this.sunGlow.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.map = glowTexture([Math.round(160 + c.r * 95), Math.round(150 + c.g * 90), Math.round(130 + c.b * 80)]);
    mat.needsUpdate = true;
  }

  /** The ship: an original light scout — a long hull, swept wings, twin engines — built from primitives. */
  private buildShip(): void {
    const hull = new THREE.MeshLambertMaterial({ color: 0x70767e });
    const dark = new THREE.MeshLambertMaterial({ color: 0x33373d });
    const trim = new THREE.MeshLambertMaterial({ color: 0xd8742c });
    const glass = new THREE.MeshLambertMaterial({ color: 0x223a4a, emissive: 0x0a2438 });
    const L = 0.042; // km
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x * L, y * L, z * L);
      m.rotation.set(rx, ry, rz);
      this.shipGroup.add(m);
      return m;
    };
    // The nose points along +z.
    add(new THREE.CylinderGeometry(0.06 * L, 0.13 * L, 0.72 * L, 6), hull, 0, 0, 0.05, Math.PI / 2);
    add(new THREE.ConeGeometry(0.06 * L, 0.26 * L, 6), hull, 0, 0, 0.54, Math.PI / 2);
    add(new THREE.BoxGeometry(0.1 * L, 0.05 * L, 0.2 * L), glass, 0, 0.07, 0.28);
    add(new THREE.BoxGeometry(0.9 * L, 0.018 * L, 0.26 * L), hull, 0, -0.02, -0.12, 0, 0, 0).rotation.y = 0;
    add(new THREE.BoxGeometry(0.34 * L, 0.02 * L, 0.1 * L), trim, 0.3, -0.005, -0.04);
    add(new THREE.BoxGeometry(0.34 * L, 0.02 * L, 0.1 * L), trim, -0.3, -0.005, -0.04);
    add(new THREE.BoxGeometry(0.02 * L, 0.2 * L, 0.18 * L), dark, 0, 0.11, -0.22);
    for (const sx of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.055 * L, 0.065 * L, 0.36 * L, 8), dark, sx * 0.19, -0.04, -0.2, Math.PI / 2);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([120, 200, 255]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.position.set(sx * 0.19 * L, -0.04 * L, -0.4 * L);
      glow.scale.setScalar(0.16 * L);
      glow.name = "engine";
      this.shipGroup.add(glow);
    }
    // Re-entry: the air ahead of the ship squeezed hot enough to glow.
    this.plasma = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([255, 150, 70]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.plasma.visible = false;
    this.shipGroup.add(this.plasma);
    // The parachute: an orange-and-white dome on its lines, above the ship.
    const dome = new THREE.SphereGeometry(0.5 * L, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.canopy = new THREE.Mesh(dome, new THREE.MeshLambertMaterial({ color: 0xf08a3c, side: THREE.DoubleSide }));
    this.canopy.visible = false;
    this.shipGroup.add(this.canopy);
    // Dust drifting past the camera gives the ship's speed something to be measured against.
    const dn = 260;
    this.dustSeed = new Float32Array(dn * 3);
    const r = new Rng(31);
    for (let i = 0; i < dn * 3; i++) this.dustSeed[i] = r.next();
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dn * 3), 3));
    dg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(dn * 3).fill(0.35), 3));
    dg.setAttribute("size", new THREE.BufferAttribute(new Float32Array(dn).fill(1.6), 1));
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({ vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.dust.frustumCulled = false;
    this.passScene.add(this.dust);
    // Warp: streaks of light rushing past.
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(400 * 6), 3));
    this.streaks = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.passScene.add(this.streaks);
  }

  private detailTex: THREE.Texture | null = null;
  private detailTexture(): THREE.Texture | null {
    if (this.detailTex) return this.detailTex;
    const c = detailCanvas();
    if (!c) return null;
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    return (this.detailTex = t);
  }

  private viewOf(def: BodyDef): BodyView {
    const hit = this.views.get(def.id);
    if (hit) return hit;
    const group = new THREE.Group();
    group.visible = false;
    const view: BodyView = { def, group, globe: null, body: null, halo: null, ring: null, ringMesh: null, extent: def.radius };
    if (def.kind === "comet" || (def.kind === "interstellar" && def.activity)) this.buildComet(view);
    else if (def.kind === "probe") this.buildProbe(view);
    else {
      const sys = this.system!;
      const canvas = surfaceCanvas(sys.solar ? def.id : `${sys.id}/${def.id}`, def.look, def.color, def);
      const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
      if (tex) { tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4; }
      const clouds = def.id === "earth" ? cloudCanvas() : null;
      const ctex = clouds ? new THREE.CanvasTexture(clouds) : null;
      const lights = def.id === "earth" ? cityLightsCanvas() : null;
      const ltex = lights ? new THREE.CanvasTexture(lights) : null;
      if (ltex) ltex.colorSpace = THREE.NoColorSpace;
      // Enough facets that the limb stays round even from low orbit, where a polygon's edge would show against the air's glow.
      const segs = def.radius > 5000 ? 256 : def.radius > 1000 ? 160 : 64;
      const small = def.radius < 300 && def.kind !== "moon" ? true : def.radius < 150;
      const geo = small ? lumpy(def.id, def.radius) : new THREE.SphereGeometry(1, segs, segs / 2);
      const mat = new THREE.ShaderMaterial({
        vertexShader: BODY_VERT, fragmentShader: BODY_FRAG,
        uniforms: {
          map: { value: tex }, clouds: { value: ctex }, hasClouds: { value: ctex ? 1 : 0 }, cloudShift: { value: 0 }, lights: { value: ltex }, hasLights: { value: ltex ? 1 : 0 },
          detail: { value: ROCKY.has(def.look) || (def.look === "gen" && def.kind !== "star" && !!def.world?.surface && def.world.type !== "hothouse" && def.world.type !== "haze") ? this.detailTexture() : null }, detailStrength: { value: 0 },
          // Tiles about 60 km across whatever the world's size, the same number of times round as up and down.
          detailScale: { value: new THREE.Vector2(Math.max(2, Math.round((2 * Math.PI * def.radius) / 60)), Math.max(1, Math.round((Math.PI * def.radius) / 60))) },
          sunDir: { value: new THREE.Vector3(1, 0, 0) }, atmo: { value: new THREE.Color(def.atmosphere?.color ?? "#000000") },
          atmoStrength: { value: def.atmosphere ? Math.min(1.6, 0.5 + def.atmosphere.density * 0.5) : 0 }, emissive: { value: def.kind === "star" ? 1 : 0 },
        },
      });
      const globe = new THREE.Mesh(geo, mat);
      if (def.flattening) globe.scale.set(1, 1 - def.flattening, 1);
      group.add(globe);
      view.globe = globe;
      view.body = mat;
      if (def.atmosphere && def.kind !== "star") {
        const halo = new THREE.ShaderMaterial({
          vertexShader: BODY_VERT, fragmentShader: HALO_FRAG, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
          uniforms: { sunDir: { value: new THREE.Vector3() }, atmo: { value: new THREE.Color(def.atmosphere.color) }, strength: { value: Math.min(1.4, 0.6 + def.atmosphere.density * 0.5) }, center: { value: new THREE.Vector3() }, radius: { value: 1 } },
        });
        const shell = new THREE.Mesh(new THREE.SphereGeometry(1.05, 192, 96), halo);
        group.add(shell);
        view.halo = halo;
      }
      if (def.rings) {
        const ringMat = new THREE.ShaderMaterial({
          vertexShader: RING_VERT, fragmentShader: RING_FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false,
          uniforms: {
            bands: { value: ringTexture(def.rings.style) }, inner: { value: def.rings.inner / def.radius }, outer: { value: def.rings.outer / def.radius },
            sunDir: { value: new THREE.Vector3() }, normalW: { value: new THREE.Vector3() }, center: { value: new THREE.Vector3() }, radius: { value: 1 },
          },
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(def.rings.inner / def.radius, def.rings.outer / def.radius, 256, 1), ringMat);
        group.add(ring);
        view.ring = ringMat;
        view.ringMesh = ring;
        view.extent = def.rings.outer;
      }
    }
    this.passScene.add(group);
    this.views.set(def.id, view);
    return view;
  }

  private buildComet(view: BodyView): void {
    const nucleus = new THREE.Mesh(lumpy(view.def.id, 1), new THREE.MeshLambertMaterial({ color: 0x3c3834 }));
    nucleus.scale.setScalar(view.def.radius);
    view.group.add(nucleus);
    view.globe = nucleus;
    const coma = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([190, 225, 255]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    view.group.add(coma);
    // Tails in a unit frame: +x away from the Sun, the dust tail curving back toward −y (where the comet has been).
    const tail = (n: number, curve: number, spread: number, seed: number): THREE.BufferGeometry => {
      const r = new Rng(seed);
      const pos = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = Math.pow(r.next(), 1.6);
        const w = spread * (0.15 + t) * Math.sqrt(-2 * Math.log(1 - r.next() * 0.999));
        const a = r.next() * Math.PI * 2;
        pos.set([t, -curve * t * t + Math.cos(a) * w, Math.sin(a) * w], i * 3);
        size[i] = 0.012 + t * 0.035;
        alpha[i] = (1 - t) * (1 - t) * 0.16;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("size", new THREE.BufferAttribute(size, 1));
      g.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1));
      return g;
    };
    const mat = (color: [number, number, number]) => new THREE.ShaderMaterial({
      vertexShader: WORLD_POINTS_VERT, fragmentShader: WORLD_POINTS_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      uniforms: { color: { value: new THREE.Vector3(...color) }, scale: { value: 1 }, tint: { value: 1 } },
    });
    const ionMat = mat([0.45, 0.7, 1.0]), dustMat = mat([1.0, 0.93, 0.8]);
    const ion = new THREE.Points(tail(1400, 0, 0.012, 5), ionMat);
    const dust = new THREE.Points(tail(2400, 0.28, 0.05, 7), dustMat);
    ion.frustumCulled = dust.frustumCulled = false;
    view.group.add(ion, dust);
    view.comet = { coma, ion, dust, ionMat, dustMat };
  }

  private buildProbe(view: BodyView): void {
    const m = new THREE.MeshLambertMaterial({ color: 0xd8c070 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), m);
    const dish = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.3, 16, 1, true), new THREE.MeshLambertMaterial({ color: 0xeeeeee, side: THREE.DoubleSide }));
    dish.position.y = 0.35;
    const shield = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.02, 1.3), new THREE.MeshLambertMaterial({ color: 0xd8a0d8 }));
    shield.position.y = -0.3;
    g.add(body, dish, view.def.id === "jwst" ? shield : new THREE.Object3D());
    g.scale.setScalar(view.def.radius);
    view.group.add(g);
    view.globe = null;
  }

  // ---- a frame ---------------------------------------------------------------------------------------------------

  render(f: SpaceFrame): void {
    this.time += f.dt;
    const r = this.renderer;
    if (f.system !== this.system) this.setSystem(f.system);
    // In hyperspace there is nothing to see but the way through.
    if (f.jump?.phase === "tunnel") { this.drawHyperspace(f); return; }
    const cam = f.camera;
    const targetHelio = cam.target === "ship" ? f.shipHelio : f.positions.get(cam.target) ?? f.shipHelio;
    const cp = Math.cos(cam.pitch), off: Vec3 = [cp * Math.cos(cam.yaw) * cam.dist, cp * Math.sin(cam.yaw) * cam.dist, Math.sin(cam.pitch) * cam.dist];
    this.camHelio = [targetHelio[0] + off[0], targetHelio[1] + off[1], targetHelio[2] + off[2]];
    const look = toThree(scale(off, -1)).normalize();
    for (const c of [this.camera, this.skyCamera]) {
      c.position.set(0, 0, 0);
      c.up.set(0, 1, 0);
      c.lookAt(look);
      c.updateMatrixWorld();
    }
    const pxPerRad = this.height / 2 / Math.tan((FOV * DEG) / 2);

    // The sky.
    this.updateDots(f, pxPerRad);
    this.updateBelts(f);
    const sunRel = sub([0, 0, 0], this.camHelio);
    const sunD = len(sunRel);
    const sunAng = Math.atan((f.system.body("sun")?.radius ?? 695_700) / sunD);
    this.sunGlow.position.copy(toThree(norm(sunRel)).multiplyScalar(4));
    this.sunGlow.scale.setScalar(4 * Math.max(0.035, Math.min(1.2, sunAng * 14)));
    (this.sunGlow.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.55 + 0.45 * Math.min(1, (sunAng * 400)));
    this.placeHomeStar(f);
    r.setClearColor(0x000000, 1);
    r.clear();
    this.skyCamera.near = 0.1; this.skyCamera.far = 10; this.skyCamera.updateProjectionMatrix();
    r.render(this.sky, this.skyCamera);

    // The passes, far to near.
    type Pass = { d: number; run: () => void };
    const passes: Pass[] = [];
    for (const def of f.system.bodies) {
      const p = f.positions.get(def.id);
      if (!p) continue;
      const rel = sub(p, this.camHelio);
      const d = len(rel);
      const active = def.kind === "comet" || (def.kind === "interstellar" && def.activity) ? cometActivity(def, p) : 0;
      const tail = active > 0 ? tailLength(def, p) : 0;
      const extent = Math.max(def.radius * (def.rings ? def.rings.outer / def.radius : 1), tail, active > 0 ? comaSize(def, p) : 0);
      const px = (extent / Math.max(d, 1e-6)) * pxPerRad;
      if (px < (def.kind === "star" ? 2 : 1.5) && d > extent * 2) continue;
      passes.push({ d, run: () => this.drawBody(def, p, rel, d, f, active) });
    }
    if (cam.dist < 5e4 || cam.target === "ship") passes.push({ d: cam.target === "ship" ? cam.dist : len(sub(f.shipHelio, this.camHelio)), run: () => this.drawShip(f) });
    passes.sort((a, b) => b.d - a.d);
    for (const p of passes) { r.clearDepth(); p.run(); }
    for (const v of this.views.values()) v.group.visible = false;
    this.shipGroup.visible = false;
    this.dust.visible = false;
    this.streaks.visible = false;
    this.drawOverlay(f);
  }

  /**
   * From another star, the Sun as a star in its sky: where Sol lies from
   * here, as bright as its distance allows — its absolute magnitude is 4.83,
   * so from Alpha Centauri it shines at 0.5, as bright as our brightest stars,
   * and by a hundred light-years it is lost to the eye.
   */
  private placeHomeStar(f: SpaceFrame): void {
    if (f.system.solar) { this.homeStar.visible = false; return; }
    const here = f.system.star.pos;
    const g: Vec3 = [SUN_POS[0] - here[0], SUN_POS[1] - here[1], SUN_POS[2] - here[2]];
    const mag = apparentMagnitude(1, len(g));
    this.homeMag = mag;
    if (mag > 6.5) { this.homeStar.visible = false; return; }
    this.homeDir = eqToEcl(galacticToEquatorial(norm(g)));
    const s = Math.sqrt(Math.pow(10, -0.4 * (mag - 1.5)));
    this.homeStar.visible = true;
    this.homeStar.position.copy(toThree(this.homeDir).multiplyScalar(3.95));
    this.homeStar.scale.setScalar(0.012 + 0.022 * Math.min(1.6, s));
    (this.homeStar.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.3 + 0.8 * s);
  }
  private homeDir: Vec3 = [1, 0, 0];
  private homeMag = 99;

  /** Hyperspace: nothing to see but the way through — the stars stretched into a tunnel rushing past, toward a point of light ahead. */
  private drawHyperspace(f: SpaceFrame): void {
    this.renderer.setClearColor(0x02030a, 1);
    this.renderer.clear();
    this.brackets = [];
    const ctx = this.overlay;
    if (!ctx) return;
    const cw = ctx.canvas.width, ch = ctx.canvas.height, k = cw / this.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const w = this.width, h = this.height, cx = w / 2, cy = h / 2, R = Math.max(w, h) * 0.75;
    const prog = f.jump ? Math.min(1, f.jump.t / Math.max(0.1, f.jump.total)) : 0;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    glow.addColorStop(0, `rgba(225, 238, 255, ${0.35 + 0.6 * prog})`);
    glow.addColorStop(0.06, "rgba(110, 150, 255, 0.35)");
    glow.addColorStop(0.45, "rgba(60, 30, 140, 0.22)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    const seed = this.dustSeed;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 420; i++) {
      const a = seed[(i * 3) % seed.length] * Math.PI * 2;
      const phase = (seed[(i * 3 + 1) % seed.length] + this.time * (0.35 + seed[(i * 3 + 2) % seed.length] * 0.6)) % 1;
      const r0 = Math.pow(phase, 2.4) * R, r1 = r0 * (1.12 + 0.3 * phase) + 3;
      ctx.strokeStyle = `hsl(${215 + seed[(i * 7) % seed.length] * 60}, 90%, ${60 + phase * 30}%)`;
      ctx.globalAlpha = Math.min(1, phase * 1.6);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.fillStyle = "#e4f0ff";
    ctx.font = "16px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`HYPERSPACE — ${f.jump?.target ?? ""}`, cx, h * 0.16);
    ctx.fillStyle = "rgba(180, 210, 255, 0.8)";
    ctx.fillRect(cx - 120, h * 0.16 + 14, 240 * prog, 3);
    ctx.textAlign = "left";
  }

  /** Sets the camera's depth range and the object's scale for one pass: far things drawn nearer, and smaller, alike. */
  private placeFor(rel: Vec3, d: number, extent: number, radius = extent): number {
    const s = d > FAR ? FAR / d : 1;
    // Outside everything, the near plane sits just short of it; among a planet's rings, short of its surface — and never
    // so close to the camera that the depth buffer has nothing left for the far side.
    const near = d > extent * 1.05 ? (d - extent * 1.05) * s * 0.9 : Math.max(d * s * 1e-6, Math.min((d - radius) * 0.5, d * 0.01) * s);
    const far = (d + extent * 1.1) * s * 1.1 + 1e-4;
    this.camera.near = Math.min(near, far * 0.5);
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
    return s;
  }

  private drawBody(def: BodyDef, helio: Vec3, rel: Vec3, d: number, f: SpaceFrame, activity: number): void {
    const v = this.viewOf(def);
    const tail = activity > 0 ? tailLength(def, helio) : 0;
    const extent = Math.max(v.extent, tail, activity > 0 ? comaSize(def, helio) : 0);
    const s = this.placeFor(rel, d, extent, def.radius);
    const pos = toThree(scale(rel, s));
    v.group.position.copy(pos);
    const sunDir = toThree(norm(sub([0, 0, 0], helio)));
    if (def.kind === "star") sunDir.copy(pos).multiplyScalar(-1).normalize();
    // Orientation: the pole, and the turn about it (or, for a locked moon, its face toward its planet).
    const basis = this.orientation(def, helio, f);
    if (v.globe) {
      v.globe.quaternion.setFromRotationMatrix(basis);
      v.globe.scale.set(def.radius * s, def.radius * s * (1 - (def.flattening ?? 0)), def.radius * s);
      if (def.kind === "comet" || def.kind === "interstellar") v.globe.scale.setScalar(def.radius * s);
    }
    if (v.body) {
      v.body.uniforms.sunDir.value.copy(sunDir);
      // Surface detail comes in below an altitude of about a third of the world's radius.
      const alt = Math.max(0, d - def.radius);
      v.body.uniforms.detailStrength.value = v.body.uniforms.detail.value ? Math.max(0, Math.min(1, 1.3 - alt / (def.radius * 0.35))) * 0.45 : 0;
      if (def.id === "earth") v.body.uniforms.cloudShift.value = (this.time * 0.0004) % 1;
    }
    if (v.halo) {
      const shell = v.group.children[1] as THREE.Mesh;
      const k = 1 + Math.max(0.02, (def.atmosphere!.height / def.radius) * 2.5);
      shell.scale.setScalar(def.radius * s * k);
      v.halo.uniforms.sunDir.value.copy(sunDir);
      v.halo.uniforms.center.value.copy(pos);
      v.halo.uniforms.radius.value = def.radius * s;
    }
    if (v.ringMesh && v.ring) {
      // The rings lie in the equator: the globe's local x–z plane.
      const q = new THREE.Quaternion().setFromRotationMatrix(basis);
      v.ringMesh.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      v.ringMesh.scale.setScalar(def.radius * s);
      v.ring.uniforms.sunDir.value.copy(sunDir);
      v.ring.uniforms.normalW.value.set(0, 1, 0).applyQuaternion(q);
      v.ring.uniforms.center.value.copy(pos);
      v.ring.uniforms.radius.value = def.radius * s;
    }
    if (v.comet) {
      const c = v.comet, coma = comaSize(def, helio);
      c.coma.scale.setScalar(Math.max(coma * 2 * s, def.radius * 4 * s));
      (c.coma.material as THREE.SpriteMaterial).opacity = Math.min(1, activity * 1.2);
      // Point the tails away from the Sun, the dust one curving back along the orbit.
      const away = toThree(norm(helio));
      const vel = f.system.velocity(def.id, f.jd);
      const back = toThree(norm(scale(vel, -1)));
      const side = back.clone().sub(away.clone().multiplyScalar(back.dot(away))).normalize();
      const zAxis = new THREE.Vector3().crossVectors(away, side).normalize();
      const m = new THREE.Matrix4().makeBasis(away, side.clone().multiplyScalar(-1), zAxis);
      for (const [pts, mat, k] of [[c.ion, c.ionMat, 1], [c.dust, c.dustMat, 0.6]] as const) {
        pts.quaternion.setFromRotationMatrix(m);
        pts.scale.setScalar(tail * k * s);
        mat.uniforms.scale.value = (this.height / 2 / Math.tan((FOV * DEG) / 2)) * tail * k * s;
        mat.uniforms.tint.value = Math.min(1, activity);
      }
    }
    for (const other of this.views.values()) other.group.visible = other === v;
    this.shipGroup.visible = false;
    this.dust.visible = false;
    this.streaks.visible = false;
    this.renderer.render(this.passScene, this.camera);
  }

  /** A body's orientation: its equatorial frame turned by its spin, as a rotation matrix in three.js axes. */
  private orientation(def: BodyDef, helio: Vec3, f: SpaceFrame): THREE.Matrix4 {
    const sys = f.system;
    const frame = def.pole ? sys.frame(def.id) : def.parent && sys.body(def.parent)?.pole ? sys.frame(def.parent) : sys.frame(sys.solar ? "earth" : "sun");
    let w = 0;
    const d = f.jd - J2000;
    if (def.id === "earth") {
      // Greenwich, where apparent sidereal time puts it on the equator of date, found in the J2000 frame the globe
      // is drawn in — so the ground under a ship (session.ts) is the ground drawn under it.
      const g = gast(f.jd) * DEG;
      const greenwich = eqToEcl(fromDate([Math.cos(g), Math.sin(g), 0], f.jd));
      w = Math.atan2(dot(greenwich, frame.y), dot(greenwich, frame.x));
    }
    else if (def.locked && def.parent) {
      // The prime meridian faces the planet: find the angle of the planet's direction in the equatorial plane.
      const toParent = norm(sub(f.positions.get(def.parent) ?? [0, 0, 0], helio));
      w = Math.atan2(dot(toParent, frame.y), dot(toParent, frame.x));
    } else if (def.rotation) w = ((sys.solar ? W0[def.id] ?? 0 : 0) + (360 * 24 * d) / def.rotation) * DEG;
    const cx = Math.cos(w), sx = Math.sin(w);
    // The prime meridian's direction and 90° east of it, in the ecliptic frame.
    const xw: Vec3 = [frame.x[0] * cx + frame.y[0] * sx, frame.x[1] * cx + frame.y[1] * sx, frame.x[2] * cx + frame.y[2] * sx];
    const yw: Vec3 = cross(frame.z, xw);
    // Three's sphere: +x is longitude 0, +y the north pole, −z longitude 90° east.
    return new THREE.Matrix4().makeBasis(toThree(xw), toThree(frame.z), toThree(scale(yw, -1)));
  }

  private drawShip(f: SpaceFrame): void {
    const rel = sub(f.shipHelio, this.camHelio);
    const d = len(rel);
    const s = this.placeFor(rel, d, 0.06);
    if (f.camera.target === "ship") { this.camera.near = Math.max(1e-5, f.camera.dist * 0.02); this.camera.far = f.camera.dist * 4 + 2; this.camera.updateProjectionMatrix(); }
    this.shipGroup.position.copy(toThree(scale(rel, s)));
    this.shipGroup.scale.setScalar(s);
    const fwd = toThree(f.ship.heading).normalize();
    const up0 = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up0, fwd);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(fwd, right).normalize();
    this.shipGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
    const sunDir = toThree(norm(sub([0, 0, 0], f.shipHelio)));
    this.shipLight.position.copy(sunDir.clone().multiplyScalar(10));
    this.shipLight.target = this.shipGroup;
    // The fill comes from over the camera's shoulder.
    this.fillLight.position.set(0, 0.5, 0);
    this.fillLight.target = this.shipGroup;
    // The engines: under real physics they burn as hard as the throttle is open; in the arcade, as fast as the ship goes.
    const real = f.ship.physics === "newton";
    const speed = real ? f.ship.engine * 1.5 : len(f.ship.vel) / Math.max(1e-6, f.ship.cls.maxSpeed);
    const charge = f.jump?.phase === "spool" ? 1 + 4 * Math.min(1, f.jump.t / Math.max(0.1, f.jump.total)) : 1;
    for (const c of this.shipGroup.children) if (c.name === "engine") c.scale.setScalar(0.042 * ((real ? 0.03 : 0.08) + 0.14 * Math.min(1.5, speed)) * s * (f.ship.warp ? 3 : 1) * charge);
    this.plasma.visible = f.ship.heat > 0.02;
    if (this.plasma.visible) {
      // Round the nose, where the shock wave stands: the ship flies into it along its velocity through the air.
      this.plasma.scale.setScalar(0.042 * (1 + 3.2 * f.ship.heat));
      (this.plasma.material as THREE.SpriteMaterial).opacity = Math.min(1, f.ship.heat * 1.8);
      this.plasma.position.set(0, 0, 0.3 * 0.042);
    }
    this.canopy.visible = f.ship.chute > 0;
    if (this.canopy.visible) {
      const k = Math.max(0.05, f.ship.chute);
      this.canopy.scale.set(k * 2.2, k * 1.4, k * 2.2);
      this.canopy.position.set(0, 0.042 * 1.3, -0.042 * 0.2);
    }
    for (const v of this.views.values()) v.group.visible = false;
    this.shipGroup.visible = true;
    // Dust, in a box around the camera, streaming past at the ship's speed — the arcade's; in a real orbit there is
    // nothing out there to stream past, and 7.7 km/s of it would be a blizzard.
    if (!real && f.camera.target === "ship" && f.camera.dist < 5) {
      const box = Math.max(0.3, f.camera.dist * 3);
      const drift = scale(f.ship.vel, this.time);
      const arr = this.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < arr.count; i++) {
        const wrap = (u: number, o: number) => ((((u * box - o) % box) + box) % box) - box / 2;
        const p = toThree([wrap(this.dustSeed[i * 3], drift[0]), wrap(this.dustSeed[i * 3 + 1], drift[1]), wrap(this.dustSeed[i * 3 + 2], drift[2])]);
        arr.setXYZ(i, p.x, p.y, p.z);
      }
      arr.needsUpdate = true;
      this.dust.visible = true;
    }
    if (f.ship.warp) {
      const arr = this.streaks.geometry.getAttribute("position") as THREE.BufferAttribute;
      const dir = toThree(f.ship.warp.dir).normalize();
      const a = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
      if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
      a.normalize();
      const b = new THREE.Vector3().crossVectors(dir, a);
      const center = this.shipGroup.position;
      const reach = Math.max(0.3, f.camera.dist * 2);
      const pace = Math.min(1, f.ship.warp.speed / (f.ship.cls.warpSpeed * AU));
      for (let i = 0; i < arr.count / 2; i++) {
        const ang = this.dustSeed[i % this.dustSeed.length] * Math.PI * 2, rad = reach * (0.3 + this.dustSeed[(i * 7) % this.dustSeed.length]);
        const phase = ((this.dustSeed[(i * 3) % this.dustSeed.length] * 10 - this.time * (2 + pace * 30)) % 1 + 1) % 1;
        const along = (phase - 0.5) * reach * 4;
        const p = center.clone().addScaledVector(a, Math.cos(ang) * rad).addScaledVector(b, Math.sin(ang) * rad).addScaledVector(dir, along);
        const q = p.clone().addScaledVector(dir, -reach * (0.1 + pace * 1.2));
        arr.setXYZ(i * 2, p.x, p.y, p.z);
        arr.setXYZ(i * 2 + 1, q.x, q.y, q.z);
      }
      arr.needsUpdate = true;
      this.streaks.visible = true;
    }
    this.renderer.render(this.passScene, this.camera);
  }

  private updateDots(f: SpaceFrame, pxPerRad: number): void {
    const pos = this.dots.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.dots.geometry.getAttribute("color") as THREE.BufferAttribute;
    const size = this.dots.geometry.getAttribute("size") as THREE.BufferAttribute;
    const pr = this.renderer.getPixelRatio?.() ?? 1;
    const lum = f.system.solar ? 1 : Math.max(1e-6, f.system.star.lum);
    this.dotIds.forEach((id, i) => {
      const def = f.system.body(id), p = f.positions.get(id);
      if (!p || def.kind === "star") { size.setX(i, 0); return; }
      const rel = sub(p, this.camHelio), d = len(rel);
      const t = toThree(norm(rel)).multiplyScalar(3.9);
      pos.setXYZ(i, t.x, t.y, t.z);
      // Reflected sunlight: size squared, over the square of both distances.
      const rs = Math.max(0.05, len(p) / AU);
      const albedo = def.kind === "planet" ? 0.45 : def.kind === "comet" ? 0.3 : 0.2;
      const flux = (lum * albedo * def.radius * def.radius) / (rs * rs * d * d);
      const b = Math.sqrt(flux / 2e-10);
      const listed = f.listed.has(id) || f.selected === id;
      const disc = (def.radius / d) * pxPerRad;
      const s = disc > 1.5 ? 0 : Math.max(listed ? 1.6 : 0, (1.2 + 2.4 * Math.min(1.5, b)) * Math.min(1, b * 6));
      size.setX(i, s * pr);
      const c = new THREE.Color(def.color);
      const a = Math.min(1, 0.25 + b);
      col.setXYZ(i, c.r * a, c.g * a, c.b * a);
    });
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
  }

  private updateBelts(f: SpaceFrame): void {
    // Their places move slowly: worked out again when the date has moved a little, not every frame.
    const recompute = !(Math.abs(f.jd - this.beltJd) < 0.5);
    if (recompute) this.beltJd = f.jd;
    const pr = this.renderer.getPixelRatio?.() ?? 1;
    f.system.belts.forEach((b, k) => {
      const { points, pos } = this.belts[k];
      if (recompute) beltPositions(b, f.jd, pos);
      const pa = points.geometry.getAttribute("position") as THREE.BufferAttribute;
      const ca = points.geometry.getAttribute("color") as THREE.BufferAttribute;
      const sa = points.geometry.getAttribute("size") as THREE.BufferAttribute;
      for (let i = 0; i < b.count; i++) {
        const x = pos[i * 3] - this.camHelio[0], y = pos[i * 3 + 1] - this.camHelio[1], z = pos[i * 3 + 2] - this.camHelio[2];
        const d = Math.hypot(x, y, z) || 1;
        pa.setXYZ(i, (x / d) * 3.8, (z / d) * 3.8, (-y / d) * 3.8);
        // Faint unless near: a belt is mostly empty space.
        const near = Math.min(1, (0.4 * AU) / d);
        const a = 0.12 + near * 0.5;
        ca.setXYZ(i, b.color[0] * a, b.color[1] * a, b.color[2] * a);
        sa.setX(i, (1 + near * 1.5) * pr);
      }
      pa.needsUpdate = ca.needsUpdate = sa.needsUpdate = true;
    });
  }

  // ---- the 2D layer -----------------------------------------------------------------------------------------------

  /** Where a heliocentric point lands on the screen (CSS pixels), or null behind the camera. */
  project(helio: Vec3): [number, number] | null {
    const rel = sub(helio, this.camHelio);
    const v = toThree(rel);
    v.applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > -1e-9) return null;
    const f = this.height / 2 / Math.tan((FOV * DEG) / 2);
    return [this.width / 2 + (v.x / -v.z) * f, this.height / 2 - (v.y / -v.z) * f];
  }

  private orbitPoints(id: string, jd: number): { around: string; points: Vec3[] } | null {
    const hit = this.orbitCache.get(id);
    const def = this.system!.body(id)!;
    // Planets' orbits barely change; a moon's is drawn around its planet, wherever that is now.
    const stale = !hit || Math.abs(hit.jd - jd) > (def.kind === "moon" ? 5 : 200);
    if (!stale) return hit!;
    const path = this.system!.orbitPath(id, jd, def.kind === "comet" || def.kind === "interstellar" ? 720 : 360);
    if (!path) return null;
    const entry = { jd, ...path };
    this.orbitCache.set(id, entry);
    return entry;
  }

  private drawOverlay(f: SpaceFrame): void {
    const ctx = this.overlay;
    this.brackets = [];
    if (!ctx) return;
    const cw = ctx.canvas.width, ch = ctx.canvas.height, k = cw / this.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineWidth = 1;
    // Orbits.
    for (const def of f.system.bodies) {
      const show = f.orbits.has(def.kind) || f.selected === def.id;
      if (!show) continue;
      const p = f.positions.get(def.id);
      if (!p) continue;
      if (def.kind === "moon") {
        // A moon's orbit only near its planet: from a planet away it would be a scribble on top of it.
        const parent = f.positions.get(def.parent!);
        if (!parent || len(sub(parent, this.camHelio)) > (f.system.body(def.parent!)?.radius ?? 2500) * 400 && f.selected !== def.id) continue;
      }
      const path = this.orbitPoints(def.id, f.jd);
      if (!path) continue;
      const origin = f.positions.get(path.around) ?? [0, 0, 0];
      ctx.strokeStyle = kindColor(def.kind);
      // Close to a world, the orbits of everything else are lines through the middle of the view: faded right down.
      const zoomed = Math.max(0.08, Math.min(1, Math.log10(Math.max(1, f.camera.dist) / 2e4) / 3));
      ctx.globalAlpha = (f.selected === def.id ? 0.85 : def.kind === "planet" ? 0.32 : 0.22) * (def.kind === "moon" ? Math.max(0.35, zoomed) : zoomed);
      ctx.beginPath();
      let pen = false;
      for (const q of path.points) {
        const s = this.project([origin[0] + q[0], origin[1] + q[1], origin[2] + q[2]]);
        if (!s || Math.abs(s[0]) > 1e5 || Math.abs(s[1]) > 1e5) { pen = false; continue; }
        if (pen) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]);
        pen = true;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Brackets and names.
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "middle";
    const pxPerRad = this.height / 2 / Math.tan((FOV * DEG) / 2);
    for (const def of f.system.bodies) {
      const p = f.positions.get(def.id);
      if (!p) continue;
      const sel = f.selected === def.id, hov = f.hovered === def.id;
      if (!sel && !hov && !f.listed.has(def.id)) continue;
      const s = this.project(p);
      if (!s || s[0] < -40 || s[1] < -40 || s[0] > this.width + 40 || s[1] > this.height + 40) continue;
      const d = len(sub(p, this.camHelio));
      const disc = Math.max(0, (def.radius / d) * pxPerRad);
      const r = Math.max(6, Math.min(disc + 4, 80));
      const color = kindColor(def.kind);
      ctx.strokeStyle = color;
      ctx.globalAlpha = sel ? 1 : hov ? 0.95 : 0.6;
      icon(ctx, def.kind, s[0], s[1], disc > 20 ? 0 : 5);
      if (sel) {
        // Corner brackets round the selection, as EVE draws them.
        const q = r + 4, e = Math.min(10, q * 0.6);
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.moveTo(s[0] + sx * q, s[1] + sy * (q - e)); ctx.lineTo(s[0] + sx * q, s[1] + sy * q); ctx.lineTo(s[0] + sx * (q - e), s[1] + sy * q);
        }
        ctx.stroke();
      }
      const named = sel || hov || def.kind === "planet" || def.kind === "star" || (def.kind === "moon" && disc > 0.3) || disc > 4;
      if (named) {
        ctx.fillStyle = color;
        ctx.fillText(`${def.name}  ${distanceText(Math.max(0, d - def.radius))}`, s[0] + Math.max(9, disc > 20 ? 0 : 9), s[1] + (disc > 20 ? -r - 8 : 0));
      }
      this.brackets.push({ id: def.id, x: s[0], y: s[1], r: Math.max(9, Math.min(disc, 60)) });
    }
    // The path ahead under real physics: round the body the ship is near, with its highest and lowest points marked,
    // and where it comes down into the air if it does.
    if (f.path) {
      const origin = f.positions.get(f.path.frame);
      if (origin) {
        const at = (q: Vec3) => this.project([origin[0] + q[0], origin[1] + q[1], origin[2] + q[2]]);
        ctx.strokeStyle = "#6fe8ff";
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let pen = false;
        for (const q of f.path.points) {
          const p = at(q);
          if (!p || Math.abs(p[0]) > 1e5 || Math.abs(p[1]) > 1e5) { pen = false; continue; }
          if (pen) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
          pen = true;
        }
        ctx.stroke();
        ctx.lineWidth = 1;
        const mark = (q: Vec3 | null, label: string, color: string) => {
          if (!q) return;
          const p = at(q);
          if (!p || p[0] < 0 || p[1] < 0 || p[0] > this.width || p[1] > this.height) return;
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillText(label, p[0] + 7, p[1] - 8);
        };
        const km = (n: number) => `${Math.round(n).toLocaleString("en")} km`;
        // A near-circle has no highest or lowest point worth marking: the marks would sit wherever rounding put them.
        if (Math.abs(f.path.apAlt - f.path.peAlt) > 2) {
          mark(f.path.ap, `Ap ${km(f.path.apAlt)}`, "#9fe8ff");
          mark(f.path.pe, `Pe ${km(f.path.peAlt)}`, "#9fe8ff");
        }
        if (f.path.hits) mark(f.path.points[f.path.points.length - 1] ?? null, f.path.air ? "Into the air" : "Impact", "#ff8a5a");
        ctx.globalAlpha = 1;
      }
    }
    // The jump drive charging: a ring of light swelling round the ship, and how far along it is.
    if (f.jump?.phase === "spool") {
      const prog = Math.min(1, f.jump.t / Math.max(0.1, f.jump.total));
      const s = this.project(f.shipHelio);
      if (s) {
        ctx.strokeStyle = "#8fc8ff";
        ctx.globalAlpha = 0.35 + 0.5 * prog;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(s[0], s[1], 18 + prog * 60 + k * 9 + Math.sin(this.time * 6 + k) * 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#cfe8ff";
      ctx.textAlign = "center";
      ctx.fillText(`JUMP DRIVE — ${f.jump.target} — ${Math.round(prog * 100)}%`, this.width / 2, this.height * 0.2);
      ctx.fillRect(this.width / 2 - 110, this.height * 0.2 + 12, 220 * prog, 3);
      ctx.textAlign = "left";
    }
    // Home, a star among the others in another system's sky.
    if (this.homeStar.visible) {
      const s = this.project(scale(this.homeDir, 1e15));
      if (s) { ctx.fillStyle = "#ffe8a0"; ctx.globalAlpha = 0.8; ctx.fillText(`Sol (home) · magnitude ${this.homeMag.toFixed(1)}`, s[0] + 10, s[1]); ctx.globalAlpha = 1; }
    }
    // The ship, when the camera is off looking at something else.
    if (f.camera.target !== "ship" || f.camera.dist > 50) {
      const s = this.project(f.shipHelio);
      if (s) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#7dff9a";
        ctx.beginPath(); ctx.moveTo(s[0], s[1] - 7); ctx.lineTo(s[0] + 6, s[1] + 5); ctx.lineTo(s[0] - 6, s[1] + 5); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = "#7dff9a";
        ctx.fillText("You", s[0] + 10, s[1]);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** The body under a screen point (CSS pixels), if a bracket is there. */
  pick(x: number, y: number): string | null {
    let best: string | null = null, bestD = Infinity;
    for (const b of this.brackets) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d <= Math.max(12, b.r) && d < bestD) { best = b.id; bestD = d; }
    }
    return best;
  }

  /** The heliocentric direction (ecliptic) under a screen point: where a double-click means "fly that way". */
  directionAt(x: number, y: number): Vec3 {
    const v = new THREE.Vector3((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1, 0.5).unproject(this.camera).normalize();
    return [v.x, -v.z, v.y];
  }

  dispose(): void {
    const all: THREE.Object3D[] = [this.sky, this.passScene];
    for (const root of all) root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const u of Object.values((mat as THREE.ShaderMaterial).uniforms ?? {})) (u.value as THREE.Texture)?.dispose?.();
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    });
    this.views.clear();
  }
}

/** Worlds with solid ground worth detailing up close. */
const ROCKY = new Set(["moon", "mercury", "mars", "io", "europa", "ganymede", "callisto", "enceladus", "iapetus", "mimas", "triton", "pluto", "charon", "rock", "ice", "ceres", "vesta"]);

/** The IAU prime meridians at J2000 (degrees), where known: where the spin starts from. */
const W0: Record<string, number> = { sun: 84.176, mercury: 329.5988, venus: 160.2, mars: 176.049, jupiter: 284.95, saturn: 38.9, uranus: 203.81, neptune: 249.978, pluto: 302.695, ceres: 170.65 };

/** Frees what a group of meshes, points and sprites holds on the graphics card. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const u of Object.values((mat as THREE.ShaderMaterial).uniforms ?? {})) if ((u.value as THREE.Texture)?.isTexture) (u.value as THREE.Texture).dispose();
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

/** A small body's shape: a sphere pushed in and out, the way asteroids and nuclei are lumpy. */
function lumpy(id: string, radius: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const n = new Simplex(id.length * 17 + id.charCodeAt(0));
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const stretch = 1 + (id.length % 3) * 0.25;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + n.fbm3(x * 1.6, y * 1.6, z * 1.6, 3) * 0.35;
    p.setXYZ(i, x * k * stretch, y * k, z * k);
  }
  g.computeVertexNormals();
  // Spheres' texture coordinates, so the painted surface still wraps.
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z) || 1;
    uv[i * 2] = 0.5 + Math.atan2(-z, x) / (2 * Math.PI);
    uv[i * 2 + 1] = 0.5 + Math.asin(y / l) / Math.PI;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  void radius;
  return g;
}

/** A soft round glow, for sprites. */
function glowTexture(rgb: [number, number, number]): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, `rgba(${rgb.join(",")},1)`);
  g.addColorStop(0.12, `rgba(${rgb.join(",")},0.65)`);
  g.addColorStop(0.35, `rgba(${rgb.join(",")},0.16)`);
  g.addColorStop(1, `rgba(${rgb.join(",")},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * Ring brightness by radius, as a strip. Saturn's: the dim C ring, the bright
 * B ring, the Cassini Division, the A ring with the Encke Gap, and the thin F
 * ring beyond; Uranus's and Neptune's: a few narrow dark rings.
 */
function ringTexture(style: "saturn" | "uranus" | "neptune" | "jupiter"): THREE.Texture {
  const W = 1024;
  const c = document.createElement("canvas");
  c.width = W; c.height = 1;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, 1);
  const n = new Simplex(style.length * 13);
  for (let x = 0; x < W; x++) {
    const t = x / (W - 1);
    let a = 0, rgb: [number, number, number] = [220, 205, 175];
    if (style === "saturn") {
      const km = 66_900 + t * (140_220 - 66_900);
      if (km < 74_510) a = 0.03;
      else if (km < 92_000) { a = 0.18 + (n.noise2(km / 800, 1) + 1) * 0.06; rgb = [170, 160, 146]; }
      else if (km < 117_580) a = 0.72 + (n.noise2(km / 600, 3) + 1) * 0.12;
      else if (km < 122_170) a = 0.05;
      else if (km < 136_775) a = Math.abs(km - 133_590) < 160 ? 0.04 : 0.5 + (n.noise2(km / 900, 5) + 1) * 0.08;
      else if (Math.abs(km - 140_180) < 250) a = 0.55;
      rgb = a > 0.6 ? [238, 224, 196] : rgb;
    } else if (style === "uranus") {
      a = [0.12, 0.3, 0.5, 0.62, 0.72, 0.8, 0.9, 0.995].some((r) => Math.abs(t - r) < 0.006) ? 0.5 : 0;
      rgb = [150, 150, 150];
    } else if (style === "neptune") {
      a = [0.02, 0.45, 0.62, 0.99].some((r) => Math.abs(t - r) < 0.008) ? 0.28 : 0.02;
      rgb = [150, 140, 130];
    } else { a = 0.04 + (1 - t) * 0.05; rgb = [190, 160, 140]; }
    img.data[x * 4] = rgb[0]; img.data[x * 4 + 1] = rgb[1]; img.data[x * 4 + 2] = rgb[2]; img.data[x * 4 + 3] = Math.round(Math.min(1, a) * 255);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** EVE-style overview icons: a circle for a world, a diamond for a rock, a triangle for a comet, a square for a craft. */
function icon(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, r: number): void {
  if (r <= 0) return;
  ctx.beginPath();
  switch (kind) {
    case "asteroid": ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); break;
    case "comet": case "interstellar": ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath(); break;
    case "probe": ctx.rect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5); break;
    case "moon": ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); break;
    default: ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.stroke();
}

