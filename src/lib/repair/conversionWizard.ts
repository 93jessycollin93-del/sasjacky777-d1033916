// Model Conversion Wizard — take a specific asset the operator actually has and
// land it in a chosen runner, as a checklist that can be worked one line at a
// time and resumed after a reboot.
//
// Grounded rules it never breaks:
//   · GGUF is the shared format. If a file is already GGUF, nothing is
//     "converted" — it is linked or served. Copying 20 GB to gain nothing is
//     waste, not safety.
//   · Hugging Face weights (.safetensors / .bin) are the only case that needs a
//     real conversion pass, and that needs llama.cpp's converter plus disk for
//     the output.
//   · BionicGPT holds no weights. For it the target is an endpoint, not a file.
//   · Every phase is verified before the next one, and the source file is never
//     moved or deleted by any step here.

import {
  buildConversionPlan, findRunner, humanSize,
  type ConversionStep, type LocalModel, type Platform, type RunnerId,
} from "./modelBridge";

export type SourceId = "lmstudio" | "bionicgpt" | "ollama" | "offgrid" | "file";

export type AssetKind = "gguf" | "hf" | "ollama-blob" | "endpoint" | "archive" | "unknown";

export type SourceDef = {
  id: SourceId;
  label: string;
  /** What the operator points Jackie at for this source. */
  locate: string;
  defaultPath: { windows: string; linux: string };
  /** Command that lists candidate assets there. */
  listCommand: { windows: string; linux: string };
  notes: string;
};

export const SOURCES: SourceDef[] = [
  {
    id: "lmstudio",
    label: "LM Studio",
    locate: "The models folder — plain GGUF files in publisher/repo subfolders.",
    defaultPath: { windows: "%USERPROFILE%\\.lmstudio\\models", linux: "~/.lmstudio/models" },
    listCommand: {
      windows:
        'Get-ChildItem "$env:USERPROFILE\\.lmstudio\\models" -Recurse -Filter *.gguf -ErrorAction SilentlyContinue | Select-Object FullName,Length | Format-Table -AutoSize',
      linux: "find ~/.lmstudio/models -name '*.gguf' -printf '%p\\t%s\\n' 2>/dev/null | sort",
    },
    notes: "Your canonical store. Everything else should point here rather than hold a second copy.",
  },
  {
    id: "bionicgpt",
    label: "BionicGPT assets",
    locate: "Its Docker volumes and registered model endpoints — BionicGPT stores no GGUF of its own.",
    defaultPath: { windows: "docker volume ls", linux: "docker volume ls" },
    listCommand: {
      windows: "docker ps --filter name=bionic --format '{{.Names}}\\t{{.Image}}\\t{{.Ports}}'",
      linux: "docker ps --filter name=bionic --format '{{.Names}}\\t{{.Image}}\\t{{.Ports}}'",
    },
    notes:
      "If a model appears inside BionicGPT, the weights live in whatever backend it points at (LocalAI, Ollama, llama.cpp). Convert from that backend, not from Bionic.",
  },
  {
    id: "ollama",
    label: "Ollama",
    locate: "Content-addressed blobs; the tag name maps to a sha256 blob that is itself valid GGUF.",
    defaultPath: { windows: "%USERPROFILE%\\.ollama\\models", linux: "~/.ollama/models" },
    listCommand: { windows: "ollama list", linux: "ollama list" },
    notes: "Never move or rename a blob — Ollama tracks it by digest. Hard-link it out instead.",
  },
  {
    id: "offgrid",
    label: "Off-grid download folder",
    locate: "Any folder you pulled weights into by hand — Downloads, an external drive, a sneakernet USB.",
    defaultPath: { windows: "%USERPROFILE%\\Downloads", linux: "~/Downloads" },
    listCommand: {
      windows:
        'Get-ChildItem "$env:USERPROFILE\\Downloads" -Recurse -Include *.gguf,*.safetensors,*.bin,*.zip,*.7z -ErrorAction SilentlyContinue | Select-Object FullName,Length | Format-Table -AutoSize',
      linux:
        "find ~/Downloads -type f \\( -name '*.gguf' -o -name '*.safetensors' -o -name '*.bin' -o -name '*.zip' -o -name '*.7z' \\) -printf '%p\\t%s\\n' 2>/dev/null | sort",
    },
    notes:
      "Hand-downloaded files are the ones most likely to be truncated or half-written. Integrity is checked before anything else happens.",
  },
  {
    id: "file",
    label: "A specific file or folder",
    locate: "You paste the exact path.",
    defaultPath: { windows: "D:\\models\\model.gguf", linux: "/mnt/models/model.gguf" },
    listCommand: { windows: "Get-Item '<path>' | Format-List", linux: "ls -l '<path>'" },
    notes: "Use this for a shard set, an unpacked HF repo, or a file on a drive Jackie has not scanned.",
  },
];

