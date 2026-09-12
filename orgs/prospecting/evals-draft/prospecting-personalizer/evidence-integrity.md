---
id: evidence-integrity
capability: prospecting-personalizer
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_evidence.py::test_disallowed_evidence_is_stored_but_hidden_from_copy_list
---
# Personalizer eval: Evidence integrity

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against synthetic fixtures in a local, no-network environment.

## Assertion

Every factual slot resolves to current copy-allowed evidence for the same person, and the immutable revision binds the selected campaign.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_evidence.py scripts/prospecting/tests/test_qa.py -q`

## Pass

All source, expiry, permission, confidence, person, and revision-campaign cases pass with zero skips, xfails, warnings, or network calls.
