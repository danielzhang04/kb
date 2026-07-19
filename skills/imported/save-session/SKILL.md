---
name: save-session
description: Capture a resumable handoff at the end of a kb run — what worked (with evidence), what did not and why, what is untried, current file state, and the exact next step — as a dated section appended to memory/<agent-id>.md and/or the project's orgs/<project>/STATE.md, so the next session resumes with full context.
source: ecc@2.0.0/commands/save-session.md
imported: 2026-07-19
provenance-tier: imported
---

# Save Session Handoff

Capture what happened this session — what was built, what worked, what failed, what is left — and write it where the next session will actually read it. Per the constitution's Memory rule, durable facts go in files, never only in conversation.

## When to use

- End of a work session before closing.
- Before hitting context limits (save first, then start a fresh session).
- After solving something complex worth remembering.
- Any time you hand off context to a future run.

## Where it lands (kb retarget)

Do NOT write to `~/.claude/session-data`. The handoff lands as a dated section:

- Appended to `memory/<agent-id>.md` (your durable per-agent lessons file, read at the start of every run), and/or
- Appended to the project's `orgs/<project>/STATE.md` when the state belongs to a specific project's resume point.

Use a dated heading so entries stack without overwriting each other, for example `## Session handoff YYYY-MM-DD`. Append — never overwrite a previous session's section. Both files are ordinary work-product on your agent branch (or `ops` for STATE.md, per the branch rules); commit them the normal way.

## Process

1. Gather context — review the diff of what changed, what was attempted and decided, and any errors and their resolution. Check test/build status if relevant.
2. Write every section below honestly. Do not skip a section — write "Nothing yet" or "N/A" rather than omit it. An honest empty section beats a missing one.
3. Append the dated section to the target file(s) above.

## Handoff section skeleton

```markdown
## Session handoff YYYY-MM-DD

**Topic:** [one line: what this session was about]

### What WORKED (with evidence)
List only confirmed-working items. For each, give the evidence — test passed,
command output, reconcile clean. Without evidence, move it to "Not tried yet".
- **[thing]** — confirmed by: [specific evidence]
If nothing yet: "Nothing confirmed working yet."

### What Did NOT Work (and why)
The most important section. Every approach that failed, with the EXACT reason so
the next session does not retry it. "threw X because Y" is useful; "didn't work"
is not.
- **[approach]** — failed because: [exact reason / error]
If nothing failed: "No failed approaches yet."

### What Has NOT Been Tried Yet
Promising approaches not yet attempted; specific enough that the next session
knows exactly what to try.
- [approach / idea]
If none: "No specific untried approaches identified."

### Current State of Files
Every file touched, with its state. Status labels: DONE / WIP / BROKEN / TODO.
| File | Status | Notes |
| ---- | ------ | ----- |
| `path/to/file` | DONE | [what it does] |
| `path/to/file` | WIP | [what is done, what is left] |
If none: "No files modified this session."

### Exact Next Step
The single most important thing to do on resume, precise enough that resuming
requires zero thinking about where to start. If unknown, say so and point to the
"Not tried yet" and blockers above.
```

## Notes

- The "What Did NOT Work" section is the most critical — without it, future sessions blindly retry failed approaches.
- If asked to save mid-session, save what is known so far and mark WIP items clearly.
- This section is meant to be read at the start of the next run when the agent reads its `memory/<agent-id>.md` (constitution Memory rule) and the project's `STATE.md`.
