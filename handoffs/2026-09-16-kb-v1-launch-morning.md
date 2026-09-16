# kb v1 launch — morning handoff — 2026-09-16

## Context

v1 launch has been in a deploy-hold loop since 2026-09-15: each rehearsal pass on
prod's real document + real linear `origin/ops` history surfaced one new defect,
got hotfixed, and required a fresh rehearsal from the top. That loop closed
overnight. PR #192 is now READY and opus-reviewed MERGEABLE-AS-IS. Earlier the
same day, #187/#188/#189/#190 merged to main (5fb41b18), ops was linearized and
force-pushed (backup at `refs/backup/ops-pre-linearize-2026-09-15`), and the
kb-reader shell was hardened after an opus review found two RCEs in the
"hardened" version.

## Done (with evidence)

- **PR #192 READY, opus-reviewed MERGEABLE-AS-IS** (cbf0c689): three hotfixes bundled —
  - hotfix-4: `cards.py` CLI sort_keys digest fix
  - hotfix-5: `cards.ts` inline-mapping fix
  - hotfix-6: `v1.schema.json` — four stamped keys added
- **Full prod ceremony re-proven overnight** on the rehearsal host (WSL
  `kb-rehearsal`), against prod's real document and real linear `origin/ops`:
  deploy → drain → stop run-971d5ba4 (200, rev 489) → demo + T3 passkey →
  scheduled run with browser closed → Terminal. A real Claude turn was proven
  end-to-end (self-lint-report, subscription billing, $0 spend).
- **Earlier same day**: #187, #188, #189, #190 merged to main (5fb41b18); ops
  linearized and force-pushed (backup ref
  `refs/backup/ops-pre-linearize-2026-09-15`); kb-reader shell hardened
  (`T\kb-reader`, sha
  `4f76b0004dd713d9790ea1cae66a01535c663073e474a1644b62c70419564f0d`; prod
  reinstall steps are in the packet); 14 follow-up cards filed on ops (commit
  2f233e2a).

## Remaining / not fixed — rulings owed

- **P6-F1**: agent-owner cadence schedules lack an execution profile. Pre-existing
  gap, not a #192 regression — workflow schedules work fine.
- `dashboard-ops` worktree reset is owed by Daniel.
- Linear-history ruleset on `ops` still needs to be turned on.

## Morning path for Daniel (~45 min)

Follow `C:\Users\danie\kb-rehearsal\tooling\MORNING-2026-09-16.md`. Key point:
**merge with `--merge`**, not squash or rebase — the rebuild guard requires the
branch commits to remain ancestors of main.

## Load list

- `C:\Users\danie\kb-rehearsal\tooling\MORNING-2026-09-16.md` — the morning packet (start here)
- `T\PROD-CEREMONY-2026-09-15.md`
- `T\rehearsal\p6\evidence.md` (+ p2/p3/p4/p5 evidence in the same dir)
- `T\kb-reader\HARDENING-2026-09-15.md`
- `orgs/kb-ops/STATE.md`
- `memory/claude-boss.md`

Note: the rehearsal tooling lives outside this repo at
`C:\Users\danie\kb-rehearsal\tooling` — it is a persisted host, not a
per-session scratchpad, and survives across sessions.
