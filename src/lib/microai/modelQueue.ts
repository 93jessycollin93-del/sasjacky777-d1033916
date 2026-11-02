/**
 * The owner's download queue of compact AI models, as the app reads it.
 *
 * One file is the source: command_station/models/manifests/DOWNLOAD_QUEUE.json.
 * The rig's downloader (command_station/tools/model_queue.py) reads the same
 * file, so the page that lists a model and the script that fetches it cannot
 * name different repositories. docs/MODEL_QUEUE.md explains the queue.
 *
 * Most of the queue does not run in this app: speech, vision and embedding
 * models need runtimes it does not carry. The chat-capable language models do
 * — they are the On-device engine's models (`deviceModels.ts`), and an entry's
 * `device` field names which.
 */
import data from "../../../command_station/models/manifests/DOWNLOAD_QUEUE.json";

export type QueueSection = "tier0" | "dialogue" | "classification" | "embeddings" | "audio" | "vision" | "multimodal";

export interface QueuedModel {
  queue: number;
  /** As the queue lists it. */
  id: string;
  task: string;
  formats: string[];
  /** Where it goes in the models/ layout. */
  folder: string;
  section: QueueSection;
  priority?: "Essential" | "High";
  /**
   * The Hugging Face repository to fetch instead, when `id` is not one as
   * written; null when the model is published elsewhere (see `source`).
   */
  repo?: string | null;
  source?: string;
  /** What is wrong with the listed id, or worth knowing about the model. */
  note?: string;
  /** Licence or access conditions to read before downloading. */
  caution?: string;
  license?: string;
  /** The same model, listed earlier in the queue. */
  duplicateOf?: number;
  /** The On-device engine's id, when this model runs in the app. */
  device?: string;
  gguf?: { repos: string[]; quants: string[] };
}

interface QueueFile {
  queue_version: string;
  about: string;
  sections: Record<QueueSection, string>;
  phases: Record<"1" | "2" | "3", number[]>;
  embedding_tiers: Record<"fast" | "balanced" | "quality", number[]>;
  accessibility_pipeline: number[];
  models: QueuedModel[];
}

const queue = data as unknown as QueueFile;

export const MODEL_QUEUE: readonly QueuedModel[] = queue.models;
export const QUEUE_SECTIONS = queue.sections;
export const QUEUE_PHASES = queue.phases;
export const EMBEDDING_TIERS = queue.embedding_tiers;
export const ACCESSIBILITY_PIPELINE = queue.accessibility_pipeline;

export function queued(number: number): QueuedModel | undefined {
  return MODEL_QUEUE.find((m) => m.queue === number);
}

/** The repository to fetch, or null when the model is published outside Hugging Face. */
export function fetchRepo(model: QueuedModel): string | null {
  return model.repo === undefined ? model.id : model.repo;
}

/** Where to look at it: its Hugging Face page, or the place it is published instead. */
export function modelUrl(model: QueuedModel): string | null {
  const repo = fetchRepo(model);
  if (repo) return `https://huggingface.co/${repo}`;
  return model.source ?? null;
}

/** The queue file itself, for a person to save and take to another machine. */
export function queueJson(): string {
  return `${JSON.stringify(queue, null, 1)}\n`;
}
