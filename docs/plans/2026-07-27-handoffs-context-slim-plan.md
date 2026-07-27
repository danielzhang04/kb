# Handoff Consolidation + Context Slim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All dated handoffs/pickups/resumes live in one top-level `handoffs/` directory with a Load-list template, and fresh kb terminals start ~8-15k tokens lighter with zero capability loss.

**Architecture:** Pure file-migration + doc/config edits, no code. Repo work happens on branch `claude/handoffs-context-slim` → PR to main (Daniel merges). Machine-local work (settings.local.json, Claude personal MEMORY.md) happens after, outside the PR.

**Tech Stack:** git mv, markdown, Claude Code settings.json schema.

**Spec:** `docs/plans/2026-07-27-handoffs-context-slim-design.md` (approved 2026-07-27).

## Global Constraints

- Branch: `claude/handoffs-context-slim`. Never push to main. Stage explicit paths only — never `git add -A` / `git commit -a`.
- `governance/` and root `CLAUDE.md` are human-edited only — do not touch. (The one CLAUDE.md line is Daniel's manual step, listed at the end.)
- Historical/dated documents (old plans, specs, the handoff files themselves) keep their internal mentions of old paths — they are archival. Only LIVE surfaces get reference updates (Task 4 lists them exhaustively).
- Skill BODIES are never changed in Task 7 — only the frontmatter `description:` value.
- All file moves use `git mv` (preserve history).
- Ad-hoc text edits on Windows: write via the Edit/Write tools (UTF-8), never shell redirection (cp1252 mojibake risk, per FYT F-encoding lesson).

---

### Task 1: Create `handoffs/` with README template

**Files:**
- Create: `handoffs/README.md`

**Interfaces:**
- Produces: the template every future handoff follows; save-session (Task 5) and dashboard-generator (Task 6) reference `handoffs/` and this README.

- [ ] **Step 1: Write `handoffs/README.md`** with exactly this content:

```markdown
# handoffs/ — the one place session handoffs live

Every dated handoff, pickup, or resume document in kb lives HERE and nowhere else.
Filename: `YYYY-MM-DD-<scope>-<topic>.md` — scope is `kb`, `fyt`, `dashboard`,
`atlas`, `ecc`, or a future org id. This directory is append-only history; writes
follow the ops-branch coordination flow (`git pull --rebase origin ops` before,
push after), same as queue/ and memory/.

Related surfaces with different jobs (do NOT put handoffs there):
- `memory/<agent-id>.md` — per-agent LESSONS only (what worked/failed as reusable patterns)
- `orgs/<project>/STATE.md` — current state of a project (a doc kept current, not a log)
- `dashboards/handover.md` — GENERATED index pointing at the newest handoff per scope

## Template

A handoff contains everything a good handoff naturally contains — context, what
shipped (with evidence), what failed and why, what remains, gotchas. The skeleton
below standardizes the structure and adds the Load list; write real content under
each heading, add extra sections freely.

    # <topic> handoff — YYYY-MM-DD
    ## Context      — what this arc is, why it exists, where it stands
    ## Done         — what shipped, with evidence (PRs, commits, verified checks)
    ## Remaining    — ordered next steps, open questions, known gotchas
    ## Load list    — the specific files/dirs a resuming terminal should read FIRST,
                      as repo-relative links, plus any skill to invoke
                      (e.g. orgs/faceless-youtube/STATE.md, docs/plans/<plan>.md)

The Load list is the routing mechanism: a resuming terminal reads five named files
instead of re-exploring the repo.
```

- [ ] **Step 2: Verify and commit**

Run: `git add handoffs/README.md && git commit -m "feat(handoffs): canonical handoff directory + template"`
Expected: 1 file changed.

---

### Task 2: Migrate kb-level handoffs from `docs/plans/`

**Files:**
- Move: 10 files from `docs/plans/` to `handoffs/` (exact list in Step 1)

- [ ] **Step 1: git mv each file** (scope inserted after date):

```bash
git mv docs/plans/2026-07-16-m1-fleet-HANDOFF.md            handoffs/2026-07-16-kb-m1-fleet.md
git mv docs/plans/2026-07-16-m1-BUILD-HANDOFF.md            handoffs/2026-07-16-kb-m1-build.md
git mv docs/plans/2026-07-18-dashboard-execution-control-HANDOFF.md handoffs/2026-07-18-dashboard-execution-control.md
git mv docs/plans/2026-07-18-dashboard-operational-surfaces-HANDOFF.md handoffs/2026-07-18-dashboard-operational-surfaces.md
git mv docs/plans/2026-07-19-atlas-v0-HANDOFF.md            handoffs/2026-07-19-atlas-v0.md
git mv docs/plans/2026-07-19-dashboard-operational-hardening-HANDOFF.md handoffs/2026-07-19-dashboard-operational-hardening.md
git mv docs/plans/2026-07-19-triple-arc-HANDOFF.md          handoffs/2026-07-19-kb-triple-arc.md
git mv docs/plans/2026-07-20-arc2-HANDOFF.md                handoffs/2026-07-20-kb-arc2.md
git mv docs/plans/2026-07-24-dashboard-resume-accepted-run-HANDOFF.md handoffs/2026-07-24-dashboard-resume-accepted-run.md
git mv docs/plans/2026-07-22-ecc-selective-import-RESUME.md handoffs/2026-07-22-ecc-selective-import-resume.md
```

- [ ] **Step 2: Verify none remain**

Run: `ls docs/plans/ | grep -iE 'handoff|resume'`
Expected: no output (exit 1).

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(handoffs): move kb-level handoffs into handoffs/"
```

---

### Task 3: Migrate FYT handoffs (38 files) + relocate STATUS.md

**Files:**
- Move: `orgs/faceless-youtube/docs/2026-07-20-fyt-run-001-HANDOFF.md` → `handoffs/2026-07-20-fyt-run-001.md`
- Move: all 37 dated files in `orgs/faceless-youtube/docs/handoffs/` → `handoffs/` with `fyt-` inserted after the date
- Move: `orgs/faceless-youtube/docs/handoffs/STATUS.md` → `orgs/faceless-youtube/docs/STATUS.md` (it is FYT current-state, not a handoff)
- Delete: emptied `orgs/faceless-youtube/docs/handoffs/` directory

- [ ] **Step 1: Move the loose handoff**

```bash
git mv orgs/faceless-youtube/docs/2026-07-20-fyt-run-001-HANDOFF.md handoffs/2026-07-20-fyt-run-001.md
```

- [ ] **Step 2: Move STATUS.md up one level**

```bash
git mv orgs/faceless-youtube/docs/handoffs/STATUS.md orgs/faceless-youtube/docs/STATUS.md
```

- [ ] **Step 3: Bulk-move the 37 dated files** with the deterministic rename rule
(insert `fyt-` after `YYYY-MM-DD-`; collapse any trailing `-handoff` in the stem):

```bash
cd /c/Users/danie/kb
for f in orgs/faceless-youtube/docs/handoffs/????-??-??-*.md; do
  base=$(basename "$f")
  date=${base:0:11}                      # "YYYY-MM-DD-"
  stem=${base:11}
  stem=${stem/-handoff.md/.md}           # drop redundant "-handoff" suffix
  git mv "$f" "handoffs/${date}fyt-${stem}"
done
```

- [ ] **Step 4: Verify the source dir is empty and remove it**

Run: `ls orgs/faceless-youtube/docs/handoffs/`
Expected: empty (git removes the dir automatically once empty; if a stray file
remains, STOP and reconcile — do not delete content).

- [ ] **Step 5: Verify count**

Run: `ls handoffs/*.md | wc -l`
Expected: 49 (1 README + 10 kb-level + 38 FYT).

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(handoffs): move FYT handoffs/pickups into handoffs/, STATUS.md to org docs/"
```

---

### Task 4: Update live-surface references to old paths

**Files (exhaustive live-surface list; historical docs stay untouched):**
- Modify: `orgs/faceless-youtube/STATE.md`
- Modify: `orgs/faceless-youtube/CLAUDE.md`
- Modify: `orgs/faceless-youtube/knowledge/operating-law.md` (only if it names a handoff path)
- Modify: `memory/fyt-runner.md`, `memory/claude-boss.md`
- Modify: `agents/fyt-runner.md`

- [ ] **Step 1: Find every old-path reference in the live surfaces**

Run: `grep -n -iE 'docs/handoffs|docs/plans/[0-9-]+.*(HANDOFF|RESUME)|fyt-run-001-HANDOFF' orgs/faceless-youtube/STATE.md orgs/faceless-youtube/CLAUDE.md orgs/faceless-youtube/knowledge/operating-law.md memory/fyt-runner.md memory/claude-boss.md agents/fyt-runner.md`

- [ ] **Step 2: For each hit, edit the path to the new `handoffs/` location** (per the
rename rules in Tasks 2-3). Where a file references "the handoffs dir" generically
(e.g. "write a pickup to docs/handoffs/"), rewrite it to point at top-level
`handoffs/` and the README template.

- [ ] **Step 3: Verify zero hits remain**

Re-run the Step 1 grep. Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add orgs/faceless-youtube/STATE.md orgs/faceless-youtube/CLAUDE.md orgs/faceless-youtube/knowledge/operating-law.md memory/fyt-runner.md memory/claude-boss.md agents/fyt-runner.md
git commit -m "refactor(handoffs): repoint live surfaces at handoffs/"
```

(If Step 1 showed a file with no hits, omit it from the add list.)

---

### Task 5: Retarget the save-session skill

**Files:**
- Modify: `.claude/skills/save-session/SKILL.md`

**Interfaces:**
- Produces: sessions now write handoffs to `handoffs/`; only lessons go to `memory/<agent-id>.md`.

- [ ] **Step 1: Replace the frontmatter `description:`** (line 3) with:

```
description: Capture a resumable handoff at the end of a kb run — context, what worked (with evidence), what did not and why, what remains, and a Load list of files to read on resume — written to handoffs/YYYY-MM-DD-<scope>-<topic>.md (the one canonical handoff location). Lessons additionally go to memory/<agent-id>.md; orgs/<project>/STATE.md gets a current-state refresh if stale.
```

- [ ] **Step 2: Replace the "## Where it lands (kb retarget)" section body** (currently
lines 21-28) with:

```markdown
Do NOT write to `~/.claude/session-data`. Three surfaces, three jobs:

- The HANDOFF itself → a NEW file `handoffs/YYYY-MM-DD-<scope>-<topic>.md` per the
  template in `handoffs/README.md` (scope = `kb`, `fyt`, `dashboard`, `atlas`, ...).
  Include the Load list — the files a resuming terminal should read first.
  `handoffs/` follows the ops-branch coordination flow (pull --rebase before, push after).
- LESSONS (reusable what-worked/what-failed patterns) → appended to
  `memory/<agent-id>.md` under a dated heading. Not the handoff content — just lessons.
- `orgs/<project>/STATE.md` → update the current-state sections in place if the
  session made them stale (it is a doc, not a log).
```

- [ ] **Step 3: Update the skeleton heading** in the "## Handoff section skeleton"
block: change `## Session handoff YYYY-MM-DD` to `# <topic> handoff — YYYY-MM-DD`
and add as the final skeleton section:

```markdown
### Load list
The specific files/dirs a resuming terminal should read FIRST, as repo-relative
links, plus any skill to invoke.
- `path/one`
- `path/two`
```

- [ ] **Step 4: Update the trailing "## Notes" line** that says the section is read
via memory/STATE: append "Handoffs are found by listing `handoffs/` — newest file
per scope wins."

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/save-session/SKILL.md
git commit -m "feat(save-session): retarget handoffs to handoffs/, lessons stay in memory/"
```

---

### Task 6: Retarget dashboard-generator's handover.md

**Files:**
- Modify: `.claude/skills/dashboard-generator/SKILL.md`

- [ ] **Step 1: Add a 4th read-source** after item 3 in the "Read before writing" list:

```markdown
4. `handoffs/` — newest file per scope (kb, fyt, dashboard, atlas, ecc, ...) by
   filename date.
```

- [ ] **Step 2: Replace the `## dashboards/handover.md — exact structure` section** with:

```markdown
## dashboards/handover.md — exact structure
# System Handover
_Generated: <UTC timestamp>_
Plain English, <= 300 words, for the human returning after time away:
what happened, what is waiting on them, what the system will do next unattended.
End with a "## Latest handoffs" list: one line per scope — `<scope> — [<filename>](../handoffs/<filename>) (<date>)` — newest handoff per scope from `handoffs/`.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/dashboard-generator/SKILL.md
git commit -m "feat(dashboard-generator): handover.md indexes handoffs/"
```

---

### Task 7: Curate oversized FYT skill descriptions

**Files:**
- Modify (frontmatter `description:` ONLY, bodies untouched): every
  `orgs/faceless-youtube/.claude/skills/<name>/SKILL.md` whose description exceeds
  700 characters. Measured candidates 2026-07-27: analytics-reporter, compliance-check,
  curate-doc, idea-generator, image-generation, long-form-writer, metadata-writer,
  motion-planner, proxy-judge, render-builder, shot-board, audio-analyzer,
  audio-director, researcher. Re-measure each before editing; skip any ≤700.

**Rewrite rules (acceptance criteria for every rewritten description):**
1. ≤600 characters.
2. Keeps, verbatim or near-verbatim, the three signal categories: WHEN to use
   (trigger phrases users actually say), what it reads/writes (only the load-bearing
   file names), and DO-NOT-use redirects (the skills it must not be confused with).
3. Drops: implementation detail, history/rationale ("a general video model
   hallucinated..."), redundant restatements, pipeline-position prose beyond one clause.
4. Single line (YAML frontmatter value), no newlines.

**Worked example — analytics-reporter, from ~1,400+ chars down to this (use as the
quality bar for the rest):**

```
description: Pulls read-only YouTube Analytics for a channel's published videos, rebuilds the offline dashboard, and appends a dated digest to performance.md. Use for "pull analytics", "refresh the metrics/dashboard", "run the analytics cycle", "how are the videos doing" — any channel. Engines: pull_analytics.py (only network step), build_dashboard.py, append_digest.py. Read-only over YouTube; never uploads or edits videos. NOT for picking ideas (idea-generator), publishing (publish-queue), or writing scripts.
```

- [ ] **Step 1: Measure all 21 descriptions** (chars of the frontmatter description value):

```powershell
Get-ChildItem orgs/faceless-youtube/.claude/skills -Directory | ForEach-Object {
  $m = Select-String -Path (Join-Path $_.FullName SKILL.md) -Pattern '^description:' -Raw
  # description is a single YAML line; measure it
  $line = (Get-Content (Join-Path $_.FullName SKILL.md) | Where-Object { $_ -match '^description:' }) -join ''
  "{0}: {1}" -f $_.Name, $line.Length
}
```

- [ ] **Step 2: For each skill >700 chars, rewrite the description per the rules.**
Dispatch as parallel subagent work (one agent per 4-5 skills, model: sonnet), each
agent receiving: the current SKILL.md, the rewrite rules, and the worked example.

- [ ] **Step 3: Verify: re-run the Step 1 measurement.**
Expected: every description ≤600 chars; `git diff --stat` shows ONLY SKILL.md files,
and `git diff` shows only `description:` lines changed.

- [ ] **Step 4: Auto-trigger spot-check.** For 3 curated skills, confirm the casual
phrasing still maps: read each new description and check it contains the phrases —
metadata-writer: "titles and tags" / "package"; idea-generator: "what should we make
next"; image-generation: "generate the images". (These are the cues the model
matches on.)

- [ ] **Step 5: Commit**

```bash
git add orgs/faceless-youtube/.claude/skills
git commit -m "refactor(fyt-skills): curate oversized descriptions to <=600 chars, triggers preserved"
```

---

### Task 8: Open the PR

- [ ] **Step 1: Push and create PR**

```bash
git push -u origin claude/handoffs-context-slim
gh pr create --base main --title "refactor: consolidate all handoffs into handoffs/ + slim terminal context" --body "<summarize Tasks 1-7; link the design spec; list Daniel's post-merge steps from the checklist below>"
```

- [ ] **Step 2: Post-merge checklist for Daniel (put in PR body):**
1. Add one line to root CLAUDE.md (human-edited only), suggested under `## Memory`:
   "Session handoffs live in `handoffs/` (dated, with a Load list of files to read
   on resume — see handoffs/README.md). Write them there and nowhere else."
2. Next dashboards regeneration will rebuild handover.md in the new format (cadence).

---

### Task 9 (LOCAL, after PR merge — not part of the PR): settings + memory

**Files:**
- Modify: `C:\Users\danie\kb\.claude\settings.local.json` (verify it is gitignored;
  if the file does not exist, create it)
- Modify: `C:\Users\danie\.claude\projects\C--Users-danie-kb\memory\MEMORY.md`

- [ ] **Step 1: Merge into `.claude/settings.local.json`** (preserve existing keys):

```json
{
  "enabledPlugins": {
    "plugin-dev@claude-plugins-official": false,
    "mcp-server-dev@claude-plugins-official": false,
    "claude-code-setup@claude-plugins-official": false,
    "claude-md-management@claude-plugins-official": false,
    "chrome-devtools-mcp@claude-plugins-official": false,
    "notion@claude-plugins-official": false,
    "desktop-commander@claude-plugins-official": false
  },
  "skillOverrides": {
    "claude-context-optimizer:cco": "user-invocable-only",
    "claude-context-optimizer:cco-anatomy": "user-invocable-only",
    "claude-context-optimizer:cco-budget": "user-invocable-only",
    "claude-context-optimizer:cco-claudemd": "user-invocable-only",
    "claude-context-optimizer:cco-clean": "user-invocable-only",
    "claude-context-optimizer:cco-coach": "user-invocable-only",
    "claude-context-optimizer:cco-digest": "user-invocable-only",
    "claude-context-optimizer:cco-doctor": "user-invocable-only",
    "claude-context-optimizer:cco-export": "user-invocable-only",
    "claude-context-optimizer:cco-git": "user-invocable-only",
    "claude-context-optimizer:cco-overhead": "user-invocable-only",
    "claude-context-optimizer:cco-pack": "user-invocable-only",
    "claude-context-optimizer:cco-replay": "user-invocable-only",
    "claude-context-optimizer:cco-report": "user-invocable-only",
    "claude-context-optimizer:cco-roi": "user-invocable-only",
    "claude-context-optimizer:cco-shield": "user-invocable-only",
    "claude-context-optimizer:cco-task": "user-invocable-only",
    "claude-context-optimizer:cco-templates": "user-invocable-only",
    "claude-context-optimizer:smart-loader": "user-invocable-only",
    "claude-context-optimizer:context-analyzer": "user-invocable-only"
  }
}
```

Note: verify the exact skill-name keys against a live listing before writing —
plugin-qualified names must match what the harness reports.

- [ ] **Step 2: Verify gitignore** — `git check-ignore .claude/settings.local.json`
must print the path. If not ignored, add it to `.gitignore` first.

- [ ] **Step 3: MEMORY.md curation.** Remove exactly these index lines (files stay on
disk; each is marked superseded/closed in its own hook text):
  - `[FYT post-render tail designed 2026-07-20](fyt-post-render-tail-design.md)` (SUPERSEDED)
  - `[m1-fleet rollback + resume point](m1-fleet-rollback-resume.md)` (erased build, resumed long ago)
  - `[m1 build state / resume point](m1-build-state-2026-07-16.md)` (superseded by later arcs)
  - `[D2.12/D2.13 status](d212-d213-status.md)` (both closed)
  - `[Autonomous triple arc 2026-07-19](autonomous-triple-arc-2026-07-19.md)` (superseded by Wave A/debt-wave entries)

  Then add at the top of the index:
  `- Repo session handoffs live in kb `handoffs/` (dated, Load-list template) — check there before any personal-memory resume point.`

- [ ] **Step 4: Verify** — new terminal in kb shows: no plugin-dev/notion/etc. skills
in listing, /cco-* still typable, and startup context measurably smaller (compare
`/context` by eye or re-run the description measurement).

---

## Verification (whole-plan)

1. `ls handoffs/*.md | wc -l` → 49; `docs/plans` has zero HANDOFF/RESUME files;
   `orgs/faceless-youtube/docs/handoffs/` does not exist.
2. Task 4 grep returns nothing on live surfaces.
3. Every FYT skill description ≤600 chars; bodies unchanged (`git diff` scope check).
4. Post-merge, post-local: fresh terminal spot-check — "write the tags for this
   video" auto-suggests metadata-writer; `/cco` still works; plugin count down 7.
