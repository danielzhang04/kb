---
id: grade-schema-untrusted-inspector
capability: grade-schema
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T2
input:
  mode: trust_filter
  graders_yaml: |
    graders:
      - id: inspector@agents.local
  rows:
    - worker: worker-desktop
      project: kb
      task_type: report
      tier: T1
      card_id: c-200
      score: 96
      pass: true
      rubric_version: "1"
      inspector_id: inspector@agents.local
    - worker: worker-desktop
      project: kb
      task_type: report
      tier: T1
      card_id: c-201
      score: 100
      pass: true
      rubric_version: "1"
      inspector_id: rogue@self.local
expected:
  trusted_count: 1
---

# Canary: a non-allowlisted inspector's grade is not trusted

`graders.yaml` allow-lists only `inspector@agents.local`. Two grade rows are
written; `promotion.trusted_grades` must count ONLY the allow-listed one (the
`rogue@self.local` self-grade is discarded). Guards the trust-anchor invariant
fail-closed behaviour.
