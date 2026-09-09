---
id: networking-copy
capability: prospecting-personalizer
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_qa.py::test_valid_revision_passes
---
# Personalizer eval: Networking copy contract

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against synthetic fixtures in a local, no-network environment.

## Assertion

Valid networking copy is 60–120 words and has one 10–20-minute informational ask.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_qa.py::test_valid_revision_passes scripts/prospecting/tests/test_qa.py::test_short_body_fails scripts/prospecting/tests/test_qa.py::test_long_body_fails scripts/prospecting/tests/test_qa.py::test_two_questions_fail -q`

## Pass

The positive case passes and each boundary violation fails with its stable code.
