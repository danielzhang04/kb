# Self-lint report — 2026-07-23

_Read-only repository health scan. Scope: `queue/`, `dashboards/`, `ledgers/`, top-level `_index.md`,
`orgs/kb-ops/_index.md`, and the `orgs/kb-ops` tree. Tools used: Read, Glob, Grep only — no Bash, no Edit._

## Summary

**Health: attention-needed (minor).** No active credentials or secret values were found inside the
declared read scope — an initial keyword sweep surfaced 14 files, but every match resolved to narrative
mentions of env-var *names* (e.g. `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`) or the routine `claim-token`
card field, not leaked values. The scan did turn up a real process anomaly worth a human look: two
`self-lint-report` cards (`wf-0f499ff9b3fd56e31e58bbe2`, `wf-d46c12d54d0f85d94fd4e8c9`) sit in
`queue/inbox/` with `state: inbox` and no `## Result`, even though `ledgers/audit/dashboard-audit.ndjson`
records both of their governed runs (`run-7d9a9788-...`, `run-c829f02e-...`) as launched — and those
launch timestamps are dated **2026-07-24**, one calendar day ahead of today (2026-07-23). Combined with
three long-standing stale done-in-inbox cards and two committed absolute local paths, nothing here is
urgent or blocking, but several items are worth a look at the desk.

## Findings

### 1. Queue — stale / orphaned entries

- **Two orphaned self-lint-report cards, never closed out.**
  `queue/inbox/wf-0f499ff9b3fd56e31e58bbe2.md` (workflow `run-7d9a9788-03dd-4933-9280-3c6e2ba06bb8`) and
  `queue/inbox/wf-d46c12d54d0f85d94fd4e8c9.md` (workflow `run-c829f02e-225b-4f14-ac48-9aa2b28b82f6`) both
  carry the identical `report:self-lint` work order, `state: inbox`, and no `## Result` section at all.
  `ledgers/audit/dashboard-audit.ndjson` shows both runs were formally launched via
  `control-run-launch` events — meaning execution started but the card was never updated or moved to
  `queue/done/`. **Suggested follow-up:** confirm whether these two runs actually produced output (check
  for corresponding `self-lint-report-*.md` files / stage-result records) and either backfill their
  `## Result` + move to `queue/done/`, or close them as duplicates of this run if they never completed.

- **Timestamp anomaly on the same two runs.** The `control-run-launch` rows for `run-7d9a9788` and
  `run-c829f02e` in `ledgers/audit/dashboard-audit.ndjson` are stamped `2026-07-24T01:56:...Z` and
  `2026-07-24T02:54:...Z` respectively — one day ahead of today's date (2026-07-23). The two immediately
  preceding `auth` rows are similarly stamped 2026-07-23T23:34 and 2026-07-24T01:56. **Suggested
  follow-up:** check the clock on whichever host writes `dashboard-audit.ndjson` (or confirm this is
  legitimate late-night UTC rollover, in which case no action needed) — a systematically skewed audit
  clock would undermine any freshness reasoning built on this ledger.

- **Three "done" cards stuck in `queue/inbox/`, carried three nights running.**
  `6a5dbb3e-295a9d2b.md`, `6a5f0cef-53d31df4.md`, and `6a605e40-ca81f0c8.md` all have `state: done` in
  their frontmatter but were never moved to `queue/done/`. Each night's `nightly-review` card
  self-reports this same anomaly (carried forward 2026-07-20 → 2026-07-21 → 2026-07-22) without fixing
  it, and `dashboards/executive.md` also flags it. **Suggested follow-up:** a one-time cleanup pass to
  move all three files from `queue/inbox/` to `queue/done/` (pure filesystem move, no content change)
  would clear a repeat finding that's now shown up in at least four separate reports.

- No stale cards found in `queue/working/` — the directory is currently empty (only `.gitkeep`). No
  cards in `queue/approvals/` either.

