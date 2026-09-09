---
id: research-inert-snapshot
capability: prospecting-affinity
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_affinity_bio_adapter.py::test_person_and_company_paths_write_identically_shaped_snapshot_rows
---
# Affinity eval: Research inert snapshot injection

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against injected synthetic transports in a local, no-network environment.

## Assertion

Person and company snapshot requests produce the same typed, allowlisted snapshot shape.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_affinity_bio_adapter.py::test_person_and_company_paths_write_identically_shaped_snapshot_rows -q`

## Pass

Both requests succeed with `snapshot_profiled`, identical fields, and the expected allowlist version.