export const findSource = (id: SourceId) => SOURCES.find((s) => s.id === id);

export function classifyAsset(pathOrName: string, source: SourceId): AssetKind {
  const p = pathOrName.trim().toLowerCase();
  if (source === "bionicgpt") return "endpoint";
  if (!p) return source === "ollama" ? "ollama-blob" : "unknown";
  if (/\.gguf$/.test(p)) return "gguf";
  if (/\.(safetensors|bin|pt|pth)$/.test(p)) return "hf";
  if (/\.(zip|7z|tar|tar\.gz|tgz)$/.test(p)) return "archive";
  if (/blobs[\\/]sha256-/.test(p)) return "ollama-blob";
  if (source === "ollama") return "ollama-blob";
  return "unknown";
}

export const ASSET_LABEL: Record<AssetKind, string> = {
  gguf: "GGUF — already the shared format",
  hf: "Hugging Face weights — needs a real conversion pass",
  "ollama-blob": "Ollama blob — valid GGUF behind a digest name",
  endpoint: "Endpoint-backed — no local weight file",
  archive: "Archive — must be extracted first",
  unknown: "Unrecognised — identify before touching it",
};

/* ------------------------------------------------------------------ */
/* Checklist                                                           */
/* ------------------------------------------------------------------ */

export type ChecklistItem = {
  id: string;
  title: string;
  command?: string;
  note?: string;
  /** Blocking items must be done before the conversion phase is honest. */
  required: boolean;
};

export type ChecklistPhase = {
  id: string;
  title: string;
  purpose: string;
  items: ChecklistItem[];
};

export type WizardInput = {
  source: SourceId;
  target: RunnerId;
  platform: Platform;
  /** Path to the file/folder, or the Ollama tag when source is ollama. */
  assetPath: string;
  /** Friendly name; defaults to the file name. */
  name?: string;
  sizeBytes?: number;
  /** Optional known-model preset id, e.g. "bonsai-1.7b". */
  modelPreset?: ModelPresetId;
};

/* ------------------------------------------------------------------ */
/* Known-model presets                                                 */
/* ------------------------------------------------------------------ */

export type ModelPresetId = "bonsai-1.7b";

