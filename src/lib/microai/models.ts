export interface MicroModel {
  id: string;           // Ollama / LM Studio model identifier
  name: string;
  family: string;
  sizeLabel: string;
  sizeMB: number;
  type: "reasoning" | "chat" | "code" | "story" | "general";
}

/** Deterministic registry of supported micro-LLMs. Order matters: first entry is the safe fallback. */
export const MICRO_MODELS: MicroModel[] = [
  { id: "tinystories",          name: "TinyStories",        family: "tinystories series", sizeLabel: "~1 MB",  sizeMB: 1,   type: "story" },
  { id: "tiny1m",               name: "Tiny 1M",            family: "tiny1m",             sizeLabel: "~2 MB",  sizeMB: 2,   type: "general" },
  { id: "axl-micro-600k",       name: "AXL Micro 600K",     family: "axl-micro series",   sizeLabel: "~2 MB",  sizeMB: 2,   type: "chat" },
  { id: "cromia-microlm2-1m",   name: "Cromia MicroLM2 1M", family: "cromia-microlm2",    sizeLabel: "~3 MB",  sizeMB: 3,   type: "chat" },
  { id: "granite-micro",        name: "Granite Micro",      family: "granite",            sizeLabel: "~4 MB",  sizeMB: 4,   type: "reasoning" },
  { id: "microllm2-i1",         name: "MicroLLM2 i1",       family: "microllm2",          sizeLabel: "~5 MB",  sizeMB: 5,   type: "general" },
  { id: "microatlas-v1",        name: "MicroAtlas v1",      family: "microatlas",         sizeLabel: "~6 MB",  sizeMB: 6,   type: "code" },
  { id: "axl-micro-8m",         name: "AXL Micro 8M",       family: "axl-micro series",   sizeLabel: "~15 MB", sizeMB: 15,  type: "reasoning" },
  { id: "awa-micro-1m",         name: "AWA Micro 1M",       family: "awa-micro series",   sizeLabel: "~3 MB",  sizeMB: 3,   type: "chat" },
  { id: "awa-micro-4m",         name: "AWA Micro 4M",       family: "awa-micro series",   sizeLabel: "~8 MB",  sizeMB: 8,   type: "general" },
  { id: "bonsai-1.7b",          name: "Bonsai 1.7B",        family: "bonsai",             sizeLabel: "~237 MB", sizeMB: 237,  type: "reasoning" },
];

export const FALLBACK_MODEL = MICRO_MODELS[0];

/**
 * The model that answers app guidance, everywhere, permanently.
 *
 * It is the largest entry in the registry by two orders of magnitude and that
 * is the point: guidance is the one job where a 2 MB model cannot help, and the
 * one job that has to work with the radio off. 248 MB is small enough to ship
 * with the app and hold in the Model Bay, big enough to answer in sentences.
 */
export const GUIDANCE_MODEL = MICRO_MODELS.find((m) => m.id === "bonsai-1.7b")!;

export function findModel(id: string): MicroModel {
  return MICRO_MODELS.find(m => m.id === id) ?? FALLBACK_MODEL;
}
