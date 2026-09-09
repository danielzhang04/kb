---
id: research-typed-reasons
capability: prospecting-affinity
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_affinity_bio_adapter.py::test_a_blocked_bio_leaves_a_typed_state_the_adapter_could_not_write
---
# Affinity eval: Research typed reasons

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against a synthetic offsite redirect in a local, no-network environment.

## Assertion

The driver, rather than the adapter, records a fixed research state and reason for blocked bio retrieval.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_affinity_bio_adapter.py::test_a_blocked_bio_leaves_a_typed_state_the_adapter_could_not_write -q`

## Pass

The persisted state is `blocked` with reason `bio_page_blocked`.
