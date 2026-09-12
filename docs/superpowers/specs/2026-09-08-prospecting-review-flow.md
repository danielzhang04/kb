# Prospecting review flow

Status: independently reviewed; bounded implementation in progress. Implements the user's September 8 scope.
This revises the September 4 P7-UI amendment's read-only draft limitation and frozen-code
assumption. It does not authorize sending, change approval authority, or rewrite applied migrations.

## Outcome

One small desktop app takes an industry-chat or job-outreach brief through candidate selection,
personalized draft review, feedback and an explicit sending plan. The kb dashboard remains the
agent platform and links to this app; neither app duplicates the other's engine or navigation.

## Context and alternatives

The existing store and P1-P8 components provide leads, evidence, fit assessments, immutable
revisions, approval scopes and execution checks. The old UI is unimplemented. Workflow prerequisites,
campaign identity, stage adaptation and cadence need repairs before their UI controls can work.
Use the existing owners and schema through a small shared desktop application service. A second
pipeline/database would duplicate the hard parts. A read-only viewer alone misses draft feedback.

Avoid coupling this app's build or startup to the other terminal's dashboard toolchain. Prefer a
self-contained local static interface with no runtime CDN, external fonts, analytics or new service
dependency. Use existing frontend tooling only if inspection establishes a concrete benefit.

## Information architecture

Five primary destinations, with a campaign selector and a persistent next-action summary:

| Destination | Question answered | Main action |
| --- | --- | --- |
| Campaigns | What am I trying to do, and what is ready or blocked? | Create or resume a brief |
| People | Who meets the brief, and why? | Inspect fit/evidence and choose candidates |
| Drafts | Would I actually send this message? | Edit, give feedback, or mark ready for review |
| Schedule | Which approved message is due, and what can run? | Inspect the exact sending plan |
| Activity | What happened, what needs me, and what resumes next? | Resolve a specific blocker |

Companies, sender context and source links appear in relevant detail panels instead of separate
top-level destinations. Tables support search, filters and keyboard selection. Draft review uses
list/detail layout with message preview, editable revision, evidence and feedback side by side.
Empty states offer the first meaningful action. Failure states explain the next step in user terms.

## Brief and candidate behavior

Brief fields map to the existing compiler: purpose, industry, company/person geography, role,
seniority, company filters, target count, research lanes, budget, tone, conversation ask and duration.
Prior career, education, must-have and preferred fit criteria remain local rich text and use P8.
Never infer current preferences from old workbooks. Their structure informs synthetic cases:
industry conversations with partners/principals; strategy or business-operations job outreach;
multiple contacts per company; several geographies; prior career and alumni context; follow-ups.

New briefs receive distinct campaign IDs. Resuming a saved brief preserves its identity and policy
version. Explicit request IDs make retried creation idempotent. Invalid or ambiguous brief input
returns actionable local field errors, without advancing workflow state or issuing vendor calls.
Selections, candidate fitness and draft counts always scope to the selected campaign.

The candidate view distinguishes discovered, qualified, contactable and selected. Evidence links
open only validated HTTP(S) destinations. Explain shortfalls and exhausted budgets; do not fill
the target count by quietly weakening the criteria or treating unknown email quality as verified.

## Draft review and feedback

Default autonomy is review required. Drafting and sending graduation are separate controls and
are never changed by agents or metrics. This release does not implement self-send graduation.
Display actual stored subject/body and the evidence used for personalization. Suggestions must
not invent shared experiences, affiliations, achievements or sender claims.

Edits create a new immutable revision linked to its parent. Feedback is local structured state
plus optional local text, linked to the reviewed revision and campaign. Preserve the original and
the user's corrections. Marking a draft ready is editorial state only; it cannot create a verified
send approval. A changed revision must not inherit an earlier revision's send authority.

The first feedback loop is visible and bounded: one requested revision attempt, then return it to
review. Model failures, missing evidence or conflicting instructions stop with a reason. A later
VM feedback coordinator sees opaque IDs/statuses; raw feedback and draft content stay local under
the project contract. Do not claim a VM model can personalize PII it is forbidden to receive.

## Scheduling and runtime boundaries

Show cadence, recipients, exact revision, mailbox, send window, timezone, caps and approval state
before any scheduling action. Scheduling reads the saved campaign policy; never manufacture extra
follow-ups. Live actions go through the existing deterministic desktop executor and applicable
human approval channel. Missing adapters/approval channels visibly block dependent actions.

Development jobs can survive desktop network loss on temporary VM leases. Live local-file or
mailbox operations pause while the desktop is unavailable. On reconnect, reconcile existing run
IDs and execution receipts before resuming. No duplicate launch and no catch-up send burst.

The app binds only loopback, validates Host, uses a short-lived bootstrap session and CSRF checks,
rejects malformed request framing, and serves no external assets. PII lives only in the desktop
store/snapshot/browser boundary. No PII, request body, token or raw exception enters logs, process
arguments, Git or a VM job. HTTP handlers call typed application methods, never arbitrary commands.

## Acceptance sequence

1. Prove repaired compiler/prerequisites and saved campaign isolation with real owner contracts.
2. Create two synthetic briefs through the app; restart and resume one without duplicate state.
3. Import synthetic candidates through the existing ingestion path; inspect sources and fit.
4. Prepare drafts, edit one and record feedback; verify revision history and approval invalidation.
5. Inspect a two-touch sending plan with explicit blocked/approved states; fixture executor only.
6. Exercise retry, cancellation, offline resume, suppression, changed revision and expired approval.
7. Review visual layout and keyboard flow in a browser; verify local-only HTTP security behavior.
8. Use a chosen real local brief for non-sending review only after the synthetic flow is sound.

Independent review must trace actual schema/callers and reject decorative controls, fabricated
success, self-issued grades and unverified capability parity. Existing historical gate receipts
remain historical; edits do not silently update or re-bless their recorded hashes.

## Reviewed implementation boundary

One typed `review_service.py` owns campaign-scoped projections and review mutations. The UI
does not build independent joins over finder, eligibility, contacts and selection tables.
An additive review migration records parent lineage, feedback and editorial state; existing
revision and approval owners retain their contracts. Human edits cannot inherit passing QA.
If an edit fails validation, preserve it as a local review candidate and explain the blocker.

`review_app.py` serves one bundled HTML interface over loopback. Campaign creation and draft
review are the initial mutations. Schedule and Activity remain truthful read views until their
specific executor actions are integrated. A requested model revision may be pending or blocked;
recording a request is never described as producing a new draft. No generic command endpoint.

The HTTP contract requires exact Host authority, expiring one-use bootstrap, session cookies,
CSRF on writes, bounded JSON/content length, rejected ambiguous framing, fixed safe errors and
no request/body logging. No external assets or runtime dependency on the main kb dashboard.
