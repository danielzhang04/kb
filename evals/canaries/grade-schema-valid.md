---
id: grade-schema-valid
capability: grade-schema
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  mode: record_valid
  fields:
    worker: worker-desktop
    project: kb
    task_type: report
    tier: T1
    card_id: c-100
    score: 96
    pass: true
    rubric_version: "1"
    inspector_id: inspector@agents.local
expected:
  ok: true
---

# Canary: record_grade accepts the pinned schema

A grade with exactly the REQUIRED fields writes one row carrying REQUIRED + `ts`
and nothing else. Guards `grade.record_grade` — the single writer of
`ledgers/grades/**` that `promotion.py` and `reconcile.py` key off.