export type ModelPreset = {
  id: ModelPresetId;
  label: string;
  /** Sources this preset knows how to start from. */
  sources: SourceId[];
  /** Suggested register-as name. */
  name: string;
  /** Where the asset usually sits for each supported source. */
  hint: Partial<Record<SourceId, { windows: string; linux: string }>>;
  /** Quantisations that are worth keeping for this model, smallest first. */
  quants: { tag: string; approxSize: string; note: string }[];
  /** Runner the load check is written for. */
  loadCheckTarget: RunnerId;
  summary: string;
};

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "bonsai-1.7b",
    label: "Bonsai 1.7B",
    sources: ["lmstudio", "ollama"],
    name: "bonsai-1.7b",
    hint: {
      lmstudio: {
        windows: "%USERPROFILE%\\.lmstudio\\models\\bonsai\\bonsai-1.7b-Q4_K_M.gguf",
        linux: "~/.lmstudio/models/bonsai/bonsai-1.7b-Q4_K_M.gguf",
      },
      ollama: { windows: "bonsai:1.7b", linux: "bonsai:1.7b" },
    },
    quants: [
      { tag: "Q4_K_M", approxSize: "~1.1 GB", note: "The balance point. Start here — it fits entirely in VRAM with room for a long context." },
      { tag: "Q5_K_M", approxSize: "~1.3 GB", note: "Slightly better reasoning at 1.7B scale. Worth it on a 3090; pointless on a phone." },
      { tag: "Q8_0", approxSize: "~1.9 GB", note: "Near-lossless. Only useful as a reference to compare the smaller quants against." },
    ],
    loadCheckTarget: "ollama",
    summary:
      "A 1.7B reasoning model small enough to stay resident. At this size the quantisation choice changes answer quality noticeably, so the file you register is checked and named by its quant.",
  },
];

export const findModelPreset = (id?: ModelPresetId) => MODEL_PRESETS.find((p) => p.id === id);

function presetPhase(input: WizardInput): ChecklistPhase | null {
  const preset = findModelPreset(input.modelPreset);
  if (!preset) return null;
  const win = input.platform === "windows";
  const p = input.assetPath || "<path>";
  const regName = (input.name?.trim() || preset.name).replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
  const items: ChecklistItem[] = [
    {
      id: "pre-quant",
      title: "Identify which quantisation you actually have",
      command:
        input.source === "ollama"
          ? `ollama show ${input.assetPath || preset.name} --modelfile`
          : win
            ? `Get-Item ${q(p)} | Select-Object Name,Length`
            : `ls -l ${q(p)}`,
      note:
        "The quant is in the file name or the modelfile FROM line. " +
        preset.quants.map((x) => `${x.tag} ${x.approxSize} — ${x.note}`).join(" "),
      required: true,
    },
    {
      id: "pre-name",
      title: `Register it with the quant in the name (${regName})`,
      note: "At 1.7B two quants behave differently enough that an unlabelled copy becomes a mystery a week later. Put the quant in the tag.",
      required: true,
    },
    {
      id: "pre-load",
      title: `Load check in ${findRunner(preset.loadCheckTarget)?.label ?? preset.loadCheckTarget}`,
      command:
        preset.loadCheckTarget === "ollama"
          ? `ollama run ${regName} "In one sentence, why is a 1.7B model useful offline?"`
          : `llama-cli -m ${q(p)} -ngl 999 -n 48 -p "In one sentence, why is a 1.7B model useful offline?"`,
      note: "A coherent sentence means the weights and chat template are both good. Word salad at this size is almost always a wrong or missing template, not bad weights.",
      required: true,
    },
    {
      id: "pre-vram",
      title: "Confirm it stayed resident instead of spilling to CPU",
      command: win ? "nvidia-smi --query-gpu=memory.used,memory.total --format=csv" : "nvidia-smi --query-gpu=memory.used,memory.total --format=csv",
      note: "Run this while the model is loaded. If usage barely moved, layers went to CPU and the speed you measure is not the speed you'd get.",
      required: false,
    },
  ];
  return {
    id: "preset",
    title: `· ${preset.label} — quantisation and load check`,
    purpose: preset.summary,
    items,
  };
}


const q = (p: string) => `"${p}"`;

function baseName(path: string) {
  return path.split(/[\\/]/).pop()?.replace(/\.(gguf|safetensors|bin)$/i, "") || "model";
}

