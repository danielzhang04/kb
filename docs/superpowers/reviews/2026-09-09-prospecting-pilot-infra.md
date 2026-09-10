# Prospecting pilot infrastructure and design review

Date: 2026-09-09. Source baseline supplied by the controller: `53b29992`.
Reviewer: codex-worker, independent infrastructure audit. Requested model: Astra;
responding model: unobservable in this runtime. This document reports source inspection,
not a live pilot or a new test run.

## Scope and evidence

Preamble passed. Loaded CLAUDE.md, governance/agent-rules.md,
governance/security-rules.md, prospecting contract, code-review and security-review
skills, the canonical coordination handoff/STATE/memory, and the earlier end-to-end
plan's brainstorm and current goal. Reviewed manager execution/bindings/recovery,
run_workflow, desktop control/protocol/review, deployment/dev-vm documentation, and
relevant list-builder, personalizer, revision, review, source-review, and test seams.
No real people, stores, drafts, credentials, browser, VM, network, or Git operations
were used. No tests were run. The only authorized edit is this review document.
Historical test and VM-proof results in the handoff were not independently rerun.

## Infrastructure verdict: REQUEST CHANGES before repeatable pilot

The six findings below concern the shipped path, not a claim that all constituent
services are absent. Existing safety guards often park correctly; parking is not
completion of the requested pipeline.

### I1. HIGH: independent inspection is absent

Location: `scripts/prospecting/manager/desktop_stage.py:307-310`;
`workflows/outreach-run.md:2`.

The adapter always raises `inspector_unavailable`. Outreach inspection occurs
immediately after listing, so a real run cannot proceed to personalization. This
is deliberate fail-closed behavior. `tests/test_run_workflow.py:118` uses a fabricated
grading bridge; the actual local path test at line 396 expects inspection parking.

Minimal repair: a desktop-local independent runtime reviewer bound to immutable
producer outputs, with typed receipts and reviewer/rubric versions. Never substitute
producer QA or row counts for independent semantic judgment.

Targeted test: actual CLI and adapter on synthetic source-backed candidates, proving
pass, fail, unavailable, stale-revision rejection, and PII-free manager output.

### I2. HIGH: generation and mandatory humanizer are outside the workflow

Location: `workflows/outreach-run.md:2`;
`scripts/prospecting/personalizer/cli.py:445-460`;
`scripts/prospecting/manager/compile_ask.py:94-100`.

The workflow calls personalize directly; it has no prepare/model/humanizer stage.
Personalization consumes an already prepared response bundle. The compiler accepts
token syntax and rejects ordinary free text. A fresh user brief therefore needs
manual work outside the pipeline, and optimized intake/humanizer skills are not
loaded or recorded by this execution path.

Minimal repair: explicit reusable intake and desktop-local prepare/generate/humanizer
stages, with immutable inputs and versioned skill artifacts. Raw content stays off VM.

Targeted test: start with a synthetic brief, sender profile and source records, with
no response bundle. Produce reviewable drafts through actual stages. Missing required
skills/runtime capabilities must produce precise unavailable outcomes.

### I3. HIGH: list CLI supplies no-op role and snapshot checks

Location: `scripts/prospecting/list_builder.py:621-627`, `:77-80`;
`scripts/prospecting/manager/desktop_stage.py:246-247`.

The real CLI supplies `role_check=lambda *_: None` and `snapshot=lambda *_: None`.
The configured check accepts these because they are non-None. Records requiring
current-employment validation and source capture traverse the named stages without
either operation. Downstream provenance guards can reject missing proof, but this
path cannot establish two current contacts per company.

Minimal repair: bind actual deterministic source/role owners or report unavailable;
reuse valid already-attested provenance without implying a fresh check occurred.

Targeted test: changed-role, missing-snapshot and valid-current-role candidates through
the actual list CLI, checking explicit outcomes and persisted evidence.

### I4. HIGH: parked work has no supported recovery transition

Location: `scripts/prospecting/manager/runner.py:676-680`;
`scripts/prospecting/run_workflow.py:534-540`.

A parked checkpoint is returned unchanged. Run identity derives solely from campaign
ID. After an inspector outage or ambiguous desktop effect is resolved, campaign resume
still returns parked. Another workflow for the same campaign/outbox conflicts with
the prior workflow binding. There is no supported resolve/reopen path in this seam.

Minimal repair: receipt-backed resolve/reopen with preserved history and uncertain-effect
reconciliation. Separate campaign, workflow and execution generation. Do not delete
checkpoints or blindly replay effects.

Targeted test: commit a child effect, lose its response, reconcile in a fresh process,
and resume without duplication. Also restore an absent inspector and execute sequential
list/personalize workflows for one campaign.

### I5. MEDIUM: manager provenance loses actual output identity

Location: `scripts/prospecting/manager/desktop_stage.py:313-320`, `:446-447`;
`scripts/prospecting/run_workflow.py:479-480`, `:538-539`.

The desktop envelope always emits empty IDs/hashes. Commands bind response/output
path strings, and initial run inputs have only campaign identity, with no content
hashes. Cached stage results do not check changed response contents or drafting
artifacts. Existing immutable revision hashes remain local and are not carried into
the manager/inspector proof chain. Replacing a response at the same path or changing
a skill/template does not create a demonstrably distinct execution input.

Minimal repair: desktop-owned immutable input/output manifests with opaque IDs/digests
projected to manager. Bind skill, template, prompt and reviewer versions, while keeping
requested model distinct from independently observed responding model.

Targeted test: mutate each bound input independently; require new generation or a
binding conflict. A review receipt for revision A cannot satisfy revision B.

### I6. MEDIUM: inspection rework is unreachable through the CLI

Location: `scripts/prospecting/run_workflow.py:527-531`;
`scripts/prospecting/manager/runner.py:759`.

The CLI converts grades only to pass or park; runner rework requires retry. Thus even
a future grading adapter cannot enter the existing bounded repair path through this
CLI. Unit tests injecting retry decisions do not establish this integration.

Minimal repair: typed reviewer decisions and desktop-local feedback references bound
to replacement outputs. Reinspection must target the replacement, not the old result.

Targeted test: actual CLI retry -> repair -> pass and retry -> fail, with the declared
repair maximum and no original-revision receipt reuse.

## What the existing control and VM evidence establishes

`control_protocol.py:29` permits only status and queue_due. DesktopControl joins local
effects and receipts in one SQLite transaction. ControlReviewAdapter selects one
configured request and reconciles stored results. No additional material control
flaw was found in this bounded source audit. Existing synthetic lost-ack evidence
supports those narrow operations, not live prospecting or connector parity.

`run_workflow.py:381-382` refuses SSH. Source-only dev-vm jobs are development workers;
they do not supply desktop connector access. Remote parity remains unimplemented and
is not needed for this phase's non-sending local pilot. Operational gate records must
travel through the trusted operational path; injected prerequisites are not deployed
gate proof. Historical P6 manifest/score refresh remains a separate human gate.

## Independent design review

Reviewed proposal: `docs/superpowers/specs/2026-09-09-prospecting-skill-pipeline.md`,
pilot plan `docs/superpowers/plans/2026-09-09-prospecting-startup-pilot.md`, and the
controller's proposed start/prepare_next/submit_stage lifecycle. These names are
proposed interfaces, not currently callable product capabilities.

Direction: reuse campaign/P8/P11 owners and add bounded stage orchestration. This is
preferable to another prospect store. The design is suitable for bounded builds once
the following five conditions are made explicit. They are design requirements, not
claims of already exploitable new code.

### D1. HIGH: job/lease identity alone does not prove an independent model invocation

A caller able to claim a critic job and submit arbitrary JSON can manufacture a pass
even if the lease is real. Likewise producer != reviewer as caller-supplied strings
does not establish independence. Authentic execution and semantic truth are separate:
an authentic model can still judge incorrectly.

Required invariant: a trusted controller allocates role and immutable input manifest,
launches or binds the designated runtime invocation, and accepts completion through
that invocation's controller-owned channel. The caller cannot choose reviewer identity,
change its role, or create execution attestations. Record controller-observed runtime
completion separately from the model's critique. Producer/humanizer roles cannot submit
critic receipts. Reviewer context contains the work order and exact named artifacts,
not the producer's reasoning; use a distinct invocation. Do not claim protection from
an arbitrary hostile process with the same OS/DB privileges unless such isolation is
actually implemented. If the supported runtime cannot establish this binding, report
critic_unavailable rather than accepting pasted passed=true.

Existing seam: desktop bridge/controller command binding and trusted server-side adapter
construction illustrate ownership patterns; neither by itself proves a model turn.

Acceptance probe: forged role, forged pass, wrong invocation, stale lease and producer
submission are rejected; genuine controller-observed reviewer output is accepted only
for its exact subject. Requested/responding model labels remain honest.

### D2. HIGH: desktop-local agent execution needs an explicit permitted-sink contract

Running on the desktop does not automatically confine source excerpts or draft bodies
to the approved SQLite/browser/snapshot locations. Tool results, model transcripts,
runtime history, crash dumps and telemetry may create additional sinks. Source-only
VM worker machinery cannot simply be repurposed for real contact content.

Required invariant: the selected existing runtime must have a verified path for receiving
the permitted local artifacts and retaining raw artifacts only in approved sinks, with
no VM replication and no PII in argv/stdout/logs. The controller exposes only exact scoped
inputs, not arbitrary file/credential reads. Runtime capability inventory must separate
synthetic adapters, live desktop research tools, humanizer and independent critic.
An unavailable compliant runtime parks the dependent stage. Do not invent a paid API
or infer a permission expansion to fill the gap.

Acceptance probe: use synthetic canary text to trace actual runtime/tool/session outputs
and owned persistence, plus exception and cancellation paths, before any real-record run.

### D3. HIGH: leases need fencing and atomic artifact publication

A lease can expire while its worker continues. A reclaimed job followed by a late old
submission can duplicate revisions or overwrite newer human work unless ownership and
current input are checked at commit. Holding a SQLite transaction across a model call
would instead lock out the review UI and recovery.

