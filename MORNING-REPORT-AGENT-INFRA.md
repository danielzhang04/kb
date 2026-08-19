# MORNING-REPORT — Agent-Building Infrastructure arc

**Branch:** `claude/agent-platform-w1` · arc commits `0e2aebec..5579091c` (spec → plan → 10 tasks → platform proof → audit fixes) · pushed, **nothing merged**
**Result:** all 10 plan tasks DONE; platform proof ran live and caught 1 real defect (fixed); final codex-deep goal audit findings all closed on the code side; **2 items are deliberately left as YOUR ceremony** (below). $0 API spend; every worker/reviewer model verified.

## What you got (one sentence each)

1. **Kit** — `kit/` doctrine blocks (budgeted, `read_only`-gated, both precedence laws) assembled into `kit/.rendered/<audience>.md`; edit a block, run sync, every agent's next spawn carries it.
2. **Delivery** — `sync_skills` projects kit to both runtimes + regenerates the render (drift-gated in nightly `--check`); codex dispatches get it PREPENDED live (proven: probe worker quoted doctrine it received above its brief; card stamped `kit_sha` = exact commit); Claude-side waits on your U7/U9 arming (documented, inert).
3. **Factory** — `py -3 -m scripts.agent_factory new <id> --role <role>`: canonical def + memory + adopted-or-scaffolded eval suite, injection-proof inputs, reserved ids refused, rollback on failure; governance edits become a valid draft card for you, never written by the tool.
4. **Evals** — per-agent golden suites on the canary discipline (all-files manifests, human bless) + the 5-card `_fleet` floor every agent inherits; grades land in the UNCHANGED pinned ledger under `worker=eval-suite` — a canary now proves eval rows can never feed an agent's autonomy.
5. **Trigger** — `py -3 -m scripts.eval_trigger --range <git-range> [--run] [--report-out …]`: maps kit/def/suite diffs to affected agents, runs suites REPORT-ONLY (exit-0 law test-pinned incl. crashes, unwritable outputs, unicode), markdown report with rollups.
6. **Scheduler** — `due()` accepts 5-field cron inside `schedule:` (Claude-routines fire rule: skip, never replay; re-timing voids standing auth — canary'd); cards stamp `scheduled_for`/`dispatched_at`; six live cadences byte-untouched.
7. **Schedules panel** (:4630, after unlock) — every cadence with paused/last-run/narration, HEARTBEAT edits that PREFILL the file and open a PR you merge, pause via the STOP floor, **no unpause/run affordance anywhere** (arming stays a manual ops act).

## YOUR pre-merge ceremonies (in order)

1. **Rule-8 ratification (the big one).** `governance/agent-rules.md` §8: agents never touch `evals/`; re-bless is human-only. This arc's eval suites + the `promotion-eval-namespace` canary were agent-built (under your approved spec), manifests boss-re-derived; the final codex worker REFUSED further `evals/` edits — the rule is enforcing itself. Your merge review is the ratification act for the existing diffs. Ruling needed: ratify as-is, or re-author the canary card yourself first.
2. **Fleet env card fix + re-bless** (5 min, and it clears the one deliberate RED): `env: parent` was removed from code (constitution: credentials never copied) so `evals/agents/_fleet/no-api-key-in-env.md` now fails loud. Edit its `input.env:` line to `env_vars: [ANTHROPIC_API_KEY]`, optionally add the model-judged demo card (`judge: model` per `evals/agents/README.md`), then:
   `py -3 -m scripts.agent_evals run fyt-runner --fleet --update-manifest`
   `py -3 -m scripts.agent_evals run demo-agent --update-manifest`
   Commit both manifests yourself. After this, `run demo-agent --fleet` should be 5/5 again.
3. **Post-merge:** run `python scripts/sync_skills.py` once in the main checkout (regenerates the gitignored renders there); first live scheduled fire = you commit a cadence via the panel's PR flow.

## Proofs run (all on this tree)

- Full pytest sweep: **1243 passed, 0 failed** · dashboard: panels 86/86, views 154/154, surface+index 120/120, tsc clean · canaries **21/21**.
- Factory→eval→ledger live: demo-agent created (pre-existing suite ADOPTED — a live defect the proof caught and we fixed), recorded grade row in the reserved namespace, fleet floor 5/5 at the time of proof (now 4/5 pending ceremony 2 — deliberate).
- Kit delivery live: codex probe (luna, read-only) echoed kit doctrine received above its brief; ops card `6a8510d2` carries `kit_sha: c2675223` == HEAD at dispatch.
- :4630 relaunched on this build; `/api/panels/schedules` answers 401 unauthenticated (gated, live). Unlock to view the Agent Platform section incl. the new Schedules panel.

## Decision-notes (yours, beyond the ceremonies)

- `governance/card-schema.md` amendment: declare `scheduled_for`/`dispatched_at`/`kit_sha` (snake_case dispatcher-stamp family).
- Wave-2 candidates: grades-history panel (the "did my change help" reading — trigger's `--report` is the interim), lesson-appended + ledgered-cost fleet cards (current cards state their limits honestly), ladder-union exclusion of `eval-suite`, L2 `when`-routing exercise, `evals/canaries/README.md` stale "20 canaries" line.
- Kit reach today: codex = live; Claude subagents/boss = after U7/U9 arming (U7 can point `KB_GOAL_STATE_PATH` at the render with zero code changes).
- Pre-existing, out of scope: `stop/floor.ts#pauseCadence` doesn't sanitize `name`; 3 older spool files under `%LOCALAPPDATA%\kb-codex-dispatch\spool\` predate this session.
- Two outage-spooled done cards were re-published to ops (`3a3e479e`) and cleared locally.

## Session integrity

3 network outages killed 5 workers mid-task; all resumed from transcripts with zero work lost. Review pipeline: every task got fresh-context unit Inspector + goal Auditor (opus until your codex-only order, then codex), FAIL verdicts drove 6 rework rounds, review-caught highlights: CRLF false-tamper (twice), authorization-widening calendar keys, self-graded autonomy path, blank-the-HEARTBEAT edit box, full-env copy to card subprocesses. Codex-only regime active from your order onward (audit + final waves all codex).
