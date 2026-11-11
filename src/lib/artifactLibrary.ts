/**
 * The Artifact Library's runtime: reading the catalog `scripts/import-artifacts.mjs`
 * writes, unpacking one artifact, proving it is the file that was imported, and
 * preparing it to run in a sandbox (docs/ARTIFACTS.md).
 *
 * The sandbox is the point of all of this. An artifact is a whole HTML app,
 * written by an AI, sometimes loading scripts from other hosts. Run on this
 * app's own origin it could read the signed-in session out of storage. So every
 * artifact runs in an iframe whose sandbox omits `allow-same-origin`: it gets
 * an opaque origin and can reach nothing of Jackie's.
 *
 * The cost is that an opaque origin has no localStorage — touching it throws —
 * and a third of these artifacts save their state there. `withStorageShim`
 * gives them a working localStorage whose contents the page keeps for them,
 * per artifact, in its own IndexedDB database. IndexedDB itself cannot be
 * given back that way; the library says so on the artifacts that use it.
 */

// Not "/artifacts/": that is the page's own route, and a folder of the same
// name can make a static host answer the page URL with the folder instead.
export const LIBRARY_BASE = "/artifact-library/";

export type ArtifactKind = "artifact" | "source";

export interface ArtifactRender {
  errors: number;
  firstError: string | null;
  textChars: number;
  blockedRequests: number;
  chromium: string;
  offline: boolean;
}

export interface ArtifactItem {
  id: string;
  sha256: string;
  kind: ArtifactKind;
  language: string | null;
  title: string;
  heading: string | null;
  names: string[];
  source: "drive" | "file";
  modified: string | null;
  bytes: number;
  storedBytes: number;
  file: string;
  thumb: string | null;
  cluster: string;
  features: { localStorage: boolean; indexedDB: boolean; network: boolean; scriptHosts: string[]; hosts: string[] };
  render: ArtifactRender | null;
}

export interface ArtifactCluster {
  key: string;
  title: string;
  ids: string[];
  modified: string | null;
}

export interface SkippedPage {
  sha256: string;
  title: string | null;
  names: string[];
  reason: string;
}

export interface ArtifactCatalog {
  version: 1;
  generatedAt: string;
  count: number;
  bytes: number;
  storedBytes: number;
  items: ArtifactItem[];
  clusters: ArtifactCluster[];
  skipped: SkippedPage[];
}

// Both arms name both fields: this project compiles without strictNullChecks,
// where narrowing on `ok` alone does not reach `error`.
export type Verdict<T> = { ok: true; value: T; error?: undefined } | { ok: false; error: string; value?: undefined };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Reads the catalog. A missing or malformed one is a stated failure, not an empty gallery. */
export async function loadCatalog(fetchImpl: Fetch = fetch): Promise<Verdict<ArtifactCatalog>> {
  let res: Response;
  try {
    // The catalog changes on every import; the files it names never change.
    res = await fetchImpl(`${LIBRARY_BASE}catalog.json`, { cache: "no-cache" });
  } catch (err) {
    return { ok: false, error: `Could not reach the artifact catalog: ${(err as Error).message}` };
  }
  if (!res.ok) return { ok: false, error: `The artifact catalog answered ${res.status}. Has anything been imported yet?` };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: "The artifact catalog is not valid JSON." };
  }
  const c = data as Partial<ArtifactCatalog>;
  if (c?.version !== 1 || !Array.isArray(c.items) || !Array.isArray(c.clusters)) {
    return { ok: false, error: `The artifact catalog is in a format this page does not read (version ${String(c?.version)}).` };
  }
  return { ok: true, value: { ...(c as ArtifactCatalog), skipped: c.skipped ?? [] } };
}

const isGzip = (bytes: Uint8Array) => bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot unpack stored artifacts (it has no DecompressionStream). Safari 16.4 or later, or any current Chrome or Firefox, can.");
  }
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fetches one artifact, unpacks it and checks it against the hash the import
 * recorded. A file that does not match is refused rather than run: whatever it
 * is, it is not the artifact that was looked at and secret-scanned.
 *
 * Some hosts decompress a gzip body on the way out on their own; the magic
 * bytes say which happened, so either works.
 */