Required invariant: claim with a monotonic epoch under a short transaction; execute
outside the transaction; submit by comparing epoch, controller runtime identity,
expected state, intake/input hashes and current parent. In one transaction persist
artifact references, receipt and stage outcome. Exact submission replay returns the
same result; a changed payload for the same request conflicts. Cancellation/reclaim
invalidates old epochs. Flush private snapshot files before referencing them, with
owned orphan cleanup after interrupted publication.

Existing seams: ReviewService._begin/_replay/_current and DesktopControl.execute provide
local transaction/idempotency patterns. Preserve their current-row checks and integrate
the ready gate in the same transaction as set_editorial_ready, not in a prior UI check.

Acceptance probe: old and replacement worker race, interruption before/after local commit,
duplicate submit, changed submit, and a concurrent human edit. Never duplicate a revision
or mark a superseded parent ready.

### D4. HIGH: source-gate binding must include permission and freshness state

A body hash does not establish that its source remains current, copy-allowed, correctly
attested, or applicable to the selected person/company. An unchanged excerpt can become
ineligible because its authorization is withdrawn or its freshness window expires.

Required invariant: bind evidence/snapshot IDs and content hashes, claim scope, company
and person identity, attestation/permission version, observed/retrieved timestamps,
expiry, pinned intake/as-of/funding-window interpretation, and exact draft hash. Recheck
current eligibility when scheduling work and when making the exact revision ready.
Changed intake/source authorization invalidates downstream use without destroying old
receipts. Historical successful receipts remain historical facts, not current passes.
Retain human current-role attestation where the existing source owner requires it;
model research or two-token overlap cannot silently replace that authority.

Existing seams: affinity/source_review.verify_snapshot; ReviewService's source readiness
and verify_current_role_source; StoredReviewQa for bounded structural checks. None is
a substitute for factual entailment by the actual independent semantic reviewer.

Acceptance probe: revoke copy permission, expire evidence, change role, alter funding
interpretation, and mutate source content between critique and ready. Each blocks current
readiness without losing prior history.

### D5. HIGH: preserve authentic human-edit provenance and bound repair lineage

Humanizer must not call ReviewService.edit_draft as an agent. That API represents an
authentic human edit, and FeedbackService._children uses edit request provenance when
deciding whether feedback was fulfilled. Also, inserting a newer revision can affect
the existing latest-revision projection even if the old body remains stored.

Required invariant: a separate agent:humanizer suggestion operation in the existing
revision owners records parent, skill/input/final hashes and draft/audit/final artifacts.
Keep a human-authored current parent until explicit UI acceptance of its derived
suggestion, with an expected-current-parent compare. Never counterfeit a human edit
request or fulfill feedback merely because an agent generated a child. A manual edit
invalidates downstream receipts. After acceptance, readiness requires receipts for
that exact accepted body; identical validated content can use an exact-hash audit path
without endlessly creating new revisions.

Count at most two semantic repair rounds across the item's lineage, not per child ID
or process restart. Infrastructure retries are separately bounded. A critic can propose
changes, but a rewritten child requires a new independent critique; the same invocation
must not both rewrite it and certify its own rewrite. Humanizer's stylistic audit is
not that independent semantic review.

Acceptance probe: concurrent manual edit and suggestion, explicit accept/reject, agent
attempt to use human-edit provenance, feedback fulfillment attempt, repair-counter reset,
and a critic-authored child submitted with its parent's pass receipt.

## Recommended bounded builds

1. **Durable orchestration and capability boundary.** Add generic intake/stage manifests,
   controller-owned role/runtime binding, claim epoch and submit idempotency, explicit
   unavailable states, and recover/reopen. Wire start/prepare_next/submit_stage through
   existing campaign owners. Synthetic receipts must be visibly synthetic and incapable
   of satisfying real readiness. Do not claim the legacy outreach CLI now supplies this
   path. Validate fencing, forged receipts and privacy sinks independently.

2. **Exact-revision pipeline and review gate.** Reuse P8/P11 source/revision owners; add
   agent suggestion provenance, humanizer artifacts, post-humanizer structural checks,
   source-manifest invalidation, exact-current ready gating, and explicit acceptance for
   human-parent suggestions. Preserve human edit/feedback APIs. Implement bounded repair
   and prove all mutation/race cases with synthetic adapters before real model use.

3. **Actual desktop runtime integration and non-sending pilot.** Bind supported research,
   generation, humanizer and separate critic invocations to the controller; verify sink
   behavior and actual execution evidence. Run the configured small startup campaign,
   inspect real evidence/drafts in the local UI, then repeat from a fresh process and
   changed intake. This build is not complete if it needs hand-authored response bundles,
   pasted passes, manual polishing outside the skill pipeline, or fabricated second
   contacts. Leave sending, paid providers, VM parity and deployment outside this build.

No new tests or live acceptance were performed for this design review. The conditions
above are acceptance criteria for subsequent implementation and independent review.

## Follow-up: documentation drift and first intake slice

The archived operational account in `orgs/prospecting/dev-vm.md:125-131` ends with the
first authenticated startup failure and says authenticated Codex still needs a successful
controlled rerun. The canonical coordination handoff,
`handoffs/2026-09-09-prospecting-review-app.md` in the separate coordination worktree,
records at lines 22-23 that all 40 source-only VM jobs and the separate synthetic
control proof were collected, validated, cleaned, and checked for exact owned-resource
absence. Its remaining-gates section also describes remote reviews as a bounded
source-only environment. The source document's closing acceptance status is stale
relative to that later operational account and should not be repeated as the current
overall development-worker status.

Evidence limit: this check compared documents only. Collection and cleanup of 40 jobs
does not prove that every job was a successful authenticated model invocation, and no
individual receipt/provider event was reopened here. A future dev-vm documentation
refresh should replace the stale pending conclusion with the exact later successful
receipt evidence from the controller, while retaining the early failure as history.
Neither document establishes live campaign execution, desktop connector parity, a
physically closed-laptop test, or permission to put real PII in VM workers. dev-vm.md
was not edited and no VM operation was performed.

The controller has now narrowed the first implementation to durable generic intake
and an explicit waiting-for-adapter state. Backend ownership is P15/store/pipeline
service/tests; UI ownership is review app/service/HTML/HTTP integration. This is smaller
than recommended build 1 above and should be reviewed as that smaller delivery, not as
completed orchestration or end-to-end prospecting.

Plan clarity at inspection time: the startup-pilot plan states the full desired outcome
and configurable campaign direction, but does not yet name this first-slice freeze,
its waiting state, or its acceptance boundary. The controller should record those
details in the owning plan/card before labeling the slice complete. A saved intake
must never be presented as researched, humanized, independently reviewed, or ready.
The observed source plan's proposed company count/geography/sector are still pending
preferences, not permission to silently fill and confirm them.

Focused review/test rationale for the frozen intake slice:

- Validate configurable funding stages, date/window interpretation, role families and
  people-per-company. Exercise non-pilot values (for example one and four people, a
  different window and role family) to catch hardcoded two-contact/three-year behavior.
  Preserve uncertain versus confirmed fields; avoid an implied user attestation.
- Persist canonical intake versions and request hashes through the existing campaign
  owner. Same request/same payload replays; same request/changed payload conflicts;
  explicit changed intake creates a new immutable version. Fresh connection/process
  reload must return the saved selection and waiting state without duplicate campaign
  or stage rows. Reopening existing older stores must remain compatible.
- Derive unavailable capability/state server-side. Browser payloads must not mint stage
  receipts, reviewer identities, passed flags, SSH/runtime configuration or ready state.
  Do not add pretend claim/submit success merely to make a green UI path.
- HTTP tests should cover validation errors without reflected private values, CSRF and
  current campaign/store binding, duplicate submissions, reopening saved intake, and
  unknown/unavailable adapters. Use the shipped handler/application owner, not only a
  mock service. UI behavior should clearly distinguish saved intake from actual work.
- Keep free-text brief/profile/voice details inside the approved local store boundary;
  verify typed projections and error paths with synthetic canaries. Run affected store,
  campaign and review regressions because intake touches those shared owners. Model,
  humanizer, critic and VM tests are not acceptance evidence for this slice unless those
  capabilities are actually implemented; their full-pipeline gates remain open.

This is preparation for a later independent frozen-diff review. No evolving builder
implementation was graded, no new tests were run, and only this audit file changed.

## First intake backend: repaired freeze review

Backend-only verdict: READY for durable intake and explicit waiting states. This is
not approval of the later research/drafting/critic runtime, the evolving UI, or a real
pilot. The builder confirmed this exact freeze:

| File | SHA256 |
| --- | --- |
| scripts/prospecting/schema_p15.sql | CBC1C50D9B631E7CEB5F1989AE306231BD7FFEB7B7570B079F97B5102BC2D254 |
| scripts/prospecting/pipeline_service.py | A2A952DAB7FDB6411EE33CDB81D60946A7B2FCD27CAD7E42D27D25116BC3BC73 |
| scripts/prospecting/tests/test_pipeline_service.py | C540AADC47204BB934869B38C6066A26C5B519B7A96E1206C8F9E48EE0DDB224 |

Reviewed all three files plus actual store migration and campaign-binding owners.
The numeric migration loader discovers additive P15 without changing applied prior
migrations. The service uses canonical request/content binding, immutable intake
versions, one short transaction for intake/run/initial-stage rows, private context
only in the local projection, and an opaque/count-only separate safe projection.
Funding range/window/count and canonical role-family values are configurable.

Two independent findings were reproduced and repaired:

1. The latest-intake inner join silently returned revision 1 when revision 2's run
   and stage rows were missing. The repaired reader selects the newest intake with
   a LEFT JOIN and raises store_state_invalid when its run is absent.
2. Lone-surrogate scope text, list-valued funding interpretation, and date-year
   underflow produced UnicodeEncodeError, TypeError and ValueError. They now produce
   fixed PipelineError codes; scope mode and role-item validation also check types
   before hashing/membership operations.

Independent synthetic in-memory probes confirmed both repairs. An additional TEMP
trigger forced the third stage INSERT to abort: all intake/run/stage row counts stayed
unchanged and the transaction closed. No disk or live store was used in these probes.
The builder reports 22 passing focused pipeline/migration tests in 7.69 seconds;
the reviewer read the new fresh-connection replay, malformed-input, latest-run-missing
and forced-insert rollback tests, but did not independently rerun that full suite.