### 2. Dashboards / ledgers — freshness

- **`dashboards/executive.md` / `handover.md` are stale relative to live queue state** (expected drift,
  not an error). Both were generated 2026-07-23 06:10 UTC and report `inbox 13 / working 1`; live state
  at scan time is `inbox 15 / working 0` — the delta is explained by the two orphaned self-lint cards
  above (added after generation) and the in-flight nightly-review card (`6a61b00f-5d0917c7`, confirmed
  completed and filed under `queue/done/`). **Suggested follow-up:** none required — this is normal
  staleness for a point-in-time snapshot — but worth knowing before treating the dashboard counts as
  current.
- **`ledgers/activity/` and `ledgers/grades/`** have no rows for 2026-07-22 or 2026-07-23; the latest
  files are dated 2026-07-21. Likely just no Inspector grading activity on those nights rather than a
  gap in the write path. **Suggested follow-up:** none — informational only, flag if it persists once
  more cadence work resumes.
- **`ledgers/cost/` and `ledgers/dispatch/`** both have rows through today (2026-07-23) and no malformed
  rows were found — all TSVs have consistent column counts and parse cleanly.
- No malformed rows found in `ledgers/audit/dashboard-audit.ndjson` beyond the timestamp anomaly noted
  above (§1) — every line is valid JSON with a consistent `ts`/`action` shape.

### 3. Broken relative links

- **None found.** Every link in the top-level `_index.md` resolves: `orgs/faceless-youtube/_index.md`,
  `orgs/kb-ops/_index.md`, `orgs/atlas/_index.md`, `queue/`, `dashboards/`, `skills/`, `governance/`,
  `ledgers/`, `memory/`, `docs/specs/`, and `docs/plans/` all exist and contain files.
- **None found.** All four links in `orgs/kb-ops/_index.md` resolve: `STATE.md`, `contract.md`,
  `HEARTBEAT.md`, and the `raw/` / `wiki/` / `output/` directories all exist.

### 4. Sign-in material / absolute local paths

- **`governance/webauthn-credentials.yaml`** — filename strongly suggests it holds authentication
  material. This path is outside this scan's declared read scope (`governance/` is human-edited-only
  per `CLAUDE.md` and not in the granted `readScope`), so its contents were not opened or checked.
  Flagging the path only, per instruction, for a human to confirm it's handled appropriately (e.g. not
  world-readable, rotated if ever exposed). Note: `governance/web-flow.gpg` also exists alongside it,
  encrypted at rest by its extension — no action indicated there.
- **Committed absolute local paths (path only, no values echoed):**
  - `queue/done/6a5d6b23-17e8d1be.md:25` — references
    `C:\Users\danie\youtube-uploader-mcp\config\client_secret.json`.
  - `queue/done/6a5d6b23-4c98aec0.md:28` — references
    `C:\Users\danie\youtube-uploader-mcp\config\.youtube_uploader_channels_cache`.
  Both are historical one-time-setup instructions (OAuth gates G3/G4, already resolved/retired) rather
  than live secrets, but both commit a local Windows username and directory layout to the repo.
  **Suggested follow-up:** low priority given these are closed, historical cards — consider whether
  future setup cards should reference such paths via an env var or generic placeholder instead of a
  literal `C:\Users\<name>\...` path.
- No private-key blocks (`BEGIN ... PRIVATE KEY`), no AWS-style access-key patterns, and no other
  credential-shaped values were found in `queue/`, `dashboards/`, `ledgers/`, or `orgs/kb-ops/` content
  within scope.

## Read-only confirmation

This run made no writes or edits other than this single new file
(`orgs/kb-ops/output/self-lint-report-2026-07-23.md`). No existing file was edited, deleted, moved, or
reformatted. No command was run that could mutate the repository, the network, or any external system
— only `Read`, `Glob`, and `Grep` were used prior to this `Write`. No suspected sensitive values were
printed or copied; findings above name containing paths only.
