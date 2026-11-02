/**
 * Where the guidance model comes from.
 *
 * Until now the repo knew the *shape* of its guidance model — a GGUF at
 * `public/models/bonsai-1.7b/bonsai-1.7b.gguf`, about so many megabytes, built
 * into Ollama by the Modelfile beside it — but not where to get one. The
 * workflow that fetches it asked a person to paste a download URL, and the
 * README explained how to find one. So the repo could describe the model it
 * wanted and could not go and get it, and the one fact that would have closed
 * that gap — which published build is the right one — lived only in the head
 * of whoever ran the workflow.
 *
 * That fact is now here: `prism-ml/Bonsai-1.7B-gguf` on Hugging Face. Both the
 * local script and the GitHub workflow resolve through this file, so there is
 * one answer to "which model is Jackie's guide", and it is written down.
 *
 * Plain JavaScript with no dependencies, so `scripts/fetch-guidance-weights.mjs`
 * runs it under bare node and `src/test/guidance-weights-source.test.ts` imports
 * this exact file. There is no second copy to drift.
 */

/** The Hugging Face repository the weights are published in. */
export const HF_REPO = "prism-ml/Bonsai-1.7B-gguf";

/** Where the file lands in this repo, relative to the repo root. */
export const WEIGHTS_PATH = "public/models/bonsai-1.7b/bonsai-1.7b.gguf";

/** The model registry file that advertises the size to users. */
export const REGISTRY_PATH = "src/lib/microai/models.ts";

/**
 * Which quantisation to take, best first.
 *
 * A GGUF repo publishes the same model at several precisions and they are not
 * interchangeable: the smallest is a few hundred megabytes and noticeably
 * worse, the largest is several gigabytes and will not ship inside a web app's
 * `public/`. Q4_K_M is the usual middle — the smallest quantisation that still
 * answers in coherent sentences — so it is first, and the rest fan out either
 * side of it rather than simply ascending by size.
 *
 * Matching is on the filename, lowercased, because publishers are not
 * consistent about case (`Q4_K_M`, `q4_k_m`) and the tag is the only part of
 * the name that reliably says what the file is.
 */
export const QUANT_PREFERENCE = [
  "q4_k_m",
  "q4_k_s",
  "q5_k_m",
  "q5_k_s",
  "q4_0",
  "q6_k",
  "q8_0",
  "q3_k_m",
  "q3_k_s",
  "q2_k",
  "iq4_xs",
  "iq3_xxs",
  "iq2_xxs",
  "q1_0",
  "iq1_s",
  "f16",
  "bf16",
  "f32",
];

/**
 * Bigger than this and it is not shipping inside a web app's `public/`.
 *
 * A full-precision 1.7B GGUF is several gigabytes. Committing one through LFS
 * is slow, spends real quota, and produces an app nobody can clone — and it
 * would happen silently, because a full-precision file is a perfectly valid
 * GGUF of a perfectly plausible size. So it has to be asked for by name.
 */
export const MAX_AUTO_BYTES = 2 * 1024 * 1024 * 1024;

/** The Hugging Face API URL that lists what a repo contains. */
export function apiUrl(repo = HF_REPO) {
  return `https://huggingface.co/api/models/${repo}`;
}

/** The direct download URL of one file in the repo. */
export function downloadUrl(filename, repo = HF_REPO) {
  return `https://huggingface.co/${repo}/resolve/main/${filename}?download=true`;
}

/**
 * Picks the GGUF to download out of everything the repo publishes.
 *
 * Two things are refused rather than guessed at.
 *
 * A *sharded* model — `…-00001-of-00003.gguf` — is several files that only mean
 * anything together. Taking the first one would produce a file with the right
 * extension, the right magic bytes and roughly a plausible size, which Ollama
 * would then fail to load for a reason that points nowhere near the download.
 * So a shard is skipped, and if shards are all there is, this says so.
 *
 * A repo whose quantisations are all unfamiliar is not a failure either: the
 * unknown ones are ranked after every known one but still offered, because a
 * new quantisation tag is a far more likely explanation than a broken repo.
 *
 * @param {Array<{rfilename?: string, size?: number}>} siblings  from the HF API
 * @param {string} [preferred] force a quantisation, e.g. "q5_k_m"
 */
