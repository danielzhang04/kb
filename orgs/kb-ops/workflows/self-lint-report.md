---
id: self-lint-report
project: kb-ops
title: Self-lint report (read-only health scan)
profile: producer
readScope:
  - queue
  - dashboards
  - ledgers
  - _index.md
  - orgs/kb-ops/_index.md
stages:
  - id: report
    title: Scan the repo for hygiene issues and write a read-only report
    action: report:self-lint
    target: orgs/kb-ops/output
    riskTier: T1
---

# Self-lint report — read-only repository health scan

Produce a **read-only** hygiene report on the `kb` repository. This is the Wave-A supervised live-fire
target: a genuinely low-risk (T1), no-external-action cadence. You write exactly **one** report file and
change nothing else.

## Profile / capability note

This definition names the server-owned `producer` profile (`Read`, `Glob`, `Grep`, `Write`, `Edit`,
`Bash`). Use **only** `Read` / `Glob` / `Grep` to inspect the repo and a single `Write` to author the
report. Do **not** edit, delete, move, or reformat any existing file; do **not** run any command that
mutates the repo, the network, or any external system. The engine bounds accepted changes to this stage's
write scope (derived from the `orgs/kb-ops/output` target) regardless of the tool cap — but the intent here
is a pure scan-and-report.

## What to scan (read-only)

1. Stale or orphaned entries under `queue/` (cards in `working`/`inbox` with no recent activity).
2. `dashboards/` and `ledgers/` freshness — obviously stale or malformed rows.
3. Broken relative links in the top-level `_index.md` and `orgs/kb-ops/_index.md`.
4. Any tracked file that looks like it holds sign-in material (tokens, keys) or an absolute local path
   that should not be committed (report the path only — never echo the suspected value).

## Output

Write the report to `orgs/kb-ops/output/self-lint-report-YYYY-MM-DD.md` (today's date). It MUST contain:

- A one-paragraph summary (overall health: green / attention-needed).
- A findings list: each finding is a file/area, a one-line description, and a suggested follow-up. If there
  are no findings in a category, say so explicitly.
- An **explicitly read-only** note confirming no files other than the report were changed.

## Rules

- Read-only outside the single report file. No external action, no network, no money movement, no
  outward release of anything.
- Never print or copy a suspected sensitive value — report only the containing path.
- If you cannot complete the scan, write a short report saying what blocked you and stop. Do not guess.
