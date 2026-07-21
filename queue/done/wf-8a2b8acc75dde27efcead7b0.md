---
id: wf-8a2b8acc75dde27efcead7b0
project: kb-ops
action: report:self-lint
target: orgs/kb-ops/output
risk-tier: T1
owner: worker-desktop
claim-token: 4a35049d84682c32
state: done
approval: null
workflow: run-7b0b8de8-268e-4d94-bab3-a3b765101c62
depends-on: []
variant-group: null
role: work
session-id: null
runtime: claude
model: claude-sonnet-5
execution-controller: dashboard
---

## Work order

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

## Result

```kb.canonical-stage-result/v1
{"artifacts":[],"attemptRef":"attempt-a87b25ec-1f9c-4f70-a745-70ab00e3fb76","changed":[{"digest":"5d3f866f3e324f3dc026b2c259ceefb04268a0a985037ef8342ebdd6eb30d30f","path":"orgs/kb-ops/output/self-lint-report-2026-07-21.md"}],"checkpoints":[],"integrationCommit":"75e9b8ce3fe543b255d042a4ba6b273b07b3f2a5","resultHash":"ad5e00bb508f553b2211f668537d4588c6784dd8331875464a806feb8aafc28a","runRef":"run-7b0b8de8-268e-4d94-bab3-a3b765101c62","stageId":"report","summary":"Report written to `orgs/kb-ops/output/self-lint-report-2026-07-21.md`. Summary:\n\n- **Health: attention-needed (minor)** — no credentials, secrets, or committed absolute paths found within scope; `orgs/kb-ops/_index.md` links all resolve.\n- **Scope limitation**: this run's work order restricted reads to `orgs/kb-ops`, narrower than the general self-lint-report definition (which also expects `queue/`, `dashboards/`, `ledgers/`, and full top-level link resolution). Those three categories were marked **not scanned** rather than guessed. One incidental read of the top-level `_index.md` happened before I fully resolved the scope conflict — disclosed in the report, no data copied out.\n- **Finding**: `orgs/kb-ops/STATE.md` is stale (dated 2026-07-16, still says \"nothing yet\") despite the daily heartbeat cadence expecting it to be updated each run — left untouched since write scope was `output/` only.\n- Confirmed read-only: only the one new report file was written; nothing else touched."}
```
