#!/usr/bin/env node
/**
 * Brings single-file HTML artifacts into the Artifact Library (/artifacts in the
 * app; the files live in public/artifact-library/).
 *
 *   node scripts/import-artifacts.mjs <file-or-folder>...                    # dry run: report only
 *   node scripts/import-artifacts.mjs <file-or-folder>... --render --write   # apply, with titles and thumbnails
 *
 * Options:
 *   --write            write public/artifact-library/ (without it nothing is touched)
 *   --render           open each new artifact in headless Chromium to read its
 *                      heading and take a thumbnail (needs Playwright)
 *   --chromium <path>  Chromium binary, when Playwright's own is not installed
 *   --out <dir>        output folder (default public/artifact-library)
 *
 * A file next to an artifact with the same name and a .json extension is read
 * as its provenance: {"id": "<Google Drive file id>", "title": "<name in Drive>",
 * "modified": "<ISO date>"}. Without one, the file's own name is used.
 *
 * What it does, and why:
 *
 * 1. Every file is addressed by its SHA-256, so the same artifact saved twice
 *    (Drive kept many copies) is stored once, under every name it had, and
 *    running the import again only adds what is new.
 * 2. A real-looking credential stops the whole run. This repository is public;
 *    `scanSecrets` explains how example keys are told apart from real ones.
 * 3. Artifacts are stored gzip-compressed as `files/<id>.bin`, not as .html.
 *    That keeps them a third of the size, and — the reason that matters — a
 *    .bin is downloaded, never rendered, if someone opens its URL directly. An
 *    .html file here would run on this app's own origin, beside the signed-in
 *    session; the library only ever runs an artifact inside a sandboxed frame
 *    with no origin at all.
 * 4. With --render, each artifact is opened offline (requests to other hosts
 *    are refused, so nothing leaves this machine during an import) and its
 *    first heading becomes its title. Uncaught errors are counted and kept, so
 *    the gallery can say which artifacts failed when they were imported instead
 *    of letting a person discover it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import {
  CATALOG_VERSION,
  blockingSecrets,
  buildClusters,
  classifyPage,
  clusterKeyFor,
  detectFeatures,
  idFromSha,
  nameFromFile,
  pickTitle,
  scanSecrets,
  sourceDocument,
  untitledSource,
  validateCatalog,
} from "./artifact-catalog.mjs";

// Same units as the library page shows (1 MB = 1024 × 1024 bytes).
const mib = (n) => (n / 1048576).toFixed(1);

function parseArgs(argv) {
  const opts = { inputs: [], write: false, render: false, chromium: process.env.ARTIFACT_CHROMIUM ?? null, out: "public/artifact-library" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") opts.write = true;
    else if (a === "--render") opts.render = true;
    else if (a === "--chromium") opts.chromium = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else opts.inputs.push(a);
  }
  if (!opts.inputs.length) throw new Error("name at least one artifact file or folder");
  return opts;
}

function listHtml(inputs) {
  const files = [];
  for (const input of inputs) {
    const p = resolve(input);
    if (!existsSync(p)) throw new Error(`not found: ${input}`);
    if (statSync(p).isDirectory()) {
      for (const name of readdirSync(p).sort()) if (/\.html?$/i.test(name)) files.push(join(p, name));
    } else if (/\.html?$/i.test(p)) files.push(p);
    else throw new Error(`not an .html file: ${input}`);
  }
  return files;
}

function readSidecar(file) {
  const side = join(dirname(file), `${basename(file, extname(file))}.json`);
  if (!existsSync(side)) return null;
  try {
    return JSON.parse(readFileSync(side, "utf8"));
  } catch (err) {
    throw new Error(`${side} is not valid JSON: ${err.message}`);
  }
}

function loadCatalog(out) {
  const p = join(out, "catalog.json");
  if (!existsSync(p)) return { version: CATALOG_VERSION, items: [], clusters: [] };
  const catalog = JSON.parse(readFileSync(p, "utf8"));
  const problems = validateCatalog(catalog);
  if (problems.length) throw new Error(`existing ${p} is invalid:\n  ${problems.join("\n  ")}`);
  return catalog;
}

async function launchChromium(executablePath) {
  let mod;
  try {
    mod = await import("@playwright/test");
  } catch {
    mod = await import("playwright");
  }
  return mod.chromium.launch(executablePath ? { executablePath } : {});
}

// Runs inside the page. Finds the text the artifact presents as its name: a
// visible heading, else the most prominent short line in the top part of the
// screen, which is where these apps put their name when they have no <h1>.
function readHeading() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  // innerText runs "SEED VAULT" and a "v0.1" badge together; joining the text
  // nodes with spaces keeps them apart. Collapsing whitespace happens later.
  const textOf = (el) => {
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  };
  const bodyChars = (document.body?.innerText || "").trim().length;
  for (const sel of ["h1", "h2", "[role=heading]", "h3"]) {
    for (const el of document.querySelectorAll(sel)) {
      const t = textOf(el);
      if (/[A-Za-z]{2}/.test(t) && visible(el)) return { heading: t, text: bodyChars, title: document.title };
    }
  }
  let best = null;
  let score = 0;
  const fold = window.innerHeight * 0.4;
  for (const el of document.body ? document.body.querySelectorAll("*") : []) {
    if (el.children.length) continue;
    const t = (el.innerText || "").trim();
    if (t.length < 3 || t.length > 60 || !/[A-Za-z]{3}/.test(t) || !visible(el)) continue;
    if (el.getBoundingClientRect().top > fold) continue;
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize);
    if (size < 11) continue;
    const weighted = size * (Number(s.fontWeight) >= 600 ? 1.15 : 1);
    if (weighted > score) {
      score = weighted;
      best = t;
    }
  }
  return { heading: best, text: bodyChars, title: document.title };
}

async function renderOne(browser, file, thumbPath) {
  const context = await browser.newContext({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 0.4 });
  const page = await context.newPage();
  const errors = [];
  let blocked = 0;
  page.on("pageerror", (err) => errors.push(String(err?.message ?? err).slice(0, 200)));
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file:") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    blocked++;
    return route.abort();
  });
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(readHeading);
    if (thumbPath) await page.screenshot({ path: thumbPath, type: "jpeg", quality: 60 });
    return {
      heading: seen.heading ?? (seen.title || null),
      render: { errors: errors.length, firstError: errors[0] ?? null, textChars: seen.text, blockedRequests: blocked },
    };
  } catch (err) {
    return { heading: null, render: { errors: errors.length + 1, firstError: String(err.message).slice(0, 200), textChars: 0, blockedRequests: blocked } };
  } finally {
    await context.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const out = resolve(opts.out);
  const catalog = loadCatalog(out);
  const skipped = new Map((catalog.skipped ?? []).map((s) => [s.sha256, s]));
  // Every file already accounted for, by the hash of the file as it was read:
  // an artifact's own hash, the original a recovered source came from, or a
  // page that was looked at and left out.
  // Two saved code views can differ by a byte of page chrome and hold the same
  // source, so one recovered source may have several originals; all of them
  // are remembered, or the next run would see the second as new.
  const seen = new Map();
  const byId = new Map(catalog.items.map((item) => [item.id, item]));
  for (const item of catalog.items) for (const sha of item.derivedFrom ?? [item.sha256]) seen.set(sha, item);
  for (const s of skipped.values()) seen.set(s.sha256, s);
  const files = listHtml(opts.inputs);
  const tmp = mkdtempSync(join(tmpdir(), "artifact-import-"));

  const fresh = new Map();
  const blocked = [];
  let duplicates = 0;
  for (const file of files) {
    const original = readFileSync(file);
    const originalSha = createHash("sha256").update(original).digest("hex");
    const side = readSidecar(file);
    const name = side?.title ?? basename(file);
    const existing = seen.get(originalSha);
    if (existing) {
      duplicates++;
      if (!existing.names.includes(name)) existing.names.push(name);
      continue;
    }
    const page = classifyPage(original.toString("utf8"));
    if (page.kind === "skip") {
      const entry = { sha256: originalSha, title: page.title ?? nameFromFile(name), names: [name], reason: page.reason };
      skipped.set(originalSha, entry);
      seen.set(originalSha, entry);
      continue;
    }
    // A recovered source is stored as the clean page made from it, so that
    // page is what gets hashed, scanned and published.
    const sourceTitle = page.kind === "source" ? page.title ?? nameFromFile(name) ?? untitledSource(page.language) : null;
    const bytes = page.kind === "source" ? Buffer.from(sourceDocument({ title: sourceTitle, code: page.code })) : original;
    const sha256 = page.kind === "source" ? createHash("sha256").update(bytes).digest("hex") : originalSha;
    const id = idFromSha(sha256);
    const same = byId.get(id) ?? fresh.get(id);
    if (same) {
      duplicates++;
      if (!same.names.includes(name)) same.names.push(name);
      if (same.derivedFrom && !same.derivedFrom.includes(originalSha)) same.derivedFrom.push(originalSha);
      seen.set(originalSha, same);
      continue;
    }
    const html = bytes.toString("utf8");
    const secrets = blockingSecrets(scanSecrets(html));
    if (secrets.length) {
      blocked.push({ file, kinds: [...new Set(secrets.map((s) => s.kind))] });
      continue;
    }
    let path = file;
    if (page.kind === "source") {
      path = join(tmp, `${id}.html`);
      writeFileSync(path, bytes);
    }
    const item = {
      id,
      sha256,
      kind: page.kind,
      language: page.kind === "source" ? page.language : null,
      derivedFrom: page.kind === "source" ? [originalSha] : null,
      title: "",
      heading: page.kind === "source" ? sourceTitle : null,
      names: [name],
      source: side?.id ? "drive" : "file",
      sourceId: side?.id ?? null,
      modified: side?.modified ?? null,
      bytes: bytes.length,
      storedBytes: 0,
      file: `files/${id}.bin`,
      thumb: null,
      cluster: "",
      features: detectFeatures(html),
      render: null,
      _path: path,
      _html: html,
      _bytes: bytes,
    };
    fresh.set(id, item);
    seen.set(originalSha, item);
  }

  const sources = [...fresh.values()].filter((i) => i.kind === "source").length;
  const newlySkipped = skipped.size - (catalog.skipped ?? []).length;
  console.log(`${files.length} files read: ${fresh.size} new (${sources} of them recovered source), ${duplicates} already in the library or repeated, ${newlySkipped} left out.`);
  for (const s of skipped.values()) if (!(catalog.skipped ?? []).includes(s)) console.log(`  left out ${s.names[0]}: ${s.reason}`);
  if (blocked.length) {
    console.error(`\nRefusing to import: ${blocked.length} file(s) contain what looks like a real credential.`);
    console.error("Remove the key from the file (and revoke it — it has been on disk in the clear), then run again.");
    for (const b of blocked) console.error(`  ${b.file}: ${b.kinds.join(", ")}`);
    rmSync(tmp, { recursive: true, force: true });
    process.exitCode = 1;
    return;
  }

  if (opts.write) {
    mkdirSync(join(out, "files"), { recursive: true });
    mkdirSync(join(out, "thumbs"), { recursive: true });
  }

  if (opts.render && fresh.size) {
    const browser = await launchChromium(opts.chromium);
    const version = browser.version();
    const queue = [...fresh.values()];
    let done = 0;
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const thumbPath = opts.write ? join(out, "thumbs", `${item.id}.jpg`) : null;
        const shown = await renderOne(browser, item._path, thumbPath);
        // A recovered source's page heading is the notice above the code; its
        // name came from the code itself.
        if (item.kind !== "source") item.heading = shown.heading;
        item.render = { ...shown.render, chromium: version, offline: true };
        if (thumbPath && existsSync(thumbPath)) item.thumb = `thumbs/${item.id}.jpg`;
        if (++done % 25 === 0) console.log(`  rendered ${done}/${fresh.size}`);
      }
    };
    try {
      await Promise.all([worker(), worker(), worker(), worker()]);
    } finally {
      await browser.close();
    }
  }

  for (const item of fresh.values()) {
    item.title = pickTitle({ heading: item.heading, fileName: item.names[0], html: item._html });
    const gz = gzipSync(item._bytes, { level: 9 });
    item.storedBytes = gz.length;
    if (opts.write) writeFileSync(join(out, item.file), gz);
    delete item._path;
    delete item._html;
    delete item._bytes;
  }

  const items = [...catalog.items, ...fresh.values()];
  // Groups are recomputed for everything on every run, so a change to how
  // items are grouped reaches the ones imported before it.
  for (const item of items) item.cluster = clusterKeyFor(item);
  const next = {
    version: CATALOG_VERSION,
    generatedAt: new Date().toISOString(),
    count: items.length,
    bytes: items.reduce((n, i) => n + i.bytes, 0),
    storedBytes: items.reduce((n, i) => n + i.storedBytes, 0),
    items: items.sort((a, b) => a.id.localeCompare(b.id)),
    clusters: buildClusters(items),
    skipped: [...skipped.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)),
  };
  rmSync(tmp, { recursive: true, force: true });
  const problems = validateCatalog(next);
  if (problems.length) throw new Error(`refusing to write an invalid catalog:\n  ${problems.join("\n  ")}`);

  const failed = [...fresh.values()].filter((i) => i.render && i.render.errors > 0).length;
  console.log(`Library: ${next.count} artifacts in ${next.clusters.length} groups, ${mib(next.bytes)} MB as HTML, ${mib(next.storedBytes)} MB stored.`);
  if (opts.render) console.log(`${failed} of ${fresh.size} new artifacts threw an uncaught error when opened.`);
  if (opts.write) {
    writeFileSync(join(out, "catalog.json"), `${JSON.stringify(next, null, 1)}\n`);
    console.log(`Wrote ${join(opts.out, "catalog.json")}.`);
  } else {
    console.log("Dry run: nothing written. Add --write to apply.");
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