function integrityItems(kind: AssetKind, input: WizardInput): ChecklistItem[] {
  const { platform, assetPath } = input;
  const p = assetPath || "<path>";
  const items: ChecklistItem[] = [];
  if (kind === "endpoint") {
    items.push({
      id: "int-endpoint",
      title: "Confirm the backend behind BionicGPT actually answers",
      command: "curl http://127.0.0.1:11434/v1/models",
      note: "Swap the port for whatever backend is registered. If this fails, the model BionicGPT shows is not loadable and there is nothing to convert.",
      required: true,
    });
    return items;
  }
  if (kind === "archive") {
    items.push({
      id: "int-extract",
      title: "Extract the archive to a working folder first",
      command:
        platform === "windows"
          ? `Expand-Archive -Path ${q(p)} -DestinationPath "$env:USERPROFILE\\models-work" -Force`
          : `mkdir -p ~/models-work && tar -xf ${q(p)} -C ~/models-work || 7z x ${q(p)} -o$HOME/models-work`,
      note: "Then re-run the wizard against the extracted .gguf or .safetensors path — the real asset, not the container.",
      required: true,
    });
  }
  items.push({
    id: "int-size",
    title: "Confirm the file is fully written, not a partial download",
    command:
      platform === "windows"
        ? `Get-Item ${q(p)} | Select-Object FullName,Length,LastWriteTime`
        : `ls -l ${q(p)} && stat -c '%s bytes  %y' ${q(p)}`,
    note: "Compare against the published size. A short file is the single most common cause of a runner 'failing to load' a good model.",
    required: true,
  });
  items.push({
    id: "int-part",
    title: "Check for leftover .part / .incomplete siblings",
    command:
      platform === "windows"
        ? `Get-ChildItem (Split-Path ${q(p)}) -Filter *.part -ErrorAction SilentlyContinue`
        : `ls -l "$(dirname ${q(p)})" | grep -Ei '\\.part|\\.incomplete' || echo "none"`,
    note: "If a .part exists next to it, the download never finished. Re-fetch instead of converting a corrupt file.",
    required: true,
  });
  if (kind === "gguf") {
    items.push({
      id: "int-magic",
      title: "Verify the GGUF magic bytes",
      command:
        platform === "windows"
          ? `[System.Text.Encoding]::ASCII.GetString([byte[]](Get-Content ${q(p)} -Encoding Byte -TotalCount 4))`
          : `head -c 4 ${q(p)} | xxd -p`,
      note: 'Must read GGUF (Windows) or 47475546 (hex). Anything else means the file is not a GGUF regardless of its extension.',
      required: true,
    });
    items.push({
      id: "int-hash",
      title: "Record a hash before anything links or copies it",
      command:
        platform === "windows"
          ? `Get-FileHash ${q(p)} -Algorithm SHA256 | Format-List`
          : `sha256sum ${q(p)}`,
      note: "Slow on a large file, but it is the only way to later prove the weights were not altered. Log it in the Evidence Log.",
      required: false,
    });
    items.push({
      id: "int-load",
      title: "Prove the file loads before wiring it anywhere",
      command: `llama-cli -m ${q(p)} -ngl 999 -c 2048 -n 16 -p "reply with OK"`,
      note: "If llama.cpp cannot open it, no other runner will either. Fail here and stop — do not blame the target runner.",
      required: true,
    });
  }
  if (kind === "ollama-blob") {
    items.push({
      id: "int-blob",
      title: "Resolve the tag to its blob path",
      command: `ollama show ${input.assetPath || "<tag>"} --modelfile`,
      note: "The FROM line prints the blob. Note it down — later steps link that exact file.",
      required: true,
    });
  }
  return items;
}