export async function loadArtifact(item: Pick<ArtifactItem, "file" | "sha256">, fetchImpl: Fetch = fetch): Promise<Verdict<string>> {
  let raw: Uint8Array;
  try {
    const res = await fetchImpl(`${LIBRARY_BASE}${item.file}`);
    if (!res.ok) return { ok: false, error: `The stored file answered ${res.status}.` };
    raw = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return { ok: false, error: `Could not fetch the stored file: ${(err as Error).message}` };
  }
  let bytes: Uint8Array;
  try {
    bytes = isGzip(raw) ? await gunzip(raw) : raw;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const actual = await sha256Hex(bytes);
  if (actual !== item.sha256) {
    return { ok: false, error: `The stored file does not match its fingerprint (expected ${item.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…). It was not opened.` };
  }
  return { ok: true, value: new TextDecoder().decode(bytes) };
}

/** Message types between the library page and an artifact's frame. */
export const STORAGE_MESSAGE = "jackie-artifact-storage";
export const MAX_STORED_CHARS = 4 * 1024 * 1024;

export type StoredData = Record<string, string>;

/**
 * Puts a localStorage in front of the artifact's own scripts. It behaves like
 * the real one — methods, `length`, `key()`, and plain property access, which
 * these artifacts use as often as `getItem` — and after each change posts the
 * whole store to the page, which saves it. sessionStorage gets the same object
 * without the posting, which is exactly its contract: it lasts as long as the
 * tab does.
 */
export function withStorageShim(html: string, initial: StoredData): string {
  // "</script" inside the data would end the script element early.
  const data = JSON.stringify(initial).replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
  const shim = `<script>(function(){
var MSG=${JSON.stringify(STORAGE_MESSAGE)};
function make(seed,persist){
  var s=Object.create(null);for(var k in seed)s[k]=String(seed[k]);var t=0;
  function save(){if(!persist)return;clearTimeout(t);t=setTimeout(function(){try{parent.postMessage({type:MSG,data:Object.assign({},s)},"*")}catch(e){}},150)}
  var api={getItem:function(k){k=String(k);return k in s?s[k]:null},setItem:function(k,v){s[String(k)]=String(v);save()},
    removeItem:function(k){delete s[String(k)];save()},clear:function(){for(var k in s)delete s[k];save()},
    key:function(i){var ks=Object.keys(s);return i>=0&&i<ks.length?ks[i]:null}};
  return new Proxy(api,{
    get:function(o,p){if(p==="length")return Object.keys(s).length;if(typeof p!=="string"||p in o)return o[p];return p in s?s[p]:undefined},
    set:function(o,p,v){if(typeof p!=="string"||p in o)return false;s[p]=String(v);save();return true},
    deleteProperty:function(o,p){if(typeof p==="string"&&p in s){delete s[p];save()}return true},
    has:function(o,p){return p in o||p in s},
    ownKeys:function(){return Object.keys(s)},
    getOwnPropertyDescriptor:function(o,p){return p in s?{value:s[p],writable:true,enumerable:true,configurable:true}:undefined}
  });
}
var local=make(${data},true),session=make({},false);
try{Object.defineProperty(window,"localStorage",{configurable:true,get:function(){return local}})}catch(e){}
try{Object.defineProperty(window,"sessionStorage",{configurable:true,get:function(){return session}})}catch(e){}
try{if(typeof Navigator!=="undefined")delete Navigator.prototype.serviceWorker}catch(e){}
})();</script>`;
  // The last line above: a sandboxed frame may not have a service worker, and
  // merely reading navigator.serviceWorker throws. PWA-style artifacts check
  // `"serviceWorker" in navigator` before registering one; with the property
  // gone that check is false and they carry on, instead of dying at start-up
  // on an error the page would otherwise show as theirs.
  // Before any other script, or an artifact that reads storage while it
  // loads would hit the sandbox's SecurityError first. After the doctype,
  // because anything ahead of it drops the page into quirks mode.
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + shim + html.slice(head.index + head[0].length);
  const root = /<html\b[^>]*>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + shim + html.slice(root.index + root[0].length);
  const doctype = /<!doctype[^>]*>/i.exec(html);
  if (doctype) return html.slice(0, doctype.index + doctype[0].length) + shim + html.slice(doctype.index + doctype[0].length);
  return shim + html;
}

export type FrameMessage =
  | { type: "storage"; data: StoredData }
  | { type: "link"; href: string }
  | { type: "close" };

/**
 * Reads a message from an artifact's frame. Anything that is not from the
 * frame this page opened, or not one of the shapes below, is ignored: the
 * frame runs code this page does not control.
 *
 * The link and close shapes are the ones Meta AI's exporter built into these
 * artifacts. Inside a frame, its wrapper cancels every outbound link click and
 * asks the parent to open the link instead; without an answer, links in an
 * artifact would silently do nothing.
 */
export function readFrameMessage(event: Pick<MessageEvent, "source" | "data">, frame: Window | null): FrameMessage | null {
  if (!frame || event.source !== frame) return null;
  const d = event.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  if (d.type === STORAGE_MESSAGE) {
    const data = d.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    let size = 0;
    const clean: StoredData = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v !== "string") return null;
      size += k.length + v.length;
      clean[k] = v;
    }
    if (size > MAX_STORED_CHARS) return null;
    return { type: "storage", data: clean };
  }
  if (d.type === "ecto:usercontent-link-click" && typeof d.href === "string") {
    try {
      const url = new URL(d.href);
      if (url.protocol === "https:" || url.protocol === "http:") return { type: "link", href: url.href };
    } catch {
      return null;
    }
    return null;
  }
  if (d.type === "ecto:artifact-close-request") return { type: "close" };
  return null;
}

