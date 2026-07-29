# fyt scripting round-4 handoff — 2026-07-29

## Context

The Second Take (faceless-youtube) scripting-doctrine overhaul, rounds 1–3 done. Goal: one
research→script pass produces a script Daniel accepts. Round 3 rebuilt the doctrine
(named-cultural-pull ratio, stock-idiom default, detail budget, density soft target, act-by-act
drafting with voice-bar re-reads, comparative taste judging) and ran fresh Bricks script #3.
Daniel reviewed #3 inline with the boss session on 2026-07-28/29: **not accepted — round 4 owed.**
Daniel will give his feedback directly to whoever picks this up. Iterate docs, then regen.

All doc work lives on branch `claude/fyt-writer-grammar-slim`, checked out in worktree
`C:/Users/danie/kb-worktrees/fyt-writer-r2/`. The main kb checkout sits on `claude/fyt-stack-trims`.

**Gotcha:** the main checkout has an untracked `videos/2026-07-28-bricks-fresh/` folder too — it is
an UNRELATED old pipeline test (assets/, shots.json, pipe-test-log.md). The scripting arc's canonical
folder is the one in the worktree (script.md + archived r1/r2 files).

## Done

- Round-3 doctrine committed: worktree commits `4ca7ea0` (plan:
  `orgs/faceless-youtube/docs/superpowers/plans/2026-07-28-scripting-overhaul-r3-plan.md`) and
  `6aa9759` (grammar 357 ln, critics 335 ln, SKILL 165 ln, example-scripts 139 ln, decisions.md
  round-3 entry, STATUS.md).
- Run #3 executed blind through the staged pipeline (3 acts, 4 critics, editor 26 fixes, 1
  structural bounce, humanizer). Verified: conductor transcript greps `claude-opus-5` ×90;
  independent lint clean, 0 advisories; 1,628 words = 9:18. Output:
  `<worktree>/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/script.md`
  (r2 artifacts archived beside it as `*.r2.*`). UNCOMMITTED in the worktree.
- Boss inline review of #3 delivered to Daniel (findings below). Voice held front-to-back —
  the act-by-act + re-read fix cured the round-2 back-half drift. Keep it.

## Round-4 learnings (route to docs FIRST, artifact never)

**THE BIG ONE — Daniel-confirmed ("the audience is CONFUSED"): the caper reveal is unstaged.**
The one-sentence hook reveal is a TEASER, not audience knowledge — it plants a question, it does
not orient. Script #3 then behaved as if bricks were established: the clay wink (L29) and a
test-count/TSA audit lecture (L31–33) came BEFORE the act, and the bricks themselves entered
mid-logistics ("went shopping at the Colorado Brick Company") with no scene. Viewer is neither
surprised (wink + lecture spent the energy) nor oriented (orphaned callbacks to a scene never
built) → confused. Root cause: the coherence critic's structural bounce resequenced
explanation-before-event (textbook order); no doctrine says mystery order beats textbook order.
Doctrine to land (grammar §2/§3 + coherence-critic mandate + maybe SKILL 3a spine card):
- Under a spoiler-frame hook, the body must still STAGE the promised reveal as a scene:
  pressure → the corner they're in → the decision (the insane idea lands as a moment) → the act
  with its audacious detail → mechanism/explanation as the PUNCHLINE of "how did nobody notice,"
  never as pre-authorization.
- A viewer briefly confused because the answer is coming is engaged; a viewer pre-taught
  everything is bored. Coherence critics must not resolve mystery order into textbook order.
- Callbacks (the clay wink) only work pointing at a scene that exists.

**Line-level misses vs Daniel's explicit round-3 verdicts** (each is also a doc lesson — the
writer had no visibility into rejected phrasings; decide where rejects become visible, likely
example-scripts.md register notes or a grammar hunt-item, NOT a new file):
1. L13 "had just landed" + "beige box" — both rejected in r3 (he wanted "just invented a few
   years prior" + "all the craze / flying off the shelves"; "beige box" doesn't parse for him).
2. L51 ending = award irony; Daniel picked the counterfactual close ("who knows how many more
   years they would've gone on selling those bricks"). Grammar §3.5 exists but didn't bind.
3. L23 "ran the place on fear" — Daniel: "with, not on fear."
4. L45 "masonry" — Daniel: "probably just bricks."

**Boss judgment calls Daniel heard, pending his feedback:**
5. Rise told twice (L17 pre-tells IBM/125M/Compaq/600M, L29 re-climbs 185M/doubled) — one climb
   should own the numbers.
6. Lawsuit stretch 550/200/128 (+46M) — vs his "cut details, personify bigger picture" note.
7. Caper block has no pull at its peak (his register models "Perfectly indistinguishable. My
   Peloton bike is a scam, but these guys? Next level").
8. L43 dropped his "every quarter was worse than the last" flourish.

## Remaining (ordered)

1. **Get Daniel's round-4 feedback first** — he said he'd provide it on pickup. Do not start
   editing docs before hearing it.
2. Route all learnings into the doctrine files **replace-first, zero appended sections, stable
   § numbers, hard line budgets: grammar ≤357, critics ≤335, SKILL ≤165**. Fix the skill/grammar,
   never the artifact. UTF-8, no em/en dashes in script prose.
3. Regen fresh (archive #3 as `script.r3.md` etc., same pattern as r2 archives) via
   `long-form-writer` staged mode. Verify per protocol below before showing Daniel.
4. Housekeeping owed at arc close: scratch-file cleanup gate (script.r1/r2, *.r2.work);
   foreign commits `c0c676c`, `74356fb` + the audio-director grammar-guidance.md deletion riding
   on the branch (disclose at merge/PR time); remove the fyt-writer-r2 worktree when the branch
   merges (boss lease); commit the run artifacts to the branch.

## Protocol (BOSS.md — binding on the picker)

- Delegate substantive work; never fable. Verify worker model at grading: FIRST line of every
  grade = result of grepping
  `~/.claude/projects/C--Users-danie-kb/<session-id>/subagents/agent-<id>.jsonl` for `"model":`.
- Daniel-verbatim text goes into worker briefs as blockquotes with "the blockquote text IS the
  deliverable" (a round-2 worker once composed its own intro instead).
- Checkpoint with Daniel before regenerating a script; human gates one at a time.

## Load list

1. This file (delete on pickup per handoffs/README.md).
2. `C:/Users/danie/kb-worktrees/fyt-writer-r2/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/script.md` (+ `script.r2.md` for contrast).
3. `<worktree>/orgs/faceless-youtube/channels/the-second-take/storytelling-grammar.md` — the craft law.
4. `<worktree>/orgs/faceless-youtube/.claude/skills/long-form-writer/SKILL.md` + `references/critics.md`.
5. `<worktree>/orgs/faceless-youtube/channels/the-second-take/example-scripts.md` — the voice bar (register, not quarry/minefield).
6. `<worktree>/orgs/faceless-youtube/docs/superpowers/plans/2026-07-28-scripting-overhaul-r3-plan.md` — how round 3 was run (reuse the shape).
7. `<worktree>/orgs/faceless-youtube/knowledge/decisions.md` — round-3 entry (tail of file) for the full verdict history.
