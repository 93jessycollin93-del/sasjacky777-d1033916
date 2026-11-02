/**
 * The real sky over the world, drawn from space/sky.ts: the stars and the
 * Milky Way turning about the celestial pole, the Moon lit from the Sun's side
 * (so its phase is what it is tonight, and its terminator leans the way it
 * really leans), the Sun with the Moon crossing it — the corona coming out at
 * totality — the Moon going red in the Earth's shadow, the planets as the
 * bright wanderers they are, a comet's tail when there is one, and meteors
 * streaking out of a shower's radiant.
 *
 * Everything sits on a sphere round the camera in the backdrop scene, drawn
 * before the world so the ground hides whatever has set. Positions come in the
 * world's axes (x east, y up, z south); the stars are laid out once in the
 * equatorial frame and turned by the sky's matrix each frame.
 *
 * The Sun and Moon are drawn larger than life (space/sky.ts DISC_SCALE): at
 * their real half a degree they would be a few pixels on most screens.
 */
import * as THREE from "three";
import type { SkyObjects } from "../space/sky";
import { bvColor, starField } from "../space/starField";
import { milkyWayCanvas, surfaceCanvas } from "../space/textures";
import { BODY } from "../space/bodies";
import type { Vec3 } from "../space/kepler";
import type { SkyState } from "./sky";

const R = 42;

