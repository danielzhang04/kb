# Codex subagent dispatch — design (2026-07-30)

Approved by Daniel 2026-07-30 (interactive session). Approach A of three; MCP-only and
revive-agent_runner rejected (blocking contract / unattended-pipeline mismatch respectively).

## Goal

Any interactive Claude terminal in kb can delegate a task to an OpenAI Codex worker on a chosen
model with the same feel as the Agent tool: dispatch returns immediately, the worker runs in
background, the result lands back in the calling conversation as a task notification, and the
terminal stays free to keep working. A card + ledger row is written as the **audit record — not a
gate**: no dispatcher claim, no worker branch, no PR-merge in the result path.

**Success condition:** from a fresh kb Claude terminal, one skill-guided dispatch runs a codex
task in background, the terminal answers other prompts meanwhile, the notification carries the
codex result, and the completed card + cost row are visible on `ops`.

## Non-goals

- Not a replacement for the card queue / `agent_runner.ps1` unattended path (stays disabled,
  untouched except one arbitration filter).
- No daemon endpoint, no new long-running service, no dashboard UI.
- Workers never commit or push; the calling terminal reviews diffs and commits (same contract as
  Claude subagents).
- Claude-runtime dispatch stays on the Agent tool; this is codex-only.

## Verified facts this design stands on

- `codex` v0.145.0 native Windows (`codex.cmd`), keyring auth proven headless
  (`codex login status` exits 0 under Task Scheduler; no `auth.json`).
