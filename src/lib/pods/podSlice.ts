// Lazy / streaming pod decompression.
// Decompresses a sealed pod blob in bounded chunks so a 30 MB pod never
// freezes the tab, then returns only the requested JSON path.
// The rest of the pod stays sealed on disk (IndexedDB) — nothing is written back.

import { getPod } from "./podEngine";

export interface SliceOptions {
  /** Max bytes pulled from the decompression stream per tick. Lower = gentler on hardware. */
  bytesPerTick?: number;
  /** Delay between ticks in ms. */
  tickDelayMs?: number;
  onProgress?: (bytesRead: number) => void;
  signal?: AbortSignal;
}

export const DEFAULT_BYTES_PER_TICK = 256 * 1024; // 256 KB

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Read a gzip blob in bounded chunks, yielding to the event loop between ticks. */
export async function chunkedGunzip(blob: Blob, opts: SliceOptions = {}): Promise<Uint8Array> {
  const cap = Math.max(4096, opts.bytesPerTick ?? DEFAULT_BYTES_PER_TICK);
  const delay = Math.max(0, opts.tickDelayMs ?? 0);
  const reader = blob
    .stream()
    .pipeThrough(new (globalThis as any).DecompressionStream("gzip"))
    .getReader();

  const parts: Uint8Array[] = [];
  let total = 0;
  let sinceYield = 0;

  for (;;) {
    if (opts.signal?.aborted) {
      await reader.cancel();
      throw new Error("slice aborted");
    }
    const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
    if (done) break;
    if (value) {
      parts.push(value);
      total += value.byteLength;
      sinceYield += value.byteLength;
      if (sinceYield >= cap) {
        sinceYield = 0;
        opts.onProgress?.(total);
        await sleep(delay);
      }
    }
  }
  opts.onProgress?.(total);

  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/** Resolve a dotted path (`rules.mitre.T1078`, `items.0.name`) against a value. */
export function pickPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let cur: any = value;
  for (const seg of path.split(".").filter(Boolean)) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

export interface SliceResult<T = unknown> {
  podId: string;
  path: string;
  value: T;
  bytesRead: number;
  ms: number;
  found: boolean;
}

/**
 * Open only one JSON path out of a sealed pod.
 * Example: openSlice("pod-22-api-keys", "0.prefix")
 */
export async function openSlice<T = unknown>(
  podId: string,
  path: string,
  opts: SliceOptions = {},
): Promise<SliceResult<T>> {
  const started = performance.now();
  const rec = await getPod(podId);
  if (!rec) throw new Error(`Pod ${podId} not found`);
  if (!rec.blob) throw new Error(`Pod ${podId} is empty — nothing to slice`);

  let bytesRead = 0;
  const raw = await chunkedGunzip(rec.blob, {
    ...opts,
    onProgress: (n) => {
      bytesRead = n;
      opts.onProgress?.(n);
    },
  });

  const parsed = JSON.parse(new TextDecoder().decode(raw));
  const value = pickPath(parsed, path);
  return {
    podId,
    path,
    value: value as T,
    bytesRead,
    ms: Math.round(performance.now() - started),
    found: value !== undefined,
  };
}
