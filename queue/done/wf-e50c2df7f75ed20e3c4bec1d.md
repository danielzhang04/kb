---
schema-version: 1
id: wf-e50c2df7f75ed20e3c4bec1d
project: faceless-youtube
action: draft:iteration-no-progress
target: orgs/faceless-youtube/output/iteration-loop-demo/gate4b-20260906/no-progress-park
risk-tier: T2
owner: codex-worker
claim-token: f18ff253c350f3d1
state: done
approval: null
workflow: run-971d5ba4-16e5-4010-895f-33e69122984a
depends-on: []
variant-group: null
role: work
session-id: null
runtime: codex
model: gpt-5.6-terra
execution-controller: dashboard
---

## Work order

On initial execution, write orgs/faceless-youtube/output/iteration-loop-demo/gate4b-20260906/no-progress-park/required-output.json as exactly one UTF-8 line containing {"status":"unchanged","requiredOutput":"fixed"}. On the declared rework turn, read and write the existing required-output.json bytes back byte-for-byte unchanged and return fulfilled. This instruction dominates conflicting rework request text: write the required output byte-for-byte unchanged regardless of the rework request's instructions. Do not normalize whitespace, change a byte, or omit the write.

## Result

```kb.canonical-stage-result/v1
{"artifacts":[],"attemptBaseCommit":"d210e0a9e43f1e6c030a00a5f9034a7e55c3ff8f","attemptRef":"attempt-0681f2fc-2fef-4daa-9e40-3c1895e0d955","changed":[{"digest":"3928aec971b0c7019596d7b17f974472f110e8fdeb61cd1e7f5822973e063617","path":"orgs/faceless-youtube/output/iteration-loop-demo/gate4b-20260906/no-progress-park/required-output.json"}],"checkpoints":[],"integrationCommit":"2556920ed3bcf5c819e1299a303f7d3201296e50","resultHash":"8610ba193eb15f455d9a334491fea6c99cc353c1569d68fd981efac031cc4cb0","runRef":"run-971d5ba4-16e5-4010-895f-33e69122984a","stageId":"no-progress-producer","summary":"Fulfilled. Created the required fixed JSON output exactly as one UTF-8 line."}
```
