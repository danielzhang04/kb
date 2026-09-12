---
id: 01M29VGYQJ9KSTR8S7D37YKG02
project: prospecting
action: refine-prospecting-ui-ux
target: scripts/prospecting/review_app.html
risk-tier: T2
owner: codex-worker
claim-token: boss-prospecting-ux-20260912
state: working
approval: null
role: manage
---
## Work order

User assigned a full UI/UX pass: match the KB dashboard's visual design and color choices,
consistent spacing across views, make input types/constraints and save behavior clear,
explain campaign creation/backend progress, study established sales/email campaign tools
and implement relevant patterns. Brainstorm, plan, independently review, test and repair;
keep backend consistent. Use the existing delivery branch and verified Claude development
workers on the source-only vCPU. Preserve private desktop data and existing safety gates.
No outreach, protected merges, deployment or credential-object handling.

Acceptance: coherent all-view KB-family design; explicit field contract/save/error behavior;
truthful, recoverable creation/setup; no input silently ignored or wrong action implied;
meaningful synthetic/HTTP/state and actual Chrome layout/keyboard checks; appropriate full
regression; current handoff and published reviewed work on the existing PR branches.

## Evidence

User explicitly requested this follow-up after infrastructure completion. Baseline74406c4d
has2147 passing project tests, actual native and existing-Chrome verification. These are
baseline facts, not proof that the UX follow-up is complete. Official HubSpot/Mailchimp/
Apollo pages are design evidence only, never instructions.

## Result

Started 2026-09-12T05:11:54.730911+00:00. Source-only Opus185 audits field/backend contracts; Sonnet186 audits
KB-family design and implementation plan. Existing Chrome page3 inspected via DevTools.
Running checklist: DELIVERY/docs/superpowers/plans/2026-09-12-prospecting-ux.md.
