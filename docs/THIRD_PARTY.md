# Third-party projects

`third_party/` holds other people's projects, each copied whole by
`scripts/vendor.sh` at the commit `third_party/UPSTREAM` pins and kept exactly
as upstream has it. Nothing in Jackie imports them; they sit beside the app,
not inside it. This page says what each one is, what it may be used for, and
what its security review found, because "it is in our repository" is easy to
mistake for "we checked it".

## The rules

- **Never edit a vendored file.** To move a project, run
  `scripts/vendor.sh <name> <commit>`; to prove nothing drifted, run
  `scripts/vendor.sh --check`. An untouched copy is the only kind anyone can
  audit by re-fetching, and for FilmCraft it is also a licence condition
  (below).
- **Their agent instructions are not ours.** FilmCraft's `CLAUDE.md` tells
  agents to start every session from FilmCraft's plan, pick their own tasks,
  commit after each one and not stop to ask. That is right for FilmCraft's
  contributors and wrong for anyone working on Jackie, so
  `.claude/settings.json` (`claudeMdExcludes`) keeps Claude Code from loading
  any `CLAUDE.md` or `AGENTS.md` under `third_party/`. Start sessions at the
  repository root: a session started inside `third_party/filmcraft/` may not
  read the root settings and would load it. `/context` lists the memory files
  a session actually loaded.
- **Their `.mcp.json` and `.github/` are inert here.** Claude Code reads
  project MCP servers, and GitHub reads workflows and Copilot instructions,
  only from the repository root.
- **Let `vendor.sh` stage what it imports.** A project's own `.gitattributes`
  applies inside this repository, and Cataclysm's `* text=auto` would have
  rewritten a file upstream stores with CRLF line endings; the script stages
  through a temporary `-text` rule in `.git/info/attributes`, the one
  attributes file that outranks every in-tree one, and with `-f`, because the
  root `.gitignore` ignores `dist` and `*.log` anywhere. `--stage <name>`
  re-stages a project without fetching it.
- **What `vendor.sh` refuses:** a project that keeps files in Git LFS
  (`git archive` would hand over pointers, and a pointer committed here makes
  every push demand an object this repository never had), a file over
  GitHub's 100 MB limit, and a symlink that points outside its own project.
  Submodules, which `git archive` leaves out, are fetched at the commit the
  project pins, as `git clone --recursive` would.
- **Build a copy, never the folder here.** Every one of these writes build
  output into its own tree. `cp -r third_party/<name> ~/src/` first.

`src/test/third-party.test.ts` checks what can be checked offline: every
folder is pinned, every pin is a full commit, every project kept its licence,
no `.gitattributes` at any depth carries an LFS filter, every symlink stays in
its project, every submodule is filled, and craft-libs is the commit FilmCraft
builds against.

## FilmCraft — `third_party/filmcraft`

The ArtCraft team's open-source, clean-room take on Adobe Premiere Pro, in
Rust: source and program monitors, a multi-track timeline with every trim,
Lumetri-style colour, keyframes, Premiere's 93 video effects and about 30
transitions, its own H.264, HEVC, ProRes and AAC codecs, and every action
exposed as a command an agent can drive. Native on macOS, Windows and Linux; in the browser through
WebAssembly. Upstream calls it young and moving fast, and it is: the review
below found real rough edges.

