/**
 * The work that runs off the main thread: generating a chunk, lighting it,
 * and meshing it. Written as plain functions so the worker, the in-thread
 * fallback and the tests all run exactly the same code.
 */
import { CHUNK_VOLUME } from "./constants";
import { lightChunk } from "./lighting";
import { Mesher, type ChunkMesh } from "./mesher";
import { createGenerator } from "./generators";
import type { ChunkGenerator, GenSettings } from "./worldgen";

export interface GenRequest {
  kind: "gen";
  job: number;
  cx: number;
  cz: number;
  /** Saved contents; when present the chunk is loaded rather than generated. */
  saved?: { blocks: Uint16Array; meta: Uint8Array };
}

export interface GenResult {
  kind: "gen";
  job: number;
  cx: number;
  cz: number;
  blocks: Uint16Array;
  meta: Uint8Array;
  light: Uint8Array;
  biomes: Uint8Array;
  tints: Uint8Array;
}

export interface MeshRequest {
  kind: "mesh";
  job: number;
  cx: number;
  cz: number;
  blocks: Uint16Array;
  meta: Uint8Array;
  light: Uint8Array;
  tints: Uint8Array;
  fancyLeaves: boolean;
  smoothLighting: boolean;
}

export interface MeshResult {
  kind: "mesh";
  job: number;
  cx: number;
  cz: number;
  mesh: ChunkMesh;
}

export interface InitRequest {
  kind: "init";
  settings: GenSettings;
  layers: Record<string, number>;
}

export interface ErrorResult {
  kind: "error";
  job: number;
  message: string;
}

export type JobRequest = GenRequest | MeshRequest;
export type JobResult = GenResult | MeshResult | ErrorResult;

export class JobRunner {
  private generator: ChunkGenerator | null = null;
  private mesher: Mesher | null = null;
  private missing = 0;

  init(req: InitRequest): void {
    this.generator = createGenerator(req.settings);
    const layers = req.layers;
    const fallback = layers["__missing__"] ?? 0;
    this.mesher = new Mesher((name) => {
      const l = layers[name];
      if (l === undefined) { this.missing++; return fallback; }
      return l;
    });
  }

  run(req: JobRequest): JobResult {
    if (!this.generator || !this.mesher) throw new Error("job runner used before init");
    if (req.kind === "gen") {
      const { cx, cz } = req;
      let blocks: Uint16Array, meta: Uint8Array, biomes: Uint8Array;
      if (req.saved && req.saved.blocks.length === CHUNK_VOLUME) {
        blocks = req.saved.blocks;
        meta = req.saved.meta.length === CHUNK_VOLUME ? req.saved.meta : new Uint8Array(CHUNK_VOLUME);
        biomes = new Uint8Array(256);
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) biomes[z * 16 + x] = this.generator.biomeAt(cx * 16 + x, cz * 16 + z);
      } else {
        const g = this.generator.generate(cx, cz);
        blocks = g.blocks; meta = g.meta; biomes = g.biomes;
      }
      const light = lightChunk(blocks, cx, cz);
      const tints = this.generator.tints(cx, cz);
      return { kind: "gen", job: req.job, cx, cz, blocks, meta, light, biomes, tints };
    }
    const mesh = this.mesher.mesh({
      blocks: req.blocks, meta: req.meta, light: req.light, tints: req.tints,
      fancyLeaves: req.fancyLeaves, smoothLighting: req.smoothLighting,
    });
    return { kind: "mesh", job: req.job, cx: req.cx, cz: req.cz, mesh };
  }
}

/** Buffers to transfer (not copy) back across the worker boundary. */
export function transferables(res: JobResult): ArrayBuffer[] {
  if (res.kind === "gen") return [res.blocks.buffer, res.meta.buffer, res.light.buffer, res.biomes.buffer, res.tints.buffer] as ArrayBuffer[];
  if (res.kind === "mesh") {
    const out: ArrayBuffer[] = [];
    for (const l of [res.mesh.opaque, res.mesh.cutout, res.mesh.translucent]) {
      out.push(l.positions.buffer as ArrayBuffer, l.tex.buffer as ArrayBuffer, l.light.buffer as ArrayBuffer, l.color.buffer as ArrayBuffer);
    }
    return out;
  }
  return [];
}

