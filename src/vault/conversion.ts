/**
 * Turning a conversion job into ffmpeg arguments, and running it.
 *
 * `services.ts` already had `conversionService.createJob`, which built a job
 * object with `status: 'waiting'`. Nothing ever picked one up. There was no
 * worker, no ffmpeg, no queue — a job was created, marked waiting, and waited
 * for ever. That is the half of the Vault that was missing; the other half was
 * that nothing was stored at all (see `storage.ts`).
 *
 * ## Why it runs in the browser
 *
 * Supabase edge functions are Deno isolates with no ffmpeg binary and no way to
 * ship one, so a server-side conversion would mean a container, a queue and an
 * upload of the source media. This project's posture is that media stays on the
 * device unless there is a reason for it to leave, and converting your own
 * voice note is not one. ffmpeg compiled to WebAssembly does the same work on
 * the machine that already holds the file.
 *
 * The core is 31 MB and loads on the first conversion, never before —
 * the same arrangement as the on-device model in
 * `src/lib/microai/deviceEngine.ts`, and excluded from the PWA precache by the
 * same `**\/*.wasm` rule for the same reason.
 *
 * ## Arguments are derived, never guessed
 *
 * `buildArgs` is pure and exported so every preset's command line is asserted in
 * a test. A preset that silently produces the wrong flags gives you a file that
 * opens and is wrong, which is worse than one that fails.
 */
import { CONVERSION_PRESETS, type ConversionJob, type ConversionPreset, type MediaItem } from "./types";

export interface ConversionPlan {
  args: string[];
  outputName: string;
  outputMime: string;
}

/** Extension for a mime the presets use. */
function extensionFor(mime: string, fallback: string): string {
  switch (mime) {
    case "audio/mpeg": return "mp3";
    case "audio/mp4": return "m4a";
    case "audio/wav": return "wav";
    case "image/jpeg": return "jpg";
    case "video/mp4": return "mp4";
    default: return fallback;
  }
}

export function findPreset(key: string): ConversionPreset | undefined {
  return CONVERSION_PRESETS.find((preset) => preset.key === key);
}

/**
 * The command line for one job.
 *
 * `outputFormat: 'same'` means keep the container — trims and bitrate drops
 * should not silently transcode a WAV into an MP3 just because the preset had
 * to name something.
 */
