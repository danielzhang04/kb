# {{name}} — Project Guide (CLAUDE.md)

**The router.** Auto-loaded at the start of every session in this folder. A fresh terminal knows
nothing except what is in this file and what it reads from disk — read it fully before acting.

## What this is

(placeholder — describe what `{{name}}` is, who it's for, and what "done" looks like, then delete
this line)

## Where things go

Build it where it belongs — don't improvise a location.

| Thing | Canonical path |
| --- | --- |
| Agent declarations | repo-root `agents/<id>.md`, made via the `agent-builder` skill (desktop-only) |
| Agent evals | repo-root `evals/agents/<id>/` |
| Workflows | `orgs/{{name}}/workflows/*.md` — frontmatter `id` / `project` / `title` / `profile` / `stages[]`; exemplar: `orgs/kb-ops/workflows/research-brief.md` |
| Cadences (recurring runs) | `orgs/{{name}}/HEARTBEAT.md` |
| Autonomy policy | `orgs/{{name}}/contract.md` |
| Project-specific code | `orgs/{{name}}/scripts/` |
| Structured knowledge | `orgs/{{name}}/wiki/` |
| Ingest inbox | `orgs/{{name}}/raw/` |
| Deliverables | `orgs/{{name}}/output/` |
| Current state | `orgs/{{name}}/STATE.md` |
| Coordination (cards, ledgers, memory) | repo-root `queue/` `ledgers/` `memory/` on the `ops` branch, per root `CLAUDE.md` |

An agent binds to this project by declaring `projects: [{{name}}]` in its frontmatter.

## Read this for that

| When the task is… | Read first |
| --- | --- |
| Starting work in this project for the first time | this file, then `STATE.md` and `contract.md` |
| "What's the current state / what's next?" | `STATE.md` |
| "Am I allowed to do this on my own?" | `contract.md` |
| Adding or changing a recurring cadence | `HEARTBEAT.md` |

If a prompt doesn't match a row, use judgment: check `wiki/` for relevant knowledge, `raw/` for
unprocessed input, and `workflows/` for an existing definition before writing new code.