export function chooseWeights(siblings, preferred) {
  if (!Array.isArray(siblings)) {
    return { ok: false, reason: "the model index had no file list" };
  }

  const ggufs = siblings
    .map((s) => (typeof s?.rfilename === "string" ? { name: s.rfilename, size: s?.size } : null))
    .filter((f) => f && f.name.toLowerCase().endsWith(".gguf"));

  if (ggufs.length === 0) {
    return { ok: false, reason: "the repository publishes no .gguf files" };
  }

  const whole = ggufs.filter((f) => !/-\d{5}-of-\d{5}\.gguf$/i.test(f.name));
  if (whole.length === 0) {
    return {
      ok: false,
      reason:
        "every .gguf in the repository is a shard of a split model. Merge them with " +
        "`llama-gguf-split --merge` and pass the result with --url.",
    };
  }

  if (preferred) {
    const want = preferred.toLowerCase();
    const match = whole.find((f) => f.name.toLowerCase().includes(want));
    if (!match) {
      return {
        ok: false,
        reason: `no file matching '${preferred}'. Available: ${whole.map((f) => f.name).join(", ")}`,
      };
    }
    return { ok: true, file: match.name, size: match.size, quant: want };
  }

  // A file carrying no quantisation tag at all is the full-precision build the
  // others were made from. It is the largest thing in the repo and the worst
  // possible automatic choice, so it ranks below even the tags we do not
  // recognise — which is how `prism-ml/Bonsai-1.7B-gguf` reads: it publishes
  // `Bonsai-1.7B-Q1_0.gguf` and `Bonsai-1.7B.gguf`, and before this the two
  // tied and the winner was decided by alphabetical order.
  const UNKNOWN = QUANT_PREFERENCE.length;
  const UNTAGGED = QUANT_PREFERENCE.length + 1;

  const rank = (name) => {
    const lower = name.toLowerCase();
    const i = QUANT_PREFERENCE.findIndex((q) => lower.includes(q));
    if (i !== -1) return i;
    return /[-_.]q\d|[-_.]iq\d|[-_.]f\d\d|[-_.]bf\d\d/i.test(lower) ? UNKNOWN : UNTAGGED;
  };

  // Ties break on size first — among builds we cannot rank by name, the smaller
  // one is the safer guess — and then on the name, so a repo publishing two
  // equally ranked files of equal size resolves the same way on every run
  // rather than depending on the order the API happened to return.
  const sorted = [...whole].sort(
    (a, b) =>
      rank(a.name) - rank(b.name) ||
      (Number(a.size) || Infinity) - (Number(b.size) || Infinity) ||
      a.name.localeCompare(b.name),
  );
  const picked = sorted[0];
  const lower = picked.name.toLowerCase();
  const quant = QUANT_PREFERENCE.find((q) => lower.includes(q));

  if (Number(picked.size) > MAX_AUTO_BYTES) {
    return {
      ok: false,
      reason:
        `the smallest build published is ${picked.name} at ${toMB(picked.size)} MB, ` +
        `which is too large to ship inside the app. Ask for it by name with ` +
        `--quant, or point --url at a smaller build.`,
    };
  }

  return {
    ok: true,
    file: picked.name,
    size: picked.size,
    quant: quant ?? "unknown",
    alternatives: sorted.slice(1).map((f) => f.name),
  };
}

/** Bytes to whole megabytes, the unit the app advertises. */
export function toMB(bytes) {
  return Math.round(Number(bytes) / (1024 * 1024));
}

/**
 * Rewrites the size the app advertises so it matches the file actually here.
 *
 * The registry's `sizeMB` feeds the Model Bay budget, the station probe and the
 * Guide panel. Downloading a build of a different size and leaving that number
 * alone would have every one of those describe a file that is not on disk —
 * which is precisely the lie `checkGuideWeights` exists to prevent. Returns the
 * new source, or null when nothing needed changing.
 */
export function withRegistrySize(source, sizeMB) {
  const pattern = /(id:\s*"bonsai-1\.7b",[\s\S]*?sizeLabel:\s*")[^"]*(",\s*sizeMB:\s*)(\d+)/;
  const found = pattern.exec(source);
  if (!found) return null;
  if (Number(found[3]) === sizeMB) return null;
  return source.replace(pattern, `$1~${sizeMB} MB$2${sizeMB}`);
}
