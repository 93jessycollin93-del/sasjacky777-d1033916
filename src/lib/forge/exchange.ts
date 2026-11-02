/**
 * Getting indexes in and out of the forge as files.
 *
 * An index is a small, self-contained description of a specialised assistant,
 * which makes it exactly the sort of thing people want to hand to each other,
 * keep in a repo, or carry to another machine. So the file format is part of
 * the feature rather than an afterthought bolted on later.
 *
 * Two decisions that look fussy and are not:
 *
 * **It is an envelope, not a bare array.** A file that is just
 * `[{...},{...}]` cannot say what it is or which version it was written by, so
 * the first change to the shape makes every file already on disk ambiguous.
 *
 * **Every index is re-validated on the way in.** An exported file is editable
 * text and people do edit it. Trusting it would let a hand-written model id or
 * a partition that no longer exists into the registry, where it becomes an
 * index that appears in the launcher and fails the first time it is asked
 * anything. Import reports what it refused and why, and keeps the rest.
 */
import {
  FORGE_SCHEMA_VERSION,
  validateIndex,
  type CraftedIndex,
} from "./types";

export interface ForgeFile {
  kind: "sas-jacky.index-pack";
  version: number;
  exportedAt: string;
  indexes: CraftedIndex[];
}

export interface ImportReport {
  /** Indexes that validated and may be saved. */
  accepted: CraftedIndex[];
  /** One line per index that was refused, naming it and the reason. */
  rejected: string[];
}

export function exportIndexes(indexes: CraftedIndex[]): ForgeFile {
  return {
    kind: "sas-jacky.index-pack",
    version: FORGE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    indexes,
  };
}

/** Pretty-printed, because these files get read and edited by hand. */
export function serializeIndexes(indexes: CraftedIndex[]): string {
  return JSON.stringify(exportIndexes(indexes), null, 2);
}

export function suggestFilename(indexes: CraftedIndex[]): string {
  const stamp = new Date().toISOString().slice(0, 10);
  if (indexes.length === 1) return `${indexes[0].id}-${stamp}.index.json`;
  return `sas-jacky-indexes-${stamp}.json`;
}

/**
 * Reads a file back, refusing what it cannot vouch for.
 *
 * A single index is accepted as well as a pack: people export one, mail it, and
 * the recipient should not have to know the difference.
 */
export function parseIndexes(raw: string): ImportReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      accepted: [],
      rejected: [`That file is not JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const candidates = readCandidates(parsed);
  if (!candidates) {
    return {
      accepted: [],
      rejected: [
        "That file is not an index pack. Expected an object with an `indexes` array, or a single index.",
      ],
    };
  }

  if (candidates.version !== null && candidates.version > FORGE_SCHEMA_VERSION) {
    // Refused rather than attempted: a newer file may carry fields this build
    // would silently drop, and a silently truncated index is worse than one
    // that was not imported.
    return {
      accepted: [],
      rejected: [
        `That pack is version ${candidates.version}; this build reads up to ${FORGE_SCHEMA_VERSION}. Update the app.`,
      ],
    };
  }

  const accepted: CraftedIndex[] = [];
  const rejected: string[] = [];

  candidates.indexes.forEach((candidate, position) => {
    if (!candidate || typeof candidate !== "object") {
      rejected.push(`Entry ${position + 1} is not an object.`);
      return;
    }
    const draft = candidate as Record<string, unknown>;
    const label = typeof draft.name === "string" && draft.name.trim() ? draft.name : `entry ${position + 1}`;

    // Read through an explicit shape rather than by narrowing the union on
    // `ok`. This project compiles with `strict: false`, where narrowing a
    // discriminated union by its boolean discriminant does not work — the same
    // wart `src/test/chat-request.test.ts` documents for `chooseModel`.
    const verdict = validateIndex(draft as never) as {
      ok: boolean;
      index?: CraftedIndex;
      problems?: string[];
    };
    if (verdict.ok !== true || !verdict.index) {
      rejected.push(`${label}: ${(verdict.problems ?? ["refused"]).join(" ")}`);
      return;
    }

    // Timestamps are carried over when the file has them: an imported index
    // that claims to have been created the moment it was imported loses the
    // only history it had.
    accepted.push({
      ...verdict.index,
      createdAt: isoOr(draft.createdAt, verdict.index.createdAt),
      updatedAt: isoOr(draft.updatedAt, verdict.index.updatedAt),
    });
  });

  return { accepted, rejected };
}

function readCandidates(parsed: unknown): { indexes: unknown[]; version: number | null } | null {
  if (Array.isArray(parsed)) return { indexes: parsed, version: null };
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.indexes)) {
    return {
      indexes: obj.indexes,
      version: typeof obj.version === "number" ? obj.version : null,
    };
  }
  // A single index, exported on its own.
  if (typeof obj.id === "string" && typeof obj.specialty === "string") {
    return { indexes: [obj], version: null };
  }
  return null;
}

function isoOr(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}
