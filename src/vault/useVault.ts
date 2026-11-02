/**
 * The Vault's state, backed by real storage and a queue that really runs.
 *
 * Before this, four screens read fixtures and a job created with
 * `status: 'waiting'` waited for ever. This is the part that closes both ends:
 * it reads from IndexedDB (`storage.ts`) and it drives jobs through ffmpeg
 * (`conversion.ts`) until they produce a file or fail with a reason.
 *
 * One job runs at a time. Two concurrent ffmpeg instances on the same machine
 * means two 31 MB cores and two copies of the media in memory, which on a phone
 * is how the tab dies — and a queue that kills the tab is worse than a slow one.
 */
import { useCallback, useEffect, useState } from "react";
import { ingestionService, metadataService } from "./services";
import { runConversion } from "./conversion";
import * as store from "./storage";
import type { ConversionJob, JobAction, MediaItem, OutputAsset } from "./types";

export interface VaultState {
  media: MediaItem[];
  jobs: ConversionJob[];
  outputs: OutputAsset[];
  loading: boolean;
  /** Null until measured; the browser may not report it. */
  usage: { usedBytes: number; quotaBytes: number } | null;
  error: string | null;
}

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Whether a job is being processed, at module scope rather than per hook.
 *
 * `useVault` is called by several screens, and each call is a separate instance
 * with separate state. A guard held in a ref would therefore let the dashboard
 * and the queue screen, both mounted, each start the same waiting job — two
 * ffmpeg instances, two 31 MB cores, two copies of the media in memory, and two
 * outputs written for one job. There is one queue, so the flag that says it is
 * busy belongs beside it.
 */
let queueRunning = false;

export function useVault() {
  const [state, setState] = useState<VaultState>({
    media: [], jobs: [], outputs: [], loading: true, usage: null, error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const [media, jobs, outputs, usage] = await Promise.all([
        store.listMedia(), store.listJobs(), store.listOutputs(), store.usage(),
      ]);
      setState({ media, jobs, outputs, usage, loading: false, error: null });
    } catch (error) {
      // Named, because the usual cause — a browser in private mode, or storage
      // the user has blocked for this site — is something they can change, and
      // an empty library with no explanation reads as data loss.
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "The Vault's local storage is unavailable.",
      }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /** Validates, stores the bytes, and records the item. */
  const importFile = useCallback(async (file: File): Promise<MediaItem | null> => {
    const verdict = ingestionService.validateFile(file);
    if (!verdict.valid) {
      setState((prev) => ({ ...prev, error: verdict.reason ?? "That file was refused." }));
      return null;
    }

    // Real duration and resolution, read off a media element. `services.ts`
    // already did this correctly and nothing ever called it.
    const probed = await metadataService.extractFromFile(file).catch(() => ({}));

    const now = new Date().toISOString();
    const item: MediaItem = {
      id: id("media"),
      title: file.name.replace(/\.[^/.]+$/, ""),
      originalFilename: file.name,
      sourceType: "uploaded_file",
      importMethod: "upload",
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
      status: "ready",
      tags: [],
      notes: "",
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
      ...probed,
    };

    // Bytes first: an item row pointing at a blob that failed to write is a
    // library entry that cannot be opened or converted.
    await store.putBlob(item.id, file);
    await store.putMedia(item);
    await refresh();
    return item;
  }, [refresh]);

  /** Persisted, unlike before: favouriting used to live in component state. */
  const toggleFavorite = useCallback(async (mediaId: string) => {
    const item = await store.getMedia(mediaId);
    if (!item) return;
    await store.putMedia({ ...item, isFavorite: !item.isFavorite });
    await refresh();
  }, [refresh]);

  const removeMedia = useCallback(async (mediaId: string) => {
    await store.deleteMedia(mediaId);
    await refresh();
  }, [refresh]);

  /** Queues a conversion. The runner below picks it up. */
  const queueJob = useCallback(async (
    item: MediaItem,
    actionType: JobAction,
    presetKey: string,
    outputFormat: string,
    options: Partial<ConversionJob> = {},
  ) => {
    const job: ConversionJob = {
      id: id("job"),
      mediaItemId: item.id,
      mediaItemTitle: item.title,
      actionType,
      presetKey,
      outputFormat,
      normalizationEnabled: false,
      progress: 0,
      status: "waiting",
      createdAt: new Date().toISOString(),
      ...options,
    };
    await store.putJob(job);
    await refresh();
    return job;
  }, [refresh]);

  const cancelJob = useCallback(async (jobId: string) => {
    const jobs = await store.listJobs();
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.status === "complete") return;
    await store.putJob({ ...job, status: "cancelled", completedAt: new Date().toISOString() });
    await refresh();
  }, [refresh]);

  /**
   * Puts a failed job back in the queue. The runner picks it up again.
   *
   * The error is cleared with it: a job showing "waiting" beside last attempt's
   * failure reads as though it failed again before it has even started.
   */
  const retryJob = useCallback(async (jobId: string) => {
    const jobs = await store.listJobs();
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    await store.putJob({
      ...job, status: "waiting", progress: 0,
      errorMessage: undefined, startedAt: undefined, completedAt: undefined,
    });
    await refresh();
  }, [refresh]);

  /**
   * Drives the queue.
   *
   * Re-entrancy is guarded by a ref rather than by state: state updates are
   * batched and this effect can fire twice before the first has rendered, which
   * would run the same job in two ffmpeg instances.
   */
  useEffect(() => {
    if (queueRunning) return;
    const next = state.jobs.find((job) => job.status === "waiting");
    if (!next) return;

    queueRunning = true;
    let cancelled = false;

    (async () => {
      const mark = async (patch: Partial<ConversionJob>) => {
        if (cancelled) return;
        await store.putJob({ ...next, ...patch });
        await refresh();
      };

      try {
        await mark({ status: "processing", startedAt: new Date().toISOString(), progress: 0 });

        const item = await store.getMedia(next.mediaItemId);
        const source = await store.getBlob(next.mediaItemId);
        if (!item || !source) {
          throw new Error("The source media is no longer in the Vault.");
        }

        const result = await runConversion(next, item, source, {
          onProgress: (percent) => {
            // Progress is written straight to the store rather than held in
            // component state, so the queue screen shows the same number after
            // a navigation.
            store.putJob({ ...next, status: "processing", progress: percent }).catch(() => {});
          },
        });

        const output: OutputAsset = {
          id: id("out"),
          sourceMediaItemId: item.id,
          conversionJobId: next.id,
          filename: result.filename,
          mimeType: result.mimeType,
          fileSize: result.blob.size,
          storagePath: `idb://${next.id}`,
          createdAt: new Date().toISOString(),
        };
        await store.putBlob(output.id, result.blob);
        await store.putOutput(output);
        await mark({ status: "complete", progress: 100, completedAt: new Date().toISOString() });
      } catch (error) {
        await mark({
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "The conversion failed.",
          completedAt: new Date().toISOString(),
        });
      } finally {
        queueRunning = false;
      }
    })();

    return () => { cancelled = true; };
  }, [state.jobs, refresh]);

  /** Hands back the bytes for saving. */
  const download = useCallback(async (assetId: string, filename: string) => {
    const blob = await store.getBlob(assetId);
    if (!blob) {
      setState((prev) => ({ ...prev, error: "Those bytes are no longer in the Vault." }));
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  return {
    ...state, refresh, importFile, removeMedia, toggleFavorite,
    queueJob, cancelJob, retryJob, download,
  };
}
