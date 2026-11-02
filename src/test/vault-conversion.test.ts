import { beforeEach, describe, expect, it } from "vitest";
import {
  buildArgs, findPreset, resetConversionRuntime, runConversion, type ConversionRuntime,
} from "@/vault/conversion";
import { CONVERSION_PRESETS, type ConversionJob, type MediaItem } from "@/vault/types";

/**
 * What the Vault actually does to a file.
 *
 * `conversionService.createJob` built a job with `status: 'waiting'` and
 * nothing ever picked one up — no worker, no ffmpeg, no queue. A job was
 * created, marked waiting, and waited for ever.
 *
 * `buildArgs` is pure so every preset's command line can be asserted here. A
 * preset producing the wrong flags gives you a file that opens and is wrong,
 * which is worse than one that fails.
 */

const video: MediaItem = {
  id: "m1", title: "Interview", originalFilename: "interview.mov",
  sourceType: "uploaded_file", importMethod: "upload", mimeType: "video/quicktime",
  fileSize: 100_000, status: "ready", tags: [], notes: "", isFavorite: false,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

const audio: MediaItem = { ...video, id: "m2", originalFilename: "note.wav", mimeType: "audio/wav" };

function job(overrides: Partial<ConversionJob> = {}): ConversionJob {
  return {
    id: "j1", mediaItemId: "m1", mediaItemTitle: "Interview",
    actionType: "convert_mp3", presetKey: "video_to_mp3", outputFormat: "audio/mpeg",
    normalizationEnabled: false, progress: 0, status: "waiting",
    createdAt: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

describe("the command line for each preset", () => {
  it("extracts audio without video, at the preset's bitrate", () => {
    const plan = buildArgs(job(), video, "in.mov");
    expect(plan.args).toEqual(["-i", "in.mov", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-y", plan.outputName]);
    expect(plan.outputName).toBe("interview_video_to_mp3.mp3");
    expect(plan.outputMime).toBe("audio/mpeg");
  });

  it("normalises to broadcast loudness rather than to peak", () => {
    const plan = buildArgs(job({ actionType: "normalize_audio", presetKey: "audio_cleanup", outputFormat: "audio/mpeg" }), audio, "in.wav");
    // Peak normalisation makes a quiet recording no louder if it contains one
    // loud click; loudnorm is what broadcasters use.
    expect(plan.args).toContain("loudnorm=I=-16:TP=-1.5:LRA=11");
  });

  it("copies streams for a trim instead of re-encoding", () => {
    const plan = buildArgs(
      job({ actionType: "trim_clip", presetKey: "quick_trim", outputFormat: "same", trimStart: 5, trimEnd: 12 }),
      video, "in.mov",
    );
    // Seek before -i, so ffmpeg does not decode and discard the first 5 seconds.
    expect(plan.args.slice(0, 4)).toEqual(["-ss", "5", "-i", "in.mov"]);
    expect(plan.args).toContain("-t");
    expect(plan.args[plan.args.indexOf("-t") + 1]).toBe("7");
    expect(plan.args).toContain("copy");
  });

  it("keeps the container when the preset says 'same'", () => {
    const plan = buildArgs(job({ actionType: "trim_clip", presetKey: "quick_trim", outputFormat: "same" }), audio, "in.wav");
    // A trim must not silently transcode a WAV to MP3 just because the preset
    // had to name something.
    expect(plan.outputName.endsWith(".wav")).toBe(true);
    expect(plan.outputMime).toBe("audio/wav");
  });

  it("lowers bitrate differently for audio and for video", () => {
    const forAudio = buildArgs(job({ actionType: "lower_bitrate", presetKey: "lower_quality", outputFormat: "same" }), audio, "in.wav");
    const forVideo = buildArgs(job({ actionType: "lower_bitrate", presetKey: "lower_quality", outputFormat: "same" }), video, "in.mov");
    expect(forAudio.args).toContain("libmp3lame");
    expect(forVideo.args).toContain("libx264");
  });

  it("crops to a square for a Telegram profile photo", () => {
    const plan = buildArgs(
      job({ actionType: "telegram_profile_photo", presetKey: "tg_profile_photo", outputFormat: "image/jpeg" }),
      video, "in.mov",
    );
    expect(plan.args.join(" ")).toContain("crop='min(iw,ih)':'min(iw,ih)',scale=800:800");
    expect(plan.outputName.endsWith(".jpg")).toBe(true);
  });

  it("mutes and caps a Telegram profile video at its documented limit", () => {
    const plan = buildArgs(
      job({ actionType: "telegram_profile_video", presetKey: "tg_profile_video", outputFormat: "video/mp4" }),
      video, "in.mov",
    );
    expect(plan.args).toContain("-an");
    expect(plan.args[plan.args.indexOf("-t") + 1]).toBe("10");
  });

  it("drops the audio track and copies the video when stripping", () => {
    const plan = buildArgs(job({ actionType: "strip_audio", presetKey: "strip_audio", outputFormat: "video/mp4" }), video, "in.mov");
    expect(plan.args).toContain("-an");
    expect(plan.args).toContain("copy");
  });

  it("honours a bitrate the person chose over the preset's default", () => {
    const plan = buildArgs(job({ targetBitrate: 64 }), video, "in.mov");
    expect(plan.args).toContain("64k");
  });

  it("always writes to a named output and overwrites it", () => {
    for (const preset of CONVERSION_PRESETS) {
      const plan = buildArgs(
        job({ actionType: preset.actionType, presetKey: preset.key, outputFormat: preset.outputFormat }),
        preset.supportedInputTypes.some((t) => t.startsWith("audio")) ? audio : video,
        "in.mov",
      );
      expect(plan.args.at(-2), preset.key).toBe("-y");
      expect(plan.args.at(-1), preset.key).toBe(plan.outputName);
      expect(plan.outputName, preset.key).not.toMatch(/\.$|undefined/);
    }
  });
});

describe("findPreset", () => {
  it("finds every preset the UI offers", () => {
    for (const preset of CONVERSION_PRESETS) expect(findPreset(preset.key)?.key).toBe(preset.key);
  });
});

describe("running one", () => {
  // The loaded core is memoised at module scope so two jobs started together
  // share one 31 MB load rather than racing two. That is right in a browser and
  // leaks between cases here, so each test starts from an unloaded runtime.
  beforeEach(resetConversionRuntime);

  function fakeRuntime(output: Uint8Array): { runtime: ConversionRuntime; calls: string[][] } {
    const calls: string[][] = [];
    return {
      calls,
      runtime: {
        load: async () => {},
        writeFile: async () => {},
        exec: async (args) => { calls.push(args); },
        readFile: async () => output,
        deleteFile: async () => {},
        onProgress: () => {},
      },
    };
  }

  it("returns the produced file with the right type", async () => {
    const { runtime, calls } = fakeRuntime(new Uint8Array([1, 2, 3]));
    const result = await runConversion(job(), video, new Blob([new Uint8Array([9])]), {
      createRuntime: async () => runtime,
    });
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.blob.size).toBe(3);
    expect(calls[0]).toContain("libmp3lame");
  });

  it("treats an empty output as a failure rather than a finished conversion", async () => {
    const { runtime } = fakeRuntime(new Uint8Array([]));
    // A zero-byte file landing in the library as a finished conversion is the
    // exact failure this codebase keeps having to fix.
    await expect(
      runConversion(job({ id: "j2" }), video, new Blob([new Uint8Array([9])]), {
        createRuntime: async () => runtime,
      }),
    ).rejects.toThrow(/produced no data/);
  });
});
