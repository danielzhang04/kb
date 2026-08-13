---
id: 6a7e2ba9-dd210cdf
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-taste-forensics
risk-tier: T1
owner: codex-worker
claim-token: edf61ea570776942
state: done
approval: null
workflow: 019ffcd3-99c4-79b3-b17e-efbfb2b9fc2a
depends-on: []
variant-group: null
role: work
session-id: 6a7e29dd-e1548694
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Finalize: promote crowd r3 + correct seed-board captions + rebuild ($0)

Codex worker in worktree `C:\Users\danie\kb-worktrees\boss-taste-forensics`. Channel dir:
`orgs/faceless-youtube/channels/the-second-take` (<ch>). Video dir:
<ch>/videos/2026-07-28-bricks-fresh (<video>). Scratch: <video>/scratchpad/taste-forensics
(<scratch>). Patterns to follow: <scratch>/t17_promote_stamp.py (stamping) and
<scratch>/build_seed_board.py (the board builder you will edit).

\## Job 1 — promote + stamp the verified crowd exemplar

Both round-3 verifiers passed every axis (read <scratch>/t18-verdicts-A.json and
t18-verdicts-B.json — do not re-derive):
- Copy <ch>/visual-kit/_staging/crowd-exemplar-reroll-r3-candidate.png →
  <video>/assets/library/crowd-exemplar.png (REPLACES the superseded task-14 exemplar at that
  path — prior bytes are git-committed, no backup needed).
- Stamp through the sanctioned single writer exactly as t17_promote_stamp.py did: verdicts
  payload built yourself merging BOTH t18 verdict files' axes, canonical_sha256 from the promoted
  bytes, reviewer string:
  "sonnet verifier A3 (era/tones/hair/variety) + sonnet verifier B3 (rig invariants + proportion vs channel-seed anatomy), round-3 seeded-restyle mint, task-18 2026-08-13".

\## Job 2 — board caption corrections (edit build_seed_board.py, then rebuild)

1. P12 vetoed expressions: the board currently marks expr-shock/expr-pleading as anomalies
   ("still exist despite ABSENT-BY-LAW"). WRONG framing — P12 was implemented as FAIL-stamps +
   registry/manifest row removal; the gate refuses them by name; files remaining on disk is
   correct. Recaption: "VETOED (P12) — FAIL-stamped, refused by the pre-gen gate by name; file
   retained by design". Amber/grey marker, not red.
2. Crowd section, final content: (a) the PROMOTED per-video exemplar (now
   assets/library/crowd-exemplar.png) as the headline card, caption "verified 11/11 (pair A3/B3),
   seeded-restyle of the channel frame; 5 figures per channel-seed precedent; NOTE: fig-3 dark
   head tone measures ~25 warm of #7a4f33 (unambiguous but inheritable) — taste glance"; (b) the
   channel seed refs/base/crowd-exemplar.png captioned as the seed; (c) a compact failed-rounds
   strip: task-14 exemplar (4.4 heads), r1 (leggy 3.91), r2 (uniform 1.5-hw legs + ears) — small
   thumbnails, one-line mechanism captions; r1 candidate is
   _staging/crowd-exemplar-reroll-candidate.png, r2 is _staging/crowd-exemplar-reroll-r2-candidate.png,
   task-14's superseded exemplar: recover its bytes via
   `git show 1a94fa5:<video-relpath>/assets/library/crowd-exemplar.png` to a temp file under
   <scratch> (delete after embedding).
3. Cast section: trial-judge/return-customer/brick-co-seller/hr-officer flag notes stay; verify
   they render.
4. Rebuild seed-board.html, re-run the builder's own assertions (all img data: URIs, counts),
   report new counts + size (must stay under 14MB).

\## Laws

Touch ONLY: assets/library/crowd-exemplar.png (Job 1 copy), the review store via the sanctioned
writer, build_seed_board.py, seed-board.html, temp files under <scratch> (deleted after). No
registry, no shots.json, no refs/, no commit/push, no .env, $0 — no API calls.

\## Report

Stamp payload (keys + reviewer string), promoted-file sha, board counts + size, assertion
results, deviations flagged.

## Result

Completed promotion and rebuild.

- Promoted SHA-256: `d0476658676af854cadc9d6ad72214c0f527736a4167b9cfc460a1db13b4ec01`
- Stamped via `stamp_review.py` under key `../videos/2026-07-28-bricks-fresh/assets/library/crowd-exemplar.png`.
- Payload keys: `canonical_sha256`, `expression_sha256`, `verdicts` (11 all-pass axes), `reviewer`, `date`.
- Reviewer: `sonnet verifier A3 (era/tones/hair/variety) + sonnet verifier B3 (rig invariants + proportion vs channel-seed anatomy), round-3 seeded-restyle mint, task-18 2026-08-13`

[Seed board](C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/seed-board.html) rebuilt: 2,786,225 bytes (<14 MB), 93 embeds. Counts: cast 17, resting 6, crowd 5, expressions 18, primitives 35, env 5, scenes 7.

Final builder assertions passed: all images are data URIs, section/image counts match, no `file://` paths, size limit met. The four requested cast flag notes are present; P12 cards are amber/grey with the corrected veto framing. Temporary task-14 image was deleted.

Deviation: the prescribed `git show 1a94fa5:<video-relpath>/assets/library/crowd-exemplar.png` fails because this ignored video asset is absent from that commit. I used the pre-existing board’s embedded task-14 thumbnail for this single rebuild, then deleted the temp file. Browser rendering was unavailable, so the flag-note check was static-DOM verified.