Combined UI review remains in progress at this checkpoint. Initial JavaScript probes
using the bundled test harness proved missing intake hydration, existing-campaign save
incorrectly posting campaign creation, and create-then-intake-failure leaving a committed
campaign without intake. The UI owner is repairing these paths and asynchronous
save/switch/typing behavior before combined acceptance.

Actual synthetic loopback HTTP probes through the application owners returned intake
save 201, exact replay 200, unauthenticated 401, and missing-CSRF 403. A missing stored
stage now projects explicit unavailable/store_state_invalid with a status-unavailable
next action, rather than pretending no intake exists. This was tested after that HTTP
repair appeared; final acceptance still requires the frozen combined files.

The probe server stopped and its thread joined. Synthetic scratch is retained at
`_private/pytest-pilot-infra-integration-20260909/review-probe-1.sqlite` under the delivery
worktree for root-owned cleanup after all testing. The first scratch setup failed
because the parent directory was absent; bounded retry creating that exact parent
succeeded. This was an environment setup issue, not a product failure. No real PII,
external network, VM, browser, credentials, or code edits were involved in this review.

## Combined first intake slice: final acceptance

Verdict: READY for the bounded durable-intake slice. No unresolved material finding
remains in the reviewed freeze. Actual browser visual/native-interaction acceptance
belongs to root's next check. Research, qualification, generation, humanizer, critic,
sending, VM parity and deployment remain separate unimplemented/unaccepted capabilities.

The backend freeze above is unchanged. Final UI/test freeze:

| File | SHA256 |
| --- | --- |
| scripts/prospecting/review_app.py | 1567C1441B0056300F69AA670AF42707091CFDEEC4094A7A88593F296043CC62 |
| scripts/prospecting/review_app.html | F0DAA122D1C39A787207AFEDE88528FAC5FC6737485E72F00644FB1E8A5A6865 |
| scripts/prospecting/tests/test_review_app.py | B980F76F95F56459ED4CB1666DDC2DBE302A420081A03CCF3B139C6708C2D8D0 |
| scripts/prospecting/tests/test_review_app_integration.py | 3962178EED9822F735327AD662071C9A8A57D12A9F5002883DBBB331B8CD4233 |
| scripts/prospecting/tests/review_app_state.test.js | 525E85A6255CB42DB69DADD6BF0B482DA32BD0B5608DB7E58C1CC667377C9758 |

Reviewed the actual changes and relevant unchanged HTTP authentication, CSRF, local
application-owner and renderer paths. review_service.py was not changed. Default
PipelineService uses the selected ReviewService connection; an injected PipelineService
bound to another connection is rejected. The HTTP route shares the existing session,
CSRF, host, request framing and fixed-error handling. Private intake context is returned
only through the authenticated local UI projection, and interpolated text is escaped.

Repaired integration findings:

- Campaign creation and selected-campaign intake saving are separate actions. Saving
  criteria for a selected campaign no longer calls campaign creation. Saved intake
  fields hydrate; no-intake campaigns receive explicit unknown-scope defaults.
- A pipeline validation failure no longer occurs as a hidden second half of the
  campaign-create action. Pipeline corruption/unavailability is distinguished from
  absence and is visible without disguising it as an unsaved brief.
- Per-campaign unsaved intake state survives switching. A save uses the submitted
  version, preserves newer typing and does not change selection after another
  campaign becomes active.
- An independently reproduced retry bug mutated the cached draft with request_id,
  causing a new UUID on unchanged retry. The final implementation clones the request
  and excludes any earlier request_id before signing it; unchanged ambiguous retries
  now retain identity. A regression covers this contract.
- New-campaign reset restores the research date defaults. UI stage choices, window
  maximum and company maximum match the backend; editable canonical roles remain
  generic. Accidental mojibake/BOM changes were removed.

Independent final verification:

```text
Python313 -B -m pytest scripts/prospecting/tests/test_pipeline_service.py
  scripts/prospecting/tests/test_review_app.py
  scripts/prospecting/tests/test_review_app_integration.py::test_pipeline_brief_is_saved_locally_without_launching_research
  -q -p no:cacheprovider --basetemp _private/pytest-pilot-infra-final-20260909
39 passed in 15.10s

node --test scripts/prospecting/tests/review_app_state.test.js
9 passed, 0 failed, 0 skipped; 171.636ms
```

Four additional read-only bundled-JavaScript harness probes passed against the final
HTML: lost response retains request ID; newer typing survives save/reload; background
save preserves campaign selection; New campaign restores a valid date. These supplement
the committed tests and are not a real-browser visual/native-form validation claim.
Earlier synthetic real-HTTP probes verified save/replay, unauthenticated/CSRF rejection,
and typed unavailable state. Diff whitespace checks passed for reviewed implementation
and test paths. Relevant hashes were rechecked after final verification.

No review-owned server or test process remains running. Root should clean the retained
synthetic scratch only after all other work is complete:

- delivery `_private/pytest-pilot-infra-integration-20260909/`
- delivery `_private/pytest-pilot-infra-final-20260909/`

This acceptance concerns technical readiness of the exact intake slice. It does not
refresh human-owned evaluation manifests, authorize publication, or establish the
user's full real-data pipeline goal.

## Independent email-template proposal review

Verdict: revise the proposal before template implementation. This is a source and
synthetic-render review of `2026-09-09-prospecting-email-template-revisions.md`, not
runtime humanizer acceptance. No template or product source was edited.

1. **Medium: AI interest becomes unconditional generic-template content.** Proposal
   lines 29, 41 and 53 add fixed first-person AI learning goals to existing reusable
   IDs; integration lines 64-67 retain routing unchanged. The pilot's user-authorized
   AI curiosity is valid input, but another campaign with no AI angle would acquire
   it automatically. P8 binds `sender_intro`/`sender_proof` to the sender profile
   (`affinity/templates_v2.py:323-327`); these new literals have no such binding.
   Keep generic copy goal-neutral or make AI copy selection explicitly depend on
   approved intake/AI-angle context. Test an AI-authorized campaign and a no-AI
   campaign, including an exclusion, without asking again for already supplied claims.

2. **Medium: three edited families do not cover the pilot's role families.**
   `_family()` (`affinity/templates_v2.py:174-177`) selects the ops families only
   for titles containing operations/operator/chief operating. Strategy and Chief of
   Staff titles normally select unchanged `startup_nonops`, whose stock copy remains.
   Curiosity intent instead routes every person to `curiosity_thesis` at lines 162-163.
   State this limit explicitly; a later bounded selection change must test actual
   operations, strategy and Chief of Staff titles against approved campaign intent.

3. **Medium: template eligibility still requires a supported career bridge.** All
   three proposed bodies retain mandatory `shared_signal_sentence` and both transition
   slots. `templates_v2.py:219-225` requires their evidence before rendering, and
   `affinity/evidence_bridge.py:324-337,351-399` refuses absent employer/path sources.
   A valid current pilot contact without a supported earlier-career bridge therefore
   cannot use these families. Preserve that refusal; specify an evidence-eligible
   research-hook/current-role occasion as the fallback instead of inventing a bridge
   or treating common background as a pilot requirement. `startup_nonops` currently
   has the same slots and is not that fallback. Test both supported and absent bridges.

4. **Medium: the noncorporate rewrite adds causal career interpretation.** Proposal
   line 39 says the role "grew out of" the prior work and "into" the current work.
   The underlying source claims establish prior/current employment, not that one
   caused the other (`evidence_bridge.py:393-399`). Prefer neutral wording such as
   "I'd like to hear about your move from {transition_from} to {transition_to} and
   your work as {their_role} at {firm}." Review the rendered sentence with real-shaped
   synthetic role/path values; do not infer motivations or consequential choices.

The rewrite removes the worst filler. Remaining editorial fixes are small but useful:
remove "stands out given" and "AI inside the work"; avoid implying comparable sender
experience with "compare notes" unless the sender context supports that posture.
For an authorized AI-angle variant, "I'm curious where AI has been useful in day-to-day
operations, if at all" asks about experience without assuming adoption. Keep exactly
one question overall by incorporating the informational ask in the same question or
keeping the angle declarative. These suggestions are illustrative, not approved copy.

Independent in-memory render verification used the existing floor/ceiling synthetic
slot fixtures and the real renderer/clamping/band helpers. Every proposed template
preserves the exact existing slot inventory and one question. Corporate renders at
90/109 body words; noncorporate and curiosity each render at 91/110. All six pass the
existing 75-125 word and 36-50 subject-character bands. This does not prove every
possible sender profile fits every saved campaign band or establish factual entailment.

Before accepting the proposal, change its line 72 semantic assertion into an explicit
semantic review obligation; deterministic tests can catch known forbidden strings,
not prove all claims are supported. Its Humanizer section summarizes a draft rather
than retaining the actual draft required by the skill's draft/audit/final process.
Retain that draft if calling the section evidence, or label it editorial notes.

Version binding: ID plus version 2 is the correct existing registry seam. P11 already
hashes template ID/version, exact subject/body, evidence IDs and prompt/model labels
(`personalizer/revision.py:45-73`); keep old revisions immutable and add regression
coverage for version changes producing distinct revision identity. For the future
pipeline, pin exact template content, approved intake/AI-angle and sender-context
version/hash, and Humanizer 2.8.2 skill content hash. Humanizer draft/audit/final and
independent review receipts must bind the exact parent and resulting revision hashes.
No current renderer call or template-development pass supplies those runtime receipts.


## Phase A editorial refusal implementation checkpoint

Root requested this bounded implementation after the independent design review.
The infra reviewer therefore authored Phase A; root owns its independent acceptance.
No migration, receipt writer, synthetic pass switch, P15 change, or live runtime was added.

