---
id: score-fit-spec-recompute
capability: prospecting-affinity
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_affinity_score.py::test_recompute_skips_unchanged_rows
---
# Affinity eval: Score fit-spec recompute

Status: draft-unblessed
Owner: human reviewer

## Setup

Run deterministic scoring twice against an approved synthetic fit specification.

## Assertion

An unchanged fit specification is an exact no-op; a changed approved hash is the recomputation boundary.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_affinity_score.py::test_recompute_skips_unchanged_rows -q`

## Pass

The second unchanged pass rewrites zero rows and preserves its computation timestamp.
