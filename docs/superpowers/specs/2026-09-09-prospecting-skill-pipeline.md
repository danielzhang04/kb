# Prospecting skill pipeline: implementation proposal

Status: proposal, not implemented. This document specifies product behavior and the smallest concrete
service seams for review. Names below remain provisional until the independent design review closes.

## Purpose

Produce brief, evidence-bounded coffee-chat outreach while retaining drafts, critiques, and revision
history in the desktop-local prospecting store. The skill may suggest copy; a human retains control of
every edit and every send.

The relevant Email Ops pattern is: resolve the intended mail surface, read the relevant thread before
composing, draft and verify the result, then report the exact state. This product applies that pattern
to a draft-only workflow. It does not grant mailbox or send access.

## Intake contract

Create a reusable, desktop-local intake record with opaque source IDs and these fields:

| Field | Required behavior |
| --- | --- |
| `as_of_date`, `window`, `stage_interpretation` | State when research was current, the time window, and funding eligibility: latest known A-C versus any A-C within the window. |
| `geo`, `sector`, `company_count` | Constrain list and firm-selection context without inferring a preference. |
| `people` | `requested_people_per_company` (default 2) and later-selected opaque person IDs, each with allowed evidence claims. |
| `profile` | Sender claims, each marked user-confirmed and linked to an allowed source ID. |
| `intent`, `ai_angle`, `ask_length`, `voice`, `exclusions` | Bound the purpose, optional AI interest, requested meeting length, voice, and prohibited content. |

Raw profiles, messages, resumes, research excerpts, and personal names remain in the desktop-local
SQLite/snapshot boundary. The trusted desktop-local drafting runtime receives permitted local claim text
and excerpts with their evidence IDs. VM and manager projections receive opaque IDs only.

Direct user claims, including AI interest or building, are approved intake sources without a second
confirmation. Resume-specific assertions require the user to confirm selection before use. Missing,
expired, disallowed, or ambiguous fields are missing inputs.

## Occasion templates

Templates are versioned records with named slots, not freeform prompts. Rendering fails closed when a
required slot is absent or unsupported.

| Template | Required slots | Optional slot | Missing-field handling |
| --- | --- | --- | --- |
| `coffee_chat_ai_interest` | `recipient_name`, `recipient_context`, `sender_background`, `ai_angle`, `ask` | `shared_context` | Park if AI angle or either bridge lacks allowed evidence. |
| `coffee_chat_background_bridge` | `recipient_name`, `recipient_context`, `sender_background`, `ask` | `ai_angle` | Omit the optional angle; park if the background bridge is unsupported. |
| `coffee_chat_research_hook` | `recipient_name`, `research_hook`, `sender_background`, `ask` | `ai_angle` | Park if the hook is stale, copy-disallowed, or non-entailing. |
| `coffee_chat_shared_context` | `recipient_name`, `shared_context`, `recipient_context`, `ask` | `sender_background` | Park if shared context is not explicitly evidenced. |

Every template permits one brief informational coffee-chat ask only. The rendered draft must use the
requested `ask_length`; otherwise it fails. Exclusions remove content, never trigger substitute facts.

## Revision pipeline

Each exact body is immutable. It receives a revision ID, parent revision ID, template version, intake
version, source/evidence manifest hash, and body hash. Suggestions create derived revisions; they never
silently replace the human-authored parent.

```text
typed intake -> template draft -> structural checks -> humanizer draft/audit/final
            -> post-humanizer structural checks -> semantic review -> exact revision gate
```

The humanizer stage retains three private artifacts for every candidate: its draft rewrite, its audit of
remaining AI-writing signals, and its final rewrite. Bind all three to the parent revision, humanizer
skill/version, input hash, and final body hash. The stage should preserve supported specific detail and
voice while removing formulaic cadence, generic significance claims, promotional language, and similar
writing artifacts. Do not copy the external Humanizer skill into this product specification.

The exact-revision gate is mandatory after every mutation, including a human manual edit, a regenerated
draft, or a humanizer result. A revision that changes must receive a new ID and repeat all downstream
checks. Failed revisions remain inspectable privately but cannot become approval or send candidates.

## Checks and independent review

Structural checks are deterministic only for mechanical structure: required slots, allowed evidence-ID
references, word and ask-length bounds, plain-text restrictions, template/version binding, and
revision/hash lineage. They must not claim deterministic factual entailment.

A separate semantic reviewer assesses whether every factual claim is supported by its cited, current,
copy-allowed evidence; whether the research hook is specific; whether the sender bridge is confirmed;
whether there is one appropriate ask; whether exclusions are honored; and whether the copy is useful
rather than generic. It returns a private critique tied to the exact revision under review.

Use independent critics for at most two repair rounds. Each critique proposes a derived revision or a
failure. After the second repair, expose unresolved failures to the human instead of looping or quietly
weakening requirements. Generic name-swap resilience is a required semantic-review criterion.

## Required callable paths for the flow audit

These are capability categories, not invented API names:

