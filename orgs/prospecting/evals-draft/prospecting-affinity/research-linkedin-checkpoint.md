---
id: research-linkedin-checkpoint
capability: prospecting-affinity
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_affinity_linkedin.py::test_a_checkpoint_page_stops_and_never_loads_again
---
# Affinity eval: Research checkpoint stop

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against a synthetic checkpoint response and local store.

## Assertion

A checkpoint creates the persistent stop state and prevents later loads.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_affinity_linkedin.py::test_a_checkpoint_page_stops_and_never_loads_again -q`

## Pass

Exactly one uncleared checkpoint-stop row is present and the lane reports `checkpoint`.