/** Points on the sky by magnitude: fainter toward the horizon (more air to see through), twinkling there too. */
const POINTS_VERT = /* glsl */ `
attribute float size; attribute vec3 color; attribute float mag;
uniform float uLimit; uniform float uScale; uniform float uTime;
varying vec3 vColor;
void main() {
  vec3 dir = normalize(mat3(modelMatrix) * position);
  float alt = dir.y;
  float airmass = 1.0 / max(alt + 0.03, 0.06);
  float m = mag + min(0.22 * (airmass - 1.0), 4.0);
  float vis = clamp((uLimit - m) / 1.2, 0.0, 1.0) * smoothstep(-0.01, 0.04, alt);
  float flux = pow(10.0, -0.4 * (m - 1.0));
  float seed = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float twinkle = 1.0 + 0.45 * sin(uTime * (6.0 + seed * 10.0) + seed * 40.0) * (1.0 - smoothstep(0.08, 0.5, alt));
  vColor = color * vis * min(1.8, 0.35 + 0.95 * sqrt(flux)) * twinkle;
  gl_PointSize = uScale * size * (1.8 + 2.4 * min(2.0, sqrt(flux)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const POINTS_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 9.0);
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

const MW_VERT = /* glsl */ `
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** The Milky Way map is laid out in right ascension and declination; the sky's matrix turns a direction back to them. */
const MW_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform mat3 uToEq; uniform float uBright;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 eq = uToEq * d;
  float ra = atan(eq.y, eq.x);
  if (ra < 0.0) ra += 6.2831853;
  float dec = asin(clamp(eq.z, -1.0, 1.0));
  vec3 c = texture2D(uMap, vec2(ra / 6.2831853, 0.5 + dec / 3.1415927)).rgb;
  gl_FragColor = vec4(c * uBright * smoothstep(0.0, 0.3, d.y), 1.0);
}`;

const DISC_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/**
 * The Sun, out to four of its radii: the photosphere darkening toward its limb, a close glow, and wherever the
 * Moon's disc is, nothing. At totality the corona's streamers and the pink rim of the chromosphere come out round it.
 */
const SUN_FRAG = /* glsl */ `
uniform vec2 uMoon; uniform float uMoonR; uniform float uTotal; uniform vec3 uColor; uniform float uBright;
varying vec2 vUv; varying vec3 vWorld;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * 4.0;
  float r = length(p);
  float horizon = smoothstep(-0.003, 0.003, normalize(vWorld).y);
  float dm = length(p - uMoon);
  float open = smoothstep(uMoonR - 0.012, uMoonR + 0.012, dm);
  float disc = 1.0 - smoothstep(0.98, 1.0, r);
  float mu = sqrt(max(0.0, 1.0 - r * r));
  vec3 photo = uColor * disc * (0.45 + 0.55 * mu) * open * 2.2;
  float glow = exp(-max(r - 1.0, 0.0) * 2.2) * 0.3 * (1.0 - disc) * open * (1.0 - uTotal);
  float ang = atan(p.y, p.x);
  float streamers = 0.55 + 0.45 * sin(ang * 4.0 + 1.3) * sin(ang * 7.0 - 0.4);
  float corona = uTotal * open * pow(max(dm / max(uMoonR, 0.5), 1.0), -3.0) * streamers * 0.9 * (1.0 - smoothstep(2.4, 3.9, r));
  float rim = uTotal * exp(-abs(dm - uMoonR) * 60.0) * (1.0 - smoothstep(1.0, 1.06, r)) * 0.8;
  vec3 c = photo + uColor * glow + vec3(0.92, 0.94, 1.0) * corona + vec3(1.0, 0.35, 0.5) * rim;
  gl_FragColor = vec4(c * horizon * uBright, 1.0);
}`;

/**
 * The Moon: its map (space/textures.ts) turned so its north is where its pole really points tonight, lit from the
 * Sun's direction, with the Earth's shadow on it during a lunar eclipse — grey through the penumbra, dark red in the
 * umbra. By day it is pale, half the sky's blue showing through its lit part and all of it through the rest; by
 * night it hides the stars behind it, and its unlit part shows faintly in earthshine.
 */
const MOON_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform vec3 uSun; uniform float uNorth; uniform vec4 uShadow; uniform float uNight; uniform vec3 uColor; uniform float uBright; uniform float uGlow;
varying vec2 vUv; varying vec3 vWorld;
void main() {
  // The quad reaches three Moon radii: beyond the disc, the glow of moonlight in the air round it.
  vec2 p = (vUv * 2.0 - 1.0) * 3.0;
  float r2 = dot(p, p);
  float horizon = smoothstep(-0.004, 0.004, normalize(vWorld).y);
  if (r2 > 1.0) {
    float halo = exp(-(sqrt(r2) - 1.0) * 2.2) * uGlow;
    gl_FragColor = vec4(vec3(0.55, 0.6, 0.72) * halo * uColor * horizon, 0.0);
    return;
  }
  float edge = 1.0 - smoothstep(0.96, 1.0, r2);
  vec3 n = vec3(p, sqrt(1.0 - r2));
  vec2 north = vec2(sin(uNorth), cos(uNorth));
  vec2 q = vec2(dot(p, vec2(north.y, -north.x)), dot(p, north));
  float lon = atan(q.x, n.z), lat = asin(clamp(q.y, -1.0, 1.0));
  vec3 albedo = texture2D(uMap, vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5)).rgb;
  float lit = smoothstep(-0.03, 0.06, dot(n, uSun));
  float ds = length(p - uShadow.xy);
  float umbra = 1.0 - smoothstep(uShadow.z - 0.06, uShadow.z + 0.06, ds);
  float penumbra = 1.0 - smoothstep(uShadow.z, uShadow.w, ds);
  vec3 c = albedo * lit * (1.0 - 0.55 * penumbra) * 1.7;
  c = mix(c, albedo * vec3(0.55, 0.13, 0.05) * 0.5, umbra);
  c += albedo * 0.05 * uNight * (1.0 - lit);
  // By day the lit part half-covers the blue rather than piling on top of it, which would burn it to cyan-white.
  gl_FragColor = vec4(c * uColor * uBright * horizon * edge, max(uNight, lit * 0.6) * horizon * edge);
}`;

const TAIL_VERT = /* glsl */ `
attribute float alpha; varying float vA;
void main() {
  vec3 dir = normalize(position);
  vA = alpha * smoothstep(-0.01, 0.05, dir.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const TAIL_FRAG = /* glsl */ `