1. Desktop-local intake and source-snapshot projection.
2. Versioned template selection and rendering.
3. Draft revision store with immutable parent/derived lineage.
4. Humanizer invocation that returns private draft, audit, and final artifacts.
5. Deterministic structural-check service.
6. Independent semantic-review service with bounded repair orchestration.
7. Approval/send eligibility reader for passed exact revisions only.

The flow audit must choose concrete interfaces, access boundaries, failure codes, and owner processes.
No stage may expose personal data to Git, logs, process arguments, cards, ledgers, or VM sinks.

## Proposed integration seams

Keep the existing campaign, P8 evidence, P11 QA-context, revision, review, and approval tables as the
authoritative product records. Add one migration with orchestration records; do not create a second
prospecting store or duplicate revision model.

- `prospecting_pipeline_run`: opaque run ID, campaign/person/step, exact base revision ID and hash,
  workflow ID/version/manifest hash, state, next stage, repair cycle (`0..2`), timestamps, and a unique
  idempotency key over the exact inputs.
- `prospecting_stage_artifact`: run/stage/cycle, input and output hashes, skill name/version/content
  hash, producer role and job identity, typed decision/failure codes, and creation time. Private bodies,
  critiques, and evidence remain desktop-local; manager projections contain only IDs, hashes, counts,
  states, and failure codes.
- `company_qualification`: campaign/company, `as_of_date`, latest known funding stage and announcement
  date, source observation IDs for both facts, policy hash, decision, and reason. A three-year window is
  computed as three calendar years back from `as_of_date`, with an explicit leap-day rule.
- `candidate_rank`: campaign/company/person, current-role observation ID, fit components, deterministic
  rank, selected flag, and shortfall reason. Eligibility requires a current role in the configured
  Ops/BizOps/Strategy/Chief-of-Staff families and a current valid contact. Select exactly the configured
  number per qualified company, default two, using declared criteria and a stable opaque-ID tie break.
  Do not describe the ordering as response-rate optimization.
- `pipeline_suggestion`: exact parent revision/hash, proposed subject/body hash, origin stage/artifact,
  structural and semantic states, and optional accepted revision ID. It records agent output without
  representing it as a human edit.

Expose these narrow desktop-local service methods, with CLI commands passing only opaque IDs and local
file paths:

1. `start_or_resume(campaign_id, request_id)` validates the intake and snapshots the workflow and skill
   bindings. Reusing the request with different inputs fails with `request_conflict`.
2. `prepare_next(run_id)` writes the one current-stage input artifact under the selected store root.
   It never advances state merely because a file exists.
3. `claim_stage(run_id, stage, input_hash, worker_role)` grants one bounded lease. Researcher,
   fact-checker, drafter, humanizer, and independent critic are distinct declared roles; a producer
   cannot claim its own critic stage.
4. `submit_stage(...)` validates the lease, exact input hash, declared skill binding, typed output, and
   output hash before committing the artifact and next state atomically. A caller cannot submit a
   self-authored human attestation or an independent-review identity.
5. `accept_suggestion(request_id, suggestion_id, expected_parent_revision_id)` is an explicit UI human
   action. It routes the accepted text through the existing `ReviewService.edit_draft` and P11 context
   propagation so structural QA and immutable lineage are retained. Humanizer output never calls the
   human-edit path by itself and never silently replaces a human-authored revision.
6. `resume_parked(run_id, request_id)` reopens only after corrected inputs or an explicit human choice.
   It preserves earlier artifacts and restarts at the first invalidated stage.

Use a generic, versioned outreach-skill workflow whose startup qualification criteria are intake
parameters. Its stage order is researcher -> qualification fact-checker -> two-person ranker -> drafter
-> humanizer -> post-humanization fact-checker -> independent critic -> human review. A failed critic
may return once through drafter and humanizer; the second failed repair parks with exact uncertainty and
shortfall codes. Any new revision, including a manual edit, invalidates later receipts and restarts at
humanizer for that exact hash. Editorial-ready and approval readers must require passing humanizer,
post-humanization fact-check, and critic artifacts bound to the current revision hash.

## Current implementation gaps

- Campaign intake has no dated latest-funding fact or three-calendar-year evaluator. The existing
  `company_stage` token alone cannot establish the startup pilot criterion.
- The review UI creates campaigns and reviews stored people, but it does not launch discovery. Its
  target count is global and does not bind the P8 per-company target of two.
- The UI prepare action renders deterministic P8 templates. The separate personalizer model-turn path
  is not an integrated prepare/model/submit stage in the declared workflow.
- No declared workflow invokes the Humanizer skill, a post-humanization semantic fact-checker, or a
  revision-bound independent copy critic.
- Existing review QA is valuable structural revalidation of stored bindings; its token-overlap check is
  not semantic entailment. Editorial-ready currently has no prerequisite receipt gate.
- Feedback retains immutable human edits and lineage, but automated rewriting is unavailable. Restart
  and feedback-to-repair lineage are therefore manual rather than repeatable through the skill pipeline.
