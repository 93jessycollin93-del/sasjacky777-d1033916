/**
 * The single-file build opens from disk (file://), where there is no second
 * file to load a worker from — so the chunk worker is inlined into the page
 * and started from a blob. Imported only by that build.
 */
import { setWorkerFactory } from "@/craft/engine/workerPool";
import InlineWorker from "@/craft/engine/worker.ts?worker&inline";

export function inlineWorkers(): void {
  setWorkerFactory(() => new InlineWorker());
}