- Invocation shape (matches `scripts/agent_runner.ps1`'s reviewed convention):
  prompt on stdin → `codex exec - --model <id> --json --output-last-message <file>`;
  also supported: `-c model_reasoning_effort=<low|medium|high|xhigh|max>`, `-C/--cd <dir>`,
  `-s/--sandbox <read-only|workspace-write>`.
- Models on this box (`~/.codex/models_cache.json`): gpt-5.6-sol (configured default, high),
  gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex-spark.
- `codex mcp-server` (stdio) exists — the blocking short-call lane.
- Claude Code's Bash `run_in_background` notifies the calling conversation on process exit —
  this IS the Agent-tool-style return path; nothing to build for it.
- `agent_runner.ps1` claims owned cards where `state ∈ (inbox,working)` and
  `execution-controller != "dashboard"` — would double-execute record cards if re-enabled.

## Components

### 1. `scripts/codex_dispatch.py` (new)

Single owner of the dispatch lifecycle. Synchronous within its own process; the *caller*
backgrounds it. Stdlib-only (`py -3` — MSYS python lacks pip/yaml; card YAML via
`scripts/cards.py` primitives, which already avoid external deps).

CLI:

```
py -3 scripts/codex_dispatch.py --prompt-file <path> [--model <alias|id>] [--effort <tier>]
    [--timeout <seconds>] [--cwd <dir>] [--sandbox read-only|workspace-write] [--worktree]
    [--project <org>] [--label <short-slug>] [--follow-up <thread-id>]
```

Flow, in order:

1. **Gates** (all before any spawn): `STOP` file absent; `ANTHROPIC_API_KEY` set (preamble's own
   refusal); billing guard — refuse if `OPENAI_API_KEY` or `CODEX_API_KEY` is set in the
   environment, and require
   `codex login status` exit 0 within 15s (subscription only, never metered fallback; same law
   as `agent_runner.ps1:167-194`). No budget-cost gate: every dispatch's cost row is
   structurally `usd 0.0` (subscription billing), so a cost check here would measure nothing;
   API spend is governed per-run by card authorization, not this script.
2. **Model resolution** via `scripts/routing.py` (`known_models` + aliases,
   `governance/model-routing.yaml` precedence). Unknown model/alias → exit non-zero with the
   routing error, nothing spawned. `--model` omitted → alias `codex` → `gpt-5.6-terra` (the
   dispatch default). `--effort` is a
   script-layer dial passed as `-c model_reasoning_effort=...`; it never enters routing. On
   `--follow-up <thread-id>`, `--worktree`/`--sandbox`/`--cwd` refuse loudly (the resumed
   session keeps its own); `--model` is still resolved and pinned onto the resumed session via
   `-c model=<id>` — a `codex exec resume` otherwise silently keeps whatever model the CLI
   defaults to, not the original turn's.
3. **Pending marker**: an in-flight JSON (dispatch id, dispatch pid, model, prompt path, cwd,
   sandbox, log/out paths, timeout, start time) written to
   `%LOCALAPPDATA%\kb-codex-dispatch\pending\<id>.json` BEFORE the spawn and deleted once a
   durable record exists. A marker outliving its dispatch is an orphan: the NEXT dispatch's
   startup sweep publishes a `done` card whose Result starts `FAILED: orphaned` and deletes it.
   (`spool\` now holds only spooled cards — see step 8.)
4. **Worktree (opt-in):** `--worktree` creates `git worktree add --detach` from current HEAD
   under `%LOCALAPPDATA%\kb-codex-dispatch\worktrees\<id>` and uses it as cwd. The script never
   removes it; the calling terminal harvests and sweeps it (worktrees-are-leases law).
5. **Spawn** `codex exec - --model <id> --json --output-last-message <out.md> --cd <cwd>
   -s <sandbox> [-c model_reasoning_effort=<effort>]` (or `codex exec resume <thread-id> - --json
   --output-last-message <out.md> -c model=<id>` on `--follow-up`), prompt piped to stdin, JSONL
   stream captured to `%LOCALAPPDATA%\kb-codex-dispatch\logs\<id>.jsonl`. Waits up to
   `--timeout` seconds (default 2700 = 45 min) via `Popen`/`communicate`; on timeout,
   `taskkill /PID <pid> /T /F` and exit code `124`.
6. **Card** built with `scripts/cards.py` primitives: `runtime: codex`, resolved `model:`,
   `owner: codex-worker`, `execution-controller: terminal`, `session-id` from the dispatching
   terminal (env `CLAUDE_SESSION_ID` if present, else the dispatch id), `risk-tier: T1`
   (fixed — a direct dispatch is ordinary supervised work; higher-tier work goes through the
   governed paths, not this one), `workflow:` the parsed `thread_id` (null on parse failure).
   Body: `## Work order` = the prompt file content, `## Result` = the output-last-message
   content (success) or `FAILED: ...` + exit code/timeout + JSONL log path (failure) — both
   heading-escaped so an embedded `## Result`/`## Work order` in the prompt or result text can't
   confuse a section parser. Final state is always `done`: failure lives in the Result text and
   the ledger's `codex_exit` field, never a distinct terminal state.
7. **Ledger**: cost row (usd 0.0, `billing: subscription`, resolved model id — never a
   JSONL read-back, since the model is now always pinned by the script itself) sharded
   `ledgers/cost/codex-direct-<date>.tsv`, same columns as existing cost shards.
8. **Ops publish, best-effort**: one commit containing card + ledger row, verified landed.
   Up to 3 attempts, each: fetch `origin/ops` → reset (or create) a temp detached worktree onto
   it → write card + ledger row → commit → push `HEAD:refs/heads/ops` → `git ls-remote` confirms
   the pushed sha actually landed before reporting success. No `pull --rebase` anywhere — a
   rejected push means the whole record is rebuilt on fresh `origin/ops`, never merged with a
   stale local copy, so a same-second concurrent writer can never be silently overwritten. After
   3 failed attempts the card stays spooled locally and the failure is printed loudly. Publish
   failure NEVER fails the dispatch.
9. **Stdout** (the notification payload): result text (UTF-8, so non-ASCII glyphs in a worker's
   answer never crash the print), then a short footer — card id, model actually run, duration,
   log path, worktree path if any, publish status, session id when a thread id was parsed.

### 2. `dispatch-codex` skill (new, thin)

`skills/curated/dispatch-codex/SKILL.md` (+ `.claude/skills/` mirror per repo convention).
Teaches the convention, nothing more: write the prompt to a scratchpad file (deep, structured
brief — same standard as Agent-tool prompts); run the script via Bash `run_in_background`; keep
working; the notification carries the result. Model menu with the tier guidance (cheap =
gpt-5.6-luna / default = gpt-5.6-terra / deep = gpt-5.6-sol `--effort xhigh`); parallel dispatches
are just parallel background calls (one card each); `--worktree` when the task writes broadly or
another writer shares the tree; caller reviews diffs and commits — the worker never does; caller
sweeps any worktree after harvest.

### 3. `agent_runner.ps1` arbitration fix (edit in place)

Tighten the card-claim filter from `execution-controller != "dashboard"` to *claim only cards
with no `execution-controller` value* — exact-string arbitration, the pattern
`queueBridge.ts` already established. Record cards (`terminal`) and dashboard cards
(`dashboard`) both become unclaimable by the legacy runner. Update `tests/test_agent_runner.py`
shape assertions accordingly.

### 4. MCP short-call lane (`scripts/codex_mcp_guard.py`, new + config)

`.mcp.json`'s `codex` server launches `py -3 scripts/codex_mcp_guard.py` instead of
`codex mcp-server` directly, so the lane is billing-guarded the same way as the dispatch script:
refuse (exit 2) if `OPENAI_API_KEY`/`CODEX_API_KEY` is set, else exec `codex mcp-server` with
stdio inherited. Blocking inline lane for short asks, writes no card; documented in the skill's
"when NOT to dispatch" line.

### 5. Governance edits (`governance/` is human-edited only)

- `governance/model-routing.yaml`: APPLIED. Live file carries `known_models: [gpt-5.6-luna,
  gpt-5.6-terra, gpt-5.6-sol]` and aliases `codex-cheap: gpt-5.6-luna`, `codex: gpt-5.6-terra`
  (dispatch default), `codex-deep: gpt-5.6-sol` — the three tiers the script and skill route
  against.
- `governance/card-schema.md`: still pending — document `execution-controller: terminal`
  (direct dispatch, record-only) alongside `dashboard`.

## Data flow

```
Claude terminal                          codex_dispatch.py (background child)
  write brief → scratchpad file
  Bash run_in_background ───────────────▶ gates → resolve model → sweep orphans → marker
  … keeps working, talks to Daniel …      spawn codex exec (stdin prompt) → wait
                                          card + ledger → best-effort ops push
  ◀── task notification (stdout) ──────── print result + footer, exit
  read result, review diffs, commit
```

## Error handling

| Failure | Behavior |
| --- | --- |
| STOP file / billing guard | Refuse pre-spawn, non-zero exit, reason on stdout |
| Unknown model or alias | Refuse pre-spawn with routing error (fail-loud, no substitute) |
| `codex exec` non-zero exit, or timeout (124) | Card still `done`; Result = `FAILED: ...` + exit code/timeout + JSONL log path; notification says FAILED |
| Ops push rebuilt 3x, none verified landed | Card + row stay spooled locally; loud warning in footer; dispatch still succeeds |
| Dispatch parent dies mid-run (crash, session restart, taskkill) | The `pending\<id>.json` marker + JSONL log are the trace until the NEXT dispatch's startup sweep publishes a `done` card whose Result starts `FAILED: orphaned`; the sweep is claim-by-rename (one publisher per marker), budgeted, and can never fail the dispatch that runs it |
| Parallel dispatches | Independent children, ids, cards, log files; no shared state |

## Testing

- `tests/test_codex_dispatch.py` (pytest, subprocess mocked): gate refusals (STOP, billing env,
  unknown model), card shape + the always-`done` state walk, ledger row shape, rebuild-publish
  command sequence (incl. the ls-remote-mismatch-is-not-"pushed" case), spool lifecycle,
  timeout/taskkill, follow-up model pinning, failure paths.
- `tests/test_codex_mcp_guard.py`: billing refusal, clean-env exec path.
- `tests/test_agent_runner.py`: updated filter assertion (claims only unstamped cards).
- Live smoke (manual, subscription $0): trivial read-only dispatch from a real terminal —
  proves background + notification + card on ops end-to-end. This is the acceptance test.

## Acceptance criteria

1. Dispatch from a fresh kb terminal returns control immediately; result arrives as a
   notification while the terminal did other work.
2. Completed card (Work order + Result) and cost row visible on `ops`.
3. Unknown model refused before spawn; `OPENAI_API_KEY` in env refused before spawn.
4. Two parallel dispatches yield two distinct cards and both notifications.
5. Re-enabled `agent_runner.ps1` (in test) never claims an `execution-controller: terminal` card.
