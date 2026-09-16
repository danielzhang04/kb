---
schema-version: 1
id: wf-e50c2df7f75ed20e3c4bec1d
project: faceless-youtube
action: draft:iteration-no-progress
target: orgs/faceless-youtube/output/iteration-loop-demo/gate4b-20260906/no-progress-park
risk-tier: T2
owner: codex-worker
claim-token: f18ff253c350f3d1
state: blocked
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
