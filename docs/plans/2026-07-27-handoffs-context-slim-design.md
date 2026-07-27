# Handoff consolidation + terminal context slim — design

Date: 2026-07-27. Approved in conversation by Daniel (directory-routing chosen; skill
name-only hiding rejected — skills must stay universally invocable AND auto-triggerable;
handoffs keep their natural full content plus a Load list).

## Goals / success conditions

1. Every dated handoff lives in ONE place: top-level `handoffs/`. All other handoff
   locations are emptied or become generated views. A resuming terminal (human or agent)
   finds any handoff by listing one directory.
2. A fresh kb terminal's startup context drops by roughly 8–15k tokens, with zero loss
   of capability: every skill remains invocable and auto-triggerable; every trimmed
   piece of context remains one invocation or one file-read away.
3. Verified by re-running the same measurements taken before (skill-description sizes,
   MEMORY.md size) and by a spot-check that a casual prompt still auto-triggers a
   curated skill.

## Part 1 — Handoff consolidation

### Canonical location and naming

- New top-level directory `handoffs/`.
- Filename: `YYYY-MM-DD-<scope>-<topic>.md`, scope = `kb`, `fyt`, `dashboard`, `atlas`, …
- `handoffs/` is a coordination surface: writes follow the ops-branch flow (pull
  --rebase origin ops before write, push after), same as queue/ and memory/. A session
  ending with a handoff must not need a PR round-trip to record it.

### Handoff template (skeleton, not a straitjacket)

A handoff contains everything a good handoff naturally contains. The template only
standardizes the skeleton and adds the Load list:

```
# <topic> handoff — YYYY-MM-DD
## Context        — what this arc is, why it exists, where it stands
## Done           — what shipped, with evidence (PRs, commits, verified checks)
## Remaining      — ordered next steps, open questions, known gotchas
## Load list      — the specific files/dirs a resuming terminal should read FIRST,
                    as repo-relative links (e.g. orgs/faceless-youtube/STATE.md,
                    docs/plans/<plan>.md, queue/<card>.md), plus any skill to invoke
```

The Load list is the routing mechanism Daniel chose: instead of every terminal
preloading everything, a resuming terminal reads five named files.

### Migration (12 existing files, `git mv` to preserve history)

From `docs/plans/`:
- 2026-07-16-m1-fleet-HANDOFF.md            → handoffs/2026-07-16-kb-m1-fleet.md
- 2026-07-16-m1-BUILD-HANDOFF.md            → handoffs/2026-07-16-kb-m1-build.md
- 2026-07-18-dashboard-execution-control-HANDOFF.md → handoffs/2026-07-18-dashboard-execution-control.md
- 2026-07-18-dashboard-operational-surfaces-HANDOFF.md → handoffs/2026-07-18-dashboard-operational-surfaces.md
- 2026-07-19-atlas-v0-HANDOFF.md            → handoffs/2026-07-19-atlas-v0.md
- 2026-07-19-dashboard-operational-hardening-HANDOFF.md → handoffs/2026-07-19-dashboard-operational-hardening.md
- 2026-07-19-triple-arc-HANDOFF.md          → handoffs/2026-07-19-kb-triple-arc.md
- 2026-07-20-arc2-HANDOFF.md                → handoffs/2026-07-20-kb-arc2.md
- 2026-07-24-dashboard-resume-accepted-run-HANDOFF.md → handoffs/2026-07-24-dashboard-resume-accepted-run.md

From `orgs/faceless-youtube/`:
- docs/2026-07-20-fyt-run-001-HANDOFF.md    → handoffs/2026-07-20-fyt-run-001.md
- docs/handoffs/2026-07-21-engagement-overhaul-handoff.md → handoffs/2026-07-21-fyt-engagement-overhaul.md
- docs/handoffs/2026-07-22-poyais-engagement-overhaul-final-handoff.md → handoffs/2026-07-22-fyt-poyais-engagement-final.md

Then delete the emptied `orgs/faceless-youtube/docs/handoffs/` dir. Grep the repo for
references to the old paths (docs, STATE.md, memory files, dashboards) and update them.

### Role separation after migration

| Surface | Role | Change |
|---|---|---|
| `handoffs/` | ALL dated handoffs | new, canonical |
| `memory/<agent-id>.md` | lessons only (what worked/failed) | resume-point content stops accumulating here; existing content untouched |
| `orgs/*/STATE.md` | current state (a doc, not a log) | unchanged |
| `dashboards/handover.md` | GENERATED index: newest handoff per scope + link | dashboard-generator updated to build it from `handoffs/` |
| Claude personal MEMORY.md | pointers to repo handoffs, not duplicated content | slimmed (Part 2c) |

