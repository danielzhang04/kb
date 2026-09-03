#!/usr/bin/env python3
"""batch_state.py — the sole writer of a figment batch's cell lifecycle `state` and
batch-level `stage` (design §2.4, "Cell lifecycle — two orthogonal axes, one writer
each").

Two axes, two writers, never conflated:

  * Axis 1 — cell `state` (this module, `next_state` / `apply_batch`): a pure
    deterministic reducer `(current_state, score, ruling, selected, gate_current) ->
    next_state`. A function of files on disk, never of a conversation, so a resumed
    run recomputes the same answer.
  * Axis 2 — `review_status` (`qa_stamp.py`, NOT this module): `parked` never changes
    `state` — it records reasons and leaves the cell where it is, which is exactly
    what makes "not yet" honest. `next_state` reflects that: a ruling carrying
    `review_status: "parked"` from `"scored"` always returns `"scored"` unchanged.

`mark_batch_stage` is a SEPARATE, batch-level progress marker (`stage`), distinct
from any individual cell's `state` — a strictly forward-only walk through
`BATCH_STAGES`, one step at a time. It exists so a run can prove "we are past
harvesting, past scoring, and now waiting on the human eye gate" without conflating
that with any one cell's own lifecycle.

Automated scores are raw observations, never a threshold router (design finding 24,
CLAUDE.md-adjacent guardrail): `next_state` never promotes, culls or quarantines a
cell from a raw score alone except the one deterministic case GUARDRAILS 2/4 and the
design table both name explicitly — `face_detected == False`. Every other quarantine
route requires a human ruling's `safety_failed` flag.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

# ---------------------------------------------------------------------------
# Lifecycle vocabulary
# ---------------------------------------------------------------------------

# Cell-level lifecycle `state` (design §2.4 table). The last three (scheduled/
# posted/measured) exist so the enum is complete and `apply_batch` transform code can
# validate against it, but their forward transitions are owned by a future stage
# runner, never by this reducer — see TERMINAL_FOR_REDUCER below.
CELL_STATES = (
    "generated",
    "scored",
    "quarantined",
    "curated",
    "culled",
    "approved",
    "scheduled",
    "posted",
    "measured",
)

# "illegal: quarantined -> anything (terminal)"; "approved"/"scheduled"/"posted"/
# "measured" are the stage-runner's own forward-only chain, which this reducer does
# not own (design: "approved | scheduler claimed it | scheduled -> posted -> measured
# | stage runner"). Any attempted transition signal against one of these from this
# module is a bug, not a legitimate "not ready yet" query, and fails closed.
TERMINAL_FOR_REDUCER = frozenset(
    {"quarantined", "approved", "scheduled", "posted", "measured"}
)

# Batch-level `stage` — strictly forward-only, one step at a time (plan step 1.3).
BATCH_STAGES = ("building", "generated", "scored", "awaiting-eye-gate-a", "gate-a-ruled")


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _atomic_write_json(path: Path, data: Any) -> None:
    """Write `data` as JSON to `path` atomically (temp file, then os.replace) — the
    single-writer discipline this module exists to provide would be pointless if a
    crash mid-write could corrupt `batch.json`. Mirrors `qa_stamp.py`'s own helper."""
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Batch construction
# ---------------------------------------------------------------------------


