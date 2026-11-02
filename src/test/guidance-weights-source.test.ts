import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HF_REPO,
  QUANT_PREFERENCE,
  REGISTRY_PATH,
  WEIGHTS_PATH,
  apiUrl,
  chooseWeights,
  downloadUrl,
  MAX_AUTO_BYTES,
  toMB,
  withRegistrySize,
} from "../../scripts/guidance-weights-source.mjs";
import {
  GUIDE_FETCH_COMMAND,
  GUIDE_WEIGHTS_PATH,
  GUIDE_WEIGHTS_SOURCE,
  checkGuideWeights,
} from "@/lib/guide/weights";

/**
 * The repo could describe the guidance model it wanted long before it could go
 * and get one. The path, the size and the Modelfile were all declared; which
 * *published build* was the right one lived only in the head of whoever ran the
 * fetch workflow, which is why that workflow asked a person to paste a URL.
 *
 * It is `prism-ml/Bonsai-1.7B-gguf`. These cover the resolver that turns that
 * name into a file, and the places the name is written down.
 */
describe("the pinned source", () => {
  it("is the model the owner asked for", () => {
    expect(HF_REPO).toBe("prism-ml/Bonsai-1.7B-gguf");
  });

  it("says the same thing to the app as it does to the scripts", () => {
    // The script and the workflow run under bare node and cannot import the
    // app's TypeScript, so the string exists twice. Two copies that must agree
    // are exactly the thing to put a test on.
    expect(GUIDE_WEIGHTS_SOURCE).toBe(HF_REPO);
  });

  it("writes the file where the app looks for it", () => {
    expect(`/${WEIGHTS_PATH}`).toBe(`/public${GUIDE_WEIGHTS_PATH}`);
  });

  it("builds URLs on Hugging Face, for that repo", () => {
    expect(apiUrl()).toBe("https://huggingface.co/api/models/prism-ml/Bonsai-1.7B-gguf");
    expect(downloadUrl("Bonsai-1.7B-Q4_K_M.gguf")).toBe(
      "https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B-Q4_K_M.gguf?download=true",
    );
  });

  it("names the fetch command the app tells people to run", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(GUIDE_FETCH_COMMAND).toBe("npm run weights");
    expect(pkg.scripts.weights).toContain("scripts/fetch-guidance-weights.mjs");
  });
});

const file = (rfilename: string, size?: number) => ({ rfilename, size });

