# Worker A progress — L01-L09 regen (2026-08-18)

Partition: L01-L09 (era-livingroom L01 single-shot stage; L02-L09 standalone, mostly crowd:true).
Old pixels backed up to scratchpad/scene-regen-w2/old/L01..L09.png.

## Plan
- forge.py batch --batch shots.json --out spec-wA.json --shots L01,...,L09 --video <video dir>
- dry-run to preflight prompts/seeds, $0
- live gen (engine gemini-3-pro-image, 1K default), cap $3.00
- fresh-eyes review per shot vs bible §3, then stamp_review.py scoped to L01-L09

## Log
- (start) reading style-bible + shots.json done. Building batch spec next.
- Batch spec built (forge.py batch --shots L01..L09), dry-run clean, all seeds/prompts verified.
- Initial gen: 9/9 generated (had to --force since stale pre-re-author staging existed from ~04:00 same day).
  Cost: 9 x $0.039 = $0.351.
- Promoted all 9 staged frames -> assets/scenes/L0X.png (sha256 verified match).
- Fresh-eyes review round 1 (against re-authored still_prompt + bible §2b/2c/2d/3/5):
  - L01: VERIFIED. pc-boxy expr-delighted on table, lava lamp/boombox flanking, red accent on power stud all present.
    Vantage reads more eye-level than the authored "enthroned from shag level" but camera framing is an exempted axis (§3 "never checked" list) -- not flagged.
  - L02: FLAGGED (fidelity/text) -- partial unrequested lettering visible on ticket-booth sign top-left corner
    (cropped "...KET"-style text), confirmed via zoomed crop. Crowd rig otherwise clean (hair/tone bound respected,
    payload hair-tower-past-frame-top nailed).
  - L03: FLAGGED (rig/crowd) -- crowd hair-silhouette + head-tone bounded-variety over the 2-3 cap (matches the
    SAME defect class this shot parked on before re-authoring). Dais/lectern/board correctly blank.
  - L04: FLAGGED (rig+fidelity, 3 defects) -- (a) "SALE" tag unrequested text on a carton, not authored;
    (b) "1983" sandwich-board lettering rendered as a clean digital/printed font, violating the LOCKED
    hand-marker-chalk register; (c) shutter drawn with ~9 thin ridge lines, finer than rig outline weight
    (line-register FAIL, same defect class as the pre-re-author park). Confirmed via zoomed crop.
  - L05: VERIFIED. pc-boxy expr-surprised in crate, bulb/shelving/cartons all present, red tape accent present.
  - L06: VERIFIED. prop-beige-pc on plinth, crowd pressing glass, vantage-from-display nailed, crowd rig clean
    (2-3 tone bound respected, dot-eyes/simple-mouth consistent).
  - L07: VERIFIED. prop-beige-pc back-panel-to-viewer per prompt, banknotes/till/pegboard/rope all present,
    notes don't overlap unit. Crowd mouths faint at this render scale but ambiguous, not asserted as a fail.
  - L08: VERIFIED. 4 flying prop-beige-pc units + polystyrene, bare shelf, tipped basket, ducking crowd all present.
    End-cap crop landed lower-LEFT vs authored lower-right -- camera-framing axis, exempted, not flagged.
  - L09: FLAGGED (fidelity/text) -- unrequested "CLOSED" sign rendered on the shutter door, not authored anywhere
    in still_prompt. Queue/sleeping-bags/lamp/bin all otherwise correct.
- Built ONE surgical retry-overlay (forge-retry-overlay@2) covering all 4 flags, single exact-replace span each
  (defect: content), file: retry-overlay-wA.json. Dry-run confirmed changed_spans:1 on each, clean prompts.
- Retry gen: 4/4 generated (L02-fix-w2, L03-fix-w2, L04-fix-w2, L09-fix-w2). Cost: 4 x $0.039 = $0.156.
  Running total: $0.507 / $3.00 cap.
- Reviewed all 4 retry frames (final mini-pass, since no next act batch follows this partition):
  - L02-fix-w2: ticket-booth window now bare glass, no text anywhere. VERIFIED.
  - L03-fix-w2: crowd now reads ~2 head tones + 1 dominant hairstyle silhouette, within the 2-3 cap.
    Dais/lectern/curtain/tables/rope all still correct. VERIFIED.
  - L04-fix-w2: SALE tag gone; "1983" now hand-scrawled chalk with lean+underline; shutter now ~7 bands at
    matching medium-thick outline weight (zoomed crop confirmed). VERIFIED.
  - L09-fix-w2: "CLOSED" sign gone, shutter bare metal. Queue/lamp/bin/sleeping-bags all still correct. VERIFIED.
- Promoted all 4 retry frames -> assets/scenes/L02/L03/L04/L09.png (sha256 verified match). All 9 canonical
  frames in assets/scenes/ now reflect the FINAL passing pixels.
- Wrote 9 full f/s/r rulings (all clean) into the SHARED assets/_review/merged.json, replacing only the
  stale pre-re-author L01-L09 entries in place -- every other id's entry byte-preserved from the read.
- Ran stamp_review.py <video_dir> once (the tool's only interface; it processes the whole shared merged.json,
  not a subset) -> "stamped: 36 verified, 4 parked" (aggregate across ALL ids currently in merged.json, not
  just mine). Post-stamp, all 9 of L01-L09 read verified/[] on assets/scenes/manifest.json.
- SCOPE INTEGRITY CHECK (git diff vs HEAD): manifest.json entries outside L01-09 that changed value = L10-L17.
  Root cause verified NOT mine: L10-L17 rulings were ALREADY PRESENT in assets/_review/merged.json (worker B's
  own authored content) at the moment I first read the file, before I made any edit -- confirmed via git show
  HEAD comparison (HEAD's merged.json has no L16/L17 at all, but my very first read of the working-tree file
  already had 40 entries including L16/L17, i.e. B had written them before I touched anything). My merge script
  only ever removed/added L01-L09 entries and left every other entry byte-identical. stamp_review.py is a
  single-writer whole-file tool with no id-scoping flag, so running it necessarily also applied B's own
  already-complete L10-L17 rulings to the manifest as an unavoidable side effect of the shared tool -- I did
  not author, alter, or invent one byte of L10-L17 content. No entries outside L01-17 changed. No entries
  outside L01-09+L16-17 were newly created.
- Corrected the L01-L09 manifest STRUCTURAL fields (technique/seeds/retry_cause/notes/sha256), which had been
  stale from an earlier pre-re-author "worker A round 1" run (wrong seeds for L06/L07 in particular -- the
  re-authoring recast those two from `pc-boxy` to plain `prop-beige-pc`, which the stale entries didn't reflect).
- FINAL SPEND: 13 gens (9 initial + 4 retry) x $0.039 = $0.507 / $3.00 cap.
- PARTITION COMPLETE. All 9 shots verified, 0 parked.
