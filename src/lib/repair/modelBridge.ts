// Model Bridge — one GGUF file, every local runner.
//
// LM Studio, Ollama, BionicGPT, llama.cpp and Jan all load the same GGUF
// weights; they only disagree about where the file lives and what metadata
// wraps it. Downloading the same 20 GB model twice is waste, not redundancy.
// This module reads what the operator actually has and emits the exact
// commands to make one copy serve all of them.
//
// Everything here is pure string work on real, observed input — no network, no
// model list invented from memory. It runs with the machine offline.

export type RunnerId = "ollama" | "lmstudio" | "bionicgpt" | "llamacpp" | "jan";

export type RunnerDef = {
  id: RunnerId;
  label: string;
  /** How the runner stores weights — this is what makes conversion possible or not. */
  storage: string;
  /** Default model directory per platform. */
  dir: { windows: string; linux: string; macos: string };
  /** Command that lists what it currently has. */
  listCommand: { windows: string; linux: string };
  notes: string;
};

export const RUNNERS: RunnerDef[] = [
  {
    id: "ollama",
    label: "Ollama",
    storage:
      "Content-addressed blobs. Weights sit in blobs/sha256-… with no extension; manifests in manifests/ map a model name to its blob digests.",
    dir: {
      windows: "%USERPROFILE%\\.ollama\\models",
      linux: "/usr/share/ollama/.ollama/models (service) or ~/.ollama/models",
      macos: "~/.ollama/models",
    },
    listCommand: { windows: "ollama list", linux: "ollama list" },
    notes:
      "Imports any GGUF with a one-line Modelfile (FROM path). Exporting back out means copying the blob and renaming it .gguf — the blob IS a valid GGUF file.",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    storage: "Plain GGUF files in publisher/repo folders, exactly as downloaded from Hugging Face.",
    dir: {
      windows: "%USERPROFILE%\\.lmstudio\\models  (older builds: %USERPROFILE%\\.cache\\lm-studio\\models)",
      linux: "~/.lmstudio/models",
      macos: "~/.lmstudio/models",
    },
    listCommand: { windows: "lms ls", linux: "lms ls" },
    notes:
      "Because files are plain GGUF, LM Studio is the best hub format: point Ollama and llama.cpp at these files instead of duplicating them.",
  },
  {
    id: "bionicgpt",
    label: "BionicGPT",
    storage:
      "No weight store of its own — it talks to an OpenAI-compatible endpoint (LocalAI / Ollama / llama.cpp server) registered as a model in its admin console.",
    dir: { windows: "n/a — endpoint based", linux: "n/a — endpoint based", macos: "n/a — endpoint based" },
    listCommand: { windows: "docker ps --filter name=bionic", linux: "docker ps --filter name=bionic" },
    notes:
      "So 'converting' for BionicGPT means serving the GGUF over an OpenAI-compatible port and registering that base URL + model name. Nothing is copied.",
  },
  {
    id: "llamacpp",
    label: "llama.cpp / llama-server",
    storage: "Any path you hand it. Reads GGUF directly.",
    dir: { windows: "any folder", linux: "any folder", macos: "any folder" },
    listCommand: { windows: "dir *.gguf /s", linux: "find . -name '*.gguf'" },
    notes: "The reference loader. If llama.cpp can open the file, every runner above can.",
  },
  {
    id: "jan",
    label: "Jan",
    storage: "GGUF per-model folder with a model.json descriptor.",
    dir: {
      windows: "%USERPROFILE%\\jan\\models",
      linux: "~/jan/models",
      macos: "~/jan/models",
    },
    listCommand: { windows: "dir %USERPROFILE%\\jan\\models", linux: "ls ~/jan/models" },
    notes: "Needs a model.json next to the GGUF; the weights themselves are unmodified.",
  },
];

export const findRunner = (id: RunnerId) => RUNNERS.find((r) => r.id === id);

/* ------------------------------------------------------------------ */
/* Inventory parsing — real output only                                */
/* ------------------------------------------------------------------ */

export type LocalModel = {
  id: string;
  name: string;
  source: RunnerId;
  /** Absolute path when known. Ollama rows have a digest instead. */
  path?: string;
  digest?: string;
  sizeBytes?: number;
  sizeLabel?: string;
  quant?: string;
};

const SIZE_UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };

function parseSize(label: string): number | undefined {
  const m = label.trim().match(/^([\d.]+)\s*(b|kb|mb|gb|tb)$/i);
  if (!m) return undefined;
  return Math.round(parseFloat(m[1]) * SIZE_UNITS[m[2].toLowerCase()]);
}

export function humanSize(bytes?: number) {
  if (!bytes || bytes <= 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

const QUANT_RE = /(Q\d(?:_[0-9KMSXL]+)*|IQ\d[_A-Z0-9]*|F16|BF16|F32)/i;
export const detectQuant = (s: string) => s.match(QUANT_RE)?.[1]?.toUpperCase();

/** Parse `ollama list` output (tab/space columns: NAME ID SIZE MODIFIED). */
export function parseOllamaList(raw: string): LocalModel[] {
  const out: LocalModel[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^name\s+id\s+size/i.test(t)) continue;
    const m = t.match(/^(\S+)\s+([0-9a-f]{6,})\s+([\d.]+\s*[KMGT]?B)\s*(.*)$/i);
    if (!m) continue;
    out.push({
      id: `ollama:${m[1]}`,
      name: m[1],
      source: "ollama",
      digest: m[2],
      sizeBytes: parseSize(m[3]),
      sizeLabel: m[3].trim(),
      quant: detectQuant(m[1]),
    });
  }
  return out;
}

/**
 * Parse any listing that contains GGUF paths — LM Studio's `lms ls`, a
 * PowerShell `Get-ChildItem -Recurse -Filter *.gguf`, `find`, or `dir /s`.
 * Accepts "<path>  <size>" or bare paths, one per line.
 */
export function parseGgufListing(raw: string, source: RunnerId = "lmstudio"): LocalModel[] {
  const out: LocalModel[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const pathMatch = t.match(/([A-Za-z]:\\[^"'\n]*?\.gguf|\/[^"'\n]*?\.gguf|[^\s"']+\.gguf)/i);
    if (!pathMatch) continue;
    const path = pathMatch[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const sizeLabel = t.replace(path, "").match(/([\d.]+\s*[KMGT]?B)\b/i)?.[1];
    const name = path.split(/[\\/]/).pop()!.replace(/\.gguf$/i, "");
    out.push({
      id: `${source}:${path}`,
      name,
      source,
      path,
      sizeBytes: sizeLabel ? parseSize(sizeLabel) : undefined,
      sizeLabel: sizeLabel?.trim(),
      quant: detectQuant(path),
    });
  }
  return out;
}

/** Scan output from the local bridge /ls call. */
export function fromBridgeEntries(
  entries: { name: string; path: string; size: number; isDir: boolean }[],
  source: RunnerId,
): LocalModel[] {
  return entries
    .filter((e) => !e.isDir && /\.gguf$/i.test(e.name))
    .map((e) => ({
      id: `${source}:${e.path}`,
      name: e.name.replace(/\.gguf$/i, ""),
      source,
      path: e.path,
      sizeBytes: e.size,
      quant: detectQuant(e.name),
    }));
}

/* ------------------------------------------------------------------ */
/* Conversion plans                                                    */
/* ------------------------------------------------------------------ */

export type Platform = "windows" | "linux";

export type ConversionStep = { title: string; command: string; note?: string };

export type ConversionPlan = {
  from: RunnerId;
  to: RunnerId;
  /** True when weights are shared, not duplicated — the goal. */
  zeroCopy: boolean;
  summary: string;
  steps: ConversionStep[];
  warnings: string[];
};

const q = (p: string) => `"${p}"`;

function ollamaModelName(model: LocalModel) {
  const base = model.name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
  return base.startsWith("-") ? `local${base}` : base;
}

/** LM Studio (or any GGUF path) → Ollama, without copying the weights. */
function ggufToOllama(model: LocalModel, platform: Platform): ConversionPlan {
  const name = ollamaModelName(model);
  const path = model.path || "<path to .gguf>";
  const mf = platform === "windows" ? `$env:TEMP\\${name}.Modelfile` : `/tmp/${name}.Modelfile`;
  return {
    from: model.source,
    to: "ollama",
    zeroCopy: false,
    summary: `Register the existing GGUF with Ollama as \`${name}\`. Ollama copies the file into its blob store once (it cannot reference an external path), so budget the disk space one time.`,
    steps: [
      {
        title: "Write a one-line Modelfile pointing at the file you already have",
        command:
          platform === "windows"
            ? `Set-Content -Path ${mf} -Value 'FROM ${path}'`
            : `printf 'FROM %s\\n' ${q(path)} > ${mf}`,
      },
      {
        title: "Create the Ollama model",
        command: `ollama create ${name} -f ${platform === "windows" ? mf : q(mf)}`,
        note: "Reads the GGUF, writes a blob + manifest. Takes as long as one disk copy of the file.",
      },
      { title: "Verify it loads", command: `ollama run ${name} "reply with OK"` },
    ],
    warnings: [
      "Ollama duplicates the weights into its blob store. If disk is tight, keep LM Studio as the single library and serve it over its OpenAI-compatible port instead of importing.",
      "A bare FROM has no chat template. If replies look malformed, add the model's TEMPLATE and stop tokens to the Modelfile.",
    ],
  };
}

/** Ollama blob → plain GGUF usable by LM Studio / llama.cpp / Jan. */
function ollamaToGguf(model: LocalModel, platform: Platform, target: RunnerId): ConversionPlan {
  const tag = model.name;
  const safe = ollamaModelName(model);
  const destDir =
    target === "lmstudio"
      ? platform === "windows"
        ? `$env:USERPROFILE\\.lmstudio\\models\\local\\${safe}`
        : `~/.lmstudio/models/local/${safe}`
      : platform === "windows"
        ? `$env:USERPROFILE\\gguf\\${safe}`
        : `~/gguf/${safe}`;
  const dest = platform === "windows" ? `${destDir}\\${safe}.gguf` : `${destDir}/${safe}.gguf`;

  const steps: ConversionStep[] =
    platform === "windows"
      ? [
          {
            title: "Find the weight blob behind the tag",
            command: `ollama show ${tag} --modelfile`,
            note: "The FROM line prints the blob path (…\\blobs\\sha256-…). That file is already a valid GGUF.",
          },
          { title: "Make the destination folder", command: `New-Item -ItemType Directory -Force -Path "${destDir}"` },
          {
            title: "Hard-link the blob so it costs zero extra disk",
            command: `New-Item -ItemType HardLink -Path "${dest}" -Target "<blob path from step 1>"`,
            note: "Hard link only works on the same volume. If it fails, use Copy-Item instead.",
          },
        ]
      : [
          { title: "Find the weight blob behind the tag", command: `ollama show ${tag} --modelfile` },
          { title: "Make the destination folder", command: `mkdir -p ${destDir}` },
          {
            title: "Hard-link the blob (zero extra disk)",
            command: `ln "<blob path from step 1>" ${q(dest)}`,
            note: "Same filesystem required; otherwise cp.",
          },
        ];

  if (target === "lmstudio") {
    steps.push({
      title: "Rescan in LM Studio",
      command: "lms ls",
      note: "LM Studio picks up any .gguf under its models dir on next scan; restart the app if it doesn't appear.",
    });
  }
  if (target === "jan") {
    steps.push({
      title: "Describe it for Jan",
      command:
        platform === "windows"
          ? `Set-Content -Path "${destDir}\\model.json" -Value '{"id":"${safe}","name":"${safe}","format":"gguf","engine":"nitro","sources":[{"filename":"${safe}.gguf"}]}'`
          : `cat > ${destDir}/model.json <<'JSON'\n{"id":"${safe}","name":"${safe}","format":"gguf","engine":"nitro","sources":[{"filename":"${safe}.gguf"}]}\nJSON`,
    });
  }

  return {
    from: "ollama",
    to: target,
    zeroCopy: true,
    summary: `Expose the Ollama blob for \`${tag}\` as a normal .gguf file for ${findRunner(target)?.label}. Hard-linked, so it uses no additional disk.`,
    steps,
    warnings: [
      "Never move or delete the blob — Ollama tracks it by digest. A hard link is safe; a move breaks the model.",
      "`ollama rm` deletes the blob; your hard link keeps the data alive, but the Ollama tag is gone.",
    ],
  };
}

/** Serve an existing GGUF over an OpenAI-compatible port for BionicGPT. */
function toBionic(model: LocalModel, platform: Platform): ConversionPlan {
  const path = model.path || "<path to .gguf>";
  const fromOllama = model.source === "ollama";
  return {
    from: model.source,
    to: "bionicgpt",
    zeroCopy: true,
    summary:
      "BionicGPT stores no weights. Serve what you already have on an OpenAI-compatible port, then register that endpoint — nothing is copied or converted.",
    steps: fromOllama
      ? [
          {
            title: "Ollama already speaks OpenAI",
            command: `curl http://127.0.0.1:11434/v1/models`,
            note: "Endpoint: http://host.docker.internal:11434/v1 from inside the BionicGPT container.",
          },
          {
            title: "Register in BionicGPT",
            command: `# Admin → Models → New: base URL http://host.docker.internal:11434/v1 · model name ${model.name} · api key: any non-empty string`,
          },
        ]
      : [
          {
            title: "Serve the GGUF with llama-server",
            command: `llama-server -m ${q(path)} -c 8192 -ngl 999 --host 127.0.0.1 --port 8080 --api-key local`,
            note: "-ngl 999 offloads all layers to the 3090; drop it if VRAM is tight.",
          },
          { title: "Confirm the OpenAI surface answers", command: `curl http://127.0.0.1:8080/v1/models` },
          {
            title: "Register in BionicGPT",
            command: `# Admin → Models → New: base URL http://host.docker.internal:8080/v1 · model name ${model.name} · api key local`,
          },
        ],
    warnings: [
      "Inside Docker, 127.0.0.1 is the container. Use host.docker.internal (Windows/macOS) or the host bridge IP on Linux.",
      platform === "windows"
        ? "Windows Firewall may prompt on first llama-server bind — allow it for Private networks only."
        : "Bind to 127.0.0.1 only; do not expose the port to the LAN.",
    ],
  };
}

/** Plain GGUF → llama.cpp / Jan, or LM Studio ↔ Jan: link, don't copy. */
function ggufToGguf(model: LocalModel, platform: Platform, target: RunnerId): ConversionPlan {
  const path = model.path || "<path to .gguf>";
  if (target === "llamacpp") {
    return {
      from: model.source,
      to: "llamacpp",
      zeroCopy: true,
      summary: "llama.cpp reads any path directly — there is nothing to convert.",
      steps: [
        {
          title: "Load it",
          command: `llama-cli -m ${q(path)} -ngl 999 -c 8192 -p "reply with OK"`,
        },
        {
          title: "Or serve it",
          command: `llama-server -m ${q(path)} -ngl 999 -c 8192 --host 127.0.0.1 --port 8080`,
        },
      ],
      warnings: ["If loading fails here, the file is truncated or an older GGUF version — re-download rather than debugging the runner."],
    };
  }
  const safe = ollamaModelName(model);
  const dir = platform === "windows" ? `$env:USERPROFILE\\jan\\models\\${safe}` : `~/jan/models/${safe}`;
  return {
    from: model.source,
    to: "jan",
    zeroCopy: true,
    summary: "Give Jan a hard link plus a model.json descriptor. The weights stay in one place.",
    steps:
      platform === "windows"
        ? [
            { title: "Create the model folder", command: `New-Item -ItemType Directory -Force -Path "${dir}"` },
            { title: "Hard-link the weights", command: `New-Item -ItemType HardLink -Path "${dir}\\${safe}.gguf" -Target ${q(path)}` },
            {
              title: "Write the descriptor",
              command: `Set-Content -Path "${dir}\\model.json" -Value '{"id":"${safe}","name":"${safe}","format":"gguf","engine":"nitro","sources":[{"filename":"${safe}.gguf"}]}'`,
            },
          ]
        : [
            { title: "Create the model folder", command: `mkdir -p ${dir}` },
            { title: "Hard-link the weights", command: `ln ${q(path)} ${dir}/${safe}.gguf` },
            {
              title: "Write the descriptor",
              command: `cat > ${dir}/model.json <<'JSON'\n{"id":"${safe}","name":"${safe}","format":"gguf","engine":"nitro","sources":[{"filename":"${safe}.gguf"}]}\nJSON`,
            },
          ],
    warnings: ["Hard links require the same volume. Across drives you must copy, which doubles disk use."],
  };
}

export function buildConversionPlan(model: LocalModel, target: RunnerId, platform: Platform): ConversionPlan {
  if (target === model.source) {
    return {
      from: model.source,
      to: target,
      zeroCopy: true,
      summary: `${findRunner(target)?.label} already has this model. Nothing to do.`,
      steps: [],
      warnings: [],
    };
  }
  if (target === "bionicgpt") return toBionic(model, platform);
  if (model.source === "ollama") return ollamaToGguf(model, platform, target);
  if (target === "ollama") return ggufToOllama(model, platform);
  return ggufToGguf(model, platform, target);
}

/** Commands that discover what's installed, for the operator to run or send through the bridge. */
export function discoveryCommands(platform: Platform): ConversionStep[] {
  return platform === "windows"
    ? [
        { title: "Ollama library", command: "ollama list" },
        { title: "Ollama blob store size", command: '"$((Get-ChildItem -Recurse "$env:USERPROFILE\\.ollama\\models\\blobs" | Measure-Object Length -Sum).Sum/1GB) GB"' },
        {
          title: "Every GGUF on the machine (LM Studio, Jan, downloads)",
          command:
            'Get-ChildItem -Path C:\\,D:\\ -Recurse -Filter *.gguf -ErrorAction SilentlyContinue | Select-Object FullName,Length | Format-Table -AutoSize',
          note: "Slow on 8 TB. Narrow to $env:USERPROFILE first if you want it fast.",
        },
        { title: "LM Studio CLI view", command: "lms ls" },
        { title: "Duplicate weights by size", command: 'Get-ChildItem -Path $env:USERPROFILE -Recurse -Filter *.gguf -ErrorAction SilentlyContinue | Group-Object Length | Where-Object Count -gt 1 | Format-Table Count,Name' },
        { title: "BionicGPT container", command: "docker ps --filter name=bionic" },
      ]
    : [
        { title: "Ollama library", command: "ollama list" },
        { title: "Ollama blob store size", command: "du -sh ~/.ollama/models/blobs 2>/dev/null || du -sh /usr/share/ollama/.ollama/models/blobs" },
        { title: "Every GGUF under home", command: "find ~ -name '*.gguf' -printf '%s\\t%p\\n' 2>/dev/null | sort -rn" },
        { title: "LM Studio CLI view", command: "lms ls" },
        { title: "Duplicate weights by size", command: "find ~ -name '*.gguf' -printf '%s\\n' | sort | uniq -d" },
        { title: "BionicGPT container", command: "docker ps --filter name=bionic" },
      ];
}

/** Wasted space: same byte-size GGUF present under two runners. */
export function findDuplicates(models: LocalModel[]) {
  const bySize = new Map<number, LocalModel[]>();
  for (const m of models) {
    if (!m.sizeBytes) continue;
    const list = bySize.get(m.sizeBytes) || [];
    list.push(m);
    bySize.set(m.sizeBytes, list);
  }
  return [...bySize.values()]
    .filter((g) => g.length > 1 && new Set(g.map((m) => m.source)).size > 1)
    .map((g) => ({ sizeBytes: g[0].sizeBytes!, models: g, reclaimable: g[0].sizeBytes! * (g.length - 1) }));
}

/** Factual brief so the repair consultant can reason about the local model estate. */
export function modelEstateBrief(models: LocalModel[]) {
  if (models.length === 0) {
    return "LOCAL MODEL ESTATE: nothing scanned yet. Do not assume which models are installed.";
  }
  const dupes = findDuplicates(models);
  const total = models.reduce((s, m) => s + (m.sizeBytes || 0), 0);
  return [
    `LOCAL MODEL ESTATE (${models.length} entries, ${humanSize(total)} on disk as reported)`,
    ...models.map((m) => `- ${findRunner(m.source)?.label}: ${m.name}${m.quant ? ` [${m.quant}]` : ""} ${humanSize(m.sizeBytes)}${m.path ? ` @ ${m.path}` : ""}${m.digest ? ` digest ${m.digest}` : ""}`),
    dupes.length
      ? `Duplicate weights across runners: ${dupes.length} group(s), ~${humanSize(dupes.reduce((s, d) => s + d.reclaimable, 0))} reclaimable by hard-linking instead of copying.`
      : "No cross-runner duplicates detected in the scanned set.",
    "Rule: these are observed rows. Never claim a model is installed if it isn't listed here.",
  ].join("\n");
}