The review service now refuses `ready=True` with `editorial_receipts_missing` for all
revisions, including human-edited descendants and replayed historical ready requests.
Request conflicts, current-revision checks and pending-candidate checks precede the
refusal. Effective draft projections mask historical ready events as review-required;
immutable history remains intact. `ready=False` and its current-revision replay remain
available. HTTP returns 409 for the missing-receipts condition; the UI disables Mark
ready and explicitly says the required review stages are not connected yet.

Builder verification: 67 focused Python tests passed; the remaining acceptance test
failed because it edited a phrase removed by the concurrently revised template. That
fixture now edits the subject while preserving the evidence-bound body; its rerun passed
(1 passed, 0.84s). All 10 bundled JavaScript tests passed (185.946ms). Scoped diff
whitespace validation passed. Root independently found no blocking defect for this
explicit refusal scope. Root's final independent acceptance is READY for editorial
refusal only: 50 focused service and real-HTTP tests passed in 27.63s, and all 10
bundled JavaScript tests passed in 138.27ms. The author did not self-grade this change.

Material limit: this is an editorial-readiness refusal gate, not whole-pipeline or send
enforcement. Approval and executor readers still hold and consume their separate
authority independently of editorial state; the existing synthetic acceptance fixture
shows an approved revision whose editorial projection remains review-required. Phase B
must wire exact-revision receipt/freshness requirements into every approval/executor
reader that treats a draft as eligible. No humanizer, factual-recheck, or independent
critic stage has been executed or attested by this change.


## Independent frozen template implementation review: repair required

Reviewed the frozen source hashes reported by the email builder; independently matched
`evidence_bridge.py` FE80B19F..., `templates_v2.py` 18BABFDB..., and `qa.py` 66571AAD....
The builder reported 153 focused tests passing. Independent source review and isolated
synthetic probes found two concrete issues; this implementation is not accepted yet.

- High: `affinity/evidence_bridge.py:143,307-327,582-587` has no source-specific
  recipient-hook signal mapping. A selected `own_writing` observation with a weak
  signal inherits copy permission from unrelated strong/medium signals. An isolated
  fixture downgraded only own_writing to weak, confirmed that obs_writing was selected,
  and observed `allowed_for_copy=1`. Preserve the selected writing source's copy class;
  test mixed strong identity and weak/disallowed writing rather than only weak-only
  affinity. Current-role fallback must never relabel writing as role evidence.
- Medium: `templates_v2.py:69` truncates recipient hooks to 18 words, but
  `evidence_bridge.py:502` accepts only exact canonical display for this new slot.
  A normal longer writing hook was clamped and then rejected by the real display
  helper. Define safe canonical/display handling for this slot and verify the entire
  renderer, evidence mint, and QA path with long authored-work and current-role inputs.
  Do not weaken other slots' source or entailment checks.

The first probe's attempt to modify its synthetic source observation was refused by
its existing immutability trigger. The second issue was then verified without store
mutation using the actual clamp/display helpers. This immutability refusal is not a
product defect. Scratch remains at `_private/template-audit-probe-20260909/`; the
probe process exited and no server was started. No product source was edited by this
independent template review.


### Template repair closure

Independent verdict: READY for the bounded neutral-copy/networking-fallback slice.
The selected authored-work signal now determines its own copy permission. Long writing
that cannot fit intact uses the independently verified current-role hook; it is not
copied as a misleadingly truncated sentence. Legacy employer/path slots retain their
requirements, and the current-employment identity gate remains mandatory for both
recipient-hook sources. This is structural/source-binding acceptance, not a semantic
review result or runtime Humanizer receipt. The fallback is currently selected in the
networking branch; curiosity/alumni/recruiting routes retain their existing selection.

Final independent focused verification: 13 tests passed, 114 deselected, in 2.75s
(`current_role_hook or long_own_writing or weak_selected_writing`). This includes the
three pilot role families, invalid current source, long-writing full rendering/minting,
and mixed strong-identity/weak-writing authority. Root independently ran the joined broader template regression: 156 tests passed in 22.83s.
Final reviewed hashes: evidence bridge `02BFED67071E92AB68F79459032D785616B4488418F673C511E241EEA96F1C6B`;
evidence tests `5BB9CF0C03AA6AB9CEA5BF6E8C70CC22F24B156043D18F951D1AEB5DBB80CB90`;
template tests `9EC14F6ABC0FCCD7C1019DE7B1A363C2FC5C41A0EF8DBAEC0FB933E6C87FAD64`;
fallback template `345BFC926DEE86FA0C493B4CE50BC5460D81288AE1E18268DE638462E3F708C3`.

## Independent synthetic runtime implementation review: repair required

Matched frozen source `private_runtime.py` 42C0A93D..., tests 6179D513..., and spec
14598F71.... The implementation admits only fixed synthetic input/schema/skill bytes,
uses a code-owned fake loopback provider, excludes raw byte fields from dataclass repr,
and does not create a live adapter, controller lease authority, or Humanizer receipt.
Builder reported 12 installed-CLI/synthetic tests passed in 16.23s. Review found:

- Process failure cleanup: after successful suspended CreateProcessW, a failed
  AssignProcessToJobObject leaves the process outside the job. Closing its process
  handle does not terminate it. Explicitly terminate/wait before releasing handles.
  Additionally, an exception from the process helper bypasses cancellation/join of
  observe_fixture, leaving that daemon thread running. Test both injected failures.
- Tool declaration validation: the fixture handler extracts only names, so a nameless
  built-in declaration is ignored. An independent in-memory request probe confirmed
  `{'type':'web_search'}` yields no declared tools and no rejection. Validate the exact
  allowed shape: empty, or one function named request_user_input; reject other types,
  malformed rows and duplicates. No forwarding broker is required.
- Fixed-code request validation: a TurnBinding with skill=None raises AttributeError;
  boolean deadline is accepted as an integer. Both were confirmed without launching
  a process. Validate the nested DTO before dereference and require literal integers.

These are bounded synthetic-executor repairs. No credentials, provider call, browser,
MCP remote-control session, VM, or real prospect record was used in this review. The
absence of synthetic canary bytes remains a measurement of named application sinks,
not universal provider/OS privacy proof. Production authentication, retention, ACLs,
exact-revision controller fencing/import and mandatory review-stage execution remain
outside this synthetic slice.


### Synthetic runtime repair closure

Independent verdict: READY for the synthetic-only structured-turn executor. The
reviewed repair explicitly terminates and waits for an unassigned suspended process,
stops and joins the observer on orchestration failure, validates the allowed tool
array shape, and rejects malformed nested bindings and boolean numeric bounds with
fixed codes. Independent focused verification: 20 tests passed in 19.06s, including
the installed CLI against the fake loopback provider, input/output/error canary scans,
tool-response rejection, malformed/oversized/schema-invalid output, timeout and
fresh-attempt recovery, exclusive attempt ownership, and descendant/process cleanup.
Builder independently reported 20 tests passed in 18.34s.

Reviewed SHA-256 bindings:
- `private_runtime.py`: `b299f1939ee05b0e3dbfe272efa9ca2c929eae071f893ebc8235f97f03c78ff0`
- `test_private_model_runtime.py`: `72a68c426a2edb37bb546bb88ecb777463a3199e366fbc9a85428a6e2e3fe45b`
- Runtime spec: `afd3d6cb0959a950daa001b3d1a78e58f9ca4e01e91b8f1b85ea9e07c2b62694`

This closes the preceding synthetic implementation findings. It does not establish
live-provider authentication or retention, approved production runtime identity,
real-data sink isolation, controller-owned durable lease fencing/import, or actual
Humanizer/fact-check/independent-critic execution. Tool-response observation here
belongs to the code-owned fake provider; a live response-observation boundary remains
to be designed and tested. Canary absence is confined to the scanned isolated CLI
home. No real records, credentials, external provider, VM, browser, or remote-control
session were used. Review scratch remains for root-owned collection and cleanup.

Post-review test-only addendum: the non-synthetic input sentinel was changed to plain text for the repository PII guard; the refusal, hash and repr assertions are unchanged, the affected test passed (1 passed in 0.21s), and independent review accepts the change without a broader rerun. The final test-file SHA-256 is `17572F7044C812E9EEC94F73D0FBF254FB5B2481A1946B34D9150804F052487D`; runtime source and spec are unchanged.


## Independent private intake CLI acceptance

Independent verdict: READY for the private-file intake boundary and draft learned
intake skill. The CLI accepts an existing approved private SQLite store and bounded
strict JSON beneath that store parent's snapshots tree. The review verified exact
source/skill bindings, fixed-code errors with no raw brief output, fresh-process
idempotent replay, shared-private versus nested-checkout rejection, linked-input
refusal, duplicate/nonfinite/deep JSON handling, and agreement between the CLI and
local HTTP projection from the same P15 store. Independent focused tests: 17 passed
in 9.34s. The skill preserves unknown scopes and original user requirements, and
honestly reports input_pending or awaiting_research_adapter rather than completed
research or drafts.

The worker then replaced email-shaped test canaries with a plain sentinel and
reported 17 tests passed in 15.12s; the subsequent test change only wrapped long lines.
Independent source inspection accepts these test-only changes without another broad
rerun. Final SHA-256 bindings:
- `pipeline_cli.py`: `CEA9A62D7C8B860E8AB6475E9C8A4F27F8426D11395A9BA392632BCD14012886`
- `test_pipeline_cli.py`: `8136C7E09D264EEC057BB124C1B1D26EEE0094845007EBF87E08DF8041A95CC9`
- `skills/learned/prospecting-intake/SKILL.md`: `E286ED68DD4BAED9BBE64A15F7081A632B15F59D7ED5981A65A0846C2F910D6E`

The intermediate post-sentinel test hash was `1ED65EFA04F5CEF85AA7FA59F1016F787F53734EA600307CF7BE4D287E59356B`;
it is superseded by the final formatting-only hash above. This slice saves intake
only; no live research, humanization, critique, sending, provider call, browser client,
or VM was exercised. The learned skill remains a sandboxed draft pending promotion.


## P16 final independent review - 2026-09-10

Independent technical verdict: READY for the bounded saved-revision controller and shared readiness gate. This reviews the core and consumer builders' code; root retains acceptance/checkpoint authority. It is not a completed prospecting pipeline or a working production model adapter.

