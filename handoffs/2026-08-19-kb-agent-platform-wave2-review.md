# agent-platform Wave-2+W3 built, reviewed, gates closed — 2026-08-19

**Topic:** Overnight Wave-2 build (7 units) + W3 extension (versioning, eval forecast) + Daniel's
live review session (4 UI rounds + gates 1/2/4 closed). Branch `claude/agent-platform-w1` @
`0739a44`, pushed, in STANDALONE CLONE `C:/Users/danie/kb-clones/agent-platform-w2`. Merge
deliberately deferred. NOTE ON RESUME: `handoffs/2026-08-19-cloud-migration-cutover-COMPLETE.md`
appeared during this session — if the cutover is verified clean, gate 5 (rebase+merge) is
unblocked.

### What WORKED (with evidence)
- **Wave-2 7/7 + W3 2/2 landed** — every unit codex-terra built, codex-sol adversarially
  reviewed (9 rework rounds Wave-2, 2 W3), boss-verified: final pytest 1390/0, tsc green,
  vitest zero regressions (25 full-parallel fails = 18 load-flakes proven serial-green + 7
  pre-existing CommandPalette). Evidence in `MORNING-REPORT-WAVE2.md` (clone root).
- **Gates 1/2/4 closed with Daniel** — rule 8 V-human applied (`172dba2`), manifests blessed
  fleet-floor 7/7 both agents (`0506e24`, state-pin retargeted `08639ba`), residue cleared.
- **Schedules UI 4 live-review rounds** (`814aa43..ffc856f`): gcal dropdown+selectors, pure
  neutral grays (R=G=B), ink-inversion states, native-form-control theming. Daniel: "Better."
- **Real defects found+fixed by the run**: eval-suite rows reached promotion math (canary
  claim was too broad); manifest hashing checkout-dependent (CRLF false-tamper, G2 `1365c5a`);
  ledgers-cost-row floor failed never-dispatched agents (v2 vacuous pass, blessed).

### What Did NOT Work (and why)
- **codex 0.148.0 npm (2026-08-18)** — breaks Windows spawn (`codex-windows-sandbox-setup.exe`
  not found). Workaround LIVE: pinned 0.147.0 at session scratchpad `codex-pin/`, PATH-prepended
  in POSIX form per dispatch. A resuming session must re-pin (own scratchpad) or fix globally.
- **Follow-up dispatch for a writing rework** — wrote into the main checkout (known
  codex-followup-loses-cwd); contained. Law: writing reworks = fresh dispatch with --cwd.
- **taskkill trusted by exit code** — a "killed" worker survived (exit 128 unread) and built
  Task C unsupervised; audited hostile + reviewed before landing. Law: verify kills by
  process liveness.
- **Linked worktree treated as "off main"** — every git op in kb-worktrees/agent-platform-w1
  writes main-repo .git; moved to the standalone clone mid-run for Daniel's cloud move.

### What Has NOT Been Tried Yet
- Maintainer FIRST LIVE FIRE + cadence commit (gate 3, Daniel deferred to post-merge);
  drafted entry: `docs/proposals/maintainer-cadence-entry.md`.
- Rebase+merge → main + post-merge `python scripts/sync_skills.py` + U7/U9 hook arming
  ceremony (proposal has the 3 registrations) + worktree/clone sweep.
- Wave-3 remainder: run-pinning in the workflow engine (workflow-platform branch), grades
  ledger provenance fields for rule-8 V-review, brain sidecar perf.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| clone `kb-clones/agent-platform-w2` @ 0739a44 | DONE | all work pushed; only untracked residue (.tmp ACL-locked) + uncommitted audit-ndjson rows (die with sweep) |
| `MORNING-REPORT-WAVE2.md` (clone root) | DONE | review entry; gate status section current |
| worktree `kb-worktrees/agent-platform-w1` | TODO | retired lease @ 113dcfb1-era; sweep after merge; ACL dirs need Daniel's elevated delete |
| :4630 display server | DONE | serving clone build via `%LOCALAPPDATA%\kb-agent-platform-w1-display\run-display-w2.ps1` |
| `governance/agent-rules.md` §8 + `card-schema.md` | DONE | Daniel's V-human ruling applied ON THE BRANCH (takes force at merge) |

### Exact Next Step
Verify the cloud cutover is clean (see cutover-COMPLETE handoff), then rebase
`claude/agent-platform-w1` on main and merge (gate 5); Daniel's merge review doubles as the
eval-diff blessing record. Then gate 3 (maintainer supervised fire → cadence commit).

### Load list
- `handoffs/2026-08-19-kb-agent-platform-wave2-review.md` (this file)
- `MORNING-REPORT-WAVE2.md` at clone root (review entry + gate status)
- personal memory `agent-infra-arc.md` (resume point) + `memory/claude-boss.md` 2026-08-19 lessons
- `docs/proposals/`: `maintainer-cadence-entry.md`, `regrounding-hook.md`, `agent-versioning.md`,
  `agent-arch-reconciliation.md` (Wave-3 list)
