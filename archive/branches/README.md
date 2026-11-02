# Archived branches

Six branches of this repository share no history with SAS-JACKY: `main`,
`master`, `bionic/router-stack-v1` and `bionic/command-station-integration-v2`,
`-v3` and `-v4` (v3 and v4 point at the same commit). Deleting a branch like that
deletes its commits too, so before they go, every file version on them that
SAS-JACKY never had is copied here, and their commit messages are in
[HISTORY.md](HISTORY.md).

**Nothing in this folder runs.** It is not imported, bundled, linted, typechecked
or collected by pytest, and it should stay that way: most of it is an older draft
of something SAS-JACKY has since fixed, and one part of it is unsafe (below).
Read it; if something here is worth having, port it into the live tree with a
test, the way the one thing that was worth it already has been.

Two files were renamed so they cannot act on the tree around them:
`.gitignore` → `gitignore.txt` (a live one here would hide files in this folder)
and `.env.example` → `env.example.txt`.

## What was brought into SAS-JACKY instead of archived

- **`/chat/completions` and `/complete/auto` on the router.** The agent runtime's
  client (`Jackie/core/engine/fs/jackie_router_client.py`) posts to both. They
  lived in `command-station-integration-v2`'s `router_final.py`, and when
  SAS-JACKY's `router_final.py` became a thin shell over `jackierouter` they were
  left behind — so every agent call 404'd against the router the runtime ships
  with. They are back in `jackierouter/gateway.py`, going through the routing
  ladder rather than straight to one Ollama model, and `tests/test_gateway.py`
  now fails if the client calls anything the gateway does not serve.

## What each folder is, and what replaced it

`-v3` and `-v4` have no folder: every file version on them is also on
`main`, `bionic/router-stack-v1` or v2, and is filed under the first of those.

| Folder | What it is | Where SAS-JACKY has it now |
| --- | --- | --- |
| `main/` | The filesystem layer (`resolver`, `path_sanitizer`, `vault_router`, `tool_runner`, `manifest_locator`), command-station docs, and an 83-line README summarising the rig side — all earlier, shorter versions. | The same paths in the live tree, each longer and tested. The README's rig-side summary is `jackierouter/README.md` and `command_station/README.md`. |
| `bionic-router-stack-v1/` | `router_final.py` as a direct-to-Ollama gateway with model names hard-coded per pod, and an earlier `hybrid_router.py` and its suite. | `jackierouter/` — the same pod rules as capabilities (`gateway.capability_for`), a configurable ladder instead of fixed models. `command_station/tools/` has the later router and suite, which pytest runs. |
| `bionic-command-station-integration-v2/` | The agent runtime before it was recovered — the execution graph that recorded every task as a success (`success=True  # simplified`), flat imports that only resolved from inside `fs/`. Also a copy of the router under `fs/`, and `apps/ui-hub/`, four placeholder files for a web IDE that render a heading. | `Jackie/core/engine/`, with `tests/test_jackie_os_runtime.py`. The router endpoints came across (above). The web IDE is the app itself: `/workstation`, `/agent-lab`, `/pc`. |
| `master/` | Three short sketches, each with a doc: `src/jackie/` (router, orchestrator, memory, personality, terminal), `src/jackie_app/` (UI, terminals, transitions, a Wayland stub that returns strings), `src/vault/` (a key vault). | Jackie's brain is `Jackie/core/engine/` and the web app; the key vault is the app's API Keys page (`/keys`). |

## Do not use `master/src/vault/`

It describes itself as AES-256-GCM. It is not encryption at all:

- `Encryptor.encrypt` returns the plaintext in the output next to a SHA-256 of
  the key, and `decrypt` hands that plaintext back. Anything "encrypted" with it
  is stored readable.
- It falls back to the password `"default"` with a fixed salt when
  `VAULT_PASSWORD` is unset.
- `api_key_vault.encrypt_key` is a one-way hash, so nothing it "encrypts" can be
  decrypted, and `rotate_key` writes the stored secret into `.vault/decrypt.key`.

It is kept because it is part of the history you asked to keep, not because any
of it should be revived. A vault that says it encrypts and does not is worse than
no vault, because it is trusted.

## Every file here

