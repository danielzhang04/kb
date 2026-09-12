# Task 0 — Probe results (2026-09-11)

Run directly in `C:/Users/danie/kb-worktrees/token-discipline` (branch `claude/token-discipline`),
no branches/subagents. Four probes per the brief, plus the controller's hook-keys probe folded
into Probe A's section. Every command below was run from this worktree.

---

## 1. `event.model` on SessionStart / PreToolUse (controller req. 1)

Method: a temp Node hook script `dump_event.js` (in the scratchpad, `t0/`) writes only the
top-level **keys** of the hook's stdin JSON (never values) to a file. Registered via a throwaway
`--settings` JSON that adds nothing else.

**SessionStart** — `claude -p "say ok" --model haiku --settings <t0/settings-sessionstart.json> --allowedTools "" < /dev/null`

Keys observed:
```json
["session_id", "transcript_path", "cwd", "hook_event_name", "source"]
```

**PreToolUse** (matcher `Read`, prompted to read a small scratch file, `--allowedTools "Read"`) —
Keys observed:
```json
["session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "hook_event_name", "tool_name", "tool_input", "tool_use_id"]
```

| field | SessionStart | PreToolUse |
|---|---|---|
| `model` | **absent** | **absent** |
| `permission_mode` | absent | **present** |
| `transcript_path` | **present** | **present** |

**Verdict:** `event.model` is not delivered on either SessionStart or PreToolUse in this build
(2.1.269). Anything in the spec/design that assumed a hook could read the active model from
`event.model` needs a different source (e.g. the `model` attachment recorded in the transcript
itself, or `claude --model` echoed back some other way) — this is a correction to any such
assumption. `transcript_path` is reliably available on both events, which is what matters for
L1/L2 measurement hooks that need to read the transcript.

---

## 2. Load-context breakdown (controller req. 2, supersedes brief's `/context` method)

Fresh `claude -p "reply with the single word: pong" --model haiku` session in this worktree (no
`--resume`/`--continue`). Transcript:
`~/.claude/projects/C--Users-danie-kb-worktrees-token-discipline/58adeb63-c1d5-4174-a6d0-ae36b0415521.jsonl`.

**Load total** (turn-1 `message.usage`): `input_tokens` 10 + `cache_creation_input_tokens` 16,539 +
`cache_read_input_tokens` 20,875 = **37,424 tokens**.

Known components, sized from the transcript's own attachment records for that turn (chars/4 of
the serialized attachment content — a proxy, not exact API tokenization):

| component | source attachment | chars | ~tokens |
|---|---|---|---|
| `CLAUDE.md` | `instructions` files[0] | 2,748 | 687 |
| `BOSS.md` | `instructions` files[1] | 5,132 | 1,283 |
| `MEMORY.md` (personal auto-mem, `~/.claude/projects/C--Users-danie-kb/memory/MEMORY.md`) | `instructions` files[2] (type `AutoMem`) | 15,607 | 3,902 |
| Skill list (106 enabled skill descriptions — plugins + repo `skills/`) | `skill_listing` | 11,624 | 2,906 |
| MCP tool-name listing (103 of 125 deferred names are `mcp__*`; using the `addedLines` text actually shown, scaled by name-count share) | `deferred_tools_delta` | ~4,720 of 5,723 `addedLines` | ~1,179 |
| **Known subtotal** | | | **9,957** |
| **Remainder → system prompt + built-in tool schemas** | | | **27,467** |

Cross-check: the final `prompt_snapshot` attachment (the literal payload sent to the API) carries
`systemPrompt` (24,725 chars, ~6,181 tok) + `tools` (98,330 chars, 14 built-in tools with full
schemas, ~24,583 tok) = ~30,764 tok, in the same ballpark as the 27,467 remainder (the gap is
caching/attachment-vs-API-token estimation noise, plus a few smaller uncounted attachments —
`agent_listing_delta` 1,768 tok, the `superpowers:using-superpowers` skill dump 1,267 tok,
`session_context`/`environment`/`model`/`date` ~500 tok combined).

