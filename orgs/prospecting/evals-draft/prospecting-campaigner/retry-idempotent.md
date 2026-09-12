---
id: retry-idempotent
capability: prospecting-campaigner
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_manager_runner.py::test_checkpoint_resume_and_completed_rerun_are_idempotent
---
Retries at most once and parks without an unbounded loop.
