# Rebuild notes: overnight board extended to Wave-1 seeds + full Wave-2

## Investigation (before any edit)

- `registry.json`: top keys `channel, engine, characters, assets`. `characters` is a
  dict of 24 entries keyed by character slug, each with a `base` image path (23 of
  24 have `base`; all 24 in fact do). `assets` is a flat list of 63 entries with
  `{name, file, character, kind, tag, seed_frame[, note]}`. All paths are of the
  form `channels/the-second-take/visual-kit/refs/...` and resolve relative to the
  **org root** (`orgs/faceless-youtube/`), i.e. `CHANNEL.parents[1]`. Verified: 0
  missing files among all 63 assets + 24 character bases on this disk.
- 7 characters' `base` image is literally the SAME file as one of their `identity`-kind
  asset entries (macgregor, bolivar, mosquito-king, miniscribe-rep, ibm-suit, pc-boxy,
  terry-johnson) plus the `base` template character coincides with the `kind:"base"`
  asset. That's 8 overlaps. Dedup by resolved absolute path -> 63 assets + 16 standalone
  character-only portraits = **79 unique Wave-1 images**.
- Wave-1 kind breakdown (all char='base' unless noted): base=1, action=13, expression=16,
  pose=17, interaction=3, crowd-anchor=1, identity=7 (one per named character),
  prop=2 (character=None), environment=3 (character=None), plus new bucket
  `character-base`=16 (standalone character portraits not already an asset entry).
  1+13+16+17+3+1+7+2+3+16 = 79. Matches unique-path count.
- Wave-2 sources: `visual-kit/_staging/fig-*.png` = 107 plain cards (currently staged).
  `visual-kit/_staging/_staging_flagged_*.png` / `_staging_rejected_*.png` = 6 files
  living INSIDE `_staging` (2 flagged + 4 rejected) -- these are what the OLD script
  already picked up. `visual-kit/_staging_flagged_*.png` / `_staging_rejected_*.png`
  in the visual-kit ROOT = 47 files (9 flagged + 38 rejected) that the OLD script
  never looked at -- this was the actual gap the brief flagged.
- **Dedup key correction**: the brief's phrase "dedup by content hash in filename"
  is ambiguous. The trailing token in these filenames (8 hex chars) is NOT a safe
  global content hash -- verified empirically: `55bd2c0a` appears as the trailing
  token on BOTH `fig-auditor-rep--55bd2c0a.png` and
  `fig-hq-banker--expr-deadpan--55bd2c0a.png`, two different characters / different
  pixels (found 5 such raw-hash collisions across different characters in the plain
  107 alone). Deduping on the raw hash token would have wrongly merged unrelated
  cards. Used the FULL filename stem (character+pose+hash, with only the
  `_staging_flagged_`/`_staging_rejected_` prefix stripped) as the dedup key instead
  -- this is what actually identifies "the same generated frame," and it's what
  correctly merges e.g. `_staging_flagged_fig-qt-wiles--back-to-viewer--dfb3cd97.png`
  and `_staging_rejected_fig-qt-wiles--back-to-viewer--dfb3cd97.png` into one card
  with both badges, matching the brief's own example.
- With full-stem dedup: 117 unique Wave-2 cards total (107 plain + 10 that exist
  ONLY as flagged/rejected copies, no promoted plain card). 10 stems carry both a
  flagged AND a rejected copy. 33 stems have a plain (verified/parked) card AND a
  flagged-or-rejected copy sitting alongside it (kept for defect reference per the
  existing note convention).
- **Anomaly**: cross-checked remaining.json's 28 `not_yet_attempted` + 1
  `generation_failed_needs_regen` items against the full-stem union of files on
  disk -- ALL 29 already have an image file somewhere (plain, flagged, or
  rejected). remaining.json is stale relative to disk for these; true "deferred
  with literally no image anywhere" count = 0 on this board, versus the old
  board's static header claim of "26 deferred" (that number is a historical
  run-total snapshot, left untouched per the header-intact rule; the LIVE grid
  tally now correctly reads 0 deferred from current disk state). All 8 items
  remaining.json marks `status: parked` do correspond to the 10 no-plain-card
  stems (rich `failed_invariants`/`note` used for their badge tags).

