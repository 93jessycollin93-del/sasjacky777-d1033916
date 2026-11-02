/**
 * A crafted index — one of the pills.
 *
 * `contextRouter.ts` already had the right idea and shipped four of them
 * hard-coded: Recall, Keeper, Operator, Maker. Each pairs a specialisation with
 * the partitions it reads, the small model that suits it, and the ladder of
 * engines allowed to answer. That pairing is the useful unit, because a micro
 * model is small enough to run on the device and far too small to know
 * everything — what makes it useful is the slice of local storage it is expert
 * in.
 *
 * The only thing wrong with those four was that adding a fifth meant editing
 * TypeScript. This is the same shape, authored at runtime, owned by the person
 * using it.
 *
 * ## Why this is not simply `ContextRouterSpec`
 *
 * `ContextRouterSpec.id` is a `RouterId`: a closed union of exactly those four.
 * That closure is load-bearing elsewhere — `src/lib/squad/` assigns squad
 * members by `RouterId` and genuinely wants a fixed set — so widening it would
 * push runtime-authored ids into a place that is correct to keep closed.
 *
 * A crafted index therefore has its own `string` id and converts, rather than
 * pretending to be one of the four.
 */
import { MICRO_MODELS } from "@/lib/microai/models";
import { PARTITIONS } from "@/lib/partitions/registry";
import type { EngineLocality } from "@/lib/microai/contextRouter";
import type { PartitionId } from "@/lib/partitions/types";

/** Bumped when the shape changes in a way an older file cannot be read as. */
export const FORGE_SCHEMA_VERSION = 1;

/** One thing the pill can be told to do, and where it goes. */
export interface IndexCommand {
  /** What you say or type: "Open Tasks". */
  phrase: string;
  /** In-app route it opens, or omitted when the command only asks the model. */
  route?: string;
}

export interface CraftedIndex {
  /** Stable, lowercase, url-safe. Generated from the name, never re-derived. */
  id: string;
  name: string;
  /** One or two characters shown in the pill. */
  glyph: string;
  /** The one kind of question this index is for. */
  specialty: string;
  /** Prepended to every prompt this index answers. */
  systemPrompt: string;
  /** Words that route an intent here. */
  keywords: string[];
  /** Partitions it draws context from, in the order it reads them. */
  reads: PartitionId[];
  /** Micro model id, resolved against the micro registry. */
  modelId: string;
  /** Engine localities it will accept, nearest first. */
  ladder: EngineLocality[];
  commands: IndexCommand[];
  createdAt: string;
  updatedAt: string;
}

export type IndexDraft = Omit<CraftedIndex, "createdAt" | "updatedAt">;

export type Validation =
  | { ok: true; index: CraftedIndex }
  | { ok: false; problems: string[] };

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const LOCALITIES: EngineLocality[] = ["device", "lan", "network"];

/** Turns a name into an id. Deterministic, so the same name gives the same id. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Checks a draft, naming every problem rather than the first.
 *
 * Every problem at once on purpose: a forge that rejects a form one field at a
 * time makes the author submit five times to learn five things, and the fifth
 * rejection is the one that makes them give up.
 *
 * An index is only worth saving if it can actually answer. So a model that is
 * not in the registry, a partition that does not exist and an empty ladder are
 * all refusals — each of them would produce an index that looks saved, appears
 * in the launcher, and fails the first time it is asked anything.
 */
export function validateIndex(draft: Partial<IndexDraft>): Validation {
  const problems: string[] = [];

  const name = (draft.name ?? "").trim();
  if (!name) problems.push("It needs a name.");
  else if (name.length > 48) problems.push("The name is longer than 48 characters.");

  const id = (draft.id ?? "").trim();
  if (!id) problems.push("It needs an id.");
  else if (!ID_PATTERN.test(id)) {
    problems.push(
      `"${id}" is not a usable id — lowercase letters, digits and hyphens, 3 to 40 characters.`,
    );
  }

  const glyph = (draft.glyph ?? "").trim();
  if (!glyph) problems.push("It needs a glyph — one or two characters for the pill.");
  else if ([...glyph].length > 2) problems.push("The glyph is longer than two characters.");

  const specialty = (draft.specialty ?? "").trim();
  if (!specialty) problems.push("It needs a specialty — the one kind of question it is for.");

  const systemPrompt = (draft.systemPrompt ?? "").trim();
  if (!systemPrompt) problems.push("It needs a system prompt.");
  else if (systemPrompt.length > 8000) {
    // A micro model's context is small, and a prompt this long crowds out the
    // partition context that is the entire reason the index exists.
    problems.push("The system prompt is over 8000 characters — too long for a micro model.");
  }

  const keywords = (draft.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (keywords.length === 0) {
    problems.push("It needs at least one keyword, or nothing will ever route to it.");
  }

  const known = new Set(PARTITIONS.map((p) => p.id));
  const reads = draft.reads ?? [];
  for (const partition of reads) {
    if (!known.has(partition)) problems.push(`"${partition}" is not a partition.`);
  }

  const modelId = (draft.modelId ?? "").trim();
  if (!modelId) problems.push("It needs a model.");
  else if (!MICRO_MODELS.some((m) => m.id === modelId)) {
    problems.push(`"${modelId}" is not a model in the registry.`);
  }

  const ladder = draft.ladder ?? [];
  if (ladder.length === 0) {
    problems.push("It needs at least one engine locality, or nothing can answer it.");
  }
  for (const rung of ladder) {
    if (!LOCALITIES.includes(rung)) problems.push(`"${rung}" is not an engine locality.`);
  }

  for (const command of draft.commands ?? []) {
    if (!command.phrase?.trim()) problems.push("A command has no phrase.");
    if (command.route && !command.route.startsWith("/")) {
      problems.push(`"${command.route}" is not an in-app route — it must start with "/".`);
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  const now = new Date().toISOString();
  return {
    ok: true,
    index: {
      id,
      name,
      glyph,
      specialty,
      systemPrompt,
      keywords: [...new Set(keywords)],
      reads: [...new Set(reads)],
      modelId,
      ladder: [...new Set(ladder)],
      commands: (draft.commands ?? []).map((c) => ({
        phrase: c.phrase.trim(),
        ...(c.route ? { route: c.route.trim() } : {}),
      })),
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** A blank draft, pre-filled with choices that work rather than with nothing. */
export function emptyDraft(): IndexDraft {
  return {
    id: "",
    name: "",
    glyph: "◆",
    specialty: "",
    systemPrompt: "",
    keywords: [],
    reads: [],
    // The guidance model is the one that ships with the app, so a new index can
    // answer on a machine that has never been online without choosing anything.
    modelId: "bonsai-1.7b",
    // Offline-first by default, matching the built-in routers: the network is
    // where updates come from, never where answers come from.
    ladder: ["device", "lan"],
    commands: [],
  };
}
