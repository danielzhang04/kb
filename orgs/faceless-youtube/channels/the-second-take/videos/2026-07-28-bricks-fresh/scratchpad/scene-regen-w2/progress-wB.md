# Worker B progress — L10-L17 (COMPLETE)

Partition: L10-L17. Chains: bedside-table (L11 base -> L12 delta), pc-ring (L16 base -> L17 delta).

## Phase 0 — rival-pc canonical: DONE
- New cast entity minted by today's VPW re-author (shots.json L16 notes): slate-grey desktop case,
  same no-hand boxy build as pc-boxy but narrower + a head taller, stacked vent slots on front panel,
  own cartoon eyes/mouth. No registry.characters entry existed (confirmed via grep) — genuine fresh mint.
- Added registry.characters.rival-pc stub (role/head_tone #8b93a0/costume/base path/no_hands:true),
  positioned right after pc-boxy's entry.
- Gen 1 (new_character, seeded off pc-boxy canonical): vent slots landed BELOW the face — wrong per
  the shot's clause ("...vent slots ribbing its front panel above its own cartoon eyes and mouth").
  ONE sanctioned retry: re-authored delta stating explicit top-to-bottom order (vents top / face
  middle / body below). Retry clean: vents above face, slate-grey, narrower/taller boxy build, no
  hands/fingers, matches pc-boxy family rig.
- Registered via `forge.py register` -> refs/rival-pc/rival-pc.png, registry.assets entry added.
- Per the skill's own doctrine ("the one class outside the [review.json] store is a named cast
  member's own canonical, exempted by the G2 cast-mint ruling"), no stamp_review.py --figures record
  is required for a character canonical — verified by fresh-eyes look + rig comparison against
  pc-boxy instead, per the single-asset-loop procedure.

## Phase 1 — backup: DONE
- Copied existing assets/scenes/{L10..L15}.png (stale, pre-doctrine, 04:0X timestamps) to shared
  scratchpad/scene-regen-w2/old/. L16/L17 had no prior files (new content).

## Phase 2 — scene generation: DONE
- `forge.py batch --shots L10,L11,L12,L13,L14,L15,L16,L17` built the slate (all seed caps <=4, no
  seeding-law violations in scope; 15 violations reported OUTSIDE scope belong to other workers).
- Stale staging files existed from a PRE-doctrine run (L10-L15 from this morning 04:0X, L16/L17 from
  Aug 6 — the OLD wrong boxing-glove rival-pc-less version) and were skipped by forge's default
  skip-if-exists; force-regenerated all 8 with `--force`.
- All 8 generated clean on the first pass (no engine errors).

## Phase 3 — review + stamp: DONE
- Fresh-eyes review at ordinary viewing scale against style-bible §3, all 3 axes (fidelity/style/rig),
  for all 8 staged frames. Both previously-failed shots (L14: fingered-hand rig break; L15: adult
  crowd proportion + individuated headwear) read CLEAN under today's re-authored prompts — no retry
  needed on any of the 8 scene shots.
- Wrote 8 rulings into the SHARED `assets/_review/merged.json`, replacing ONLY the stale L10-L15
  entries (which dated from the pre-doctrine run) and adding L16/L17; the other 32 ids' rulings were
  read and passed back byte-identical (untouched).
- `forge.py place` copied all 8 staged frames into assets/scenes/ (overwriting stale files).
- Updated the SHARED assets/scenes/manifest.json: replaced/added only the 8 L10-L17 entries
  (technique/seeds/parent_depth/lineage from the batch spec); all other 49 entries left untouched.
- Ran `stamp_review.py <video_dir>` once (its only invocation form; no per-id scope flag exists) —
  stamped 34 verified + 6 parked across all 40 ruled ids. Verified via pre/post snapshot: all 49
  non-mine manifest entries are BYTE-IDENTICAL before and after (0 mismatches) — confirms no outside
  partition was altered by the shared-file write.
- Result: all 8 of L10-L17 -> `review_status: verified`, `parked_reasons: []`.

## Spend ledger (forge.py prints no per-call $; tracked at ~$0.17/1K-gen, project estimate)
1. rival-pc (attempt 1)     ~$0.17
2. rival-pc-fix (retry)     ~$0.17
3. L10                      ~$0.17
4. L11                      ~$0.17
5. L12                      ~$0.17
6. L13                      ~$0.17
7. L14                      ~$0.17
8. L15                      ~$0.17
9. L16                      ~$0.17
10. L17                     ~$0.17
TOTAL: ~$1.70 est. / $3.50 cap — well under.

## Stamp-scope integrity (proof)
- merged.json: 32 preserved (other workers, byte-identical) + 8 mine (fresh) = 40 total.
- manifest.json non-mine entries: 49 pre-snapshot, 49 post-snapshot, 0 mismatches.
- manifest.json mine: 8/8 -> verified, [] parked_reasons.
