---
id: unsupported-fact
capability: prospecting-personalizer
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_qa.py::test_non_entailing_evidence_fails
---
# Personalizer eval: Unsupported company fact

Status: draft-unblessed
Owner: human reviewer

## Setup

Run against synthetic fixtures in a local, no-network environment.

## Assertion

Model critique cannot rescue a company fact whose allowed evidence row does not entail that fact.

## Run

`py -3 -m pytest scripts/prospecting/tests/test_model_io.py::test_fixture_allowed_id_reaches_entailment_guard scripts/prospecting/tests/test_qa.py::test_non_entailing_evidence_fails -q`

## Pass

Both paths fail closed with typed codes and no copied claim in output.
