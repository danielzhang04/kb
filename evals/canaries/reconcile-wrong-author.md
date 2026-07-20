---
id: reconcile-wrong-author
capability: reconcile-quarantine
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T2
input:
  author_email: worker@self.local
  shard: worker-2026-07-19.tsv
  grade_row:
    worker: worker-desktop
    project: kb
    task_type: report
    tier: T1
    card_id: c-400
    score: 100
    pass: true
    rubric_version: "1"
    inspector_id: inspector@agents.local
    ts: "2026-07-19T00:00:00+00:00"
expected:
  min_quarantined: 1
---

# Canary: a wrong-author grade row is quarantined + freezes

A grade row committed under a NON-Inspector git author (a worker self-grading)
must be detected by `reconcile.reconcile` (desktop tier): quarantined and the
promotion loop FROZEN. Built with a tiny hermetic git repo in tmp. Guards the
grades<->Inspector-activity author cross-check.
