#!/usr/bin/env python3
"""gates.py -- sha256_file, a small streaming-hash helper shared by `persona.py` and
`expand/build_expansion_set.py` (both load this module by path for exactly that one
function; see each module's own docstring).

This file used to also define `write_gate`/`gate_is_current`, a second, incompatible
gate.json schema (a SHA-bound human `verified`/`parked` decision record) that this
module's own former docstring called "the sole writer" of `gate.json`. Neither
function ever had a non-test caller -- the pipeline's real `gate.json` is the numeric
per-cell `figment/gate@1` document `identity_gate.py`'s `run_two_stage_gate` computes,
written by `identity_gate.write_gate_document` (E4: previously written from two
separate call sites -- `figment_train.py build_grade` and `identity_gate.py run_gate`
-- now routed through that one function so every gate.json on disk is byte-identical
regardless of caller). `write_gate`/`gate_is_current` were deleted rather than merged
into that schema: a SHA-bound human decision and a numeric per-cell score table are not
the same kind of record, and the dead pair had nothing left consuming it.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

_READ_CHUNK = 65536


def sha256_file(path: Path) -> str:
    """The sha256 hex digest of the file at `path`, streamed (never loads the whole
    file into memory at once -- anchors and boards can be large)."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_READ_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()
