---
id: grade-schema-extra-field
capability: grade-schema
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  mode: record_extra
  fields:
    worker: worker-desktop
    project: kb
    task_type: report
    tier: T1
    card_id: c-101
    score: 96
    pass: true
    rubric_version: "1"
    inspector_id: inspector@agents.local
    bogus_extra: 1
expected:
  error_contains: unexpected grade fields
---

# Canary: record_grade rejects an extra field

The schema is EXACT. A row with an unknown field must raise `ValueError`
("unexpected grade fields"). Guards against schema drift that would poison the
promotion loop's downstream keying.