## Plan
1. Add `load_wave1_seeds()` (registry.json -> 79 entries, kind/character grouping,
   missing-file detection) + `wave1_section()`/`wave1_card()` renderers. New
   section inserted after the header, before the existing Scene-tenth section.
2. Rewrite `load_figure_cards()` for full-stem dedup across
   `_staging/fig-*.png` + `_staging/_staging_{flagged,rejected}_*.png` +
   ROOT `_staging_{flagged,rejected}_*.png`. Each card gets a primary badge
   (verified/parked/unreviewed for plain-backed stems; flagged/rejected for
   no-plain stems) plus a `secondary` list of any other states found for that
   same stem, rendered as extra chips.
3. Add `.fcard.flagged` / `.fcard.rejected` CSS + secondary-badge chip styles.
   Keep the existing lightbox script untouched -- it already binds to every
   `.board-image`, so new sections just need that class on their `<img>`.
4. Cache JPEG encoding with `functools.lru_cache` keyed on (path, edge, quality)
   since the existing size-stabilization loop re-renders the whole doc up to 4x
   and image count nearly tripled (25 scene + 117 fig + 79 wave1 = 221 images).
5. Adaptive byte-budget loop: quality first (70->55->45->35), then edge
   (fig/wave1 384->320->256), scene edge last-resort. Never drop images.
6. Update `verify_document()` expected-image-count math and `main()` summary
   prints for the new totals.

## Implementation (build_board.py)

- Added `load_wave1_seeds()` / `wave1_card()` / `wave1_missing_card()` /
  `wave1_kind_section()` / `wave1_section()`. New `<section class="wave1">`
  inserted between the header and the (untouched) Scene-tenth section.
  `_resolve_registry_path()` tries `ORG_ROOT`, `CHANNEL`, `KIT` in order for
  robustness even though `ORG_ROOT` alone resolved all 87 registry paths.
- Rewrote `load_figure_cards()`: three-source scan (`_staging/fig-*.png`,
  `_staging/_staging_{flagged,rejected}_*.png`, ROOT
  `_staging_{flagged,rejected}_*.png`), full-stem dedup (see anomaly note
  above), primary badge from review.json/remaining.json when a plain card
  exists, else `rejected`/`flagged` from whichever copy exists (rejected wins
  if both present as primary), `secondary` list carries any other state found
  for the same stem. `figure_card()` renders secondary states as
  `ALSO FLAGGED` / `ALSO REJECTED` chips next to the primary stamp.
  `char_section()` counts now cover all 5 image-backed badges + deferred.
- `BADGE_ORDER = [rejected, flagged, parked, unreviewed, verified]` drives both
  sort order (worst-first, matching the old parked-first convention) and the
  live-tally string.
- Cached JPEG encoding via `functools.lru_cache` on `_encode_jpeg(path_str,
  max_edge, quality)` -- the existing byte-size stabilization loop re-renders
  the doc up to 4x and image count nearly tripled (25 scene + 117 fig + 79
  wave1 = 221 max), so this was necessary to keep runtime sane. All three card
  renderers now pass quality/edge explicitly at call time (not as Python
  default-arg values, which would have frozen JPEG_Q at import time and broken
  the adaptive loop).
- Adaptive byte-budget ladder in `main()` (`SIZE_ATTEMPTS`): quality
  70->55->45->35 first, then fig/wave1 edge 384->320->256, scene edge as last
  resort 640->560->480. Mutates module globals `JPEG_Q/FIG_EDGE/WAVE1_EDGE/
  SCENE_EDGE` between attempts. Never drops an image.
