# Dashboard v3 — P0 closed, P1 plan drafted, review says REWRITE — handoff 2026-08-21

**Topic:** Boss session ran P0 (spec gate + test oracles + baseline) and the P1 *plan* leg of the
dashboard-v3 arc. Supersedes and deletes `2026-08-20-dashboard-v3-spec-ready.md`. Resume = rewrite the
P1 plan against the review (6 blockers / 7 majors), re-review, then dispatch the P1 builders. Task list for the terminal: P0 ✅ ·
P1 (in progress) · P2 · P3 · P4 · P5 · P6 · P7 — one task per phase.

## Daniel's rulings this session (binding)
- Spec `docs/specs/2026-08-20-dashboard-v3-design.md` **read and approved** — P0 gate closed; do not re-ask.
- Per phase the boss runs every machine test/analysis/review it can (desk + VM); **Daniel's hands-on
  tests are batched at the end (P7)**, not per phase.
- Blocked human prerequisite (P3 VM uid/logins, P5 helper install, P6 Desktop enrollment): ping him if
  present; if not, build what can be built and hold the human gate to the end.
- Build host stays the desktop (VM offered as worker host, declined). Codex workers only; Claude agents
  verify only. The ACL-locked codex residue dirs can be deleted "later" — not blocking.

### What WORKED (with evidence)
- **P1 plan authored** by codex-sol xhigh (`--worktree`, dispatch `6a879f84`, card `6a87cab4` pushed to
  ops) → committed `d2d4e9ab` on `claude/dashboard-v3` as `docs/plans/2026-08-20-dv3-p1-plan.md`
  (313 lines: 5 tasks, 4 disjoint parallel workers W1–W4 + serial T5, 130-path deletion inventory with
  grep proofs, route matrix, §8 token table, gate commands, 12-step browser checklist, adversarial greps).
  Boss read it in full.
- **Native Linux oracle** `~/kb-v3` in WSL Ubuntu (ext4): `npm ci`, typecheck, build green; vitest
  20 files / 74 tests failed of 284 / 3714 — confirmed by `~/linux-vitest.txt`.
- **Windows gate worktree** `C:/Users/danie/kb-worktrees/dv3-gate` (detached @ 9e391633, `npm ci`
  done) — residue-free so `server/index.test.ts` no longer EPERMs.
- **Baseline classified** in `docs/plans/2026-08-20-dv3-p1-baseline.md` (committed): 17 files fail on
  both OSes (main never ran vitest in CI — passkey-era lock assumptions, Composer, CommandPalette, …),
  3 Linux-only (`pty/resolveCommand` expects `py`, `composer/routes`, `brain/routes`), Windows extras are
  environmental (EPERM residue, load timeouts, `[vitest-pool] Failed to start forks worker`).
- codex 0.148.0 spawns fine on this box now (pong probe) — the 0.147 pin is no longer needed.
- **Plan adversarial review DONE** — codex-sol xhigh read-only, 1137 s, card `6a87ced2-59031877` on ops
  (its `## Result` = the full review; thread `01a0226f-0294-7b80-97a5-d126fe48c28f`). Verdict
  **REWRITE**. Blockers: (1) exit-zero gate unreachable from the red base — plan must carry the
  disposition table (the review wrote one, §5 of its output); (2) T1 builds the legacy
  category/urgency/buttons Inbox, not spec §5's card-backed *escalation* subject shape (Open-card only);
  (3) W4 owns `EntityDetail` but not `Workflows.tsx:326-353`/`Agents.tsx`, whose parents replace the
  list with the detail — slide-in needs those files; (4) `--ink`/`--mc-accent` remap leaves
  `palette.css` focus/selection non-conforming; (5) "re-export-only" shims change signatures
  (`projectHumanInbox(index,{stopPresent})` at `approvals/routes.ts:52-57`; Schedules panel caller) →
  intermediate tree won't compile; (6) `STOP_CARD_SCRIPT` is imported by `server/embeddedPython.test.ts:25,44`,
  absent from T5. Majors: parallel phase not green (Sentinel mounts `StopControls` until T5); tool-
  result join impossible from `OperationalEventDto` (no tool-use id); deep-link ingress + sidebar
  rail-on-Terminal unwired; Inbox `/events` invalidation untested; `appTokens.test.ts` has no mechanism
  under node/jsdom vitest; browser checklist lacks fixture setup; T5 must be ordered substeps.
  Boss-visible gap confirmed: T5 "boss-only" → must be W5 (serial codex worker).

### What Did NOT Work (and why)
- **Harness `run_in_background` shells died** ~15 min after the turn went idle (Windows baseline, WSL
  clone) — same failure as [[detached-codex-dispatch]]. Everything long now runs via PowerShell
  `Start-Process` (+ `Monitor` polling a marker/sentinel line).
- **Desk slept 20:50→23:09** despite keep-awake armed with a live lease (likely lid/manual). Sleep pauses
  the codex worker's monotonic `communicate(timeout=)` clock, so another terminal's dispatch sweep saw
  the marker past deadline+slack and published a `FAILED: orphaned` card (`queue/done/6a87c1ed-…`) while
  the worker was alive; it finished normally 11083 s wall later. Treat orphan cards as suspect after any
  sleep; check the python pid.
- **WSL `git clone https://github.com/…`** hung — private repo, no credential helper in WSL.
  `git clone /mnt/c/Users/danie/kb` failed copying loose objects across the 9p mount → fixed with
  `--no-local`.
