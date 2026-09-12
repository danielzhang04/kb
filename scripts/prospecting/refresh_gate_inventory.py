"""Dry-run-by-default CLI to repair declared gate_manifest*.json inventories.

This tool restores an accurate *declaration* of what already exists in the
reviewed source tree. It does not run the phase gate, does not assert a
passed/failed grade, does not assign an inspector score, does not touch
MANIFEST.sha256, and never writes to any gate-results directory. It reuses
the existing gate helpers in ``scripts.prospecting.gate`` for artifact
hashing and manifest/file validation, and â€” for P6 only â€” reuses the same
pytest collector/filter semantics as ``_live_p6_nodes`` (see
``scripts/prospecting/tests/test_deployment.py``) to discover the exact
current test node inventory inside the files the manifest already names.

Usage:
    py -3 -m scripts.prospecting.refresh_gate_inventory --phase P1
    py -3 -m scripts.prospecting.refresh_gate_inventory --phase P6 --write

Without ``--write`` this only prints a fixed-shape dry-run summary of what
would change. With ``--write`` it re-validates the proposed manifest and
the on-disk files before writing, and is an exact no-op if nothing changed.

Refusals are fail-closed and carry only a fixed code: collection is bounded by a
timeout, a declared test file that disappears or contributes zero collected nodes
is refused rather than silently emptied, and no node outside the files the
manifest already declares is ever added.
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE.parents[1]

# Insert the owning source root derived from __file__ (never cwd) so the
# "scripts.prospecting" import path resolves regardless of how this file
# was invoked (as a script or as a module).
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.prospecting import gate as gate_module  # noqa: E402

PHASE_FILES = {"P1": "gate_manifest.json", "P6": "gate_manifest_p6.json"}
EXCLUDED_NODE_PREFIX = "scripts/prospecting/tests/test_gate.py::"
EXCLUDED_MARKERS = ("datasette", "launcher")
COLLECT_TIMEOUT_SECONDS = 900
NEWLINE = "\n"
REQUIRED_MANIFEST_KEYS = frozenset({
    "phase", "artifacts", "artifact_hashes", "fixtures", "tests", "criteria",
})


class InventoryError(RuntimeError):
    """Refusal carrying only a fixed enumerated code (never free text)."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _minimal_timezone_file() -> bytes:
    """Collection-only zone data so collection works on minimal installs."""
    return (
        b"TZif" + bytes(16) + struct.pack(">6l", 0, 0, 0, 0, 1, 4)
        + struct.pack(">lbb", 0, 0, 0) + b"UTC" + bytes(1)
    )


def discover_live_nodes(root: Path, manifested_files: tuple[str, ...]) -> set[str]:
    """Collect exact current pytest node IDs restricted to already-manifested
    files, using the same collector/filter semantics as ``_live_p6_nodes``:
    collect-only, exclude the gate's own test module, and exclude the
    Datasette/launcher HTTP-process tests. No test is executed."""
    with tempfile.TemporaryDirectory() as temporary:
        scratch = Path(temporary)
        zoneinfo = scratch / "zoneinfo"
        eastern = zoneinfo / "America"
        eastern.mkdir(parents=True)
        (eastern / "New_York").write_bytes(_minimal_timezone_file())
        basetemp = scratch / "pytest-basetemp"
        try:
            collected = subprocess.run(
                [
                    sys.executable, "-m", "pytest", "--collect-only", "-q",
                    "scripts/prospecting/tests", "--basetemp", str(basetemp),
                    "-p", "no:cacheprovider",
                ],
                cwd=root, text=True, capture_output=True, check=False,
                timeout=COLLECT_TIMEOUT_SECONDS,
                env={**os.environ, "PYTHONTZPATH": str(zoneinfo),
                     "KB_PROSPECTING_NO_NETWORK": "1"},
            )
        except subprocess.TimeoutExpired as error:
            raise InventoryError("collection_timeout") from error
        except OSError as error:
            raise InventoryError("collection_failed") from error
    if collected.returncode != 0:
        raise InventoryError("collection_failed")
    all_nodes = {
        line for line in collected.stdout.splitlines()
        if line.startswith("scripts/prospecting/tests/") and "::" in line
        and not line.startswith(EXCLUDED_NODE_PREFIX)
        and not any(marker in line for marker in EXCLUDED_MARKERS)
    }
    manifested = set(manifested_files)
    return {node for node in all_nodes if node.split("::", 1)[0] in manifested}


