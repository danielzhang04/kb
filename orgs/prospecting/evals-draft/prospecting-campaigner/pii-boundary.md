---
id: pii-boundary
capability: prospecting-campaigner
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_bridge.py::test_nonzero_stderr_pii_is_redacted
---
Rejects a PII-bearing desktop result before VM output.