The reviewed path persists controller-owned attempts, immutable Humanizer/fact-check/critic artifacts, separate human acceptance, and agent-origin revision lineage. No automation calls the authentic human-edit writer. A complete accepted chain is a precondition for marking ready; approval construction/materialization, scheduling, and transaction-time execution consumption additionally require the latest exact-revision human-ready event. Missing adapters fail before claiming work. Structural QA is not semantic entailment or proof of actual model execution.

Material review findings are closed in the final source:

- Pending or failed authentic human edits now block suggestion acceptance and shared readiness; an Executor hook creating such an edit after initial T1 validation prevents final consumption and any fake-send adapter call.
- Every reviewing stage receives the pinned sender profile, campaign brief, intake, P11 context and evidence. Context changes invalidate subsequent work and accepted receipts. The current role predicate uses the existing resolver plus the exact P13 attestation and source expiry.
- Surviving literal parent bindings cannot be omitted or replaced to evade P11. Repeated or overlapping recipient binding aliases cannot inflate the recipient/sender ratio. Distinct separately rendered claims from the same evidence source remain supported. These controls preserve known structural claims; novel free-text assertions still require genuine independent semantic judgment.
- Expired synchronous results store no artifact and now record expired/lease_expired with stable old-request replay and a new-request retry path. Independent two-connection testing also verified that a late old worker cannot overwrite a recovered successful attempt.
- Exhausted parked lineage cannot restart by creating another intake run. Ambiguous dual-table parents and cross-table cycles fail closed. The dual-parent case was a store-integrity hardening finding: both existing public writers require a newly created globally unique revision before inserting lineage, so no ordinary valid-writer path to that corruption was established.
- T0 cancellation preserves another process's existing claim; owned cancellation uses the exact acquired claim values. The final gate runs after refresh/persist callbacks with a fresh controller clock. T1 materialization retains the signed batch scope verification and computes the persisted approval hash from the final authenticated approval-row fields required by the existing executor.

Independent final verification: 35 passed, 115 deselected in 12.50s, covering all 29 frozen core tests plus six genuine consumer compositions in review, approval/Executor, scheduling and T0 release. Earlier independent targeted tests confirmed acceptance rollback and fresh-connection stale-worker fencing (2 passed in 2.02s). The private tests that demonstrated pre-repair binding omission/alias admission are retained as discovery evidence, not represented as passing final acceptance tests.

Root verification: the broader pre-final-alias run at service 996B8102 had 259 passed in 49.50s with one launcher test deselected. That launcher test separately passed in 5.74s in the normal-user context, including owned process cleanup; earlier orphan trees were identity-checked, cleaned and verified absent by root. The final affected run at the hashes below passed 31 tests in 11.37s (all 29 core tests, actual approval/Executor composition, and review acceptance). These overlapping counts are not additive. Legacy store/approval/release tests explicitly isolate P16 gates; the genuine compositions restore the real gates and provide the integration evidence.

Next-slice limitations remain explicit:

- The saved-revision entrypoint requires P13 human source attestation before model stages. The requested first-review-at-drafts experience still needs provisional source/draft review or a validated pre-attestation path; no attestation may be fabricated.
- Parked exhausted lineage has no authenticated reset authority, including after a genuine human rewrite. A future explicit new-work decision may define a bounded reset; the cap must not be silently weakened.
- The conservative first-occurrence alias guard can park legitimate nested hook/company/role wording. A later reviewed distinct-span metric may improve this using actual drafts while preserving bindings.
- Discovery, funding qualification, contact ranking, initial draft integration, UI suggestion acceptance and production private model adapters are not delivered by this slice. The separate synthetic live smoke attempts returned no final output or production receipts. Real-data sink isolation remains unproven.

Final SHA-256 bindings (verified after the independent final run):

| File | SHA-256 |
| --- | --- |
| `scripts/prospecting/schema_p16.sql` | `3696D7EE69C5F6918E588FD242BBEAD9C5FAD74D8D40DD3405F5B48554D65BAD` |
| `scripts/prospecting/pipeline_stage_service.py` | `6DC0C83D5AEADF47FE846DBEB0DB16295FB2047B1E4D3310CBB2C0E449C3A106` |
| `scripts/prospecting/tests/test_pipeline_stage_service.py` | `4BEEBD33E7CAE0FCDDE1B1850E443EAE80F52F47E36EF4E9397FFDA70DBCD957` |
| `docs/superpowers/specs/2026-09-09-prospecting-skill-pipeline.md` | `BCDB13B54133A86112F32FC80E3F410A346FC25A3A764545E5B054B954328A97` |
| `scripts/prospecting/store.py` | `18BBA823E16A794EF7D3D65652E587E347CBE59C59DC1F0EFA55FA090F5906FE` |
| `scripts/prospecting/review_service.py` | `222B9136BF785EEA737D0FD957BFC317C3F18C73523257743175709CD422E7BD` |
| `scripts/prospecting/approval/batch.py` | `395AC21BF757E90EE046E0C8BD3CF6AC36DB568E0A455C8EB2A4BC5636FCAB97` |
| `scripts/prospecting/approval/verify.py` | `534DACCEA6004CF98752856980C24BC091D493AA68859C4AC2F5B81F164AF953` |
| `scripts/prospecting/campaigner/schedule.py` | `FB07EDBA1DD5C6051AB8D0A0762E8FC73C1CF8B2604D0DD7B493A66A62471F30` |
| `scripts/prospecting/executor_campaigner.py` | `1A0183AFA8002E27EF75810B2C4F2384CA7491BBC3069DE559A777497B383223` |
| `scripts/prospecting/campaigner/wiring.py` | `2F119ACFDA1C74E46D71CDEB28BD20879710FB705584C2940286FB70824F74F5` |
| `scripts/prospecting/tests/test_store.py` | `868C9026F10364FC92BBE6D03178BBA65131904BCD06CDA31D88A4FB6314E34B` |
| `scripts/prospecting/tests/test_review_service.py` | `30DFB0BD540AEEE30FAB21068B2C6270E458CDFA43364BF4A4BB81C66564B2FB` |
| `scripts/prospecting/tests/test_approval_integration.py` | `C06AB72A3363ED1B9508850565BD37245B5E75E4D3614E7955C0C5D782A40F8C` |
| `scripts/prospecting/tests/test_campaigner_schedule.py` | `ABF49593468D3DCA3FCD7CDCD832DCE2CCEB576AEAAB153C5EB3F394EA4DB1CA` |
| `scripts/prospecting/tests/test_campaigner_release.py` | `8C685BB458C80B959BDB23B14AF15AA51CD2FE357314942C8666A3A3EE7140A3` |
| `scripts/prospecting/tests/test_contracts.py` | `D9EF3DDA135C7B282F8A5467FC733F3FAF955325F3B55198DC7362CB188BC955` |
| `scripts/prospecting/tests/test_executor_surface.py` | `0FE734075D3FC44C96406C0ABE063D78CAC25AE7EED7D9D5CF5DB98AB97E0974` |
| `scripts/prospecting/tests/test_t1_release.py` | `62A8967AE7EBD16FA3B98877BA8B39063CEC1A9000E2A04C6257BD6B08A6A058` |
| `scripts/prospecting/tests/test_review_pipeline_acceptance.py` | `35ED85A79D435CFE66EE3375077BCE460326D8549D556DC8386577C1FB3C69D0` |


### P16 final test-only sentinel addendum

Independently reviewed the seven post-freeze literal substitutions: six UUID values were replaced with canonical synthetic UUIDs, and one inline message ID now uses the existing synthetic fixture. Assertions and production code are unchanged; the builder reran the four affected actual-chain tests with **4 passed in 2.38s**. The bounded P16 acceptance remains unchanged. These final test hashes supersede the corresponding hashes above:

- `scripts/prospecting/tests/test_approval_integration.py`: `38FD598DA82A3EE3640B469FC61C01C2E4C6EAACD3B826D692F277B6F4454E8C`
- `scripts/prospecting/tests/test_campaigner_release.py`: `4793892CA30396CE64C5FCE105457DCA4AB73F72EF70FCF612AAB4C48FA562BF`
- `scripts/prospecting/tests/test_campaigner_schedule.py`: `9BB807144CAF1A184F798776DC1C728B551FA45D893488B5FC27112FE3A0C615`


### Phase C: pinned-file stdin deadline repair

Independent source/security review: READY for the bounded synthetic runtime repair. The owned Windows process now receives a canonical direct-child, regular, single-link, non-reparse file through a held read-only/share-read handle; it verifies the hash and rewinds before suspended process creation. The deadline starts before file opening/spawn, removing the blocking parent pipe write. Existing Job Object assignment, descendant cleanup, and whole-attempt deletion remain; owned stdin is deleted before sink scanning. Public execution remains synthetic-only, with no live adapter or real-data readiness claim.

Reviewed the complete changed source and test paths, including maximum-input digest, unread maximum input timeout and descendant termination, hash/nested/hardlink rejection before spawn, spawn/assignment handle closure and recovery, and stdin deletion failure. Builder verification: **24 passed in 16.65s**. Root independent verification: **24 passed in 17.34s** at `pcr-root-0910-a`. These are overlapping runs, not additive counts.

- `scripts/prospecting/personalizer/private_runtime.py`: `4E54D8CAFC551DB47B06FF79FEC2E828CAAA0CBDF76030376D4EC79BB8163C5B`
- `scripts/prospecting/tests/test_private_model_runtime.py`: `80D6B3CB6C4C0D2C4AB410E4024907956D52B6C35E59618ED32172DD100EBB1A`

Private diagnostics continue to pin the preserved previously accepted b299 source explicitly; this acceptance does not silently retarget their imports. Native model execution and its storage boundary remain separate pending work.

### Draft-first source and review integration: final independent review

Independent verdict: READY for the bounded desktop-local draft and review slice. A selected person with an exact, fresh, verified local source can receive a canonical P8/P11 draft and enter the existing P16 review stages before human P13 confirmation or contact discovery. Explicit human acceptance of reviewed text remains separate from source confirmation, editorial readiness, and outbound authority. Confirmation of the unchanged exact source preserves the reviewed text, revision hash, and stage chain. Final readiness still requires exact P13 confirmation and the accepted stage chain; existing approval and execution contact gates remain in force.

