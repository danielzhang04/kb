---
id: score-observation-reasons
capability: prospecting-affinity
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_affinity_evidence_bridge.py::test_every_recipient_slot_gets_its_own_row_and_survives_validate_revision
---
# Affinity eval: Score observation-backed reasons

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against synthetic observations, snapshots, and affinity rows in a local store.

## Assertion

Every copy-eligible reason maps to its own evidence row and remains valid through revision QA.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_affinity_evidence_bridge.py::test_every_recipient_slot_gets_its_own_row_and_survives_validate_revision -q`

## Pass

Recipient slots are evidence-backed, signals retain their evidence identifiers, and `uncited_rows` is zero.
