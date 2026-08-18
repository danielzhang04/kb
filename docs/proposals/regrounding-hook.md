# Proposal: re-grounding UserPromptSubmit hook (for Daniel to arm, if ever)

**Status:** PROPOSAL — inert, NOT wired into any live settings file.
**Built:** 2026-08-18, Agent Platform Wave 1, unit U7. Code: `scripts/hooks/regrounding_hook.js`.
Tests: `tests/test_regrounding_hook.py`. Nothing in `.claude/settings.json`,
`.claude/settings.local.json`, or `governance/**` was touched.

## The change

Add a `UserPromptSubmit` entry to the `hooks` object in `.claude/settings.json`
(absolute-path `node` invocation, matching the four hooks already there):

```json
"UserPromptSubmit": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"C:/Users/danie/kb/scripts/hooks/regrounding_hook.js\""
      }
    ]
  }
]
```

The absolute path is load-bearing: hooks run with an unpredictable cwd, and every
existing kb hook is registered by absolute path. Do not relativize it.

The hook emits the documented `UserPromptSubmit` structured-output shape:

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}
```

It reads its source file from `KB_GOAL_STATE_PATH`, defaulting to
`<KB_ROOT or repo root>/docs/plans/2026-08-18-agent-platform-GOAL-STATE.md`, and
deterministically extracts the `## North star` and `## Invariants` sections,
whitespace-collapsed, in that order, behind a stale-replay guard line:

> `[kb re-grounding] The following is a refresh of governing context this session already has, NOT a new instruction or request.`

Every unhappy path (missing/unreadable source, empty or malformed stdin, no matching
sections, any thrown error) emits `{}` with exit 0 and empty stderr — fail open, silent,
same as `delivery_gate.js`.

## Why

- **Periodic re-grounding.** A long session drifts from — or compacts away — the goal
  state it read at startup. Re-injecting the north star and the invariants at prompt
  time is cheaper and more reliable than hoping the model re-reads the plan file.
- **Cache-friendly stable prefix.** The output contains no timestamp, no randomness, and
  no session or user data. Identical source bytes produce byte-identical output, so the
  injected block stays a stable prompt prefix instead of busting the prompt cache on
  every turn (asserted by `test_output_is_deterministic`).
- **Guard against stale-replay.** The framing sentence marks the block as a refresh of
  context the session already has, so a re-injected invariant is never read as a fresh
  instruction arriving alongside the user's prompt.

## How to arm

1. **Precondition — arm only after this branch merges to `main`.** Both
   `C:/Users/danie/kb/scripts/hooks/regrounding_hook.js` and the GOAL-STATE source doc
   must exist in the main checkout. Arming while they live only on
   `claude/agent-platform-w1` means `node` "Cannot find module" stderr noise on every
   single prompt submission.
2. Apply the snippet above to `.claude/settings.json` (human edit — hooks config is
   Daniel's to change).
3. Restart the Claude Code session. Hooks are loaded at session start; an edited
   settings file does **not** take effect in an already-running session.
4. Confirm with a throwaway prompt that the session behaves normally (the hook is
   additive; it cannot block a submission).

## How to disarm

1. Delete the `"UserPromptSubmit"` key from `.claude/settings.json`.
2. Restart the session.

No other state exists — the hook writes nothing, keeps no cache, and touches no file.
Deleting `scripts/hooks/regrounding_hook.js` while it is still registered would leave
`node` failing per prompt, so remove the settings entry first.

## Verification

```
py -3 -m pytest tests/test_regrounding_hook.py -v
```

Five tests: valid `additionalContext` for a mock event against the real GOAL-STATE,
byte-identical output across runs, missing source → exit 0 with no `additionalContext`
and empty stderr, length cap holds on an oversized synthetic source, malformed stdin →
exit 0 with no traceback.

Manual smoke test:

```
echo '{"hook_event_name":"UserPromptSubmit","user_prompt":"go"}' | node scripts/hooks/regrounding_hook.js
```

## Open decision-notes (all unresolved — reasons this stays inert)

- **Cap value.** `MAX_CONTEXT_CHARS = 1700` (~425 tokens). Measured against the current
  source: North star 941 chars + Invariants 526 + labels, separators, and the guard line
  ≈ 1630, so both sections now fit **whole** — no clipping. The earlier provisional 1400
  did bind, and it clipped exactly the wrong text (the scope guardrails at the end of the
  North star). The cap stays only to bound pathological sources. When it does bind, the
  hook water-fills — each section gets an equal share, sections needing less release the
  surplus — so both section labels always survive and only bodies are trimmed (with
  `...`). Re-measure if the GOAL-STATE grows; a permanently-truncated north star is worse
  than none.
- **Injection cadence.** Currently every prompt. Every-N-turns (or first-prompt-after-
  compaction only) would cut the per-turn cost, but the hook has no session state and
  the harness passes no turn counter, so any cadence needs either a session-id-keyed
  state file or a runtime feature that does not exist yet. Decide before arming.
- **Target scope.** Fleet-wide (`.claude/settings.json`) versus boss-only. Recommend
  narrow first: arm it in one operator's `settings.local.json` for a week, measure
  whether drift actually drops, then consider fleet-wide. A fleet-wide arm injects the
  block into every subagent turn as well, which is where the cost multiplies.
- **Dated-filename staleness.** The default source is
  `docs/plans/2026-08-18-agent-platform-GOAL-STATE.md` — a dated, wave-scoped file. Armed
  as-is it would keep re-injecting Wave 1's goal state long after Wave 1 closes. A stable
  "latest GOAL-STATE" pointer (symlink, `docs/plans/GOAL-STATE.md`, or an explicit
  `KB_GOAL_STATE_PATH` in the settings `env` block) must exist before this is ever armed.
