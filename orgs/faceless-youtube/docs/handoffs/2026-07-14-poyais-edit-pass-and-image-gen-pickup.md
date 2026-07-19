# PICKUP — Poyais edit pass DONE; image-gen is next (2026-07-14)

> **▶ RESUME HERE.** The full user-directed edit pass on the **gold Poyais** (`videos/2026-07-04-poyais/`)
> is complete and verified. The next action is **image-generation** on that video. Everything below is on
> disk — do not rely on chat history.

## State — READY for image-gen
- **Target:** `channels/the-second-take/videos/2026-07-04-poyais/` (the GOLD full video, ~9.5 min).
- `shots.json` + `shots.motion.json` — **118 shots** (was 125; 7 removed: L02/L04/L09/L20/L21/L28/L113,
  IDs kept stable with gaps). **36 layered shots** (device cards + cutouts + hybrid pop-ons).
- **Both lints GREEN:** `lint_shots.py` HARD violations none; `lint_motion_plan.py` 0 errors.
- **Backups:** `shots.pre-vpw-rerun-2026-07-14.json`, `shots.pre-edits-2026-07-14.json` (+ motion equivalents).
- **Edit manifest (the user's intent, source of truth):** `videos/2026-07-04-poyais/_edit-manifest-2026-07-14.md`.
- Env: deps installed (pillow/rembg/onnxruntime), `GEMINI_API_KEY` set, run scripts with `py -3`.

## What was done this pass (all verified)
- **~40 user edits + 7 removals** applied via 7 cluster agents → merged → lint. **Intent-critic 7/7 PASS**
  (fresh agents checked each edit vs the manifest).
- **Assertive device-card rule** (motion-planner `references/animation-rules.md`): device cards flipped
  timid→assertive (promote-and-subtract every payoff number/section-turn/debunk-list). Critic scoped to cutouts.
- **§2e BASE-RIG tier ADDED** to `style-bible.md` (the fix for anonymous LARGE/foreground figures — the
  three-tier model: named→seeded canonical(§2c) / anon-foreground→§2e authored / anon-crowd→§2d). Propagated
  to image-gen SKILL, VPW SKILL, visual-grammar. 7 anonymous roles de-cast → §2e or §2d per shot.
- **2 new character canonicals generated + APPROVED + registered:** `strangeways`, `hastie` (registry now
  has base/macgregor/bolivar/mosquito-king/strangeways/hastie; refs/ written). LESSON: use **batch-and-pick
  with the FULL rig spec** for character/prop locks — serial single rolls drift one feature per roll and
  burn credits (the Strangeways ear→book→mouth→eyes saga).
- Mojibake cleaned (386 seqs in shots.json), L112 Paris route geometry fixed, L10 = FICTION onto the
  fully-built paradise.

## ▶ NEXT — image-generation (RESUME AT Pass 1b / props-gate confirm)
Run the `image-generation` skill on slug `2026-07-04-poyais`. Sequence:
1. **Pass 1 — recurring PROPS (human gate). ✅ DONE 2026-07-14 — 6 props generated + in `assets/library/`,
   awaiting the user's final approve.** Board (same URL, republish the scratchpad
   `poyais-props-review.html` to update): https://claude.ai/code/artifact/a9f56ec8-d792-447b-b319-5a2a1976b8b5
   - Generated: `prop-guidebook` (9 shots), `prop-poyais-bond` (5), `prop-poyais-banknote` (3),
     `prop-poyais-flag` (3), `prop-macgregor-portrait` (3, SEEDED off macgregor), `prop-land-grant-deed` (2).
     All in the library manifest (`kind:prop`, `gate: awaiting human approval`). All read strong/on-rig.
   - **`paradise-brochure` was DROPPED** — it appears in only ONE shot (L114), so it earns no recurring-prop
     canonical (a prop has no rig to fall off, unlike a single-shot named CHARACTER). Removed from the library
     AND from L114's `props[]`; it composes in-scene in Pass 2. **VPW authoring gap to fix later: `props[]`
     should carry only cross-shot (≥2) recurring objects — it over-declared a single-shot prop.**
   - **macgregor-portrait was re-rolled once:** the first take used an "oil painting" prompt → the face drifted
     off-rig (oval head + jaw + realistic shading + nose hint). Re-rolled SIMPLE (flat-cel round rig held, no
     painterly face; painting-ness lives only in frame/backdrop) → on-model. LESSON: never ask for a
     "realistic/oil painting" of a character — it invokes the realistic-bust prior and breaks the round no-nose rig.
   - **When resuming: just re-confirm the props gate with the user, then go to Pass 1b.** (If they already
     approved, skip straight to 1b.)
2. **Pass 1b — posed-character merges** (cast combos: macgregor/bolivar/mosquito-king/strangeways/hastie ×
   their pose_ref/expression_ref). Internal isolation-verify, no user gate. NOTE: shared `_staging/` is
   polluted with old scratch — use `--force`, verify provenance, move outputs to the video library promptly.
3. **Pass 2 — scenes, in ~20-SHOT CHUNKS** (user-agreed). Review each chunk via an Artifact before the next.
   - Normal shots → `scenes/<id>.png`. Device-card shots → number-subtracted `scenes/<id>.png` (the motion
     `background.subtract` names the omitted figure). Cutout shots → `plates/<id>.png` + `cutouts/<id>-<layer>.png`
     (`forge cutout`). Hybrids → reuse the prior `scenes/<prior>.png` as plate, gen only the cutout.
   - `cutout_prompt`s never say the literal word "plate" (dinner-plate bug) — they use "isolated on a plain
     flat pale background, no surface under it".
   - The batched review stamps `verified:{scene,rig}` in `scenes/manifest.json` (render gate reads it).
4. Then: voiceover (whole video, cheap) + audio-director (whole video) → `build_motion` chunked render.

## Gotchas / learnings to carry
- **Batch-and-verify all gens** (not serial rolls) — credit discipline the user cares about.
- **Layered-base vs seed rub:** a shot can't reuse a NON-baked prior (a hybrid/cutout shot has no
  `scenes/<id>.png`) — those self-plate. Handled in the current files; keep in mind for regens.
- **§2e for anonymous foreground figures** is authored PROSE (forge only auto-appends §2c on a seed).
- Pinned memory **[[prefer-layered-shared-base]]** — DEFERRED planner improvement (reuse shared bases more).
- User reviews images via **Artifact link** only; renders via the **Windows default player** (VS Code muted).

## Deferred / not done
- `decisions.md` + CLAUDE.md log entry for today's changes (assertive cards, §2e tier, the edit pass) — owed.
- Tier-2 integration slice `_poyais-test-slice` (separate track) unaffected by this pass.