### Skill/doc updates

- `save-session` skill: target changes from "memory/<agent-id>.md and/or STATE.md" to
  "write the handoff to `handoffs/` per template; append only LESSONS to
  memory/<agent-id>.md; update STATE.md current-state if stale."
- `dashboard-generator` skill: handover.md section sources from `handoffs/` listing.
- HUMAN EDIT (Daniel, CLAUDE.md is human-edited only) — add one line, suggested under
  `## Memory` or `## Navigation`:
  > Session handoffs live in `handoffs/` (one file per handoff, dated, with a Load
  > list of files to read on resume). Write them there and nowhere else.

## Part 2 — Context slim (no routing, no capability loss)

### 2a. Curate oversized skill descriptions at the source

Method: for each FYT org skill whose SKILL.md frontmatter description exceeds ~700
chars, rewrite the description to ≤~500 chars of high-signal trigger text (use / don't
use / trigger phrases), per skill-creator description norms, using the builder tooling
(skill-reviewer for validation). Skill BODIES are untouched — only the listing
description. This preserves (and likely improves) auto-triggering: shorter descriptions
surface trigger phrases instead of burying them.

Initial target list (measured 2026-07-27; lengths approximate — re-measure per file
before editing): analytics-reporter, idea-generator, image-generation, render-builder,
compliance-check, curate-doc, proxy-judge, shot-board, motion-planner, metadata-writer,
long-form-writer, audio-director, audio-analyzer, researcher — any ≥~700 chars.
Estimated saving: ~3–6k tokens per terminal (each terminal carries all 21 descriptions).

Gate: after curation, spot-check auto-triggering with 2–3 casual phrasings per curated
skill family (e.g. "write the tags for this video" must still route to metadata-writer).

### 2b. Per-project plugin disable list (VETO-ABLE, one line each in kb
`.claude/settings.local.json`; plugin stays available in all other projects)

| Plugin | What it is | Recommendation | Why |
|---|---|---|---|
| plugin-dev | plugin-authoring toolkit (3 agents, 7 skills) | DISABLE in kb | kb doesn't author plugins; used at user level when it is |
| mcp-server-dev | MCP-server authoring toolkit | DISABLE in kb | same reasoning |
| claude-code-setup | setup/automation recommender | DISABLE in kb | one-shot advisory tool, not a workflow dependency |
| chrome-devtools-mcp | browser automation + perf/a11y | DISABLE in kb | redundant with playwright, which kb dashboard work already uses |
| notion | Notion workspace integration | DISABLE in kb | no kb workflow touches Notion |
| claude-md-management | CLAUDE.md audit skills | DISABLE in kb | CLAUDE.md is human-edited-only here; skill would be refused anyway |
| everything else (superpowers, commit-commands, skill-creator, humanizer, multi-source-synthesis, document-skills, context7, claude-video-vision, playwright, desktop-commander, claude-context-optimizer) | | KEEP | in active kb use or plausibly needed |

Estimated saving: ~2–4k tokens per terminal. Reversal: flip the line to `true`.

### 2c. Memory-index curation (Claude personal MEMORY.md)

Archive index entries whose memories are marked SUPERSEDED/CLOSED/historical (~15 of
44). Mechanism: remove the index line from MEMORY.md; leave the memory FILE on disk
(nothing deleted); resume-point entries replaced by a single pointer line to
`handoffs/`. Estimated saving: ~1.5–2k tokens per Claude kb session.

## Out of scope (deliberately)

- `_private/codex-worktrees/` stale worktree copies (~15 full-repo duplicates): search
  pollution, not context load. Flagged for a separate cleanup card.
- CLAUDE.md / BOSS.md content (~1.3k tokens, working as designed).
- superpowers SessionStart injection (third-party plugin; not worth forking for ~1k).
- MCP tool schemas (already deferred via ToolSearch).

## Execution order

1. Branch `claude/handoffs-context-slim` (this branch): create `handoffs/` + template
   in `handoffs/README.md`, `git mv` the 12 files, fix references, update save-session
   + dashboard-generator skills, curate skill descriptions (2a). PR to main.
2. Local (no PR needed): `.claude/settings.local.json` plugin lines (2b, post-veto),
   MEMORY.md curation (2c).
3. Daniel: merge PR, add the one CLAUDE.md line, veto/confirm 2b list.
4. Verify: re-run measurements; auto-trigger spot-checks; grep for dangling old paths.
