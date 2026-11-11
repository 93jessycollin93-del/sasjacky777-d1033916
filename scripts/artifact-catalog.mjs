/**
 * The pure half of `scripts/import-artifacts.mjs`: everything that decides what
 * an artifact is called, what it does, and whether it may be published at all.
 * Kept free of the filesystem and the browser so `src/test/artifact-catalog.test.ts`
 * can pin each decision down.
 *
 * The artifacts are single-file HTML apps exported from AI chats. Two facts
 * about them shape this file:
 *
 * - Almost all of them are titled "React Artifact" or "Artifact". A gallery of
 *   three hundred cards with the same name is useless, so a title comes from
 *   what the artifact actually renders (its first heading), then from a name a
 *   person gave the file, and only then from the generic export name.
 * - This repository is public. An artifact that carries a working API key would
 *   publish it, so a real-looking credential stops the import. Example values
 *   (`sk-proj-xxxx…`, `gsk_xxxx…`) are everywhere in these files and are not
 *   credentials; they are told apart by how little variety their characters have.
 */

/** Titles the exporters stamp on everything; they say nothing about the artifact. */
const GENERIC_TITLES = new Set([
  "",
  "artifact",
  "react artifact",
  "react app",
  "document",
  "untitled",
  "index",
  "app",
  "vite + react",
  "vite + react + ts",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a title is an exporter's default or a bare id rather than a name. */
export function isGenericTitle(title) {
  if (typeof title !== "string") return true;
  const t = title.trim().toLowerCase().replace(/\s+/g, " ");
  if (GENERIC_TITLES.has(t)) return true;
  if (UUID_RE.test(t)) return true;
  if (/^\d+$/.test(t)) return true;
  // "React Artifact 172", "Artifact (3)", "React_Artifact-57": numbered defaults.
  if (/^(react )?artifact[\s(]*\d+\)?$/.test(t)) return true;
  return false;
}

/**
 * Turns a file name into something a person would call it, or null when the
 * name is only an exporter default.
 *
 * Drive and the chat upload path both mangle names: underscores for spaces,
 * `_x5f_` for an underscore, a numeric or uuid prefix on uploads.
 */
export function nameFromFile(fileName) {
  if (typeof fileName !== "string") return null;
  let name = fileName.split(/[\\/]/).pop() ?? "";
  name = name.replace(/\.html?$/i, "");
  name = name.replace(/_x5f_/gi, "_");
  // Upload paths prefix an 8-hex-digit id: "01f93307-React_Artifact91".
  name = name.replace(/^[0-9a-f]{8}-(?=.)/i, "");
  // A Drive copy suffix ("-2") on an otherwise real name is not part of the name.
  name = name.replace(/([A-Za-z])-\d$/, "$1");
  name = name.replace(/[_]+/g, " ").replace(/\s*-\s*(?=\d+$)/, " ").replace(/\s+/g, " ").trim();
  return isGenericTitle(name) ? null : name;
}

/** The document's own <title>, unless it is a generic export title. */
export function staticTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html ?? "");
  if (!m) return null;
  const t = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return isGenericTitle(t) ? null : t;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Longest title the gallery shows before the card would wrap into a paragraph. */
export const MAX_TITLE = 80;

function tidy(text) {
  if (typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || isGenericTitle(t)) return null;
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1).trimEnd()}…` : t;
}

/**
 * Picks the name a card shows. What the artifact renders wins, because that is
 * what the person saw when they made it; a name they gave the file is next; the
 * document <title> after that. Never returns an empty string.
 */
export function pickTitle({ heading, fileName, html }) {
  return tidy(heading) ?? nameFromFile(fileName) ?? tidy(staticTitle(html)) ?? UNTITLED;
}

export const UNTITLED = "Untitled artifact";

/** The name recovered source gets when nothing in it names it. */
export const untitledSource = (language) => `Untitled ${language && language !== "text" ? `${language} ` : ""}source`;

/** True for the names given to things that have none of their own. */
export const isFallbackTitle = (title) => title === UNTITLED || /^Untitled (?:\w+ )?source$/.test(title ?? "");

/**
 * The group an item goes in. Items with no name of their own share nothing but
 * that, so each stays on its own card; grouping them put twenty unrelated apps
 * behind one "Untitled artifact" card, with nineteen of them out of sight.
 */
export function clusterKeyFor(item) {
  return isFallbackTitle(item.title) ? `untitled-${item.id}` : clusterKey(item.title);
}

/**
 * The key versions of one artifact share. Artifacts were saved again and again
 * as they were worked on, so the same app turns up a dozen times under the same
 * heading; grouping them is what makes three hundred files browsable.
 */
export function clusterKey(title) {
  return String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bv(?:ersion)?\s*\d+(?:\.\d+)*\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() || "untitled";
}

const HOST_RE = /\b(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?(?=[/"'`\s)?#]|$)/gi;
const IGNORED_HOSTS = new Set(["www.w3.org", "w3.org", "reactjs.org", "react.dev", "fb.me"]);

