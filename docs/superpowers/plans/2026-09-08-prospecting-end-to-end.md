# Prospecting end-to-end implementation task list

Status: bounded implementation slices, synthetic T0 acceptance and the synthetic status-only VM
control lifecycle proof passed. The local source-import and opaque-control backends and companion
UI are implemented. Visual and real-data end-to-end acceptance remain pending. Boss: Codex; builders and reviewers:
Codex workers, selected by assignment complexity. Delivery branch is
`codex/prospecting-session-20260909`, consolidated from accepted source checkpoint 5175f408. No merge, live-send, provider-spend or deployment authorization
is inferred from this implementation request. User expressly authorized remote development,
isolation/monitoring/cleanup setup, iterative implementation, adversarial reviews and tests.

## Goal and success condition

Daniel supplies an outreach specification and gets a clear, efficient flow to qualified and
reachable leads, evidence-based fit and personalized messages, an effective prospecting UI,
approved campaign scheduling, and visible outcomes. One representative campaign must traverse
the real integrated path; synthetic tests alone do not establish live readiness.

## Brainstorm and working direction

1. Repair and integrate the existing P1-P8 backend, then build the UI over stable application
   services. Preferred: preserves proven lead discovery, durable schema, approval and evidence logic.
2. Rebuild a parallel pipeline. Rejected provisionally: duplicates state, migration, budgets and
   sending controls without evidence that those existing components need replacement.
3. Deliver only the old P7-UI plan. Insufficient: that plan assumes P1-P6 contracts, predates P8,
   has mostly read-only operations, and cannot establish the requested complete workflow.

## Verified current state

- The main-based delivery branch is `codex/prospecting-session-20260909`, published as draft PR181.
  Operational coordination state, gate-result records and dated private reports remain outside the
  source delivery. The merge-base delta applied cleanly and did not overlap newer main changes.
- Campaign creation, source-backed drafting, immutable edits/feedback and the standalone review UI
  are implemented. The joined synthetic T0 flow reaches one FakeGmail draft through the actual
  application owners, retries without duplication and stops follow-up after a reply. Lead selection
  and evidence are seeded fixtures; this is not live-mining or sending-graduation acceptance.
- The real local-copy trial processed two selected candidates, created zero drafts and returned
  `evidence_identity_source_mismatch` for both, without external calls or original-store mutation.
- Validation includes the focused legacy-fixture/runtime, staging-guard, deployment,
  bridge/workflow, review integration, joined T0 and bundled-JavaScript checks recorded with the
  accepted slices. Resumed manager recovery and control-protocol checks also pass. The private
  synthetic control proof driver passes nine local tests, and its first isolated VM lifecycle used
  the shipped `run_once`, recovered a simulated lost acknowledgement, collected an identical result
  hash, and verified exact root/unit absence after cleanup. This was not a physical laptop-close test
  or a live campaign operation. No browser was available for visual acceptance.
- The broad inherited suite initially had eight failures. Stale runtime/test contracts were
  repaired and retested. Direct desktop Python 3.13 contains Datasette and now uses its actual
  interpreter path; an earlier nested launcher failure did not establish a missing dependency.
  The uppercase P6 gate still fails on six stale recorded test node IDs, artifact hash and committed
  allowlist drift, plus the missing independent score. It stops before tests or record writes and
  reports no runtime mismatch. These human-owned inventory/score items and source-only checkout
  tests that require operational STATE remain separate gates rather than passing checks.
- Exact validated fixtures replace inline synthetic data; staging-only metadata and SSH recognition
  leave runtime VM PII checks intact. Independent review found a duplicate-JSON-key bypass; the
  parser now rejects duplicate keys at every depth, with staged regressions and independent review.
- All completed bounded VM review/development jobs were collected and cleaned with exact absence verified. Native workers
  used local source/test access; VM jobs were source-only work. No desktop connector parity,
  production VM change, live send, provider spend or manifest reblessing is claimed.
