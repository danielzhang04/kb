# Token discipline — design (2026-09-11)

**Status:** APPROVED in chat 2026-09-11 (rulings §0). Boss session (Fable 5.1).
**Goal:** cut subscription-token burn on this machine by shrinking what every turn re-sends, without
losing decisions, rulings, or subagent continuity, and make the burn visible at every session start.
Success = (a) a boss session's average context per turn stays under 150k after a reset boundary;
(b) no single tool result over 50 KB enters a Fable/Opus context; (c) yesterday's Claude + Codex token
totals appear in the SessionStart frame; (d) the repo is smaller after this PR than before it.

## 0. Rulings (Daniel, 2026-09-11)
1. Measure only. No warn, no freeze. The number is shown; nothing enforces it yet.
2. MCP servers stay available with identical names, instructions, and planning; lazy-load only if it
   changes nothing about use. If it cannot be done cleanly, measure the load cost and leave them.
3. Codex boss terminal stays `gpt-6-astra`; its child dispatches use lower tiers/effort.
4. Boss resets at the next task boundary after 150k context, never mid-loop.
5. Cleanup may delete anything that nothing functional or future-facing depends on, as reviewable PR hunks.

## 1. Evidence (09-06 → 09-11, weighted proxy, full tables in `docs/superpowers/specs/2026-09-11-token-discipline-evidence/`)
- Claude $4.36k-eq / Codex $2.92k-eq. 97% of Claude tokens are cache reads. Six boss sessions:
  parent 59% / children 41%. Top sessions averaged 500k–880k context per turn over 370–720 turns.
- 27 of 335 sessions ever compacted; those stayed ≤ 105k context and cost $5–60 each.
- Context growth: Bash 52% + Read 43% of tool-result bytes; three PDF Reads of ~220 KB each.
- Fixed load context on this boss: ~67k tokens at turn 1 (system prompt, tool list, CLAUDE/BOSS.md,
  memory index 15 KB, skill list).
- Codex: interactive `gpt-6-astra` at `high`; top three sessions ran 2,000–3,200 round-trips to ~290M
  cumulative tokens across `--follow-up` chains without reset.
- Nothing measured it: `ledgers/cost` empty since 07-18 (subscription steps log 0), cco recorded nothing,
  132 fleet review workers in one week invisible.

## 2. The five levers, in build order
| # | Lever | Mechanism | Target |
| --- | --- | --- | --- |
| L1 | Measure | `scripts/usage_ledger.py` + frame injection | yesterday's totals in every SessionStart |
| L2 | Reset at boundary | decisions log + compact hooks + 150k rule | boss avg ctx < 150k |
| L3 | Guard the context | PreToolUse size/type guard, subagent-first reads | no >50 KB result in Fable/Opus |
| L4 | Load context | measure breakdown; trim memory index + BOSS.md; MCP per ruling 2 | load ≤ 40k |
| L5 | Turns + Codex | brief rules; codex child effort | fewer round-trips per task |

## 3. L1 — measurement
`scripts/usage_ledger.py` (stdlib, `py -3`, read-only over transcripts):
- Sources: `~/.claude/projects/**/*.jsonl` (+ `subagents/*.jsonl`) usage fields; `~/.codex/sessions/**/rollout-*.jsonl`
  `total_token_usage` (max per file). Never reads a file being written by the current session beyond its last
  complete line; never reads rollout files from inside a Codex worker (self-ingestion hazard).
- Output: `ledgers/usage/<YYYY-MM-DD>.tsv`, one row per (runtime, model, session, parent|subagent) with
  input / cache_create / cache_read / output / turns / max_ctx, plus a `_totals` row. Idempotent per day.
- Invocation: `usage_ledger.py --date <d>` (default yesterday), `--summary` prints the one-line totals.
- Frame: `project_frame_session_start.js` appends `## Usage (yesterday)` = the `--summary` line when the
  ledger file exists (≤ 200 chars); the hook never runs the parser. The parser runs once per day from
  `scripts/preamble.py` when yesterday's file is missing (≤ 5 s budget, fail-open, never blocks preamble).
- Ledger is a coordination write → ops. Weighted-cost columns are labeled `est_` with the rate table in
  the file header.

## 4. L2 — reset at a boundary
- **Decisions log.** `orgs/<p>/STATE.md` gains `## Decisions` (≤ 10 bullets, newest first, each
  `YYYY-MM-DD — <ruling> — <why>`); the boss writes a bullet the moment Daniel rules in chat, and the
  frame injects it. Older bullets roll into the arc's handoff on close. The lint enforces the heading.
- **Compact path.** `.claude/settings.json` sets `autoCompactWindow: "150k"` (project scope). PreCompact
  (armed) writes the deterministic summary; compact-time SessionStart (armed) re-injects
  GOAL/STATE/Decisions/summary. The compact prompt is not customizable, so nothing durable may live
  only in the transcript: rulings go to `## Decisions`, task state to the SDD ledger, at the moment
  they happen. Auto-compact may fire mid-loop; that is acceptable because the ledger is written per
  step (ruling 2026-09-11). Hooks cannot read the context size; the statusline shows
  `context_window.used_percentage`, which is the boss's cue for the manual boundary rule.
