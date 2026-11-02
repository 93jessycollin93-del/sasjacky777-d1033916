/**
 * The galaxy map, drawn: the whole Milky Way as a cloud of light — the old
 * yellow bar, the blue arms with their pink nebulae and dark dust lanes, the
 * globular clusters round it — and, round the point the map looks at, the
 * generated stars themselves, each as bright as it would look from the
 * camera, coloured by its temperature.
 *
 * Distances run from half a parsec to ninety thousand, so nothing is drawn
 * where it is: everything is drawn relative to the point looked at (the
 * stars relative to the point they were made round), so float precision is
 * spent where the eye is.
 *
 * Coordinates are the galaxy's own (galaxy.ts), in parsecs, with z up.
 */
import * as THREE from "three";
import { ARMS, galaxyCloud, LANDMARK_POS, LY_PER_PC, PITCH, SGR_A, SOL, SUN_POS, tempColor, type Star } from "./galaxy";
import type { GalaxyMap } from "./galaxyMap";
import type { Vec3 } from "./kepler";

const FOV = 55;

const CLOUD_VERT = /* glsl */ `
attribute vec3 color; attribute float size;
uniform float uScale; uniform float uFade;
varying vec3 vColor; varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float depth = max(-mv.z, 1e-3);
  float px = size * uScale / depth;
  gl_PointSize = clamp(px, 1.0, 72.0);
  // Smaller than a pixel, a cloud keeps its light by dimming rather than vanishing; right up close it fades out
  // rather than filling the screen.
  vA = uFade * min(1.0, px) * smoothstep(size * 0.5, size * 3.0, depth);
  vColor = color;
  gl_Position = projectionMatrix * mv;
}`;

const CLOUD_FRAG = /* glsl */ `
uniform float uGain;
varying vec3 vColor; varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  // Falls to nothing at the point's edge, so overlapping points never show their square corners.
  float a = exp(-r2 * 10.0) * (1.0 - smoothstep(0.16, 0.25, r2)) * vA;
  gl_FragColor = vec4(vColor * a * uGain, 1.0);
}`;

const DUST_FRAG = /* glsl */ `
varying vec3 vColor; varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  float a = exp(-r2 * 8.0) * (1.0 - smoothstep(0.16, 0.25, r2)) * vA;
  gl_FragColor = vec4(vColor, a * 0.55);
}`;

/** A star's size and brightness from how much of its light reaches the camera: log(L / d²). */
const STAR_VERT = /* glsl */ `
attribute vec3 color; attribute float lum; attribute float reach;
uniform float uPixel; uniform float uLimit; uniform float uFade; uniform float uEyeDist;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 0.05);
  float m = log(lum) / 2.302585 - 2.0 * log(d) / 2.302585;
  float s = clamp(2.2 + 1.5 * (m - uLimit), 1.6, 16.0);
  // Stars well below the limit go out entirely rather than sitting at a floor:
  // fifty thousand faint points at a floor add up to a white ball.
  float a = clamp(0.3 + 0.22 * (m - uLimit + 1.0), 0.14, 1.0) * smoothstep(uLimit - 3.5, uLimit - 1.0, m);
  gl_PointSize = s * uPixel;
  // Each kind is charted only so far round the centre (its reach), so seen from
  // outside that sphere it would stand out as a ball the real sky has no
  // trace of: each kind thins out toward its rim, and fades away as the camera
  // leaves its sphere, leaving the kinds charted further out, and the cloud.
  float rim = reach > 0.0 ? (1.0 - smoothstep(0.7, 1.0, length(position) / reach)) * (1.0 - smoothstep(reach * 0.9, reach * 2.5, uEyeDist)) : 1.0;
  vColor = color * a * uFade * rim;
  gl_Position = projectionMatrix * mv;
}`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  float a = exp(-r * 3.2) + 0.35 * exp(-r * 0.8);
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