def new_batch(*, batch_id: str, persona_id: str, allocation_sha256: str, cells: list) -> dict:
    """Build the initial `batch.json` document. `stage` always starts at "building";
    every cell defaults to lifecycle `state: "generated"` and review axis
    `review_status: "unreviewed"` unless the caller already set one explicitly."""
    if not isinstance(batch_id, str) or not batch_id.strip():
        raise ValueError("new_batch requires a non-empty batch_id")
    if not isinstance(persona_id, str) or not persona_id.strip():
        raise ValueError("new_batch requires a non-empty persona_id")
    if not isinstance(allocation_sha256, str) or not allocation_sha256.strip():
        raise ValueError("new_batch requires a non-empty allocation_sha256")

    seen_ids: set[str] = set()
    normalized_cells = []
    for cell in cells:
        if not isinstance(cell, dict):
            raise ValueError(f"cell must be a dict, got {type(cell).__name__}: {cell!r}")
        cell = dict(cell)
        cell_id = cell.get("cell_id")
        if not cell_id:
            raise ValueError(f"cell is missing cell_id: {cell!r}")
        if cell_id in seen_ids:
            raise ValueError(f"duplicate cell_id in new_batch: {cell_id!r}")
        seen_ids.add(cell_id)
        cell.setdefault("state", "generated")
        cell.setdefault("review_status", "unreviewed")
        cell.setdefault("parked_reasons", [])
        cell.setdefault("safety_failed", False)
        if cell["state"] not in CELL_STATES:
            raise ValueError(f"cell {cell_id!r} has an unknown state {cell['state']!r}")
        normalized_cells.append(cell)

    now = _utcnow_iso()
    return {
        "schema_version": "figment/batch@1",
        "batch_id": batch_id,
        "persona_id": persona_id,
        "allocation_sha256": allocation_sha256,
        "stage": "building",
        "pod_runs": [],
        "cells": normalized_cells,
        "cost_usd": 0.0,
        "created_at": now,
        "updated_at": now,
    }


# ---------------------------------------------------------------------------
# Axis 1 — the pure cell-state reducer
# ---------------------------------------------------------------------------


def next_state(
    current_state: str,
    *,
    score: dict | None = None,
    ruling: dict | None = None,
    selected: bool = False,
    gate_current: bool = False,
) -> str:
    """Pure deterministic reducer: `(current_state, score, ruling, selected,
    gate_current) -> next_state`. Never mutates anything — the caller (`apply_batch`
    transforms, or the `apply`/`mark-stage` CLIs) is responsible for writing the
    result back onto a cell record.

    `score` is a raw scorer-observation row (design finding 24: raw values only,
    never a threshold route) — the only field this reducer itself reads from it is
    the deterministic `face_detected` flag. `ruling` is the operator's seven-axis
    verdict already reduced by `qa_stamp.py` down to `{"review_status": "verified"|
    "parked", "safety_failed": bool, ...}` — `qa_stamp.py` is the sole authority
    that turns raw axis strings into those two fields; this reducer never inspects
    axis names directly, so a scoring-schema change in `qa_stamp.py` cannot silently
    desync the lifecycle machine.
    """
    if current_state not in CELL_STATES:
        raise ValueError(f"unknown cell lifecycle state {current_state!r}")

    if current_state in TERMINAL_FOR_REDUCER:
        if score is not None or ruling is not None or selected or gate_current:
            raise ValueError(
                f"{current_state!r} is terminal for this reducer — no further "
                f"transition is legal from here (quarantined is terminal; "
                f"approved/scheduled/posted/measured belong to the stage runner, "
                f"not batch_state.py)"
            )
        return current_state

    if current_state == "generated":
        # Trigger: "scorer emitted a row for the cell" (design table row 1) — the
        # mere presence of a score row advances the cell, regardless of its content.
        if score is not None:
            return "scored"
        return "generated"

    if current_state == "scored":
        if gate_current:
            raise ValueError(
                "illegal transition: 'scored' -> 'approved' with no matching gate "
                "record — a cell must pass through 'curated' first (design table: "
                "'scored -> approved without a matching gate record' is explicitly "
                "illegal)"
            )
        if ruling is not None:
            if not isinstance(ruling, dict):
                raise ValueError(f"ruling must be a dict, got {type(ruling).__name__}")
            if ruling.get("safety_failed"):
                return "quarantined"
            status = ruling.get("review_status")
            if status == "parked":
                # "parked never changes state" (design §2.4 axis 2) — record-only.
                return "scored"
            if status == "verified":
                return "curated" if selected else "culled"
            if status not in (None, "unreviewed"):
                raise ValueError(f"unknown review_status on ruling: {status!r}")
        if score is not None:
            if not isinstance(score, dict):
                raise ValueError(f"score must be a dict, got {type(score).__name__}")
            if score.get("face_detected") is False:
                return "quarantined"
        # A raw score alone (no ruling) never promotes, culls or quarantines beyond
        # the deterministic no-face route above — see test_raw_score_never_promotes_or_culls.
        return "scored"

    if current_state == "curated":
        if gate_current:
            return "approved"
        return "curated"

    if current_state == "culled":
        if selected:
            return "curated"
        return "culled"

    raise AssertionError(f"unhandled cell state {current_state!r}")  # pragma: no cover


