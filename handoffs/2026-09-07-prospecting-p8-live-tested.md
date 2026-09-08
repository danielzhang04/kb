# Prospecting — P1–P8 built; P8 affinity live-tested on the real store; batch 2 + Gate P8-B next (boss handoff 2026-09-07 ~06:00)

Written by the boss session (Fable 5.1). Active work only — delete on pickup/completion.

## Load
1. `orgs/prospecting/_index.md`, `STATE.md`, `contract.md`
2. `docs/superpowers/specs/2026-09-06-prospecting-affinity-design.md` (r4, approved) and
   `docs/superpowers/plans/2026-09-06-prospecting-p8-affinity.md` (r2) + `…-p8-CODE-REVIEW.md` (three confirm passes) — on
   branch `claude/boss-2026-09-02` (main checkout) and as untracked copies in the P8 worktree.
3. `orgs/prospecting/runbook-p8.md`, `orgs/prospecting/doctrine.md` (P8 branch).
4. `memory/claude-boss.md` sections "2026-09-06 …" and "2026-09-07 …" (26 lessons from the build + live-run days).

## Branch / worktree state (all UNPUSHED, all in C:/Users/danie/kb-worktrees/prospecting-p{1..8})
- P1 122 (a13a793e) · P2 207 · P3 289 · P4 183 · P5 566 (0fc5fa93, fit-line fold) · P6 741 (c038ca35, phase-agnostic completeness)
- P8 `claude/prospecting-p8` HEAD 52067386: gate 953/953 recorded; 212 affinity tests; 966 total. Cut from P6; merge order for
  PRs stays P1→P2→P3→P4→P5→P6→P8 (P7 UI is planned, unbuilt, unapproved).
- Boss branch `claude/boss-2026-09-02`: specs/plans/reviews for P7-UI and P8 (b6192c2e…735095b4…).

## Real-store state (desktop, `%LOCALAPPDATA%\kb-prospecting\`)
- Store has P2/P4/P6/P8 migrations applied; backups `store.sqlite.bak-pre-p8-*`. Datasette: `serve_datasette.ps1 -Port 8765`
  (kill the python datasette process before store writes; it was killed at session close).
- Live P8 campaign `camp_3147b42db58c4c15` (`current-campaign.txt`): fit spec approved (hash 383fcaa3…; compiled from
  `nyc-vc-ask.txt` via a sonnet model step → `fit-response-camp_….json`); discovery done (35 firms, 53 new people, 75 credits);
  bio pages thin even with browser UA (~15 firms no team page); LinkedIn facts come from Daniel's OWN Chrome (his explicit override
  of the dedicated-profile rule): boss loads `/details/experience/` + `/details/education/` through chrome-devtools, writes
  `linkedin-pages/<person_id>.txt`, then `research run --linkedin-pages-dir … --max-linkedin N`.
- Result on batch 1 (10 profiles, 9 of them functional roles from the old pool): 3 above fit, 2 delivered at 1 firm, all Gate P8-B
  acceptance criteria green (scratchpad `p8b_acceptance.py`), second pass no-op, 77 credits.
- Batch 2 pre-selected: `linkedin-batch-2.json` (10 investing-titled people, 9 firms). **NEXT = Daniel says "batch 2" → fetch
  the 20 subpages the same way → `run-p8-live.ps1` (research→score→fill-fit) → `p8b_acceptance.py` → Gate P8-B in Datasette
  (`deliverable-v2-url.txt`).**
- Old campaigns `camp_c57b52cc14d54104` (P6 fill, 22 people) and `camp_842bf7a6b415488b` are dead; their 12 reserve firms carry
  UUID ids (skipped by P8 as `untyped_id`).
- Sender anchors `sender-anchors.json` (employer `kind` ∈ bank|consultancy|pe|vc|hedge_fund|startup|bigtech|corporate|government|
  academia|nonprofit|other), `networking-templates-original.pdf`, `template-analysis.md`, `probe_p8.py` (CLI traceback spy),
  `run-p8-live.ps1`, `run-p8-score.ps1`, `run-executor.ps1` — all desktop-local.

## Owed / open
- Daniel: `codex login` (CLI auth store fails to decrypt; codex dispatches down since 2026-09-07 ~01:00; sonnet builders used since).
- Copy-polish pass with Daniel on `orgs/prospecting/templates/v2/*.txt` before `affinity draft` produces real drafts (subjects carry one
  evidence slot; bodies 75–125 words at fallback values).
- Deferred review items: M6 (adapter blanket except), L1/L4/L5, N3 (P6 completeness-test edit outside the approved fold — needs
  Daniel's sign-off at merge time), `deploy_preflight` gate list hardcoded P1–P5 (merge-wave divergence).
- Later gates unchanged: P3 (needs real `sender-profile.json`), P4 live drafts, P5 VM run, P6 cadence blocks + live T1, P7-UI approval.
- Snov `get-profile-by-email` returns current/previous jobs (no education) — wire later as free enrichment for delivered people.

## Standing hazards
- Fixtures never have two campaigns with equal target policies, untyped legacy ids, rejected requests, or foreign queued work — every
  one of those bit the real store this week. Probe the real store's differences before any live run.
- Never name a schema enum value in a brief without grepping the CHECK first (`linkedin_state`: not_needed|pending|loaded|cap_reached|checkpoint|disabled).
- Firm sites 403 the default Python UA; P8 sends browser headers on its own transport (P2's fetcher is frozen).
- The skills-sync pre-commit hook blocks the first commit in a fresh worktree until `py -3 scripts/sync_skills.py` runs.