Reviewed the complete changed backend, consumer, HTTP, and bundled JavaScript paths. Concrete findings closed: normal campaign/template routing is preserved; email suppression includes unusable current-company contacts; accepted revisions resolve their stage projection through decision lineage; P13 selects its exact authentic role/name observations rather than an unrelated lexicographic name; HTTP decision replay uses static scope checks before the service replay branch; per-port session-cookie names prevent concurrent loopback servers from replacing each other's cookies; typing and programmatic history selection disable readiness, with a defensive dirty-text check at the ready-click boundary. Source expiry, changed role/scope, tampered snapshot bytes, and changed context still fail closed. The HTTP layer owns the human actor label and exposes no stage-artifact submission authority.

Independent verification: **15 passed, 135 deselected in 7.80s** for changed renderer/P16 cases at `draftfirst-infra-0910-final-a`; **5 passed, 69 deselected in 3.30s** for focused genuine HTTP/service, replay, and two-server cookie cases at `draftfirst-infra-http-0910-a`; **14 bundled JavaScript tests passed in 132.9296ms** after the final history-selection repair. The backend cases include actual rendering followed by three synthetic stage adapters, local acceptance, and later P13 confirmation. Builder verification: backend **170 passed in 45.90s**, ReviewService **52 passed**, HTTP **22 passed**, and final bundled JavaScript **14 passed**. These runs overlap and are not additive coverage claims.

Final reviewed SHA-256 bindings:

| File | SHA-256 |
| --- | --- |
| `scripts/prospecting/affinity/evidence_bridge.py` | `FACB35DF765F889B7310DE477D093C426063C06187458766589CC88B00B66E66` |
| `scripts/prospecting/affinity/templates_v2.py` | `A0CEEE0C77EBCCE8BE58C0269C9B20B5D445781561E3D05DBAB33B37FDD207E9` |
| `scripts/prospecting/pipeline_stage_service.py` | `B085039DBC570E737B78AA06D34DC47120964C0D36442FD4C717772DA087065E` |
| `scripts/prospecting/review_service.py` | `04DB7E3F177A7D220D7DA854129487579A358DCE4272F78EDA7D2270F7873DE3` |
| `scripts/prospecting/review_app.py` | `14936600F704CFBE394B0BB65EEB0CEC2A58C41BA371349BA7685034C528ADA5` |
| `scripts/prospecting/review_app.html` | `625842E90CA380FB0A78CE15A707EF46D2300C4F3E3376F6CA5476F19E9C6F2D` |
| `scripts/prospecting/tests/test_affinity_templates_v2.py` | `48D1CE5CEB683C15FCE9823AAD5982B307082D6FF7AEA3F61DB947D2449F3636` |
| `scripts/prospecting/tests/test_pipeline_stage_service.py` | `030FE35B08F4D1966177CB8C4C8046F541EBD0FAF8CC647DF960DE27E96795B2` |
| `scripts/prospecting/tests/test_review_service.py` | `7EF06B5A9FCCE8B357EE07E2CA6F67F3F79043F9277447A73B4F91C6E2BD9025` |
| `scripts/prospecting/tests/test_review_app.py` | `88A1A2E46A0A8129180AA5B08DCFFBFA6DDDBF2E4AF126A0B4449C5F7EF487C9` |
| `scripts/prospecting/tests/review_app_state.test.js` | `4473E89B88FBE56FC574C1BC98F77F06D2B2BE50799EC2E06D6E6C8BEF98DFBA` |

Limits: these are source, local HTTP, and synthetic stage-adapter results, not successful live Humanizer/fact-check/critic execution. The live adapter remains deferred after the separately observed subscription-route HTTP 401; no new authentication operation or model retry occurred in this review. Browser verification belongs to root and is not claimed here. P17 acquisition/funding work is outside this acceptance. Human rewrite/reset authority after an exhausted repair lineage remains a separate follow-up; no automatic reset or source attestation was introduced.

### P17 provisional funding capture: final independent review

Independent verdict: READY for the bounded private capture-import and mechanical provisional-classification slice. The three immutable P17 tables preserve complete replacement batches and exact predecessor hashes. The requested company count remains separate from the bounded candidate pool, capped at the lesser of 200 or three times the requested count. Import and projection reuse P15 integrity validation and explicitly compare run/intake bindings. Public CLI output contains only opaque identifiers, hashes, fixed state, and aggregate counts; private manifest fields and capture bodies remain within the selected store's snapshot boundary.

Reviewed all new schema/service paths and the changed CLI, tests, and learned skill. Closed concrete findings: the circular PitchBook import and full-URL hostname misuse are removed; conservative ASCII DNS-label validation rejects ambiguous hosts; conflicting supplied company identity is retained as a collision capture without linking company observations; input and stored-body reads reject root/ancestor reparse points and use bounded regular-file handle checks; rollback uses the owned staged inode rather than adopting a foreign replacement; coverage queries match token boundaries and search time cannot follow capture time; exact P15 workflow validation replaces the weaker local check; old request replay reports its original batch even after a replacement; and primary support is evaluated for the exact stage/date pair, independent of corroborating page order. Explicit versioned rule manifests describe the importer/classifier policy; they are not semantic reviewer receipts.

Independent final verification: **26 passed, 29 deselected in 10.92s** at `p17-infra-final-0910-a`, covering genuine imports, replacement/CAS/replay, direct-child and nested private captures, source-time binding, changed P15 workflow, malformed hosts, collision capture, private CLI refusals/output, foreign-final preservation, and both orders of same-round corroboration. Separately, an actual Windows junction at the original selected snapshot root was rejected with `source_changed`; its target and contents were entirely synthetic and owned by the review fixture. Builder final verification: **30 passed in 10.80s** for P17 plus migration, including the two order cases; final backend/CLI combined **55 passed in 26.65s**. Root's earlier broader P15/P17/CLI/migration run was **75 passed in 37.51s** at the preceding AD052DE7 service revision. Counts overlap; the final changed pair behavior is covered by the final independent matrix.

Final reviewed SHA-256 bindings:

| File | SHA-256 |
| --- | --- |
| `scripts/prospecting/schema_p17.sql` | `EA203810EA03E6E8E4ED8BE2FAFF482809AC341F14141270B372ADE561B2A3A8` |
| `scripts/prospecting/funding_research_service.py` | `3B022BF34B58322F1952C96F1427B8620AADE76BF2271D9E54AA5DBA39D6F0D1` |
| `scripts/prospecting/tests/test_funding_research_service.py` | `E661AA8A49A0E11B5DCC195B42BE733474519B6FA482C8CDCB1D20DDEC1DA099` |
| `scripts/prospecting/tests/test_store.py` | `5CD1B6C625DB7524244EB800917DA1CEA4411BF289E3C8DC4772BC647570E1E1` |
| `scripts/prospecting/pipeline_cli.py` | `BDE313ECE822BCEBE379A643DD2DE1C7727F8F7B12F9323C27AAB8251F80B6F0` |
| `scripts/prospecting/tests/test_pipeline_cli.py` | `59C13FF6C6FB4B82ABF51DBA3FC331B17B0A297972EC7E2DC17F646B73697E1C` |
| `skills/learned/prospecting-intake/SKILL.md` | `3B21F01F7BD658C3D7E3770A7C7AA923234C568036DE98FA90D9A1D9076E6B58` |

Limits: `awaiting_qualification_factcheck` and `provisional_match` do not establish company qualification, authenticated issuer/investor authority, semantic entailment, complete market coverage, or provider execution. Source-kind and extracted scope/event values remain untrusted claims for later actual factual review; search summaries cannot supply funding-event proof. Exact hostname identity is deliberately conservative and is not a registrable-domain or corporate-ownership determination. This slice neither selects people nor creates draft, humanizer, approval, or outbound receipts. Verification establishes handled-failure rollback and exact replay, not abrupt-process-termination recovery between filesystem publication and SQLite commit. No real records, browser/authentication/model calls, new network dependencies, or production sends were used in this independent review.

### P18 provisional person capture and P17 dashboard: final independent review

Independent verdict: READY for the bounded source-import and read-only dashboard slice. P18 binds its two immutable tables to the exact current P15 intake and P17 batch/result scope. A selected company can have zero candidates; shortfall is the sum of each company's missing distinct people, so surplus candidates at another company cannot erase it. Imports retain exact captured bytes and an operator-local-v1 source candidate compatible with later P13 review. Existing person/employment identity conflicts remain snapshot-only, and existing employment is not rewritten. No fill selection, ranking, contact lookup, draft, qualification, or approval authority is created.

Reviewed the complete new capture helper, schema and person service, the P17 extraction/source projection, and the changed dashboard service, HTTP, HTML and tests. The shared capture implementation preserves bounded handle reads, root/ancestor reparse checks, direct-child P13 body references, exclusive publication and identity-based rollback. P17 retains its existing error wrappers and mechanical classification manifests. Closed findings: per-company shortfall replaces aggregate subtraction; first-name conflicts become explicit identity collisions; changed bound profile URLs invalidate projection; and malformed research-scope entries are type-checked before set construction, preserving the fixed error contract. Supplied first names need an exact contiguous normalized token sequence in the full name/source; the importer does not infer cultural name order.

The dashboard uses the validated latest P15/P17 projection. It labels results provisional and source types as recorded claims, renders escaped HTTPS links, hides the section without a saved intake, and replaces company rows with an honest unavailable/expired state when source validation fails. It adds no mutation route or qualification/ready control. Existing authentication, campaign scope and human-review gates remain in force.

Independent verification: **26 passed, 18 deselected in 11.80s** at `p18-infra-0910-a` for P18 and affected P17 capture, identity, scope, replay and rollback cases; after the final guard repair, **1 passed, 15 deselected in 0.70s** at `p18-infra-0910-b`. Genuine ReviewService/HTTP funding projection cases: **6 passed, 73 deselected in 3.85s** at `p18-ui-infra-0910-a`. Actual bundled JavaScript: **16 passed in 189.9017ms**, including campaign switching, escaped provisional details, hidden/expired/unavailable funding sections, and existing draft/source controls. Builder verification: preceding backend matrix **45 passed in 19.54s**, final P18 suite **16 passed in 6.54s**, dashboard Python **79 passed in 39.17s** and JavaScript **16 passed in 80.3ms**. Runs overlap and are not additive coverage claims.

