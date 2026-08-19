# MORNING REPORT — Wave-2 overnight run + W3 extension (2026-08-19)

**W3 EXTENSION (same day, Daniel-directed):** two more units landed after the overnight run —
**W3-1 agent versioning + def schema depth** (`64a044d`): defs carry `version`/`io`/`defaults`
(backward-compatible, python↔TS parity test-pinned), `agent_factory bump` (byte-exact),
"def changed without version bump" drift warning in eval_trigger, dispatch records stamp a
pre-spawn-pinned `agent_version: <id>@v<n>` beside kit_sha, roster shows the version badge;
card-schema paste-block in `docs/proposals/agent-versioning.md`. **W3-2 maintainer eval
forecast** (`6319322`): proposals now carry real git-style diffs; with `--forecast` the
maintainer sandbox-applies each diff in a temp worktree and runs the affected agent's evals
(forecast-safe judges only — arbitrary card commands never execute; nothing records to real
ledgers), attaching completed/refused/skipped/error results to the proposal for the human.
Both sol-adversarially reviewed (3 HIGH each fixed — incl. a reviewer-live-confirmed patch-path
wall bypass and a post-spawn provenance bug); sweep **1390/0** + typecheck boss-verified;
:4630 relaunched on this build. Wave-3 remainder (run-pinning in the workflow engine) belongs
to the workflow-platform branch.

**Branch:** `claude/agent-platform-w1` @ `64a044d` (pushed; remote == local)
**Working root:** standalone clone `C:/Users/danie/kb-clones/agent-platform-w2` (moved off the
linked worktree mid-run for your cloud migration — nothing of this run touches `C:/Users/danie/kb/.git`)
**Spec/plan:** `docs/superpowers/specs/2026-08-19-wave2-overnight-design.md` · `docs/superpowers/plans/2026-08-19-wave2-overnight.md`
**Proof floor at close:** full pytest **1364 passed / 0 failed** (boss-run on this checkout) ·
dashboard typecheck green · per-task focused vitest green · 0 parks, all 7 units landed ·
$0 API spend (subscription only). **Nothing armed anywhere.**

## What you got (per function, one paragraph each)

1. **Maintainer cadence agent** (`agents/agent-maintainer.md`, `scripts/agent_maintainer.py`) —
   the standing agent you asked for: on each fire it reads eval reports, the grades ledger,
   memory lessons, and parked cards, and emits improvement PRs/cards targeting agent defs,
   memory, and role policies — never evals, never governance, never code (hard walls in code +
   tests, incl. junction/symlink and encoded-path evasion). Draft-only: it cannot write targets
   or run git. Proven end-to-end on fixtures. Its HEARTBEAT cadence is DRAFTED
   (`docs/proposals/maintainer-cadence-entry.md`, `role: manage`, nightly cron) — registering it
   and the first live fire are your gates.

2. **Agent-builder skill** (`skills/curated/agent-builder/`) — say "create an agent that does X"
   in any terminal and this skill carries the judgment: inheritance map first (kit / fleet floor /
   factory — nothing agent-general lands in a def), elicitation checklist (job, surfaces, loop
   bounds, delegation, never-do, failure modes → suggested eval cards), drives the factory,
   drafts eval cards unblessed. Gated on LIVE §8: until you apply the rule-8 rewrite it stops at
   a proposal instead of writing evals. Proven by a worker building (then deleting) a toy agent
   from the skill text alone.

3. **Grades-history panel** (Agent Platform section, :4630) — per-identity timeline of every
   grade row: task grades and eval results, pass/fail chips, filterable, `eval-suite` rows
   visually distinguished with never-feeds-autonomy copy. Read-only; endpoint is size-capped,
   header-validated (malformed rows counted as `skipped`, never fabricated), symlink-contained.

4. **Scheduling UX per your rulings** — one reusable gcal-style **RecurrencePicker** (day
   toggles, multiple times/day, live preview) compiling to validated cron, wired into the
   Schedules edit/create prefill; **Schedules is now sidebar top-level** (out of Agent Platform);
   each schedule row expands to its **run history** (scheduled vs actual fire time, outcome,
   result — results only from done cards, project+cadence scoped). Still pause-only: no
   unpause/run/arm affordance anywhere.

5. **Regrounding hook, reworked per your trigger+throttle ruling** — injects doctrine on
   SessionStart(compact) always, and on PostToolUse/UserPromptSubmit behind a throttle
   (25 tool calls / 30 min, env-tunable), so unsupervised runs get re-grounded mid-flight and
   interactive sessions aren't nagged. Cross-process locked state, byte-stable payload
   (cache-safe), fail-open on every error path. **Still inert** — arming is your post-merge
   ceremony; the proposal doc now carries the three exact registrations.

6. **Rule-8 rewrite + card-schema drafts** (`docs/proposals/rule8-governed-eval-authoring.md`) —
   both §8 variants paste-ready (V-human: you bless everything; V-review: independent-agent
   bless, human bulk-ratify — explicitly NOT selectable until provenance fields exist), shared
   invariants verbatim (self-judgment wall, `_fleet`/canaries always human-blessed), plus the
   `scheduled_for`/`dispatched_at`/`kit_sha` card-schema amendment, code-anchored.

