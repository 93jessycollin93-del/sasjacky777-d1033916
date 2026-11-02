/**
 * Keeps the right chunks loaded and meshed around the player.
 *
 * Nearest first, always: a ring of chunks is requested outward from where
 * the player stands, meshed only once all eight neighbours exist (their edges
 * feed the lighting and the face culling), and dropped once well outside the
 * render distance. Work in flight is capped so a fast flyer never queues
 * hundreds of stale jobs that finish after they stopped mattering.
 */
import { Chunk, chunkId } from "../engine/chunk";
import { buildPadded } from "../engine/mesher";
import type { GenResult, MeshResult } from "../engine/jobs";
import type { WorkerPool } from "../engine/workerPool";
import type { World } from "../engine/world";
import type { ChunkData } from "./save";

export interface ChunkSource {
  /** Saved or remotely held contents of a chunk, or null to generate it. */
  load(cx: number, cz: number): Promise<ChunkData | null>;
  /** A modified chunk is leaving memory. */
  unload(chunk: Chunk): void;
}

export interface MeshSink {
  setChunk(id: number, cx: number, cz: number, mesh: MeshResult["mesh"]): void;
  removeChunk(id: number): void;
}

interface Offset { dx: number; dz: number; d: number }

function ring(radius: number): Offset[] {
  const out: Offset[] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.hypot(dx, dz);
      if (d <= radius + 0.5) out.push({ dx, dz, d });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

export class Streamer {
  radius: number;
  private offsets: Offset[];
  private loading = new Set<number>();
  private meshing = new Map<number, number>();
  private failed = new Map<number, number>();
  fancyLeaves = true;
  smoothLighting = true;
  /** Last error from a worker, for the debug screen; the chunk is retried after a pause. */
  lastError: string | null = null;
  loadedEver = 0;
  /** Set when the player leaves this dimension: its jobs still in flight fail on purpose, not as errors. */
  private closed = false;

  close(): void {
    this.closed = true;
  }

  constructor(
    private world: World,
    private pool: WorkerPool,
    private source: ChunkSource,
    private sink: MeshSink,
    radius: number,
    /** Told after each chunk joins the world (online guests replay edits that arrived while it loaded). */
    private onLoaded: (chunk: Chunk, fromSave: boolean) => void,
  ) {
    this.radius = radius;
    this.offsets = ring(radius + 1);
  }

  setRadius(r: number): void {
    this.radius = r;
    this.offsets = ring(r + 1);
  }

  /** Remeshes everything (graphics settings changed). */
  invalidate(): void {
    for (const c of this.world.loadedChunks()) { c.dirty = true; c.version++; }
  }

  get busy(): number {
    return this.loading.size + this.meshing.size;
  }

  /** How many chunks within `r` of the centre are meshed — the loading screen's progress. */
  readiness(cx: number, cz: number, r: number, meshed: (id: number) => boolean): { done: number; total: number } {
    let done = 0, total = 0;
    for (const o of this.offsets) {
      if (o.d > r) break;
      total++;
      if (meshed(chunkId(cx + o.dx, cz + o.dz))) done++;
    }
    return { done, total };
  }

  update(centres: { x: number; z: number }[], now: number): void {
    const primary = centres[0];
    const pcx = Math.floor(primary.x) >> 4, pcz = Math.floor(primary.z) >> 4;
    const maxLoads = Math.max(4, this.pool.mode === "inline" ? 1 : 6);
    const maxMeshes = this.pool.mode === "inline" ? 1 : 4;

    // Load.
    for (const c of centres) {
      const ccx = Math.floor(c.x) >> 4, ccz = Math.floor(c.z) >> 4;
      for (const o of this.offsets) {
        if (this.loading.size >= maxLoads) break;
        const cx = ccx + o.dx, cz = ccz + o.dz;
        const id = chunkId(cx, cz);
        if (this.world.chunks.has(id) || this.loading.has(id)) continue;
        const retryAt = this.failed.get(id);
        if (retryAt !== undefined && retryAt > now) continue;
        this.requestChunk(cx, cz, id);
      }
    }

    // Mesh, nearest first, only once every neighbour is present.
    let dispatched = 0;
    for (const o of this.offsets) {
      if (o.d > this.radius + 0.5 || this.meshing.size >= maxMeshes || dispatched >= maxMeshes) break;
      const cx = pcx + o.dx, cz = pcz + o.dz;
      const c = this.world.chunk(cx, cz);
      if (!c || !c.dirty || this.meshing.has(c.id)) continue;
      let ready = true;
      for (let dz = -1; dz <= 1 && ready; dz++) for (let dx = -1; dx <= 1 && ready; dx++) if (!this.world.chunk(cx + dx, cz + dz)) ready = false;
      if (!ready) continue;
      this.requestMesh(c);
      dispatched++;
    }

    // Unload what every centre has left behind.
    const keep = this.radius + 3;
    for (const c of [...this.world.loadedChunks()]) {
      const far = centres.every((p) => {
        const dx = c.cx - (Math.floor(p.x) >> 4), dz = c.cz - (Math.floor(p.z) >> 4);
        return dx * dx + dz * dz > keep * keep;
      });
      if (!far) continue;
      if (c.modified) this.source.unload(c);
      this.world.removeChunk(c.cx, c.cz);
      this.sink.removeChunk(c.id);
      this.meshing.delete(c.id);
    }
  }

  private requestChunk(cx: number, cz: number, id: number): void {
    this.loading.add(id);
    this.source.load(cx, cz)
      .then((saved) => this.pool.run<GenResult>({ kind: "gen", cx, cz, saved: saved ? { blocks: saved.blocks, meta: saved.meta } : undefined })
        .then((res) => ({ res, saved })))
      .then(({ res, saved }) => {
        this.loading.delete(id);
        if (this.world.chunks.has(id)) return;
        const chunk = new Chunk(cx, cz, res.blocks, res.meta, res.light, res.biomes, res.tints);
        if (saved) {
          chunk.modified = true;
          for (const [i, e] of saved.entities) chunk.entities.set(i, e);
        }
        this.world.addChunk(chunk);
        this.loadedEver++;
        this.onLoaded(chunk, !!saved);
      })
      .catch((err: Error) => {
        this.loading.delete(id);
        if (this.closed) return;
        this.lastError = `chunk ${cx},${cz}: ${err.message}`;
        this.failed.set(id, performance.now() + 2000);
        console.warn("[blockcraft]", this.lastError);
      });
  }

  private requestMesh(c: Chunk): void {
    const version = c.version;
    c.dirty = false;
    this.meshing.set(c.id, version);
    const padded = buildPadded((x, z) => this.world.chunk(x, z), c.cx, c.cz);
    this.pool.run<MeshResult>({
      kind: "mesh", cx: c.cx, cz: c.cz, ...padded, tints: c.tints,
      fancyLeaves: this.fancyLeaves, smoothLighting: this.smoothLighting,
    }, [padded.blocks.buffer, padded.meta.buffer, padded.light.buffer])
      .then((res) => {
        if (this.meshing.get(c.id) !== version) return;
        this.meshing.delete(c.id);
        // The chunk may have been unloaded, or changed again, while this was in flight.
        const live = this.world.chunk(c.cx, c.cz);
        if (!live || live !== c) return;
        this.sink.setChunk(c.id, c.cx, c.cz, res.mesh);
        if (c.version !== version) c.dirty = true;
      })
      .catch((err: Error) => {
        this.meshing.delete(c.id);
        c.dirty = true;
        if (this.closed) return;
        this.lastError = `mesh ${c.cx},${c.cz}: ${err.message}`;
        console.warn("[blockcraft]", this.lastError);
      });
  }
}
