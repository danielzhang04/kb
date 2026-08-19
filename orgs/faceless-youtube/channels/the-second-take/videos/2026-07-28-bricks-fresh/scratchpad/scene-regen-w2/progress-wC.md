# Worker C progress — L18-L25

## Setup
- Backed up existing L18-L21,L23-L25 (L22 was missing/stale from Aug 6 blocker) to scratchpad/scene-regen-w2/old/
- Discovered stale leftover frames in shared kit `_staging/` and video `assets/scenes/` from earlier runs THIS MORNING (03:58-04:26), predating today's drive-maker.png / brick-foreman.png canonical remints (18:09). Treated all pre-remint staged/scene files for my 8 shots as invalid; regenerated with --force.

## STEP-1 figures (Pass 1, 4 needed)
- fig-drive-maker--carry-by-handle--expr-deadpan--3cdb4979 (L18): 1st gen FAILED rig/pose (arms hung at sides, ignored carry-by-handle pose ref). Retry #1 (forge-retry-overlay@2, defect=pose, instruction=asymmetric bent-arm carry stance) -> PASS.
- fig-drive-maker--hold-both-hands--expr-greedy--14b7da15 (L19): 1st gen FAILED rig/pose (same — arms at sides). Retry #1 (defect=pose, instruction=both arms bent forward, fists together) -> PASS.
- fig-brick-foreman--back-to-viewer--4ff569f7 (L22): 1st gen PASS (no retry used).
- fig-brick-foreman--action-shrug--expr-deadpan--7be06d45 (L23): 1st gen PASS (no retry used).

## Scenes (all 8, fresh-eyes reviewed by me against bible §3 f/s/r)
- L18 drive-maker hand-truck ramp: PASS (1st scene attempt, post-figure-fix)
- L19 drive-maker rake/money: PASS (1st scene attempt, post-figure-fix; minor non-blocking note: camera vantage reads eye-level/3-quarter rather than literal bird's-eye)
- L20 supply-stall BASE (crowd): PASS (1st attempt)
- L21 supply-stall DELTA (money box): PASS (1st attempt, held set/face correctly inherited)
- L22 loading-bay row (brick-foreman back-to-viewer, the cleared blocker): PASS (1st attempt)
- L23 packing-bay BASE (shrug): PASS (1st attempt)
- L24 packing-bay DELTA (brick placement): 1st attempt silently chained off a STALE pre-remint L23 sitting in shared kit `_staging/assets/scenes` (from an earlier, pre-remint run this morning) — discarded without promoting; regenerated fresh after promoting the corrected L23 to `assets/scenes/`. PASS on redo.
- L25 packing-bay DELTA (HARD DRIVE label): same stale-parent issue inherited via L24 on 1st attempt — discarded; regenerated fresh off corrected L24. PASS on redo (DSG-lite letter-by-letter transcription of "HARD DRIVE" — correct).

## Promotion + stamping
- Copied all 8 final PNGs from kit `_staging/` into video `assets/scenes/`.
- Rebuilt the 8 manifest rows (technique/seeds/parent_depth/lineage) via `forge.py manifest --kind scenes`, replacing only my 8 shot_ids in the existing 57-entry `assets/scenes/manifest.json` — total stayed 57 before/after.
- Figure review store (`visual-kit/_staging/review.json`, channel-shared): 209 -> 213 entries (+4, exactly my 4 STEP-1 figures; verified only my 4 keys present/changed).
- Scene review store (`assets/_review/merged.json`, video-shared): 40 -> 41 rulings. 7 of my 8 ids pre-existed there as STALE rulings (from the pre-remint frames) and were replaced with fresh ones against the new pixels; L22 was newly added (previously absent/blocked). The other 33 rulings (other workers' shots) are byte-identical, untouched.
- `stamp_review.py <video_dir>` run once: processed the full shared merged.json (38 verified / 3 parked across ALL workers' rulings currently in that file, not just mine — expected, since it's a single shared stamp step). All 8 of my shot_ids now `review_status: verified`, `parked_reasons: []`, correct `file` path.
