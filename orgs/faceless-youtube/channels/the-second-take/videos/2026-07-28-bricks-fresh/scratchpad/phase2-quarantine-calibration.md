# Phase 2 — Quarantine (main checkout) + New-Lint Calibration (worktree)

2026-08-04. Worker log, written incrementally.

VIDEO = `C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh`
KIT = `C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit`

## Part 1 — Quarantine (main checkout, file moves only)

### Pre-move inventory (main checkout)

- `VIDEO/assets/scenes/` — present (PNGs L01..L21x range)
- `VIDEO/assets/_review/` — present (batch/fidelity/rig/style jsons + crops/)
- `VIDEO/assets/thumbs/` — present (manifest.json + 3 thumb pngs)
- `VIDEO/assets/motion/` — present (`long-form.preview.motion.json`)
- `VIDEO/assets/preview.render.manifest.json` — present
- `VIDEO/assets/board.html` — present (only board*.html under assets/)
- `VIDEO/shots.json` — present, 285756 bytes (Aug 4 14:06)
- NOT in move scope, left untouched (not named in Phase-2 spec): `assets/preview.mp4`,
  `assets/vo.breath.mp3`, `assets/vo.txt` — these are not scenes/_review/thumbs/motion/
  preview.render.manifest/board*.html/shots.json, so out of the named-paths list.

### Moves executed (VIDEO/assets)

All moves via `mv` (rename), preserving names, into `VIDEO/assets/_archive-pre-reset/`:

| Source | Dest | Files | Bytes |
|---|---|---|---|
| `assets/scenes/` | `_archive-pre-reset/scenes/` | 216 | 915,334,704 |
| `assets/_review/` | `_archive-pre-reset/_review/` | 168 | 852,836,882 |
| `assets/thumbs/` | `_archive-pre-reset/thumbs/` | 4 | 11,902,909 |
| `assets/motion/` | `_archive-pre-reset/motion/` | 1 | 199,866 |
| `assets/preview.render.manifest.json` | `_archive-pre-reset/preview.render.manifest.json` | 1 | 2,398 |
| `assets/board.html` (only board*.html match under assets/) | `_archive-pre-reset/board.html` | 1 | 88,191 |

Total archived: 391 files, 1,780,364,950 bytes (~1.66 GiB).

`assets/preview.mp4`, `assets/vo.breath.mp3`, `assets/vo.txt` were left in place — not named in the
Phase-2 quarantine path list (not scenes/_review/thumbs/motion/preview.render.manifest/board*.html).

### shots.json — copy (not move)

- `VIDEO/shots.json` (285,756 bytes) copied to `assets/_archive-pre-reset/shots.pre-reset.json`.
  `cmp` confirmed byte-identical. Tracked `VIDEO/shots.json` left untouched in place.

### Scene manifest reset

- Recreated `VIDEO/assets/scenes/` (empty dir) containing exactly one file, `manifest.json`, with
  content `{"shots": []}` — verified UTF-8 no-BOM (hex dump starts `7b 22 73 68 6f 74 73 22...` =
  `{"shots"...` directly, no `ef bb bf` BOM prefix).

### KIT/_staging moves

Created `KIT/_staging/_archive-pre-reset-2026-08-04/`. Moved (files only, `mv`, all matched files
were `.png` — no `.json`/`.lock` companions existed for these cast prefixes):

| Glob | Files moved |
|---|---|
| `fig-brick-foreman*` | 9 |
| `fig-qt-wiles*` | 12 |
| `fig-auditor-rep*` | 7 |
| `fig-hq-banker*` | 4 |
| `fig-miniscribe-rep*` | 7 |
| `fig-ibm-suit*` | 2 |
| `fig-terry-johnson*` | 1 |
| `fig-pc-boxy*` | 0 (no files matched — cast member has no staged pngs yet) |
| **Total** | **42** |

Archive dir total: 42 files, 42,672,707 bytes (~40.7 MiB). `_staging` root file count went from
489 (488 fig/etc pngs + `patch_remint_c.py`) to 447 after the move (`patch_remint_c.py` untouched,
not matched by any glob). No pre-existing `visual-kit/_staging/review.json` was found (M1 record
store starts empty by construction, as the design doc anticipates).

### Keep-live verification (all confirmed present, untouched)

