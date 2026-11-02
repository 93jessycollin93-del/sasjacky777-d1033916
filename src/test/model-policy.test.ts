import { describe, expect, it } from "vitest";
import {
  chooseModel,
  exceedsSize,
  parseAllowlist,
} from "../../supabase/functions/_shared/modelPolicy";

/**
 * The hole these close: jackie-openrouter kept a set of known-free model ids,
 * and then sent whatever model the caller named to the provider anyway, using
 * the set only to add `known_free: false` to an error message. Any signed-in
 * user could therefore bill an arbitrary paid model to the project's account.
 * jackie-xai-media had the same gap on its `respond` action, and jackie-ollama
 * would load any model installed on the private host.
 *
 * Imported from the file the functions import, so there is no second copy to
 * drift out of step.
 */
describe("chooseModel", () => {
  const allowed = new Set(["free-a", "free-b"]);

  it("uses the fallback when no model is requested", () => {
    for (const nothing of [undefined, null, "", "   ", 42, {}]) {
      const choice = chooseModel(nothing, allowed, "free-a");
      expect(choice).toEqual({ ok: true, model: "free-a" });
    }
  });

  it("allows a model that is on the list", () => {
    expect(chooseModel("free-b", allowed, "free-a")).toEqual({ ok: true, model: "free-b" });
  });

  it("refuses a model that is not, which is the whole point", () => {
    // Compared whole rather than field by field: this project builds with
    // `strict: false`, where narrowing a union by its boolean discriminant is
    // unreliable, and a test that leans on it fails to typecheck.
    expect(chooseModel("openai/o1-preview", allowed, "free-a")).toEqual({
      ok: false,
      reason: "not_allowed",
      requested: "openai/o1-preview",
      allowed: ["free-a", "free-b"],
    });
  });

  it("trims, so whitespace is not a way past the list", () => {
    expect(chooseModel("  free-b  ", allowed, "free-a")).toEqual({ ok: true, model: "free-b" });
    expect(chooseModel(" paid-x ", allowed, "free-a").ok).toBe(false);
  });

  it("does not match case-insensitively or by prefix", () => {
    expect(chooseModel("FREE-B", allowed, "free-a").ok).toBe(false);
    expect(chooseModel("free-b-turbo", allowed, "free-a").ok).toBe(false);
  });

  it("refuses even the fallback when the allowlist omits it", () => {
    // An allowlist that does not contain its own default is a configuration
    // error. Failing visibly beats letting exactly one unlisted model through.
    expect(chooseModel(undefined, new Set(["free-b"]), "free-a").ok).toBe(false);
  });

  it("refuses everything when the allowlist is empty", () => {
    expect(chooseModel("anything", new Set<string>(), "free-a").ok).toBe(false);
  });
});

describe("parseAllowlist", () => {
  it("falls back when unset, so a missing variable does not open the gate", () => {
    expect(parseAllowlist(undefined, ["a"])).toEqual(new Set(["a"]));
    expect(parseAllowlist(null, ["a"])).toEqual(new Set(["a"]));
  });

  it("falls back when the value is blank or only separators", () => {
    // An empty set would refuse every model including the default, turning a
    // configuration typo into a total provider outage.
    expect(parseAllowlist("", ["a"])).toEqual(new Set(["a"]));
    expect(parseAllowlist("   ", ["a"])).toEqual(new Set(["a"]));
    expect(parseAllowlist(",,,", ["a"])).toEqual(new Set(["a"]));
  });

  it("parses and trims a list", () => {
    expect(parseAllowlist(" x , y ,z ", ["a"])).toEqual(new Set(["x", "y", "z"]));
  });

  it("replaces the fallback rather than extending it", () => {
    expect(parseAllowlist("x", ["a"])).toEqual(new Set(["x"]));
  });
});

describe("exceedsSize", () => {
  it("measures the serialised form", () => {
    expect(exceedsSize("abc", 10)).toBe(false);
    expect(exceedsSize("a".repeat(50), 10)).toBe(true);
  });

  it("treats null and undefined as empty rather than unmeasurable", () => {
    expect(exceedsSize(null, 5)).toBe(false);
    expect(exceedsSize(undefined, 5)).toBe(false);
  });

  it("treats what it cannot measure as over the cap", () => {
    // A cost limit that waves through anything it cannot size is not a limit.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(exceedsSize(cyclic, 1_000_000)).toBe(true);
    expect(exceedsSize({ n: 1n }, 1_000_000)).toBe(true);
  });
});