def refresh(root: Path, phase: str) -> dict[str, object]:
    """Return the proposed declaration for one phase without writing anything.

    Only three fields may ever move: ``artifact_hashes`` for both phases and,
    for P6 only, ``tests`` plus ``criteria.minimum_enumerated_tests``. Every
    other criterion, the artifact list, the fixture list, and the P1 test
    inventory are carried through untouched.
    """
    filename = PHASE_FILES.get(phase)
    if filename is None:
        raise InventoryError("unknown_phase")
    path = root / "scripts" / "prospecting" / filename
    try:
        manifest = gate_module.load_manifest(path)
    except (OSError, json.JSONDecodeError) as error:
        raise InventoryError("manifest_unreadable") from error
    if (
        not isinstance(manifest, dict)
        or set(manifest) != REQUIRED_MANIFEST_KEYS
        or manifest.get("phase") != phase
        or not isinstance(manifest.get("artifacts"), list)
        or not isinstance(manifest.get("tests"), list)
        or not isinstance(manifest.get("criteria"), dict)
    ):
        raise InventoryError("manifest_shape")
    artifacts = tuple(str(item) for item in manifest["artifacts"])
    manifest_file = gate_module.manifest_artifact(root, path)
    hashes, missing = gate_module.compute_artifact_hashes(root, artifacts, manifest_file)
    if missing:
        raise InventoryError("missing_artifacts")

    new_manifest = dict(manifest)
    new_manifest["artifact_hashes"] = hashes
    hashes_changed = hashes != manifest.get("artifact_hashes")

    tests_changed = False
    minimum_changed = False
    if phase == "P6":
        declared = tuple(str(node) for node in manifest["tests"])
        if not declared or any("::" not in node for node in declared):
            raise InventoryError("manifest_shape")
        manifest_test_files = tuple(sorted({
            node.split("::", 1)[0] for node in declared
        }))
        if any(not (root / name).is_file() for name in manifest_test_files):
            raise InventoryError("missing_artifacts")
        live_nodes = discover_live_nodes(root, manifest_test_files)
        covered = {node.split("::", 1)[0] for node in live_nodes}
        if covered - set(manifest_test_files):
            raise InventoryError("inventory_expanded")
        if set(manifest_test_files) - covered:
            raise InventoryError("file_closure_failed")
        new_tests = sorted(live_nodes)
        tests_changed = new_tests != list(declared)
        new_manifest["tests"] = new_tests
        new_criteria = dict(manifest["criteria"])
        new_criteria["minimum_enumerated_tests"] = len(new_tests)
        minimum_changed = new_criteria != manifest["criteria"]
        new_manifest["criteria"] = new_criteria

    changed = hashes_changed or tests_changed or minimum_changed
    return {
        "path": path, "old": manifest, "new": new_manifest, "changed": changed,
        "hashes_changed": hashes_changed, "tests_changed": tests_changed,
        "minimum_changed": minimum_changed,
        "test_count_old": len(manifest.get("tests", ())),
        "test_count_new": len(new_manifest.get("tests", ())),
    }


def _summary(phase: str, change: str, code: str, counts: dict[str, int]) -> str:
    """One fixed-shape, PII-free JSON line whose code is from a closed set."""
    return json.dumps(
        {"phase": phase, "change": change, "code": code, "counts": dict(counts)},
        sort_keys=True, separators=(",", ":"),
    )


def _write_manifest(path: Path, manifest: dict[str, object]) -> None:
    """Write the proposed declaration as UTF-8 JSON ending in one real newline."""
    path.write_text(
        json.dumps(manifest, sort_keys=True, indent=2) + NEWLINE,
        encoding="utf-8", newline=NEWLINE,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True, choices=("P1", "P6"))
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)

    try:
        result = refresh(ROOT, args.phase)
    except InventoryError as error:
        print(_summary(args.phase, "error", error.code, {}))
        return 1
    except Exception:
        print(_summary(args.phase, "error", "unexpected_error", {}))
        return 1

    counts = {
        "artifacts": len(result["new"]["artifacts"]),
        "tests_old": result["test_count_old"],
        "tests_new": result["test_count_new"],
        "hashes_changed": int(result["hashes_changed"]),
        "tests_changed": int(result["tests_changed"]),
        "minimum_changed": int(result["minimum_changed"]),
    }

    if not args.write or not result["changed"]:
        change = "changed" if result["changed"] else "none"
        print(_summary(args.phase, change, "ok", counts))
        return 0

    try:
        errors = (
            *gate_module.validate_manifest(
                result["new"], args.phase, ROOT, result["path"]
            ),
            *gate_module.validate_files(ROOT, result["new"]),
        )
    except Exception:
        print(_summary(args.phase, "rejected", "validation_error", counts))
        return 1
    if errors:
        print(_summary(args.phase, "rejected", "validation_failed", counts))
        return 1

    try:
        _write_manifest(result["path"], result["new"])
    except OSError:
        print(_summary(args.phase, "error", "write_failed", counts))
        return 1
    print(_summary(args.phase, "changed", "ok", counts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
