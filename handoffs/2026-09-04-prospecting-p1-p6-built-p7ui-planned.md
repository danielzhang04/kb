# Prospecting — P1–P5 recorded, P6 built (gate pending), P7-UI planned (boss handoff 2026-09-04 early)

Owner: boss session (Fable). Status: OVERNIGHT ASYNC done to human gates.

## Load
- orgs/prospecting/{_index,STATE,contract,data-contracts,runbook,deployment,cadences-proposed}.md
- docs/superpowers/specs/2026-09-02-prospecting-design.md + 2026-09-04-prospecting-p7ui-amendment.md
- docs/superpowers/plans/2026-09-03-prospecting-p{1..6}.md, 2026-09-04-prospecting-p7ui.md (v2.1, reviewed twice)
- memory/claude-boss.md (2026-09-03/04 sections)
- scratchpad (session d270c80a) prospecting/: run-task2.ps1, run-gate-p{1..6}.ps1, fill_manifest_p{2..6}.py, briefs-p*/, boss-lessons-2026-09-03.md

## State (all branches unpushed, worktrees C:/Users/danie/kb-worktrees/prospecting-p{1..6})
- Recorded gates, all verifying together in the integrated tree (p5 = p1+p2+p3+p4 merged; p6 = p5 + P6):
  P1 122 · P2 205 · P3 289 · P4 183 · P5 562. Each phase had a phase-level adversarial review against
  Daniel's literal workflow and a fix wave (P2: executor-only vendor I/O, enforceable LinkedIn guard, runnable
  `list_builder run`; P4: live CLI assembly, D0+3 cadence, post-claim stop re-check, opaque audit; P5: desktop
  stage adapter with real argv, real inspectors, PII guard on every bridge exit, idempotent runner).
- P6 (claude/prospecting-p6): tasks 0–9 built; two phase reviews + fix waves; gate recorded 656/656 then
  extended by the OPERATOR SURFACE (`py -3 -m scripts.prospecting.operator`: campaign new --ask-file, capture add,
  list, vendors attach, bakeoff run/report, executor run) after four security review rounds (credentials
  transient in-frame only, ask via file, argparse never echoes values, transport closure minted per claimed
  request, durable provider selection, scorer-blind A/B). Last gate re-record + round-4 review were in flight
  at handoff time; runbook.md "Operator gates" has the exact argv for the P2/P3/P4 human gates.
- P7-UI: spec amendment + plan v2.1 on branch claude/boss-2026-09-02 (commit 2239637c). NOT scaffolded —
  approval gate.

## Real-run state (2026-09-04 evening)
- Desktop store `%LOCALAPPDATA%\kb-prospecting\store.sqlite` (dev; reset twice today when schema_p6.sql changed —
  the migration ledger refuses modified migrations; after release, P6 schema changes go in a NEW numbered file).
- Snov keys in Daniel's user env (SNOV_CLIENT_ID/SECRET); Hunter deferred by Daniel. Real Snov shapes probed and
  recorded in briefs-p6/fix-discover7.md: v2 domain search returns prospects with `search_emails_start` (no emails);
  email search async start→poll; v1 domain search 404. Snov discovery lane (`scripts/prospecting/discovery/`, P6-owned,
  registered through P2's lane registry; P2 list builder now takes --finder-provider/--finder-cost) ran for real:
  30 firms → 15 people (cap 2/firm) → 7 emails, 20 credits, budget stop at 40. Discovery lane hardened through four review rounds (v2-only, resumable polling, per-campaign cap,
  50-credit account ceiling, side-table metadata); P6 recorded 704/704 at 74da2d62.
- Operator surface (`py -3 -m scripts.prospecting.operator`) reviewed x4; runbook "Operator gates" has argv.
- Files Daniel edits live under %LOCALAPPDATA%\kb-prospecting\: ask-nyc-vc.txt (grammar incl. `credits:N`),
  captures-nyc-vc.csv, company-domains.csv (name,domain), sender-profile.json, operator-vendors.json (names only).

## Daniel's gates, in order (present one at a time)
1. P1: PASSED 2026-09-04 (Datasette loopback read-only, hook rejected the planted email).
2. P2: IN PROGRESS — list handed to Daniel 2026-09-04 (campaign camp_4ac6a3a2a2a6445b). Per runbook "Operator gates": campaign new --ask-file → capture add / --pitchbook-csv → list → vendors attach
   --providers hunter,snov → bakeoff run --contacts 50 → bakeoff report; keys live only in Daniel's user env
   (HUNTER_API_KEY, SNOV_CLIENT_ID/SECRET, optional PDL_API_KEY, APIFY_TOKEN). Pick the finder (~$35–39/mo).
3. P3: read 20 drafts; edit the synthetic sender profile into the real one (desktop-local file only).
4. P4: live ten-email DRAFT run (tier 0) with the real Gmail adapter attached.
5. P5: one `outreach-run` from the VM terminal with an opaque ask ref → drafts, no hand steps.
6. P6: commit the cadence blocks from `orgs/prospecting/cadences-proposed.md` on main (human-authored);
   live T1 gate per `orgs/prospecting/runbook.md` (approve a batch via the kb WebAuthn channel → next-morning sends).
7. P7-UI: approve the amendment + plan (or redline) before any scaffolding.
Then: merge order P1→P6 (PRs), promotion ceremony to the VM ops checkout (runbook), worktree sweep.

## Standing hazards
- Killing a detached gate leaves a Datasette listener on 127.0.0.1:8765 → P1 launcher tests fail; free the port.
- Codex sandbox: py3.12/no tzdata/denied temp — every brief carries the ENV NOTE; host is 3.13.7.
- Workers edit frozen earlier-phase files when the plan names them; briefs carry the frozen-file ruling above the plan text.
