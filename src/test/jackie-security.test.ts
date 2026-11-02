import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeFlag, detectSecurityFlag, findCredentials, isCredentialFlag } from "@/lib/jackie-security";

/*
 * Secret-shaped test values are assembled at run time, so this file never
 * holds a string a scanner (GitHub push protection, ours) would take for a
 * leaked key.
 */
const anthropicKey = ["sk", "ant", "api03", "Q7w2Lk9Zp4Rt8Vx1Ny6Mb3Hc5Jd0Fg"].join("-") + "Aa9Bb8Cc7";
const googleKey = "AI" + "za" + "SyD4" + "k9Tq2Lm7Wx3Pz8Rv1Nc6Bh5Jf0Gs4Ha";
const jwt = (payload: object) =>
  [btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })), btoa(JSON.stringify(payload)), "c2lnbmF0dXJlLW5vdC1jaGVja2Vk"]
    .map((part) => part.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"))
    .join(".");

describe("the banner above Jackie's answers", () => {
  it("does not report a leak when Jackie describes her own job, which mentions exposed secrets", () => {
    const persona = readFileSync(join(process.cwd(), "supabase/functions/_shared/persona.ts"), "utf8");
    const line = persona.split("\n").find((l) => /exposed secrets/.test(l));
    expect(line, "persona.ts no longer has the line this guards").toBeTruthy();
    const answer = `Understood. You're asking about the system that defines me. ${line}`;
    const flag = detectSecurityFlag(answer);
    expect(flag).toBe("Discusses exposed credentials");
    expect(isCredentialFlag(flag)).toBe(false);
  });

  it("raises the alarm for a real credential in the answer, naming its kind and never its value", () => {
    const flag = detectSecurityFlag(`Here is your config: ANTHROPIC_API_KEY=${anthropicKey}`);
    expect(flag).toBe("Credential in this answer: Anthropic API key");
    expect(isCredentialFlag(flag)).toBe(true);
    expect(flag).not.toContain(anthropicKey.slice(8));
  });

  it("names every kind of credential an answer holds", () => {
    expect(findCredentials(`${anthropicKey} and ${googleKey}`).sort()).toEqual(["Anthropic API key", "Google API key"]);
  });

  it("flags a Supabase service-role key, which bypasses row-level security, but not the public anon key", () => {
    expect(findCredentials(jwt({ iss: "supabase", role: "service_role" }))).toEqual(["Supabase service-role key"]);
    expect(findCredentials(jwt({ iss: "supabase", role: "anon" }))).toEqual([]);
  });

  it("does not mistake an example placeholder or AWS's documentation key for a leak", () => {
    expect(findCredentials("export OPENAI_API_KEY=sk-" + "x".repeat(40))).toEqual([]);
    expect(findCredentials("aws_access_key_id = " + "AKIAIOSFODNN7" + "EXAMPLE")).toEqual([]);
  });

  it("says nothing when an answer neither holds a credential nor discusses security", () => {
    expect(detectSecurityFlag("The Moon is 384,400 km away on average.")).toBeNull();
  });

  it("shows the labels saved before this fix as what they always were: discussions, not incidents", () => {
    expect(describeFlag("Exposed Credential")).toBe("Discusses exposed credentials");
    expect(describeFlag("Hardcoded Secret Detected")).toBe("Discusses hardcoded secrets");
    expect(isCredentialFlag(describeFlag("API Key Exposure"))).toBe(false);
    expect(describeFlag(null)).toBeNull();
    expect(describeFlag("Credential in this answer: GitHub token")).toBe("Credential in this answer: GitHub token");
  });
});
