/**
 * The GPU side of chunks: one mesh per pass per chunk, sharing a single quad
 * index buffer.
 *
 * Every chunk's quads index the same pattern (0,1,2, 0,2,3, then +4...), so
 * one index buffer serves them all instead of a copy per chunk — a quarter of
 * the geometry memory. The catch is three.js deletes a geometry's index buffer
 * when the geometry is disposed, which would pull it out from under every
 * other chunk; `release` detaches it first.
 */
import * as THREE from "three";
import type { ChunkMesh, LayerMesh } from "../engine/mesher";
import type { ChunkPass } from "./materials";

interface Entry {
  meshes: Partial<Record<ChunkPass, THREE.Mesh>>;
  quads: number;
}

export class ChunkMeshes {
  readonly group = new THREE.Group();
  private entries = new Map<number, Entry>();
  private index: THREE.BufferAttribute;
  private indexQuads = 0;
  quads = 0;

  constructor(private materials: Record<ChunkPass, THREE.Material>) {
    this.index = this.makeIndex(16384);
  }

  private makeIndex(quads: number): THREE.BufferAttribute {
    const idx = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4, i = q * 6;
      idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2;
      idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
    }
    this.indexQuads = quads;
    return new THREE.BufferAttribute(idx, 1);
  }

  private geometry(layer: LayerMesh): THREE.BufferGeometry {
    if (layer.quads > this.indexQuads) this.index = this.makeIndex(Math.max(layer.quads, this.indexQuads * 2));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(layer.positions, 3));
    g.setAttribute("aTex", new THREE.BufferAttribute(layer.tex, 4));
    g.setAttribute("aLight", new THREE.BufferAttribute(layer.light, 4));
    g.setAttribute("aColor", new THREE.BufferAttribute(layer.color, 4));
    g.setIndex(this.index);
    g.setDrawRange(0, layer.quads * 6);
    let minY = Infinity, maxY = -Infinity;
    const p = layer.positions;
    for (let i = 1; i < p.length; i += 3) { if (p[i] < minY) minY = p[i]; if (p[i] > maxY) maxY = p[i]; }
    const cy = (minY + maxY) / 2;
    const r = Math.hypot(128, (maxY - minY) / 2 + 16, 128);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(128, cy, 128), r);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(256, maxY, 256));
    return g;
  }

  private release(mesh: THREE.Mesh): void {
    mesh.geometry.setIndex(null);
    mesh.geometry.dispose();
    this.group.remove(mesh);
  }

  set(id: number, cx: number, cz: number, data: ChunkMesh): void {
    this.remove(id);
    const entry: Entry = { meshes: {}, quads: 0 };
    for (const pass of ["opaque", "cutout", "translucent"] as ChunkPass[]) {
      const layer = data[pass];
      if (layer.quads === 0) continue;
      const mesh = new THREE.Mesh(this.geometry(layer), this.materials[pass]);
      mesh.position.set(cx * 16, 0, cz * 16);
      mesh.scale.setScalar(1 / 16);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.renderOrder = pass === "translucent" ? 2 : pass === "cutout" ? 1 : 0;
      this.group.add(mesh);
      entry.meshes[pass] = mesh;
      entry.quads += layer.quads;
    }
    this.quads += entry.quads;
    this.entries.set(id, entry);
  }

  has(id: number): boolean {
    return this.entries.has(id);
  }

  remove(id: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    for (const m of Object.values(e.meshes)) if (m) this.release(m);
    this.quads -= e.quads;
    this.entries.delete(id);
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }

  get count(): number {
    return this.entries.size;
  }
}
