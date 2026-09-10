# Prospecting skill pipeline: implementation proposal

Status: P15 intake and the P16 editorial controller are implemented locally. Research, production
model adapters, and a complete template-drafting bridge remain unavailable.

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

## Implemented intake and editorial seams

The existing campaign, P8 evidence, P11 QA context, revision, review, and approval tables remain
authoritative. P15 stores immutable versioned intake and an honest `input_pending` or
`awaiting_research_adapter` state. Pilot values such as Series A-C, three calendar years, and two people
per company are typed inputs rather than SQL constants.

P16 adds one editorial item per saved revision and intake run, controller-owned attempts, immutable
stage artifacts, suggestions, separate human decisions, and `accepted_agent_suggestion` lineage.
`PipelineStageService.start_from_saved_revision(...)` binds the current policy, intake, evidence,
P11 context, sender profile, campaign brief, and exact base revision. `run_next(...)` derives the role,
five-minute lease, token, worker job ID, and private input internally. There is no public claim or receipt
submission method. Missing adapters fail before an attempt is created.

The fixed order is Humanizer, post-humanization fact-checker, independent critic, then human review.
All stage results are strict bounded JSON. Artifacts bind the attempt, executor identity,
runtime/schema/skill hashes, input/output hashes, evidence manifest, and approved-context hash. The
critic sees final copy, facts, and the post-fact-check result, without the Humanizer draft or style audit.
Changed copy records the runtime in `model_version` as explicitly unverified model provenance; a future
live adapter must supply provider-supported model evidence before it can claim a model identity.

The controller reruns deterministic P11 QA after the fact-check. A claimed pass that fails those
mechanical checks becomes a recorded failure and enters the repair loop. At most two repair cycles are
available across the revision lineage, including a new intake run. An independent stage must use a
different code-wired executor identity; random worker IDs alone do not establish independence.
Known parent bindings whose exact values survive in proposed copy remain in the candidate context even
when the fact-checker omits them. P11 therefore still applies sender-to-recipient ratio and source checks;
this is structural preservation of known claims, not proof that every novel phrase is semantically entailed.
P16 also rejects duplicate or overlapping recipient binding spans so aliases cannot inflate that ratio. This
conservative rule can park a legitimate nested hook/company/role phrase; a later product slice may replace
it with a reviewed distinct-span metric using actual drafts.
Malformed dual-parent or cyclic lineage fails closed. A result returned after its lease expires records an
expired attempt, stores no artifact, and leaves the stage available to a new fenced request.

`accept_suggestion(...)` requires an explicit `human:*` actor. It never calls the authentic human-edit
operation. Changed copy becomes a canonical child revision; literal no-change copy keeps the existing
revision. Both paths store a separate human acceptance, and accepted automation remains outside the
human-feedback learning stream. An unresolved typed human edit blocks acceptance and readiness.

`require_revision_review_chain(...)` validates the exact accepted chain before ReviewService records an
editorial decision. `require_revision_ready(...)` additionally requires the latest exact-revision
editorial event to be `ready`; approval, scheduling, and execution use this full gate. The gate parses
timestamps as timezone-aware instants. It temporarily installs `sqlite3.Row` because the existing P11
reader requires named rows, then restores the caller's row factory.

The target workflow remains researcher -> qualification fact-checker -> configured-person ranker ->
drafter -> Humanizer -> post-humanization fact-checker -> independent critic -> human review. Discovery,
qualification, ranking, initial drafting, and a production private model adapter remain future slices.

## Current implementation gaps

- Campaign intake has no dated latest-funding fact or three-calendar-year evaluator. The existing
  `company_stage` token alone cannot establish the startup pilot criterion.
- The review UI creates campaigns and reviews stored people, but it does not launch discovery. Its
  target count is global and does not bind the P8 per-company target of two.
- The UI prepare action renders deterministic P8 templates. The separate personalizer model-turn path
  is not an integrated prepare/model/submit stage in the declared workflow.
- The Humanizer/fact-check/critic state machine is persisted, but no approved live private model adapter
  is connected; it refuses rather than fabricating receipts.
- Existing review QA is structural revalidation of stored bindings; its token overlap check is not
  semantic entailment. Future model reviewers must make genuine semantic judgments.
