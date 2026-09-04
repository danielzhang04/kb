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
- P6 (claude/prospecting-p6): tasks 0–8 built + reviewed; fixes 3c/7/8 were in flight at handoff time; then:
  boss fills manifest hashes (fill_manifest_p6.py), runs run-gate-p6.ps1 detached, records, launches the P6
  phase review. Frozen-file rule held throughout (verify P1–P5 `--verify-recorded` before every commit).
- P7-UI: spec amendment + plan v2.1 on branch claude/boss-2026-09-02 (commit 2239637c). NOT scaffolded —
  approval gate.

## Daniel's gates, in order (present one at a time)
1. P1: run scratchpad `p1-gate-demo.ps1`; reply "P1 pass".
2. P2: real 30-firm list on the desktop (`py -3 -m scripts.prospecting.list_builder run --campaign <id> --lanes manual,pitchbook`);
   Hunter vs Snov 50-contact blind bake-off; pick the rented finder + budget.
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
