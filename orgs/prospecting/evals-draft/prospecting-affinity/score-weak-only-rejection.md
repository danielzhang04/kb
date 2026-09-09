---
id: score-weak-only-rejection
capability: prospecting-affinity
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_affinity_score.py::test_weak_only_candidate_is_rejected_even_above_min_fit
---
# Affinity eval: Score weak-only rejection

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against a synthetic candidate whose weighted score is supported only by weak signals.

## Assertion

The strong-or-medium requirement rejects the candidate even when the raw score clears the threshold.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_affinity_score.py::test_weak_only_candidate_is_rejected_even_above_min_fit -q`

## Pass

The score is zero and the `weak_only_rows` measurement is zero.
