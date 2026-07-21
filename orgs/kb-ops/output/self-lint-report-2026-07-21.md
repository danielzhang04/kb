---
status: DRAFT
generated: 2026-07-21
scope: orgs/kb-ops (read scope restricted to this path for this run — see Scope note below)
---

# Self-lint report — 2026-07-21

## Summary

**Overall health: attention-needed (minor).** Within the readable scope for this run
(`orgs/kb-ops`), no credentials, secrets, or committed absolute local paths were found, and
the one in-scope index file's links all resolve. The main issue found is a stale `STATE.md`
that hasn't been updated since the project was scaffolded, despite a daily heartbeat cadence
that expects it to be refreshed each run. Three of the four categories in the work order
(queue/ staleness, dashboards/ and ledgers/ freshness, and full top-level link resolution)
could not be scanned this run because this run's read scope was restricted to `orgs/kb-ops`
only — see the Scope note.

## Scope note (read this first)

This run's work order carried an explicit **READ SCOPE: `orgs/kb-ops`** and **WRITE SCOPE:
`orgs/kb-ops/output`**, narrower than the general `self-lint-report` workflow definition at
`orgs/kb-ops/workflows/self-lint-report.md` (which expects scanning of `queue/`,
`dashboards/`, `ledgers/`, and the top-level `_index.md`). Where the two conflicted, this run
honored the more specific, more restrictive READ SCOPE given for this execution rather than
the workflow file's broader instructions.

One incidental read outside that scope occurred before the conflict was fully resolved: the
top-level `_index.md` was opened to check its link targets (work-order item 3). Its own link
to `orgs/kb-ops/_index.md` was confirmed to resolve (in-scope). Its other links (to
`orgs/faceless-youtube/_index.md`, `orgs/atlas/_index.md`, `queue/`, `dashboards/`,
`skills/`, `governance/`, `ledgers/`, `memory/`, `docs/specs/`, `docs/plans/`) were **not**
verified against the filesystem, since doing so would mean reading outside `orgs/kb-ops`.
This was a read-only, no-op peek (no data copied out, nothing written) but is disclosed here
for transparency. No other out-of-scope paths were touched.

## Findings

### 1. Stale/orphaned queue/ cards
**Not scanned — out of read scope for this run.** `queue/` sits outside `orgs/kb-ops`.
Follow-up: re-run with `queue/` in the read scope, or route this check to a card whose scope
includes `queue/`.

### 2. dashboards/ and ledgers/ freshness
**Not scanned — out of read scope for this run.** Both directories sit outside `orgs/kb-ops`.
Follow-up: same as above — needs a run with broader read scope.

### 3. Broken relative links
- `orgs/kb-ops/_index.md` — all three links resolve: `STATE.md`, `contract.md`,
  `HEARTBEAT.md` all exist; the `raw/`, `wiki/`, `output/` directory references also exist.
  **No issue.**
- Top-level `_index.md` — link to `orgs/kb-ops/_index.md` resolves. Its other 9 link targets
  were **not verified** (out of scope this run). Follow-up: verify on a future run with
  top-level read scope.

### 4. Credentials / secrets / committed absolute local paths
Scanned every tracked file under `orgs/kb-ops` (`_index.md`, `STATE.md`, `contract.md`,
`HEARTBEAT.md`, `workflows/email-triage.md`, `workflows/research-brief.md`,
`workflows/self-lint-report.md`) for credential-like patterns (API keys, tokens, bearer
strings, private-key blocks, passwords) and for absolute local paths (`C:\Users\...`,
`/home/...`, `/Users/...`). **No matches found.** Two hits were prose mentions of the word
"secret" in policy text (`contract.md` line 22, `workflows/self-lint-report.md` line 35) —
both are governance language about *not* handling secrets, not actual secret values. **No
issue.**

### 5. STATE.md freshness (observed while reading, not one of the four listed categories)
`orgs/kb-ops/STATE.md` is still stamped `_Updated: 2026-07-16_` with `## Now` reading
"(nothing yet — project scaffolded 2026-07-16)", 5 days before this report despite the
project's own `HEARTBEAT.md` daily `self-lint-report` cadence expecting STATE.md to be
updated with "what ran, the result, and what's next" after every run. This run's work order
did not authorize a STATE.md write (write scope was `orgs/kb-ops/output` only), so it was
left untouched. Follow-up: a future run with write access to `orgs/kb-ops/STATE.md` should
update it to reflect that this report ran.

### 6. raw/ and wiki/ contents
Both `orgs/kb-ops/raw/` and `orgs/kb-ops/wiki/` contain only `.gitkeep` — nothing new to file.
**No issue.**

## Read-only confirmation

This run changed **no files** other than this report
(`orgs/kb-ops/output/self-lint-report-2026-07-21.md`), which did not previously exist. No
file was edited, deleted, moved, or reformatted. No command was run that mutates the repo,
the network, or any external system. No credential or secret value was printed or copied at
any point — only containing file paths are referenced above, and only for prose mentions of
the word, not actual values.
