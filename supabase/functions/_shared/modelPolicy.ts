/**
 * Which model a request may use, and how big a request may be.
 *
 * These are the decisions that stop an authenticated user spending the
 * project's provider credit on whatever model they name, so they are kept
 * apart from the transport that acts on them: no Deno globals and no network
 * imports live here, which is what lets `src/test/model-policy.test.ts` import
 * this exact file rather than a copy of it.
 *
 * The rule they encode is fail-closed. The version of this logic they replace
 * kept a set of known-free model ids and then sent whatever the caller asked
 * for anyway, using the set only to annotate an error message — so the
 * allowlist existed, was correct, and protected nothing.
 */

export type ModelChoice =
  | { ok: true; model: string }
  | { ok: false; reason: "not_allowed"; requested: string; allowed: string[] };

/**
 * Resolves the model for a request.
 *
 * An absent or blank request means the caller expressed no preference and gets
 * the default. Anything else has to be in the allowlist — including the
 * default itself, so that an allowlist which omits its own fallback fails
 * visibly rather than quietly letting one unlisted model through.
 */
export function chooseModel(
  requested: unknown,
  allowed: ReadonlySet<string>,
  fallback: string,
): ModelChoice {
  const asked = typeof requested === "string" ? requested.trim() : "";
  const model = asked || fallback;
  if (!allowed.has(model)) {
    return { ok: false, reason: "not_allowed", requested: model, allowed: [...allowed].sort() };
  }
  return { ok: true, model };
}

/**
 * Parses a comma-separated allowlist.
 *
 * An unset or entirely empty value falls back to the built-in list rather than
 * to an empty set: a typo in configuration should not silently disable a
 * provider, and an empty allowlist refuses every model including the default.
 */
export function parseAllowlist(raw: string | undefined | null, fallback: readonly string[]): Set<string> {
  if (!raw) return new Set(fallback);
  const parsed = raw.split(",").map((m) => m.trim()).filter(Boolean);
  return parsed.length > 0 ? new Set(parsed) : new Set(fallback);
}

/**
 * Whether a payload is over the size cap.
 *
 * Anything that cannot be serialised — a cycle, a BigInt — counts as over the
 * cap. It cannot be sent upstream regardless, and treating "unmeasurable" as
 * "acceptable" is the wrong default for a limit whose job is to bound cost.
 */
export function exceedsSize(value: unknown, maxChars: number): boolean {
  try {
    return JSON.stringify(value ?? "").length > maxChars;
  } catch {
    return true;
  }
}