- The `run_workflow` SSH saved-request resolver and independent inspector remain unavailable and
  park explicitly. P12 is a separate, desktop-pulled control protocol for `status` and `queue_due`:
  grants are short-lived, T0, campaign/policy/operation-bound and disabled until a local user
  activates them. Its synthetic status-only VM spool/reconnect/cleanup proof passed. New campaigns
  remain T0; a sanctioned T0-to-T1 transition is not implemented.
- P12 read-only status never infers VM acknowledgement from a local terminal receipt and reports it
  as unverified. An explicit process action can report confirmed acknowledgement for that response.
  Retrying the exact request uses its validated stored result and may reclaim only that matching
  expired claim to complete delivery; it never reruns the desktop operation. A later read-only
  refresh is unverified again because it does not contact the VM.
- The local review server defaults control to disabled. Its integration seam accepts only a trusted,
  preconstructed control adapter; browser requests cannot supply an SSH host, path or transport
  configuration. A future main-kb UI owner may construct and pass that adapter from reviewed local
  configuration without adding those fields to the browser boundary or a standing VM service.
- P13 accepts a selected campaign/person source only through a local audited import: the user
  supplies an HTTPS source URL and a local body of at most 2 MiB. Import creates an unconfirmed
  candidate; a separate explicit human action must attest the current-company source role before
  it can support drafting. It performs no fetch, accepts no uploaded path, and never auto-attests.
- P14 permits a separate explicit local action to fulfill a feedback request after an authentic
  successful edit of the current revision, preserving deterministic QA and lineage. Saving the edit
  alone does not fulfill feedback. It does not provide an automated feedback rewriter or invent a
  passing revision when the saved QA context is unavailable.

## Confirmed user direction (2026-09-08)

- Primary use: industry conversations and job outreach. Sales is outside this release.
- Review actual email drafts initially. Store feedback, corrections and revision lineage locally.
  Drafting autonomy and sending autonomy are separate, explicit graduation controls; neither
  self-promotes. Initial release sends nothing without applicable human approval.
- Agents run on the kb VM; records, PII and actual live operations stay on desktop.
- Standalone small, polished prospecting dashboard. Link from the kb project when platform is ready;
  do not modify the other terminal's dashboard implementation.
- General campaign grammar and examples grounded in Downloads Recruiting.xlsx and VC List.xlsx,
  including job hunting, geography, roles, industry and prior-career customization.
- Keep desktop awake for the session. On network loss preserve bounded job progress and reconnect
  to that job; do not relaunch blindly. Temporary source-only recovery state on VM is collected
  locally and cleaned afterward. Main data is never replicated to VM.
- Live validation uses a local non-sending campaign first; no new provider-spend scope provided.

## Work split and boundaries

- Boss owns context, briefs, assignment, acceptance criteria, collecting/validating patches,
  integration, test adjudication, and user decisions. Source of truth stays in our local branch.
- Remote Codex workers receive only an explicit, hashed source/fixture/skill allowlist and a
  narrow assignment. They do not inherit live desktop files, accounts, connectors, or authority.
- New workers are Codex: Luna for mechanical work, Terra for ordinary implementation, Sol for
  complex repairs/reviews, Astra for difficult security architecture. Earlier Claude results remain
  historical evidence. Record requested model and independently observable response model;
  never invent a response-model receipt when the runtime does not expose one.
- Existing prospecting contract prohibits PII in ANY VM sink. Live SQLite, browser, research,
  draft bodies, contacts, Gmail/vendor capability stay local. Use synthetic `.test` fixtures remotely.
- Local typed executor performs authorized live operations. No direct agent Gmail/vendor access.
- The P12 controller runs on the local desktop and pulls opaque work from a bounded VM spool. A
  sleeping or unavailable desktop cannot execute that work; the VM can retain it only for the
  owned lease. This is not a bidirectional service or tool/connector parity.
