---
id: pii-boundary
capability: prospecting-personalizer
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_manager_runner.py::test_pii_result_is_rejected_and_parked
---
Prevents revision content or identity from crossing to VM results.