7. **Hardening found by the run itself** — (a) `eval-suite` grade rows could reach promotion
   math through two paths (the old canary only proved key-noncollision, NOT filtering — its
   claim was too broad); now fail-closed excluded in both the python and TS ladder ports.
   (b) Manifest hashing was checkout-dependent: any fresh autocrlf clone false-tampered every
   blessed suite; agent-suite + canary manifest hashing is now EOL-insensitive (byte-contract
   hashes deliberately untouched). (c) Two new fleet cards (lesson-appended, ledgers-cost-row,
   argv-injection-proof, honest limits stated) + canary count corrected to 21.

## Review discipline (evidence)

Every unit: codex terra build → fresh-context codex-sol adversarial review → boss grade →
commit. Rework rounds: F 1, G 2 (incl. a wall verify-pass), A 2, D 1, C 1, B 1, E 1 — 0 parks.
Findings that mattered: unenforceable V-review identity exclusion; test weakened to vacuous
(restored with hermetic fixture); agent-id quote-injection in eval cards; win32 junction bypass
of `is_symlink()`; result leakage from non-done cards; picker stale-cron submit; skill teaching
eval writes live §8 forbids. Commits: F `4859d13`, G `f29e0bc`+`5aa9f32`, A `3716deb`,
D `ff70ee7`, C `8c834af`, B `0055b9a`, E `6e8b94a`, G2 `1365c5a`, reconciliation `3abd3a9`.

## Incidents (all contained, lessons in memory)

- **codex 0.148.0 broke spawning mid-run** (released 22:30Z, machine picked it up; its new
  Windows sandbox helper is missing from the npm package). Worked around with a pinned local
  0.147.0 (`scratchpad/codex-pin`) — decide whether to pin globally or wait for 0.148.1.
- **A follow-up dispatch wrote into the main checkout** (known `codex-followup-loses-cwd` trap;
  contained same-hour, file moved, main clean). New law followed since: writing reworks are
  always fresh dispatches with `--cwd`.
- **A killed worker survived taskkill** (exit 128 ignored) and finished Task C's first build
  unsupervised; its diff was audited hostile + adversarially reviewed before landing. New law:
  verify kills by process liveness.
- **Boss staging miss**: G's `agent_evals.py` line landed one commit late (`5aa9f32`).

## Known baseline (not breakage)

- Dashboard full-parallel vitest: `canonicalResultEmbeddedPython` 5s-timeout load-flake
  (passes alone; file untouched all night) + pre-existing `/api/workflows/example` 500-vs-404
  in `server/index.test.ts` (review-confirmed pre-existing) + the Wave-1 report's
  CommandPalette/sign-in baseline. Full-sweep result appended below when it finishes.
- `tests/test_sync_daemon_dirs::test_sync_commit_excludes_unrelated_staged_files` is
  order-dependent-flaky in full sweeps (passes alone AND in the final full sweep).

## YOUR morning gates (in order — nothing new was invented overnight)

1. **Rule-8 pick + apply**: choose V-human or V-review in
   `docs/proposals/rule8-governed-eval-authoring.md`, paste into `governance/agent-rules.md` §8.
   Same sitting: paste the card-schema amendment into `governance/card-schema.md`.
2. **Bless the new eval manifests** (agent-maintainer suite; the two fleet cards from G):
   `py -3 -m scripts.agent_evals run agent-maintainer --update-manifest` and
   `py -3 -m scripts.agent_evals run demo-agent --fleet --update-manifest`, commit manifests.
3. **Maintainer first live fire**: approve `docs/proposals/maintainer-cadence-entry.md` →
   commit the cadence to HEARTBEAT.md (via the Schedules panel PR flow if you like) → first
   fire runs against real ledgers, opens real PRs for you.
4. **Residue calls**: `kb-worktrees/agent-platform-w1/queue/paused/{nightly-review,weekly-audit}`
   (your panel pause tests — keep paused or clear) + 2 audit rows in that worktree's
   `ledgers/audit/dashboard-audit.ndjson` + ACL-locked `.pytest-*` dirs (elevated delete).
5. **Later, unchanged**: VM migration window → hook arming ceremony (U7 three registrations +
   inert-guard retarget, post-merge) → rebase + merge (review doubles as eval-diff blessing
   under whichever §8 you chose).

## Dashboard — LIVE on http://localhost:4630 (relaunched on this run's build, verified 200)

Serving THIS clone's `1365c5a` build. Same display-only posture as Wave-1's launch: state root
`%LOCALAPPDATA%\kb-agent-platform-w1-display`, execution latch unset, all cadences interval-0,
live 5317 untouched. Launcher: `%LOCALAPPDATA%\kb-agent-platform-w1-display\run-display-w2.ps1`
(the old `run-display.ps1` still points at the worktree — superseded). Unlock with your passkey,
then look at: **Schedules in the sidebar** (top-level now — open a row for run history, hit Edit
for the recurrence picker), **Grades History** in Agent Platform, and **agent-maintainer** in
the roster.

## Full-vitest verdict (final)

Full-parallel sweep: 3311 passed / 25 failed. All 25 accounted for, **zero Wave-2 regressions**:
18 recovered green when the same files ran serially (`--maxWorkers=1` — the documented
load-flake class; heavy git/process fixtures), 7 are the pre-existing CommandPalette sign-in
baseline (fails identically alone; file untouched since Wave-1 documented it). Wave-2's own
suites: green in both modes.