export class GalaxyView {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 200000);
  private cloud: THREE.Points;
  private cloudMat: THREE.ShaderMaterial;
  private dust: THREE.Points;
  private dustMat: THREE.ShaderMaterial;
  private grid: THREE.LineSegments;
  private stars: THREE.Points | null = null;
  private starMat: THREE.ShaderMaterial;
  private starVersion = -1;
  /** The stars drawn, and the point they were drawn relative to. */
  private drawn: Star[] = [];
  private drawnCenter: Vec3 = [0, 0, 0];
  private overlay: CanvasRenderingContext2D | null = null;
  private width = 1;
  private height = 1;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.camera.up.set(0, 0, 1);
    // The galaxy as a whole.
    const pts = galaxyCloud();
    const bright = pts.filter((p) => !p.dark), dark = pts.filter((p) => p.dark);
    const cloudGeo = (list: typeof pts) => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3), size = new Float32Array(list.length);
      list.forEach((p, i) => { pos.set(p.pos, i * 3); col.set(p.color, i * 3); size[i] = p.size; });
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setAttribute("size", new THREE.BufferAttribute(size, 1));
      return g;
    };
    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, uniforms: { uScale: { value: 1 }, uFade: { value: 1 }, uGain: { value: 0.3 } },
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true,
    });
    this.cloud = new THREE.Points(cloudGeo(bright), this.cloudMat);
    this.cloud.frustumCulled = false;
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT, fragmentShader: DUST_FRAG, uniforms: { uScale: { value: 1 }, uFade: { value: 1 } },
      blending: THREE.NormalBlending, depthWrite: false, depthTest: false, transparent: true,
    });
    this.dust = new THREE.Points(cloudGeo(dark), this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 1;
    // Rings in the plane every 2 kpc out to 16, and spokes every 30°: something to judge the galaxy's size by.
    const lines: number[] = [];
    for (let R = 2000; R <= 16000; R += 2000) for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2, b = ((i + 1) / 128) * Math.PI * 2;
      lines.push(R * Math.cos(a), R * Math.sin(a), 0, R * Math.cos(b), R * Math.sin(b), 0);
    }
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; lines.push(2000 * Math.cos(a), 2000 * Math.sin(a), 0, 16000 * Math.cos(a), 16000 * Math.sin(a), 0); }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lines), 3));
    this.grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x3a5a78, transparent: true, opacity: 0.25, depthWrite: false, depthTest: false }));
    this.grid.frustumCulled = false;
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: { uPixel: { value: 1 }, uLimit: { value: -3 } },
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true,
    });
    this.starMat.uniforms.uFade = { value: 1 };
    this.starMat.uniforms.uEyeDist = { value: 0 };
    this.scene.add(this.grid, this.cloud, this.dust);
  }

  setOverlay(canvas: HTMLCanvasElement | null): void {
    this.overlay = canvas?.getContext("2d") ?? null;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  private rebuildStars(map: GalaxyMap): void {
    if (this.stars) { this.scene.remove(this.stars); this.stars.geometry.dispose(); }
    const list = map.stars, c = map.fieldCenter;
    const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3), lum = new Float32Array(list.length), reach = new Float32Array(list.length);
    list.forEach((s, i) => {
      pos[i * 3] = s.pos[0] - c[0]; pos[i * 3 + 1] = s.pos[1] - c[1]; pos[i * 3 + 2] = s.pos[2] - c[2];
      col.set(tempColor(s.temp), i * 3);
      lum[i] = Math.max(1e-6, s.lum);
      reach[i] = s.real ? 0 : map.reach[s.cls] ?? 0;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("lum", new THREE.BufferAttribute(lum, 1));
    g.setAttribute("reach", new THREE.BufferAttribute(reach, 1));
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 2;
    this.scene.add(this.stars);
    this.drawn = list;
    this.drawnCenter = [...c] as Vec3;
    this.starVersion = map.version;
  }

  /** Where a galactic point lands on the screen (CSS pixels), relative to the map's focus; null behind the camera. */
  private project(p: Vec3, focus: Vec3): [number, number] | null {
    const v = new THREE.Vector3(p[0] - focus[0], p[1] - focus[1], p[2] - focus[2]).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return [((v.x + 1) / 2) * this.width, ((1 - v.y) / 2) * this.height];
  }

  render(map: GalaxyMap): void {
    if (map.version !== this.starVersion) this.rebuildStars(map);
    const cam = map.camera, f = cam.focus;
    // The camera orbits the focus, which is the origin of what is drawn.
    const cp = Math.cos(cam.pitch);
    this.camera.position.set(cam.dist * cp * Math.cos(cam.yaw), cam.dist * cp * Math.sin(cam.yaw), cam.dist * Math.sin(cam.pitch));
    this.camera.lookAt(0, 0, 0);
    this.camera.near = Math.max(0.005, cam.dist * 0.002);
    this.camera.far = cam.dist * 60 + 120000;
    this.camera.updateProjectionMatrix();
    for (const o of [this.cloud, this.dust, this.grid]) o.position.set(-f[0], -f[1], -f[2]);
    if (this.stars) this.stars.position.set(this.drawnCenter[0] - f[0], this.drawnCenter[1] - f[1], this.drawnCenter[2] - f[2]);
    const pr = this.renderer.getPixelRatio?.() ?? 1;
    const scale = (this.height * pr) / 2 / Math.tan((FOV * Math.PI) / 360);
    // The galaxy's cloud stands in for its stars at a distance and gives way to them close up.
    const far = Math.max(0, Math.min(1, Math.log10(cam.dist / 150) / 1.2));
    this.cloudMat.uniforms.uScale.value = scale;
    this.cloudMat.uniforms.uFade.value = 0.12 + 0.88 * far;
    // Close in, the bulge's clouds pile up by the thousand: keep them from burning to white.
    this.cloudMat.uniforms.uGain.value = 0.07 + 0.3 * Math.max(0, Math.min(1, Math.log10(cam.dist / 2500) / 1.1));
    this.dustMat.uniforms.uScale.value = scale;
    this.dustMat.uniforms.uFade.value = far;
    (this.grid.material as THREE.LineBasicMaterial).opacity = 0.28 * Math.max(0, Math.min(1, Math.log10(cam.dist / 1500)));
    this.starMat.uniforms.uPixel.value = pr;
    // Pulled back past a few thousand light-years, the cloud stands for the stars and the charted ones fade away.
    this.starMat.uniforms.uFade.value = Math.max(0, Math.min(1, 1 - Math.log10(cam.dist / 700)));
    const eye = map.eye();
    this.starMat.uniforms.uEyeDist.value = Math.hypot(eye[0] - this.drawnCenter[0], eye[1] - this.drawnCenter[1], eye[2] - this.drawnCenter[2]);
    // Pulled far out, only the brightest of the local stars stand out; close in, the red dwarfs show.
    this.starMat.uniforms.uLimit.value = -3 - Math.max(0, Math.log10(cam.dist / 30)) * 1.2;
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x010207, 1);
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = autoClear;
    this.drawOverlay(map);
  }

  private drawOverlay(map: GalaxyMap): void {
    const ctx = this.overlay;
    if (!ctx) return;
    const cw = ctx.canvas.width, ch = ctx.canvas.height, k = cw / this.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "middle";
    const cam = map.camera, f = cam.focus;
    // Labels are placed in order of importance and a name that would land on
    // one already placed is left off (its mark still drawn): near Sol, forty
    // neighbours in a few hundred pixels otherwise print over one another.
    const placed: [number, number, number, number][] = [];
    const free = (x: number, y: number, w: number, h: number) => !placed.some((b) => x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]);
    const label = (p: Vec3, text: string, color: string, mark: "ring" | "dot" | "cross" | "none" = "dot", r = 5) => {
      const s = this.project(p, f);
      if (!s || s[0] < -50 || s[1] < -50 || s[0] > this.width + 50 || s[1] > this.height + 50) return;
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.beginPath();
      if (mark === "ring") ctx.arc(s[0], s[1], r, 0, Math.PI * 2);
      if (mark === "dot") ctx.arc(s[0], s[1], 2, 0, Math.PI * 2);
      if (mark === "cross") { ctx.moveTo(s[0] - r, s[1]); ctx.lineTo(s[0] + r, s[1]); ctx.moveTo(s[0], s[1] - r); ctx.lineTo(s[0], s[1] + r); }
      if (mark === "dot") ctx.fill(); else if (mark !== "none") ctx.stroke();
      if (!text) return;
      const x = s[0] + r + 4, w = ctx.measureText(text).width;
      if (!free(x - 2, s[1] - 8, w + 4, 16)) return;
      placed.push([x - 2, s[1] - 8, w + 4, 16]);
      // A dark outline under the name keeps it readable over the bright parts of the field.
      ctx.save(); ctx.strokeStyle = "rgba(1, 2, 7, 0.85)"; ctx.lineWidth = 3; ctx.lineJoin = "round";
      ctx.strokeText(text, x, s[1]); ctx.restore();
      ctx.fillText(text, x, s[1]);
    };
    const d = cam.dist;
    // The selection's name goes first, so nothing covers the thing being looked at.
    const sel = map.selected;
    const selAt = sel ? this.project(sel.pos, f) : null;
    if (sel && selAt) placed.push([selAt[0] + 14, selAt[1] - 20, ctx.measureText(sel.name).width + 4, 16], [selAt[0] - 12, selAt[1] - 12, 24, 24]);
    // Where the ship is, when it is not at home.
    if (map.here !== SOL) label(map.here.pos, "You are here", "#7dff9a", "ring", 9);
    // Sol, always: the way home.
    label(SUN_POS, d > 400 ? "Sol" : "", "#ffe27a", "ring", d > 400 ? 6 : 8);
    // The black hole, always: the other way to find your bearings.
    label(SGR_A.pos, "Sagittarius A*", "#ffcf7a", "cross", 6);
    // The galaxy's parts, pulled out far enough to see them.
    if (d > 2500) {
      ctx.globalAlpha = Math.min(1, (d - 2500) / 3000);
      // Each arm named on its own quarter of a ring 11.5 kpc out, where the
      // arms are clear of each other and of the bar: an arm crosses that ring
      // where ln R = ln r + tan(pitch)(θ − π).
      for (const arm of ARMS) {
        const R = 11.5, th = Math.PI + Math.log(R / arm.r) / Math.tan(PITCH);
        label([R * 1000 * Math.cos(th), R * 1000 * Math.sin(th), 0], arm.name, "#8fb8e8", "none");
      }
      ctx.globalAlpha = 1;
    }
    // Landmarks and the named stars, when near enough to tell apart.
    for (const m of LANDMARK_POS) {
      if (d < 60 && Math.hypot(m.pos[0] - f[0], m.pos[1] - f[1], m.pos[2] - f[2]) > d * 20) continue;
      label(m.pos, m.name, m.kind === "black hole" ? "#ff9a6a" : m.kind === "nebula" ? "#ff8ab8" : m.kind === "remnant" ? "#c8a0ff" : "#ffe6a8", m.kind === "black hole" ? "cross" : "ring", 4);
    }
    if (d < 1500) {
      const eye = map.eye();
      // Brightest as seen from the camera first: those are the ones the eye goes to.
      const named = this.drawn.filter((st) => {
        if (!st.real || st === SOL) return false;
        const far = Math.hypot(st.pos[0] - f[0], st.pos[1] - f[1], st.pos[2] - f[2]);
        // Named once they could stand out at this zoom: the neighbours up close, the giants from further out.
        return far <= d * 3 || st.lum >= 1000;
      }).map((st) => ({ st, seen: st.lum / Math.max(1e-6, (st.pos[0] - eye[0]) ** 2 + (st.pos[1] - eye[1]) ** 2 + (st.pos[2] - eye[2]) ** 2) }))
        .sort((a, b) => b.seen - a.seen);
      for (const { st } of named) label(st.pos, st.name, "#cfe6ff", "none");
    }
    // The selection, with its distance from Sol.
    if (sel && selAt) {
      const s = selAt;
      {
        ctx.strokeStyle = "#7dff9a";
        const q = 11, e = 5;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.moveTo(s[0] + sx * q, s[1] + sy * (q - e)); ctx.lineTo(s[0] + sx * q, s[1] + sy * q); ctx.lineTo(s[0] + sx * (q - e), s[1] + sy * q);
        }
        ctx.stroke();
        ctx.fillStyle = "#7dff9a";
        ctx.fillText(sel.name, s[0] + 16, s[1] - 12);
        // A dashed line from where the ship is: the jump it would make.
        const sun = this.project(map.here.pos, f);
        if (sun && sel !== map.here) {
          ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(sun[0], sun[1]); ctx.lineTo(s[0], s[1]); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
      }
    }
    // A scale bar at the focus's distance.
    const pxPerPc = this.height / 2 / Math.tan((FOV * Math.PI) / 360) / d;
    const target = 140 / pxPerPc * LY_PER_PC;
    const nice = [1, 2, 5].flatMap((m) => [1, 10, 100, 1000, 10000, 100000].map((p) => m * p)).sort((a, b) => a - b);
    const lyLen = nice.reduce((best, v) => (Math.abs(Math.log(v / target)) < Math.abs(Math.log(best / target)) ? v : best), 1);
    const px = (lyLen / LY_PER_PC) * pxPerPc;
    ctx.strokeStyle = "#9fc4e0"; ctx.fillStyle = "#9fc4e0";
    const x0 = 24, y0 = this.height - 28;
    ctx.beginPath(); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 5); ctx.stroke();
    ctx.fillText(`${lyLen.toLocaleString("en")} light-year${lyLen === 1 ? "" : "s"}`, x0, y0 - 14);
    if (map.busy) { ctx.fillStyle = "#8fa6b8"; ctx.fillText("Charting the stars round here…", x0, y0 - 32); }
  }

  /** The star under a screen point (CSS pixels), preferring the bright ones when several are close. */
  pick(map: GalaxyMap, x: number, y: number): Star | null {
    const f = map.camera.focus;
    let best: Star | null = null, bestScore = Infinity;
    const eye = map.eye();
    for (const st of this.drawn) {
      const s = this.project(st.pos, f);
      if (!s) continue;
      const dpx = Math.hypot(s[0] - x, s[1] - y);
      if (dpx > 14) continue;
      const dist = Math.max(0.05, Math.hypot(st.pos[0] - eye[0], st.pos[1] - eye[1], st.pos[2] - eye[2]));
      const bright = Math.log10(Math.max(1e-6, st.lum)) - 2 * Math.log10(dist);
      const score = dpx - bright * 2.5 - (st.real ? 6 : 0);
      if (score < bestScore) { bestScore = score; best = st; }
    }
    return best;
  }

  dispose(): void {
    for (const o of [this.cloud, this.dust, this.grid, this.stars]) {
      if (!o) continue;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }
}
