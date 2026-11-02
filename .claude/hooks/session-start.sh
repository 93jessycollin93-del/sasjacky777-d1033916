#!/bin/bash
# Make this repository's four test suites runnable the moment a web session opens.
#
# node_modules is not committed, and the Python suites need pytest, so without
# this a session starts unable to run any of the checks CLAUDE.md tells it to
# run before claiming a change works.
#
# Local sessions are left alone — they already have whatever the developer set
# up, and reinstalling over it is rude.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `install`, not `ci`: the container image is cached after this hook finishes,
# and install reuses what is already there instead of deleting it first.
# The prepare script also points core.hooksPath at .githooks here, which is what
# stops a generated MCP stub being committed.
echo "session-start: installing npm dependencies"
npm install --no-audit --no-fund

# `jackierouter/`, `Jackie/core/engine/` and `command_station/tools/` are covered
# by pytest, which is not otherwise present.
echo "session-start: installing pytest"
python3 -m pip install --quiet --disable-pip-version-check --root-user-action=ignore pytest

# The Python tree is imported from the repository root (`python -m
# Jackie.core.engine.quickstart`), so the root has to be on the path.
#
# Guarded: this script runs under `set -u`, and CLAUDE_ENV_FILE is only set by
# the harness. Referencing it bare meant that running the hook by hand — which
# is how you check it still works — aborted on an unbound variable, and a hook
# that cannot be tested is a hook nobody will keep working.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PYTHONPATH="${PYTHONPATH:+$PYTHONPATH:}."' >> "$CLAUDE_ENV_FILE"
fi

echo "session-start: ready — npx vitest run | python3 -m pytest | (cd context-condenser && npm test)"
