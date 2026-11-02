import { describe, expect, it } from "vitest";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * third_party/ holds other people's projects, each copied whole and untouched by
 * scripts/vendor.sh at the commit third_party/UPSTREAM pins. Whether a copy
 * still matches upstream byte for byte needs the network, so `vendor.sh --check`
 * proves that; what can be checked offline is checked here, because each of
 * these has a way of going wrong without anybody noticing:
 *
 * - a folder nobody recorded is code with no provenance and no way to update it;
 * - a project shipped without its licence is one this repository may not hold;
 * - FilmCraft pins craft-libs in its Cargo.toml, and a vendored craft-libs at a
 *   different commit is a copy that silently is not the one FilmCraft builds.
 */
const root = process.cwd();
const dir = join(root, "third_party");

function manifest(): { name: string; url: string; commit: string }[] {
  return readFileSync(join(dir, "UPSTREAM"), "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const [name, url, commit] = line.split(/\s+/);
      return { name, url, commit };
    });
}

describe("third_party/", () => {
  const entries = manifest();

  it("pins every project to a full commit of an https repository", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.url, e.name).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
      expect(e.commit, e.name).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("has a folder for every pinned project, and no folder nobody pinned", () => {
    const folders = readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()).sort();
    expect(folders).toEqual(entries.map((e) => e.name).sort());
  });

  it("keeps each project's licence with it", () => {
    for (const e of entries) {
      const files = readdirSync(join(dir, e.name));
      expect(files.some((f) => /^(licen[cs]e|copying)/i.test(f)), `${e.name} has no LICENSE or COPYING file`).toBe(true);
    }
  });

  it("vendors craft-libs at exactly the commit FilmCraft's Cargo.toml builds against", () => {
    const cargo = readFileSync(join(dir, "filmcraft", "Cargo.toml"), "utf8");
    const pinned = cargo.match(/^craft-ui = .*git = "https:\/\/github\.com\/storytold\/craft-libs", rev = "([0-9a-f]{40})"/m)?.[1];
    expect(pinned, "FilmCraft no longer pins craft-libs the way this test expects").toBeTruthy();
    expect(entries.find((e) => e.name === "craft-libs")?.commit).toBe(pinned);
  });

  // Every project's own .gitattributes applies inside this repository, at any
  // depth: an LFS filter in one would make every push demand an object this
  // repository never had.
  it("never carries a Git LFS filter, at any depth", () => {
    for (const e of entries) {
      const files = readdirSync(join(dir, e.name), { recursive: true, encoding: "utf8" });
      for (const f of files.filter((f) => f === ".gitattributes" || f.endsWith("/.gitattributes"))) {
        expect(readFileSync(join(dir, e.name, f), "utf8"), `${e.name}/${f}`).not.toMatch(/filter=lfs/);
      }
    }
  });

  it("keeps every symlink pointing inside its own project, never out into this repository or the machine", () => {
    for (const e of entries) {
      const project = join(dir, e.name);
      for (const f of readdirSync(project, { recursive: true, encoding: "utf8" })) {
        const path = join(project, f);
        if (!lstatSync(path).isSymbolicLink()) continue;
        const target = resolve(dirname(path), readlinkSync(path));
        expect(target.startsWith(project + sep), `${e.name}/${f} -> ${readlinkSync(path)}`).toBe(true);
      }
    }
  });

  // git archive leaves a submodule out, so vendor.sh fetches each at the commit
  // its project pins. An empty one would be a copy that looks whole and is not.
  it("fills every submodule a project declares", () => {
    for (const e of entries) {
      const gitmodules = join(dir, e.name, ".gitmodules");
      if (!existsSync(gitmodules)) continue;
      for (const [, path] of readFileSync(gitmodules, "utf8").matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)) {
        const sub = join(dir, e.name, path);
        expect(existsSync(sub) && readdirSync(sub).length > 0, `${e.name}/${path} is empty`).toBe(true);
      }
    }
  });
});