describe("choosing which build to download", () => {
  it("prefers the middle quantisation over the biggest and the smallest", () => {
    // A GGUF repo publishes the same model at several precisions and they are
    // not interchangeable: the smallest is noticeably worse, the largest will
    // not fit in a web app's public/. Taking "the first .gguf" is a coin toss.
    const picked = chooseWeights([
      file("Bonsai-1.7B-Q2_K.gguf"),
      file("Bonsai-1.7B-Q8_0.gguf"),
      file("Bonsai-1.7B-Q4_K_M.gguf"),
      file("Bonsai-1.7B-F16.gguf"),
    ]);
    expect(picked).toMatchObject({ ok: true, file: "Bonsai-1.7B-Q4_K_M.gguf", quant: "q4_k_m" });
  });

  it("does not care how the publisher cased the tag", () => {
    expect(chooseWeights([file("bonsai-1.7b-q4_k_m.gguf")])).toMatchObject({ ok: true });
    expect(chooseWeights([file("Bonsai-1.7B-Q4_K_M.GGUF")])).toMatchObject({ ok: true });
  });

  it("takes the quantisation asked for, when one is asked for", () => {
    const picked = chooseWeights(
      [file("Bonsai-1.7B-Q4_K_M.gguf"), file("Bonsai-1.7B-Q8_0.gguf")],
      "q8_0",
    );
    expect(picked).toMatchObject({ ok: true, file: "Bonsai-1.7B-Q8_0.gguf" });
  });

  it("lists what is there when the quantisation asked for is not", () => {
    const picked = chooseWeights([file("Bonsai-1.7B-Q4_K_M.gguf")], "q3_k_l");
    expect(picked.ok).toBe(false);
    expect(picked.reason).toContain("Bonsai-1.7B-Q4_K_M.gguf");
  });

  it("refuses a split model rather than downloading one piece of it", () => {
    // A shard has the right extension, the right magic bytes and a plausible
    // size. Ollama then fails to load it, for a reason that points nowhere
    // near the download.
    const picked = chooseWeights([
      file("Bonsai-1.7B-Q8_0-00001-of-00003.gguf"),
      file("Bonsai-1.7B-Q8_0-00002-of-00003.gguf"),
      file("Bonsai-1.7B-Q8_0-00003-of-00003.gguf"),
    ]);
    expect(picked.ok).toBe(false);
    expect(picked.reason).toMatch(/shard/i);
    expect(picked.reason).toMatch(/merge/i);
  });

  it("still takes a whole file when shards sit beside it", () => {
    const picked = chooseWeights([
      file("Bonsai-1.7B-F16-00001-of-00002.gguf"),
      file("Bonsai-1.7B-F16-00002-of-00002.gguf"),
      file("Bonsai-1.7B-Q4_K_M.gguf"),
    ]);
    expect(picked).toMatchObject({ ok: true, file: "Bonsai-1.7B-Q4_K_M.gguf" });
  });

  it("accepts an unfamiliar quantisation rather than calling the repo broken", () => {
    // A new tag is a likelier explanation than a broken repository.
    const picked = chooseWeights([file("Bonsai-1.7B-XQ9_Z.gguf")]);
    expect(picked).toMatchObject({ ok: true, file: "Bonsai-1.7B-XQ9_Z.gguf", quant: "unknown" });
  });

  it("knows the tags this model is actually published at", () => {
    // IQ3_XXS used to fall through to "unknown". It is a real quantisation and
    // is now ranked as one, so it is chosen on its merits rather than by
    // alphabetical accident.
    expect(chooseWeights([file("Bonsai-1.7B-IQ3_XXS.gguf")]).quant).toBe("iq3_xxs");
    expect(chooseWeights([file("Bonsai-1.7B-Q1_0.gguf")]).quant).toBe("q1_0");
  });

  it("ranks a known quantisation ahead of an unknown one", () => {
    const picked = chooseWeights([file("Bonsai-1.7B-IQ3_XXS.gguf"), file("Bonsai-1.7B-Q4_K_M.gguf")]);
    expect(picked).toMatchObject({ file: "Bonsai-1.7B-Q4_K_M.gguf" });
  });

  it("resolves the same way twice when two files rank equally", () => {
    const listing = [file("b-Q4_K_M.gguf"), file("a-Q4_K_M.gguf")];
    expect(chooseWeights(listing).file).toBe("a-Q4_K_M.gguf");
    expect(chooseWeights([...listing].reverse()).file).toBe("a-Q4_K_M.gguf");
  });

  it("says so plainly when there is nothing to download", () => {
    expect(chooseWeights([file("README.md"), file("config.json")]).ok).toBe(false);
    expect(chooseWeights([]).ok).toBe(false);
    expect(chooseWeights(undefined).ok).toBe(false);
  });

  it("prefers q4_k_m first — the smallest that still answers in sentences", () => {
    expect(QUANT_PREFERENCE[0]).toBe("q4_k_m");
  });
});

/**
 * What `prism-ml/Bonsai-1.7B-gguf` actually publishes, and the bug it exposed.
 *
 * Two files: `Bonsai-1.7B-Q1_0.gguf` (237 MB) and `Bonsai-1.7B.gguf`, the
 * full-precision build it was quantised from. Neither tag was in the
 * preference list, so both ranked "unknown", tied, and the winner was decided
 * by `localeCompare`. It picked the right one — because "Q" sorts before ".".
 * Rename either file and a multi-gigabyte full-precision build gets committed
 * through LFS instead, silently, because it is a perfectly valid GGUF.
 */
const REAL_REPO = [
  file("Bonsai-1.7B-Q1_0.gguf", 248_302_272),
  file("Bonsai-1.7B.gguf", 3_400_000_000),
];

describe("the repository this is actually pinned to", () => {
  it("takes the quantised build, and knows why", () => {
    expect(chooseWeights(REAL_REPO)).toMatchObject({
      ok: true,
      file: "Bonsai-1.7B-Q1_0.gguf",
      quant: "q1_0",
    });
  });

  it("takes it whichever order the API lists them in", () => {
    // The old tie-break made this a coin toss dressed up as a decision.
    expect(chooseWeights([...REAL_REPO].reverse()).file).toBe("Bonsai-1.7B-Q1_0.gguf");
  });

  it("ranks an untagged full-precision build below even an unfamiliar tag", () => {
    const picked = chooseWeights([
      file("Bonsai-1.7B.gguf", 3_400_000_000),
      file("Bonsai-1.7B-XQ9_Z.gguf", 500_000_000),
    ]);
    expect(picked.file).toBe("Bonsai-1.7B-XQ9_Z.gguf");
  });

  it("prefers the smaller of two builds it cannot rank by name", () => {
    const picked = chooseWeights([
      file("model-XQ9_Z.gguf", 900_000_000),
      file("model-XQ1_A.gguf", 300_000_000),
    ]);
    expect(picked.file).toBe("model-XQ1_A.gguf");
  });

  it("refuses to install something that cannot ship inside the app", () => {
    // A full-precision GGUF has the right magic bytes and a plausible size.
    // Nothing downstream would have objected; it would just have produced a
    // repository nobody can clone.
    const picked = chooseWeights([file("Bonsai-1.7B.gguf", MAX_AUTO_BYTES + 1)]);
    expect(picked.ok).toBe(false);
    expect(picked.reason).toMatch(/too large/i);
    expect(picked.reason).toMatch(/--quant/);
  });

  it("still installs it when it is asked for by name", () => {
    const picked = chooseWeights([file("Bonsai-1.7B.gguf", MAX_AUTO_BYTES + 1)], "bonsai-1.7b.gguf");
    expect(picked.ok).toBe(true);
  });

  it("counts the real file the way the app's own probe counts it", () => {
    // checkGuideWeights does Math.round(length / 1024 / 1024) on the served
    // content-length. Anything else here and the panel and the registry would
    // print two numbers for one file.
    expect(toMB(248_302_272)).toBe(237);
  });
});

