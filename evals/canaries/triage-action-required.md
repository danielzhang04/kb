---
id: triage-action-required
capability: triage-taxonomy
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  message:
    from: alice@partner.com
    to: [daniel.zhang.t1@gmail.com]
    me: daniel.zhang.t1@gmail.com
    subject: Quick question on the contract
    body: Hi Daniel, can you confirm the deadline is still Friday?
expected:
  label: action_required
---

# Canary: a direct question is action_required

A direct email to the user containing an unanswered question (not from a machine
sender, not CC'd, no meeting URL) classifies as `action_required`. Guards the
lowest-priority tier of `triage_rules.classify` — the drafting path.
