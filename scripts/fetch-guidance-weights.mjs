#!/usr/bin/env node
/**
 * Fetch the guidance model's weights into this repo.
 *
 *   npm run weights                      # the pinned build, best quantisation
 *   npm run weights -- --quant q5_k_m    # a specific quantisation
 *   npm run weights -- --list            # what the repo publishes, download nothing
 *   npm run weights -- --url https://…   # a build from somewhere else entirely
 *   npm run weights -- --sha256 <hex>    # check you got the file you meant
 *
 * The source is pinned in `scripts/guidance-weights-source.mjs`, so this needs
 * no arguments in the normal case: the repo knows which model it wants.
 *
 * Everything it refuses, it refuses before writing anything into the tree. A
 * quarter of a gigabyte of HTML error page committed through LFS is expensive
 * to notice and expensive to undo, and the failure it produces later — Ollama
 * declining to build a model — names nothing about the download.
 *
 * It also rewrites `sizeMB` in the model registry to the size of the file it
 * actually fetched. That number is what the Model Bay, the station probe and
 * the Guide panel all tell the user, and a registry describing a file that is
 * not on disk is the one thing this part of the app must never do.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HF_REPO,
  REGISTRY_PATH,
  WEIGHTS_PATH,
  apiUrl,
  chooseWeights,
  downloadUrl,
  toMB,
  withRegistrySize,
} from "./guidance-weights-source.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = { quant: null, url: null, sha256: null, list: false, keepSize: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") options.list = true;
    else if (arg === "--keep-size") options.keepSize = true;
    else if (arg === "--quant") options.quant = argv[++i] ?? null;
    else if (arg === "--url") options.url = argv[++i] ?? null;
    else if (arg === "--sha256") options.sha256 = (argv[++i] ?? "").toLowerCase() || null;
  }
  return options;
}

function die(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    die(
      `${url} → HTTP ${res.status}. ` +
        (res.status === 404
          ? `Is '${HF_REPO}' the right repository, and is it public?`
          : "Check the network and try again."),
    );
  }
  return res.json();
}

/**
 * Streams the download to a temporary file beside the target.
 *
 * Never straight onto the real path: a download interrupted halfway would
 * otherwise leave a truncated GGUF exactly where a valid one belongs, and
 * nothing downstream distinguishes "half a model" from "a model".
 */
async function download(url, target, expectedSha) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) die(`${url} → HTTP ${res.status}`);
  if (!res.body) die(`${url} returned no body`);

  const total = Number(res.headers.get("content-length") ?? 0);
  if (total) console.log(`  ${toMB(total)} MB to fetch`);

  const temp = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  await rm(temp, { force: true });

  const hash = createHash("sha256");
  let seen = 0;
  let lastReport = 0;

  const source = Readable.fromWeb(res.body);
  source.on("data", (chunk) => {
    hash.update(chunk);
    seen += chunk.length;
    if (total && seen - lastReport > 25 * 1024 * 1024) {
      lastReport = seen;
      process.stdout.write(`\r  ${Math.round((seen / total) * 100)}% …`);
    }
  });

  await pipeline(source, createWriteStream(temp));
  if (total) process.stdout.write("\r  100%      \n");

  const digest = hash.digest("hex");
  if (expectedSha && digest !== expectedSha) {
    await rm(temp, { force: true });
    die(`SHA-256 mismatch.\n  expected ${expectedSha}\n  got      ${digest}`);
  }

  return { temp, bytes: seen, sha256: digest };
}

/**
 * Is this actually a GGUF?
 *
 * Every GGUF starts with the four bytes "GGUF". An HTML error page, a
 * rate-limit notice and an LFS pointer all download happily with a 200 and none
 * of them do. Four bytes is the whole check and it catches every one of them.
 */
async function assertGguf(path) {
  const handle = await readFile(path, { encoding: null, flag: "r" }).catch(() => null);
  if (!handle) die(`could not read ${path} back after downloading it`);
  const magic = handle.subarray(0, 4).toString("latin1");
  if (magic !== "GGUF") {
    await rm(path, { force: true });
    die(
      `that is not a GGUF file — it starts with ${JSON.stringify(magic)}.\n` +
        "  The URL probably served an HTML page rather than the file itself.",
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const target = join(ROOT, WEIGHTS_PATH);

  let url = options.url;
  let chosen = null;

  if (!url) {
    console.log(`Reading ${HF_REPO} …`);
    const index = await getJson(apiUrl());
    chosen = chooseWeights(index?.siblings, options.quant);
    if (!chosen.ok) die(chosen.reason);

    console.log(`  publishes: ${[chosen.file, ...(chosen.alternatives ?? [])].join(", ")}`);
    console.log(`  taking:    ${chosen.file}  (${chosen.quant})`);
    if (options.list) {
      console.log(`\n  npm run weights -- --quant <tag>   to take a different one\n`);
      return;
    }
    url = downloadUrl(chosen.file);
  } else if (options.list) {
    die("--list and --url do not go together: --url names the file already.");
  }

  console.log(`\nDownloading …`);
  const { temp, bytes, sha256 } = await download(url, target, options.sha256);
  await assertGguf(temp);

  const mb = toMB(bytes);
  if (mb < 100) {
    await rm(temp, { force: true });
    die(`${mb} MB is too small to be a 1.7B model. Refusing to install it.`);
  }

  await rename(temp, target);
  console.log(`\n✓ ${WEIGHTS_PATH} — ${mb} MB`);
  console.log(`  sha256 ${sha256}`);

  if (!options.keepSize) {
    const registry = join(ROOT, REGISTRY_PATH);
    const source = await readFile(registry, "utf8");
    const updated = withRegistrySize(source, mb);
    if (updated) {
      await writeFile(registry, updated);
      console.log(`✓ ${REGISTRY_PATH} — sizeMB now ${mb}, matching the file on disk`);
    }
  }

  const onDisk = await stat(target);
  if (onDisk.size !== bytes) die("the file changed size after being written — try again");

  console.log(`
Next, on the machine that runs the app:

  ollama create bonsai-1.7b -f public/models/bonsai-1.7b/Modelfile

To commit it, the weights go in through Git LFS — .gitattributes already
tracks them, but the filter has to be installed on this machine:

  git lfs install
  git add ${WEIGHTS_PATH} ${REGISTRY_PATH}
  git commit -m "Add the Bonsai 1.7B guidance weights"
`);
}

main().catch((e) => die(e?.stack || String(e)));