- **WSL `nohup … &` from `wsl -e bash -lc`** died with exit 129 (SIGHUP) when the wsl shell closed;
  `setsid nohup … < /dev/null &` survives.
- **Windows full vitest under load** (reviewer + other terminal's workers running): 23× pool-fork start
  failures, 24 files never executed. Use `npx vitest run --maxWorkers=4` on a quiet box; rerun any
  timeout/pool file in isolation before counting it.
- Unelevated `icacls/takeown/Remove-Item` on the ACL-locked residue was blocked by the permission
  classifier; it needs Daniel's admin shell anyway (one-liner was given to him; he said later).

### What Has NOT Been Tried Yet
- Harvesting the plan review (running when this handoff was written).
- Folding the two known plan gaps: §11 baseline-debt disposition table (per failing file: deleted by
  §3 / test rewritten by Tx / carried with owning phase named — note `AgentWorkPanel` is retained by
  `RunDetail.tsx:88`, so its failing test is W3's or carried); and T5 relabelled from "boss-only" to
  **W5 = serial codex worker** dispatched from the branch tip after the boss commits T1–T4.
- The P1 build itself (W1–W4 parallel in `--worktree`s, then W5), boss gates, adversarial review,
  browser check.
- Spec §10 still says branch `codex/dashboard-v3`; actual is `claude/dashboard-v3` (trivial edit, do
  with the plan-fix commit).

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `docs/plans/2026-08-20-dv3-p1-plan.md` | WIP | draft committed `d2d4e9ab`; review pending; §11 + W5 relabel owed |
| `docs/plans/2026-08-20-dv3-p1-baseline.md` | DONE | P0 baseline + Windows-oracle reliability note; fold into plan §11 then delete |
| `C:/Users/danie/kb-worktrees/dv3-gate` | DONE | Windows gate worktree (detached); `git -C … checkout <sha>` after each boss commit; remove at arc end |
| WSL `~/kb-v3` | DONE | Linux oracle; `git pull` from `/mnt/c/Users/danie/kb` branch; `~/linux-baseline.sh` runs the 4-command gate |
| `…/scratchpad/detached-p1-review.out` (session `00379d36-61ac-46b8-b908-498aee9f95bf`) | WIP | reviewer's final message + card footer land here; also card on ops with `workflow:` = its thread id |
| `…/scratchpad/dv3-p1-plan-brief.md`, `dv3-p1-plan-review-brief.md` | DONE | reusable briefs (plan author / plan reviewer) for later phases |
| `queue/done/6a87c1ed-432b9f6d.md` (ops) | NOTE | false "orphaned" card for the planner — see above |

### Exact Next Step
0. **Checkout hygiene first:** another terminal switched the main checkout to `ops-handoff-vd`
   (an ops temp branch) while this session ran. Confirm `git -C C:/Users/danie/kb branch --show-current`;
   if that terminal is done, `git checkout claude/dashboard-v3` (tip `d2d4e9ab`, pushed). Never rebase
   or reset without checking the branch.
1. Read the review: card `6a87ced2-59031877` (`queue/done/` on ops, `## Result`) or the scratchpad copy
   `C:/Users/danie/AppData/Local/Temp/claude/C--Users-danie-kb/00379d36-61ac-46b8-b908-498aee9f95bf/scratchpad/dv3-p1-plan-review-1.md`.
2. Dispatch a **fresh** codex-sol xhigh **rewrite** of `docs/plans/2026-08-20-dv3-p1-plan.md`
   (`--worktree`, never `--follow-up` for writes; reuse `dv3-p1-plan-brief.md` + append the full review
   text + `2026-08-20-dv3-p1-baseline.md` + these rulings: Inbox = spec §5 escalation subjects; W4's
   ownership must include `Workflows.tsx`/`Agents.tsx` list-retention or the slide-in moves to W5;
   no signature-changing shims — each worker's tree compiles and its focused suite is green alone;
   T5 → W5 serial codex worker with ordered substeps; token test mechanism (e.g. parse `app.css`
   text for exact values, or happy-dom with stylesheet injection) named explicitly; §11 disposition
   table per failing baseline file; spec §10 branch typo `codex/`→`claude/dashboard-v3`). Re-review
   with `dv3-p1-plan-review-brief.md` (fresh codex-sol read-only); ≤2 rounds; commit on
   `claude/dashboard-v3`.
3. Dispatch W1–W4 in parallel (codex terra, `--worktree`, brief = plan task + ownership map + spec §9
   rules + "never commit"; ~45–60 min each), harvest diffs onto the branch, run focused suites, commit;
   then W5 from the tip; then boss gates (Windows `--maxWorkers=4` in `dv3-gate`, Linux `~/kb-v3`),
   adversarial review (fresh codex-sol read-only, plan §8 script), browser check (chrome-devtools,
   dark/light, 1280/720), commit. Daniel's IA scan is deferred to P7.

### Load list
- `docs/plans/2026-08-20-dv3-p1-plan.md` (all) · `docs/plans/2026-08-20-dv3-p1-baseline.md`
- `docs/specs/2026-08-20-dashboard-v3-design.md` §3, §5, §8–§11 · `dashboard/docs/ux-rules.md`
- `memory/claude-boss.md` (2026-08-21 section) · `skills/curated/dispatch-codex/SKILL.md`
- `BOSS.md` (git hygiene: never check out `ops` in the main checkout; temp worktree + `push <sha>:ops`)