def record_pod_run(batch: dict, row: dict) -> dict:
    """Append one pod-run row to `batch["pod_runs"]`. Append-only — an existing
    `shard_id` row is NEVER overwritten (design finding 9); a duplicate is a hard
    error, not a silent replace. Returns `batch` (mutated in place, for convenience)."""
    if not isinstance(row, dict):
        raise ValueError(f"pod-run row must be a dict, got {type(row).__name__}")
    shard_id = row.get("shard_id")
    if not shard_id:
        raise ValueError(f"pod-run row is missing shard_id: {row!r}")
    pod_runs = batch.setdefault("pod_runs", [])
    if any(existing.get("shard_id") == shard_id for existing in pod_runs):
        raise ValueError(
            f"pod-run row for shard_id {shard_id!r} already recorded — pod_runs is "
            f"append-only and is never overwritten"
        )
    pod_runs.append(dict(row))
    cost = float(row.get("cost_usd") or 0.0)
    batch["cost_usd"] = round(float(batch.get("cost_usd") or 0.0) + cost, 6)
    batch["updated_at"] = _utcnow_iso()
    return batch


def require_strata_coverage(cells: list, selected_ids, required_strata) -> None:
    """Raise `ValueError` unless every stratum in `required_strata` is represented by
    at least one selected cell. The curation invariant this enforces (design C1):
    "refuses `approved` while any stratum is empty"."""
    selected_ids = set(selected_ids)
    required_strata = set(required_strata)
    covered = {
        cell.get("stratum_id")
        for cell in cells
        if cell.get("cell_id") in selected_ids and cell.get("stratum_id") is not None
    }
    missing = required_strata - covered
    if missing:
        raise ValueError(
            f"selected cells do not cover every required stratum — missing "
            f"{len(missing)} of {len(required_strata)}: {sorted(missing)}"
        )


def apply_batch(path: Path, transform: Callable[[dict], dict | None]) -> dict:
    """Read `batch.json` at `path`, call `transform(batch)`, and write the result
    back atomically. If `transform` raises, nothing is written — the file on disk is
    left exactly as it was (the read happens into a fresh in-memory object; a crash
    or exception before the atomic write simply never reaches `os.replace`).

    `transform` may mutate `batch` in place and return `None` (in which case the
    mutated `batch` is what gets written), or return a fresh dict to write instead.
    """
    path = Path(path)
    batch = json.loads(path.read_text(encoding="utf-8"))
    result = transform(batch)
    updated = batch if result is None else result
    _atomic_write_json(path, updated)
    return updated


def mark_batch_stage(batch: dict, stage: str) -> dict:
    """Write the batch-level `stage` field through the strictly forward-only,
    one-step-at-a-time `BATCH_STAGES` enum. A skip, a repeat, or a move backward
    raises `ValueError` before any write."""
    if stage not in BATCH_STAGES:
        raise ValueError(f"unknown batch stage {stage!r} (allowed: {BATCH_STAGES})")
    current = batch.get("stage")
    if current not in BATCH_STAGES:
        raise ValueError(f"batch has an unrecognized current stage {current!r}")
    current_index = BATCH_STAGES.index(current)
    target_index = BATCH_STAGES.index(stage)
    if target_index != current_index + 1:
        raise ValueError(
            f"illegal batch stage transition {current!r} -> {stage!r}: stage is "
            f"strictly forward-only, exactly one step at a time "
            f"(BATCH_STAGES = {BATCH_STAGES})"
        )
    batch["stage"] = stage
    batch["updated_at"] = _utcnow_iso()
    return batch


