---
name: strategic-compact
description: Compact context manually at logical task boundaries in a kb session rather than letting arbitrary auto-compaction fire mid-task. Covers when to compact, how to read true context size from the transcript, and what survives a compaction in kb terms (cards, ## Result, memory files, and ops ledgers persist; the conversation does not).
source: ecc@2.0.0/skills/strategic-compact/SKILL.md
imported: 2026-07-19
provenance-tier: curated
promoted: 2026-07-19 (Daniel §6 read-through)
---

# Strategic Compact

Compact context with `/compact` at logical points in a kb run instead of relying on arbitrary auto-compaction. The judgment: the harness tells you *when* pressure is building; you decide *if* the boundary is a safe place to compact.

## When to compact

- Long runs approaching the context window (200K+ tokens of true context).
- Multi-phase work: research -> plan -> implement -> verify.
- Switching between unrelated cards in one session.
- After finishing a milestone and starting fresh work.
- When responses slow or lose coherence (context pressure).

## Why strategic, not automatic

Auto-compaction fires at arbitrary points — often mid-task, with no awareness of logical boundaries, and can interrupt a multi-step operation. Compacting at a boundary you choose keeps the distilled output (the plan, the card `## Result`) and drops the bulky exploration that produced it.

## Reading true context size

Context pressure is not "number of tool calls" — a few large file reads or MCP responses can fill the window in very few calls. Read the real size from the latest `usage` record in the session transcript and sum:

```
input_tokens + cache_read_input_tokens + cache_creation_input_tokens
```

That sum is the true context of the turn. As a rule of thumb, consider compacting past ~160k on a 200k window and ~250k on a 1M window. Detect a 1M window from a `[1m]` marker in the model id (for example `claude-opus-4-8[1m]`), or infer it once observed context already exceeds 200k.

Note: ECC ships a `suggest-compact.js` PreToolUse hook that automates this reminder. It is NOT imported into kb — kb already gets compaction hints from the Claude Code harness, so this skill is the keeper and the hook is intentionally left behind.

## Compaction decision guide

| Phase transition | Compact? | Why |
|-----------------|----------|-----|
| Research -> planning | Yes | Research context is bulky; the plan is the distilled output |
| Planning -> implementation | Yes | Plan lives in a file or the card; free the window for code |
| Implementation -> verify | Maybe | Keep if tests reference recent code; compact if switching focus |
| Debugging -> next card | Yes | Debug traces pollute context for unrelated work |
| Mid-implementation | No | Losing variable names, paths, and partial state is costly |
| After a failed approach | Yes | Clear the dead-end reasoning before trying a new one |

## What survives compaction in kb

Compaction drops the conversation. Durable state survives only because it lives in files — which is exactly why the constitution's Memory rule says durable facts go in files, never only in conversation. Write before you compact.

| Persists (on disk / in git) | Lost (in the conversation) |
|-----------------------------|----------------------------|
| CLAUDE.md / AGENTS.md constitution | Intermediate reasoning and analysis |
| Queue cards and their `## Result` blocks | File contents you previously read |
| `memory/<agent-id>.md` lessons | Multi-step conversation context |
| ops ledgers (`ledgers/grades/`, `ledgers/activity/`) | Tool-call history and counts |
| Org `STATE.md` and files committed to a branch | Preferences stated only verbally |

## Best practices

1. Write first — save context to a card `## Result`, `memory/<agent-id>.md`, or a branch commit before compacting.
2. Compact after planning, once the plan is in a file or the card.
3. Compact after debugging, before unrelated work.
4. Do not compact mid-implementation — preserve related context.
5. Compact with a summary: `/compact Focus on wiring the Stop hook into settings.json next`.
