# Prospecting — P1–P5 built, integrated tree gating (boss handoff 2026-09-03 late)

Owner: boss session (Fable). Status: OVERNIGHT ASYNC — Daniel wakes to human gates.

## Load
- orgs/prospecting/_index.md, STATE.md, contract.md, data-contracts.md
- docs/superpowers/specs/2026-09-02-prospecting-design.md (r3 + amendments)
- docs/superpowers/plans/2026-09-03-prospecting-p{1..6}.md (all v2)
- memory/claude-boss.md (2026-09-03 sections: gate/record rules, frozen-file rule, phase-review rule)
- scratchpad (session d270c80a) prospecting/: run-task2.ps1, run-gate-p{1..5}.ps1, fill_manifest_p{2..5}.py, briefs-p*/ , boss-lessons-2026-09-03.md

## Where things are
Worktrees C:/Users/danie/kb-worktrees/prospecting-p{1,2,3,4,5} (branches claude/prospecting-p{n}, all unpushed).
Gate records committed: P1 122/122 · P2 205/205 (after phase-review fix wave: executor-only vendor I/O, enforceable
LinkedIn guard, runnable `list_builder run`, person-identity dedup) · P3 289/289 (cards moved to
evals-draft/prospecting-personalizer with front matter) · P4 180/180 recorded BEFORE its phase-review wave;
re-record pending after fix-phase4 (schedule_cases owner, flaky two-thread enrollment).
P5 = integrated tree (p1+p2+p3+p4 merged): tasks 0–8 committed + integration fixes; P5 gate pending the P4 re-merge
and manifest hash refresh (`fill_manifest_p5.py`, fixtures by basename). P5 phase review launched.
Frozen-file rule: later phases never edit P1 files; P1 changes fold into P1 and re-record (done twice tonight:
schema-version test, vm_policy sink).

## Human gates for Daniel (in order)
1. P1: run scratchpad `p1-gate-demo.ps1`, reply "P1 pass".
2. P2: real 30-firm list via `py -3 -m scripts.prospecting.list_builder run --campaign <id> --lanes manual,pitchbook`
   on the desktop; Hunter vs Snov 50-contact blind bake-off; budget decision (rent which finder).
3. P3: read 20 drafts (`personalizer` CLI on synthetic sender profile → real profile after edit).
4. P4: live ten-email DRAFT run (tier 0) against the real Gmail adapter, drafts land in Gmail, labels applied.
5. P5: one `outreach-run` from the VM terminal with an opaque ask ref → drafts, no hand steps.
Then P6 (tier-1 WebAuthn approvals + scheduled sends) and P7 (local desktop web UI) plans start.

## Open defects / notes
- P4 phase review found the ten-touch flow unrunnable from the CLI; fixed in the phase wave (commit 60e6b215+);
  P4 phase-fix4 in flight when this was written.
- Datasette launcher tests (P1) fail if another gate holds port 8765; free the port before any gate.
- Codex sandbox reports py3.12/no tzdata/denied temp; host is 3.13.7 — every brief carries the ENV NOTE.
