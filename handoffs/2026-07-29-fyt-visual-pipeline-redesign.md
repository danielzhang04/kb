# fyt visual-pipeline redesign handoff — 2026-07-29

## Context

Three-wave doctrine overhaul of the faceless-youtube visual+audio pipeline, run 2026-07-28 from the
boss session on branch `claude/fyt-stack-trims` (LOCAL ONLY, unpushed, ~10 commits). A parallel r2
terminal owned the writer files (`long-form-writer` etc.) on `claude/fyt-writer-grammar-slim` — do
not conflate the two.

- **Wave 1**: trimmed visual-prompting + image-gen docs ~2,900→~1,590 lines. Rulings: learnings fold
  into rule wording (no changelogs), retired features live only in `docs/retired-features.md`, zero
  examples, universal.md full trim.
- **Wave 2**: same for audio/voiceover/motion/Remotion (1,512→1,290; animation-menu.md deleted,
  grammar-guidance merged into audio-director SKILL).
- **Wave 3**: FUNCTIONAL redesign. visual-prompt-writer = thin procedure owning "cut script →
  generate a shit-ton of image prompts" (+ thumbnails); image-generation = two sequential passes;
  style bible = channel LOOK laws only (~165 lines, descriptor blockquotes byte-frozen); work split
  mirrors scripting split (VPW : visual-grammar : example-shots : shot-critic). shots.json v2
  (`faceless-youtube/shots@2`). Pre-gen human approval gate kept, at image-gen Pass 1. Writer emits
  pure prose (no [B-ROLL]/[PAUSE]).
- **Pipe test**: zero-spend end-to-end on the real Bricks script → 188 shots, `pass1-gate.md`
  approval sheet, 14 doctrine findings.
- **Fix wave** (graded PASS, opus worker): Daniel's dials applied — cadence band **1.5–3s, license
  to 4 but generally not** (lint floor ÷4); prompts describe **CONTENT never art STYLE** (style
  injected by suffix only); lint sizes runtime from the script header wpm (Bricks header = 175 wpm);
  style-bible §2e reword is the ONLY blockquote change ("hold ONLY this form."). Standing edit law
  from Daniel: change functionality in place, never append rule piles.

Commits (fix wave, newest first): `79a5dae` bible, `94eafe4` VPW docs, `65869c3` motion/render,
`4edc243` lint+tests. Tests green: VPW+motion 95, render-builder 185, image-gen 27 (run image-gen
and sfx-forge test dirs in SEPARATE pytest invocations — both have a `forge.py`, module collision).

Side note (closed): a path-mangled secrets copy `Usersdaniekborgsfaceless-youtube.env` appeared in
`channels/the-second-take/` — cause was a shell-quoting accident (unquoted backslash path in POSIX
shell) while a worker copied the missing `.env` to the fyt root. Deleted by Daniel; `*.env` added to
fyt `.gitignore` (`2cd386f`); the real `.env` now sits correctly at `orgs/faceless-youtube/.env`
and voiceover/image-gen/sfx-forge all resolve to it.

## Done

- All wave-1/2/3 + fix-wave commits on `claude/fyt-stack-trims`, each worker graded with
  model-verified transcripts; fix wave independently re-verified (tests, bible diff exact, stale
  cadence-number greps zero, Bricks lint reproduces 1 HARD at L188 only).
- Pipe-test artifacts at `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/`
  (untracked): shots.json (188 shots), pass1-gate.md (19 missing assets: 7 characters + 12 props,
  ≈$2.50), script.md.

## Remaining (ordered)

1. **Gate C — PASSED 2026-07-29** (Daniel read `visual-grammar.md`, VPW `SKILL.md`,
   `example-shots.md`: "looks good for now, may iterate later"). Items below unblocked.
2. **Land the branch**: push `claude/fyt-stack-trims`, PR to main. Then records: decisions.md entry
   + STATUS.md update for the redesign (not yet written).
3. **Prove on pixels**: first paid image-gen Pass 1 off a ready approval sheet (~$2.50). The
   redesign is validated zero-spend only — operating-law §D says don't lock a stage on theory.
4. **r2 writer sync**: pipe test found the writer can still emit [B-ROLL]/[PAUSE]; new VPW contract
   assumes pure prose. Writer files belong to the r2 terminal/branch — route the finding there.
5. **Bricks L188** (owner of the Bricks run decides): shot L188 anchors on the script's italic
   disclosure line, now correctly excluded from the VO stream. Script marks it "spoken tail OR end
   card". End card → re-anchor L188 to "That's a workday" (proven 0 HARD). Spoken → de-italicize in
   script.md.
6. Known fallout, accepted: archived poyais lints 1 extra HARD under the ÷4 floor (shipped video,
   expected); Bricks dry-run rewrote derived `assets/motion/*.json` + `render.manifest.json`
   (untracked).
7. **Future arc (any terminal, AFTER items 2–3)**: wave-3-style functional redesign of the
   post-image stack — render-builder (432 lines/5 files) and motion-planner (228/4) are the
   candidates for the procedure/grammar/checker split; audio-director, voiceover, and the small
   forges are already lean (wave-2 trimmed, ≤185 each) and likely not worth restructuring.
   Daniel approved queueing this 2026-07-29. Do not start before the branch lands and the paid
   Pass 1 pixels proof validates the upstream contract.

## Load list

- `orgs/faceless-youtube/CLAUDE.md` (router; imports operating-law)
- `orgs/faceless-youtube/docs/superpowers/plans/2026-07-28-visual-pipeline-redesign-plan.md` (the plan)
- `orgs/faceless-youtube/channels/the-second-take/visual-kit/visual-grammar.md`
- `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/SKILL.md`
- `orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md`
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/pass1-gate.md`
- Branch to work on: `claude/fyt-stack-trims` (local, unpushed — do not rebase away)
