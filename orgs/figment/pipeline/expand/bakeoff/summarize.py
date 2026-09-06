#!/usr/bin/env python3
"""summarize.py — per-arm median table for the identity-transfer bake-off ablation.

Takes the bake-off run's `run.json` (from `pod/runpod_run.py run ... --out <dir>`,
whose `jobs[].output_name` this bake-off names `c001-bo-<arm>-<cell>`, arm in
`{a, b, c}`) and a scorer's `gate.json` (`identity_gate.py`, built in parallel to this
task — expected per-image fields `identity_own`, `age_delta`, `gloss`, `niqe`, `pass`),
and prints one row per arm: how many of its 6 images scored, the median of each numeric
field across those images, and how many passed.

Schema tolerance: `identity_gate.py` was still being built when this was written, so
both inputs are read defensively rather than against one fixed shape --

- `run.json`: needs top-level `jobs`, a list of `{"output_name": ..., "files": [...]}`.
  `output_name` is parsed as `c001-bo-<arm>-<cell...>`; a job matching that pattern
  contributes exactly one row, keyed by `image_id` = `output_name` (the same
  `image_id` convention `runpod_run.py` and `score_cells.py` already use for a
  single-image job -- no name-mangling to reverse here).
- `gate.json`: either `{"rows": [...]}` (the `score_cells.py` "advisory.json" shape) or
  a bare `[...]` list. Each row identifies its image via `image_id`, or failing that
  `path`/`filename` (matched by stem against `image_id`). A row missing entirely for an
  `image_id` counts toward that arm's `n` but not its `pass` count or any median, and is
  reported by the `--strict` flag as a hard failure rather than a silent gap.

Medians ignore `None`/missing values field-by-field (a scorer outage on one image, per
`score_cells.py`'s own "advisory, never fatal" convention, degrades that one field on
that one row, not the whole arm).
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from pathlib import Path
from typing import Any

OUTPUT_NAME_PATTERN = re.compile(r"^c001-bo-(?P<arm>[abc])-(?P<cell>.+)$")
FIELDS = ("identity_own", "age_delta", "gloss", "niqe")
ARM_LABELS = {
    "a": "A (as built: no Lightning, skin LoRA @1.0, g01+g02+g07)",
    "b": "B (skin LoRA -> 0, isolates the LoRA)",
    "c": "C (g01 only, isolates multi-ref)",
}


def load_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _gate_rows(gate_doc: Any) -> list[dict]:
    if isinstance(gate_doc, dict) and isinstance(gate_doc.get("rows"), list):
        return gate_doc["rows"]
    if isinstance(gate_doc, list):
        return gate_doc
    raise ValueError("gate document must be a list of rows, or a dict with a 'rows' list")


def _row_image_id(row: dict) -> str | None:
    if row.get("image_id"):
        return str(row["image_id"])
    for key in ("path", "filename"):
        value = row.get(key)
        if value:
            return Path(str(value)).stem
    return None


def index_gate_rows(gate_doc: Any) -> dict[str, dict]:
    """image_id -> its gate row. A duplicate image_id keeps the first row seen and is
    not treated as an error here -- `--strict` is about missing rows, not dupes."""
    indexed: dict[str, dict] = {}
    for row in _gate_rows(gate_doc):
        image_id = _row_image_id(row)
        if image_id and image_id not in indexed:
            indexed[image_id] = row
    return indexed


def cells_by_arm(run_doc: dict) -> dict[str, list[str]]:
    """arm -> [image_id, ...] for every job whose output_name matches the bake-off's
    `c001-bo-<arm>-<cell>` naming. Jobs that do not match (there should be none in this
    manifest, but a hand-run subset or a future arm addition might produce one) are
    silently excluded from every arm's table rather than raising -- this is a reporting
    tool, not a manifest validator (the test suite covers manifest shape separately)."""
    jobs = run_doc.get("jobs")
    if not isinstance(jobs, list):
        raise ValueError("run.json has no 'jobs' list")
    by_arm: dict[str, list[str]] = {arm: [] for arm in ARM_LABELS}
    for job in jobs:
        output_name = job.get("output_name")
        if not isinstance(output_name, str):
            continue
        match = OUTPUT_NAME_PATTERN.match(output_name)
        if not match:
            continue
        by_arm[match.group("arm")].append(output_name)
    return by_arm


def summarize(run_doc: dict, gate_doc: Any) -> list[dict[str, Any]]:
    """Returns one row per arm (in `a, b, c` order), each:
    `{"arm", "label", "n", "scored", "pass_count", "<field>_median" for each FIELDS}`.
    `n` is how many bake-off images exist for that arm; `scored` is how many of those
    had a gate row at all (the two differ exactly when the scorer skipped or has not
    yet reached an image)."""
    by_arm = cells_by_arm(run_doc)
    gate_by_id = index_gate_rows(gate_doc)

    table = []
    for arm in ("a", "b", "c"):
        image_ids = by_arm.get(arm, [])
        rows = [gate_by_id[i] for i in image_ids if i in gate_by_id]
        entry: dict[str, Any] = {
            "arm": arm,
            "label": ARM_LABELS[arm],
            "n": len(image_ids),
            "scored": len(rows),
            "pass_count": sum(1 for row in rows if row.get("pass") is True),
        }
        for field in FIELDS:
            values = [row[field] for row in rows if isinstance(row.get(field), (int, float))]
            entry[f"{field}_median"] = statistics.median(values) if values else None
        table.append(entry)
    return table


def missing_image_ids(run_doc: dict, gate_doc: Any) -> list[str]:
    by_arm = cells_by_arm(run_doc)
    gate_by_id = index_gate_rows(gate_doc)
    missing = []
    for arm in ("a", "b", "c"):
        for image_id in by_arm.get(arm, []):
            if image_id not in gate_by_id:
                missing.append(image_id)
    return missing


def format_table(table: list[dict[str, Any]]) -> str:
    def fmt(value: Any) -> str:
        if value is None:
            return "--"
        if isinstance(value, float):
            return f"{value:.3f}"
        return str(value)

    header = ["arm", "n", "scored", "pass"] + [f"med_{f}" for f in FIELDS]
    rows = [header]
    for entry in table:
        rows.append([
            entry["arm"], str(entry["n"]), str(entry["scored"]),
            f"{entry['pass_count']}/{entry['scored']}",
            *[fmt(entry[f"{f}_median"]) for f in FIELDS],
        ])
    widths = [max(len(row[i]) for row in rows) for i in range(len(header))]
    lines = []
    for row in rows:
        lines.append("  ".join(cell.ljust(width) for cell, width in zip(row, widths)))
    labels = "\n".join(f"  {entry['arm']} = {entry['label']}" for entry in table)
    return "\n".join(lines) + "\n\n" + labels


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=Path, help="path to the bake-off run.json")
    parser.add_argument("--gate", required=True, type=Path, help="path to identity_gate.py's gate.json")
    parser.add_argument(
        "--strict", action="store_true",
        help="exit non-zero if any bake-off image has no gate row",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    run_doc = load_json(args.run)
    gate_doc = load_json(args.gate)
    table = summarize(run_doc, gate_doc)
    print(format_table(table))
    missing = missing_image_ids(run_doc, gate_doc)
    if missing:
        print(f"\n{len(missing)} image(s) with no gate row: {', '.join(sorted(missing))}", file=sys.stderr)
        if args.strict:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
