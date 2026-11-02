# context-condenser

A context condensing engine with **anchored dehydration** and **real rehydration**,
assembled from the condenser fleet scattered across this account.

## The rule the whole design hangs on

Condensation is **lossy and one-way**. Archival is **lossless and reversible**.
You cannot invert a summary — so a condensate is never allowed to exist without
a reference to the lossless bytes it came from.

Every claim carries an **anchor**: the archive's SHA-256 plus the byte span the
claim was derived from. Rehydration resolves those anchors and returns the
original text verbatim — for one claim, or for all of them.

```
dehydrate(text) ─┬─> archive   lossless, gzip framed, content-addressed, optionally AES-256-GCM
                 └─> condensate lossy, small, every claim anchored to a byte span

rehydrate(cnd, { claims: [3] }) ──> the exact source bytes behind claim 3
```

That is **progressive rehydration**: read the condensate first, pull detail only
where you need it. A 445-byte span read out of a large pod inflates one 64 KB
frame — not the whole archive.

## Packages

| Package | What it is |
|---|---|
| `packages/condensers` | The 30-condenser catalog as portable JSON, plus a validator |
| `packages/core` | The Condensate v1 contract and its structural invariants |
| `packages/vault` | Frame-chunked content-addressed archive; gzip/LZW/RLE codecs; AES-256-GCM |
| `packages/local` | Deterministic offline engine — no key, no network, no cost |
| `packages/providers` | Provider chain (Ollama, any OpenAI-compatible gateway) with fallback |
| `packages/llm` | LLM tier, same signature, drops any model line it cannot anchor |
| `packages/eye` | The eYe sphere: sequential pod ring, one pod resident at a time |
| `packages/cli` | `cce` command |
| `packages/mcp` | MCP stdio server — lets an agent condense its own context |

## Use

```sh
export CCE_VAULT=./.cce-vault
export CCE_PASSPHRASE=...          # optional; encrypts archives at rest

npm run cce -- dehydrate notes.md --out cnd.json
npm run cce -- rehydrate cnd.json --claim 0
npm run cce -- rehydrate cnd.json --full
npm run cce -- chain notes.md      # run the eYe ring
npm run cce -- condensers logical
npm test
```

### As an MCP server

```json
{ "mcpServers": { "condenser": {
    "command": "node",
    "args": ["--experimental-strip-types", "packages/mcp/server.ts"],
    "env": { "CCE_VAULT": "/path/to/vault" }
} } }
```

Tools: `dehydrate`, `rehydrate`, `list_condensers`, `run_sphere`.

## The eYe sphere

From `.agents/memory/pod-chain-vision.md`: a ring of small pods, each hydrated
one at a time, each passing condensed reasoning to the next, with a compiler at
the centre. That doc lists *"how condensed reasoning is serialized between pods"*
as an open question.

**The hand-off payload is a Condensate.** So the hand-off is anchored: the
compiler can pull the exact source bytes behind any pod's claim without that pod
being resident and without carrying raw text around the ring.

Two invariants are enforced, not assumed:

- **Budget** — a pod over its byte budget halts the chain instead of swelling.
- **Contraction** — each pod must hand on strictly less than it received. If the
  first pass doesn't contract, the density tightens and it re-condenses. Once a
  payload is already minimal, the pod passes it through (`contracted: false`)
  rather than growing the ring.

## Provenance

Merged from, and superseding, these fleet repos:

| From | Contribution |
|---|---|
| `logbook-curator-2b201808` | the 30-condenser catalog; LZW/RLE/gzip codecs |
| `signal-sharpener` | typed structural components, tension pairs |
| `signal-weaver-73` | graduated density layers |
| `tension-tamer` | polarity preservation |
| `relational-compass` | relational abstraction |
| `core-light-vault` | uncertainty assessment, pattern law |
| `deep-cosmos-chat` | offline-first architecture, env-var provider upgrade |
| `jackie-core-keeper` | pod lifecycle, SHA-256 integrity, provider fallback, recursive rollup |

### Deliberately not carried over

`lib/compression/ecps-codec.js` claimed lossless 150× compression. Its first
stage is `tokens.push(chunk % vocabSize)` — a 16-bit value taken modulo 32,000,
which collapses every value above 31,999 and cannot be inverted. It was
irreversible on its first line of real work. Gzip framing does the honest
version of the same job.

The same bug class was found and fixed in the LZW codec while porting it: the
dictionary seeds bytes 0–255, so running it over UTF-16 characters silently
mapped `✓` to a null byte. It now operates on UTF-8 bytes and round-trips
exactly. There is a test for it.
