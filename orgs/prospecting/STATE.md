# prospecting — STATE
_Updated: 2026-09-07 06:00_

## Now
P1-P8 built across integrated worktrees `C:/Users/danie/kb-worktrees/prospecting-p{1..8}`, all
branches UNPUSHED. P8 affinity gate 953/953 recorded at HEAD 52067386 (`claude/prospecting-p8`,
cut from P6). Live-tested against the real desktop store: campaign `camp_3147b42db58c4c15`
(fit hash 383fcaa3...) — batch 1 (10 profiles, 9 functional-role) scored 3 above fit, 2 delivered
at 1 firm, all Gate P8-B acceptance criteria green.

## Current gate
Gate P8-B (Datasette `deliverable_v2` acceptance) — held by Daniel; needs his "batch 2" go-ahead
to fetch 10 pre-selected investing-titled profiles (`linkedin-batch-2.json`, 9 firms) via his own
Chrome, then re-run research -> score -> fill-fit -> acceptance check.

## Next
1. Daniel says "batch 2" -> boss fetches 20 LinkedIn subpages via his Chrome (chrome-devtools),
   writes `linkedin-pages/<person_id>.txt`.
2. Run `research run --linkedin-pages-dir ...` -> score -> fill-fit (`run-p8-live.ps1`).
3. Run `p8b_acceptance.py` -> confirm Gate P8-B criteria green in Datasette.
4. `codex login` owed (CLI auth store fails to decrypt; codex dispatches down since 2026-09-07
   ~01:00; sonnet builders used in the interim).
5. Copy-polish pass with Daniel on `orgs/prospecting/templates/v2/*.txt` before `affinity draft`
   produces real send-ready drafts.

## Blocked
Codex dispatches (auth broken, `codex login` owed) — not blocking P8-B, workaround via sonnet.

## Findings
- Real-store live run surfaced 16 defects not caught by synthetic-fixture gates (fixtures never
  modeled two campaigns with equal target policies, untyped legacy ids, rejected requests, or
  foreign queued work) — see memory lesson `fix-dont-defer-to-daniel`.
- Firm sites 403 the default Python UA; P8 sends its own browser headers (P2's fetcher stays
  frozen).
- Bio pages are thin even with browser UA (~15 of 35 firms had no team page) — LinkedIn backfill
  carries more load than the spec assumed.
- Datasette python process must be killed before any store write (was killed at session close).
- Old campaigns `camp_c57b52cc14d54104` / `camp_842bf7a6b415488b` are dead; their 12 reserve firms
  carry UUID ids, skipped by P8 as `untyped_id`.
- Deferred review items owed Daniel's sign-off at merge: M6 (adapter blanket except), L1/L4/L5,
  N3 (P6 completeness-test edit outside the approved fold), `deploy_preflight` gate list
  hardcoded P1-P5 (merge-wave divergence, not P8's to fix).

## Infra
- Desktop store `%LOCALAPPDATA%\kb-prospecting\store.sqlite` (P2/P4/P6/P8 migrations applied;
  backups `store.sqlite.bak-pre-p8-*`).
- Datasette: `serve_datasette.ps1 -Port 8765`; campaign SQL URL in `deliverable-v2-url.txt`.
- Sender anchors `sender-anchors.json`; live ask `nyc-vc-ask.txt`; wrappers `run-p8-live.ps1`,
  `run-p8-score.ps1`, `run-executor.ps1`, `probe_p8.py`, `p8b_acceptance.py` — all desktop-local.
- Live campaign id `camp_3147b42db58c4c15` (`current-campaign.txt`).
