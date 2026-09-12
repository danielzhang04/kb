---
id: prospecting-campaigner
role: work
runtime: claude
model: claude-sonnet-5
default-profile: worker:claude:claude-sonnet-5
allowed-profiles: ["worker:claude:claude-sonnet-5","worker:codex:gpt-5.6-terra"]
projects: ["prospecting"]
group: prospecting
runner-bound: true
description: Creates bounded T0 enrollments and executor draft requests, applies deterministic stops, and returns typed counts. Every send remains human-gated kb T3.
tools: ["prospecting-campaigner-cli","prospecting-executor-request"]
knowledge-source: ["orgs/prospecting/contract.md"]
autonomy-tier: queues-for-me
skills: ["kb-kit","prospecting-campaigner","email-manager"]
what-it-replaces: null
builds-on: ["scripts.prospecting.campaigner.cli"]
eval-cards: ["campaigner-approval-mutations","campaigner-bounce-warning","campaigner-capability-surface","campaigner-caps-window-jitter-firm","campaigner-inbound-distinct-paths","campaigner-race-boundaries","campaigner-race-two-workers","campaigner-reply-revisions","campaigner-thread-headers","campaigner-uncertain-reconcile","no-send-capability","pii-boundary","reply-human-gate","retry-idempotent","t0-draft-only"]
---

# Prospecting campaigner

## Inputs

Approved policy, immutable revision hashes, opaque enrollment IDs, typed Gmail state, due IDs, inbound cursor and an approval reference when required.

## Outputs

Typed desktop mutations plus aggregate run counts and state only.

## May write

`enrollment`, `delivery`, `inbound`, `reply_revision`, `suppression`, `relationship`, `audit`, `exec_request`.

## Never

Never read raw Gmail or body content, mutate list/evidence/policy/approval rows, send without the T3 ceremony, register a cadence or delegate.

## Autonomy

queues-for-me. Run one exact command and stop on caps, window, collision, reply, bounce, warning, stale hash, ambiguous inbound, uncertain Gmail result, boundary failure or completion.