export function buildArgs(job: ConversionJob, item: MediaItem, inputName: string): ConversionPlan {
  const preset = findPreset(job.presetKey);
  const sourceExt = (item.originalFilename.split(".").pop() || "bin").toLowerCase();

  const keepContainer = job.outputFormat === "same" || !job.outputFormat;
  const outputMime = keepContainer ? item.mimeType : job.outputFormat;
  const ext = keepContainer ? sourceExt : extensionFor(job.outputFormat, sourceExt);
  const base = item.originalFilename.replace(/\.[^/.]+$/, "");
  const outputName = `${base}_${job.presetKey}.${ext}`;

  const args: string[] = [];

  // Trim flags go before -i so ffmpeg seeks rather than decoding and discarding
  // everything up to the start point.
  if (typeof job.trimStart === "number" && job.trimStart > 0) args.push("-ss", String(job.trimStart));
  args.push("-i", inputName);
  if (typeof job.trimEnd === "number" && job.trimEnd > (job.trimStart ?? 0)) {
    args.push("-t", String(job.trimEnd - (job.trimStart ?? 0)));
  }

  const bitrate = job.targetBitrate ?? preset?.defaultBitrate;

  switch (job.actionType) {
    case "convert_mp3":
      args.push("-vn", "-c:a", "libmp3lame", "-b:a", `${bitrate ?? 192}k`);
      break;
    case "convert_m4a":
      args.push("-vn", "-c:a", "aac", "-b:a", `${bitrate ?? 256}k`);
      break;
    case "convert_wav":
      args.push("-vn", "-c:a", "pcm_s16le");
      break;
    case "normalize_audio":
      // EBU R128 via loudnorm, which is the standard broadcasters use, rather
      // than peak normalisation — the latter makes a quiet recording no louder
      // if it contains one loud click.
      args.push("-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "libmp3lame", "-b:a", `${bitrate ?? 192}k`);
      break;
    case "compress_mobile":
      args.push("-c:v", "libx264", "-preset", "veryfast", "-b:v", `${bitrate ?? 1000}k`, "-c:a", "aac", "-b:a", "128k");
      break;
    case "lower_bitrate":
      if (item.mimeType.startsWith("audio/")) args.push("-c:a", "libmp3lame", "-b:a", `${bitrate ?? 500}k`);
      else args.push("-c:v", "libx264", "-preset", "veryfast", "-b:v", `${bitrate ?? 500}k`, "-c:a", "copy");
      break;
    case "trim_clip":
      // Stream copy: a trim should not re-encode, which would cost quality and
      // minutes for an operation that removes bytes.
      args.push("-c", "copy");
      break;
    case "strip_audio":
      args.push("-an", "-c:v", "copy");
      break;
    case "extract_thumbnail":
      args.push("-frames:v", "1", "-q:v", "3");
      break;
    case "telegram_profile_photo":
      args.push("-frames:v", "1", "-vf", "crop='min(iw,ih)':'min(iw,ih)',scale=800:800", "-q:v", "3");
      break;
    case "telegram_profile_video":
      args.push(
        "-t", String(Math.min(preset?.telegramMeta?.maxDuration ?? 10, job.trimEnd ?? 10)),
        "-vf", "crop='min(iw,ih)':'min(iw,ih)',scale=800:800",
        "-an",
        "-c:v", "libx264", "-preset", "veryfast",
      );
      break;
    case "telegram_share_optimize":
      args.push("-c:v", "libx264", "-preset", "veryfast", "-b:v", `${bitrate ?? 800}k`, "-c:a", "aac", "-b:a", "96k");
      break;
    default:
      args.push("-c", "copy");
  }

  args.push("-y", outputName);
  return { args, outputName, outputMime };
}

// ── The runtime ────────────────────────────────────────────────────────────

export interface ConversionRuntime {
  load(): Promise<void>;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  exec(args: string[]): Promise<void>;
  readFile(name: string): Promise<Uint8Array>;
  deleteFile(name: string): Promise<void>;
  onProgress(handler: (ratio: number) => void): void;
}

let runtime: ConversionRuntime | null = null;
let loading: Promise<ConversionRuntime> | null = null;

async function realRuntime(): Promise<ConversionRuntime> {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  // Bundled and fingerprinted by Vite, so the core is served from this origin
  // rather than a CDN — the same reason the on-device model's binary is.
  // Imported through the package's own `exports` map ("." and "./wasm") rather
  // than by a deep path into dist/: the deep path is not exported, and Vite
  // refuses to resolve it even inside a dynamic import.
  const coreURL = (await import("@ffmpeg/core?url")).default;
  const wasmURL = (await import("@ffmpeg/core/wasm?url")).default;

  const ffmpeg = new FFmpeg();
  let handler: ((ratio: number) => void) | null = null;
  ffmpeg.on("progress", ({ progress }) => handler?.(progress));

  return {
    load: async () => { await ffmpeg.load({ coreURL, wasmURL }); },
    writeFile: async (name, data) => { await ffmpeg.writeFile(name, data); },
    exec: async (args) => { await ffmpeg.exec(args); },
    readFile: async (name) => (await ffmpeg.readFile(name)) as Uint8Array,
    deleteFile: async (name) => { await ffmpeg.deleteFile(name); },
    onProgress: (h) => { handler = h; },
  };
}

export interface RunOptions {
  onProgress?: (percent: number) => void;
  /** Injected by tests. Real code never passes this. */
  createRuntime?: () => Promise<ConversionRuntime>;
}

/**
 * Runs one job and returns the produced file.
 *
 * Throws with a sentence rather than resolving to an empty blob when ffmpeg
 * produced nothing: a zero-byte output that lands in the library as a finished
 * conversion is the exact failure this codebase keeps having to fix.
 */
export async function runConversion(
  job: ConversionJob,
  item: MediaItem,
  source: Blob,
  options: RunOptions = {},
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  const create = options.createRuntime ?? realRuntime;

  if (!runtime) {
    // Memoised as a promise so two jobs started together share one 31 MB load
    // instead of racing two.
    if (!loading) {
      loading = (async () => {
        const instance = await create();
        await instance.load();
        runtime = instance;
        return instance;
      })();
      loading.catch(() => { loading = null; });
    }
    await loading;
  }

  const engine = runtime!;
  const inputName = `in_${job.id}.${(item.originalFilename.split(".").pop() || "bin").toLowerCase()}`;
  const plan = buildArgs(job, item, inputName);

  engine.onProgress((ratio) => options.onProgress?.(Math.max(0, Math.min(100, Math.round(ratio * 100)))));

  await engine.writeFile(inputName, new Uint8Array(await source.arrayBuffer()));
  try {
    await engine.exec(plan.args);
    const data = await engine.readFile(plan.outputName);
    if (!data || data.length === 0) {
      throw new Error(
        `ffmpeg finished but produced no data for "${plan.outputName}". The source may be unreadable, or the preset may not suit it.`,
      );
    }
    return {
      blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: plan.outputMime }),
      filename: plan.outputName,
      mimeType: plan.outputMime,
    };
  } finally {
    // The virtual filesystem is not cleared between runs, so a long session
    // would otherwise accumulate every source file it had ever touched.
    await engine.deleteFile(inputName).catch(() => {});
    await engine.deleteFile(plan.outputName).catch(() => {});
  }
}

/** Frees the loaded core. Used when leaving the Vault. */
export function resetConversionRuntime(): void {
  runtime = null;
  loading = null;
}
