/**
 * Rain and snow around the camera.
 *
 * A column of drops wraps around the player. Each drop checks the highest
 * solid block in its column, so it stops at a roof instead of falling through
 * the ceiling onto someone sheltering indoors — the detail that makes a
 * shelter feel like one.
 */
import * as THREE from "three";
import type { World } from "../engine/world";
import { col } from "./materials";

const DROPS = 1400;
const RADIUS = 18;

export class Weather {
  readonly group = new THREE.Group();
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private rainPos = new Float32Array(DROPS * 6);
  private snowPos = new Float32Array(DROPS * 3);
  private drops = new Float32Array(DROPS * 4); // x offset, z offset, y, speed
  private rainMat: THREE.LineBasicMaterial;
  private snowMat: THREE.PointsMaterial;

  constructor(public world: World) {
    for (let i = 0; i < DROPS; i++) {
      this.drops[i * 4] = (Math.random() * 2 - 1) * RADIUS;
      this.drops[i * 4 + 1] = (Math.random() * 2 - 1) * RADIUS;
      this.drops[i * 4 + 2] = Math.random() * 30;
      this.drops[i * 4 + 3] = 0.8 + Math.random() * 0.4;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMat = new THREE.LineBasicMaterial({ color: col("#9fb4d9"), transparent: true, opacity: 0.5, depthWrite: false, fog: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 5;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(this.snowPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.snowMat = new THREE.PointsMaterial({ color: col("#ffffff"), size: 0.09, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 5;
    this.group.add(this.rain, this.snow);
  }

  update(dt: number, camera: THREE.Vector3, intensity: number, snowing: boolean, time: number, brightness: number): void {
    const visible = intensity > 0.02;
    this.rain.visible = visible && !snowing;
    this.snow.visible = visible && snowing;
    if (!visible) return;
    const count = Math.floor(DROPS * intensity);
    const cx = Math.floor(camera.x), cz = Math.floor(camera.z);
    for (let i = 0; i < DROPS; i++) {
      const o = i * 4;
      const x = cx + this.drops[o], z = cz + this.drops[o + 1];
      let y = this.drops[o + 2];
      y -= dt * (snowing ? 2.5 : 22) * this.drops[o + 3];
      const top = this.world.topSolid(Math.floor(x), Math.floor(z));
      const floor = Math.max(top + 1, camera.y - 12);
      if (y < floor || y > camera.y + 22) {
        y = camera.y + 12 + Math.random() * 10;
        if (y < top + 1) y = top + 1 + Math.random() * 10;
      }
      this.drops[o + 2] = y;
      const hide = i >= count || y < top + 1;
      if (snowing) {
        const sway = Math.sin(time * 1.3 + i) * 0.4;
        this.snowPos[i * 3] = x + sway; this.snowPos[i * 3 + 1] = hide ? -1000 : y; this.snowPos[i * 3 + 2] = z + Math.cos(time + i) * 0.3;
      } else {
        const r = i * 6;
        this.rainPos[r] = x; this.rainPos[r + 1] = hide ? -1000 : y; this.rainPos[r + 2] = z;
        this.rainPos[r + 3] = x + 0.05; this.rainPos[r + 4] = hide ? -1000 : y + 0.8; this.rainPos[r + 5] = z;
      }
    }
    this.rainMat.opacity = 0.35 + 0.25 * brightness;
    this.snowMat.opacity = 0.5 + 0.4 * brightness;
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.snow.geometry.attributes.position.needsUpdate = true;
  }
}
