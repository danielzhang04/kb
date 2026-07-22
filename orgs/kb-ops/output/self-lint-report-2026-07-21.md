---
id: self-lint-report-2026-07-21
project: kb-ops
generated: 2026-07-21
generator: self-lint-report (scanner profile, read-only)
---

# Self-lint report — 2026-07-21

## Summary

**Overall health: green.** No stale/orphaned working-set cards, no broken relative links in the
two scoped index files, and no actual credential material found in the scanned trees. Two
low-severity items are worth a look: the two published dashboards are a few hours stale relative
to the live queue state, and a couple of tracked task cards embed the operator's absolute local
filesystem path in plain instructional text (not a secret value, but still a committed local
path). Nothing here blocks or requires urgent action.

## Findings

### 1. Queue (`queue/`) — stale/orphaned entries
- **`queue/working/`**: empty (only `.gitkeep`). No working-set cards, so nothing can be stale by
  definition. No follow-up needed.
- **`queue/inbox/`**: 8 cards present. Four are T3 human-gate approvals (OAuth setup for the
  Google Workspace MCP server, cards `6a5d6b23-05204b15/-12ddfee2/-17e8d1be/-4c98aec0`) that have
  been pending since 2026-07-19 per `dashboards/brief-2026-07-20.md`, plus one T3 decision card
  (`6a5e482a-3b8707b5`, budget-gate) and one T2 gate-flip (`6a5c7274-635d84bf`) — all explicitly
  human-owned per `orgs/kb-ops/contract.md`, so their age reflects waiting-on-Daniel, not a stuck
  automation. **Suggested follow-up:** none required; these will naturally clear once actioned.
- **Anomaly, already known:** card `6a5dbb3e-295a9d2b` (2026-07-20's `nightly-review`) sits in
  `queue/inbox/` with `state: done` — it was never moved to `queue/done/`. Cosmetic (inflates the
  inbox count by one); already called out by the 2026-07-21 06:09 UTC dashboard run itself.
  **Suggested follow-up:** move the file to `queue/done/` on the next nightly pass, or add a
  small cleanup step to the cadence that relocates `state: done` cards found outside `done/`.
- **`queue/archived/`**: one entry (`wf-57e9c87bf8df8dfb7062cd92.md`), a permanently-parked run
  that was refused pre-execution by the restrictedIntent policy scan, correctly recorded as
  superseded by the later successful run. No orphaning — it's in the right place. No follow-up.

### 2. Dashboards / ledgers freshness
- **`dashboards/executive.md` and `dashboards/handover.md`** were generated 2026-07-21 06:09 UTC
  and report queue counts `inbox 8 / working 4 / done 54`. The live queue right now reads
  `inbox 8 / working 0 / done 59` — the 4 atlas conversation-rules cards (`14eb8f69-*`) that were
  `working/` at generation time have since been graded and moved to `done/`. This is expected
  drift for a point-in-time snapshot, not malformed data, but the dashboards are stale relative
  to current queue state. **Suggested follow-up:** re-run the `nightly-review` cadence (or the
  dashboard-generator step alone) to refresh the snapshot before it's relied on for a decision.
- **`ledgers/`**: all TSV files inspected (`cost/`, `dispatch/`, `activity/`, `grades/`) are
  well-formed — consistent column counts, parseable timestamps, most-recent rows dated
  2026-07-21 (today), matching the current date. One stylistic inconsistency: `cost/*.tsv` files
  carry no header row while `activity/*.tsv` and `grades/*.tsv` do. Not a defect (consistent
  within each ledger type across all dates checked), but worth normalizing if a schema-checker is
  ever added. **Suggested follow-up:** none urgent; optionally add a header row to `cost/*.tsv`
  for consistency. `ledgers/audit/dashboard-audit.ndjson` rows are also well-formed JSON.

### 3. Broken relative links
- **Top-level `_index.md`**: of the links inside this report's read scope, `queue/` and
  `dashboards/` both resolve. `ledgers/` (linked from the "System" section) also resolves. Links
  to `orgs/faceless-youtube/_index.md`, `orgs/atlas/_index.md`, `skills/`, `governance/`,
  `memory/`, `docs/specs/`, and `docs/plans/` fall outside this scan's declared read scope
  (`queue`, `dashboards`, `ledgers`, `_index.md`, `orgs/kb-ops/_index.md`, `orgs/kb-ops/**`) and
  were not checked. **Suggested follow-up:** none from this run; a future scan with a wider read
  scope could cover the remaining project indexes.
- **`orgs/kb-ops/_index.md`**: all links (`STATE.md`, `contract.md`, `HEARTBEAT.md`, `raw/`,
  `wiki/`, `output/`) resolve to existing files/directories. No broken links found.

### 4. Sign-in material / absolute local paths
- No credential-shaped values (API keys, tokens, private-key blocks) were found in the scanned
  trees. A few matches for words like `api_key`/`access_token`/`refresh_token` were inspected and
  are all documentation references to environment-variable *names* (e.g. `GEMINI_API_KEY`,
  `ELEVENLABS_API_KEY`) or a description of an OAuth flow step — no actual secret values are
  present.
- **Absolute local path committed in tracked files:** `queue/inbox/6a5d6b23-17e8d1be.md` and
  `queue/inbox/6a5d6b23-4c98aec0.md` each contain a Windows absolute path under the operator's
  user profile (`C:\Users\<user>\youtube-uploader-mcp\config\...`) as part of their OAuth-setup
  instructions. This is a path reference, not a leaked value, but it does embed the operator's
  local username in a tracked file. **Suggested follow-up:** consider rephrasing these
  instructions to use a relative/env-var path instead of the literal local path, next time either
  card is touched.

## Read-only confirmation

This run made exactly one filesystem change: writing this report to
`orgs/kb-ops/output/self-lint-report-2026-07-21.md`. No other file was created, edited, moved, or
deleted; no command was run against the repo, network, or any external system.