function spaceItems(kind: AssetKind, input: WizardInput, willDuplicate: boolean): ChecklistItem[] {
  const { platform, sizeBytes } = input;
  const items: ChecklistItem[] = [
    {
      id: "space-free",
      title: willDuplicate
        ? `Confirm free space for a full second copy${sizeBytes ? ` (~${humanSize(sizeBytes)})` : ""}`
        : "Confirm the destination is on the same volume as the source",
      command:
        platform === "windows"
          ? "Get-Volume | Select-Object DriveLetter,FileSystemLabel,@{n='FreeGB';e={[math]::Round($_.SizeRemaining/1GB,1)}},@{n='SizeGB';e={[math]::Round($_.Size/1GB,1)}} | Format-Table -AutoSize"
          : "df -h",
      note: willDuplicate
        ? "This path duplicates the weights. If space is tight, serve the original over a local endpoint instead."
        : "Hard links only work within one filesystem. Different volume means a real copy, so check space anyway.",
      required: true,
    },
  ];
  if (kind === "hf") {
    items.push({
      id: "space-hf",
      title: "Budget for the converted output as well as the source",
      command: platform === "windows" ? "Get-PSDrive -PSProvider FileSystem | Format-Table Name,Used,Free" : "df -h .",
      note: "An F16 GGUF is roughly the size of the safetensors set; a quantised copy adds more on top. Both exist at once during conversion.",
      required: true,
    });
  }
  items.push({
    id: "space-power",
    title: "Do not start a long write on an unstable power situation",
    required: false,
    note: "Conversion and blob imports write for many minutes. A power loss mid-write leaves a half-file — recoverable only because the source is untouched, which is exactly why no step here moves the original.",
  });
  return items;
}

function hfConversionItems(input: WizardInput): ChecklistItem[] {
  const { platform, assetPath } = input;
  const dir = assetPath || "<folder with config.json + safetensors>";
  const name = baseName(assetPath || "model");
  const outF16 = platform === "windows" ? `$env:USERPROFILE\\gguf\\${name}-f16.gguf` : `~/gguf/${name}-f16.gguf`;
  const outQ = platform === "windows" ? `$env:USERPROFILE\\gguf\\${name}-Q4_K_M.gguf` : `~/gguf/${name}-Q4_K_M.gguf`;
  return [
    {
      id: "hf-tools",
      title: "Get llama.cpp's converter (this is the only real conversion path)",
      command:
        "git clone https://github.com/ggml-org/llama.cpp && cd llama.cpp && pip install -r requirements.txt",
      note: "Needs network once. After that the converter runs fully offline.",
      required: true,
    },
    {
      id: "hf-complete",
      title: "Confirm the repo folder is complete",
      command:
        platform === "windows"
          ? `Get-ChildItem ${q(dir)} | Select-Object Name,Length`
          : `ls -l ${q(dir)}`,
      note: "Needs config.json, tokenizer files, and every shard listed in model.safetensors.index.json. A missing shard fails the conversion halfway.",
      required: true,
    },
    {
      id: "hf-convert",
      title: "Convert to GGUF at full precision",
      command: `python convert_hf_to_gguf.py ${q(dir)} --outfile ${outF16} --outtype f16`,
      note: "Keep the F16 output until the quantised file is verified; it is the master you re-quantise from.",
      required: true,
    },
    {
      id: "hf-quant",
      title: "Quantise for the 3090",
      command: `llama-quantize ${outF16} ${outQ} Q4_K_M`,
      note: "Q4_K_M is the balanced default. Q5_K_M or Q6_K if VRAM allows and you want more fidelity.",
      required: false,
    },
    {
      id: "hf-verify",
      title: "Load the converted file before wiring it anywhere",
      command: `llama-cli -m ${outQ} -ngl 999 -c 2048 -n 16 -p "reply with OK"`,
      required: true,
    },
  ];
}

function toItems(steps: ConversionStep[], prefix: string, required = true): ChecklistItem[] {
  return steps.map((s, i) => ({
    id: `${prefix}-${i}`,
    title: s.title,
    command: s.command,
    note: s.note,
    required,
  }));
}

export type WizardPlan = {
  input: WizardInput;
  kind: AssetKind;
  zeroCopy: boolean;
  summary: string;
  phases: ChecklistPhase[];
  warnings: string[];
  /** All required item ids, for progress. */
  requiredIds: string[];
  allIds: string[];
};

