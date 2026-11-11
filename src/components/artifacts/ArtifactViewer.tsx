import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Download, ExternalLink, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ARTIFACT_SANDBOX,
  downloadName,
  eraseStoredData,
  formatBytes,
  loadArtifact,
  readFrameMessage,
  readStoredData,
  storedSize,
  withStorageShim,
  writeStoredData,
  type ArtifactItem,
  type StoredData,
} from "@/lib/artifactLibrary";

type Load =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "ready"; html: string; doc: string };

interface Props {
  versions: ArtifactItem[];
  current: ArtifactItem;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/**
 * One artifact, full screen, in a sandbox with no origin (see
 * `src/lib/artifactLibrary.ts` for why). Everything the bar says is measured
 * here or recorded at import: the fingerprint check, the size of what the
 * artifact has saved, the error it threw when it was imported.
 */
const ArtifactViewer = ({ versions, current, onSelect, onClose }: Props) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [saved, setSaved] = useState<{ bytes: number; at: Date | null }>({ bytes: 0, at: null });
  const [storageError, setStorageError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    setLink(null);
    setStorageError(null);
    (async () => {
      const got = await loadArtifact(current);
      if (!live) return;
      if (!got.ok) return setLoad({ state: "error", error: got.error });
      if (current.kind === "source") return setLoad({ state: "ready", html: got.value, doc: got.value });
      let data: StoredData = {};
      try {
        data = await readStoredData(current.id);
      } catch (err) {
        // Run it anyway, but say plainly that nothing it saves will stick.
        setStorageError(`Saved data could not be read (${(err as Error).message}). It starts empty, and changes will not be kept.`);
      }
      if (!live) return;
      setSaved({ bytes: storedSize(data), at: null });
      setLoad({ state: "ready", html: got.value, doc: withStorageShim(got.value, data) });
    })();
    return () => {
      live = false;
    };
  }, [current, reloads]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = readFrameMessage(event, frame.current?.contentWindow ?? null);
      if (!msg) return;
      if (msg.type === "close") onClose();
      else if (msg.type === "link") setLink(msg.href);
      else if (msg.type === "storage") {
        writeStoredData(current.id, msg.data).then(
          () => {
            setSaved({ bytes: storedSize(msg.data), at: new Date() });
            setStorageError(null);
          },
          (err: Error) => setStorageError(`The artifact's latest changes were not saved: ${err.message}`),
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [current.id, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmErase) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmErase]);

  const download = useCallback(() => {
    if (load.state !== "ready") return;
    const url = URL.createObjectURL(new Blob([load.html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName(current);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [load, current]);

  const erase = async () => {
    setConfirmErase(false);
    try {
      await eraseStoredData(current.id);
      setSaved({ bytes: 0, at: null });
      setReloads((n) => n + 1);
    } catch (err) {
      setStorageError(`Saved data could not be erased: ${(err as Error).message}`);
    }
  };

  const f = current.features;
  const failed = current.render && current.render.errors > 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-border bg-sidebar">
        <Button variant="ghost" size="sm" onClick={onClose} className="font-mono text-xs gap-1.5 px-2">
          <ArrowLeft size={14} />
          Library
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={current.title}>
          {current.title}
        </span>
        {versions.length > 1 && (
          <select
            aria-label="Version"
            value={current.id}
            onChange={(e) => onSelect(e.target.value)}
            className="max-w-[11rem] rounded-sm border border-border bg-background px-1.5 py-1 font-mono text-[11px] text-foreground"
          >
            {versions.map((v, i) => (
              <option key={v.id} value={v.id}>
                {i === 0 ? "Newest" : `Version ${versions.length - i}`}
                {v.modified ? ` · ${new Date(v.modified).toLocaleDateString()}` : ""}
              </option>
            ))}
          </select>
        )}
        <Button variant="ghost" size="sm" onClick={download} disabled={load.state !== "ready"} className="px-2" title="Download as an .html file">
          <Download size={14} />
          <span className="sr-only sm:not-sr-only sm:ml-1 font-mono text-xs">Download</span>
        </Button>
        {saved.bytes > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmErase(true)} className="px-2" title="Erase what this artifact has saved">
            <Trash2 size={14} />
            <span className="sr-only sm:not-sr-only sm:ml-1 font-mono text-xs">Erase data</span>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose} className="px-2" aria-label="Close">
          <X size={14} />
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 border-b border-border font-mono text-[10px] text-muted-foreground">
        {load.state === "ready" && (
          <span className="flex items-center gap-1 text-primary">
            <ShieldCheck size={11} />
            fingerprint verified · sha256 {current.sha256.slice(0, 12)}…
          </span>
        )}
        <span>{formatBytes(current.bytes)}</span>
        <span>{current.source === "drive" ? "from Google Drive" : "uploaded file"}</span>
        {current.kind === "source" && <span>recovered {current.language ?? "source"}, shown as text</span>}
        {current.kind === "artifact" && saved.bytes > 0 && (
          <span>
            saved data {formatBytes(saved.bytes)}
            {saved.at ? ` · saved ${saved.at.toLocaleTimeString()}` : ""}
          </span>
        )}
      </div>

      {(storageError || f.indexedDB || failed || link) && (
        <div className="px-3 py-1.5 space-y-1 border-b border-border text-xs">
          {storageError && <Notice>{storageError}</Notice>}
          {f.indexedDB && current.kind === "artifact" && (
            <Notice>
              This artifact uses IndexedDB, which the sandbox cannot offer. Whatever it keeps there will fail here; download it to run it with
              storage.
            </Notice>
          )}
          {failed && (
            <Notice>
              When it was imported, this artifact threw an error before anyone touched it: <code className="font-mono">{current.render?.firstError}</code>
            </Notice>
          )}
          {link && (
            <div className="flex flex-wrap items-center gap-2 rounded-sm bg-secondary px-2 py-1">
              <span className="min-w-0 flex-1 truncate">
                The artifact wants to open <span className="font-mono">{link}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => {
                  window.open(link, "_blank", "noopener,noreferrer");
                  setLink(null);
                }}
              >
                <ExternalLink size={12} /> Open in a new tab
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setLink(null)}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {load.state === "loading" && <p className="p-6 text-center font-mono text-xs text-muted-foreground">Unpacking and checking…</p>}
        {load.state === "error" && (
          <div className="p-6">
            <Notice>{load.error}</Notice>
          </div>
        )}
        {load.state === "ready" && (
          <iframe
            key={`${current.id}:${reloads}`}
            ref={frame}
            title={current.title}
            sandbox={ARTIFACT_SANDBOX}
            srcDoc={load.doc}
            referrerPolicy="no-referrer"
            allow="fullscreen; clipboard-write"
            className="absolute inset-0 h-full w-full border-0 bg-white"
          />
        )}
      </div>

      <AlertDialog open={confirmErase} onOpenChange={setConfirmErase}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase this artifact's saved data?</AlertDialogTitle>
            <AlertDialogDescription>
              {formatBytes(saved.bytes)} that "{current.title}" saved in this browser will be deleted, and the artifact restarts empty. Other
              versions keep their own data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={erase}>Erase</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const Notice = ({ children }: { children: React.ReactNode }) => (
  <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
    <span>{children}</span>
  </p>
);

export default ArtifactViewer;