- No persistent installs/services, dashboard code changes, credential copying or modifications to
  existing VM code for worker provisioning. Isolated temporary resources only, with explicit leases.
- No claims of literal zero logging: owned workspace/session artifacts can be scoped and removed;
  system/provider/ambient-auth bookkeeping cannot be guaranteed absent.

## Terminal task list and acceptance

- [x] 1. Baseline and scope
  - Read handoff, contracts, original product intent, P7-UI/P8 plans and relevant code.
  - Reconcile historical gate evidence with current bytes and actual integrated entrypoints.
  - Clarify open choices, identify frozen applied migrations, and define one real acceptance case.
  - Acceptance: gap map with source evidence, agreed product boundaries, no live-data mutation.

- [x] 2. Remote worker lifecycle proof
  - Review a minimal direct-SSH runner design using existing VM tools; no dashboard dependence.
  - Per-job immutable input manifest, allowed output paths, model/turn/tool/time/resource bounds.
  - Isolate filesystem, tool access and process descendants; give only needed skill instructions.
  - Detached supervision, heartbeat/deadline/exit records,
    reconnect by stable run ID, no duplicate relaunch, bounded orphan cleanup.
  - Collect and hash outputs locally before cleanup acknowledgement. Detect stale local files
    before applying patches. Reject outside-scope paths, symlinks, archive traversal and oversize data.
  - Acceptance: independent adversarial review plus synthetic disconnect/reconnect, timeout,
    duplicate-collection, stale-base, scope-escape and cleanup checks. No VM production changes.

- [x] 3. Product and integration design
  - Revise the old P7-UI design for P8 and the user's actual campaign/review flow.
  - Define shared application commands/projections used by both CLI and UI; avoid duplicate logic.
  - Prototype campaign brief, candidate review/evidence, drafts, sending plan and activity views.
  - Resolve desktop/VM/offline boundaries and ownership with the parallel dashboard workstream.
  - Acceptance: source-grounded plan and adversarial review; user selects material UX/authority choices.

- [x] 4. Implement bounded vertical slices
  - First: campaign input/persistence and workflow wiring, multi-campaign isolation and resume.
  - Next: fit-first discovery, cleaning/dedupe, verified-email substitution, budget/shortfall visibility.
  - Next: evidence-backed personalization, editable/reviewable revisions and exact approval binding.
  - Next: configured cadence, scheduling, suppression/replies, idempotent execution and clear states.
  - Build corresponding UI alongside each proven application slice, with meaningful source links.
  - Every slice: builder -> independent reviewer -> repair -> focused tests -> boss integration.
  - Acceptance: behavior-specific regression tests; no weakened assertions or reblessed eval manifests.

- [ ] 5. End-to-end acceptance
  - The joined synthetic T0 owner path through campaign, draft, review, cadence and FakeGmail draft
    is complete. A whole-flow run through the actual browser UI, including two campaigns and restart,
    remains pending.
  - Verify retry without duplicate sends/credits, reply/DNC/bounce stops, expired approval,
    changed revision, denied send windows and missed schedules without a catch-up burst.
  - Visual/keyboard review at desktop widths; useful links, useful empty/loading/error states,
    source provenance, clear blocked reason and next action; no implementation clutter in user flows.
  - Run representative live acceptance only with the chosen local ask and explicit provider/send scope.
  - Acceptance: measured evidence, zero unresolved blocking findings, and user review of the real flow.

- [x] 6. Session delivery
  - Delivered in draft main PR https://github.com/danielzhang04/kb/pull/181; implementation
    commit b7365db5. Condense main changes into one main PR. No per-small-task PRs; coordination uses existing
    authorized access path, respecting enforced branch protection.
  - Update project current state, task card, memory and canonical handoff with exact resume steps.
  - Collect and validate remote outputs, clean only owned leases/processes/artifacts, verify absence.
  - Acceptance: local source/evidence preserved, no unfinished owned VM job silently abandoned,
    accurate final limits and one reviewable main change set.