- **Boundary rule (BOSS.md, Daniel edits; proposed text in the handoff).** Past 150k: finish the current
  task's review or fix round, write the ledger/handoff, then either let auto-compact run or end the turn
  with "restart me". Running subagents continue; their notifications arrive after compaction.
- **Handoff hygiene.** `save-session` deletes the superseded handoff for the same scope when writing a
  new one; the sweep already flags the rest.

## 5. L3 — guard the context
`scripts/hooks/context_guard.js` (PreToolUse, matcher `Read|Bash`), fail-open, exit 2 only on the rules below:
- Read of `.pdf` / image extensions in a session whose model is Fable/Opus (from the store's model note
  written by SessionStart from `event.model` if present; else no guard) → deny with the message
  "delegate to a haiku extractor (Agent, model haiku) and read its summary".
- Bash whose command pipes to no filter and matches a known-verbose pattern (`pytest` without `-q`/`tail`,
  `git log` without `-n`, `cat` of a file > 50 KB, `find /`) → deny with the exact fixed command.
- Everything else allowed. Tests per rule; a denylist file `governance/context-guard.yaml` (Daniel-owned)
  holds the patterns so they change without code.
- Brief rule (all dispatch templates): subagents write full output to a file and return ≤ 300 words.

## 6. L4 — load context
- Task 0 measures the breakdown once (system prompt vs tool list vs CLAUDE/BOSS vs memory index vs skills)
  from a fresh session's turn-1 usage and the cco-overhead skill; numbers go in the PR.
- Memory index (`MEMORY.md`, personal): arc summaries collapse to one line each pointing at the ops STATE;
  the frame carries the content now. Target ≤ 4 KB.
- BOSS.md: proposed trim to the rules only (diff in the handoff; Daniel edits).
- MCP: per ruling 2. Investigate `.mcp.json` scoping / deferred-tool behavior; adopt only a change that
  keeps names, instructions, and use identical. Otherwise record the cost and stop.

## 7. L5 — turns and Codex
- Dispatch templates: independent tool calls in one turn; `Monitor` for waits; one status line per phase;
  never re-run a check the report already shows.
- `dispatch-codex` skill: child runs default `gpt-5.6-terra` + `model_reasoning_effort=medium`
  (`luna` for grunt); `--follow-up` limited to 2 hops then a fresh `--cwd` dispatch (existing lesson).

## 8. Cleanup (same PR, reviewable hunks; nothing functional touched)
- Delete the dead U7 GOAL-STATE plan (`2026-08-18-agent-platform-GOAL-STATE.md`, formerly under
  `docs/plans/`) and the three `docs/proposals/*hook*.md` now superseded by the 2026-09-11 spec
  (the spec keeps their arming table). [Done 2026-09-11, Task 6 — see
  tests/test_cleanup_no_dangling_refs.py.]
- Delete superseded plan docs whose PRs merged (list produced by Task 0 from `git log`; each one named).
- Personal memory: arc files for merged/closed arcs collapse to pointers.
- Root-level stray files in the main checkout (`*.png`, `*_tmp.txt`, `p5_plan_b380.md`, …) are untracked
  and not this PR's; listed in the handoff for Daniel to delete.

## 9. Verification facts (claude-code-guide, 2026-09-11, official docs)
- `autoCompactWindow` setting: absolute tokens, 100k–1M, forms `150000` / `150k`; default per model undocumented;
  no hook or model can trigger compaction (docs: model-config, cli-reference).
- Compact summary prompt: not customizable; what survives is not exhaustively documented (commands, prompt-caching).
- Subagent notifications after compaction: undocumented; verified empirically in Task 0 (dispatch, force
  `/compact`, confirm the notification arrives).
- MCP: no lazy connect; `enabledMcpServers` / `disabledMcpServers` / `--mcp-config` / `--strict-mcp-config`
  choose servers; subagents inherit unless the agent definition sets `mcpServers`; deferred tools cost ~120
  tokens for the listing vs ~10% of the window for full schemas (docs: mcp, sub-agents). Ruling 2 outcome:
  servers stay; per-agent `mcpServers` restriction for builders/reviewers is the only change.
- Statusline JSON: `context_window.total_input_tokens`, `context_window_size`, `used_percentage`,
  `current_usage.*` (docs: statusline). Hooks have no supported access.
- Codex compaction / per-dispatch effort: not in public docs; Task 0 probes `codex --help` and config.

## 10. Tests
- `tests/test_usage_ledger.py`: fixture transcripts (Claude + Codex shapes), idempotent day file, max-per-file
  Codex semantics, summary line ≤ 200 chars, skips a half-written last line.
- `tests/test_context_guard.py`: each rule allow/deny, fail-open on malformed input, denylist file parse.
- `tests/test_project_frame_lint.py`: `## Decisions` required; `tests/test_project_frame_session_start.py`:
  usage line appended when present, absent otherwise.
- Live: one fresh boss session shows the usage line; one blocked PDF Read with the delegate message.

## 11. Out of scope
Enforcement (ruling 1); OTel/Grafana; usage-monitor apps; proxies (break cache + auth); spawning a successor
boss automatically (mechanism 3) — revisit after L2 has run for a week.
