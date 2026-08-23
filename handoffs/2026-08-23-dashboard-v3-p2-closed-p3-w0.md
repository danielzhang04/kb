# Dashboard v3 — P2 CLOSED, P3 W0 next — handoff 2026-08-23

**Topic:** Hands-off boss run (Daniel: "analyze, plan as a tasklist, run it step by step, adversarial
review + testing included") took dashboard-v3 from "P2 built, W6.7 killed/unverified" to **P2 closed
on `claude/dashboard-v3` @ `9a72bbf8`**: W6.7 redone, adversarial build review + fix round, browser check
in a real (headless) browser + two fix rounds, Windows + Linux full gates clean. Supersedes and deletes
`2026-08-22-dashboard-v3-p2-built-p3-planned.md` (Daniel's carried P1 items repeated below).
Terminal task list: P0 ✅ · P1 ✅ · **P2 ✅** · P3 plan ✅ / **build ⏳ (W0 next, brief staged)** · P4 · P5 · P6 · P7.

## Why the previous run was "incredibly slow" (root cause, fixed)
The killed W6.7 worker (`6a89aa42`, 09:55→14:25) ran 107 read-only commands and never edited a file: one
repo-wide `rg` on step 10 dumped 533 KB into its context, every later turn crawled, and a network drop
added reconnects. The dispatcher's 4800 s timeout never fired because the harness had killed the python
parent (orphaned codex child). **Fix:** every codex brief now carries a READ BUDGET block (closed list of
readable files by line range; no preamble/CLAUDE.md/orgs/memory reads; no repo-wide rg; no command >200
lines; first edit by command 12–15; stop at 70 min and report) and dispatches are launched detached
(`Start-Process py …`) with a bash Monitor on the pending marker + a pid-only keep-awake lease. Same
task, same model: 36 min. Round times this run: W6.7 36 min · build review 31 · build fix 41 · browser
fix 23 · follow-ups 4–5 min each. See `memory/claude-boss.md` 2026-08-22 PM block.

## Branch state
`claude/dashboard-v3` @ **`9a72bbf8`** (pushed). Chain since the previous handoff's `a01be336`: `07539ebd`
memory → `1521b61e` **W6.7** (sol; palette `Workflows view` restored + un-repointed test, Retry copies
predecessor `{owner, executionHost}` with a platform-opposite regression test, stale-resume fixture host +
opposite-host variant, linear page fake, fixture scenarios as state machines over the checked-in goldens,
closed recursive `decodeRunDetail`, plan §12 skip disposition) → `80d11d51` **build-review fixes** (2
blockers: schedule socket `RuntimeDirectory=kb-dashboard` + stale-socket reclaim by connect-probe; release
activation requires both verified attestation sidecars with rollback; 4 majors: Agent/Workflow gate
counts through `projectRunAttention` with parity test, host chip via shared `selectEntityHostRun`,
duplicate humanizer + supplied `humanName` removed, REST/SSE/reconnect-fold byte parity over both real
goldens + unknown provider; minors: orphan `panels/routes.ts` deleted, launch-surface `executionHost`
assertions, plan §9 `rg -e`) → `41dfd567` **browser-check fixes** (System group collapsed + last via
shared `SYSTEM_ENTITY_GROUP_ID`; Escape restores focus to opener/deep-linked card; Home DTO `generatedAt`
drives the chip's relative time; fixtures: ordinary gate resolvable with T3 remaining, unknown-provider
raw record, run outputs incl. secret-looking artifact with Copy restricted to safe outputs; trace
comment fix; orphan `registerGradesHistoryPanel` deleted) → `9a72bbf8` **browser round 2** (Run inspector lists every open request in server order with independent
controls — T3 keeps its refusal, ordinary one resolvable, counts unchanged; detach/reattach ruled
client-local per spec §5 line 195 with a no-request test; Agents overlay stale local-open id fixed so
Back closes / Forward reopens with collapse state preserved).

### What WORKED (with evidence)
- **Gates on `9a72bbf8`:** Linux (WSL `~/kb-v3`, `~/dv3-gate.sh`) 279 files / 3219 tests passed, 22 pre-existing conditional skips, 0 red, exit 0; Windows (`dv3-gate`,
  `win-p2close-gate.cmd`) 277/281 files + 3214 tests in the concurrent run with 12 load timeouts (all ≥5 s) across `index`,
  `authorizedFailedRunReconciliation`, `canonicalResultEmbeddedPython`, `synthetic-acceptance` — all four
  green alone at `--maxWorkers=1` (120/120); typecheck 0; build OK. Python deploy/schedule suites 54 + 162 pass.
- **Adversarial build review** (sol, read-only, 31 min): FIX-THEN-SHIP with 2 blockers / 4 majors / 3
  minors — all fixed and Sonnet-verified (every test edit classified contract-change / restoration /
  repoint; "would it go red on revert?").
- **Browser check** (Sonnet + Playwright, nine `p2-*` fixture scenarios): first pass 5 clean / 2 FAIL /
  4 unexercisable → fix round → re-check: original defects fixed, fixture gaps closed, then round 2
  re-check 2/2 PASS (gate list + Back/Forward collapse persistence). Open observation for P7: a card
  click opens the overlay with `history.replaceState` (no pushed entry), so browser Back after a card
  click leaves the app — decide whether overlay open should push history. Screenshots: `C:/Users/danie/.claude/jobs/c3b25381/tmp/browser*/`.
- **Sonnet scoped verifiers caught what green checkpoints hid:** platform-blind Retry test (predecessor
  host == Windows bootHost), System-group id drift (`'system'` vs production `'System'`), untested
  `outputs` fallback — each closed by a 4–5 min codex follow-up (fresh dispatch with `--cwd <worktree>`;
  `--follow-up` drops cwd).
- Parallel review + fix on disjoint file sets composed cleanly in `dv3-gate` with `git apply --3way`.

### What did NOT work (and why)
- Boss ended a turn after a commit with nothing armed → ~6 h idle (17:31→23:35) until Daniel nudged;
  keep-awake leases all expired meanwhile. Rules now in memory: never end a turn without a Monitor/agent
  pending; pid-only lease on the boss claude pid for hands-off runs.
- Running the Windows and WSL full gates concurrently → 4 load timeouts (green alone at
  `--maxWorkers=1`). Stagger them.
- Codex worktree dirs stay ACL-locked after `git worktree remove` (registrations pruned): add
  `6a89ef0c-8edb1e46`, `6a89f6aa-6ea0cd5f` (+ any from this list that remain) to Daniel's elevated-delete
  list together with the five from the previous handoff.

### Carried to P7 (Daniel's batch, unchanged)
Real-server passkey checks, IA/colour scan, rulings on banner chrome / Health `Source:` text /
escalation titles, elevated delete of ACL residue, pre-existing conditional skips (12 Windows / 22
Linux) → "skip-free gates", full-document-reload collapse persistence (headless bfcache caveat from the
browser re-check), upstream `run-ref`/`stop-event` on wake-me cards (P4).

### Exact next step — P3 W0
1. Dispatch `scratchpad/dv3-p3-w0-brief-v2.md` (codex-deep xhigh, `--worktree`, `--timeout 5400`,
   detached + Monitor + pid-only lease). Then Sonnet SHAPE audit vs plan §3 (verify shapes, not
   presence) → fix round → `dv3-gate` checkpoint → commit "P3 W0".
2. W1–W5 in parallel (`dv3-p3-W1..W5-brief.md`, add the READ BUDGET block + stop-at-70 to each;
   re-read the plan's ownership rows first) → each: sol read-only review → fix → Sonnet verify →
   checkpoint → commit. Then W6.1–W6.6 serial with the WSL gate after every vertical (3 min).
3. P3 closure = tasks 4–8 of this run mirrored (plan §7 literal gates incl. the WSL native clone gate).

### Load list
- `docs/plans/2026-08-22-dv3-p3-plan.md` §1, §3, §5, §7, §9 · `docs/plans/2026-08-21-dv3-p2-plan.md` §12
- `memory/claude-boss.md` (2026-08-21/22 blocks) · scratchpad `dv3-p2-builder-common.md`,
  `dv3-p3-w0-brief-v2.md`, `dv3-p2-browser-check-brief.md` (procedure), the `detached-*.out` footers
- `BOSS.md` git hygiene · skill `dispatch-codex` · auto-memory `dashboard-v3-arc.md`