## Review and test discipline

Use code-review/security-review skills and loop-design-check for recurring campaign automation.
Reviews name concrete triggers and outcomes; missing context remains an uncertainty. Builder and
reviewer are distinct sessions. Focused regressions precede broader checks. Existing applied SQL
migrations are immutable; necessary changes require a new migration. Do not forge grades or
rebless MANIFEST.sha256 files. External sending and human-only approvals remain human-controlled.

## Load list

- `CLAUDE.md`, `BOSS.md`, `governance/agent-rules.md`, `orgs/prospecting/contract.md`
- `handoffs/2026-09-07-prospecting-p8-live-tested.md` on ops (historical pickup)
- `orgs/prospecting/runbook-p8.md`, `orgs/prospecting/doctrine.md`, `orgs/prospecting/deployment.md`
- `docs/superpowers/specs/2026-09-04-prospecting-p7ui-amendment.md` on original boss checkout
- `scripts/prospecting/run_workflow.py`, `manager/`, `affinity/`, `campaigner/`

## Context checkpoint

The accepted initial source delivery and resumed implementation remain on the main-based delivery
branch for an update to draft PR181. The canonical local handoff, project state and assigned task
card own current coordination. All 40 source-only VM jobs and the separate synthetic control proof
have been collected and cleaned with exact owned-resource absence verified. The desktop keep-awake
lease remains active until the actual session ends. Browser acceptance, real desktop-local evidence
and drafts, independent-inspector integration, the human evaluation refresh and every live mining or
sending gate remain open. Operational STATE/gate records stay outside the public source PR and must
travel through the trusted operational path. No deployment or sending promotion is authorized by a
source/test pass.

## Resumed task list - 2026-09-09

Source delivery in PR181 is a checkpoint, not completion of the user's end-to-end goal.
Continue on the same delivery branch and PR; leave other dashboard/VM production code alone.

- [x] Reload handoff, project rules, assigned card, branch and actual parked entrypoints.
- [x] Repair runtime selection and nested Windows test harness; 11 focused checks passed.
- [x] Implement the local audited source-evidence import, attestation, direct correction service and
  companion UI without weakening provenance; browser acceptance remains pending.
- [ ] Implement and independently review the missing independent-inspection integration.
- [x] Implement and independently review the P12 desktop-pulled `status`/`queue_due` source
  protocol with disabled-by-default grants and atomic local receipts.
- [x] Run the reviewed synthetic status-only VM spool lifecycle proof, including lost-ack reconciliation,
  hash collection and exact cleanup.
- [x] Integrate the exact configured control status/process action into the prospecting companion;
  it remains disabled when no trusted server-side adapter is configured.
- [x] Complete bounded manual feedback fulfillment as a separate action after a successful current
  edit with authentic QA and lineage. Automated feedback rewriting remains outside this slice.
- [ ] Verify real local drafts and visual/keyboard behavior when browser access is available.
- [ ] Run affected integrated checks; preserve human-only eval and sending approval boundaries.
- [ ] Update the same PR, task state, handoff and owned-resource cleanup evidence.

Current execution split: native Codex workers inspect/edit local source; VM Codex workers receive
only validated source/skills for isolated reviews. Browser inventory is empty and Chrome is
unavailable; user has been asked to connect a browser while implementation continues.

Checkpoint: runtime interpreter selection, manager recovery/checkpoints, P12 control source, P13
audited local source import and P14 manual feedback fulfillment are implemented and have focused
verification. The manager still parks when no independent inspector is available and no eval is
blessed by that parked path. The synthetic status-only P12 VM proof passed and the source-upload and
control-panel UI source is integrated. Browser acceptance and real local evidence/drafts remain open. Completed VM jobs are collected and
cleaned with exact absence verified. This is ongoing work, not acceptance.
