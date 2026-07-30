# Pipe-test log — 2026-07-28-bricks-fresh (wave-3 PIPE-TEST, ZERO SPEND)

Incremental notes. Disk survives, context doesn't.

## Stage 0 — reads
- Read: VPW `SKILL.md`, `references/shots-schema.md`, `references/critics.md`, `scripts/lint_shots.py`,
  channel `visual-kit/visual-grammar.md`, `example-shots.md`, `visual-kit/style-bible.md` §1–§3,
  `dna.md` (visual block), `visual-kit/registry/registry.json`, `script.md`, `research.md`, `brief.md`.
- Branch verified: `claude/fyt-stack-trims`. No commits will be made.

## Derived numbers (mechanical)
- Lint's own VO stream (`build_vo_stream`) = **1,746 tokens** (includes the italic disclosure tail line;
  excludes `[B-ROLL:]` lines and inline `[PAUSE]`/`[BEAT]`).
- Lint runtime constant = **150 wpm** → `runtime_s` = 698.4 s (11:38).
  - HARD floor A: `len(shots) >= 698.4/5` → **≥ 140 shots**.
  - HARD floor B: `Σ duration_s >= 0.85 × 698.4` → **≥ 593.6 s**.
- Script header + `dna.md` say the locked voice measures **~175 gross wpm** → real runtime **9:52 = 598.6 s**.
- FINDING F-1 (recorded, not patched): the doctrine's 150 wpm constant is ~17% slower than this channel's
  measured voice, so the lint sizes the shot list for an 11:38 video that will actually run 9:52.
  Authoring to the truthful 598 s of duration only clears floor B by 5 s.
- Plan: **148 shots**, Σ duration ≈ 605 s, dense (2.0–3.0 s) through the first 60 s, 3.5–5.0 s after.

## Stage 1 progress
- (appended below as chunks land)

### Stage 1 — VPW authoring complete (pre-critic)
- `shots.json` written: schema v2, 188 long-form shots, Σ duration 616.5 s, thumbnail primary + 2
  challengers, `shorts: []` (no shorts exist for this video; brief says shorts skipped).
- Lint history: run 1 (24 shots) 3 HARD → run 2 (60) 2 HARD → run 3 (100) 2 HARD → run 4 (145) 1 HARD
  → run 5 (188) 1 HARD → **run 6: 0 HARD, 0 SOFT, `--write` derived vo_text on all 188.**
- Real HARD defects found by lint and fixed in the artifact: 2 text-supply hits, both FALSE POSITIVES
  of the guard (see FINDING F-4): `"the opening reading as a hole"` (L07) and `"half-moon reading
  glasses"` (L148) — the bare word "reading" trips `_RENDER_VERB`. Both reworded.
- Soft heads-ups fixed in the artifact: 6 delta-duration warnings (deltas > 3.5 s or > their base).
- FINDING F-2: `[PAUSE]`-bounded short VO lines make a >=4-word verbatim anchor impossible.
  3 anchors are 3 words ("MiniScribe. Longmont, Colorado.", "The audit passed.", "The serial numbers.").
  Including the bracket in `vo_ref` would break the matcher (it normalizes `[PAUSE]` into the needle).
- FINDING F-3: `lint_shots.py` crashes with UnicodeEncodeError on a Windows cp1252 console whenever it
  prints the Σ line; `PYTHONIOENCODING=utf-8` is required to see HARD output at all.
- FINDING F-5: style-bible §2e's verbatim clause ends "hold ONLY the rig form", and
  `lint_shots.py::control_leak_check` HARD-fails the phrase `rig form`. Writing the clause verbatim as
  the bible instructs is an automatic HARD violation. Worked around by ending the clause differently.

### Stage 1 — critic pass applied, re-lint CLEAN
- Fresh-eyes shot critic dispatched as a real Opus subagent (fresh context, charter verbatim, given
  shots.json + script.md + visual-grammar.md + registry.json + example-shots.md). Verdict:
  **restage-these-12, otherwise ship-with-edits**; 17 ranked findings.
- All 17 accepted; 16 fully applied in the artifact, 1 (finding 7, the disclosure-tail anchor) recorded
  in that shot's `notes` because it needs a human decision (spoken tail vs end card), not a restage.
- ~40 of 188 shots touched (21%, under the >1/3 second-cycle threshold) - ONE cycle only, per critics.md.
- Re-lint after edits: 1 HARD (a third `_SLOT` false positive: the palette phrase "one red price rail"
  read as an unsupplied "price" element) + 1 SOFT delta duration. Both fixed; final run: **0 HARD, 0 SOFT**,
  `--write` re-derived vo_text on all 188.
- Final numbers: 188 shots, Σ 620.5 s, 21 declared stages covering 58 shots, non-literal share 95.7%
  (8 `literal` shots, all concrete physical objects/actions).