- `VIDEO/script.md` — present, 10,754 bytes (Jul 31)
- `VIDEO/research.md` — present, 25,744 bytes (Jul 31)
- `VIDEO/assets/vo.mp3` — present, 7,276,365 bytes (Jul 30)
- `VIDEO/assets/voiceover.manifest.json` — present, 95,945 bytes (Jul 30)
- `VIDEO/assets/library/manifest.json` — present, 17,111 bytes (Jul 31)
- `KIT/refs/` — spot-checked 3 canonicals present: `brick-foreman/brick-foreman.png`,
  `qt-wiles/qt-wiles.png`, `miniscribe-rep/miniscribe-rep.png`

Status: Part 1 COMPLETE.

## Part 2 — New-lint calibration (worktree code, archived data)

### CLI + run setup

`lint_shots.py` usage: `python lint_shots.py <path-to/shots.json> [--write]`. It derives
`vdir = Path(path).parent` and reads `vdir/script.md` and `vdir/assets/voiceover.manifest.json`
directly, plus (best-effort, degrades silently) `vdir/assets/library/manifest.json` and
`vdir.parent.parent/visual-kit/registry/registry.json` for the cast-vocabulary (`video_chars`).

To get a faithful run (real cast vocabulary, not the silently-degraded empty set) without
touching either live tree, built a throwaway directory skeleton under the worktree scratchpad
mirroring the real channel layout, populated with **copies only**:

```
scratchpad/lint-calib-temp/
  the-second-take/
    videos/bricks-fresh-calib/
      shots.json              <- copy of VIDEO/assets/_archive-pre-reset/shots.pre-reset.json
      script.md                <- copy of VIDEO/script.md
      assets/voiceover.manifest.json  <- copy of VIDEO/assets/voiceover.manifest.json
      assets/library/manifest.json    <- copy of VIDEO/assets/library/manifest.json
    visual-kit/registry/registry.json <- copy of KIT/registry/registry.json
```

`shots.pre-reset.json`'s own `channel` field is `"the-second-take"`, matching the skeleton's
directory name, so `video_chars()`'s registry lookup resolved for real (not the silent-degrade
path). Ran: `PYTHONIOENCODING=utf-8 python lint_shots.py <temp>/shots.json`, captured stdout+stderr
to `lint-calib-temp/lint-output.txt`.

**No hard-exit / no iteration needed** — the lint ran to completion in a single pass (exit code 1,
meaning HARD violations found, not a crash) and printed the complete report: 214 long-form shots,
0 shorts, 58 HARD violations, 37 heads-up (soft). Both counts verified by independent line-count
of the raw output against the manual per-check tally below (58 + 37, exact match both ways).

### Per-check fire table (every check that fired)

| Check (function) | Doctrine ref | Severity | Fires | Example shot ids (up to 5) |
|---|---|---|---|---|
| `suffix_one_voice_check` — soft/gradient-permissive wording in `global_prompt_suffix` | M8(a) one-voice | HARD | 2 | n/a — suffix-level; terms hit: `gentle`, `soft` |
| `suffix_one_voice_check` — style-recipe wording restated in suffix (LETTERING-ONLY violation) | M8(a) one-voice | HARD | 8 | n/a — suffix-level; terms hit: `cel-shaded`, `cartoon style`, `#241a12`, `outline`, `flat colours`, `cel shading`, `rounded friendly shapes`, `no realistic detail` |
| `render_technique_check` (long-form prompts) — banned render-technique term | M8(b) narrow render-technique ban | HARD | 4 | L02, L10, L18, L89 (terms: `glossy` x3, `blurred behind` x1) |
| `spatial_tier_check` — individually staged anonymous actor inside `figures.crowd: true` | crowd tier (existing, retained) | HARD | 2 | L169, L201 |
| `seat_support_check` — named figure carries `sit` primitive, no support+contact in same sentence | M9 seat/support (HARD=presence) | HARD | 12 | L16, L34, L60, L63, L64 (+7 more: L69, L74, L87, L89, L90, L156, L195) |
| `two_cast_presence_check` — 2+-named-cast shot missing plane/eye-line/relative-scale clause | M10 two-cast plane/scale (HARD=presence) | HARD | 22 | L28, L30, L34, L39, L48 (+17 more: L52, L53, L54, L60, L63, L64, L66, L67, L68, L80, L81, L82, L100, L101, L123, L184, L191) |
| `semantic_cast_check` — VO names a generic plural role but shot casts a named figure absent from that VO span/neighbours | M11 semantic cast (HARD, narrow) | HARD | 8 | L66, L76, L80, L82, L88 (+3 more: L100, L182, L191) |
| **HARD subtotal** | | | **58** | |
| `stage_check` — delta frame duration >3.5s or longer than base ("deltas should be fast") | stage/delta timing (existing, retained) | soft | 36 | L02, L03, L04, L06, L18 (+31 more, full list in raw output) |
| `seat_support_check` — support+contact both present; framing sufficiency flagged for forced human review row | M9 seat/support (soft heads-up half) | soft | 1 | L68 |
| **soft subtotal** | | | **37** | |

