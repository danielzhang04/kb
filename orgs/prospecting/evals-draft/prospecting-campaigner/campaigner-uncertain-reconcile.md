---
id: campaigner-uncertain-reconcile
capability: idempotent-uncertain-reconciliation
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T1
input:
  test_file: scripts/prospecting/tests/test_campaigner_release.py::test_uncertain_result_reconciles_without_retry
---

Draft: uncertain Gmail results reconcile before another mutation.