export function buildWizardPlan(input: WizardInput): WizardPlan {
  const kind = classifyAsset(input.assetPath, input.source);
  const src = findSource(input.source);
  const targetLabel = findRunner(input.target)?.label ?? input.target;

  // The underlying runner-to-runner plan reuses the proven Model Vault logic.
  const model: LocalModel = {
    id: `wizard:${input.assetPath}`,
    name: input.name?.trim() || baseName(input.assetPath || "model"),
    source: input.source === "offgrid" || input.source === "file" ? "lmstudio" : (input.source as RunnerId),
    path: kind === "ollama-blob" ? undefined : input.assetPath || undefined,
    sizeBytes: input.sizeBytes,
  };
  const corePlan = buildConversionPlan(model, input.target, input.platform);
  const needsHf = kind === "hf" || kind === "archive";
  const willDuplicate = !corePlan.zeroCopy || needsHf;

  const phases: ChecklistPhase[] = [
    {
      id: "locate",
      title: "1 · Locate the asset",
      purpose: src?.locate ?? "Point Jackie at the exact file.",
      items: [
        {
          id: "loc-list",
          title: `List candidates in ${src?.label ?? "the source"}`,
          command: input.platform === "windows" ? src?.listCommand.windows : src?.listCommand.linux,
          note: src?.notes,
          required: true,
        },
        {
          id: "loc-confirm",
          title: "Confirm this is the exact asset you meant",
          note: input.assetPath
            ? `Selected: ${input.assetPath} — read as ${ASSET_LABEL[kind]}.`
            : "No path entered yet, so every command below still has a placeholder in it.",
          required: true,
        },
      ],
    },
    {
      id: "integrity",
      title: "2 · Verify integrity",
      purpose: "A model that will not load is a broken file, not a broken runner. This is settled before anything is wired up.",
      items: integrityItems(kind, input),
    },
    {
      id: "space",
      title: "3 · Space and power",
      purpose: willDuplicate
        ? "This route writes a second copy of the weights, so space is checked first."
        : "This route links or serves the original, so the check is about volumes, not gigabytes.",
      items: spaceItems(kind, input, willDuplicate),
    },
  ];

  if (needsHf) {
    phases.push({
      id: "convert-hf",
      title: "4 · Convert to GGUF",
      purpose: "Hugging Face weights are the one case that needs a genuine format conversion.",
      items: hfConversionItems(input),
    });
  }

  phases.push({
    id: "install",
    title: `${needsHf ? 5 : 4} · Land it in ${targetLabel}`,
    purpose: corePlan.summary,
    items: needsHf
      ? toItems(
          [
            {
              title: `Re-run the ${targetLabel} step against the converted .gguf`,
              command: corePlan.steps[0]?.command ?? `# see ${targetLabel} steps`,
              note: "Substitute the GGUF you just produced for the source path.",
            },
            ...corePlan.steps.slice(1),
          ],
          "inst",
        )
      : toItems(corePlan.steps, "inst"),
  });

  phases.push({
    id: "verify",
    title: `${needsHf ? 6 : 5} · Prove it works, then record it`,
    purpose: "Nothing counts as converted until the target runner answers with it loaded.",
    items: [
      {
        id: "ver-list",
        title: `Confirm ${targetLabel} sees it`,
        command:
          input.target === "ollama"
            ? "ollama list"
            : input.target === "lmstudio"
              ? "lms ls"
              : input.target === "bionicgpt"
                ? "curl http://127.0.0.1:11434/v1/models"
                : input.platform === "windows"
                  ? "Get-ChildItem -Recurse -Filter *.gguf | Select-Object FullName,Length"
                  : "find . -name '*.gguf' -printf '%p\\t%s\\n'",
        required: true,
      },
      {
        id: "ver-answer",
        title: "Ask it something and read the reply",
        command:
          input.target === "ollama"
            ? `ollama run ${model.name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase()} "reply with OK"`
            : `llama-cli -m ${q(input.assetPath || "<gguf>")} -ngl 999 -n 16 -p "reply with OK"`,
        note: "Malformed output usually means a missing chat template, not broken weights.",
        required: true,
      },
      {
        id: "ver-source",
        title: "Leave the original exactly where it was",
        note: "No step in this wizard moves or deletes the source. If the new copy fails later, the original is still your fallback.",
        required: true,
      },
      {
        id: "ver-log",
        title: "Log the result in the Evidence Log",
        note: "Command, output, and whether it supported or contradicted the plan — so the next conversion starts from fact.",
        required: false,
      },
    ],
  });

  const extra = presetPhase(input);
  if (extra) phases.push(extra);

  const allIds = phases.flatMap((p) => p.items.map((i) => i.id));
  return {
    input,
    kind,
    zeroCopy: !willDuplicate,
    summary:
      kind === "endpoint"
        ? "BionicGPT keeps no weights, so the work is finding the backend behind it and converting from there."
        : needsHf
          ? `${ASSET_LABEL[kind]}. Real conversion to GGUF first, then land it in ${targetLabel}.`
          : `${ASSET_LABEL[kind]}. No format change needed — ${corePlan.zeroCopy ? "link or serve" : "import"} it into ${targetLabel}.`,
    phases,
    warnings: [
      ...corePlan.warnings,
      ...(kind === "unknown"
        ? ["The asset type could not be read from the path. Identify the file before running write commands against it."]
        : []),
      ...(needsHf
        ? ["Conversion needs Python and llama.cpp's requirements installed once. Do that while you still have network."]
        : []),
    ],
    requiredIds: phases.flatMap((p) => p.items.filter((i) => i.required).map((i) => i.id)),
    allIds,
  };
}