## Stage 2 — image-generation Pass 1 (DERIVATION ONLY, nothing generated)
- Ran `image-generation` SKILL Pass 1 steps 1–2 ONLY. Output: `pass1-gate.md`.
- Resolution: 28 backticked vocabulary names, **all 28 resolve** against registry.json (no typos, no
  invented slugs); + 6 un-backticked seed assets the seed law requires (crowd-exemplar, lettering exemplar,
  stamp exemplar, 3 env anchors) = 34 existing/reused.
- Gate list: **19 missing** — 7 named characters + 12 recurring prop canonicals.
- FINDING F-6: `registry.json` has NO `prop` kind (only character/expression/action/pose/interaction/
  crowd-anchor/environment), yet visual-grammar §2 tells VPW to name "every recurring figure, pose,
  expression, and PROP ... by its exact registry.json name" and image-gen Pass 1 gives recurring props a
  canonical slot. There is no vocabulary to name a prop with, so all 12 prop slots had to be derived from
  prose by the Pass-1 reader. STOPPED at the gate. Nothing generated, nothing tagged. Zero spend.

## Stage 3 — motion-planner
- `shots.motion.json` authored from shots.json: 188 shots, `baseline_life: true`, `post_vo_hold_s: 3.0`,
  no chapter cards (an opaque card needs a co-located audio-director pause cue; no audio plan exists).
- First lint: **0 errors** on the first run. Fresh-eyes motion critic (real Opus subagent, charter
  verbatim + 2 extra mechanical checks) returned **15 findings**; all 15 applied in ONE revise pass.
  Biggest: 25/29 cutouts named no seed; 5 mid-chain hybrids left the FOLLOWING baked delta with no
  composite to seed from; L39/L82 were unseeded re-bases inside a live stage; 3 stamp beats (L12/L139/
  L176) were missing the doctrine's named `appear`+`slam` case. Finding 14 required a fix in
  `shots.json` (L37's face-change clause is unrenderable on a reused plate) - struck, shots re-linted.
- Post-revise: motion lint **0 errors**, shots lint **0 HARD / 0 SOFT**. 27 layered shots, 34 layers
  (15 appear, 11 path, 5 slide, 0 bob), 2 camera punctuations, 5 `reuse` layers.

## Stage 4 — render-builder dry run
- Command (flags adjusted to `--help`): `py -3 .claude/skills/render-builder/scripts/build_motion.py
  channels/the-second-take/videos/2026-07-28-bricks-fresh --dry-run --allow-missing --motion-plan
  channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.motion.json` → exit 0.
- Piece summary: long-form, 188 shots, **620.5 s**, `retime_basis: "shots-estimate (no VO length
  available)"`, `vo_seconds: null`, `scenes_from_files: 0`, `inline_fallback: 188` (every shot a
  placeholder — nothing has been generated), `camera_moving: 2/188`, `music_missing: 1`,
  `dry_run: true`, `state: "dry-run"`. It says the VO fallback out loud, as expected.
- Derived `assets/motion/long-form.motion.json`: 188 shots, `start_s` values are an exact cumulative
  sum of `duration_s` (0 mismatches; anchored retime is impossible without a VO word-stream, and the
  file says so), all 21 stages preserved as contiguous `stage`/`stage_role` runs across 58 shots, both
  authored camera moves survived (`L01` push-in 0.25, `L166` pull-back 0.2), total timeline 623.5 s
  = 620.5 + the plan's `post_vo_hold_s: 3.0`.
- **Layer merge PROVED by probe:** with three 1×1 placeholder PNGs briefly dropped at
  `scenes/L127.png` + `cutouts/L128-sale-out.png` + `cutouts/L128-sale-cash.png` (no spend, deleted
  immediately after), L128 derived as `plate: "scenes/L127.png"` + two `layers[]` with resolved `src`
  paths and full animation params, plus `idle: "bob"` / `baseline_life: true` from the plan's opt-in.
  Without the PNGs, build_motion reports each layered shot's exact expected asset paths and drops the
  layers — so plan ingestion is proven either way. Probe files removed; the on-disk derived JSON is the
  honest zero-asset version.
- Observation O-1 (cosmetic): the layered branch of `apply_motion_plan` sets `plate`/`layers` but does
  NOT `pop("placeholder")` the way the plate-only branch does, so a merged layered shot keeps a stale
  `placeholder` block and is still counted in `inline_fallback`. Harmless at render (`Video.tsx` tests
  `shot.layers` before `PlaceholderCard`), but the manifest count misreports layered shots.

## Close
- ZERO SPEND honoured: no image generation, no TTS, no API call of any kind; render step was
  `--dry-run` only. No commits, no doctrine/code edits.
