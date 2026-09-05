# Prospecting — P1–P6 recorded (P6 737), real Snov fill converged, P2 gate awaiting rulings (boss handoff 2026-09-05 night)

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

## Real-run state (2026-09-05 ~00:30, supersedes the evening block)
- P6 branch `claude/prospecting-p6` HEAD 644c0e16, gate 737/737 recorded. Six real-run defects fixed tonight, each via
  probe → codex fix brief (scratchpad briefs-p6/fix-{unfiltered,refusals,quality,domains,reserve-ids,snapshot-host}.md) →
  manifest refill → detached gate → real pass: (1) Snov `positions[]` is exact-match → discovery now unfiltered + local title
  classes + 4-page/firm budget; (2) `vendors attach` dropped `snov_account_credit_ceiling` from operator-vendors.json → attach
  preserves keys; budget refusals surface as `shortfall_reason` (never "exhausted"); (3) `DEFAULT_TITLE_FUNCTION_EXCLUSIONS`
  (finance/IT/talent/marketing/ops/...; override key `title_function_exclusions`, CLI `--title-exclusions`); (4) fill backfills
  `company.website_url` from company-domains.csv at start (`domains_backfilled`); (5) reserve firms get typed `cmp_` ids;
  profile queueing skips untyped ids (`profiles_skipped_untyped`) instead of aborting; (6) homepage snapshot allowlists
  `www.` redirect, typed fetch rejections. Schema untouched (new state expressed as status=short + reason).
- Live campaign `camp_c57b52cc14d54104` (current-campaign.txt; run-fill.ps1 targets it): 22 people / 13 firms with valid
  email, titles Associate/Senior Associate/Director only, website + LinkedIn on every row, blurb on 8 (5/8 homepages
  fetched); 113 of the ask's 150 credits used; 17 firms had no matching titles within 4 pages, 9 firms no confident email,
  18 email searches refused at the credit cap. Old campaign camp_842bf7a6b415488b is dead (its 12 reserve firms carry UUID
  ids — those 5 delivered firms get no profile until a fresh campaign; fixing ids in place is not worth it).
- Datasette on 127.0.0.1:8765 (serve_datasette.ps1 -Port 8765); campaign-scoped deliverable SQL URL saved in
  %LOCALAPPDATA%\kb-prospecting\deliverable-url.txt (the `deliverable_v1` view is NOT campaign-scoped — double-counts).
- Snov keys in Daniel's user env (SNOV_CLIENT_ID/SECRET); Hunter deferred. Snov Starter monthly active.
- Files Daniel edits live under %LOCALAPPDATA%\kb-prospecting\: ask-nyc-vc.txt (grammar incl. `credits:N`, `title:`),
  captures-nyc-vc.csv, company-domains.csv (name,domain), reserve-firms-nyc-vc.csv, sender-profile.json,
  operator-vendors.json (providers, per_firm, snov_account_credit_ceiling, title_function_exclusions).

## Daniel's gates, in order (present one at a time)
1. P1: PASSED 2026-09-04 (Datasette loopback read-only, hook rejected the planted email).
2. P2: AWAITING RULINGS — list in browser 2026-09-05 (campaign camp_c57b52cc14d54104). Rulings asked: (a) title classes
   beyond associate/director (principal / vice president / partner?), (b) credit budget above 150. Then re-run
   scratchpad run-fill.ps1 → run-executor.ps1 → refresh the saved Datasette URL → ask "P2 pass".
   Original recipe: Per runbook "Operator gates": campaign new --ask-file → capture add / --pitchbook-csv → list → vendors attach
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
