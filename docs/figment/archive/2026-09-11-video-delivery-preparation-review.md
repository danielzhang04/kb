# Figment Video-Delivery Preparation — Technical Acceptance Review

Status: **technical acceptance** of the source/test repair and testing slice only.
This is not a media-quality, creative, or delivery-authority acceptance.

## Scope

Accepted commit `e19a6083f17c6d9dff34eac9c77606eaa92627b2` (parent `4167bd80`),
2 files / 2266 lines:

- `orgs/figment/pipeline/video/video_delivery_review.py` (1332 lines)
- `orgs/figment/pipeline/video/tests/test_video_delivery_review.py` (934 lines)

Root verified both file hashes unchanged after commit:

| File | SHA-256 |
|---|---|
| `video_delivery_review.py` | `f4458ea22bf31d21a2c1a87e5e7f97110044e388edf133e4496d102bd6346319` |
| `test_video_delivery_review.py` | `750648b89dd0fe4128a9928564b2c852f6c90e3fc01d41acfd22284b3996b9da` |

No push, merge, deploy, or publication occurred.

## What the accepted code does

- `prepare_delivery_review(*, root, accepted_video_path, expected_accepted_lineage_sha256, derivative_path, template_id, transform_declaration_path)`
  creates one immutable canonical review subject.
- `validate_prepared_delivery(root, evaluation_path)` reconstructs current evidence
  and performs a fresh temporary frame extraction.
- Each successful operation calls the existing (unchanged, trusted)
  `validate_accepted_video` validator exactly twice, matching initial and final
  native authority.
- Validated derivative: 1080x1920, H.264, yuv420p, SAR 1:1, zero rotation, 152
  frames, zero-origin constant exact 30fps cadence, exact 152/30 seconds
  duration, one video stream and at most one audio stream.
- An explicit crop/hold declaration binds native source, derivative, template,
  and pinned tool binary hashes and versions.
- Three decoded samples are captured with hashes and extractor receipt.
- Persistent evidence is always recorded as `prepared` / `not_promotable`.

Explicitly **not** claimed by this code: the declaration does not prove
whole-video rendered-transform correspondence; native acceptance does not
establish delivery acceptance; audio rights, mix, sync, and template fit are
unresolved; no renderer, operator visual/temporal ruling, auth/publish
authority, or new consumer integration is added. RT2 only mechanically fits
duration in the synthetic fixture — it is not a creative choice for actual
media.

## Repair history

An independent review found 6 issues in the original source.

- **Round 1** closed 5 of them, leaving one gap: surrogate dict keys were not
  rejected.
- **Round 2** (final) fixed the remaining gap and addressed additional
  observed tool-metadata issues found during repair: Windows `os.stat` vs
  `fstat` permission-bit differences. It
  now retains cross-API file type/identity/size/mtime checks plus full-mode
  checks only within the same API; allows only the empty ffprobe
  program/group/tag containers actually observed; rejects surrogate keys via
  bounded validation errors; requires non-boolean integer sample indices; and
  retains owned cleanup with post-cleanup record-byte checks.

Only two repair rounds were used; no third round occurred.

Final independent delta review verdict: **SOURCE READY / security PASS**
(`MAIN/_private/figment-claude-video-final-source-check-20260912-v1/report.md`,
SHA `8f4fb4ad45c44ce51d283892dcfde4814109187c147ae3de951804669a36e7be`). Root
reviewed the complete source/test diff.

## Runtime verification

**V4** (pre-fix run): 59 pass / 16 fail of 75, all inputs stable. Downstream
refusal logic exposed a nonconforming positive fixture: `duration_ts` of 77814
at a 1/15360 timescale despite 152 frames at 512-tick steps (required 77824).
A minimal `lavfi` experiment did not reproduce the discrepancy; re-encoding the
actual held PNG sequence with the original flags reproduced the failing bytes
exactly. Adding `-movie_timescale 15360 -video_track_timescale 15360`
corrected the duration to 77824. Only the synthetic fixture's encode
args/comment changed — production checks and production source were
unchanged. This is a fixture correction, not a test relaxation or manufactured
acceptance.

**V5** (fresh, final-pins run): 75/75 PASS, zero failures/errors/skips.

| | |
|---|---|
| Started | 2026-09-12T01:45:38.261688+00:00 |
| Finished | 2026-09-12T01:52:39.397889+00:00 |
| Wall time | 421.136s (417.063s per JUnit) |
| Command | `Python -I -B -m pytest orgs/figment/pipeline/video/tests/test_video_delivery_review.py -q -p no:cacheprovider --basetemp=MAIN/_private/fvd5 --junitxml=<V5>/focused.junit.xml` |

Root independently parsed all 75 cases and matched all 153 before/after
entries. This was one fresh, full, focused run on final pins — not an
aggregate of prior runs.

| Artifact | SHA-256 |
|---|---|
| `result.json` | `666676167c4bab6739301b3cdc99dc248811d942e239af58aae593fcd3ddee22` |
| `focused.junit.xml` | `f141f08583a945c1fe421447cdc84ac955b91ab26a6e8d287aa5d173ab170674` |
| Both closure snapshots | `c62f087edebd9dca97dba07b72086becce5734ee8ecb9c70cd9cdfa683f4fe2a` |

Location: `MAIN/_private/figment-video-delivery-verification-20260912-v5`.

Meaningful coverage includes the real native extraction chain, CLI positive
and malformed-JSON refusal paths, the exact two-native-calls contract,
tampering/staleness/path/cadence/stream checks, ownership cleanup on
interruption, and final-record mutation checks.

## Outstanding

- Operator full-playback/temporal/detail/audio review and exact-delivery
  ruling integration.
- The trained checkpoint and resulting creator media quality remain unaccepted.
- All technical fixtures used in verification are synthetic.
- Existing broader parked work is unaffected.

This note does not claim full Figment completion.