/**
 * What an artifact reaches for, read from its source. The gallery shows these
 * so a person knows before opening one that it saves data (which the sandbox
 * changes) or talks to the network.
 */
export function detectFeatures(html) {
  const src = html ?? "";
  const scriptHosts = new Set();
  for (const m of src.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const host = hostOf(m[1]);
    if (host) scriptHosts.add(host);
  }
  const hosts = new Set();
  for (const m of src.matchAll(HOST_RE)) {
    const host = m[1].toLowerCase();
    if (!IGNORED_HOSTS.has(host) && !/\.(?:js|css|png|jpg|svg|html)$/.test(host)) hosts.add(host);
  }
  return {
    localStorage: /\b(?:localStorage|sessionStorage)\b/.test(src),
    indexedDB: /\bindexedDB\b/.test(src),
    network: /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bnew\s+EventSource\b/.test(src),
    scriptHosts: [...scriptHosts].sort(),
    hosts: [...hosts].sort().slice(0, 40),
  };
}

function hostOf(url) {
  try {
    const u = new URL(url, "https://placeholder.invalid/");
    return u.hostname === "placeholder.invalid" ? null : u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

const SECRET_PATTERNS = [
  { kind: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g, prefix: 7 },
  { kind: "OpenAI-style API key", re: /\bsk-(?!ant-)(?:proj-|or-v1-|or-)?[A-Za-z0-9_-]{20,}/g, prefix: 3 },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, prefix: 4 },
  { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, prefix: 4 },
  { kind: "xAI API key", re: /\bxai-[A-Za-z0-9]{20,}\b/g, prefix: 4 },
  { kind: "Groq API key", re: /\bgsk_[A-Za-z0-9]{20,}\b/g, prefix: 4 },
  { kind: "Hugging Face token", re: /\bhf_[A-Za-z0-9]{30,}\b/g, prefix: 3 },
  { kind: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g, prefix: 4 },
  { kind: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, prefix: 5 },
  { kind: "Stripe live key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g, prefix: 8 },
  { kind: "Telegram bot token", re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g, prefix: 0 },
  { kind: "Supabase secret key", re: /\bsb_secret_[A-Za-z0-9_-]{10,}\b/g, prefix: 10 },
  { kind: "Private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, prefix: null },
];

/**
 * Example values ("sk-proj-xxxxxxxxxxxx", "gsk_your_key_here_000") have almost
 * no variety in their characters; a real key drawn from base62 has plenty. Ten
 * distinct characters is far below what twenty random base62 characters ever
 * produce and far above any placeholder seen in these files.
 */
export function looksLikePlaceholder(value, prefixLength = 0) {
  const body = value.slice(prefixLength).replace(/^(?:proj-|or-v1-|or-)/, "");
  if (/x{6,}|X{6,}|0{8,}|your|example|placeholder|here|dummy|redacted|fake|test/i.test(body)) return true;
  return new Set(body).size < 10;
}

/**
 * Every credential-shaped string in a file. A finding never carries the value:
 * the import prints these, and printing a key to a terminal log is one more
 * place it leaks to.
 */
export function scanSecrets(text) {
  const findings = [];
  for (const { kind, re, prefix } of SECRET_PATTERNS) {
    for (const m of (text ?? "").matchAll(re)) {
      const value = m[0];
      const placeholder = prefix === null ? false : looksLikePlaceholder(value, prefix);
      findings.push({ kind, offset: m.index ?? 0, length: value.length, placeholder });
    }
  }
  return findings.sort((a, b) => a.offset - b.offset);
}

/** The findings that must stop an artifact from being published. */
export function blockingSecrets(findings) {
  return findings.filter((f) => !f.placeholder);
}

function metaContent(html, property) {
  const re = new RegExp(`<meta[^>]+property=["']${property}["'][^>]*content=["']([^"']*)["']`, "i");
  return re.exec(html)?.[1] ?? null;
}

/**
 * Pulls the source out of a saved code view: the page shows the code through
 * Shiki, one `<span class="line">` per line, with the colours in CSS variables.
 * Returns the code as plain text, or null when there is no Shiki block.
 */
export function extractShikiCode(html) {
  const m = /<pre class="shiki[^"]*"[^>]*>([\s\S]*?)<\/pre>/i.exec(html ?? "");
  if (!m) return null;
  const lines = [...m[1].matchAll(/<span class="line">([\s\S]*?)<\/span>(?=\s*(?:<span class="line">|<\/code>|$))/g)].map((l) =>
    decodeEntities(l[1].replace(/<[^>]+>/g, "")),
  );
  const code = lines.join("\n").replace(/\s+$/, "");
  return code ? code : null;
}

/** "SeedVault" from `export default function SeedVault()`, spaced for a title. */
export function componentName(code) {
  const m =
    /export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/.exec(code ?? "") ??
    /export\s+default\s+([A-Z][A-Za-z0-9_]*)\s*;?\s*$/m.exec(code ?? "") ??
    /(?:function|const)\s+([A-Z][A-Za-z0-9_]*)\s*(?:=\s*\(|\()/.exec(code ?? "");
  if (!m || /^(App|Component|Main|Root)$/.test(m[1])) return null;
  return m[1].replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

/** The language of recovered source, for the badge on its card. */
export function sourceLanguage(code) {
  const c = code ?? "";
  if (/^\s*[[{]/.test(c)) {
    try {
      JSON.parse(c);
      return "json";
    } catch {
      /* not JSON after all */
    }
  }
  if (/^#!.*\b(?:ba|z)?sh\b/.test(c)) return "shell";
  if (/^#!.*python|^\s*(?:from \S+ import|import \w+$|def \w+\(|class \w+[(:])/m.test(c) && !/\bconst\b|=>/.test(c)) return "python";
  if (/\bimport\b[^\n]*\bfrom\s+["']|=>|\bconst\b|\bfunction\b/.test(c)) return /<[A-Za-z][^>]*>/.test(c) ? "jsx" : "javascript";
  return "text";
}

/**
 * A name for recovered source: the component it exports, else the first
 * comment or docstring line that reads like a description, else a "name" or
 * "title" field when the source is JSON. Null when it has none of them.
 */
export function sourceTitle(code) {
  const fromComponent = componentName(code);
  if (fromComponent) return fromComponent;
  // A line counts when it is a comment, or the first line inside a docstring
  // whose opening quotes sit on a line of their own.
  let insideDocstring = false;
  for (const raw of String(code ?? "").split("\n").slice(0, 15)) {
    const t = raw.trim();
    if (!t || t.startsWith("#!")) continue;
    const isComment = /^(?:#|\/\/|\/\*|\*|"""|''')/.test(t);
    const line = t.replace(/^(?:#+|\/\/+|\/\*+|\*+|"""|''')\s*/, "").replace(/\s*(?:"""|'''|\*\/)$/, "").trim();
    if ((isComment || insideDocstring) && line.length >= 6 && line.length <= MAX_TITLE && /[A-Za-z]{3}/.test(line)) return line;
    insideDocstring = t === '"""' || t === "'''";
  }
  // Only a top-level field names the document; the first "name" anywhere in a
  // list of records is just its first record.
  try {
    const doc = JSON.parse(code);
    const named = doc && !Array.isArray(doc) && typeof doc === "object" ? doc.title ?? doc.name : null;
    return typeof named === "string" && named.trim().length >= 3 ? tidy(named) : null;
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A plain page that shows extracted source as text. No scripts at all: the
 * saved code view carried the whole claude.ai front end, which cannot run here
 * and has no business being republished.
 */
export function sourceDocument({ title, code }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:#16181d;color:#e1e4e8;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
header{padding:12px 16px;border-bottom:1px solid #2c313a;font:13px/1.4 system-ui,sans-serif;color:#9aa4b2}
pre{margin:0;padding:16px;overflow:auto;white-space:pre;tab-size:2}
</style></head><body>
<header>Source code, recovered from a saved code view. It is shown as text: it was never built into a running app.</header>
<pre><code>${escapeHtml(code)}</code></pre>
</body></html>
`;
}

/**
 * What a saved HTML file actually is. Most are artifacts. Some are pages saved
 * from a site that only *shows* an artifact — a share page, a chat — and those
 * hold the site's own front end and a frame whose content lives on the site's
 * servers: opened here they show a spinner and nothing else. Saying so is
 * better than a gallery card that opens onto an empty frame.
 */
export function classifyPage(html) {
  const src = html ?? "";
  const site = metaContent(src, "og:site_name");
  const title = staticTitle(src);
  if (site === "Twitch" || /assets\.twitch\.tv/.test(src)) {
    return { kind: "skip", title, reason: "a saved Twitch page, not an artifact" };
  }
  if (site === "ChatGPT" || /chatgpt\.com\/share\//.test(src)) {
    return { kind: "skip", title, reason: "a saved ChatGPT conversation page; the conversation loads from chatgpt.com" };
  }
  if (/user-generated and unverified|user generated and unverified/i.test(src)) {
    return { kind: "skip", title, reason: "a saved share page; the artifact it shows loads from the share site, so the copy is an empty frame" };
  }
  if (/\/_next\/static\//.test(src) && /metaaiusercontent\.com|\bmeta\.ai\b/.test(src)) {
    return { kind: "skip", title, reason: "a saved Meta AI page; its content loads from meta.ai, so the copy is an empty frame" };
  }
  // A code view has a line-number gutter beside one Shiki block. A rendered
  // document can hold Shiki blocks too (its code samples), and taking the first
  // of those as "the source" would throw the document away.
  if (/\/_next\/static\//.test(src) && /aria-hidden="true"><div>1<\/div><div>2<\/div>/.test(src)) {
    const code = extractShikiCode(src);
    if (code) return { kind: "source", code, title: sourceTitle(code), language: sourceLanguage(code) };
  }
  return { kind: "artifact" };
}

/** Content address: the first 16 hex digits of the SHA-256. Collisions at 64 bits across a few thousand files are not a real risk. */
export function idFromSha(sha256) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`not a sha256 hex digest: ${sha256}`);
  return sha256.slice(0, 16);
}

/**
 * Groups items into clusters and orders everything the way the gallery shows
 * it: clusters by their newest version, versions newest first. Items without a
 * date sort after dated ones, in a stable order, rather than pretending to a
 * date they do not have.
 */
export function buildClusters(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = item.cluster;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }
  const newest = (a, b) => {
    if (a.modified && b.modified) return b.modified.localeCompare(a.modified);
    if (a.modified) return -1;
    if (b.modified) return 1;
    return a.id.localeCompare(b.id);
  };
  const clusters = [...byKey.entries()].map(([key, versions]) => {
    versions.sort(newest);
    return { key, title: versions[0].title, ids: versions.map((v) => v.id), modified: versions[0].modified ?? null };
  });
  clusters.sort((a, b) => newest({ ...a, id: a.key }, { ...b, id: b.key }));
  return clusters;
}

export const CATALOG_VERSION = 1;

/**
 * Checks a catalog the way the page will read it, so a malformed import fails
 * here instead of as a blank gallery. Returns problems in words, never throws.
 */
export function validateCatalog(catalog) {
  const problems = [];
  if (!catalog || typeof catalog !== "object") return ["catalog is not an object"];
  if (catalog.version !== CATALOG_VERSION) problems.push(`version is ${catalog.version}, expected ${CATALOG_VERSION}`);
  if (!Array.isArray(catalog.items)) return [...problems, "items is not a list"];
  if (!Array.isArray(catalog.clusters)) problems.push("clusters is not a list");
  const ids = new Set();
  for (const item of catalog.items) {
    if (!/^[0-9a-f]{16}$/.test(item?.id ?? "")) problems.push(`bad id: ${item?.id}`);
    else if (ids.has(item.id)) problems.push(`duplicate id: ${item.id}`);
    else ids.add(item.id);
    if (!/^[0-9a-f]{64}$/.test(item?.sha256 ?? "")) problems.push(`${item?.id}: bad sha256`);
    else if (item.sha256.slice(0, 16) !== item.id) problems.push(`${item.id}: id is not the start of its sha256`);
    if (typeof item?.title !== "string" || !item.title) problems.push(`${item?.id}: no title`);
    if (item?.kind !== "artifact" && item?.kind !== "source") problems.push(`${item?.id}: unknown kind ${item?.kind}`);
    if (item?.file !== `files/${item?.id}.bin`) problems.push(`${item?.id}: file path ${item?.file} does not match id`);
  }
  if (catalog.skipped !== undefined && !Array.isArray(catalog.skipped)) problems.push("skipped is not a list");
  for (const cluster of catalog.clusters ?? []) {
    for (const id of cluster.ids ?? []) if (!ids.has(id)) problems.push(`cluster ${cluster.key} names unknown id ${id}`);
  }
  return problems;
}
