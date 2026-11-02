/**
 * The on-device engine's model shelf: download the picked model, watch it
 * arrive, remove it — and see what else is already stored here.
 *
 * Shown above the composer while On-device is the chosen engine. Everything a
 * person needs to decide is on it before hundreds of megabytes leave anywhere
 * — the size, where it is stored, whether this browser will run it on a GPU or
 * take minutes per first answer on the CPU, and whether a phone can hold it at
 * all — because a model that downloads and then crawls or crashes, with
 * nothing having said so, reads as a broken feature.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import {
  deviceDownloadInProgress,
  deviceModelStatus,
  downloadDeviceModel,
  removeDeviceModel,
  stopDeviceDownload,
  storedModels,
  UNSUPPORTED_BROWSER,
  type DeviceModelStatus,
} from "@/lib/microai/bonsaiDevice";
import { deviceModelOrDefault, findDeviceModel } from "@/lib/microai/deviceModels";

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/**
 * An iPhone or iPad browsing in a tab rather than as a Home Screen app.
 *
 * WebKit deletes everything a site has stored once the site goes seven days
 * of browser use without a visit, and a model downloaded over a phone's
 * connection should not quietly vanish a week later. Home Screen apps are
 * exempt, so on iOS the panel says how to keep it. iPadOS reports itself as a
 * Mac; the touch points give it away.
 */