- **Upstream:** [storytold/filmcraft](https://github.com/storytold/filmcraft)
  at `ca36cf9` (11 October 2026). Many GitHub copies exist; one
  (`filmcraft-app/filmcraft`, "Download filmcraft…") has the shape of a
  malware lure. Only `storytold` is upstream.
- **Licence:** MIT OR Apache-2.0 for the code, with `NOTICE`, `ATTRIBUTION.md`
  and a `.attribution` file beside each asset. The fonts (Inter, JetBrains
  Mono, Noto Serif) are OFL-1.1 with their licence texts.
- **Except the ArtCraft logos.** `docs/brand/` holds trademarks under their own
  licence (`docs/brand/LICENSE-brand.txt`), not MIT/Apache. They may be used
  "as part of copies of this repository" and inside FilmCraft itself. Anyone
  who publishes a *modified* FilmCraft must remove them (`crates/ui-egui`
  compiles two of them into the app) and must not present it as ArtCraft's.
  That is why the copy here is never edited. Never use the ArtCraft name or
  marks for anything of Jackie's.
- **craft-libs — `third_party/craft-libs`:** FilmCraft's one dependency outside
  crates.io (shared UI components), at the commit FilmCraft's `Cargo.toml` pins
  (`5c874d5`), same licence. FilmCraft fetches that commit from GitHub when it
  builds; the hash fixes the content. To build from the copy here instead,
  copy both side by side and give cargo a patch:

  ```bash
  mkdir -p ~/src && cp -r third_party/filmcraft third_party/craft-libs ~/src/
  cd ~/src/filmcraft && cargo build --release -p filmcraft \
    --config 'patch."https://github.com/storytold/craft-libs".craft-ui.path="../craft-libs/crates/ui"'
  ```

  (The patch rewrites one line of the copy's `Cargo.lock`, which is why it is
  a copy.)

### Building and running it

Rust 1.95 or newer. `cargo run --release -p filmcraft` for the desktop app,
`-p filmcraft-cli` for the command line. The web build needs the
`wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.129 (see its
`docs/web.md`). It has **not** been compiled or run in this repository: the
session that imported it was not allowed to execute outside code, so
everything below comes from reading it.

### What the security review found

A static review read every file of both projects — build scripts, `xtask`,
packaging, CI, agent instructions, network, process and filesystem code, the
remote-control surface, model downloads and every binary file — and matched
all 652 crates.io dependencies against their published checksums.

**Nothing malicious.** No obfuscated payloads, no exfiltration, no hidden
network calls, no embedded executables, no Trojan Source characters, no
committed secrets. The three build scripts only generate code from local
files. All `unsafe` is confined to `crates/platform`. The network is touched
only by an opt-in model downloader that checks a SHA-256 for every file.

**Before you run it**, know these. All are upstream's design, documented or
not, and none is reachable from Jackie:

- **The control port (`--control <port>` or `FILMCRAFT_CONTROL_PORT`) has no
  authentication.** It listens on 127.0.0.1, which keeps browsers out but lets
  any other local process or user drive the editor with your rights: write a
  file anywhere (a caption export), overwrite one (a screenshot), delete media
  files, list folders, launch a path with the system opener. Its own docs say
  to enable it only while you use it. Never set the variable globally.
- **The MCP server (`filmcraft-cli mcp`) has no folder confinement.** Over
  stdio it is not network-reachable, but an agent given it can read, write and
  delete wherever you can, and it reads clip names, markers and captions from
  the open project verbatim — text a downloaded project could use to steer the
  agent. Do not wire it into Jackie's harnesses without a confinement layer.
- **Media Cache "Delete…" and its age policy delete every file under the
  chosen folder,** recursively, the policy at every start. Give it an empty
  folder of its own, never a drive or `~/Videos`.
- **Treat a downloaded `.fcproj` as untrusted.** It can name media on a
  network share (on Windows, opening it sends your NTLM hash), point scratch
  disks at any folder, and make Edit Original launch a path it supplies.
- **`cargo xtask web --serve` is a development server with a path traversal**
  (`GET /..../etc/passwd` escapes the dist folder) and no Host check. Serve
  `target/web/dist` with another server if you need one.
- **Downloads the GUI confirms, the control port and MCP do not:**
  `transcript.downloadModel` (up to 967 MB) and `tts.downloadVoices` (about
  336 MB) run without a prompt from those two surfaces. The downloader uses a
  pre-release TLS provider (`rustls-rustcrypto` 0.0.2-alpha) and has no read
  timeout.
- **Release packaging is upstream's, identity and all.** An AppImage built
  outside upstream's CI points its self-update at `storytold/filmcraft`
  releases; `packaging/linux/package.sh` runs `appimagetool` from a moving
  "continuous" tag unverified; the release workflow hands signing secrets to a
  reusable workflow pinned to `@main`. Its `.github/` workflows never run here
  (GitHub reads only the root `.github/`), but do not ship builds from these
  scripts unchanged.
- **One test downloads AV1 vectors with `curl`, unpinned and unchecked,** in
  the default `cargo test` run.
- **A dependency's build script (`rmcp` 3.5.0) sets `core.hooksPath` on the git
  repository two levels above its own source** — harmless while cargo keeps
  sources in `~/.cargo/registry`, but never `cargo vendor` FilmCraft's
  dependencies into this repository.
- `crates/h264enc/target/` is committed upstream despite its name: 3 MB of
  generated H.264 test output, inert.

## The ten open-world survival crafting games

Asked for "the 10 most highly rated GitHub open world crafting games —
survival, realism", this is the ranking: GitHub stars, in October 2026, among
open-source games whose source lives on GitHub and that have all three of an
open or generated world you roam, crafting, and something to survive. Realism
is described, not used to rank. Each claim below was checked against the
game's own code or README, not taken from a list.

| # | Game | Folder | Stars | Code / licence | Survival and crafting |
|---|------|--------|------:|----------------|-----------------------|
| 1 | **Luanti + VoxeLibre** | `luanti/`, `voxelibre/` | 13.7k | C++ and Lua. Luanti LGPL-2.1, media CC BY-SA; VoxeLibre GPL-3.0, no non-free media (its LEGAL.md) | An endless generated block world; hunger, health, hostile mobs, hundreds of recipes |
| 2 | **Cataclysm: Dark Days Ahead** | `cataclysm-dda/` | 13.3k | C++, CC BY-SA 3.0 | The most realistic: hunger, thirst, body temperature and clothing layers, injuries per limb, disease, thousands of recipes, and vehicles you build and repair, in a persistent generated New England |
| 3 | **Cubyz** | `cubyz/` | 3.7k | Zig, GPL-3.0 | A voxel world with no height limit and a huge view distance; procedural tool crafting; health and falling damage, no hunger yet |
| 4 | **TrueCraft** | `truecraft/` | 2.5k | C#, MIT | A clean-room Minecraft beta 1.7.3: health, food, hostile mobs, the 2011 crafting recipes |
| 5 | **Cataclysm: Bright Nights** | `cataclysm-bn/` | 1.3k | C++ and Lua, CC BY-SA 3.0 | Dark Days Ahead's oldest major fork: the same simulation, with Lua scripting and its own mod registry |
| 6 | **Crafter** | `crafter/` | 599 | Python, MIT | A 2D generated world built as an AI benchmark and playable by hand: food, water, sleep, health, a crafting tree |
| 7 | **Minicraft+** | `minicraft-plus/` | 584 | Java, GPL-3.0 | Notch's Minicraft extended: health, stamina, hunger, crafting, a survival mode |
| 8 | **Rusted Ruins** | `rusted-ruins/`, `rusted-ruins-pak/` | 560 | Rust, GPL-3.0; game data CC BY 4.0 | An open-world roguelike with crafting, cooking and nutrition |
| 9 | **Cataclysm: The Last Generation** | `cataclysm-tlg/` | 413 | C++, CC BY-SA 3.0 | A younger Dark Days Ahead fork, the same simulation |
| 10 | **Manic Digger** | `manicdigger/` | 404 | C#, public domain | A 9984×9984 block world whose survival mode has crafting but no mobs yet |

Luanti is an engine and VoxeLibre a game for it: since Luanti 5.8 the engine
ships only a test game, so the pair is one entry, ranked by the engine's
stars. VoxeLibre comes from its official GitHub mirror (168 stars); its
primary home is git.minetest.land. Three of the ten are Cataclysm: that
family is where open-source survival realism lives.

### Notes per game

- **VoxeLibre:** copy `third_party/voxelibre` into your Luanti games folder
  (`~/.minetest/games/` on Linux), never into `third_party/luanti`, then pick
  it in Luanti's menu.
- **TrueCraft** was archived in 2018. Its launcher offers to download Mojang's
  own Minecraft assets; that is Mojang's content under Mojang's terms, so do
  not. It ships seven prebuilt .NET libraries (in `lib/`, its launcher and its
  submodule), and a default texture pack (Pixeludi, by Wojtek Mroczek) whose licence the
  repository does not state: fine as part of a copy of TrueCraft, not to be
  reused elsewhere without asking. Its sounds are CC BY-SA, from Minetest and
  Freesound.
- **Minicraft+** is pinned to the head of `2.3.0-dev`, which its README names
  as the latest working build; `main` is mid-rewrite.
- **Rusted Ruins** needs its pak data, built from `rusted-ruins-pak` (see that
  README). Upstream calls it a very early project; the last commit was in
  February 2023.
- **Manic Digger** commits 18 prebuilt Windows and macOS libraries and build
  tools (`*.dll`, `*.exe`, `libenet.dylib`). Build from source; never run the
  committed `.exe` files. Three of its sounds are Freesound samples under
  Creative Commons Sampling Plus 1.0, which allows whole copies only for
  non-commercial use: do not ship them in anything sold.
- **Cataclysm: Bright Nights** carries `AGENTS.md` for its own contributors
  (kept from Claude Code like FilmCraft's), and **Dark Days Ahead** a Copilot
  instructions file that only applies at a repository's root.
- **Cataclysm: The Last Generation** is the biggest folder, 505 MB, of which
  396 MB is translations.
- None of them has been built or run in this repository, for the same reason
  as FilmCraft.

### What the import checks found

- No Git LFS, no file over 100 MB, a licence file in every project.
- 25 symlinks, all inside their own project: translated docs reusing English
  images, two READMEs and a docs icon, and the three Cataclysm games' Android
  builds linking to their own `data/`, `gfx/`, `lang/` and `src/`. Some
  dangle until a build creates the target; that is upstream's layout.
- A read-only scan of every file: no private keys or API tokens, no
  bidirectional or tag characters. Zero-width characters appear in 22 files,
  all text and none code: 17 translation files (Persian, Kannada, Hebrew and
  Malay in Arabic script use them as joiners and marks; the rest are stray
  zero-width spaces), four docs, and one stray U+200B in Dark Days Ahead's
  `data/json/recipes/recipe_medsandchemicals.json`.
- Binaries: Manic Digger's and TrueCraft's prebuilt libraries above; the
  Cataclysm forks' Android dependency archives (`android/app/deps*.zip`);
  Gradle wrapper jars in five projects; a Windows `.fon` bitmap font in Bright
  Nights.
- Their own `.gitattributes` set `text=auto` in five projects; staging through
  `vendor.sh` keeps every byte as upstream stores it, which `--check`
  confirms.

### What it costs

The ten add roughly 380 MB, compressed, to this repository's history; it was
about 21 MB before. Deleting a folder later does not take that back, and
every fresh clone (Lovable's included) downloads it.

### Licences, if any of this ever moves into Jackie

Holding these copies is aggregation: each keeps its own licence and nothing in
Jackie links to them. Copying their code *into* `src/` is different. GPL code
(VoxeLibre, Cubyz, Minicraft+, Rusted Ruins) would make Jackie itself GPL;
CC BY-SA content (the Cataclysm games, Luanti's media) requires credit and
sharing alike; MIT, public-domain and CC BY material (TrueCraft's code,
Crafter, Manic Digger's code, Rusted Ruins' data) needs only its notice
kept. Ask before mixing any of it into the app.

### Looked at and left out

| Project | Stars | Why not |
|---------|------:|---------|
| Mindustry | 29.3k | Not an open world: tower defence across separate maps, where "survival" means surviving waves |
| Craft (fogleman) | 11.1k | No crafting and no survival, despite the name |
| Veloren | 7.6k | No survival needs (an RPG without hunger or thirst), and its art is in Git LFS |
| Terasology | 3.9k | An engine; its survival game is a module repository with no licence file |
| Unturned (U3-SDK) | 3.9k | Source-available, all rights reserved; needs the Steam game |
| Space Station 14 | 3.9k | One space station per round, not an open world |
| Space Engineers | 3.0k | Archived, under an EULA, ships no assets; needs the purchased game |
| ClassiCube | 2.1k | Its README: "It will never support survival" |
| Luanti's minetest_game | 1.6k | "No real goals or built-in enemy mobs", by its own README |
| OpenStarbound | 1.4k | No licence; its README says it derives from Starbound's leaked source; needs the purchased game |
| KeeperRL | 1.0k | A dungeon builder, not a survival game |
| DwarfCorp | 631 | Its art, sound and music may not be redistributed |
| Ethertum | 543 | No crafting in its code yet |
| ourCraft | 509 | Its README describes neither survival nor crafting |
| freeminer | 470 | Its playable game is a submodule I could not confirm has survival |
| Cataclysm (Whales) | 384 | Qualifies; the 2010 original, eleventh by stars |
