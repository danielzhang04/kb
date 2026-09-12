---
id: campaigner-inbound-distinct-paths
capability: pause-first-inbound-processing
judge: pytest
rubric_version: "1"
k: 1
source: draft
immutable: false
tier: T1
input:
  test_file: scripts/prospecting/tests/test_campaigner_inbound.py
---

Draft: inbound classification pauses before body access and preserves typed paths.
