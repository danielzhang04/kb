# Wave-2 Worker 3 progress log

Partition: not-yet-attempted items sorted lexicographically, indices 19-27 (9 items):
1. fig-miniscribe-rep--action-slump--expr-crestfallen--24cb011c (b5)
2. fig-qt-wiles--action-offering--expr-deadpan--5b1e3fea (b6)
3. fig-qt-wiles--back-to-viewer--dfb3cd97 (b5)
4. fig-qt-wiles--sit--expr-deadpan--b503fbae (b6)
5. fig-qt-wiles--surrender--expr-confused--59fca904 (b6) -- uses `surrender` base primitive, watch for known systemic 5-digit-hand defect
6. fig-rifenburgh-ceo--action-armscrossed--expr-eyeroll--56e8c100 (b5)
7. fig-rifenburgh-ceo--action-walk--expr-worried--2046fb04 (b5)
8. fig-rifenburgh-ceo--hold-one-hand--expr-thinking--49deb800 (b5)
9. fig-rifenburgh-ceo--point-at-thing--expr-deadpan--b239ba9a (b5)

Extracted these 9 items verbatim from batches/b5.json + b6.json (forge-derived, zero hand-authoring)
into batches/w3-partition.json.

## Step 1: dry-run preflight
`gen --batch w3-partition.json --dry-run` — 9/9 prompts assembled cleanly, all seeds resolved, 0 API calls.

## Step 2: live generate
`gen --batch w3-partition.json` (live) — 9 generated, 0 failed, 0 skipped, 0 held for review, 0 re-issues needed.
All landed in visual-kit/_staging/.

## Step 3: review board
Built board scoped to just these 9 assets via `build_review_artifact.py --assets <9 paths> --staging <kit>/_staging
--figures-out scratchpad/w2-full/verdicts-w3.json` (note: had to also pass --staging alongside --assets, or the
script hits a TypeError in forge.figure_reuse_blocker — undocumented dependency). Wrote
scratchpad/w2-full/board-w3.html + verdicts-w3.json skeleton (9 pending).

## Step 4: fresh-eyes review (round 1, all 9)
Dispatched separate sonnet subagent (Agent tool, general-purpose, no generator context) with the 9 PNGs + their
character canonicals + the 3-axis criteria (rig / expression-register / flat-cel-hazard) + explicit heads-up on
card 5 (surrender pose = known systemic defect, do not spend a retry if confirmed).

RESULT: 4/9 PASS clean (miniscribe-rep slump/crestfallen; qt-wiles action-offering/deadpan; rifenburgh-ceo
armscrossed/eyeroll; rifenburgh-ceo point-at-thing/deadpan). 5/9 FAIL:
- qt-wiles back-to-viewer--dfb3cd97: rig (leaked ear shape at hairline)
- qt-wiles sit--expr-deadpan--b503fbae: rig (costume mismatch) + clean_card (leaked bench/table furniture)
- qt-wiles surrender--expr-confused--59fca904: rig, KNOWN SYSTEMIC (5-digit hands on the shared
  `refs/base/surrender.png` primitive, confirmed a 4th time) -> PARKED IMMEDIATELY, no retry spent, per manifest
  policy.