- Header: existing 4 summary divs left byte-for-byte as before EXCEPT the
  Wave-2 div's dynamic "live grid tally" line, which now lists every badge
  present instead of just verified/parked/unreviewed/deferred. Added a 5th
  summary div ("WAVE-1 SEED ASSETS") purely additive. `.summary` grid CSS
  changed from a fixed 4-column to `auto-fit` so 5 tiles wrap cleanly.
  `load_scene_tenth()` and the `FINDINGS` list are untouched (verified via
  `git diff` -- zero lines changed in either).
- `verify_document()` now also asserts the Wave-1 image count.

## Result (actual run, verified by independent parse of board.html)

- Ran on first attempt at defaults (JPEG_Q=70, FIG_EDGE=384, WAVE1_EDGE=384,
  SCENE_EDGE=640) -- no adaptive tightening needed.
- board.html = **3,763,283 bytes** (~3.76 MB, well under the 16 MiB cap).
- `class="board-image"` count = 218 = `data:image/jpeg;base64,` count = 218
  (every embedded image is lightbox-wired, none orphaned).
  Breakdown: 79 Wave-1 (`w1card` count) + 117 Wave-2 (`fcard` count) + 22
  scene images (of 25 `scard` rows; 3 are the pre-existing no-image
  PARKED/blocked rows, unchanged from before).
- Wave-1: **79 rendered / 0 missing** on disk.
- Wave-2: **106 verified / 1 parked / 1 flagged / 9 rejected / 0 unreviewed /
  0 deferred = 117 cards** (43 of those cards additionally carry an "ALSO
  FLAGGED"/"ALSO REJECTED" secondary chip for a second state found on the
  same stem).
- Scene tenth: 17 verified / 8 parked (of 25) -- identical to before.
- `findings` count = 6 (a-f) -- identical text, confirmed via `git diff`
  showing zero changes inside `FINDINGS` or `load_scene_tenth()`.
- `<title>Bricks-Fresh Overnight Review Board</title>` present; lightbox
  script (click/arrow-keys/Esc, generic `.board-image` selector) untouched.

## Follow-up 1: script/VO text on scene-tenth cards

- Standing requirement from Daniel (relayed by the coordinator): every scene
  card must show the part of the script/VO the shot plays over.
- Inspected `videos/2026-07-28-bricks-fresh/shots.json` schema: top-level
  `long_form.shots` is a flat list of 246 shot objects, each with `id`,
  `duration_s`, `vo_ref`, `vo_text`, `shot_class`, `stage`, `still_prompt`,
  etc. Two candidate narration fields exist -- **used `vo_text`** (falls back
  to `vo_ref` if ever absent). Checked all 17 of the L01-L25 shots where the
  two differ: `vo_ref` is a shorter, often mid-sentence-truncated caption
  fragment (looks like an on-screen-caption length budget), while `vo_text`
  is always the complete narration line for that beat -- the actual "script
  the image plays over," matching the ask. All 25 of L01-L25 are present in
  shots.json with a non-empty `vo_text`, so the "no script span found" path
  (triggered when an id is missing from shots.json, or defensively when its
  text is empty) did not fire on this video, but is implemented and would
  fall through cleanly (falls back to `vo_ref`, then to the literal label)
  without crashing on a missing id.
- Added `load_shot_vo_map()` (id -> vo_text, reading `long_form.shots[]`)
  called once from `load_scene_tenth()`; every row (both `kind:"image"` and
  `kind:"blocked"`) now carries a `script` field.