| Archived at | Original path | Found on |
| --- | --- | --- |
| `main/env.example.txt` | `.env.example` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `main/gitignore.txt` | `.gitignore` | main |
| `main/Jackie/core/engine/bootstrap_fs.py` | `Jackie/core/engine/bootstrap_fs.py` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `main/Jackie/core/engine/fs/__init__.py` | `Jackie/core/engine/fs/__init__.py` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `main/Jackie/core/engine/fs/manifest_locator.py` | `Jackie/core/engine/fs/manifest_locator.py` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `main/Jackie/core/engine/fs/path_sanitizer.py` | `Jackie/core/engine/fs/path_sanitizer.py` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `main/Jackie/core/engine/fs/resolver.py` | `Jackie/core/engine/fs/resolver.py` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `main/Jackie/core/engine/fs/tool_runner.py` | `Jackie/core/engine/fs/tool_runner.py` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `main/Jackie/core/engine/fs/vault_router.py` | `Jackie/core/engine/fs/vault_router.py` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `main/README.md` | `README.md` | main |
| `main/command_station/README.md` | `command_station/README.md` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `main/command_station/docs/REPO_COMMAND_STATION_INTEGRATION_PLAN.md` | `command_station/docs/REPO_COMMAND_STATION_INTEGRATION_PLAN.md` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `main/command_station/models/manifests/E_PERMANENT_MASTER_MANIFEST.json` | `command_station/models/manifests/E_PERMANENT_MASTER_MANIFEST.json` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `main/command_station/models/manifests/README.md` | `command_station/models/manifests/README.md` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1, main |
| `bionic-router-stack-v1/README.md` | `README.md` | bionic/command-station-integration-v2, bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1 |
| `bionic-router-stack-v1/command_station/tools/hybrid_router.py` | `command_station/tools/hybrid_router.py` | bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1 |
| `bionic-router-stack-v1/command_station/tools/test_router_suite.py` | `command_station/tools/test_router_suite.py` | bionic/command-station-integration-v3, bionic/command-station-integration-v4, bionic/router-stack-v1 |
| `bionic-router-stack-v1/router_entry.py` | `router_entry.py` | bionic/router-stack-v1 |
| `bionic-router-stack-v1/router_final.py` | `router_final.py` | bionic/router-stack-v1 |
| `bionic-command-station-integration-v2/Jackie/core/engine/fs/execution_graph.py` | `Jackie/core/engine/fs/execution_graph.py` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/Jackie/core/engine/fs/jackie_orchestrator.py` | `Jackie/core/engine/fs/jackie_orchestrator.py` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/Jackie/core/engine/fs/jackie_service_entry.py` | `Jackie/core/engine/fs/jackie_service_entry.py` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/Jackie/core/engine/fs/pod_backpack_manager.py` | `Jackie/core/engine/fs/pod_backpack_manager.py` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/Jackie/core/engine/fs/router_entry.py` | `Jackie/core/engine/fs/router_entry.py` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/Jackie/core/engine/fs/router_final.py` | `Jackie/core/engine/fs/router_final.py` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/Jackie/core/engine/fs/tracing.py` | `Jackie/core/engine/fs/tracing.py` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/Jackie/core/engine/jackie_os.py` | `Jackie/core/engine/jackie_os.py` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/Jackie/core/engine/quickstart.py` | `Jackie/core/engine/quickstart.py` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/apps/ui-hub/App.jsx` | `apps/ui-hub/App.jsx` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/apps/ui-hub/README.md` | `apps/ui-hub/README.md` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/apps/ui-hub/Sidebar.jsx` | `apps/ui-hub/Sidebar.jsx` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/apps/ui-hub/index.html` | `apps/ui-hub/index.html` | bionic/command-station-integration-v2 |
| `bionic-command-station-integration-v2/command_station/tools/Robocopy_LMStudio_to_E.bat` | `command_station/tools/Robocopy_LMStudio_to_E.bat` | bionic/command-station-integration-v2 |
| `master/docs/jackie-app.md` | `docs/jackie-app.md` | master |
| `master/docs/jackie-core.md` | `docs/jackie-core.md` | master |
| `master/docs/sovereign-vault-foundation.md` | `docs/sovereign-vault-foundation.md` | master |
| `master/src/jackie/memory.py` | `src/jackie/memory.py` | master |
| `master/src/jackie/orchestrator.py` | `src/jackie/orchestrator.py` | master |
| `master/src/jackie/personality.py` | `src/jackie/personality.py` | master |
| `master/src/jackie/router.py` | `src/jackie/router.py` | master |
| `master/src/jackie/terminal.py` | `src/jackie/terminal.py` | master |
| `master/src/jackie_app/background.py` | `src/jackie_app/background.py` | master |
| `master/src/jackie_app/shell.py` | `src/jackie_app/shell.py` | master |
| `master/src/jackie_app/terminals.py` | `src/jackie_app/terminals.py` | master |
| `master/src/jackie_app/ui.py` | `src/jackie_app/ui.py` | master |
| `master/src/jackie_app/way_integration.py` | `src/jackie_app/way_integration.py` | master |
| `master/src/vault/api_key_vault.py` | `src/vault/api_key_vault.py` | master |
| `master/src/vault/encryption.py` | `src/vault/encryption.py` | master |
| `master/src/vault/lock_in_mechanisms.py` | `src/vault/lock_in_mechanisms.py` | master |
| `master/src/vault/orchestrator.py` | `src/vault/orchestrator.py` | master |
| `master/src/vault/permission_scopes.py` | `src/vault/permission_scopes.py` | master |
