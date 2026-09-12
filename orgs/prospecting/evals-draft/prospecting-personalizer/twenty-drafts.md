---
id: twenty-drafts
capability: prospecting-personalizer
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T2
input:
  test_file: scripts/prospecting/tests/test_personalizer_cli.py::test_file_backed_run_creates_then_resumes_twenty_stable_results
---
Creates exactly 20 synthetic revisions for 20 eligible IDs.