**Delta vs. spec's ~67k estimate:** measured today's real number is **37,424 tokens**, well under
the spec's ~67k figure. This is **not apples-to-apples** with the spec's number, and should not be
read as "the fixed load shrank" — three real differences: (a) this probe ran on `haiku`, not the
boss session's `sonnet`/`opus`; (b) the `codex` MCP server failed to connect
(`CONNECTION_CLOSED`) in this environment, so its tool schemas never loaded, vs. a fully-connected
boss session; (c) this worktree's project has no accumulated project-frame `STATE.md`/history the
way the long-running main-kb boss session does. The measurement method (turn-1 usage sum) is
sound and should be re-run once on an actual boss-shaped session (main checkout, sonnet, full MCP
set) for the real like-for-like comparison — that re-run is out of scope for Task 0.

**One-line verdict:** load total = 37,424 tok this run; top components CLAUDE.md 687 / BOSS.md
1,283 / MEMORY.md 3,902 / skills 2,906 / MCP names ~1,179; remainder (system prompt + built-in
tool schemas) ~27,467 — confirms the components the spec named, but the spec's ~67k figure isn't
directly comparable (different model + MCP connection state) and needs a same-shape re-measurement
before L4 work sizes its cut.

---

## 3. Codex compaction + per-run effort override

`codex --version` → `codex-cli 0.154.0`. Ran `codex --help`, `codex exec --help`,
`codex exec resume --help` (captured in full to `t0/codex-help.txt` etc.; excerpts below).

Grep of all three outputs for `compact`, `reasoning`, `effort`, `model_reasoning_effort`:
**zero matches in any of the three.** No subcommand, flag, or mention of compaction or reasoning
effort appears anywhere in `codex --help` / `codex exec --help` / `codex exec resume --help`. The
only generic override surface is:

```
-c, --config <key=value>
        Override a configuration value that would otherwise be loaded from `~/.codex/config.toml`.
        Use a dotted path (`foo.bar.baz`) to override nested values. The `value` portion is parsed
        as TOML. If it fails to parse as TOML, the raw string is used as a literal.
```

This confirms `scripts/codex_dispatch.py`'s mechanism (`-c model_reasoning_effort=<value>`, see
`spawn()`) is a valid *generic* config override — the flag works because `-c` accepts any dotted
key, not because `--help` documents `model_reasoning_effort` or its enum. The five values in
`EFFORTS = ("low", "medium", "high", "xhigh", "max")` are **not independently verifiable from
`--help` or from the installed package** (`@openai/codex`'s bundled `README.md` also has zero
mentions of `reasoning`/`effort`/`compact`; no `docs/config*.md` ships with the npm package on this
machine) — confirming them would require either a live `codex exec` run against the real API
(not done here — no product code, no spend) or upstream docs outside this machine. Record this as
unconfirmed-but-unfalsified: nothing contradicts the five values, nothing outside
`codex_dispatch.py` itself confirms them either.

**Verdict:** no Codex compaction-equivalent flag exists in the public CLI surface (`--help` across
all three commands checked) — this matches and confirms the spec's §9 anticipation verbatim
("Codex compaction / per-dispatch effort: not in public docs"). Per-run effort override exists
only via the generic `-c model_reasoning_effort=<value>` TOML override, consistent with what
`codex_dispatch.py` already does; the specific five-value enum remains unverified from local
artifacts.

---

## 4. Subagent notification survives `/compact`

This cannot be scripted or run headlessly — it requires an interactive Claude Code session with a
live subagent dispatch and a manual `/compact`. **Not run in this probe pass.** Exact manual
procedure for the controller (or Daniel) to execute in an interactive session:

1. Open an interactive `claude` session in a repo of reasonable size (kb main checkout is fine).
2. Dispatch one backgroundable subagent via the `Agent` tool — `general-purpose`, doing a moderate
   repo search/grep task chosen to take roughly 60-90 seconds (e.g. "search the whole repo for
   every reference to X and summarize where they live" over a directory with a few hundred files).
   Do not wait for it.
3. Immediately after the dispatch tool-call returns (i.e. before the subagent reports back), run
   `/compact`.
4. Watch the compact summary land, then send at least one more ordinary message/turn to the main
   session (anything — a question, a status check) and keep working normally.
5. Wait for the subagent's completion notification to arrive (it will appear as a tool result /
   system notification in the transcript, the same way it would without a compact in between).
