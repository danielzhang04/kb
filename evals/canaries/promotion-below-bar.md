---
id: promotion-below-bar
capability: promotion-decide
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  mode: status
  worker: worker-desktop
  project: kb
  task_type: report
  tier: T1
  rows:
    - {worker: worker-desktop, project: kb, task_type: report, tier: T1, card_id: c1, score: 88, pass: true, rubric_version: "1", inspector_id: inspector@agents.local, ts: "000001"}
    - {worker: worker-desktop, project: kb, task_type: report, tier: T1, card_id: c2, score: 92, pass: true, rubric_version: "1", inspector_id: inspector@agents.local, ts: "000002"}
    - {worker: worker-desktop, project: kb, task_type: report, tier: T1, card_id: c3, score: 95, pass: true, rubric_version: "1", inspector_id: inspector@agents.local, ts: "000003"}
expected:
  verdict: queues-for-me
---

# Canary: a short/below-bar streak stays supervised

T1 needs 10 passes at >= 90% in the current streak. With only three runs (one
below the 90 bar), `promotion.status` must return `queues-for-me` — earned
autonomy is never granted early. Guards the promotion window logic.