Final reviewed SHA-256 bindings:

| File | SHA-256 |
| --- | --- |
| `scripts/prospecting/source_capture.py` | `FD23E77C1F7368454D3E2378B98162169A19FB9593BD833315D6ED3A1CB41D5C` |
| `scripts/prospecting/funding_research_service.py` | `EC1656C2ADA6FC3BF858DB4228830BB2868ECF3AFD8668D97121B8E55CDD7FA6` |
| `scripts/prospecting/person_research_service.py` | `92AAB19036BBF67816DD7089D31E5DEAB21CCF23EFE746B552FDC5B748A66DE0` |
| `scripts/prospecting/schema_p18.sql` | `B7652D95C7FDF1B14F528C4637D7624B50357E0BF655AA097EF5F028C8E04DD1` |
| `scripts/prospecting/tests/test_funding_research_service.py` | `581DF4551ADB53AB5C5DFEEF19416925E5FCEC5227010AF5BA7CDA757BDDBBB6` |
| `scripts/prospecting/tests/test_person_research_service.py` | `AC332AA80F32C86B5248370B1974C2CB69F1D1AD1C3E77AF3281664869229EC5` |
| `scripts/prospecting/tests/test_store.py` | `F1D90A7527D85ECCBD3BCFC1D1556B752E89E79678F61052844FE3BC5EA2AF4E` |
| `scripts/prospecting/review_service.py` | `0C2DC2AC8DC2A5B9555EEADEC6515443F6B87E141AA1BCF99BAB7361E01DA773` |
| `scripts/prospecting/review_app.py` | `D4FE7B209EBF0BD83018E5264D753CB5B887B05742028084F236F552901349BD` |
| `scripts/prospecting/review_app.html` | `CAF7C21297CCA3528B50A916405AA6B3768C4451DEB05480DCA36980469A865A` |
| `scripts/prospecting/tests/test_review_service.py` | `2737FBF031838B803FF34A839A15CFA9DF86D702FE4D1F1380B7585DCA6B113E` |
| `scripts/prospecting/tests/test_review_app.py` | `ACCD27AF3C6631BA2F375C80A918857CABE1A4874C8311C3559EC0AC64166DCE` |
| `scripts/prospecting/tests/review_app_state.test.js` | `FB3CAB9B0923BF060A16FB96C7A6F1C51E1B8732E3B944B297D2AF23F90FC459` |

Limits: name/title/company containment is structural evidence, not a semantic determination of identity, current employment or recipient suitability. Funding and person qualification still require genuine model review; the native subscription route remains unavailable after the separately observed HTTP 401. This review made no authentication, model, browser or external-source calls and used no real records. Handled rollback/replay is verified; abrupt termination between file publication and SQLite commit remains an explicit recovery limitation. The next integration must preserve exact P17/P18 selection and employment IDs: existing `fill_campaign_fit` scans all companies and starts contact work, while `score_campaign` joins all open employment by person. Those routines are not accepted as an unchanged bridge from these provisional imports to ranked, reviewed drafts.

Root subsequently accepted and checkpointed this P18/dashboard slice locally at `904a394b`. Root verification included **170 Python tests and 16 bundled JavaScript tests**, plus a final affected P18/migration run of **24 passed, 42 deselected in 9.83s**; these overlap the independent and builder runs above.

### P18 private CLI and intake skill: final independent review

Independent verdict: READY for the three-file person import/projection CLI slice. `--person-scope` obtains the latest validated P17 batch and returns only its intake/batch hashes, requested company cap and opaque provisional-match result/company IDs with ordinals. It grants no qualification or selection authority. Person import uses the existing bounded private snapshot JSON reader and the P18 service's exact scope/source validation; output contains only opaque bindings and aggregate counts. Exact replay of batch A after replacement B returns A, while the latest person projection returns B. Errors use an explicit fixed-code allowlist without input text, file paths or private source values.

Reviewed the complete CLI and learned skill plus the new real-subprocess tests. Independent verification: **10 passed, 26 deselected in 15.52s** at `p18cli-infra-0910-a`, covering current scope, import/replay, nested private inputs, duplicate/nonfinite/extra-key rejection, bounded size/depth before migration, snapshot containment, hardlink refusal, missing/invalid/conflicting modes and safe failure output. Builder P18/CLI combined verification was **52 passed in 50.27s**. The only review repair was skill wording: ranking uses the requested per-company count, and local source-bound drafting may precede human confirmation while confirmation remains required before readiness/outbound. The final skill validator passed; CLI code and test hashes did not change after the independent run.

| File | SHA-256 |
| --- | --- |
| `scripts/prospecting/pipeline_cli.py` | `F97715335B154D06CC0A37E87A9013B9C884CE3389FE6436CA14C68808CA3F10` |
| `scripts/prospecting/tests/test_pipeline_cli.py` | `83312510DC417CB7A6EBC8B8A549BF5E972CCB118A92BDB9C92705F3269E3861` |
| `skills/learned/prospecting-intake/SKILL.md` | `CEB27F88D14B919BD96FA9DDB1E4AAF53D4B25A5110D14FF89EEE940BAF2CDE7` |

This acceptance does not promote the learned skill, execute public research or models, rank/select candidates, create drafts, or establish a live private StageAdapter. The separately proposed adapter remains outside this reviewed slice. No real records, authentication changes, browser connections, provider calls or production store migrations were used in the independent verification.

### Funding status banner and source-capture guidance addendum

Root checkpointed the accepted P18 CLI slice locally at `3451c033`. Independent verdict: READY for the subsequent two-file banner change and final skill-only guidance. The authenticated review snapshot now acknowledges captured funding evidence with factcheck still pending when there are no people. Pending draft edits, editorial blockers and saved-draft review retain priority. This is a status correction, not a new workflow action or authority. Independent focused banner/authenticated-snapshot verification: **3 passed, 22 deselected in 1.61s** at `p18banner-infra-0910-a`; builder HTTP suite: **25 passed in 10.21s**.

The final skill guidance preserves source-supported geography/sector values at the requested granularity without loosening the saved filter. It also names the existing compact identity-proof requirement: an accepted literal excerpt must contain full name, title and company within 240 characters. Individual bios or self-profiles are the immediate fallback when a team page's facts are too far apart. Original captures remain preserved; concatenating source fragments, rewriting a source claim or inferring employer identity from the hostname is explicitly prohibited. This documents the current conservative acquisition boundary; it does not change P18/P13 proof rules or claim semantic qualification. A future structured team-page proof would need separately reviewed source associations and consumer support.

Final reviewed bindings:

- `scripts/prospecting/review_app.py`: `0E5520AA542B6400B0615ABC0B879CA9ECEB498AFB628CD2D1AE249DE3EB4716`
- `scripts/prospecting/tests/test_review_app.py`: `EEB5BE82CC6C4EBF13A7C2E2EF792AED65B45FD9929B693F3AB68AB20FF01664`
- `skills/learned/prospecting-intake/SKILL.md`: `39DF1EDBC86580D528579AD088BDB4662EAF2F343A042EF3D9B6EF228FD0542A`

The final skill hash supersedes the earlier wording-only hashes. Builder skill validation, PII scan and diff checks passed. No additional runtime, real-record, browser or authentication work was performed for this review; the pending gated-runtime implementation is not covered by this addendum.

### Gated private P16 adapters: final independent source/security review

Independent verdict: READY for the six-file gated implementation, with `ACCEPTED_RUNTIME_BUNDLE_SHA256=None`. This is not acceptance to process real prospect data or a claim that live Humanizer execution succeeded. The public stage path refuses before native executable/authentication access while the source gate is unset. A standalone synthetic diagnostic returns metadata only and cannot authorize a later process. After separate source acceptance, adapters require a successful bounded synthetic preflight in the same controller process; the resulting capability is neither persisted nor accepted from a caller receipt.

The implementation reuses the accepted pinned-file stdin and suspended-process/Job Object owner. Its bounded stdout observer accepts the declared lifecycle and non-tool message/reasoning events; unexpected/tool items, malformed streams and byte limits fail closed. Fake-provider request inspection permits omitted/empty tools or the sole function `request_user_input`; it does not permit other callable tools. The emitted tool item remains rejected. The installed loopback prime observed no tool declaration. Direct live-route declaration/behavior remains a later acceptance question, not an inference from the fixture.

The three code-owned adapters use the existing P16 controller for leases, exact source/revision binding, immutable artifacts, bounded repairs and human decisions. The full canonical 34,527-byte Humanizer skill is included, with separate post-factcheck and critic prompts and exact closed output schemas. Bundle and stage manifests pin requested runtime/model/configuration, all wrapper prompts, skills and schemas. They do not authenticate a responding model identity; requested `gpt-6-astra` and verified CLI identity remain distinct from the explicitly unverified responding model. The CLI accepts only a private store and opaque item/request IDs for one existing controller step, or an explicit synthetic diagnostic mode.

Closed findings: no-event timeouts retain process status before event-completeness checks; the Humanizer wrapper now requests a draft rewrite and is included in the accepted bundle; duplicate JSON keys, named nonfinite values and exponent overflow are rejected; queued calls revalidate capability under the lock and context exit invalidates it; primary errors and cleanup failures remain separate through the CLI boundary; and owned-sink scans include distinctive exact input/output string values rather than only complete JSON envelopes.

Independent verification: **5 passed, 22 deselected in 1.09s** at `rt-infra-0910-a` for changed process/observer, unread stdin and assignment cases; final adapter/CLI suite **20 passed in 3.10s** at `rt-infra-final-0910-a`. The final tests cover source-gate refusal, full-skill and maximum input preservation, prompt binding, strict event/output/input JSON, capability invalidation, no-event timeout, independent cleanup evidence, standalone output-fragment detection, metadata-only CLI output, and genuine P16 lifecycle composition with synthetic adapter results. The cache-prime test uses the installed CLI with an invented empty home and code-owned loopback provider; its live-canary function is replaced by a synthetic observer. Builder focused matrix: **83 passed in 40.47s**. Root final adapter/CLI verification: **20 passed in 2.92s**. These runs overlap. P19 schema present in the test environment is outside this acceptance.

