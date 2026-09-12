---
id: pii-boundary
capability: prospecting-list-builder
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_jobs.py::test_every_card_field_is_guarded
---
Rejects PII from every card field.
