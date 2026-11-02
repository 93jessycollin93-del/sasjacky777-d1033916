#!/usr/bin/env node
/**
 * The host attachment.
 *
 * Drop this folder next to a build and run it. Nothing to install, no
 * dependencies, no network — the product serves itself from disk, which is the
 * only kind of hosting that matches a system whose whole claim is that it works
 * with the radio off.
 *
 *   node host/serve.mjs ./dist
 *   node host/serve.mjs ./dist --port 4321 --host 0.0.0.0
 *
 * The decisions worth getting right are separated from the I/O below and
 * exported, so the parts that can be wrong quietly — path traversal, which
 * requests fall back to a shell, what may be cached forever — are covered by
 * tests rather than by reading the code and hoping.
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_PORT = 8787;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".gguf": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Paths that must 404 rather than fall back to a shell. */
const NEVER_FALLBACK = ["/api/", "/functions/", "/~oauth"];

export function contentTypeFor(pathname) {
  return CONTENT_TYPES[extname(pathname).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Turns a request URL into a path inside the root, or null.
 *
 * Null means "do not serve this", and the caller treats it as a 404 rather than
 * falling back to anything — a traversal attempt answered with the app shell
 * would return 200, which reads as success.
 *
 * The `..` check runs on the DECODED path and BEFORE normalization, and both
 * halves of that matter. Checking before decoding misses `%2e%2e`. Checking
 * after normalizing misses everything, because `normalize` quietly rewrites
 * `/../../etc/passwd` to `/etc/passwd` — the `..` segments are gone by the time
 * you look, and the request is silently served as a different path than the one
 * asked for. A test caught exactly that here.
 *
 * The containment check below stays as well. It is unreachable while the first
 * check holds, and it is what keeps this safe if the first one is ever loosened.
 */
export function resolveRequestPath(root, url) {
  const raw = String(url ?? "/").split("?")[0].split("#")[0];

  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes("\0")) return null;

  const withSlashes = decoded.replace(/\\/g, "/");
  if (withSlashes.split("/").includes("..")) return null;

  const absoluteRoot = resolve(root);
  const target = resolve(join(absoluteRoot, normalize(withSlashes)));
  if (target !== absoluteRoot && !target.startsWith(absoluteRoot + sep)) return null;

  return target;
}

/**
 * Which shell an unmatched request falls back to.
 *
 * The PC ships under /pc-os/ as a complete build with its own service worker
 * and its own routes. Falling those back to Jackie's shell would leave the PC
 * unable to start in its own tab offline, which is the one situation the
 * fallback exists for.
 */
export function fallbackFor(pathname) {
  if (NEVER_FALLBACK.some((prefix) => pathname.startsWith(prefix))) return null;
  if (extname(pathname)) return null; // a real asset that is simply missing
  if (pathname.startsWith("/pc-os/")) return "/pc-os/index.html";
  return "/index.html";
}

/**
 * Cache headers.
 *
 * A service worker cached for a year cannot be replaced, and the app is then
 * frozen at that build on every device that saw it. Hashed assets are safe to
 * pin forever because their name changes with their content; everything else
 * is revalidated.
 */
export function cacheHeaderFor(pathname) {
  if (pathname.endsWith("/sw.js") || pathname.endsWith("/workbox-sw.js")) return "no-store";
  if (pathname.endsWith(".html") || pathname.endsWith(".webmanifest")) return "no-cache";
  if (/-[A-Za-z0-9_]{8,}\.[a-z0-9]+$/.test(pathname)) return "public, max-age=31536000, immutable";
  return "public, max-age=300";
}

/**
 * Parses a Range header against a known size.
 *
 * Model weights are served from here and are gigabytes; without ranges a
 * resumed download starts over. Returns null for anything not understood, which
 * the caller answers as a normal whole-file response — the safe reading.
 */
export function parseRange(header, size) {
  if (!header || typeof header !== "string") return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start;
  let end;
  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/** Parses argv into options. Exported so the defaults are testable. */
export function parseArgs(argv) {
  const positional = [];
  const options = { port: DEFAULT_PORT, host: "127.0.0.1" };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]) || DEFAULT_PORT;
    else if (arg === "--host") options.host = argv[++i] ?? options.host;
    else if (!arg.startsWith("--")) positional.push(arg);
  }

  return { root: positional[0] ?? "./dist", ...options };
}

function statOrNull(path) {
  try {
    const stats = statSync(path);
    return stats.isDirectory() ? null : stats;
  } catch {
    return null;
  }
}

export function createHost(root) {
  const absoluteRoot = resolve(root);

  return createServer((req, res) => {
    const pathname = String(req.url ?? "/").split("?")[0];

    if (pathname === "/__host/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, root: absoluteRoot, serving: "offline", at: Date.now() }));
      return;
    }

    let target = resolveRequestPath(absoluteRoot, pathname);
    if (target === null) {
      // Never a fallback: answering 200 to a traversal attempt reads as success.
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }

    let servedPath = pathname;
    let stats = statOrNull(target);

    if (!stats && pathname.endsWith("/")) {
      servedPath = `${pathname}index.html`;
      target = resolveRequestPath(absoluteRoot, servedPath);
      stats = target ? statOrNull(target) : null;
    }

    if (!stats) {
      const fallback = fallbackFor(pathname);
      if (fallback) {
        servedPath = fallback;
        target = resolveRequestPath(absoluteRoot, fallback);
        stats = target ? statOrNull(target) : null;
      }
    }

    if (!stats || !target) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }

    const headers = {
      "content-type": contentTypeFor(servedPath),
      "cache-control": cacheHeaderFor(servedPath),
      "accept-ranges": "bytes",
      // The PC embed registers its own worker from its own directory.
      "service-worker-allowed": "/",
    };

    const range = parseRange(req.headers.range, stats.size);
    if (range) {
      res.writeHead(206, {
        ...headers,
        "content-range": `bytes ${range.start}-${range.end}/${stats.size}`,
        "content-length": range.end - range.start + 1,
      });
      if (req.method === "HEAD") return res.end();
      createReadStream(target, { start: range.start, end: range.end }).pipe(res);
      return;
    }

    res.writeHead(200, { ...headers, "content-length": stats.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(target).pipe(res);
  });
}

// Runs only when executed directly, so importing this for tests starts nothing.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const { root, port, host } = parseArgs(process.argv.slice(2));
  const absoluteRoot = resolve(root);

  try {
    statSync(join(absoluteRoot, "index.html"));
  } catch {
    console.error(`No index.html in ${absoluteRoot}. Build first, or point at the build directory.`);
    process.exit(1);
  }

  createHost(absoluteRoot).listen(port, host, () => {
    console.log(`Jackie is hosting itself from ${absoluteRoot}`);
    console.log(`  http://${host}:${port}`);
    console.log(`  http://${host}:${port}/workstation   the whole system, one flow`);
    console.log(`  http://${host}:${port}/__host/health`);
  });
}

export const __testing = { fileURLToPath };
