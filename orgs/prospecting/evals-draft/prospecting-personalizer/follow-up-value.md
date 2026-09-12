---
id: follow-up-value
capability: prospecting-personalizer
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_qa.py::test_follow_up_without_new_value_fails
---
# Personalizer eval: Follow-up value

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against synthetic fixtures in a local, no-network environment.

## Assertion

A follow-up that only checks in fails while an evidence-bearing positive control passes.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_qa.py::test_follow_up_without_new_value_fails scripts/prospecting/tests/test_qa.py::test_follow_up_with_new_evidence_passes -q`

## Pass

The empty follow-up fails with `follow_up_value` and the positive control passes.
