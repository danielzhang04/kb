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
  test_file: scripts/prospecting/tests/test_run_workflow.py::test_dry_run_never_invokes_bridge
---
Uses the recorded model result and performs zero live model turns.
