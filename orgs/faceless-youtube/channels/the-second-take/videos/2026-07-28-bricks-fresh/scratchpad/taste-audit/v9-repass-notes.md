# V9 VPW scoped re-pass notes

## 2026-08-18 — intake and baseline

- Preamble: PASS.
- Mode: `visual-prompt-writer` SCOPED-REPAIR. Caller targets L02, L03, L04, L06, L07, L11, L20, L21, with L17 added only if diagnosis proves a real prompt defect. The existing `vpw-log.md` cast declaration is reused; no cast is re-declared.
- Required reads completed: `script.md`, `research.md`, channel `dna.md`, `visual-grammar.md`, `example-shots.md`, live `registry.json`, `shots-schema.md`, `critics.md`, and the current `shots.json`. The scoped shots all belong to Act 1, so the Act 1 partition remains whole.
- Era-register reference read via `git show 30d2b7e8`: its useful idiom is a wide three-quarter supply-stall scene with a small labouring line across a creek and a populated background tier. It is a register reference only; no wording will be copied.
- Baseline lint invocation: `python .claude/skills/visual-prompt-writer/scripts/lint_shots.py channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`.
- Baseline lint: 6 HARD / 82 heads-up. HARD: L02, L06, L07, L20, L21 crowd-distance; L17 two-seeded-figure plane/eye-line/relative-scale presence.
- Baseline integrity hashes: file `b7950580ab27fd33cad5e5abe85682f4c5d5f1f82d78d0cf0fc22b39df12fb8a`; all bytes with only L02/L03/L04/L06/L07/L11/L17/L20/L21 prompt strings masked `d3a8d3aa3005f8a9e5399a5827f5424a3a293a7cab60cc13887d43f0203eb9bc`; suffix value `ce1bc8e02c8678a131018761053d67a1746350fc5d77727c2eb7227ef4c548bb`.

## L17 diagnosis before authoring

- Rule: C-8 `two_cast_presence_check` in `lint_shots.py`; two seeded figures must state plane, eye-line, and relative head scale. The rule landed in `849679f0` on 2026-08-04.
- The current L17 wording was introduced in `573414b7` on 2026-08-18. That run recorded 0 HARD / 36 heads-up.
- At `573414b7`, `rival-pc` existed only as a newly planned name in prompt prose, not in the channel registry. `video_chars()` therefore resolved only `pc-boxy`, so the existing two-cast test did not fire.
- Commit `693b0fff` later the same day promoted `rival-pc` into `registry.json` without changing either L17 or `lint_shots.py`. From that file state onward, the same lint code resolves both figures and correctly exposes L17's missing C-8 clauses. This is a real prompt defect uncovered by asset-state completion, not a new V5 lint artifact.
- The heads-up mismatch is also file-state/invocation context: 36 is exactly the non-VO set (24 delta-duration + 5 place-variant + 7 seated-support); 82 adds the 46 real-hold findings emitted only when the video-directory `assets/voiceover.manifest.json` is visible. The historical progress note's 36-count run therefore did not lint with that manifest in its lint target directory; the current in-place invocation does.

## Scoped authoring plan (Step 2, before prose)

- L02 `idiom-pun`: keep floor-level roller-rink/hair gag; move the mass behind real rink furniture so small overlapping silhouettes, not near-camera shoulders, carry the joke.
- L03 `ironic-counterpoint`: keep high rear-room vantage, applause and empty-dais hot-spot joke; replace near-black mass with warm brown/honey/cream room colour.
- L04 `diegetic-device`: keep oblique dawn shopfront and terminal `'1983'`; make warm oak/cream/amber the surfaces, with blue dawn confined to ambient light/reflection.
- L06 `crowd-multiplication`: keep the display's own vantage and hungry demand; put the crowd small behind receding display islands and the shop glazing.
- L07 `literal`: keep above-counter buying beat; put the buyers at the far till behind receding display tables, with a long banknote trail carrying the purchase action.
- L11 `personified-character`: keep bedside memory-locket beat; make walnut/cream/honey dominant, with blue confined to a narrow window light.
- L17 `staged-interaction` delta: keep the L16 ring, body-to-body scrum and one-change delta; carry plane, matching eye-line, relative scale, and crowd distance in the compact restatement.
- L20 `idiom-pun` base: keep `drive-maker` presenting tools at the supply stall; restore wide-with-air scale contrast, small labouring prospectors across intervening creek geometry, and an active tent/spoil background.
- L21 `idiom-pun` delta: hold L20's exact stage facts and add only the open coin box as the terminal change.