describe("keeping the advertised size honest", () => {
  const registry = readFileSync(join(process.cwd(), REGISTRY_PATH), "utf8");
  // Read rather than hardcoded: this number changes whenever the weights are
  // re-fetched at a different quantisation, which is the entire point of it.
  const declared = Number(/id: "bonsai-1\.7b".*?sizeMB:\s*(\d+)/.exec(registry)?.[1]);

  it("reads a size out of the registry at all", () => {
    expect(declared).toBeGreaterThan(0);
  });

  it("rewrites both the number and the label users read", () => {
    // sizeMB feeds the Model Bay budget, the station probe and the Guide panel.
    // Fetching a different quantisation and leaving it alone would have every
    // one of them describe a file that is not on disk — the exact lie
    // checkGuideWeights exists to prevent.
    const updated = withRegistrySize(registry, 1071);
    expect(updated).toContain("sizeMB: 1071");
    expect(updated).toContain('sizeLabel: "~1071 MB"');
    expect(updated).not.toContain(`sizeMB: ${declared},`);
  });

  it("leaves the file alone when the size already matches", () => {
    expect(withRegistrySize(registry, declared)).toBeNull();
  });

  it("matches the weights that are actually committed", () => {
    // The registry and the LFS pointer describe the same file. They disagreed
    // before: the registry said 248 — correct in decimal MB — while the app's
    // own probe divides by 1024 twice and computed 237 from the same bytes.
    //
    // Read from git, not from the working tree: the committed blob is the LFS
    // pointer whether or not LFS has fetched the weights. Reading the file
    // instead loaded 237 MB as text in a checkout that had them — slow enough
    // to time out under a full run — found no pointer in it, and passed
    // without comparing anything.
    const pointer = execFileSync("git", ["cat-file", "-p", `HEAD:${WEIGHTS_PATH}`], { encoding: "utf8" });
    const bytes = Number(/^size (\d+)$/m.exec(pointer)?.[1]);
    expect(bytes, `${WEIGHTS_PATH} is not committed as an LFS pointer`).toBeGreaterThan(0);
    expect(toMB(bytes)).toBe(declared);
  });

  it("touches nothing but the bonsai entry", () => {
    const updated = withRegistrySize(registry, 900) ?? "";
    const others = registry.split("\n").filter((l) => l.includes("sizeMB") && !l.includes("bonsai"));
    for (const line of others) expect(updated).toContain(line);
  });

  it("reports a real repository, not a rewrite of one", () => {
    expect(withRegistrySize("nothing like a registry", 500)).toBeNull();
  });

  it("counts megabytes the way the app does", () => {
    expect(toMB(248 * 1024 * 1024)).toBe(248);
  });
});

describe("what the app says when the weights are not here yet", () => {
  it("names where to get them, because a fresh clone has none", () => {
    // 404 is the expected state of a clone, not a fault. Saying only "HTTP 404"
    // left the one actionable fact — that they are fetched, and from where —
    // out of the only place a user would look.
    const missing = async () => new Response(null, { status: 404 });
    return checkGuideWeights(missing as unknown as typeof fetch).then((found) => {
      expect(found.present).toBe(false);
      expect(found.detail).toContain(GUIDE_WEIGHTS_SOURCE);
      expect(found.detail).toContain(GUIDE_FETCH_COMMAND);
    });
  });

  it("still tells an LFS pointer apart from the weights", async () => {
    const pointer = async () =>
      new Response(null, { status: 200, headers: { "content-length": "133" } });
    const found = await checkGuideWeights(pointer as unknown as typeof fetch);
    expect(found.present).toBe(false);
    expect(found.detail).toMatch(/git lfs pull/);
  });
});