/* ------------------------------------------------------------------ */
/* Checklist persistence                                               */
/* ------------------------------------------------------------------ */

const RUN_KEY = "jackie.convert.wizard.v1";

export type WizardRun = {
  input: WizardInput;
  done: string[];
  startedAt: string;
  updatedAt: string;
};

export function loadWizardRun(): WizardRun | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    return raw ? (JSON.parse(raw) as WizardRun) : null;
  } catch {
    return null;
  }
}

export function saveWizardRun(run: WizardRun) {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify({ ...run, updatedAt: new Date().toISOString() }));
  } catch {
    /* quota — the UI keeps working from state */
  }
}

export function clearWizardRun() {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}

export function wizardProgress(plan: WizardPlan, done: string[]) {
  const set = new Set(done);
  const req = plan.requiredIds.filter((id) => set.has(id)).length;
  return {
    requiredDone: req,
    requiredTotal: plan.requiredIds.length,
    allDone: plan.allIds.filter((id) => set.has(id)).length,
    allTotal: plan.allIds.length,
    complete: plan.requiredIds.length > 0 && req === plan.requiredIds.length,
  };
}

/** Plain-text export of the checklist as worked, for the Evidence Log or a notebook. */
export function wizardMarkdown(plan: WizardPlan, done: string[]) {
  const set = new Set(done);
  const lines = [
    `# Model conversion — ${findSource(plan.input.source)?.label} → ${findRunner(plan.input.target)?.label}`,
    "",
    `Asset: ${plan.input.assetPath || "(not set)"}`,
    `Read as: ${ASSET_LABEL[plan.kind]}`,
    `Platform: ${plan.input.platform}`,
    `Disk: ${plan.zeroCopy ? "no extra copy of the weights" : "a second copy will be written"}`,
    "",
    plan.summary,
    "",
  ];
  for (const phase of plan.phases) {
    lines.push(`## ${phase.title}`, phase.purpose, "");
    for (const item of phase.items) {
      lines.push(`- [${set.has(item.id) ? "x" : " "}] ${item.title}${item.required ? "" : " (optional)"}`);
      if (item.command) lines.push("", "```", item.command, "```", "");
      if (item.note) lines.push(`  > ${item.note}`, "");
    }
  }
  if (plan.warnings.length) {
    lines.push("## Warnings", ...plan.warnings.map((w) => `- ${w}`));
  }
  return lines.join("\n");
}