- rifenburgh-ceo action-walk--expr-worried--2046fb04: clean_card (leaked paper-pile scenery covering the ground)
- rifenburgh-ceo hold-one-hand--expr-thinking--49deb800: expression (thinking indistinguishable from the
  character's own resting/deadpan default)

CORRECTION caught before retrying: item #4's (qt-wiles--sit) "costume mismatch" flag was a FALSE POSITIVE. Checked
the item's own authored payload (batches/w3-partition.json) and its scene clause explicitly reads "...in a plain
grey uniform" (a jail-cell beat) — this IS an authored costume change per the skill's own clothing-authoring rule,
not a rig defect. My review brief had incorrectly told the reviewer no card in this batch authors a costume
change; I hadn't verified that claim per-item before briefing. Re-classified this item's retry as `clean_card`
only (furniture leak), NOT `rig`, with a custom instruction that explicitly re-asserts the grey-uniform costume
(since a plain `clean_card` retry drops the whole beat clause, which would have silently reverted the figure to
its default suit — checked forge.py's `_retry_step1` to confirm this mechanism before writing the instruction).

## Step 5: retry (1 per failing frame, per manifest defect taxonomy expression|rig|pose|clean_card)
Moved the 4 non-systemic-park failures' original PNGs to `_staging_rejected_<name>.png` to free their names.
Wrote `scratchpad/w2-full/w3-retry-overlay.json` (forge-retry-overlay@2, 4 step1 entries, shot ids found via
`grep <fig-name> batch-build.log`: L220, L236, L182, L180). `fig-qt-wiles--surrender...` was NOT retried (systemic
park). Built retry spec via `forge.py batch --retry` (note: relative `--out` path resolved wrong, doubling the
`orgs/faceless-youtube` prefix into a stray nested dir under the video's own `orgs/` — worked around with an
absolute `--out` path; deleted the stray nested dir afterward). Dry-run preflight: 4/4 prompts assembled clean,
`changed_spans: 1` each, custom instructions correctly appended after the base payload. Live gen: 4/4 generated,
0 failed.

## Step 6: fresh-eyes review (round 2, retries only)
Dispatched a SECOND separate sonnet subagent (no generator context, no memory of round 1) with the 4 retried PNGs,
their canonicals, and per-card context on what the prior defect was and what the retry instruction demanded (incl.
the grey-uniform note for the sit card so it isn't false-flagged again). This ruling is FINAL, no further retry.

RESULT: 3/4 PASS (sit/deadpan furniture-leak fixed; action-walk paper-leak fixed; hold-one-hand expression now
reads distinctly "thinking" vs deadpan). 1/4 still FAIL: back-to-viewer's ear defect PERSISTED after retry
(same offending ear shape still visible near the hairline) -> permanently parked, retry budget exhausted.

## Step 7: finalize verdicts + stamp
Rebuilt the review skeleton (`build_review_artifact.py --assets <my 9 paths> --staging ... --figures-out
verdicts-w3-final.json`) AFTER the retries landed, to pick up fresh `canonical_sha256` for the 4 retried cards
(avoids the stale-hash bug the manifest warned about -- confirmed hashes for back-to-viewer/sit/walk/hold-one-hand
all changed from the round-1 skeleton; surrender's hash was unchanged, as expected since it was never retried).
Filled final per-invariant verdicts (rig/expression-register/flat-cel-hazard) from the FINAL post-retry
disposition, then `stamp_review.py --figures verdicts-w3-final.json <kit>/_staging` -- additive merge, only my 9
`fig-*` keys touched, "9 merged" confirmed on stdout. Moved the 2 final-FAIL cards
(`fig-qt-wiles--back-to-viewer--dfb3cd97`, `fig-qt-wiles--surrender--expr-confused--59fca904`) to
`_staging_flagged_<name>.png`.

## FINAL DISPOSITION (9/9 items, partition complete)
| item | final status | notes |
|---|---|---|
| fig-miniscribe-rep--action-slump--expr-crestfallen--24cb011c | **verified** | clean first pass |
| fig-qt-wiles--action-offering--expr-deadpan--5b1e3fea | **verified** | clean first pass |
| fig-qt-wiles--back-to-viewer--dfb3cd97 | **parked** | rig: leaked ear shape, persisted through 1 retry, budget exhausted |
| fig-qt-wiles--sit--expr-deadpan--b503fbae | **verified** | clean_card retry fixed leaked furniture; grey-prison-uniform costume correctly preserved (authored change, not a rig defect) |
| fig-qt-wiles--surrender--expr-confused--59fca904 | **parked** | rig: KNOWN SYSTEMIC 5-digit-hand defect on shared `refs/base/surrender.png`, confirmed a 4th time across characters; no retry spent per manifest policy |
| fig-rifenburgh-ceo--action-armscrossed--expr-eyeroll--56e8c100 | **verified** | clean first pass |
| fig-rifenburgh-ceo--action-walk--expr-worried--2046fb04 | **verified** | clean_card retry fixed leaked paper-pile scenery |
| fig-rifenburgh-ceo--hold-one-hand--expr-thinking--49deb800 | **verified** | expression retry fixed indistinct "thinking" (now visibly distinct from deadpan default) |
| fig-rifenburgh-ceo--point-at-thing--expr-deadpan--b239ba9a | **verified** | clean first pass |

**7/9 verified, 2/9 parked.**

## Spend estimate
9 initial gens + 4 retries = 13 provider calls, 0 re-issues needed. At ~$0.17/call (prior wave's unverified
estimate, no per-call pricing exposed by registry.json): ~$2.21.

## Deviation note
My review brief for round 1 incorrectly claimed "none of these 9 cards author a costume change" without checking
each item's own payload first -- this produced one false-positive "rig: costume mismatch" flag on the sit/deadpan
card (its scene clause legitimately authors a grey prison uniform for a jail-cell beat). Caught and corrected
before spending the retry: verified the actual payload text, reclassified the retry as `clean_card` only (for the
real furniture-leak defect), and wrote a custom retry instruction that explicitly re-asserts the authored
grey-uniform costume so the `clean_card` retry's clause-drop mechanism didn't silently revert it back to the
character's default suit. No wasted generation spent on the false positive.

Also note: `build_review_artifact.py --assets` requires `--staging` to ALSO be passed even when only `--assets`
paths are boarded (undocumented dependency; omitting it throws a TypeError deep in
`forge.figure_reuse_blocker`). And `forge.py batch --retry --out <relative-path>` resolved the output path
incorrectly (doubled the `orgs/faceless-youtube` prefix into a stray nested directory) -- worked around with an
absolute `--out` path; the stray directory was deleted after.