uniform vec3 uColor; varying float vA;
void main() { gl_FragColor = vec4(uColor * vA, 1.0); }`;

const TAIL_STEPS = 24;
const METEORS = 32;

interface Meteor { p: Vec3; t: Vec3; speed: number; len: number; life: number; age: number; bright: number; tint: [number, number, number] }

const v3 = (v: Vec3) => new THREE.Vector3(v[0], v[1], v[2]);
const nrm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dotv = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class RealSky {
  readonly group = new THREE.Group();
  private milky: THREE.Mesh;
  private milkyMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private starMat: THREE.ShaderMaterial;
  private wanderers: THREE.Points;
  private wanderMat: THREE.ShaderMaterial;
  private sun: THREE.Mesh;
  private sunMat: THREE.ShaderMaterial;
  private moon: THREE.Mesh;
  private moonMat: THREE.ShaderMaterial;
  private tails: THREE.Mesh[] = [];
  private meteorMesh: THREE.Mesh;
  private meteors: Meteor[] = [];
  private spawnDebt = 0;
  private lastTime = -1;

  constructor() {
    // The Milky Way.
    const mwCanvas = milkyWayCanvas();
    const mwTex = mwCanvas ? new THREE.CanvasTexture(mwCanvas) : null;
    if (mwTex) {
      mwTex.wrapS = THREE.RepeatWrapping;
      mwTex.colorSpace = THREE.NoColorSpace;
      // No mipmaps: where right ascension wraps from 24h to 0h the shader's texture coordinate jumps, and a mipmapped
      // lookup would take that jump for a great distance and draw a line down the sky.
      mwTex.generateMipmaps = false;
      mwTex.minFilter = THREE.LinearFilter;
    }
    this.milkyMat = new THREE.ShaderMaterial({
      vertexShader: MW_VERT, fragmentShader: MW_FRAG, uniforms: { uMap: { value: mwTex }, uToEq: { value: new THREE.Matrix3() }, uBright: { value: 0 } },
      side: THREE.BackSide, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, transparent: true,
    });
    this.milky = new THREE.Mesh(new THREE.SphereGeometry(R + 2, 48, 24), this.milkyMat);
    this.milky.renderOrder = -98;
    this.milky.frustumCulled = false;
    this.milky.visible = !!mwTex;

    // The stars, laid out in the equatorial frame (x at 0h, z at the north celestial pole).
    const field = starField();
    const pos = new Float32Array(field.count * 3), colr = new Float32Array(field.count * 3), mag = new Float32Array(field.count), size = new Float32Array(field.count);
    for (let i = 0; i < field.count; i++) {
      const ra = (field.ra[i] * Math.PI) / 180, dec = (field.dec[i] * Math.PI) / 180;
      pos.set([Math.cos(dec) * Math.cos(ra) * R, Math.cos(dec) * Math.sin(ra) * R, Math.sin(dec) * R], i * 3);
      colr.set(bvColor(field.bv[i]), i * 3);
      mag[i] = field.mag[i];
      size[i] = 1;
    }
    this.starMat = pointsMaterial();
    this.stars = new THREE.Points(pointsGeometry(pos, colr, mag, size), this.starMat);
    this.stars.renderOrder = -95;
    this.stars.frustumCulled = false;
    this.stars.matrixAutoUpdate = false;

    // The planets and the comets' heads, placed afresh each frame.
    const n = 7 + 3;
    this.wanderMat = pointsMaterial();
    this.wanderers = new THREE.Points(pointsGeometry(new Float32Array(n * 3), new Float32Array(n * 3), new Float32Array(n).fill(99), new Float32Array(n).fill(1.25)), this.wanderMat);
    this.wanderers.renderOrder = -94;
    this.wanderers.frustumCulled = false;

    // The comets' tails.
    for (let k = 0; k < 3; k++) {
      const g = new THREE.BufferGeometry();
      // Three vertices across (edge, middle, edge), so the tail fades out sideways instead of stopping at a hard edge.
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((TAIL_STEPS + 1) * 3 * 3), 3));
      g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array((TAIL_STEPS + 1) * 3), 1));
      const idx: number[] = [];
      for (let i = 0; i < TAIL_STEPS; i++) {
        const a = i * 3, b = a + 3;
        idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
      }
      g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
        vertexShader: TAIL_VERT, fragmentShader: TAIL_FRAG, uniforms: { uColor: { value: new THREE.Color(0.75, 0.85, 1) } },
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, side: THREE.DoubleSide,
      }));
      m.renderOrder = -93;
      m.frustumCulled = false;
      m.visible = false;
      this.tails.push(m);
    }

    // Meteors: short-lived streaks, each a thin quad bright and wide at its head and fading to a point behind.
    // (WebGL draws lines a single pixel wide whatever is asked, which on a sharp screen is no meteor at all.)
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(METEORS * 4 * 3), 3));
    mg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(METEORS * 4 * 3), 3));
    const mi: number[] = [];
    for (let i = 0; i < METEORS; i++) mi.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    mg.setIndex(mi);
    this.meteorMesh = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false, side: THREE.DoubleSide }));
    this.meteorMesh.renderOrder = -92;
    this.meteorMesh.frustumCulled = false;

    // The Sun and the Moon.
    this.sunMat = new THREE.ShaderMaterial({
      vertexShader: DISC_VERT, fragmentShader: SUN_FRAG,
      uniforms: { uMoon: { value: new THREE.Vector2(99, 99) }, uMoonR: { value: 1 }, uTotal: { value: 0 }, uColor: { value: new THREE.Color() }, uBright: { value: 1 } },
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true,
    });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.sunMat);
    this.sun.renderOrder = -90;
    this.sun.frustumCulled = false;
    const moonCanvas = surfaceCanvas("moon", BODY.moon.look ?? "moon", BODY.moon.color ?? "#b8b5ae");
    const moonTex = moonCanvas ? new THREE.CanvasTexture(moonCanvas) : null;
    if (moonTex) { moonTex.wrapS = THREE.RepeatWrapping; moonTex.colorSpace = THREE.NoColorSpace; }
    this.moonMat = new THREE.ShaderMaterial({
      vertexShader: DISC_VERT, fragmentShader: MOON_FRAG,
      uniforms: {
        uMap: { value: moonTex }, uSun: { value: new THREE.Vector3() }, uNorth: { value: 0 }, uShadow: { value: new THREE.Vector4(99, 99, 1, 1) },
        uNight: { value: 0 }, uColor: { value: new THREE.Color() }, uBright: { value: 1 }, uGlow: { value: 0 },
      },
      // Premultiplied: the colour is added, and the alpha says how much of what is behind (the stars) it hides.
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      depthWrite: false, depthTest: false, transparent: true,
    });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.moonMat);
    this.moon.renderOrder = -89;
    this.moon.frustumCulled = false;

    this.group.add(this.milky, this.stars, this.wanderers, ...this.tails, this.meteorMesh, this.sun, this.moon);
  }

  update(camera: THREE.Camera, state: SkyState, sky: SkyObjects, seconds: number, pixelRatio: number): void {
    const cam = camera.position;
    const dt = this.lastTime < 0 ? 0 : Math.max(0, Math.min(0.1, seconds - this.lastTime));
    this.lastTime = seconds;
    const m = sky.toLocal;

    // How faint a star can be and still be seen: 6.5 on a dark night, less under the Moon, none but the planets at dusk.
    // With the Sun up — even eclipsed — only the brightest few come through the daylit air.
    const limit = Math.min(-1.5 + 8 * state.stars - 2.2 * state.moonlight, sky.sun[1] > 0 ? 2 : 99);
    for (const mat of [this.starMat, this.wanderMat]) {
      mat.uniforms.uLimit.value = limit;
      mat.uniforms.uScale.value = pixelRatio;
      mat.uniforms.uTime.value = seconds;
    }
    this.stars.matrix.set(m[0], m[1], m[2], cam.x, m[3], m[4], m[5], cam.y, m[6], m[7], m[8], cam.z, 0, 0, 0, 1);
    this.stars.matrixWorldNeedsUpdate = true;
    this.milky.position.copy(cam);
    this.milkyMat.uniforms.uToEq.value.set(m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]);
    // The Milky Way wants true dark: the Sun well down (astronomical twilight over) and no bright Moon.
    const dusk = Math.max(0, Math.min(1, (-0.1 - sky.sun[1]) / 0.15));
    this.milkyMat.uniforms.uBright.value = 0.5 * Math.max(0, state.stars * 1.3 - 0.3) * (1 - state.moonlight * 0.8) * dusk;

    // The planets, then the comets' heads.
    this.wanderers.position.copy(cam);
    const g = this.wanderers.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute, colr = g.getAttribute("color") as THREE.BufferAttribute, mag = g.getAttribute("mag") as THREE.BufferAttribute;
    let k = 0;
    for (const p of sky.planets) {
      if (k >= 7) break;
      pos.setXYZ(k, p.dir[0] * (R - 1), p.dir[1] * (R - 1), p.dir[2] * (R - 1));
      const c = new THREE.Color(p.color);
      colr.setXYZ(k, c.r, c.g, c.b);
      mag.setX(k, p.mag);
      k++;
    }
    for (; k < 7; k++) mag.setX(k, 99);
    for (let i = 0; i < 3; i++) {
      const c = sky.comets[i], tail = this.tails[i];
      if (!c) { mag.setX(7 + i, 99); tail.visible = false; continue; }
      pos.setXYZ(7 + i, c.dir[0] * (R - 1), c.dir[1] * (R - 1), c.dir[2] * (R - 1));
      colr.setXYZ(7 + i, 0.75, 0.95, 0.9);
      mag.setX(7 + i, c.mag);
      this.drawTail(tail, c.dir, c.tail, c.tailDeg, c.mag, limit, cam);
    }
    pos.needsUpdate = true; colr.needsUpdate = true; mag.needsUpdate = true;

    // The Sun, reddened and dimmed by the air it shines through low down.
    const up = sky.sun[1];
    const redden = new THREE.Color(1, 0.42, 0.14).lerp(new THREE.Color(1, 0.96, 0.9), Math.max(0, Math.min(1, (up + 0.02) / 0.22)));
    const sunDist = R - 2;
    this.sun.position.copy(cam).addScaledVector(v3(sky.sun), sunDist);
    this.sun.lookAt(cam);
    this.sun.scale.setScalar(Math.tan(sky.sunRadius) * sunDist * 4);
    this.sun.updateMatrixWorld();
    const X = new THREE.Vector3().setFromMatrixColumn(this.sun.matrixWorld, 0).normalize();
    const Y = new THREE.Vector3().setFromMatrixColumn(this.sun.matrixWorld, 1).normalize();
    const moonDrawn = v3(sky.moonDrawn), sunDir = v3(sky.sun);
    const rel = moonDrawn.clone().sub(sunDir);
    this.sunMat.uniforms.uMoon.value.set(rel.dot(X) / sky.sunRadius, rel.dot(Y) / sky.sunRadius);
    this.sunMat.uniforms.uMoonR.value = sky.moonRadius / sky.sunRadius;
    this.sunMat.uniforms.uTotal.value = Math.max(0, Math.min(1, (sky.eclipse - 0.995) / 0.005));
    this.sunMat.uniforms.uColor.value.copy(redden);
    this.sunMat.uniforms.uBright.value = 1 - state.rain * 0.85;

    // The Moon.
    const moonDist = R - 3;
    this.moon.position.copy(cam).addScaledVector(moonDrawn, moonDist);
    this.moon.lookAt(cam);
    this.moon.scale.setScalar(Math.tan(sky.moonRadius) * moonDist * 3);
    this.moon.updateMatrixWorld();
    const MX = new THREE.Vector3().setFromMatrixColumn(this.moon.matrixWorld, 0).normalize();
    const MY = new THREE.Vector3().setFromMatrixColumn(this.moon.matrixWorld, 1).normalize();
    const MZ = new THREE.Vector3().setFromMatrixColumn(this.moon.matrixWorld, 2).normalize();
    // Lit from the real Sun, seen from the real Moon: the drawn nudge near the Sun must not change its phase.
    this.moonMat.uniforms.uSun.value.set(sunDir.dot(MX), sunDir.dot(MY), sunDir.dot(MZ)).normalize();
    const pole = v3(sky.moonPole);
    this.moonMat.uniforms.uNorth.value = Math.atan2(pole.dot(MX), pole.dot(MY));
    this.moonMat.uniforms.uGlow.value = 0.35 * sky.moonLit * sky.moonLit * Math.max(0, Math.min(1, state.stars * 1.5)) * (1 - sky.umbra * 0.9) * (1 - state.rain);
    const sd = v3(sky.shadow.dir);
    const sl = Math.hypot(sd.dot(MX), sd.dot(MY)) || 1;
    this.moonMat.uniforms.uShadow.value.set((sd.dot(MX) / sl) * sky.shadow.offset, (sd.dot(MY) / sl) * sky.shadow.offset, sky.shadow.umbra, sky.shadow.penumbra);
    this.moonMat.uniforms.uNight.value = Math.max(0, Math.min(1, state.stars * 1.2));
    const moonUp = sky.moon[1];
    this.moonMat.uniforms.uColor.value.copy(new THREE.Color(1, 0.55, 0.3).lerp(new THREE.Color(1, 0.98, 0.94), Math.max(0, Math.min(1, (moonUp + 0.02) / 0.2))));
    // By day the Moon is only as bright as the sky round it lets it look.
    this.moonMat.uniforms.uBright.value = (0.45 + 0.55 * Math.max(0, Math.min(1, state.stars * 1.5))) * (1 - state.rain * 0.9);

    this.updateMeteors(sky, state, dt, cam);
  }

  /** A comet's tail: a fan from the head, widening and fading along the way the Sun pushes it. */
  private drawTail(mesh: THREE.Mesh, head: Vec3, along: Vec3, deg: number, mag: number, limit: number, cam: THREE.Vector3): void {
    const vis = Math.max(0, Math.min(1, (limit - mag) / 2)) * 0.55;
    mesh.visible = vis > 0.01 && deg > 0.05;
    if (!mesh.visible) return;
    mesh.position.copy(cam);
    const g = mesh.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute, alpha = g.getAttribute("alpha") as THREE.BufferAttribute;
    const P = head, T = along;
    const Nv = nrm([P[1] * T[2] - P[2] * T[1], P[2] * T[0] - P[0] * T[2], P[0] * T[1] - P[1] * T[0]]);
    const L = (deg * Math.PI) / 180;
    for (let i = 0; i <= TAIL_STEPS; i++) {
      const t = i / TAIL_STEPS, a = L * t;
      const c = nrm([P[0] * Math.cos(a) + T[0] * Math.sin(a), P[1] * Math.cos(a) + T[1] * Math.sin(a), P[2] * Math.cos(a) + T[2] * Math.sin(a)]);
      const w = L * (0.05 + 0.2 * t) + 0.006;
      for (const [j, sgn] of [[0, -1], [1, 0], [2, 1]] as const) {
        const q = nrm([c[0] + Nv[0] * w * sgn, c[1] + Nv[1] * w * sgn, c[2] + Nv[2] * w * sgn]);
        pos.setXYZ(i * 3 + j, q[0] * (R - 1.5), q[1] * (R - 1.5), q[2] * (R - 1.5));
        alpha.setX(i * 3 + j, sgn === 0 ? vis * Math.pow(1 - t, 1.6) * (0.4 + 0.6 * (1 - t)) * 1.6 : 0);
      }
    }
    pos.needsUpdate = true; alpha.needsUpdate = true;
  }

  /**
   * Meteors at the rate the sky gives: each shower's (its radiant's height counted in), and the sporadic few that
   * belong to none. The sky runs 72 times faster than the clock, so an hour of shower passes in fifty seconds;
   * the meteors themselves streak at their own real speed, which is what makes them look like meteors.
   */
  private updateMeteors(sky: SkyObjects, state: SkyState, dt: number, cam: THREE.Vector3): void {
    const dark = Math.max(0, state.stars - 0.3) / 0.7;
    const showers = sky.showers.filter((s) => s.rate > 0);
    const total = showers.reduce((a, s) => a + s.rate, 0) + 8;
    this.spawnDebt += total * (72 / 3600) * 0.5 * dark * dt;
    while (this.spawnDebt >= 1) {
      this.spawnDebt -= 1;
      if (this.meteors.length < METEORS) this.spawnMeteor(showers, total);
    }
    const g = this.meteorMesh.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute, colr = g.getAttribute("color") as THREE.BufferAttribute;
    this.meteors = this.meteors.filter((m) => (m.age += dt) < m.life);
    const r = R - 2.5, w = 0.0022 * r;
    for (let i = 0; i < METEORS; i++) {
      const m = this.meteors[i];
      if (!m) { for (let k = 0; k < 4; k++) colr.setXYZ(i * 4 + k, 0, 0, 0); continue; }
      const s = m.speed * m.age, tailS = Math.max(0, s - m.len);
      const head = nrm([m.p[0] + m.t[0] * s, m.p[1] + m.t[1] * s, m.p[2] + m.t[2] * s]);
      const tail = nrm([m.p[0] + m.t[0] * tailS, m.p[1] + m.t[1] * tailS, m.p[2] + m.t[2] * tailS]);
      // Across the streak: square to both the line of sight and the way it is going.
      const side = nrm([head[1] * m.t[2] - head[2] * m.t[1], head[2] * m.t[0] - head[0] * m.t[2], head[0] * m.t[1] - head[1] * m.t[0]]);
      const b = Math.sin((Math.PI * m.age) / m.life) * m.bright * (0.3 + 0.7 * dark);
      const hw = w * (0.6 + m.bright * 0.5), tw = hw * 0.15;
      pos.setXYZ(i * 4, head[0] * r + side[0] * hw, head[1] * r + side[1] * hw, head[2] * r + side[2] * hw);
      pos.setXYZ(i * 4 + 1, head[0] * r - side[0] * hw, head[1] * r - side[1] * hw, head[2] * r - side[2] * hw);
      pos.setXYZ(i * 4 + 2, tail[0] * r + side[0] * tw, tail[1] * r + side[1] * tw, tail[2] * r + side[2] * tw);
      pos.setXYZ(i * 4 + 3, tail[0] * r - side[0] * tw, tail[1] * r - side[1] * tw, tail[2] * r - side[2] * tw);
      colr.setXYZ(i * 4, m.tint[0] * b, m.tint[1] * b, m.tint[2] * b);
      colr.setXYZ(i * 4 + 1, m.tint[0] * b, m.tint[1] * b, m.tint[2] * b);
      colr.setXYZ(i * 4 + 2, 0, 0, 0);
      colr.setXYZ(i * 4 + 3, 0, 0, 0);
    }
    pos.needsUpdate = true; colr.needsUpdate = true;
    this.meteorMesh.position.copy(cam);
  }

  private spawnMeteor(showers: SkyObjects["showers"], total: number): void {
    let pick = Math.random() * total;
    const shower = showers.find((s) => (pick -= s.rate) < 0) ?? null;
    for (let tries = 0; tries < 6; tries++) {
      const alt = (10 + Math.random() * 70) * (Math.PI / 180), az = Math.random() * Math.PI * 2;
      const p: Vec3 = [Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)];
      let t: Vec3;
      if (shower) {
        // A shower's meteors all run away from its radiant, and none start right on it: they would be coming at us.
        const r = shower.radiant, d = dotv(p, r);
        if (d > 0.995 || d < 0.2) continue;
        t = nrm([-r[0] + p[0] * d, -r[1] + p[1] * d, -r[2] + p[2] * d]);
      } else {
        const a = Math.random() * Math.PI * 2;
        const e = nrm([p[2], 0, -p[0]]), n = nrm([p[1] * e[2] - p[2] * e[1], p[2] * e[0] - p[0] * e[2], p[0] * e[1] - p[1] * e[0]]);
        t = nrm([e[0] * Math.cos(a) + n[0] * Math.sin(a), e[1] * Math.cos(a) + n[1] * Math.sin(a), e[2] * Math.cos(a) + n[2] * Math.sin(a)]);
      }
      const fast = shower?.name === "Leonids" || shower?.name === "Perseids" || shower?.name === "Orionids" || shower?.name === "Eta Aquariids";
      this.meteors.push({
        p, t, age: 0, speed: (fast ? 0.9 : 0.55) + Math.random() * 0.4, len: 0.06 + Math.random() * 0.12, life: 0.35 + Math.random() * 0.5,
        bright: 0.5 + Math.random() * Math.random() * 1.6, tint: fast ? [0.85, 1, 0.9] : [1, 0.95, 0.85],
      });
      return;
    }
  }
}

function pointsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG,
    uniforms: { uLimit: { value: 6.5 }, uScale: { value: 1 }, uTime: { value: 0 } },
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true,
  });
}

function pointsGeometry(pos: Float32Array, color: Float32Array, mag: Float32Array, size: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(color, 3));
  g.setAttribute("mag", new THREE.BufferAttribute(mag, 1));
  g.setAttribute("size", new THREE.BufferAttribute(size, 1));
  return g;
}
