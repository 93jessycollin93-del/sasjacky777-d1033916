/**
 * The galaxy map's state: where it is looking, how far out, what is
 * selected, and the stars made round the point it looks at.
 *
 * Making the stars round a new point takes the better part of half a second
 * (some fifty thousand of them, from two hundred thousand cubes), so it is
 * done a kind at a time, one kind a frame, while the map keeps turning; the
 * stars of the old point stay up until the new ones are all made.
 */
import { CLASSES, classNear, distance, LANDMARK_POS, LY_PER_PC, realNear, regionAt, SGR_A, SOL, SUN_POS, REAL_STARS, type Star, type StarClass } from "./galaxy";
import type { Vec3 } from "./kepler";

export interface GalaxyCamera {
  /** The point looked at (galactocentric pc), the camera's bearing round it, and its distance (pc). */
  focus: Vec3;
  yaw: number;
  pitch: number;
  dist: number;
}

/** How far the map can pull out (pc): the whole disk and its halo of clusters in view. */
export const MAX_DIST = 90_000;
export const MIN_DIST = 0.4;

export interface MapHit { kind: "star"; star: Star }

export class GalaxyMap {
  camera: GalaxyCamera = { focus: [...SUN_POS] as Vec3, yaw: Math.PI * 0.8, pitch: 0.55, dist: 40 };
  selected: Star | null = SOL;
  /** The star whose system the ship is in: "You are here". */
  here: Star = SOL;
  /** The stars round `fieldCenter`, and a count that goes up whenever they change. */
  stars: Star[] = [];
  fieldCenter: Vec3 = [...SUN_POS] as Vec3;
  /** How far round the centre each kind of star was made (pc): the renderer fades each kind out toward its edge. */
  reach: Partial<Record<StarClass, number>> = {};
  version = 0;
  private building: { center: Vec3; next: number; stars: Star[]; reach: Partial<Record<StarClass, number>> } | null = null;

  constructor() {
    // The named stars show from the first frame, before the first field is charted.
    this.stars = realNear(SUN_POS, Infinity);
    this.build(SUN_POS);
  }

  /** Whether the stars round the focus are still being made. */
  get busy(): boolean {
    return this.building !== null;
  }

  /** Starts making the stars round a point (a kind a frame, from `tick`). */
  build(center: Vec3): void {
    this.building = { center: [...center] as Vec3, next: 0, stars: [], reach: {} };
  }

  /** One kind of star made; when the last is done, the new field replaces the old. */
  tick(): void {
    const b = this.building;
    if (!b) {
      // Wandered far from where the stars were made: make them round here instead.
      if (distance(this.camera.focus, this.fieldCenter) > 12) this.build(this.camera.focus);
      return;
    }
    if (b.next < CLASSES.length) {
      const c = CLASSES[b.next], got = classNear(b.center, c);
      b.stars.push(...got.stars);
      b.reach[c.cls] = got.reach;
      b.next++;
      return;
    }
    // Every real star, however far: there are only a few dozen, and a search
    // that jumps across the galaxy should find the star it named already drawn
    // while the field round it is charted.
    b.stars.push(...realNear(b.center, Infinity));
    this.stars = b.stars;
    this.reach = b.reach;
    this.fieldCenter = b.center;
    this.building = null;
    this.version++;
  }

  /** Looks at a point, from a distance. */
  goTo(p: Vec3, dist?: number): void {
    this.camera.focus = [...p] as Vec3;
    if (dist !== undefined) this.camera.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, dist));
  }

  select(star: Star | null): void {
    this.selected = star;
  }

  zoom(factor: number): void {
    this.camera.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, this.camera.dist * factor));
  }

  turn(dyaw: number, dpitch: number): void {
    this.camera.yaw += dyaw;
    this.camera.pitch = Math.max(-1.5, Math.min(1.5, this.camera.pitch + dpitch));
  }

  /** The camera's position (galactocentric pc). */
  eye(): Vec3 {
    const c = this.camera, cp = Math.cos(c.pitch);
    return [c.focus[0] + c.dist * cp * Math.cos(c.yaw), c.focus[1] + c.dist * cp * Math.sin(c.yaw), c.focus[2] + c.dist * Math.sin(c.pitch)];
  }

  /** The nearest stars to the focus, for the list beside the map. */
  nearest(n: number): Star[] {
    const f = this.camera.focus;
    return [...this.stars].sort((a, b) => distance(a.pos, f) - distance(b.pos, f)).slice(0, n);
  }

  /** Real stars and landmarks by name: "vega", "betel", "pleiades", "centre". */
  search(text: string): { name: string; pos: Vec3; star?: Star }[] {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const out: { name: string; pos: Vec3; star?: Star }[] = [];
    for (const st of [SOL, ...REAL_STARS]) if (st.name.toLowerCase().includes(q)) out.push({ name: st.name, pos: st.pos, star: st });
    for (const m of LANDMARK_POS) if (m.name.toLowerCase().includes(q)) out.push({ name: m.name, pos: m.pos });
    if ("sagittarius a* galactic centre center core black hole".includes(q)) out.push({ name: SGR_A.name, pos: SGR_A.pos });
    for (const st of this.stars) if (!st.real && st.name.toLowerCase().includes(q) && out.length < 12) out.push({ name: st.name, pos: st.pos, star: st });
    return out.slice(0, 12);
  }

  /** Where the map is looking, in words: "the Orion Spur, 26,670 light-years from the centre". */
  describeFocus(): string {
    const f = this.camera.focus;
    // Pulled out past the disk, the point looked at stops being the story.
    if (this.camera.dist > 15_000) return `The whole Milky Way · seen from ${Math.round((this.camera.dist * LY_PER_PC) / 1000).toLocaleString("en")},000 ly out`;
    const fromCentre = Math.hypot(f[0], f[1], f[2]) * LY_PER_PC;
    const fromSun = distance(f, SUN_POS) * LY_PER_PC;
    const where = regionAt(f);
    return `${where[0].toUpperCase()}${where.slice(1)} · ${Math.round(fromCentre).toLocaleString("en")} ly from the centre${fromSun > 1 ? ` · ${Math.round(fromSun).toLocaleString("en")} ly from Sol` : ""}`;
  }
}
