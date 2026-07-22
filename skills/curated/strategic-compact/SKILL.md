---
name: strategic-compact
description: Use when a long kb session is approaching its context limit or crossing a major phase boundary. Preserve durable state first, then use the runtime's supported compaction, handoff, or fresh-session mechanism so bulky exploration is dropped without losing the plan, card result, memory, or branch state.
source: ecc@2.0.0/skills/strategic-compact/SKILL.md
imported: 2026-07-19
provenance-tier: curated
promoted: 2026-07-19 (Daniel §6 read-through)
---

# Strategic Compact

Reduce context at logical boundaries, after the durable state is written. Claude and Codex expose different compaction controls, so use the mechanism the current runtime actually provides rather than assuming a particular slash command.

## Good boundaries

- research → planning
- planning → implementation, once the plan is durable
- completed debugging → unrelated work
- completed milestone → next milestone or card
- context pressure causing slow or incoherent responses

Avoid compacting mid-edit or while unresolved details exist only in conversation.

## Judge pressure from evidence

Prefer the runtime's context meter or usage record. Where available, count current input plus cache-read and cache-creation input. Treat model-window thresholds as runtime- and model-specific; do not infer them from an example Claude model id or assume every runtime uses the same accounting fields.

## Preserve before reducing

Write the minimum continuation state to the repo's existing structures:

- current plan and exact next action
- queue-card `## Result` or handoff notes
- durable lessons in the appropriate memory file
- branch/commit state and unresolved test failures
- decisions, constraints, and user preferences that are not already on disk

Do not create a parallel memory system merely for compaction.

## Runtime action

1. Use native compaction when the harness exposes it.
2. If it does not, create a concise durable handoff and start a fresh session/agent at the boundary.
3. If neither is appropriate, continue and keep tool output bounded.

Afterward, re-read only the constitution, target contract, current card/plan, and files needed for the next step. Do not replay the entire prior exploration.
