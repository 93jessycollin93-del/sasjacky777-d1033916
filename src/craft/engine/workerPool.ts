/**
 * Hands generation and meshing jobs to a small pool of workers.
 *
 * If module workers are unavailable (old Safari, some embedded webviews) the
 * pool runs the same JobRunner on the main thread, one job per slice of idle
 * time. The game is slower to stream in that way, but it plays — the
 * alternative is a black screen with no explanation.
 */
import { JobRunner, type InitRequest, type JobRequest, type JobResult } from "./jobs";

type Pending = { resolve: (r: JobResult) => void; reject: (e: Error) => void };
/** A job request before the pool numbers it (Omit applied to each member of the union). */
export type NewJob = JobRequest extends infer R ? (R extends unknown ? Omit<R, "job"> : never) : never;

interface Slot {
  worker: Worker;
  busy: number;
}

// A module worker loaded from its own file. The single-file build of the solo
// copy has no other file to load it from, so it swaps in one inlined as a blob.
let makeWorker = (): Worker => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

export function setWorkerFactory(factory: () => Worker): void {
  makeWorker = factory;
}

export class WorkerPool {
  private slots: Slot[] = [];
  private pending = new Map<number, Pending>();
  private nextJob = 1;
  private inline: JobRunner | null = null;
  private inlineQueue: { req: JobRequest; p: Pending }[] = [];
  private inlineTimer: ReturnType<typeof setTimeout> | null = null;
  readonly mode: "workers" | "inline";

  constructor(init: InitRequest, size = defaultPoolSize()) {
    let mode: "workers" | "inline" = "workers";
    try {
      if (typeof Worker === "undefined") throw new Error("no Worker");
      for (let i = 0; i < size; i++) {
        const worker = makeWorker();
        const slot: Slot = { worker, busy: 0 };
        worker.onmessage = (e: MessageEvent<JobResult>) => {
          slot.busy--;
          this.settle(e.data);
        };
        worker.onerror = (e) => {
          // A worker that failed to load at all fails every job it holds,
          // loudly, rather than leaving them pending.
          for (const [job, p] of this.pending) p.reject(new Error(`worker failed: ${e.message || "could not start"} (job ${job})`));
          this.pending.clear();
        };
        worker.postMessage(init);
        this.slots.push(slot);
      }
    } catch {
      for (const s of this.slots) s.worker.terminate();
      this.slots = [];
      mode = "inline";
      this.inline = new JobRunner();
      this.inline.init(init);
    }
    this.mode = mode;
  }

  get busy(): number {
    return this.pending.size;
  }

  run<T extends JobResult>(req: NewJob, transfer: Transferable[] = []): Promise<T> {
    const job = this.nextJob++;
    const full = { ...req, job } as JobRequest;
    return new Promise<T>((resolve, reject) => {
      const p: Pending = { resolve: resolve as (r: JobResult) => void, reject };
      this.pending.set(job, p);
      if (this.inline) {
        this.inlineQueue.push({ req: full, p });
        this.pumpInline();
        return;
      }
      let best = this.slots[0];
      for (const s of this.slots) if (s.busy < best.busy) best = s;
      best.busy++;
      best.worker.postMessage(full, transfer);
    });
  }

  private settle(res: JobResult): void {
    const p = this.pending.get(res.job);
    if (!p) return;
    this.pending.delete(res.job);
    if (res.kind === "error") p.reject(new Error(res.message));
    else p.resolve(res);
  }

  private pumpInline(): void {
    if (this.inlineTimer || !this.inline) return;
    this.inlineTimer = setTimeout(() => {
      this.inlineTimer = null;
      const next = this.inlineQueue.shift();
      if (!next || !this.inline) return;
      try {
        this.settle(this.inline.run(next.req));
      } catch (err) {
        this.pending.delete(next.req.job);
        next.p.reject(err instanceof Error ? err : new Error(String(err)));
      }
      if (this.inlineQueue.length) this.pumpInline();
    }, 0);
  }

  dispose(): void {
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
    for (const p of this.pending.values()) p.reject(new Error("world closed"));
    this.pending.clear();
    this.inlineQueue = [];
    if (this.inlineTimer) clearTimeout(this.inlineTimer);
  }
}

function defaultPoolSize(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(3, cores - 1));
}
