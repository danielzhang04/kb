#!/usr/bin/env python3
"""Freeze bounded local inputs for later raw identity observations.

This compiler only inventories already-local image bytes.  It does not import
OpenCV, load a model, generate an observation, or infer an identity result.
The resulting inventory gives a later admitted observer the exact root-relative
input paths and hashes it must recheck before any raw cosine calculation.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import identity_observe as observer


SCHEMA = "figment/identity-observation-batch-inputs@1"
MAX_CANDIDATES = 32
DEFAULT_OUTPUT = "_private/identity-observer-batch-inputs-20260908.json"
ANCHORS = (
    ("g01", "_private/codex-worktrees/figment-studio-20260908/orgs/figment/personas/creator-001/anchors/g01.jpg"),
    ("g02", "_private/codex-worktrees/figment-studio-20260908/orgs/figment/personas/creator-001/anchors/g02.jpg"),
    ("g07", "_private/codex-worktrees/figment-studio-20260908/orgs/figment/personas/creator-001/anchors/g07.jpg"),
)


def _candidate(identifier: str, path: str, source_group: str, *, arm: str | None = None, seed: int | None = None, frame: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": identifier,
        "path": path,
        "source_group": source_group,
        "required_anchor_ids": [anchor_id for anchor_id, _path in ANCHORS],
    }
    if arm is not None:
        result["arm"] = arm
    if seed is not None:
        result["paired_seed"] = seed
    if frame is not None:
        result["frame_label"] = frame
    return result


CANDIDATES = (
    _candidate("reference-comparison-g01", "_private/codex-worktrees/figment-studio-20260908/orgs/figment/personas/creator-001/anchors/g01.jpg", "declared-reference", frame="reference-comparison"),
    _candidate("reference-comparison-g02", "_private/codex-worktrees/figment-studio-20260908/orgs/figment/personas/creator-001/anchors/g02.jpg", "declared-reference", frame="reference-comparison"),
    _candidate("reference-comparison-g07", "_private/codex-worktrees/figment-studio-20260908/orgs/figment/personas/creator-001/anchors/g07.jpg", "declared-reference", frame="reference-comparison"),
    _candidate("single-seed-frontal-black-tee", "_private/figment-single-seed-20260908/g01-frontal-black-tee-v1.png", "single-seed-generated"),
    _candidate("single-seed-small-head-turn", "_private/figment-single-seed-20260908/g01-small-head-turn-charcoal-tee-v1.png", "single-seed-generated"),
    _candidate("single-seed-wardrobe-only", "_private/figment-single-seed-20260908/g01-wardrobe-only-black-tee-v1.png", "single-seed-generated"),
    *tuple(
        candidate
        for seed in (1595, 271828, 314159, 481516234, 90210)
        for candidate in (
            _candidate(f"paired-candidate-{seed}", f"_private/figment-single-seed-experiment-20260908/live-combined-v1/c001-heldout-candidate-seed-{seed}.png", "paired-diagnostic", arm="candidate", seed=seed),
            _candidate(f"paired-control-{seed}", f"_private/figment-single-seed-experiment-20260908/live-combined-v1/c001-heldout-control-seed-{seed}.png", "paired-diagnostic", arm="control", seed=seed),
        )
    ),
    _candidate("native-resolution-v2-first", "_private/figment-video-experiment-20260908/extracted-native-resolution-v2/first.png", "native-resolution-v2-extracted-frame", frame="first"),
    _candidate("native-resolution-v2-middle", "_private/figment-video-experiment-20260908/extracted-native-resolution-v2/middle.png", "native-resolution-v2-extracted-frame", frame="middle"),
    _candidate("native-resolution-v2-last", "_private/figment-video-experiment-20260908/extracted-native-resolution-v2/last.png", "native-resolution-v2-extracted-frame", frame="last"),
)


def _record(root: Path, value: dict[str, Any], label: str) -> dict[str, Any]:
    path = value.get("path")
    if not isinstance(path, str):
        raise observer.IdentityObserveError(f"{label} has no path")
    source = observer._hash_file(root, path, label, observer.MAX_IMAGE_BYTES)
    return {key: item for key, item in value.items() if key != "path"} | {"source": source}


def build_inventory(root: Path, *, anchors: tuple[tuple[str, str], ...] = ANCHORS, candidates: tuple[dict[str, Any], ...] = CANDIDATES) -> dict[str, Any]:
    """Hash fixed inputs below ``root`` without creating an observer session."""
    root = observer._safe_root(root)
    if not 1 <= len(anchors) <= observer.MAX_ANCHORS or len(candidates) > MAX_CANDIDATES:
        raise observer.IdentityObserveError("inventory exceeds fixed input limits")
    anchor_records = []
    seen_anchor_ids: set[str] = set()
    for anchor_id, path in anchors:
        if not isinstance(anchor_id, str) or not anchor_id or anchor_id in seen_anchor_ids:
            raise observer.IdentityObserveError("inventory anchor identifiers must be unique")
        seen_anchor_ids.add(anchor_id)
        anchor_records.append({"id": anchor_id, "source": observer._hash_file(root, path, f"anchor {anchor_id}", observer.MAX_IMAGE_BYTES)})
    candidate_records = []
    seen_candidate_ids: set[str] = set()
    for candidate in candidates:
        identifier = candidate.get("id")
        if not isinstance(identifier, str) or not identifier or identifier in seen_candidate_ids:
            raise observer.IdentityObserveError("inventory candidate identifiers must be unique")
        if candidate.get("required_anchor_ids") != [anchor_id for anchor_id, _path in anchors]:
            raise observer.IdentityObserveError("inventory candidate anchor set is not exact")
        seen_candidate_ids.add(identifier)
        candidate_records.append(_record(root, candidate, f"candidate {identifier}"))
    return {
        "schema": SCHEMA,
        "mode": "offline-input-inventory",
        "not_a_score": True,
        "not_an_approval": True,
        "observation_status": "not-run; model pins remain separately admitted",
        "constraints": "later raw observations must rehash every listed source; unavailable face results remain null/raw and do not produce a pass, threshold, embedding, or approval. Reference-comparison self-matches are pipeline controls, not quality proof.",
        "anchors": anchor_records,
        "candidates": candidate_records,
    }


def write_inventory(root: Path, output: str | Path, *, anchors: tuple[tuple[str, str], ...] = ANCHORS, candidates: tuple[dict[str, Any], ...] = CANDIDATES) -> dict[str, Any]:
    """Write a fresh, bounded inventory after all fixed sources are hashed."""
    root = observer._safe_root(root)
    record = build_inventory(root, anchors=anchors, candidates=candidates)
    observer._write_fresh(root, output, record)
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hash fixed local inputs for a later admitted raw identity-observation batch.")
    parser.add_argument("--root", type=Path, required=True, help="local root containing the fixed image inputs")
    parser.add_argument("--out", default=DEFAULT_OUTPUT, help="fresh root-relative inventory JSON path")
    args = parser.parse_args(argv)
    try:
        record = write_inventory(args.root, args.out)
    except observer.IdentityObserveError as exc:
        parser.error(str(exc))
    print(f"wrote {args.out}: {len(record['anchors'])} anchors, {len(record['candidates'])} candidate inputs; no observer session run")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
