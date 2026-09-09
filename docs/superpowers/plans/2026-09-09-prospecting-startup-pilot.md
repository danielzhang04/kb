# Repeatable startup outreach pilot

Status: intake implementation accepted; pilot scope answers and later execution stages pending.
Source baseline: `53b29992` on `codex/prospecting-session-20260909`.
The canonical coordination handoff owns current publication and runtime status.

## Goal and acceptance

A natural-language outreach specification must produce a saved, reviewable campaign through
reusable skills and actual application stages. This pilot targets venture-backed Series A-C
startups with a qualifying funding announcement in the preceding three calendar years, and two
current operations, strategy, chief-of-staff or adjacent contacts per company. Conversation and
AI curiosity are the first-touch goals; possible employment is secondary.

Success requires a real non-sending campaign in the local review UI, cited company and role
evidence, explained contact rankings, personalized drafts, recorded humanizer and independent
review results, and a restart/rerun that preserves progress without duplicating work. A hand-built
list or manually polished set of emails is not pipeline acceptance.

## Intake decisions

- Proposed pilot size: eight companies and two people per company; awaiting user preference.
- Geography and sectors are pending. Suggested defaults are NYC-first and AI-native/B2B software.
- Confirm whether latest funding must still be A-C, or any A-C round in the window qualifies.
- Pin an as-of date per run; derive and retain the three-year window from that date.
- Confirm current sender background, allowed projects/claims, exclusions, and virtual/in-person ask.
- Existing prior drafts and resumes are source material, not automatically current approved claims.
- Draft locally for review. No send, paid enrichment, mailbox mutation or production deployment.

## Design decisions

Reuse the existing campaign, evidence, revision and review services. Put common behavior in shared
application commands, with skills guiding judgment and the runtime enforcing stage transitions.
Keep business criteria configurable: this startup campaign is an acceptance case, not a hardcoded
replacement for industry chats, alumni networking or other career outreach.

Persist intake version, skill/template versions, source hashes, stage input/output hashes, attempt
counts and review lineage. A changed brief or draft invalidates dependent reviews. Preserve human
edits as immutable revisions; any suggested rewrite is a separate result.

Humanizer is a required drafting stage. Retain its draft rewrite, remaining-style audit and final
rewrite privately. Follow it with structural validation and independent factual/semantic review.
Evidence IDs and hashes establish bindings; they do not prove semantic entailment or actual model
execution. Do not manufacture a passed reviewer/humanizer receipt.

Independent reviewers check company eligibility, current roles, contact rationale, supported sender
claims, specificity and the actual ask. Allow at most two repair attempts for one failed item, then
surface the unresolved issue. Do not relax criteria or invent a second contact to meet a quota.

## Task list

- [ ] 1. Save clarified intake and approved sender context through a reusable entrypoint.
- [ ] 2. Review infrastructure, stage wiring, data contracts, skills and failure/recovery paths.
- [ ] 3. Repair blockers in the existing pipeline; independently review each repair.
- [ ] 4. Qualify companies with funding stage/date/source and explicit inclusion/exclusion reasons.
- [ ] 5. Resolve and rank two current contacts per company with role and research evidence.
- [ ] 6. Run personalization, mandatory humanizer, factual recheck and independent critique.
- [ ] 7. Load the exact accepted revisions and evidence into the local dashboard for human feedback.
- [ ] 8. Exercise interrupted/resumed runs, changed inputs, stale evidence and repeated actions.
- [ ] 9. Record actual coverage, gaps, tests and cleanup; update the same draft PR when authorized.

### First implementation slice: durable intake

The first freeze covers P15 intake/run records in the existing SQLite store, a shared pipeline
service, and the existing review app's authenticated intake action and status projection. Funding
stages/windows, company counts and people per company are configurable; A-C/three years/two people
are pilot input values. Preserve the original specification and outreach goal as unverified user
input alongside the normalized fields. Existing campaign policy and sender-profile bindings remain
authoritative.

Unknown geography/sector produce `input_pending`; an explicit unrestricted scope is different.
Complete intake produces `awaiting_research_adapter`. This slice launches no researcher, produces
no qualified company/person, and records no model, humanizer or reviewer completion.

Acceptance: actual HTTP/UI path, exact request replay/conflict, immutable changed-input versions,
fresh-connection resume, calendar-year/leap-day boundaries, non-pilot parameter values, same-store
and campaign binding, private text excluded from safe output/errors, and no invented stage success.
Backend and frontend builders have separate file ownership; an independent reviewer checks the
frozen combined diff before it is accepted.

Accepted checkpoint: P15/service and the existing HTTP/UI save path passed independent review.
The corrected UI separates campaign creation from saving a selected campaign's brief, preserves
unsaved changes across switching, and retains a request ID after an ambiguous response. Corrupt
latest state is shown as unavailable rather than replaced by older or empty state.

Independent verification: 39 focused Python tests, nine JavaScript tests and four extra switching/
retry probes passed. Root's broader three-file run had 41 passes and one Windows socket-abort
failure; the exact affected authentication test then passed alone. Root's nine JavaScript tests
passed. These overlapping counts are not additive.

Actual already-open Chrome acceptance used one owned background DevTools MCP tab and a synthetic
store. It created one campaign, saved unknown scopes as pending, then saved complete input as
revision 2 without creating another campaign. Full reload restored the saved fields and honest
adapter-waiting state. Expanded narrow layout had matching 417px client/scroll widths. The loaded
script hash matched the reviewed source; screenshots remain unverified. The owned tab, MCP client,
Node REPL and synthetic server were stopped; user Chrome was preserved.

The bounded source-only VM runtime-design review completed and its output was hash-validated
locally. Exact owned directory and service/lease units were verified absent after cleanup.
Its recommendations are design evidence, not a working private model adapter. A separate desktop
synthetic-only runtime feasibility probe and reusable template-copy review follow this checkpoint.

## Review ownership and boundaries

The infrastructure reviewer owns recovery, isolation, claims about tool access and production gaps.
The flow reviewer owns real callable paths from intake through human review. The email-skill worker
locates existing guidance and defines reusable voice/template inputs. Builders do not grade their
own output; the orchestrator reconciles independent findings against actual behavior.

Native workers currently have local source/tool access. Future VM reviews receive only approved
source and synthetic fixtures through the existing bounded job lifecycle. Real contact records,
source text and drafts remain desktop-local; VM workers do not inherit desktop connectors.
Do not modify the separate main dashboard, global browser settings, VM production code, governance,
applied migrations or evaluation manifests. No standing service or automatic sending is implied.

## Initial gaps to verify

The shipped workflow parks at an unavailable inspector. The current personalizer skill has no
mandatory humanizer stage. Audit whether natural-language intake, research and contact verification
are actual execution stages or depend on manual preparation; do not count a document as wiring.

## Load list

- `CLAUDE.md`, `governance/agent-rules.md`, `orgs/prospecting/contract.md`
- Canonical local `handoffs/2026-09-09-prospecting-review-app.md` in the coordination worktree
- `docs/superpowers/plans/2026-09-08-prospecting-end-to-end.md` (earlier implementation plan)
- `skills/curated/prospecting-personalizer/SKILL.md` and `prompt-contract.md`
- `skills/curated/humanizer/SKILL.md`
- `scripts/prospecting/run_workflow.py`, `manager/`, `review_service.py`, `personalizer/`
