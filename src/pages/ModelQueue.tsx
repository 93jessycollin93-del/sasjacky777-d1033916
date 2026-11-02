/**
 * The owner's download queue of compact AI models, all 180 entries.
 *
 * It reads the same queue file the rig's downloader does
 * (command_station/models/manifests/DOWNLOAD_QUEUE.json), so what this page
 * says a model is and where it comes from is what the rig fetches. The models
 * that run in this app — the chat-capable language models — say so and open
 * the chat on them; the rest say what they are for, what to fetch, and what
 * is wrong with the id as it was first written, because a queue that sends
 * someone to a repository that does not exist costs them the evening.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setChatPreset } from "@/lib/jackie-preset";
import {
  fetchRepo,
  MODEL_QUEUE,
  modelUrl,
  QUEUE_PHASES,
  QUEUE_SECTIONS,
  queueJson,
  type QueuedModel,
  type QueueSection,
} from "@/lib/microai/modelQueue";
import { findDeviceModel } from "@/lib/microai/deviceModels";

type Filter = { kind: "all" } | { kind: "app" } | { kind: "phase"; phase: "1" | "2" | "3" } | { kind: "section"; section: QueueSection };

const FILTERS: Array<{ label: string; filter: Filter }> = [
  { label: "All 180", filter: { kind: "all" } },
  { label: "Runs in this app", filter: { kind: "app" } },
  { label: "Phase 1", filter: { kind: "phase", phase: "1" } },
  { label: "Phase 2", filter: { kind: "phase", phase: "2" } },
  { label: "Phase 3", filter: { kind: "phase", phase: "3" } },
  ...(Object.keys(QUEUE_SECTIONS) as QueueSection[]).map((section) => ({
    label: QUEUE_SECTIONS[section].replace(/^Tier 0 - /, "Tier 0: "),
    filter: { kind: "section" as const, section },
  })),
];

const sameFilter = (a: Filter, b: Filter) => JSON.stringify(a) === JSON.stringify(b);

function select(filter: Filter, search: string): QueuedModel[] {
  let models: QueuedModel[];
  if (filter.kind === "phase") {
    models = QUEUE_PHASES[filter.phase].map((n) => MODEL_QUEUE.find((m) => m.queue === n)).filter((m): m is QueuedModel => !!m);
  } else if (filter.kind === "app") {
    models = MODEL_QUEUE.filter((m) => m.device && !m.duplicateOf);
  } else if (filter.kind === "section") {
    models = MODEL_QUEUE.filter((m) => m.section === filter.section);
  } else {
    models = [...MODEL_QUEUE];
  }
  const words = search.trim().toLowerCase();
  if (!words) return models;
  return models.filter((m) => `${m.id} ${m.task} ${m.folder} ${m.formats.join(" ")}`.toLowerCase().includes(words));
}

function saveQueue() {
  // A file the owner can carry to the rig, or to any machine, as it is.
  const url = URL.createObjectURL(new Blob([queueJson()], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "DOWNLOAD_QUEUE.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function QueueRow({ model, onUse }: { model: QueuedModel; onUse: (deviceId: string) => void }) {
  const repo = fetchRepo(model);
  const url = modelUrl(model);
  const device = model.device ? findDeviceModel(model.device) : undefined;
  return (
    <li className="rounded-md border border-border p-3 space-y-1.5" data-queue={model.queue}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-muted-foreground">#{model.queue}</span>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="font-mono text-sm text-foreground hover:text-primary break-all">
            {model.id}
          </a>
        ) : (
          <span className="font-mono text-sm text-foreground break-all">{model.id}</span>
        )}
        {model.priority && <Badge variant="secondary">{model.priority}</Badge>}
        {device && <Badge>Runs in this app</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">{model.task}</p>
      <div className="flex flex-wrap gap-1">
        {model.formats.map((f) => (
          <Badge key={f} variant="outline" className="font-mono text-[10px]">
            {f}
          </Badge>
        ))}
        <span className="font-mono text-[10px] text-muted-foreground self-center">models/{model.folder}</span>
        {model.license && <span className="font-mono text-[10px] text-muted-foreground self-center">· {model.license}</span>}
      </div>
      {model.duplicateOf && <p className="text-xs text-muted-foreground">The same model as #{model.duplicateOf}, listed again here.</p>}
      {model.repo !== undefined && repo !== model.id && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {repo ? <>Fetch <span className="font-mono">{repo}</span>. </> : null}
          {model.note}
        </p>
      )}
      {model.repo === undefined && model.note && <p className="text-xs text-muted-foreground">{model.note}</p>}
      {model.caution && <p className="text-xs text-destructive">{model.caution}</p>}
      {device && (
        <Button size="sm" variant="outline" onClick={() => onUse(device.id)}>
          Use {device.name} in the chat
        </Button>
      )}
    </li>
  );
}

export default function ModelQueue() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [search, setSearch] = useState("");
  const models = useMemo(() => select(filter, search), [filter, search]);
  const corrected = MODEL_QUEUE.filter((m) => m.repo !== undefined && !m.duplicateOf).length;
  const inApp = MODEL_QUEUE.filter((m) => m.device && !m.duplicateOf).length;

  // The chat starts on whatever engine and model its preset names, so
  // choosing a model here is setting that and going there.
  const useInChat = (deviceId: string) => {
    setChatPreset({ engine: "device", provider: "lovable", model: deviceId });
    navigate("/");
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Model download queue</h1>
        <p className="text-sm text-muted-foreground">
          {MODEL_QUEUE.length} compact models in priority order. {inApp} run in this app today — the chat-capable language
          models, on the On-device engine. The rest need runtimes the app does not carry yet; the rig's downloader fetches
          them into <span className="font-mono">models/</span>. {corrected} entries name a repository that does not exist
          as first written, and say what to fetch instead.
        </p>
        <pre className="rounded-md bg-muted p-2 font-mono text-[11px] text-foreground overflow-x-auto">
          python command_station/tools/model_queue.py --phase 1 --download
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={saveQueue}>
            Save the queue (JSON)
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter the queue">
        {FILTERS.map(({ label, filter: f }) => (
          <Button
            key={label}
            size="sm"
            variant={sameFilter(f, filter) ? "default" : "outline"}
            role="tab"
            aria-selected={sameFilter(f, filter)}
            onClick={() => setFilter(f)}
          >
            {label}
          </Button>
        ))}
      </div>
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search: whisper, ONNX, embeddings…" aria-label="Search the queue" />

      <p className="text-xs text-muted-foreground" role="status">
        {models.length} {models.length === 1 ? "model" : "models"}
      </p>
      <ul className="space-y-2">
        {models.map((m) => (
          <QueueRow key={m.queue} model={m} onUse={useInChat} />
        ))}
      </ul>
    </div>
  );
}
