---
id: email-triage
project: kb-ops
title: Email triage (draft-only)
profile: gmail-triage
stages:
  - id: triage
    title: Triage the inbox into the four-tier taxonomy
    action: research:email-triage
    target: orgs/kb-ops/output
    riskTier: T2
---

# Email triage — draft-only chief-of-staff sweep

You are triaging the operator's Gmail inbox. This is a **read + label + DRAFT** task. You have the
`gmail-triage` profile: you may search Gmail, read message content, list and apply labels, and create
Gmail **drafts**. You have **no send capability and must never send an email** — every reply you produce
is a draft the operator reviews and sends by hand. If you ever find yourself wanting to send, stop and
record it in the report instead.

## Taxonomy — classify every triaged thread into exactly one tier

Ported from the ECC chief-of-staff. Assign each thread the single highest-applicable tier:

1. **skip** — automated noise, newsletters, receipts, notifications with no action and no signal.
   No label, no draft; count it and move on.
2. **info_only** — a human wrote something the operator should read, but it needs no reply and holds no
   scheduling. Apply the `triage/info` label. No draft.
3. **meeting_info** — contains scheduling content (a proposed time, an invite, a reschedule, a location).
   Apply the `triage/meeting` label and extract the meeting facts (who / when / where / what) into the
   report. Draft a confirmation reply ONLY if a reply is clearly expected.
4. **action_required** — a person is waiting on the operator for a decision, answer, or deliverable.
   Apply the `triage/action` label and **draft a reply** in the operator's voice: concise, direct,
   no invented commitments. Leave every draft unsent.

## Output — one report per run

Write a Markdown triage report to `orgs/kb-ops/output/email-triage-YYYY-MM-DD.md` (use today's date).
The report MUST contain:

- A summary line: counts per tier (skip / info_only / meeting_info / action_required).
- For every non-skip thread: the tier, the sender, the subject, a one-line why, the label applied, and
  — for action_required and drafted meeting_info — the draft id or a note that a draft was created.
- A **Follow-through checklist** section the operator works down:
  - [ ] Review every draft under Drafts and send or edit the ones you agree with.
  - [ ] Confirm the labels match your read of each thread.
  - [ ] Add any meeting_info times to the calendar (this workflow does not touch the calendar).
  - [ ] Note anything ambiguous the triage could not classify with confidence.

## Rules

- DRAFT ONLY. Never send. Never delete. Never archive without a label.
- Do not invent facts, commitments, dates, or names. If a thread is ambiguous, tier it conservatively
  (prefer info_only over action_required) and flag it in the report.
- Handle no credentials as objects; the Gmail connection is ambient and read/label/draft-scoped.
