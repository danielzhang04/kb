---
id: name-swap
capability: prospecting-personalizer
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_personalizer_cli.py::test_name_swap_fixture_fails_end_to_end_for_both_rows
---
# Personalizer eval: Plausible name swap

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against synthetic fixtures in a local, no-network environment.

## Assertion

Copy with no person-specific evidence-backed slot fails even when both synthetic recipients are plausible.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_personalizer_cli.py::test_name_swap_fixture_fails_end_to_end_for_both_rows -q`

## Pass

Both fixture rows traverse `_personalize_one()`, contain `name_swap`, and do not pass QA.
