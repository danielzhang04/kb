---
id: revision-binding
capability: prospecting-personalizer
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_revision.py::test_hash_changes_for_bound_field
---
# Personalizer eval: Immutable revision binding

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against synthetic fixtures in a local, no-network environment.

## Assertion

Any bound revision byte, recipient, campaign, evidence order, template, prompt, or model version changes the SHA-256; identical input inserts once across connections.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_revision.py -q`

## Pass

All hash-sensitivity, canonical-JSON, QA-gate, and idempotency tests pass.
