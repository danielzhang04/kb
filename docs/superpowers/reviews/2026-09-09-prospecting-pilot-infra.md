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
