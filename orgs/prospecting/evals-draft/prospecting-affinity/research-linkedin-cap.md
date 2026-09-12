---
id: research-linkedin-cap
capability: prospecting-affinity
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_affinity_linkedin.py::test_the_p8_driver_is_counted_by_the_shared_cap
---
# Affinity eval: Research LinkedIn cap

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against synthetic fixtures with an injected clock and local store.

## Assertion

The P8 backfill driver uses the shared rolling cap and refuses another load after it is reached.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_affinity_linkedin.py::test_the_p8_driver_is_counted_by_the_shared_cap -q`

## Pass

The outcome is `cap_reached` with its fixed typed reason and no profile load occurs.
