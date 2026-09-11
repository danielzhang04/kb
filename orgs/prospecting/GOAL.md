# prospecting — GOAL
_Ruled: 2026-09-07_

## North star
A desktop-local prospect list-builder + outreach system for Daniel: given a target ask (firms,
titles, fit criteria), it discovers candidates, researches them from public sources, scores
person-level fit/affinity, and delivers only people with confidently found emails, each row
carrying evidence-backed reasons and a personalized blurb — feeding campaigner send later.

## Success conditions
- P1-P6 (discovery, enrichment, copy, campaigns, fill loop) — PASSED: real Snov run on
  `camp_c57b52cc14d54104` delivered 22 people / 13 firms with valid emails (2026-09-05).
- P8 affinity (fit-first scoring + research) build gate — PASSED: 953/953 tests, HEAD 52067386
  (unpushed, `claude/prospecting-p8`).
- Gate P8-B (deliverable_v2 in Datasette: every row has score, cited strong/medium signal, blurb,
  zero credits on unscored candidates) — PARTIALLY PASSED: batch 1 (10 profiles) green on all
  acceptance criteria live-tested against the real store, 2026-09-07.
- Gate P8-B batch 2 (10 investing-titled profiles) — OPEN: awaiting Daniel's "batch 2" go-ahead.
- P3 real sender-profile.json, P4 live drafts, P5 VM run, P6 cadence blocks + live T1, P7-UI
  approval — OPEN, not yet gated.

## Invariants
- Deliver only people with confidently found emails; substitute prospect then firm rather than
  ship a shallow row (Daniel's standing rule, 2026-09-04).
- Names, emails, phones, profile URLs, notes, message bodies live only in desktop-local SQLite /
  dedicated Chrome profile / snapshot dir — never in git, cards, logs, stdout, or any VM sink.
- No model in scoring/ranking/eligibility; the only model call is ask-compile, file-mediated and
  operator-approved before it can affect selection.
- Frozen-file rule: P8 touches no P1-P6 file except the one approved P5 ask-grammar fold
  (`compile_ask.py`, three new line prefixes + `fit_text`).
- Every Gmail send is T3 risk tier and requires verified human approval; P8 has no enabled live
  send adapter.
- LinkedIn assisted-lane cap (40 loads/rolling 24h) is shared via the existing `audit` table —
  never a new budget. Live run used Daniel's own Chrome (his explicit override of the dedicated-
  profile rule), not the agent's.

## Governing docs
- `docs/superpowers/specs/2026-09-06-prospecting-affinity-design.md` (r4, approved) — branch
  `claude/boss-2026-09-02`
- `docs/superpowers/plans/2026-09-06-prospecting-p8-affinity.md` (r2) + `…-p8-CODE-REVIEW.md`
  (three confirm passes) — branch `claude/boss-2026-09-02`
- `orgs/prospecting/doctrine.md`, `orgs/prospecting/runbook-p8.md`, `orgs/prospecting/contract.md`
  — branch `claude/prospecting-p8`
- ops `handoffs/2026-09-07-prospecting-p8-live-tested.md`
