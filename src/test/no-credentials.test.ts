import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { credentialMatches } from "@/lib/jackie-security";

/**
 * No committed file may hold a credential. Anything in this repository is
 * public the moment it is pushed, and stays in its history after deletion, so
 * a key that lands here has to be rotated, not just removed.
 *
 * It runs the same shapes Jackie's answer banner uses (src/lib/jackie-security.ts)
 * over every tracked file of this repository's own. third_party/ is left out:
 * those are upstream's projects, pinned and checked byte for byte by
 * scripts/vendor.sh, and a scan of their whole history at import found none.
 *
 * The two values allowed below are known, by fingerprint only:
 * - the Firebase web API key in the PC-OS bundle. Firebase web keys identify
 *   a project rather than unlock it and ship to every browser by design; its
 *   safety is the key's restrictions in Google Cloud, which docs/SECURITY_SCAN.md
 *   asks the owner to set.
 * - an OpenAI-shaped fake key the bundle's TermStudio demo plants on purpose
 *   for its code reviewer to find; its own text says it should not be there.
 *   (Not quoted here: this file is scanned too, and quoting it once made the
 *   test flag itself.)
 */
const KNOWN: Record<string, string> = {
  be0314d56ee89f54: "public/pc-os/assets/ Firebase web API key (public by design; restrict it in Google Cloud)",
  "7f1ebfe60bd2f26c": "public/pc-os/assets/ TermStudio demo's planted fake key",
};

const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);

describe("the repository's own files", () => {
  it("hold no credential: no API key, token, private key or service-role key", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .split("\0")
      .filter((f) => f && !f.startsWith("third_party/"));
    expect(files.length).toBeGreaterThan(500);

    const found: string[] = [];
    for (const file of files) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(file);
      } catch {
        continue; // deleted in the working tree; git still lists it until staged
      }
      if (bytes.subarray(0, 8000).includes(0)) continue;
      for (const { kind, value } of credentialMatches(bytes.toString("utf8"))) {
        const print = fingerprint(value);
        if (!(print in KNOWN && file.startsWith("public/pc-os/assets/"))) found.push(`${file}: ${kind} (sha256 ${print})`);
      }
    }
    expect(found, "rotate the credential, then remove it; deleting it alone leaves it in history").toEqual([]);
  });
});
