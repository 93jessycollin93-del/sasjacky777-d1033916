// Local Bridge — Jackie's connection to the operator's own terminal.
//
// Design rule: fully offline. The browser talks straight to a helper process on
// the same machine (default http://127.0.0.1:7717). No cloud, no tunnel, no
// edge function in the path. If the network is down the bridge still works,
// because both ends are localhost.
//
// The helper is a single dependency-free Node script the operator saves and runs
// themselves (see AGENT_SCRIPT). It refuses to run without a shared token and
// records every command it executes.

export type BridgeConfig = {
  /** Base URL of the local helper. Must be a loopback address. */
  baseUrl: string;
  /** Shared token; the helper rejects requests without it. */
  token: string;
  /** Default shell the helper should use. */
  shell: "powershell" | "cmd" | "bash";
  /** Ask before running anything not in the read-only command list. */
  confirmWrites: boolean;
};

const CFG_KEY = "jackie.bridge.config.v1";

export const DEFAULT_CONFIG: BridgeConfig = {
  baseUrl: "http://127.0.0.1:7717",
  token: "",
  shell: "powershell",
  confirmWrites: true,
};

export function loadBridgeConfig(): BridgeConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<BridgeConfig>) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveBridgeConfig(cfg: BridgeConfig) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* keep UI alive */
  }
}

export function isLoopback(url: string) {
  try {
    const u = new URL(url);
    return ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Commands that only read state — safe to run without a confirmation step. */
const READ_ONLY = [
  /^ollama\s+(list|ps|show)\b/i,
  /^nvidia-smi\b/i,
  /^get-(computerinfo|disk|physicaldisk|volume|ciminstance|itemproperty|childitem|content|process|service|netadapter)\b/i,
  /^systeminfo\b/i,
  /^wmic\b/i,
  /^dir\b/i,
  /^ls\b/i,
  /^cat\b/i,
  /^lsblk\b/i,
  /^df\b/i,
  /^smartctl\s+-[ai]\b/i,
  /^sfc\s+\/verifyonly\b/i,
];

export function isReadOnlyCommand(command: string) {
  const c = command.trim();
  return READ_ONLY.some((re) => re.test(c));
}

export type BridgeStatus =
  | { state: "unknown" }
  | { state: "offline"; detail: string }
  | { state: "unauthorized"; detail: string }
  | { state: "online"; host: string; platform: string; shell: string; version: string };

async function call<T>(cfg: BridgeConfig, path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Token": cfg.token,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || `HTTP ${resp.status}` };
    }
    if (!resp.ok) {
      const err = (data as { error?: string }).error || `HTTP ${resp.status}`;
      throw Object.assign(new Error(err), { status: resp.status });
    }
    return data as T;
  } finally {
    clearTimeout(t);
  }
}

export async function pingBridge(cfg: BridgeConfig): Promise<BridgeStatus> {
  if (!isLoopback(cfg.baseUrl)) {
    return { state: "offline", detail: "Base URL is not a loopback address. The bridge only talks to this machine." };
  }
  if (!cfg.token) return { state: "unauthorized", detail: "No token set. Paste the token the helper printed on start." };
  try {
    const d = await call<{ host: string; platform: string; shell: string; version: string }>(cfg, "/health", undefined, 6000);
    return { state: "online", ...d };
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 401) return { state: "unauthorized", detail: "Helper rejected the token." };
    return {
      state: "offline",
      detail:
        err.name === "AbortError"
          ? "No answer from the helper (timed out). Is it running?"
          : err.message || "Could not reach the helper.",
    };
  }
}

export type ExecResult = {
  command: string;
  shell: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  durationMs: number;
};