- `scene_card()`: renders a new muted `<p class="script">` block (CSS:
  `.script` / `.scriptlabel`, left-bordered muted italic block, matches the
  board's existing muted/panel language) under the header on every scene
  card, image or blocked. For image-kind cards, the same script text is also
  appended to the `<img alt>` (`... | SCRIPT: <text>`), which the existing
  lightbox JS already surfaces as the zoomed caption (`caption.textContent =
  current.alt`) with zero JS changes needed.
- Did not touch W1 (`wave1_*`), W2 (`load_figure_cards`/`figure_card`/
  `char_section`), `FINDINGS`, `findings_section()`, or the header/summary
  markup -- only `load_scene_tenth()` and `scene_card()` changed, plus one
  new loader function and two new CSS rules.
- Re-verify (independent parse of board.html after this change): size
  3,767,175 bytes (was 3,763,283 before; +3,892 bytes for 25 script blocks);
  `board-image`==`data:image/jpeg` count still 218; `scard`=25 with all 25
  also carrying `class="script"`; `fcard`=117, `w1card`=79, `finding`=6, all
  unchanged; `"no script span found"` occurrences = 0.
- No git commands were run for this follow-up (per explicit instruction).

## Follow-up 2: Wave-1 section restricted to finished character seeds only

- Second standing ruling from Daniel (relayed by the coordinator): the Wave-1
  section should NOT show the base character library, only finished
  character seeds.
- Rewrote `load_wave1_seeds()`: removed the `characters[*].base` loop
  entirely (was producing the 16 standalone "character-base" cards, e.g.
  `strangeways-base`, `hastie-base`, plus the merge logic that folded 7 of
  those into their matching `identity` asset and 1 into the `base` rig
  template's own asset record -- all of that machinery is gone, no longer
  needed). In the `assets[]` loop, now skip any entry with `kind == "base"`
  or whose `file` contains `refs/base/`.
- Checked empirically what that leaves: of the 63 `assets[]` entries, 51 have
  `file` under `refs/base/` (all of kind pose=17, expression=16, action=13,
  interaction=3, crowd-anchor=1, base=1 -- i.e. on this registry, EVERY
  pose/expression/action/interaction/crowd-anchor entry is part of the
  shared base-template library; none of those kinds have a distinct
  per-character variant). The 12 that survive: identity=7 (one finished
  portrait per named character: macgregor, bolivar, mosquito-king,
  miniscribe-rep, ibm-suit, pc-boxy, terry-johnson), environment=3, prop=2.
  So "kept kinds identity/pose/expression/action/interaction" per the brief
  resolves to just identity=7 on this registry, plus the 5 non-character
  environment/prop seeds -- not a bug, that's what's actually in
  registry.json right now.
- Updated the header's WAVE-1 summary line to describe the new scope
  ("finished per-character seeds only ... base character library and
  generic base pose/expression/action library excluded") instead of the old
  "every characters[*].base + assets[] entry" text.
- `wave1_card()`, `wave1_section()`, `wave1_kind_section()`,
  `wave1_missing_card()` all untouched -- they already rendered whatever
  `load_wave1_seeds()` handed them, so no changes needed there.
- W2 (`load_figure_cards`/`figure_card`/`char_section`), `FINDINGS`,
  `findings_section()`, and the Follow-up-1 script-span work
  (`load_shot_vo_map`/`scene_card`) are all untouched by this change.
- Re-verify (independent parse of board.html after this change):
  - size: **2,894,369 bytes** (was 3,767,175 before this change; the base
    library was most of the image weight -- still well under the 16 MiB cap;
    no adaptive tightening needed, fit at defaults on the first attempt).
  - `board-image` count = `data:image/jpeg;base64,` count = **151** = 12
    (w1card, down from 79) + 117 (fcard, unchanged) + 22 (scene images,
    unchanged).
  - `w1card` count = **12**, by kind: identity=7, prop=2, environment=3
    (parsed directly from the `<h3>kind</h3>...<span class="counts">N
    seeds</span>` headers in the rendered HTML). `"character-base"` no
    longer appears anywhere in the document.
  - `fcard`=117, `finding`=6, `scard`=25 with all 25 still carrying
    `class="script"` and 0 `"no script span found"` -- Follow-up 1 and the
    original W2/findings/scene-tenth work all confirmed unchanged.
  - Wave-1 missing = 0 (all 12 kept entries resolve on disk).
- No git commands were run for this follow-up (per explicit instruction).

## Follow-up 3: remove Wave-1 entirely; fix Wave-2 state semantics; failed-cards.json

Human feedback on the published board, three changes:

### 1. Removed the Wave-1 section entirely

registry.json is channel-wide and was surfacing another video's characters
(Bolivar, MacGregor, Mosquito King) on this board -- Daniel ruled the whole
category off. Removed, not hidden:
- `_resolve_registry_path()`, `load_wave1_seeds()`, `wave1_card()`,
  `wave1_missing_card()`, `wave1_kind_section()`, `wave1_section()` -- all
  deleted.
- `ORG_ROOT`, `REGISTRY_PATH`, `WAVE1_EDGE`, `KIND_ORDER` constants -- all
  deleted (no longer referenced anywhere).
- The `{wave1_html}` insertion in `render()`'s body markup, the "WAVE-1 SEED
  ASSETS" summary div in the header, and every `.w1*`/`section.wave1`/
  `.stamp.seed`/`--seed` CSS rule -- all deleted.
- `verify_document()` now positively asserts the section is gone (raises if
  `"wave1"` or `"seed assets"` appears anywhere in the rendered document, in
  addition to the image-count check) so a future regression can't silently
  reintroduce it.
- `SIZE_ATTEMPTS` tuples dropped their `wave1_edge` column (3-tuples now:
  quality, fig_edge, scene_edge).

### 2. Fixed Wave-2 state semantics (the "verified ALSO REJECTED" confusion)

Root cause, per Daniel: the root-prefixed `_staging_flagged_`/
`_staging_rejected_` files are quarantined EARLIER-ATTEMPT snapshots (e.g.
pre-clean_card-retry frames). When a live `_staging/fig-*.png` card with the
same stem is verified, the rejection belongs to the superseded attempt, not
the live card -- merging them into one card with an "ALSO REJECTED" chip
(what the previous version of this board did) reads as self-contradictory.

Rewrote `load_figure_cards()` to return THREE dicts instead of two:
`(live_by_char, failed_by_char, deferred_by_char)`.
- **Live** (`live_by_char`): built only from `plain_by_stem` (the
  `_staging/fig-*.png` files). Badge/tags/source computed EXACTLY as before
  (review.json verdict axes first, then remaining.json status, then
  "unreviewed") -- but with no reference to flagged/rejected files at all
  any more. No `secondary` field, no merging.
- **Failed** (`failed_by_char`): built only from stems in
  `(flagged_by_stem | rejected_by_stem) - plain_by_stem` -- i.e. ONLY stems
  with NO live twin. Badge = `rejected` if a rejected copy exists else
  `flagged`. Any flagged/rejected file whose stem DOES have a live twin is
  never even bucketed into this dict -- it's simply never looked at again,
  which is the "drop from the board" behavior.
- `figure_card()` lost the `secondary`/"ALSO X" chip rendering entirely --
  every card now shows exactly one state, from exactly one source.
- `char_section(char, live_cards, failed_cards, deferred)` renders the live
  cardgrid first (as before), then, only if `failed_cards` is non-empty, a
  new `<div class="failedblock">` headed "Failed cards (no verified
  replacement)" with its own cardgrid and counts -- clearly separated from
  the live grid, per the ask. `LIVE_BADGE_ORDER =
  [parked, unreviewed, verified]` and `FAILED_BADGE_ORDER =
  [rejected, flagged]` replace the old single `BADGE_ORDER`.
- Empirical result: total unique Wave-2 stems is unchanged at 117 (107 live +
  10 failed-only) -- the total pool didn't shrink, only the grouping and
  labelling changed, plus the 33 flagged/rejected copies that DO have a live
  twin are now dropped from rendering (they contributed zero standalone
  cards before either, just secondary chips on the live card, which are also
  gone now).
- Confirmed a nice sanity check by hand: `fig-brick-foreman--back-to-viewer--
  7a3b93be` (the exact stem cited in the L22 scene-blocker reason text) has
  a plain file AND both a flagged and a rejected copy. Under the new logic it
  renders once, as a LIVE **parked** card with reason "rig" pulled straight
  from its own `review.json` verdict -- matching the L22 findings text
  exactly, with its two quarantined copies correctly dropped rather than
  shown as confusing "ALSO" chips on a would-be-verified card.

### 3. failed-cards.json (new output, in scope per this follow-up)

`build_failed_cards_export(live_by_char, failed_by_char)` in `build_board.py`
builds the list and `main()` writes it to
`scratchpad/overnight-board/failed-cards.json` (UTF-8, `ensure_ascii=False`,
indent=2 -- NOT run through `ascii_text()`, since this file feeds a re-mint
tool, not the ASCII-only HTML board).

Included: every live card with `badge == "parked"`, plus every failed-only
card (`badge` in `{flagged, rejected}`). Each entry is exactly
`{stem, character, state, file, reason}`:
- `state`: `"parked"` / `"flagged"` / `"rejected"` -- read directly off the
  same badge computed for the board (review.json parsing first, then
  remaining.json, per the existing precedence), never guessed from the
  filename.
- `file`: absolute path (`str(item["path"])`) -- verified all 11 resolve on
  disk.
- `reason`: the same fail-axis tags shown as chips on the card, joined with
  `"; "` (review.json verdict axes preferred, falling back to
  remaining.json's `failed_invariants`, falling back to an honest "no formal
  verdict record found" -- never a filename guess).
- **Design decision, documented for the record**: live cards with
  `badge == "unreviewed"` are excluded from the export. The brief's own
  parenthetical enumerates the non-verified states as "parked/flagged/
  rejected" (not "unreviewed") -- and semantically, "unreviewed" means "not
  yet judged," not "failed," so feeding it into a re-mint queue would waste
  spend re-generating a possibly-fine card. This is moot on the current
  data (0 live cards are unreviewed today) but documented here in case a
  future run has some.

### Re-verify (independent parse of board.html + failed-cards.json)

- size: **2,692,715 bytes** (down from 2,894,369 before this change -- the
  Wave-1 section removal accounts for almost all of the drop; well under the
  16 MiB cap; fit at defaults on the first attempt, no adaptive tightening).
- `board-image` count = `data:image/jpeg;base64,` count = **139** = 22 scene
  images (unchanged) + 117 Wave-2 cards (107 live + 10 failed-only).
- `class="w1card"` count = 0, `class="wave1"` count = 0, the literal string
  `"WAVE-1"` does not appear anywhere in the document, and none of Bolivar /
  MacGregor / Mosquito King appear anywhere -- Wave-1 confirmed fully gone.
- `"ALSO FLAGGED"` / `"ALSO REJECTED"` chip count = **0** (was 43 before this
  change) -- the merged-badge confusion is gone.
- `class="failedblock"` count = 5 (5 of the 14 characters have at least one
  failed-only card) each headed "Failed cards (no verified replacement)".
- `fcard`=117, `finding`=6 (unchanged text), `scard`=25 with all 25 still
  carrying `class="script"` (Follow-up 1 unaffected).
- **New Wave-2 counts by state**: LIVE = 106 verified / 1 parked / 0
  unreviewed (107 total). FAILED (no live twin) = 9 rejected / 1 flagged (10
  total). Deferred (no image anywhere) = 0.
- `failed-cards.json`: **11 entries** (1 live-parked + 10 failed-only),
  schema keys exactly `{stem, character, state, file, reason}` on every
  entry, every `file` path verified to exist on disk by direct `os.path
  .isfile()` check, state Counter = `{rejected: 9, parked: 1, flagged: 1}`.
- No git commands were run for this follow-up (per explicit instruction).