function iosInBrowserTab(): boolean {
  if (typeof navigator === "undefined") return false;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  const installed =
    (navigator as { standalone?: boolean }).standalone === true ||
    (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
  return !installed;
}

// A Home Screen app also has its own storage, separate from Safari's: a copy
// downloaded in a tab does not follow it there. So the advice is where to
// download, not just where to open.
const KEEP_ON_IPHONE =
  "To keep a model on this iPhone, download it from the Home Screen app, not a Safari tab: Share → Add to Home Screen, open it from there and sign in. Safari deletes a website's stored data after seven days without a visit; a Home Screen app keeps its own.";

export function DeviceModelPanel({ modelId }: { modelId: string }) {
  const spec = deviceModelOrDefault(modelId);
  const [status, setStatus] = useState<DeviceModelStatus | null>(null);
  const [others, setOthers] = useState<Array<{ id: string; bytes: number }>>([]);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // The download belongs to bonsaiDevice.ts, not to this panel, so switching
  // engine or model mid-download leaves it running; this only stops listening.
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const [next, stored] = await Promise.all([deviceModelStatus(spec.id), storedModels()]);
    if (!mounted.current) return;
    setStatus(next);
    setOthers(stored.filter((m) => m.id !== spec.id));
  }, [spec.id]);

  const follow = useCallback(async () => {
    setNote(null);
    const result = await downloadDeviceModel(spec.id, { onProgress: (p) => mounted.current && setProgress(p) });
    if (!mounted.current) return;
    setProgress(null);
    setNote(result.ok ? `Model weights saved from ${result.from}. Check connection in the workspace to verify Jackie's profile.` : result.error);
    await refresh();
  }, [spec.id, spec.name, refresh]);

  useEffect(() => {
    mounted.current = true;
    setNote(null);
    setConfirmRemove(false);
    setProgress(null);
    void refresh();
    // Back on this model while its download runs: show it, rather than a
    // Download button that would start the same file again.
    if (deviceDownloadInProgress()?.modelId === spec.id) void follow();
    return () => {
      mounted.current = false;
    };
  }, [spec.id, refresh, follow]);

  const remove = async (id: string) => {
    setConfirmRemove(false);
    const result = await removeDeviceModel(id);
    const name = deviceModelOrDefault(id).name;
    setNote(result.ok ? `Removed ${name}.` : result.error);
    await refresh();
  };

  const button =
    "min-h-11 rounded-lg border border-border px-3 py-2 text-xs text-foreground hover:bg-secondary transition-colors disabled:opacity-50";

  if (!status) {
    return <div className="mb-2 font-mono text-[10px] text-muted-foreground">Checking this browser for {spec.name}…</div>;
  }

  const size = spec.note.split(" · ")[0];
  const elsewhere = deviceDownloadInProgress();
  const busyWithOther = elsewhere && elsewhere.modelId !== spec.id ? findDeviceModel(elsewhere.modelId) : undefined;

  return (
    <details className="mb-2 rounded-xl border border-border bg-card/95 text-xs text-muted-foreground" open={!!progress || !status.downloaded} aria-label="On-device model">
      <summary className="min-h-11 cursor-pointer px-3 py-3 font-medium text-foreground">
        {spec.name} · {progress ? "Downloading" : status.downloaded ? "Stored locally" : "Model setup"}
      </summary>
      <div className="border-t border-border p-3 space-y-2">
      {!status.supported ? (
        <p>{UNSUPPORTED_BROWSER}</p>
      ) : progress ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex-1">
              Downloading {spec.name} — {mb(progress.loaded)} of {mb(progress.total)} MB
            </span>
            <button className={button} onClick={stopDeviceDownload}>
              Stop
            </button>
          </div>
          <p>It keeps going if you switch engine or model; come back here to see it finish.</p>
          <Progress
            className="h-1.5"
            value={progress.total ? (progress.loaded / progress.total) * 100 : 0}
            aria-label="Download progress"
          />
        </div>
      ) : status.downloaded ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1">
            <span className="text-primary">●</span> {spec.name} weights are stored here ·{" "}
            {status.gpu ? "WebGPU is available" : "no WebGPU here, so it runs on the CPU: a first answer can take minutes"}
            {status.compat && " · Safari's engine runs the slower compatibility build"}
          </span>
          {confirmRemove ? (
            <>
              <button className={button} onClick={() => remove(spec.id)}>
                Remove {spec.name}
              </button>
              <button className={button} onClick={() => setConfirmRemove(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className={button} onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <p>
            {status.partial
              ? `An incomplete copy of ${spec.name} is stored here. Download again to replace it, or remove it.`
              : `${spec.name} runs in this tab once it is downloaded: ${size}, once, kept in this browser. No AI provider sees what you ask it; the chat is still saved to your history, as with every engine.`}
          </p>
          <p>
            {spec.pinned
              ? "These exact bytes are pinned by this app."
              : `Fetched from Hugging Face (${spec.repos[0]}${spec.repos.length > 1 ? " or a listed mirror" : ""}) when you press Download · ${spec.license}.`}
          </p>
          {!status.gpu && (
            <p>This browser has no WebGPU, so it would run on the CPU — expect minutes, not seconds, for a first answer.</p>
          )}
          {status.compat && (
            <p>
              This browser runs models in their slower compatibility build (Safari's engine — on an iPhone, every browser
              is Safari underneath). Performance and memory limits depend on the device.
            </p>
          )}
          {status.compat && !spec.phone && (
            <p className="text-destructive">
              {spec.name} is likely too big for a phone's browser memory. Bonsai, SmolLM2 360M and Qwen2.5 0.5B are smaller candidates; their memory use still needs checking on your device.
            </p>
          )}
          <div className="flex gap-2">
            <button className={button} onClick={follow} disabled={!!busyWithOther}>
              Download ({size})
            </button>
            {status.partial && (
              <button className={button} onClick={() => remove(spec.id)}>
                Remove
              </button>
            )}
          </div>
          {busyWithOther && <p>{busyWithOther.name} is downloading; this one can start when it finishes.</p>}
        </div>
      )}
      {others.length > 0 && (
        <p className="mt-1">
          Also on this device:{" "}
          {others.map((m, i) => (
            <span key={m.id}>
              {i > 0 && ", "}
              {deviceModelOrDefault(m.id).name} ({mb(m.bytes)} MB,{" "}
              <button className="underline hover:text-foreground" onClick={() => remove(m.id)}>
                remove
              </button>
              )
            </span>
          ))}
        </p>
      )}
      {status.supported && iosInBrowserTab() && <p className="mt-1">{KEEP_ON_IPHONE}</p>}
      {status.error && <p className="mt-1 text-destructive">{status.error}</p>}
      {note && <p className="mt-1" role="status">{note}</p>}
      </div>
    </details>
  );
}