export async function execOnBridge(
  cfg: BridgeConfig,
  command: string,
  opts: { shell?: BridgeConfig["shell"]; cwd?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return call<ExecResult>(
    cfg,
    "/exec",
    { command, shell: opts.shell || cfg.shell, cwd: opts.cwd },
    opts.timeoutMs ?? 120000,
  );
}

/** Raw directory listing through the helper — used by the model scanner. */
export async function listPathOnBridge(cfg: BridgeConfig, path: string): Promise<{ entries: { name: string; path: string; size: number; isDir: boolean }[] }> {
  return call(cfg, "/ls", { path });
}

/** The suggested support/conclusion label for a finished command. */
export function suggestConclusion(r: ExecResult): { status: "supports" | "contradicts" | "inconclusive"; conclusion: string } {
  const out = `${r.stdout}\n${r.stderr}`.trim();
  if (r.exitCode !== 0) {
    return {
      status: "contradicts",
      conclusion: `\`${r.command}\` exited ${r.exitCode} — the assumption that this command reports cleanly on this machine does not hold.`,
    };
  }
  if (!out) {
    return { status: "inconclusive", conclusion: `\`${r.command}\` returned no output — nothing confirmed or ruled out.` };
  }
  return {
    status: "supports",
    conclusion: `\`${r.command}\` ran clean; its output is the observed state at ${new Date(r.startedAt).toISOString()}.`,
  };
}

/**
 * The local helper, as a single file. No npm install, no dependencies —
 * Node 18+ only. Save as jackie-bridge.mjs and run:
 *   node jackie-bridge.mjs
 */
export const AGENT_SCRIPT = String.raw`// jackie-bridge.mjs — Jackie's local terminal bridge. Node 18+, zero deps.
// Loopback only. Requires the token it prints on start. Logs every command.
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { readdir, stat, appendFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir, hostname, platform } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = Number(process.env.JACKIE_BRIDGE_PORT || 7717);
const TOKEN = process.env.JACKIE_BRIDGE_TOKEN || randomBytes(16).toString('hex');
const LOG_DIR = join(homedir(), '.jackie-bridge');
const LOG = join(LOG_DIR, 'commands.log');
const DEFAULT_SHELL = platform() === 'win32' ? 'powershell' : 'bash';
// Origins allowed to talk to the bridge. Add your own if you self-host.
const ALLOWED = [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/, /\.lovable\.app$/, /\.lovableproject\.com$/];

await mkdir(LOG_DIR, { recursive: true });

function cors(req, res) {
  const origin = req.headers.origin || '';
  const ok = !origin || ALLOWED.some((re) => re.test(origin));
  if (ok && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-bridge-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return ok;
}
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => {
  let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } });
});

function run(command, shell, cwd) {
  const started = new Date();
  const opts = { cwd: cwd || homedir(), maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: 10 * 60 * 1000 };
  if (shell === 'powershell') { opts.shell = 'powershell.exe'; }
  else if (shell === 'cmd') { opts.shell = process.env.COMSPEC || 'cmd.exe'; }
  else { opts.shell = '/bin/bash'; }
  return new Promise((done) => {
    exec(command, opts, (err, stdout, stderr) => done({
      command, shell,
      exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
      stdout: String(stdout || ''), stderr: String(stderr || (err ? err.message : '')),
      startedAt: started.toISOString(), durationMs: Date.now() - started.getTime(),
    }));
  });
}

createServer(async (req, res) => {
  const originOk = cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(originOk ? 204 : 403); return res.end(); }
  if (!originOk) return json(res, 403, { error: 'origin not allowed' });
  if (req.headers['x-bridge-token'] !== TOKEN) return json(res, 401, { error: 'bad token' });

  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    return json(res, 200, { host: hostname(), platform: platform(), shell: DEFAULT_SHELL, version: '1.0.0' });
  }
  if (url.pathname === '/exec' && req.method === 'POST') {
    const { command, shell, cwd } = await readBody(req);
    if (!command || typeof command !== 'string') return json(res, 400, { error: 'missing command' });
    const result = await run(command, shell || DEFAULT_SHELL, cwd);
    await appendFile(LOG, JSON.stringify({ ts: result.startedAt, command, shell: result.shell, exitCode: result.exitCode }) + '\n');
    console.log('[' + result.startedAt + '] exit ' + result.exitCode + ' :: ' + command);
    return json(res, 200, result);
  }
  if (url.pathname === '/ls' && req.method === 'POST') {
    const { path } = await readBody(req);
    if (!path) return json(res, 400, { error: 'missing path' });
    try {
      const root = resolve(path.replace(/^~/, homedir()));
      const names = await readdir(root);
      const entries = [];
      for (const name of names) {
        try {
          const s = await stat(join(root, name));
          entries.push({ name, path: join(root, name), size: s.size, isDir: s.isDirectory() });
        } catch { /* unreadable */ }
      }
      return json(res, 200, { entries });
    } catch (e) { return json(res, 400, { error: String(e && e.message || e) }); }
  }
  return json(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => {
  console.log('Jackie bridge listening on http://127.0.0.1:' + PORT);
  console.log('TOKEN: ' + TOKEN);
  console.log('Command log: ' + LOG);
});
`;
