---
name: save-session
description: Capture a resumable handoff at the end of a kb run — context, what worked (with evidence), what did not and why, what remains, and a Load list of files to read on resume — written to handoffs/YYYY-MM-DD-<scope>-<topic>.md (the one canonical handoff location). Lessons additionally go to memory/<agent-id>.md; orgs/<project>/STATE.md gets a current-state refresh if stale.
source: ecc@2.0.0/commands/save-session.md
imported: 2026-07-19
provenance-tier: curated
promoted: 2026-07-19 (Daniel §6 read-through)
---

# Save Session Handoff

Capture what happened this session — what was built, what worked, what failed, what is left — and write it where the next session will actually read it. Per the constitution's Memory rule, durable facts go in files, never only in conversation.

## When to use

- End of a work session before closing.
- Before hitting context limits (save first, then start a fresh session).
- After solving something complex worth remembering.
- Any time you hand off context to a future run.

## Where it lands (kb retarget)

Do NOT write to `~/.claude/session-data`. Three surfaces, three jobs:

- The HANDOFF itself → a NEW file `handoffs/YYYY-MM-DD-<scope>-<topic>.md` per the
  template in `handoffs/README.md` (scope = `kb`, `fyt`, `dashboard`, `atlas`, ...).
  Include the Load list — the files a resuming terminal should read first.
  `handoffs/` follows the ops-branch coordination flow (pull --rebase before, push after).
- LESSONS (reusable what-worked/what-failed patterns) → appended to
  `memory/<agent-id>.md` under a dated heading. Not the handoff content — just lessons.
- `orgs/<project>/STATE.md` → update the current-state sections in place if the
  session made them stale (it is a doc, not a log).

## Process

1. Gather context — review the diff of what changed, what was attempted and decided, and any errors and their resolution. Check test/build status if relevant.
2. Write every section below honestly. Do not skip a section — write "Nothing yet" or "N/A" rather than omit it. An honest empty section beats a missing one.
3. Append the dated section to the target file(s) above.

## Handoff section skeleton

```markdown
# <topic> handoff — YYYY-MM-DD

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

### Load list
The specific files/dirs a resuming terminal should read FIRST, as repo-relative
links, plus any skill to invoke.
- `path/one`
- `path/two`
```

## Notes

- The "What Did NOT Work" section is the most critical — without it, future sessions blindly retry failed approaches.
- If asked to save mid-session, save what is known so far and mark WIP items clearly.
- This section is meant to be read at the start of the next run when the agent reads its `memory/<agent-id>.md` (constitution Memory rule) and the project's `STATE.md`. Handoffs are found by listing `handoffs/` — newest file per scope wins.
