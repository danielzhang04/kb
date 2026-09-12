# Subagent brief rules

One rule, referenced from every dispatch surface (Claude Agent tool briefs AND
`dispatch-codex` briefs) rather than restated in each: a token-burn driver the
2026-09-11 token-discipline evidence found directly (Table B/E: 24-35 subagents
per boss session, subagent turns = 31-41% of total cost) is a subagent's own
tool-result bytes flowing straight back into the PARENT's context through its
final message.

**The rule:** every dispatched worker (Agent-tool subagent or `dispatch-codex`
worker) writes its full findings/diffs/output to a file (its own scratchpad, or
a path the brief names) and returns AT MOST 300 WORDS in its final message —
the verdict, the file path(s), and anything the dispatcher must act on. Never
paste a diff, a log, or a search result wholesale into the final message when a
file path would do.

This is advisory (ruling 2026-09-11: measure only, no enforcement) — no hook
checks message length. It is a brief-writing habit: every dispatch template
should say it explicitly, because a worker with no such instruction defaults
to being thorough in its own reply, which is the opposite of what the parent's
context budget needs.
