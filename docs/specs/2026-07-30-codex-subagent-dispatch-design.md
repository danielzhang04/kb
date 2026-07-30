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
    [--cwd <dir>] [--sandbox read-only|workspace-write] [--worktree]
    [--project <org>] [--label <short-slug>]
```

Flow, in order:

1. **Gates** (all before any spawn): `STOP` file absent; `governance/budget.yaml` daily check
   (reuse `scripts/preamble.py` logic by import or subprocess); billing guard — refuse if
   `OPENAI_API_KEY` or `CODEX_API_KEY` is set in the environment, and require
   `codex login status` exit 0 (subscription only, never metered fallback; same law as
   `agent_runner.ps1:167-194`).
2. **Model resolution** via `scripts/routing.py` (`known_models` + aliases,
   `governance/model-routing.yaml` precedence). Unknown model/alias → exit non-zero with the
   routing error, nothing spawned. `--model` omitted → runtime codex default. `--effort` is a
   script-layer dial passed as `-c model_reasoning_effort=...`; it never enters routing.
3. **Spool** a crash-trace JSON (dispatch id, model, prompt path, cwd, start time) to
   `%LOCALAPPDATA%\kb-codex-dispatch\spool\<id>.json` (precedent: `kb-agent-runner.log`).
4. **Worktree (opt-in):** `--worktree` creates `git worktree add --detach` from current HEAD
   under `%LOCALAPPDATA%\kb-codex-dispatch\worktrees\<id>` and uses it as cwd. The script never
   removes it; the calling terminal harvests and sweeps it (worktrees-are-leases law).
5. **Spawn** `codex exec - --model <id> --json --output-last-message <out.md> --cd <cwd>
   -s <sandbox> [-c model_reasoning_effort=<effort>]`, prompt piped to stdin, JSONL stream
   captured to `%LOCALAPPDATA%\kb-codex-dispatch\logs\<id>.jsonl`. Wait for exit.
6. **Card** built with `scripts/cards.py` primitives: `runtime: codex`, resolved `model:`,
   `owner: codex-worker`, `execution-controller: terminal`, `session-id` from the dispatching
   terminal (env `CLAUDE_SESSION_ID` if present, else the dispatch id), `risk-tier: T1`
   (fixed — a direct dispatch is ordinary supervised work; higher-tier work goes through the
   governed paths, not this one). Body: `## Work order` = the prompt file content; `## Result` = the
   output-last-message content (success) or exit code + JSONL log path (failure). Final state:
   `done` on exit 0, `halted` otherwise — reached through legal transitions in-memory.
7. **Ledger**: cost row (usd 0.0, `billing: subscription`, model id read back from the JSONL
   stream) sharded `ledgers/cost/codex-direct-<date>.tsv`, same columns as existing cost shards.
8. **Ops publish, best-effort**: one commit containing card + ledger row. Dance: fetch
   `origin/ops` → temp detached worktree → write files → commit → `git push origin <sha>:ops`;
   one rebase-retry on reject; on second failure the card stays spooled and the failure is
   printed loudly. Publish failure NEVER fails the dispatch.
9. **Stdout** (the notification payload): result text, then a short footer — card id, model
   actually run, duration, log path, worktree path if any, publish status.

### 2. `dispatch-codex` skill (new, thin)

`skills/curated/dispatch-codex/SKILL.md` (+ `.claude/skills/` mirror per repo convention).
Teaches the convention, nothing more: write the prompt to a scratchpad file (deep, structured
brief — same standard as Agent-tool prompts); run the script via Bash `run_in_background`; keep
working; the notification carries the result. Model menu with the tier guidance (cheap =
gpt-5.4-mini / default = gpt-5.6-sol / deep = gpt-5.6-sol `--effort xhigh`); parallel dispatches
are just parallel background calls (one card each); `--worktree` when the task writes broadly or
another writer shares the tree; caller reviews diffs and commits — the worker never does; caller
sweeps any worktree after harvest.

### 3. `agent_runner.ps1` arbitration fix (edit in place)

Tighten the card-claim filter from `execution-controller != "dashboard"` to *claim only cards
with no `execution-controller` value* — exact-string arbitration, the pattern
`queueBridge.ts` already established. Record cards (`terminal`) and dashboard cards
(`dashboard`) both become unclaimable by the legacy runner. Update `tests/test_agent_runner.py`
shape assertions accordingly.

### 4. MCP short-call lane (config only)

Add `codex` → `codex mcp-server` (stdio) to kb's project `.mcp.json`. Blocking inline lane for
short asks; documented in the skill's "when NOT to dispatch" line. Nothing else built.

### 5. HUMAN GATE — governance edits (Daniel applies)

`governance/` is human-edited only. Exact diff to be handed at the gate:

- `governance/model-routing.yaml`: `known_models` += `gpt-5.6-terra, gpt-5.6-luna, gpt-5.5,
  gpt-5.4, gpt-5.4-mini, gpt-5.3-codex-spark`; aliases += `codex-cheap: gpt-5.4-mini`,
  `codex-deep: gpt-5.6-sol`; delete the stale "codex runner does NOT pass `--model` today"
  note (contradicted by `agent_runner.ps1:378-383`).
- `governance/card-schema.md`: document `execution-controller: terminal` (direct dispatch,
  record-only) alongside `dashboard`.

Until applied, the script works with `gpt-5.6-sol` only (fail-loud on the rest) — buildable and
testable before the gate.

## Data flow

```
Claude terminal                          codex_dispatch.py (background child)
  write brief → scratchpad file
  Bash run_in_background ───────────────▶ gates → resolve model → spool
  … keeps working, talks to Daniel …      spawn codex exec (stdin prompt) → wait
                                          card + ledger → best-effort ops push
  ◀── task notification (stdout) ──────── print result + footer, exit
  read result, review diffs, commit
```

## Error handling

| Failure | Behavior |
| --- | --- |
| STOP file / budget / billing guard | Refuse pre-spawn, non-zero exit, reason on stdout |
| Unknown model or alias | Refuse pre-spawn with routing error (fail-loud, no substitute) |
| `codex exec` non-zero exit | Card `halted`, Result = exit code + JSONL log path; notification says FAILED |
| Ops push fails twice | Card + row stay spooled locally; loud warning in footer; dispatch still succeeds |
| Machine dies mid-run | Spool file is the trace; no card (record-not-gate accepted trade-off) |
| Parallel dispatches | Independent children, ids, cards, log files; no shared state |

## Testing

- `tests/test_codex_dispatch.py` (pytest, subprocess mocked): gate refusals (STOP, billing env,
  unknown model), card shape + legal state transitions, ledger row shape, ops-dance command
  sequence, spool lifecycle, failure paths.
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