6. Record, verbatim:
   - Did the notification arrive at all, or silently vanish?
   - Did it carry the **full** result text, or a truncated/placeholder one?
   - Any visible error, duplicate notification, or reference to a subagent/tool-use ID that no
     longer resolves (a common failure shape when a compact drops the tool_use/tool_result pairing
     that a subagent result depends on)?
   - Whether the main session's context after compact still contains enough state to make sense of
     the notification when it lands (e.g., does it still know why that subagent was dispatched).

**Result: PENDING (manual)** — needs an interactive session; the controller should run the five
steps above and fill in the observation before Task 6 (or whichever later task depends on this
fact) treats it as settled. This directly stands in for the spec's §9 "undocumented; verified
empirically in Task 0" line — it is *not yet* verified, only the procedure is now written down.

---

## 5. Superseded-plan candidates for Task 6 (follow-up list only — not executed here)

Scope, per controller req. 5: every file in `docs/superpowers/plans/*.md` (16 files) and
`docs/plans/*.md` (42 files), 58 total. Method: (a) merge status cross-checked against
`gh pr list --state merged --limit 200` (167 merged PRs fetched) and the memory arc pointers
already in context; (b) reference status via `grep -rlF <basename>` across the whole repo
(excluding `.git`/`node_modules`), filtered to non-self hits. A file is a DELETE candidate only if
its work is merged **and** every hit is itself a plan file (or the token-discipline SDD's own
meta files, which are self-referential to this very cleanup and not a product dependency); any
hit from a real spec/proposal/runbook/script/test/memory file means KEEP.

`docs/plans/2026-08-18-agent-platform-GOAL-STATE.md` is excluded from this candidate list — Task 6
already names it explicitly (design spec §8) as an assigned deletion target, not a Probe-D find.
Flag for its implementer: it's also referenced by `tests/test_regrounding_hook.py` — verify that
test doesn't load the file's content before deleting it.

### `docs/superpowers/plans/` — 12 DELETE / 4 KEEP

