# Prospecting end-to-end implementation task list

Status: bounded implementation slices complete and synthetic T0 acceptance passed; visual and
real-data end-to-end acceptance remain pending. Boss: Codex; builders and reviewers:
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

- The main-based delivery branch is `codex/prospecting-session-20260909`: 352 source/development
  paths, excluding 12 operational paths (coordination state, gate-result records and dated reports).
  The merge-base delta applied cleanly and did not overlap newer main changes.
- Campaign creation, source-backed drafting, immutable edits/feedback and the standalone review UI
  are implemented. The joined synthetic T0 flow reaches one FakeGmail draft through the actual
  application owners, retries without duplication and stops follow-up after a reply. Lead selection
  and evidence are seeded fixtures; this is not live-mining or sending-graduation acceptance.
- The real local-copy trial processed two selected candidates, created zero drafts and returned
  `evidence_identity_source_mismatch` for both, without external calls or original-store mutation.
- Validation includes 282 focused legacy-fixture/runtime checks, 50 staging-guard checks, 24 current
  deployment checks, 21 adjacent bridge/workflow checks, and 5 actual bundled-JavaScript checks.
  The three repaired deployment checks and four forbidden-flag regressions also passed independently in the final worktree. Earlier
  review integration and the joined T0 test passed; no browser was available for visual acceptance.
- The broad inherited suite initially had eight failures. Three stale runtime/test contracts were
  repaired and retested. Remaining failures concern the human-owned P6 manifest inventory, missing
  operational STATE in this source-only checkout (including nested gate tests), and the optional
  Datasette launcher dependency. These are recorded limits, not passing checks.
- Exact validated fixtures replace inline synthetic data; staging-only metadata and SSH recognition
  leave runtime VM PII checks intact. Independent review found a duplicate-JSON-key bypass; the
  parser now rejects duplicate keys at every depth, with staged regressions and independent review.
- All 32 bounded VM jobs were collected and cleaned with exact absence verified. Native workers
  used local source/test access; VM jobs were source-only work. No desktop connector parity,
  production VM change, live send, provider spend or manifest reblessing is claimed.
- The VM workflow saved-request resolver and independent inspector remain unavailable and park
  explicitly. New campaigns remain T0; a sanctioned T0-to-T1 transition is not implemented.

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
  - Synthetic whole-flow run through the real application/UI, including two campaigns and restart.
  - Verify retry without duplicate sends/credits, reply/DNC/bounce stops, expired approval,
    changed revision, denied send windows and missed schedules without a catch-up burst.
  - Visual/keyboard review at desktop widths; useful links, useful empty/loading/error states,
    source provenance, clear blocked reason and next action; no implementation clutter in user flows.
  - Run representative live acceptance only with the chosen local ask and explicit provider/send scope.
  - Acceptance: measured evidence, zero unresolved blocking findings, and user review of the real flow.

- [ ] 6. Session delivery
  - Condense main changes into one main PR. No per-small-task PRs; coordination uses existing
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
- Current local worker receipts under root `_private/prospecting-context-review-20260908/`

## Context checkpoint

Bounded source implementation and synthetic T0 acceptance are complete. Consolidated delivery is
prepared on the main-based source branch, with final publication and session handoff bookkeeping
remaining. Real source verification, browser acceptance and the existing human evaluation refresh
remain open. The operational STATE/gate records are intentionally separate from the public source
PR and must be supplied through the trusted operational path. No deployment or sending promotion
is authorized by a source/test pass.
