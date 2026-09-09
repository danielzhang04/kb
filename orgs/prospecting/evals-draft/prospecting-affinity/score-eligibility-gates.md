---
id: score-eligibility-gates
capability: prospecting-affinity
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_affinity_score.py::test_required_signal_missing_zeroes_the_score
---
# Affinity eval: Score eligibility gates

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against synthetic scoring inputs in a local, no-network environment.

## Assertion

Missing required signals and matching disqualifiers both zero an otherwise eligible score with fixed reason codes.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_affinity_score.py::test_required_signal_missing_zeroes_the_score scripts/prospecting/tests/test_affinity_score.py::test_a_disqualifier_zeroes_a_would_be_ninety -q`

## Pass

Both eligibility boundaries yield zero scores and their corresponding deterministic signals.