| file | verdict | reason |
|---|---|---|
| 2026-08-04-dashboard-bloat-inventory.md | DELETE | Feeds `deletion-manifest.md`/`workflow-platform-arc-prompt.md` (both also DELETE); work landed in #113 |
| 2026-08-04-dashboard-ux-overhaul.md | DELETE | Merged #113 ("UX overhaul arc... −7k LOC") |
| 2026-08-05-accent-swatches.md | DELETE | Status: DECIDED, landed 2026-08-05; folded into #113 |
| 2026-08-05-deletion-manifest.md | DELETE | Part of #113 cleanup; no non-plan reference |
| 2026-08-06-w1-worker-substrate.md | DELETE | Superseded into #113 (session console/workflow graph); no reference |
| 2026-08-06-w2-live-channel.md | DELETE | Superseded into #115 ("live mini-tails"); no reference |
| 2026-08-06-w3-running-graph.md | DELETE | Merged #115 ("running graph" — exact name match) |
| 2026-08-06-w4-click-in-panel.md | DELETE | Superseded into #116 (card-launches-workflow); no reference |
| 2026-08-06-w5-platform-chaining.md | DELETE | Merged #115 ("queue-bridge chaining" — exact phrase match) |
| 2026-08-11-workflow-platform-arc-prompt.md | DELETE | Superseded by #117 (P0) + #131 (P1); no non-plan reference |
| 2026-08-12-p1-iteration-loops.md | DELETE | Merged #131 ("workflow-platform P1: iteration loops" — exact match) |
| 2026-08-19-wave2-overnight.md | DELETE | Merged #139 ("Agent Platform Wave-1/2/W3"); only meta (task-6-brief/token-discipline plan) references |
| 2026-08-11-kb-structure-phase1.md | KEEP | Still referenced by `docs/superpowers/specs/2026-08-11-kb-structure-evidence/plan-adversarial-review.md`; memory: "Gate-1 CLOSED, remaining = 3 rulings + deferred work" (not fully done) |
| 2026-08-18-agent-infra.md | KEEP | Still referenced by `evals/agents/_fleet/test_def_parses_in_roster_shape.py` and `tests/test_dispatch_cron.py` (real test files) |
| 2026-09-11-project-frame-hooks.md | KEEP | Still referenced by `scripts/hooks/regrounding_hook.js` (live script), despite the arc itself being merged (#182) |
| 2026-09-11-token-discipline.md | KEEP | This is the plan currently being executed (Task 0 is one of its own tasks) |

### `docs/plans/` — 27 DELETE / 15 KEEP

| file | verdict | reason |
|---|---|---|
| 2026-07-15-agentic-os-m1.md | DELETE | Merged long ago (#1/#2/#6/#7/#8 m1-fleet/m1-dashboard); no reference |
| 2026-07-17-c7-agent-registry.md | DELETE | Despite its own "PLAN ONLY" header, the work merged (#15, #16, #20); no reference |
| 2026-07-19-atlas-v0-plan.md | DELETE | Merged #37; superseded by Atlas V1 (#44) |
| 2026-07-19-dashboard-four-fixes-design.md | DELETE | Memory: merged (July foundations); no PR # found in `gh` list (likely pre-numbering/squash), no reference |
| 2026-07-19-ecc-import-wave1-design.md | DELETE | Merged #32; only referenced by its sibling `-plan.md` (also DELETE) |
| 2026-07-19-ecc-import-wave1-plan.md | DELETE | Merged #32; no reference |
| 2026-07-20-atlas-v1-plan.md | DELETE | Merged #44 ("Atlas V1 Hands"), prod live per memory |
| 2026-07-20-branch-hygiene-cadence.md | DELETE | Merged #38; no reference |
| 2026-07-20-inbox-gates.md | DELETE | Merged #43; no reference |
| 2026-07-20-overnight-keep-awake.md | DELETE | Merged #36; only hit is `docs/research/_ig-saved/analysis/lifecycle-hooks-hygiene.md` — flag for the follow-up task to confirm that's coincidental, not a real dependency |
| 2026-07-21-agent-workspaces-design.md | DELETE | Superseded by dashboard-v3 full control-plane rebuild (#142); no reference |
| 2026-07-21-atlas-conversation-rules-plan.md | DELETE | Merged #62; no reference |
| 2026-07-21-atlas-output-follow.md | DELETE | Merged #62 (same PR covers output-follow); no reference |
| 2026-07-22-agent-first-workflows.md | DELETE | Merged #79 (+#83/#84 cleanup); no reference |
| 2026-07-27-handoffs-context-slim-design.md | DELETE | Merged #92; only referenced by sibling `-plan.md` (also DELETE) |
| 2026-07-27-handoffs-context-slim-plan.md | DELETE | Merged #92; no reference |
| 2026-07-30-codex-subagent-dispatch.md | DELETE | Merged #103; no reference |
| 2026-07-30-fyt-gated-pipeline.md | DELETE | Merged #106 ("GATE-1 ruling work"); no reference |
| 2026-08-04-headless-roster.md | DELETE | Explicitly subsumed by #113 ("subsumes headless-roster"); no reference |
| 2026-08-12-keepawake-supervisor-hardening.md | DELETE | Merged #119; no reference |
| 2026-08-18-agent-platform-program-spec.md | DELETE | Work merged via #139/#140; only referenced by sibling `GOAL-STATE.md`/`w1-BUILD-PLAN.md` and token-discipline meta files |
| 2026-08-20-dv3-p1-plan.md | DELETE | Merged #142 (P0-P7); only referenced by sibling `dv3-p2-plan.md` |
| 2026-08-20-vm-movement-phase1-plan.md | DELETE | Merged #140 ("VM-movement Phase 1"), deployed per memory; no reference |
| 2026-08-21-dv3-p2-plan.md | DELETE | Merged #142; no reference |
| 2026-08-23-dv3-p4-plan.md | DELETE | Merged #142; no reference |
| 2026-08-23-dv3-p5-plan.md | DELETE | Merged #142; no reference |
| 2026-08-23-dv3-p6-plan.md | DELETE | Merged #142; only referenced by sibling `dv3-p5-plan.md` |
| 2026-07-16-dashboard-implementation.md | KEEP | Still referenced by live code: `broker/preambleGate.ts`, `broker/stopWatch.ts`, `dashboard/server/write/branch.test.ts`, `dashboard/server/write/launch.ts`, `dashboard/README.md` |
| 2026-07-16-m1-fleet-implementation.md | KEEP | Still referenced by `tests/test_codex_config.py`, `memory/claude-boss.md`, `memory/housekeeping-agent.md`, onboarding docs |
| 2026-07-17-phase-r-model-routing.md | KEEP | Still referenced by live `scripts/routing.py` and `docs/proposals/model-routing-yaml-proposal.md` |
| 2026-07-18-dashboard-agent-workspaces-plan.md | KEEP | Status line reads "active" |
| 2026-07-18-dashboard-execution-control-plan.md | KEEP | Status line reads "Phase 1 implemented; Phase 2 partially implemented" |
| 2026-07-20-wave-a-activation.md | KEEP | Still referenced by `docs/proposals/2026-07-20-execution-controller-schema.md` |
| 2026-07-20-wave-a-live-fire-runbook.md | KEEP | Still referenced by `docs/runbooks/2026-07-20-wave-a-acceptance-runbook.md` |
| 2026-08-18-agent-platform-w1-BUILD-PLAN.md | KEEP | Still referenced by `docs/proposals/file-editing-guidelines.md` and `docs/proposals/subagent-governance.md` |
| 2026-08-19-desk-vm-movement-decisions.md | KEEP | Still referenced by `docs/specs/2026-08-20-desk-vm-movement-design.md` |
| 2026-08-22-dv3-p3-plan.md | KEEP | Still referenced by `dashboard/server/pty/p3AttackManifest.test.ts` and `tests/test_pty_linux_oracle.py` (real test files) |
| 2026-08-26-vm-runtime-streamline-design.md | KEEP | Still referenced by `dashboard/server/testFixtures/{gateResultsCore,lifecycleTypes,staticHttpServer}.ts` |
| 2026-09-03-outbox-drain-cadence-plan.md | KEEP | Status: PROPOSED, awaiting Daniel's ruling — the doc merged to main, but the work it describes has not |
| fyt-checker-runtime-design.md | KEEP | No matching merged PR found; merge status unclear — default to keep pending a real check |
| month-1-backlog.md | KEEP | Still referenced by `docs/proposals/model-routing-yaml-proposal.md` and `docs/specs/2026-07-16-m1-fleet-architecture.md` |
| 2026-08-18-agent-platform-GOAL-STATE.md | *excluded* | Already an explicit Task 6 deletion target (design spec §8), not a Probe D find — flagged above for its test reference |

**Verdict:** 39 DELETE candidates (12 in `docs/superpowers/plans/`, 27 in `docs/plans/`), 19 KEEP
(4 + 15), 1 excluded (already Task 6's own named target). This is a candidate list only — per the
brief, Task 6 in this plan stays scoped to its four named files; verifying each of these 39
individually (confirming the "nothing depends on it" claim beyond a single grep pass) is its own
follow-up cleanup task.

---

## Files consulted / produced

- Scratchpad: `dump_event.js`, `settings-sessionstart.json`, `settings-pretooluse.json`,
  `sessionstart-keys.txt`, `pretooluse-keys.txt`, `small.txt`, `codex-help.txt`,
  `codex-exec-help.txt`, `codex-exec-resume-help.txt`, `merged-prs.json` — all under
  `C:/Users/danie/AppData/Local/Temp/claude/C--Users-danie-kb/87f62e0a-ca11-43cf-bdf1-9e254dc3728c/scratchpad/t0/`.
- Transcript read for Probe 2: `~/.claude/projects/C--Users-danie-kb-worktrees-token-discipline/58adeb63-c1d5-4174-a6d0-ae36b0415521.jsonl`.
