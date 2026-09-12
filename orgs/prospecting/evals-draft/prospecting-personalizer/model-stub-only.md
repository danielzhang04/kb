---
id: model-stub-only
capability: prospecting-personalizer
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_run_workflow.py::test_real_dry_run_uses_memory_without_schema_or_data_writes
---
Exercises the real dry-run path: the on-disk store's schema and data are
byte-identical before and after the run, and zero live model turns occur.
