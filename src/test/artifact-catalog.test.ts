import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  blockingSecrets,
  buildClusters,
  classifyPage,
  clusterKey,
  clusterKeyFor,
  detectFeatures,
  extractShikiCode,
  idFromSha,
  isFallbackTitle,
  isGenericTitle,
  nameFromFile,
  pickTitle,
  scanSecrets,
  sourceDocument,
  sourceLanguage,
  sourceTitle,
  staticTitle,
  untitledSource,
  validateCatalog,
} from "../../scripts/artifact-catalog.mjs";

/**
 * The decisions behind the Artifact Library (docs/ARTIFACTS.md): what a card is
 * called, which saved pages are not artifacts at all, and — because this
 * repository is public — which files may never be published.
 */

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
// Built at run time so no key-shaped literal sits in the repository for a
// secret scanner (or a person) to mistake for a leaked one.
const randomKeyBody = (n: number) => [...randomBytes(n)].map((b) => BASE62[b % 62]).join("");

describe("titles", () => {
  it("treats the exporters' default names and bare ids as no name at all", () => {
    for (const t of ["React Artifact", "Artifact", "  react   artifact ", "React Artifact 172", "Artifact (3)", "f4cff1ff-c59c-4ad6-9860-c5c953228eeb", "2903237636", ""]) {
      expect(isGenericTitle(t), t).toBe(true);
    }
    expect(isGenericTitle("Seed Vault")).toBe(false);
  });

  it("reads the name a person gave a file through Drive's and the uploader's mangling", () => {
    expect(nameFromFile("imperia_v04_archive.html")).toBe("imperia v04 archive");
    expect(nameFromFile("nano_x5f_ai_x5f_md_x5f_zero.html")).toBe("nano ai md zero");
    expect(nameFromFile("43b2d3ef-TermStudio_-_Web_Terminal_Workspace.html")).toBe("TermStudio - Web Terminal Workspace");
    expect(nameFromFile("cryoquadra-lab.html")).toBe("cryoquadra-lab");
    expect(nameFromFile("GREY___Eru_Archive___CYBERNETIC_s_wbarchive-2.html")).toBe("GREY Eru Archive CYBERNETIC s wbarchive");
  });

  it("gives an exporter-default file name no name rather than calling three hundred cards 'React Artifact'", () => {
    expect(nameFromFile("React_Artifact-172.html")).toBeNull();
    expect(nameFromFile("01f93307-React_Artifact91.html")).toBeNull();
    expect(nameFromFile("5ccefd5f-54d9469e-03fa-4660-96ee-3bf96564a85c.html")).toBeNull();
  });

  it("prefers what the artifact renders, then the file's name, then its <title>, and never returns nothing", () => {
    const html = "<title>Prism Workbench</title>";
    expect(pickTitle({ heading: "SEED VAULT  v0.1", fileName: "seed.html", html })).toBe("SEED VAULT v0.1");
    expect(pickTitle({ heading: "React Artifact", fileName: "seed_bank.html", html })).toBe("seed bank");
    expect(pickTitle({ heading: null, fileName: "Artifact.html", html })).toBe("Prism Workbench");
    expect(pickTitle({ heading: null, fileName: "Artifact.html", html: "<title>React Artifact</title>" })).toBe("Untitled artifact");
  });

  it("shortens a heading that is really a paragraph", () => {
    const title = pickTitle({ heading: "word ".repeat(40), fileName: "x.html", html: "" });
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("decodes entities in a document title", () => {
    expect(staticTitle("<title>Q&amp;A &#8212; Lab</title>")).toBe("Q&A — Lab");
  });
});

describe("grouping versions", () => {
  it("puts versions saved under the same heading together, whatever their version number or punctuation", () => {
    expect(clusterKey("SEED VAULT v0.1")).toBe(clusterKey("Seed Vault — v2"));
    expect(clusterKey("JACKY v3")).toBe(clusterKey("Jacky"));
    expect(clusterKey("Seed Vault")).not.toBe(clusterKey("Seed Bank"));
  });

  it("keeps things with no name apart instead of hiding unrelated apps behind one card", () => {
    const a = { id: "a".repeat(16), title: "Untitled artifact" };
    const b = { id: "b".repeat(16), title: "Untitled artifact" };
    const c = { id: "c".repeat(16), title: untitledSource("python") };
    expect(clusterKeyFor(a)).not.toBe(clusterKeyFor(b));
    expect(isFallbackTitle(c.title)).toBe(true);
    expect(clusterKeyFor(c)).toBe(`untitled-${c.id}`);
    expect(clusterKeyFor({ id: "d".repeat(16), title: "Seed Vault v2" })).toBe(clusterKey("Seed Vault"));
  });

  it("orders groups and versions newest first, with undated items after dated ones", () => {
    const items = [
      { id: "a".repeat(16), cluster: "x", title: "X old", modified: "2026-01-01T00:00:00Z" },
      { id: "b".repeat(16), cluster: "x", title: "X new", modified: "2026-03-01T00:00:00Z" },
      { id: "c".repeat(16), cluster: "y", title: "Y", modified: null },
      { id: "d".repeat(16), cluster: "z", title: "Z", modified: "2026-02-01T00:00:00Z" },
    ];
    const clusters = buildClusters(items);
    expect(clusters.map((c) => c.key)).toEqual(["x", "z", "y"]);
    expect(clusters[0].ids).toEqual(["b".repeat(16), "a".repeat(16)]);
    expect(clusters[0].title).toBe("X new");
  });
});

describe("credentials in a public repository", () => {
  it("stops a realistic key", () => {
    const text = `const KEY = "sk-proj-${randomKeyBody(48)}";`;
    const findings = scanSecrets(text);
    expect(findings).toHaveLength(1);
    expect(blockingSecrets(findings)).toHaveLength(1);
  });

  it("lets the example keys these artifacts are full of through", () => {
    const text = [
      "OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx",
      "OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxx",
      'apiKey: "sk-your-key-goes-here-0000000000"',
    ].join("\n");
    const findings = scanSecrets(text);
    expect(findings.length).toBeGreaterThan(0);
    expect(blockingSecrets(findings)).toEqual([]);
  });

  it("always stops a private key block, which has no placeholder form", () => {
    expect(blockingSecrets(scanSecrets("-----BEGIN PRIVATE KEY-----\nMIIE..."))).toHaveLength(1);
  });

  it("never carries the secret itself in a finding, so a report cannot leak it", () => {
    const body = randomKeyBody(40);
    const [finding] = scanSecrets(`ghp_${body}`);
    expect(JSON.stringify(finding)).not.toContain(body);
  });

  it("does not mistake ordinary hyphenated words for keys", () => {
    expect(scanSecrets('<div class="task-manager-container-wrapper-outer">')).toEqual([]);
  });
});

describe("what an artifact does", () => {
  it("notices storage, IndexedDB, network use and scripts from other hosts", () => {
    const f = detectFeatures(
      '<script src="https://cdn.tailwindcss.com"></script><script>localStorage.setItem("a",1);indexedDB.open("x");fetch("https://api.example.com/v1")</script>',
    );
    expect(f.localStorage).toBe(true);
    expect(f.indexedDB).toBe(true);
    expect(f.network).toBe(true);
    expect(f.scriptHosts).toEqual(["cdn.tailwindcss.com"]);
    expect(f.hosts).toContain("api.example.com");
  });

  it("reports nothing for a self-contained page", () => {
    const f = detectFeatures("<div>hello</div>");
    expect(f).toMatchObject({ localStorage: false, indexedDB: false, network: false, scriptHosts: [] });
  });
});

const codeView = (code: string) =>
  `<html><head><link rel="stylesheet" href="/_next/static/x.css"></head><body>` +
  `<div class="select-none" aria-hidden="true"><div>1</div><div>2</div></div>` +
  `<code><pre class="shiki shiki-themes github-light github-dark" tabindex="0"><code>` +
  code
    .split("\n")
    .map((l) => `<span class="line"><span style="--shiki-dark:#F97583">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span></span>`)
    .join("\n") +
  `</code></pre></code></body></html>`;

describe("saved pages that are not artifacts", () => {
  it("recovers the exact source from a saved code view, line for line", () => {
    const code = 'import { useState } from "react";\n\nexport default function SeedVault() {\n  return <div>a && b</div>;\n}';
    expect(extractShikiCode(codeView(code))).toBe(code);
  });

  it("classifies a code view as recovered source, named after its component", () => {
    const page = classifyPage(codeView("export default function SeedVault() {\n  return <div/>;\n}"));
    expect(page).toMatchObject({ kind: "source", title: "Seed Vault", language: "jsx" });
  });

  it("keeps a rendered document whole even when it contains code samples", () => {
    const doc = `<html><head><link href="/_next/static/a.css"></head><body><h1>The eYe Protocol</h1><pre class="shiki"><code><span class="line">x</span></code></pre></body></html>`;
    expect(classifyPage(doc).kind).toBe("artifact");
  });

  it("leaves out saved Twitch, ChatGPT and share pages, with a reason a person can read", () => {
    const twitch = classifyPage("<meta property='og:site_name' content='Twitch'><title>Twitch</title>");
    const chat = classifyPage('<meta property="og:site_name" content="ChatGPT"/><title>ChatGPT - Telegram Assistant Design</title>');
    const share = classifyPage("<title>Meta AI</title><div>Content is user-generated and unverified.</div>");
    for (const page of [twitch, chat, share]) {
      expect(page.kind).toBe("skip");
      expect(page.reason).toMatch(/saved .* page/);
    }
    expect(chat.title).toBe("ChatGPT - Telegram Assistant Design");
  });

  it("treats an ordinary artifact as an artifact", () => {
    expect(classifyPage("<title>React Artifact</title><div id=root></div>").kind).toBe("artifact");
  });

  it("names recovered source from its docstring, comment, or top-level JSON name", () => {
    expect(sourceTitle('#!/usr/bin/env python3\n"""\nSAS Skills Registry - generated\n"""')).toBe("SAS Skills Registry - generated");
    expect(sourceTitle("#!/bin/bash\n# Pocket AI Lab - offline setup for Android")).toBe("Pocket AI Lab - offline setup for Android");
    expect(sourceTitle('{"id": "x", "name": "Secret Box Swarm Agent"}')).toBe("Secret Box Swarm Agent");
    expect(sourceTitle('[{"name": "Python"}, {"name": "Go"}]')).toBeNull();
  });

  it("labels the language of recovered source", () => {
    expect(sourceLanguage('{"a": 1}')).toBe("json");
    expect(sourceLanguage("#!/bin/bash\necho hi")).toBe("shell");
    expect(sourceLanguage("from fastapi import FastAPI\napp = FastAPI()")).toBe("python");
    expect(sourceLanguage("const a = 1;")).toBe("javascript");
  });

  it("shows recovered source as inert text, even code that contains markup", () => {
    const html = sourceDocument({ title: "x</title><script>", code: "</pre><script>alert(1)</script>" });
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/<title>x<\/title><script>/);
    expect(html).toContain("&lt;/pre&gt;&lt;script&gt;");
  });
});

describe("catalog integrity", () => {
  const sha = "ab".repeat(32);
  const item = { id: sha.slice(0, 16), sha256: sha, title: "A", kind: "artifact", file: `files/${sha.slice(0, 16)}.bin` };

  it("derives ids from the content hash and refuses anything else", () => {
    expect(idFromSha(sha)).toBe(sha.slice(0, 16));
    expect(() => idFromSha("not-a-hash")).toThrow();
  });

  it("accepts a well-formed catalog", () => {
    expect(validateCatalog({ version: 1, items: [item], clusters: [{ key: "a", ids: [item.id] }], skipped: [] })).toEqual([]);
  });

  it("catches an id that is not its file's hash, a wrong file path, and a group naming a missing item", () => {
    const problems = validateCatalog({
      version: 1,
      items: [{ ...item, id: "0".repeat(16), file: "files/other.bin" }],
      clusters: [{ key: "a", ids: ["f".repeat(16)] }],
    });
    expect(problems.join("\n")).toMatch(/not the start of its sha256/);
    expect(problems.join("\n")).toMatch(/file path/);
    expect(problems.join("\n")).toMatch(/unknown id/);
  });

  it("catches the same artifact listed twice", () => {
    expect(validateCatalog({ version: 1, items: [item, item], clusters: [] }).join()).toMatch(/duplicate id/);
  });
});
