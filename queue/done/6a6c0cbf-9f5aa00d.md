---
id: 6a6c0cbf-9f5aa00d
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-band-bounce
risk-tier: T1
owner: codex-worker
claim-token: da34af1ba8c3854b
state: done
approval: null
workflow: 019fb60e-4c57-73a0-b6f7-04ec5a59da3e
depends-on: []
variant-group: null
role: work
session-id: 6a6c0bd7-cc6c3075
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task: HUMANIZE the bounce-added spans of ST-013 (closing pass)

Cwd = worktree C:\Users\danie\kb-worktrees\boss-band-bounce. Work only under
orgs/faceless-youtube/channels/the-second-take/videos/2026-07-30-diamonds/. Never commit. UTF-8.

1. Read `skills/curated/humanizer/SKILL.md` (repo-root skills dir in this worktree) — the
   AI-tell kill doctrine. Also `orgs/faceless-youtube/channels/the-second-take/storytelling-grammar.md`
   §1 + `example-scripts.md`: channel voice outranks generic humanizer taste (caps-for-heat,
   licensed pop pulls, stock idioms, deadpan buttons are craft, NOT tells — do not flatten).
2. Scope: ONLY the spans listed in `scratchpad/bounce-changelog.md` (including its Re-verify
   fixes section). The rest of the script was humanized in a prior round — do not touch it.
3. Edit surgically in place: kill residual tells (negative parallels, abstract phrasing, passive
   mechanism prose, aphorism reaches) in those spans. Never add/alter factual content, no new
   numbers, no hedges, no em/en dashes introduced.
4. Re-run from orgs/faceless-youtube:
   `py -3 ".claude/skills/long-form-writer/scripts/lint_script.py" "channels/the-second-take/videos/2026-07-30-diamonds/script.md" --wpm 171`
   — must remain EXIT 0 and inside 7:30-9:30; update the Estimated runtime header if the word
   count moved. Append a `## Humanize pass (bounce spans)` list to scratchpad/bounce-changelog.md.

Final message: edit count + tell types found; final words/runtime/lint exit; confirm no factual drift.

## Result

Edited 6 bounce-script spans and logged the pass in [bounce-changelog.md](C:\Users\danie\kb-worktrees\boss-band-bounce\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-30-diamonds\scratchpad\bounce-changelog.md).

Tells removed: repeated scope disclaimers/negative parallels, abstract mechanism prose, passive data-summary phrasing, and an aphoristic luxury generalization. Licensed channel cappers remain intact.

Final: 1,337 words, 7:49 runtime, lint exit 0. No factual drift: all plea, fine, dates, scope, and lab-grown comparison facts were retained.
