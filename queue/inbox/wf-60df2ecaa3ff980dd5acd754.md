---
schema-version: 1
id: wf-60df2ecaa3ff980dd5acd754
project: kb-ops
action: report:acceptance-p0-revise
target: orgs/kb-ops/output
risk-tier: T1
owner: worker-desktop
claim-token: 7885698e1c6b3796
state: blocked
approval: null
workflow: run-a9bdd60f-d0be-4d29-a5cd-fa9a123bc3a3
depends-on:
- wf-8a4869e309ad6a6ba69a177f
variant-group: null
role: work
session-id: null
runtime: claude
model: claude-sonnet-5
execution-controller: dashboard
---

## Work order

Read the existing orgs/kb-ops/output/acceptance-run-status.md written by stage draft. REWRITE the same file (Write, not Edit — this profile has no Edit tool) to APPEND a '## Stage: revise' section below the existing content: today's UTC timestamp, a one-sentence confirmation that draft's section was read and is intact, and a note that this is stage 2 of 3. The draft section's original text must remain unchanged above the new section — this is what proves dependsOn lineage: revise genuinely builds on draft's real output. Do not touch any file outside orgs/kb-ops/output/.