Total: 58 HARD + 37 soft = 95, matching the printed report exactly.

### NEW checks that fired ZERO times

The doctrine-reset design (§1) introduces an entire **place** mechanism (M3–M6, B2, B5) plus an
**action-chain** HARD check and an `owner_ambiguity` bool field. None of these fired on the
archived pre-reset `shots.json` — but the reason is structural, not a clean bill of health:

```
shots with `place` key:            0 / 214
shots with `hard_cut` key:         0 / 214
shots with `owner_ambiguity` key:  0 / 214
```

The archived shot list predates the `place` schema key entirely (it was authored under the old
stage-first, no-place doctrine). Every place-family check below returns immediately on a shot
with no `place` declared, so a 0-fire result here is **not calibration signal** — it just proves
these checks don't false-positive on legacy data lacking the field, not that they correctly fire
on real place violations. Real calibration for this family only happens once the fresh `shots.json`
declares `place` per shot.

Zero-fire NEW checks (all ran, all found nothing to flag, all for the structural reason above):

- `place_key_check` — place field type/format validity
- `place_anchor_check` — `place_anchor` legality (now legal on any established-place non-delta shot, B2)
- `place_anchor_same_place_check` — B5 same-place enforcement (plate may only seed shots in its own place)
- `place_inventory_check` — every declared place maps to a `script.md` span
- `place_plate_check` — conditional plate law (M4): plate required when place hosts >=2 shots or carries owner branding
- `place_owner_check` — institution-owned interior authors a visible owner cue (or `owner_ambiguity`)
- `place_shot_class_exempt_check` — symbolic/abstract/object-insert shot classes correctly declare no place
- `place_context_exempt_check` — thumbnail / shorts `first_frame` place exemption
- `bool_field_check(..., "owner_ambiguity")` — place-owner ambiguity bool field validity
- `action_chain_check` — consecutive VO actions on the same props carry `stage`/`stage_role` or an explicit `hard_cut` (action-chain HARD=presence)
- `carried_literal_check` — L-1 carry mechanism, extended (not brand-new) to register the place-owner literal; also 0 fires here for the same structural reason (no `place`/owner data to carry)

### Other existing (non-new) checks — 0 fires, no anomalies

`text_supply_check`, `word_cap_check`, `literal_count_check`, `control_leak_check`,
`rig_clause_check`, `shot_class_check`, `figures_check`, `delta_feasibility_check`,
`numeral_form_check`, `long_literal_word_check`, `negation_list_check`, `legacy_field_check`,
`schema_check` (file is already `schema@2`), the anchor/vo_text matcher in `lint_piece`, and the
`spatial_tier_check` rear-zone-geometry sub-check, plus `bool_field_check(..., "hard_cut")` and
the thumbnail-block variants of the prompt checks — all ran clean (0 fires). Nothing anomalous;
consistent with this being previously-reviewed, previously-rendered prose.

### Headline numbers

- 214 long-form shots linted, 0 shorts (this video has none authored).
- **58 HARD violations** across 6 distinct check types — dominated by the two brand-new M9/M10
  presence checks (seat/support 12, two-cast plane/scale 22 — 34 of 58, ~59%), plus M11 semantic
  cast (8), the suffix one-voice split M8(a) (10), the narrow render-technique ban M8(b) (4), and
  2 pre-existing crowd-tier hits.
- **37 soft heads-ups**, almost entirely (36/37) the pre-existing stage-delta-timing heads-up —
  not new-doctrine noise.
- The entire **place** mechanism (the design's single largest area of change — M3–M6, B2, B5) is
  **unexercised** by this calibration run because the archived data predates the `place` field.
  This is the one honest gap in "complete" calibration: M8/M9/M10/M11 are calibrated against real
  prose as the gate asks; the place family is only proven not to false-positive on old data, not
  proven to correctly catch real place violations. That proof can only come from the fresh
  `shots.json` once place is authored.

### Cleanup

Deleted `scratchpad/lint-calib-temp/` (all copied inputs — `shots.json`, `script.md`,
`assets/voiceover.manifest.json`, `assets/library/manifest.json`, `registry.json` — plus the raw
`lint-output.txt`, whose full content is reproduced via the fire table above) after this report
was written. No files were left behind in the worktree beyond this report. Nothing was written to
or edited in the main checkout beyond the Part-1 file moves.

Status: Part 2 COMPLETE. Both parts COMPLETE.
