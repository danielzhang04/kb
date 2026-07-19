---
id: grade-schema-missing-field
capability: grade-schema
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  mode: record_missing
  fields:
    worker: worker-desktop
    project: kb
    task_type: report
    tier: T1
    card_id: c-102
    score: 96
    pass: true
    rubric_version: "1"
expected:
  error_contains: missing required grade fields
---

# Canary: record_grade rejects a missing field

Omitting a REQUIRED field (here `inspector_id`) must raise `ValueError`
("missing required grade fields"). Guards the no-missing half of the pinned
schema contract.
