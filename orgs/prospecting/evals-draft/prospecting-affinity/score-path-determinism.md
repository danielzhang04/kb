---
id: score-path-determinism
capability: prospecting-affinity
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_affinity_score.py::test_path_similarity_is_stable_under_a_reordered_run_of_identical_kinds
---
# Affinity eval: Score path determinism

Status: draft-unblessed
Owner: human reviewer

## Setup

Run deterministic path scoring against synthetic career-kind sequences.

## Assertion

Equivalent repeated-kind orderings yield the same path similarity score.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_affinity_score.py::test_path_similarity_is_stable_under_a_reordered_run_of_identical_kinds -q`

## Pass

The tested reorderings preserve their expected ratios.
