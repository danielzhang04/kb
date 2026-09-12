# Video Delivery Ruling Assertion — Operator Guide

`orgs/figment/pipeline/video/video_delivery_ruling_assertion.py` is a read-only
**assertion reader**. It binds a separately supplied, externally-authored review
claim ("ruling assertion") to the *current* prepared vertical-video delivery
evidence at read time. It does not author rulings, does not pick "latest"
anything, does not render, publish, or write persistent artifacts of its own.

## What it actually does

1. Re-validates the prepared delivery evidence at `root` / `evaluation` via the
   reused, frozen `video_delivery_review.py` (`validate_prepared_delivery`) —
   this is the same immutable-evidence check that module already performs, not
   a new authority.
2. Reads the ruling assertion JSON file at `ruling` (root-relative, contained
   within `root`, and rejected if it falls under the canonical review parent or
   inside the delivery's own review directory).
3. Confirms `bound_subject_sha256` and `bound_review_directory` in the ruling
   match the delivery evidence just validated.
4. Re-validates the delivery projection a second time and re-snapshots the
   ruling file, rejecting if either changed between reads (cooperative
   freshness, not an atomicity guarantee against a hostile writer).
5. Derives `derived_outcome` (`reported_fail` / `reported_incomplete` /
   `reported_pass`) from the claim's own fields and returns a result record.

The persistent prepared evidence files themselves remain unchanged. The
reused, delegated validator (via the delivery module) temporarily extracts
frames into its own temporary extraction directory under the evidence root
and cleans up those temporary files when done; no persistent writer is added
by this reader.

## CLI

```
python orgs/figment/pipeline/video/video_delivery_ruling_assertion.py read --root "C:\path\to\prepared-delivery-root" --evaluation "root-relative\evaluation\path" --ruling "root-relative\ruling-assertion\path"
```

`--root` is the existing prepared-delivery evidence root directory itself
(not a root-relative path). `--evaluation` and `--ruling` are root-relative
paths, using the same conventions as `video_delivery_review.py`; both must
resolve inside `--root`, and `--ruling` may not be inside the canonical
review directory. Output is a single JSON result record on stdout.

## SCHEMA EXAMPLE (placeholders — do not submit as a real ruling)

Replace every placeholder below with the actual current preparation's
subject hash and review directory, a real attribution string, and a real
timestamp. The example below
deliberately uses `not_watched`, `incomplete` review fields, and
`unassessed` audio with both audio reviews `incomplete` — a genuinely
unreviewed placeholder shape, not a fabricated pass:

```json
{
  "schema": "figment/video-delivery-ruling-assertion@1",
  "bound_subject_sha256": "<subject-sha256-from-current-preparation>",
  "bound_review_directory": "<review-directory-from-current-preparation>",
  "playback_observation": "not_watched",
  "correspondence_review": "incomplete",
  "temporal_review": "incomplete",
  "detail_crop_review": "incomplete",
  "template_fit_review": "incomplete",
  "audio_presence_claim": "unassessed",
  "audio_licensing_review": "incomplete",
  "audio_mix_sync_review": "incomplete",
  "notes": "<genuine reviewer notes>",
  "unauthenticated_attribution": "<reviewer-identifier>",
  "recorded_at": "<ISO-8601-timestamp>"
}
```

## Guarantees and non-guarantees

- `reported_fail` takes precedence over everything else in `derived_outcome`.
- Any `incomplete` field, `playback_observation != watched_full`, or
  `audio_presence_claim == unassessed` yields `reported_incomplete` unless a
  fail is already present.
- `reported_pass` requires a fully complete, watched claim — but it still
  grants **no** approval or publish authority. `not_promotable` is always
  `true` in the result.
- `audio_presence_claim` is the reviewer's claim, not an observed fact about
  the actual projection; this reader never decodes or watches media.
- `attribution_authenticated` is always `false` — the attribution string is
  unverified and self-declared.
- The module does not prove full transform correspondence, does not
  authenticate the operator, does not write rulings anywhere, and does not
  integrate with Studio.

## Technical acceptance

- Accepted source commit `dbd7d0959f7f2c055fe9aba0fb83e19c8e73e46d` (parent
  `1dcc3873`), exactly two files changed, 1139 added lines.
- `video_delivery_ruling_assertion.py`: 308 lines, 13419 bytes, SHA256
  `77187b1c84b101d6fc3801916ff81409f628ca52c62cb75ba7b418ffd0431460`.
- `tests/test_video_delivery_ruling_assertion.py`: 831 lines, 38335 bytes,
  SHA256 `513359f8a3574c50342e8a12dd14e035c2ce6e26d0c907a9904fd054d19e016c`.
- One fresh focused suite run: 101/101 pass, 0 fail/error/skip, 312.709s wall
  (308.13s pytest), 2026-09-12T03:08:47.299152+00:00 through
  03:14:00.008546+00:00. All 101 JUnit cases were independently parsed, with
  154 matching before/after source/template hashes confirmed against the
  current files. Coverage includes real native/encoded derivative authority,
  the public CLI, exact 2-prepared/4-nested native calls, stale-evidence and
  post-second-validation claim mutation; fast mocked-authority unit tests
  cover shape/path/enum/outcome adversaries. Not all 101 cases exercise the
  real chain — many are mocked-authority unit tests.
- Independent final static/delta review found no confirmed blocking issue.
  One earlier casefold finding was rejected after checking existing
  guard/canonical-path invariants — no real exploit was found or fixed. One
  source repair round was used prior to this run; no second was needed. No
  source changes occurred after this test run, and the older video
  preparation source/tests stayed frozen throughout.
- Artifacts are pinned by SHA256 in
  `C:/Users/danie/kb/_private/figment-video-ruling-verification-20260912-v1`:
  `result.json`
  `567456bcc1e15464e853d45e4fa4d1cfbffd28e14097b1c31379053da8ca9189`;
  `focused.junit.xml`
  `652f52839c2d6228c18222bf5ac9597d7e5a4a66a91cff65a67ef3e566d867fc`;
  both closure snapshots
  `6f0c98f6f3fdb4dcafb18718979ef1f9e1065fd8d3a6f599b337e9bfd60ff22f`.
  The independent review report is pinned in
  `C:/Users/danie/kb/_private/figment-claude-video-ruling-final-review-20260912-v1/report.md`
  with SHA256
  `b78c35e2aa5ee597dbb8621b27ec568f1ad231bc9b3f9b5886e38aa82bc3dad0`.

This acceptance covers only the source/tests/review described above. It does
not accept actual creator media, does not prove human review occurred, does
not authenticate anyone, does not integrate with Studio, does not authorize
publication, and is not a claim that the broader Figment pipeline is
complete.
