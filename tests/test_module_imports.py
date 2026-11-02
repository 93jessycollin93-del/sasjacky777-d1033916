"""
Every module imports, and imports on the floor the project claims.

This suite exists because of a specific recurring failure: modules land here
having never been run. `Jackie/core/engine/` arrived with five NameErrors at
import time, and the same thing had happened again by the time this was
written — `jackie_os` annotated two methods with `Dict` and `Any` while
importing only `Optional`, which took the documented entrypoint
(`python -m Jackie.core.engine.quickstart`) down with it, and the constellation
guide instantiated its own singleton from six names it never imported.

A unit test for a module's behaviour cannot catch that, because it never gets
as far as importing it. So this walks the trees and imports everything, and
parses everything against the 3.9 grammar, which is the floor `pyproject.toml`
declares while the suite happens to run on something newer.
"""

import ast
import importlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

TREES = ("Jackie", "jackierouter", "command_station")

# These reach for the `gateway` extra (fastapi, uvicorn). Being unimportable
# without it is the point of an optional dependency, not a bug — but they are
# named here rather than pattern-matched, so a module that starts failing for
# some other reason cannot hide behind the exemption.
NEEDS_GATEWAY_EXTRA = {
    "Jackie.core.engine.fs.jackie_service_entry",
    "Jackie.core.engine.fs.state_viewer",
}


def _modules():
    found = []
    for tree in TREES:
        for path in sorted((ROOT / tree).rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            parts = list(path.relative_to(ROOT).with_suffix("").parts)
            if parts[-1] == "__init__":
                parts = parts[:-1]
            if parts:
                found.append((".".join(parts), path))
    return found


MODULES = _modules()


def test_finds_the_modules_to_check():
    # A glob that quietly matches nothing would make every test below vacuous.
    assert len(MODULES) > 50


@pytest.mark.parametrize("name", sorted({n for n, _ in MODULES} - NEEDS_GATEWAY_EXTRA))
def test_module_imports_without_raising(name):
    importlib.import_module(name)


@pytest.mark.parametrize("name", sorted(NEEDS_GATEWAY_EXTRA))
def test_optional_service_modules_fail_only_on_their_extra(name):
    # If one of these breaks, it must still break for the declared reason.
    try:
        importlib.import_module(name)
    except ImportError as exc:
        assert exc.name in {"fastapi", "uvicorn"}, f"{name} failed on {exc.name!r}, not the gateway extra"


@pytest.mark.parametrize("path", sorted({str(p) for _, p in MODULES}))
def test_parses_against_the_declared_python_floor(path):
    # pyproject declares >=3.9; the suite runs on whatever is installed, so the
    # floor is only actually checked if something checks it.
    source = Path(path).read_text(encoding="utf-8")
    ast.parse(source, filename=path, feature_version=(3, 9))
