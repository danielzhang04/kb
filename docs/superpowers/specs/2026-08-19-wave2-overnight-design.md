# Wave-2 overnight run — design spec (Daniel-approved 2026-08-19, pre-run)

Overnight unsupervised build on `claude/agent-platform-w1` in worktree
`C:/Users/danie/kb-worktrees/agent-platform-w1`. Boss terminal orchestrates; codex-only
workers (terra build / deep review), claude fallback only on a codex capability gap, on a
verified lower model. Merge stays DEFERRED (VM migration first, per Daniel 2026-08-19);
everything lands on this branch.

## Daniel's rulings folded in (decided 2026-08-19, do not re-ask)

- Scope = ALL units A–G below.
- Rule-8 rewrite: draft BOTH blessing variants (human-bless / review-bless+human-ratify)
  side by side; Daniel picks in the morning. Self-judgment wall (no agent authors/edits
  evals that judge itself) is non-negotiable in both.
- Maintainer agent: build + fixture dry-run ONLY. No live fire, no cadence registration.
- Tonight's evals/ dispensation: workers may CREATE new eval suites/cards via the factory
  path only, never edit existing eval content; every new manifest left UNBLESSED for
  Daniel. (Recorded exception to rule-8-as-written, per Daniel's ruling that agents will
  author evals under good governance.)
- Recurrence picker: ONE reusable gcal-style component (day-of-week toggles, multiple
  times/day) compiling to 5-field cron, surfaced at EVERY scheduling instance. Never a
  per-panel one-off.
- Schedules panel moves to sidebar top-level (like Claude's), out of the Agent Platform
  section; it houses Daniel's schedules/routines.
- Morning deliverable: :4630 relaunched on the new build + `MORNING-REPORT-WAVE2.md`
  with per-function summaries at the top.

## Units

**A · Maintainer cadence agent.** Created via `scripts.agent_factory` (canonical def +
memory + scaffolded eval suite, manifest unblessed). Job per fire: read eval-trigger
reports, grades ledger, `memory/*.md` lessons, parked/failed cards; synthesize; emit
improvement edits to agent defs / memory files / role policies as PRs or cards ONLY —
never direct writes, never `evals/`. Loop passes loop-design-check: bounded per-fire
scope, machine-decidable done, parks to Daniel on no-progress. Proof: end-to-end run
against FIXTURE ledgers/cards produces a coherent improvement PR draft; its own eval
suite covers job basics. Cadence HEARTBEAT entry drafted in the report, not committed.

**B · Agent-building skill.** `skills/curated/agent-builder/` (kb skill shape). Loads
when a terminal creates/iterates an agent: carries the guidelines doc (single source),
elicits job/loops/delegation/permissions/failure-modes, suggests eval cards, drives
`agent_factory`, drafts eval cards for Daniel's blessing. Proof: fresh-context session
uses only the skill to build a toy agent correctly (def + memory + suite + draft cards),
then toy artifacts removed.

**C · Grades-history panel.** Read-only per-identity history: grade/eval rows over time
from the pinned ledgers, filterable, answers "did my change help". Same gating/registry
pattern as existing panels (zero-edit `*.panel.tsx` registry).

**D · Dashboard cluster.** (1) Reusable recurrence-picker component → cron, wired into
Schedules edit/create prefill flow (and any other scheduling surface present).
(2) Schedules → sidebar top-level. (3) Per-schedule run history: row expands to
fired-when (`scheduled_for`/`dispatched_at`), outcome, and output sourced from card
`## Result` + ledgers. Panel stays pause-only/no-arm; edits still PR-only.

**E · U7 regrounding-hook rework.** Per the rework header in
`docs/proposals/regrounding-hook.md`: SessionStart(source: compact) always;
PostToolUse + UserPromptSubmit behind a shared state-file throttle; payload byte-stable;
stays INERT. Tests updated; arming remains Daniel's post-merge act.

**F · Rule-8 rewrite draft.** New text for `governance/agent-rules.md` §8 drafted as a
proposal file (governance is human-edited — Daniel applies): agents may author evals
under governance; hard wall = self-judgment; both blessing variants presented with
trade-offs. Include the card-schema amendment draft (`scheduled_for`/`dispatched_at`/
`kit_sha`) in the same proposal for Daniel's one sitting.

**G · Cleanups.** Stale "20 canaries" line in `evals/canaries/README.md`;
lesson-appended + ledgered-cost fleet cards (honest limits removed); ladder-union
exclusion of `eval-suite`; L2 `when`-routing exercise.

## Run mechanics

- Per unit: boss brief (exact files, norms, not-touch list, acceptance) → codex build →
  fresh-context codex-deep adversarial review → boss grade → commit + push. Max 2 rework
  cycles then PARK and continue; parks documented in the report with mechanism diagnosis.
- Order: F and G first (cheap, unblock nothing), then A ∥ D, then B (uses A's factory
  learnings), then C, then E. Dashboard units serialize with each other; agent units
  parallel to dashboard units, disjoint files.
- Proof floor after EVERY landed unit: full pytest + vitest + tsc + 21/21 canaries +
  panel/view/surface manifests green. Nothing armed: no live cadence, no hook
  registration, no maintainer live fire, no unpause.
- Coordination writes (dispatch cards, cost rows) via ops per constitution. Work commits
  only on `claude/agent-platform-w1`.

## Morning gates (pre-listed; the run invents no new ones)

1. Rule-8 variant pick + apply; card-schema amendment apply.
2. Bless new eval manifests (maintainer agent, skill's toy-drafted cards if kept).
3. Approve maintainer's first live fire + its cadence entry.
4. Residue call: `queue/paused/{nightly-review,weekly-audit}` keep/clear; 2 stray audit
   rows in `ledgers/audit/dashboard-audit.ndjson`.
5. Review parked units, if any.

Later, unchanged: VM migration window → hook arming ceremony → rebase + merge (review
doubles as eval-diff blessing under the chosen rule-8 variant).