/** Size of a stored-data object as the library counts it against MAX_STORED_CHARS. */
export const storedSize = (data: StoredData) => Object.entries(data).reduce((n, [k, v]) => n + k.length + v.length, 0);

const DB_NAME = "jackie-artifact-storage";
const STORE = "byArtifact";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser has no IndexedDB, so artifacts cannot keep saved data here."));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB refused to open."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error ?? new Error("IndexedDB transaction failed."));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction was aborted."));
    });
  } finally {
    db.close();
  }
}

/** What an artifact has saved, keyed by the artifact's id: two versions of one app do not share a store. */
export async function readStoredData(id: string): Promise<StoredData> {
  const value = await withStore<StoredData | undefined>("readonly", (s) => s.get(id) as IDBRequest<StoredData | undefined>);
  return value ?? {};
}

export async function writeStoredData(id: string, data: StoredData): Promise<void> {
  await withStore("readwrite", (s) => s.put(data, id));
}

export async function eraseStoredData(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

/** The sandbox an artifact runs in. No allow-same-origin, ever: see the top of this file. */
export const ARTIFACT_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock";

/** A file name for downloading an artifact, from its title. */
export function downloadName(item: Pick<ArtifactItem, "title" | "id">): string {
  const base = item.title.replace(/[^\p{L}\p{N} ._-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "artifact";
  return `${base} (${item.id.slice(0, 6)}).html`;
}

/** Human-readable byte counts for the header and the cards. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface LibraryFilter {
  query: string;
  savesData: boolean;
  network: boolean;
  source: boolean;
  failed: boolean;
}

/** True when an import recorded that the artifact threw, or rendered nothing at all. */
export const failedAtImport = (item: ArtifactItem) => !!item.render && (item.render.errors > 0 || item.render.textChars === 0);

/** The clusters a filter keeps, each with the versions that matched. */
export function filterClusters(catalog: ArtifactCatalog, f: LibraryFilter): { cluster: ArtifactCluster; items: ArtifactItem[] }[] {
  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  const q = f.query.trim().toLowerCase();
  const out: { cluster: ArtifactCluster; items: ArtifactItem[] }[] = [];
  for (const cluster of catalog.clusters) {
    const items = cluster.ids
      .map((id) => byId.get(id))
      .filter((i): i is ArtifactItem => !!i)
      .filter((i) => {
        if (f.savesData && !(i.features.localStorage || i.features.indexedDB)) return false;
        if (f.network && !i.features.network) return false;
        if (f.source && i.kind !== "source") return false;
        if (f.failed && !failedAtImport(i)) return false;
        if (!q) return true;
        return [i.title, i.heading ?? "", ...i.names, i.id].some((s) => s.toLowerCase().includes(q));
      });
    if (items.length) out.push({ cluster, items });
  }
  return out;
}
