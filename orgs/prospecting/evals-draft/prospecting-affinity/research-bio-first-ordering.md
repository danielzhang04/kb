---
id: research-bio-first-ordering
capability: prospecting-affinity
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_affinity_linkedin.py::test_a_candidate_whose_bio_had_education_never_needs_linkedin
---
# Affinity eval: Research bio-first ordering

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against synthetic fixtures in a local, no-network environment.

## Assertion

Education found on an allowed bio page suppresses the LinkedIn gap-fill path.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_affinity_linkedin.py::test_a_candidate_whose_bio_had_education_never_needs_linkedin -q`

## Pass

The candidate has no LinkedIn load and the measured cap-overage remains zero.