| File | SHA-256 |
| --- | --- |
| `scripts/prospecting/personalizer/private_runtime.py` | `A129B486621A44881E7D917DA9AB15F77CB92E3A9B31C95782C9B107866F22A4` |
| `scripts/prospecting/personalizer/private_stage_adapter.py` | `9ED7901420B1287FF463DACC4DB2FF5EA05BF9EDE46136C0275356A95FB5B389` |
| `scripts/prospecting/pipeline_stage_cli.py` | `865E18CFFF91364A40721CE904C3973898738B8D96FA0292950E0ADD7F46FB41` |
| `scripts/prospecting/tests/test_private_model_runtime.py` | `AB7D5EF814A4523DEC13756F7E51CA5EB9AA9B4F9C2C25692466DA6D4E41EA5F` |
| `scripts/prospecting/tests/test_private_stage_adapter.py` | `1D2683FCAE4879ABC9387E818111085849FB1CB3023D21F04DBECFF757449F32` |
| `scripts/prospecting/tests/test_pipeline_stage_cli.py` | `D9F8CC706D3FCE6DD045A7146070F14CD13F5386B0AA1AAC6D08A6CBD990D367` |

Remaining acceptance gates: resolve the separately observed HTTP 401 through authorized account setup; review a genuine authenticated synthetic canary and a full synthetic Humanizer/stage invocation under the exact bundle; verify direct-route tool behavior, output/schema handling, owned cache/log/temp observations and cleanup before enabling real data. The small fixed-JSON preflight is a transport/sink observation, not a full Humanizer quality or workflow test. Scanning is bounded to owned controller files, full input/output representations and exact string values of at least 16 UTF-8 bytes. It does not prove absence of short names, escaped/transformed fragments, arbitrary partial text, OS traces or provider retention. No demonstrated short-name leak was found; no universal no-log claim is accepted. Ambient credentials remain CLI-owned, with no controller reads/copies, API-key fallback or VM data path. This independent review performed no live-provider or authentication calls and used no real records or production stores.


### Selected-campaign workspace layout: independent UI review

Independent verdict: READY for the two-file layout slice. Selected campaign details and provisional funding evidence occupy the full content width before the research editor. Creation controls are hidden for an existing campaign; blank selection and New restore creation mode. Research saving remains a separate type=button action, so hidden required creation fields do not block it, and selected-campaign form submission cannot create a duplicate campaign. Existing per-campaign research/draft preservation, load-generation fencing, source/ready gates and escaped read-only funding rendering remain in place.

Closed a concrete browser-cascade defect: the form-grid display rule overrode the native hidden attribute. The final explicit `#campaignCreateFields[hidden]{display:none}` rule and stylesheet regression close it. Independent actual bundled JavaScript suite: **18 passed in 220.5505ms**. This verifies state/event handling and the stylesheet invariant; actual browser computed-display and visual verification remain root-owned, not claimed by this source review.

- `scripts/prospecting/review_app.html`: `98A9DD7963E76DBC9FFF1C2C387781609A50978A59553A50FBE5252A13B8F8BF`
- `scripts/prospecting/tests/review_app_state.test.js`: `1DAB39816FBCB5DD6B07370D165F34034A90AFD5823D70667B27489FFC8C0929`

No endpoint, qualification, approval, runtime or outbound authority changes are included. P19 remains separately under review and is not accepted by this UI addendum. No browser, model, authentication or real-store operation was performed by the reviewer.


### P19 source-bound qualification controller: final independent review

Independent verdict: READY for the three-file controller-only slice. Qualification batches bind the current validated P15 criteria, exact P17 provisional company scope and P18 candidate/source set. Full source text, including relevant bounded predecessor context, enters the private job; the 1 MiB envelope limit refuses rather than truncates. Ambiguous identity history and conflicting title granularity remain explicit. A current individual/team profile does not require a publication date, while a newly captured historical hiring announcement does not establish current employment. P17's recorded issuer label is not treated as authenticated semantic authority.

No configured adapter means durable awaiting_qualification_adapter state with no manufactured attempt/artifact. The service consumes a code-configured StageAdapter and derives outcomes from its complete typed findings, exact event/person citations and retained uncertainty. It does not rank candidates, materialize fill selections, create drafts, enrich contacts or grant human/outbound approval. Runtime/model identity fields record the configured adapter binding; synthetic test identities are not proof of live model execution or independent factual accuracy. Controller policy provenance is explicitly versioned, not presented as an implementation hash.

Five concrete review findings are closed: event-level uncertainty is retained and prevents supported outcomes; adapter exception text cannot enter public errors or the attempt ledger; a completed item refuses a new request before another adapter call; synchronous late output records expired/lease_expired consistently with recovery; and malformed list/dict enum or citation fields return qualification_output_invalid with terminal failed state instead of escaping TypeError and leaving a claim active. Claim-time completion/replay checks run in the transaction. Exact concurrent request tests use separate SQLite connections and prove one adapter call. New evidence uses an exact predecessor batch; a new UUID with unchanged semantic context cannot reset the retry budget. Historical exact replay remains distinct from the fresh validated latest projection.

Independent verification at the final hashes: **24 qualification tests passed in 18.09s** at `p19-infra-final-a`. This includes the original reproduced failure classes, five malformed-output shapes, genuine controller claim/artifact/replay composition using synthetic adapters, lease expiry/recovery, complete-source size refusal, changed-source refusal, full current/predecessor context, historical-currentness distinctions and bounded retry replacement. Builder qualification plus store schema/migration selection: **44 passed, 30 deselected in 19.36s**; these overlap the independent run. No launcher/browser, model, authentication, VM, external-source or real-store actions were performed by this reviewer.

- `scripts/prospecting/schema_p19.sql`: `F5EB128474E9F1024EA9C019B2B24373BDF5A496DAB8BFA3DBBDF7860A9B462E`
- `scripts/prospecting/qualification_service.py`: `C90C5D0709FB3F54F546374D94D407E5D5B11A247B80019EF74A7745DF4EDC9B`
- `scripts/prospecting/tests/test_qualification_service.py`: `B1F260416728B91588605DDA75EEB0BBB21DA6F4036836EB726C2FE6DC8828CF`

The proposed fourth shared-runtime qualification adapter, its learned skill/CLI, real authenticated execution and downstream ranking bridge are separate unaccepted work. This acceptance does not resolve the previously observed HTTP 401 or enable the private runtime source gate.


### Fourth shared-runtime qualification stage: independent review

Independent verdict: READY for the five-file gated qualification adapter/CLI/skill slice. The existing shared runtime gains a closed qualification schema and a code-owned fourth adapter; no parallel process boundary or scheduler is introduced. Exact P19 pqit/pqat/pqwj identifiers are accepted only in the qualification stage. Full source input is preserved up to the existing 1 MiB stage limit, with the complete skill and schema envelope still subject to the pinned stdin byte cap. The private CLI takes a store plus opaque item/request IDs, invokes one existing P19 controller step, and emits only opaque/aggregate metadata. The unset source gate refuses before store opening and native runtime access.

Closed two reproduced findings. First, cleanup-only failures now enter the same whitelisted, consumed-once side evidence as cleanup failures accompanying another error, so P19's safe primary-error normalization does not erase cleanup status. Second, immutable one-read stage assets bind the accepted bundle, persisted StageBinding, actual skill/prompt bytes and output schema. The actual envelope uses that snapshot; a later skill change is detected under the execution lock before process launch and invalidates the capability. This avoids a check-then-reread mismatch between the recorded skill hash and sent text.

The learned skill requires every supplied current/predecessor source, keeps semantic authority and continuity uncertain when unsupported, distinguishes publication/disclosure dates from the underlying round date, and grants no ranking, human confirmation or outbound authority. Aggregate bundle changes conservatively invalidate the shared adapter identities. Requested model/configuration and native executable identity remain separate from the unverified responding model.

Independent final adapter plus qualification-CLI verification: **25 passed in 4.86s** at `qart-infra-final-a`. Coverage includes exact four-stage schema/skill/prompt binding, maximum qualification input and underscore IDs, strict JSON/schema refusal, changed-skill no-process refusal, primary/secondary cleanup evidence, actual P19 controller/artifact composition using synthetic stage output, metadata-only CLI errors/results, and source-disabled refusal. The installed CLI cache-prime case uses only an invented empty home and the code-owned loopback fixture, with the live canary replaced for the test. Builder adapter/CLI/P19 matrix: **49 passed in 19.59s**; these tests overlap. Evolving P19 accessor/P20 files present in the fixture environment are outside this acceptance.

- `scripts/prospecting/personalizer/private_stage_adapter.py`: `56FFB8167FE5E2DDC36FE516F20EF39109D05E4143C1EFCA27B79DE6CECAC782`
- `scripts/prospecting/qualification_stage_cli.py`: `ACF1FB4731FB28A85437ED45A3687CC23015924F597EDAE64D63A8227CAE43F2`
- `scripts/prospecting/tests/test_private_stage_adapter.py`: `C6B56A149D199BADA4F241D021C64C76E231B038763D59BE15685AD734212A35`
- `scripts/prospecting/tests/test_qualification_stage_cli.py`: `6996C050C95875AD0AFEB79E180FD29356BA86C50BB030BB6115D06066CCB35E`
- `skills/learned/prospecting-qualification-factcheck/SKILL.md`: `F3F03E72FFFC3C2B63FAD937D2A261B1904D8E461DBBE3A31D3F00A182AF10A7`

`ACCEPTED_RUNTIME_BUNDLE_SHA256` remains None. No genuine qualification model result, authenticated canary, full-stage quality acceptance or real-data permission is established. The previously documented bounded owned-sink scan limits remain unchanged; no universal no-log/OS/provider-retention claim is made. No live provider, authentication, browser, VM or real-store operation was performed by this reviewer.
