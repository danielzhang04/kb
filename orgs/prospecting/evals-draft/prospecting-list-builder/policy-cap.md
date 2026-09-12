---
id: policy-cap
capability: prospecting-list-builder
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_p5_contracts.py::test_entrypoints_are_exact
---
Uses only the pinned list-builder entrypoint and job contract.