# ---------------------------------------------------------------------------
# CLI — `apply` (Task 7 raw-score ingestion) and `mark-stage` (Task 7 stage marker)
# ---------------------------------------------------------------------------


def _load_score_rows(scores_path: Path) -> dict[str, dict]:
    data = json.loads(Path(scores_path).read_text(encoding="utf-8"))
    rows = data.get("images") if isinstance(data, dict) else data
    if not rows:
        raise SystemExit(f"no score rows found in {scores_path}")
    by_id: dict[str, dict] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise SystemExit(f"malformed score row: expected an object, got {row!r}")
        key = row.get("cell_id") or row.get("image_id") or row.get("id")
        if not key:
            raise SystemExit(f"score row is missing cell_id/image_id: {row!r}")
        by_id[key] = row
    return by_id


def _cli_apply(args: argparse.Namespace) -> int:
    by_id = _load_score_rows(args.scores)
    summary = {"scored": 0, "quarantined_no_face": 0, "threshold_routed": 0}

    def transform(batch: dict) -> dict:
        for cell in batch.get("cells", []):
            row = by_id.get(cell.get("cell_id"))
            if row is None:
                continue
            before = cell.get("state", "generated")
            if before in TERMINAL_FOR_REDUCER:
                continue  # already resolved by an earlier apply — idempotent re-run
            # The reducer advances one edge per call (design table: "generated ->
            # scored" and "scored -> quarantined" are separate rows); settle a single
            # score row's cascade to a fixed point in one `apply` pass, bounded by the
            # enum size so a reducer bug can never spin.
            after = before
            for _ in range(len(CELL_STATES)):
                stepped = next_state(after, score=row)
                if stepped == after:
                    break
                after = stepped
                if after in TERMINAL_FOR_REDUCER:
                    break  # e.g. quarantined — do not call the reducer again on it
            if after != before:
                cell["state"] = after
                if after == "scored":
                    summary["scored"] += 1
                elif after == "quarantined":
                    summary["quarantined_no_face"] += 1
                    cell["rejected_reason"] = "no-face"
        return batch

    apply_batch(Path(args.batch), transform)
    print(
        f"scored {summary['scored']}; quarantined no-face={summary['quarantined_no_face']}; "
        f"threshold-routed={summary['threshold_routed']}"
    )
    return 0


def _cli_mark_stage(args: argparse.Namespace) -> int:
    updated = apply_batch(Path(args.batch), lambda batch: mark_batch_stage(batch, args.stage))
    print(f"batch stage: {updated['stage']}")
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="batch_state.py",
        description="Sole writer of a figment batch's cell lifecycle state and batch stage.",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    apply_cmd = sub.add_parser(
        "apply", help="apply a raw scores.json to a batch.json, advancing generated->scored "
                      "and scored->quarantined (deterministic no-face only)"
    )
    apply_cmd.add_argument("--batch", required=True, type=Path)
    apply_cmd.add_argument("--scores", required=True, type=Path)
    apply_cmd.set_defaults(func=_cli_apply)

    mark_stage_cmd = sub.add_parser(
        "mark-stage", help="advance batch.json's batch-level stage exactly one BATCH_STAGES step"
    )
    mark_stage_cmd.add_argument("--batch", required=True, type=Path)
    mark_stage_cmd.add_argument("--stage", required=True, choices=BATCH_STAGES)
    mark_stage_cmd.set_defaults(func=_cli_mark_stage)

    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        return args.func(args)
    except (ValueError, OSError) as exc:
        print(f"batch_state error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
