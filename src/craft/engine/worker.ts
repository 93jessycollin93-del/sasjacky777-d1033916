/**
 * Worker entry: generation, lighting and meshing, so the frame loop never
 * waits on noise or face culling. Every failure is posted back as an error
 * result naming the job — a worker that throws silently leaves a hole in the
 * world that looks like the chunk is still loading, forever.
 */
import { JobRunner, transferables, type InitRequest, type JobRequest } from "./jobs";

const runner = new JobRunner();
// Typed by hand: pulling in the "webworker" lib next to "dom" redeclares half
// of both and breaks the app's typecheck.
interface WorkerScope {
  onmessage: ((event: MessageEvent<InitRequest | JobRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.kind === "init") {
    runner.init(msg);
    return;
  }
  try {
    const result = runner.run(msg);
    scope.postMessage(result, transferables(result));
  } catch (err) {
    scope.postMessage({ kind: "error", job: msg.job, message: err instanceof Error ? err.message : String(err) });
  }
};
