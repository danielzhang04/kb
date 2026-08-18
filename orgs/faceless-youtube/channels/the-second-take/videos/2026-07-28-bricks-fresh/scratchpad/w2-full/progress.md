# Wave-2 conductor run — bricks-fresh STEP-1 figure cards

Started: 2026-08-18 (boss dispatch)
Skill: image-generation, followed exactly (no hand-authored prompts/params).

## State found at start
- Wave 1 (Pass-1 library: cast canonicals, crowd anchor, env plates, props) CONFIRMED complete:
  assets/library/manifest.json has 44 assets incl. 9 identity canonicals; all 16 named-character
  vocab terms used in shots.json resolve to refs/<name>/<name>.png on disk (7 of them promoted but
  not yet re-listed in registry.json's `assets` array — bookkeeping gap only, not a build gap).
- shots.json (246 shots, 2026-08-06 doctrine re-authoring) has 0/246 inline `assets` tags written
  (Pass-1 step 7). Confirmed NOT a blocker: forge.py's `cmd_batch` resolves cast live from the
  registry + video library manifest (`vfile()` fallback), never requiring the inline tag cache.
- `forge.py batch` on the FULL file refuses to write anything: 29 PRE-GEN REVIEW GATE refusals, all
  Pass-2 SCENE entries needing 6 unreviewed/failed place plates (L65, L84, L86, L112, L114, L198).
  Iteratively excluding those + their downstream dependents (43 shots total; see blocked_ids.json)
  converges the batch build cleanly: 203 in-scope shots -> 311 spec entries = 108 STEP-1 figure
  entries + 203 scene entries.

## Wave-2 scope decision
Wave 2 = STEP-1 figure cards ONLY (character seed cards). Scene entries in the spec are NOT run
(out of scope per brief — separate follow-on phase).
- 108 STEP-1 cards buildable now from the 203 non-blocked shots.
- +26 more STEP-1 cards are needed only inside the 43 place-blocked shots (cross-checked against
  the full unscoped dry walk); 7 of those 33 already REUSE existing verified fig-* cards, 26 need
  fresh generation but are entangled with Pass-2 place-plate review (out of scope; flagged for the
  Pass-2 conductor, not chased here).
- Total Wave-2 target this run: 108 STEP-1 cards, batched into 6 groups of ~20 for act-cadence
  review (batches/b1..b6.json), each dry-run preflighted clean (0 errors) before any spend.

## Log
- [x] spec.json built (scoped, 203 shots) -> step1-all.json (108 entries) -> batches/b1-b6.json
- [x] all 6 batches dry-run clean (--dry-run, $0)
- [x] b1 (20) generate — 19/20 first pass, 1 transient provider error re-issued OK (20/20 minted)
- [x] b1 review + stamp — fresh-eyes pass on 22 staged figures (20 mine + 2 old unreviewed
      leftovers pulled in by the reuse gate). 8 flagged: 2 rig (visible ear on back-to-viewer;
      full scene-bleed cliff on action-recoil), 5 clean_card (leaked brick/briefcase/pallet-stack
      props), 1 pose (costume+posture bleed). ONE sanctioned retry per frame via
      forge-retry-overlay@2 (retry-b1-overlay.json). Retry outcome: 1 fully fixed (pose),
      2 clean_card fixes succeeded on their primary defect but left the grip pose reading neutral
      (documented Era-A clean_card tradeoff — SURFACED not re-rolled) x4 total (hold-one-hand x2,
      carry-by-handle x2), 2 still FAIL on a shared CHANNEL-LEVEL asset defect: the base pose
      primitive refs/base/action-recoil.png itself renders a 5-digit hand (violates the
      3-finger+1-thumb rig law) — upstream of any STEP-1 retry, needs a Pass-1/asset-level fix,
      not something this run can correct. 1 pose-lost-on-retry (back-to-viewer rendered
      front-facing both times).
      CORRECTION 2026-08-18: initial stamp script re-used a stale fail-set and wrongly recorded
      5 accepted clean_card/pose retries as rig=fail; caught while building the b2 board (they
      resurfaced as "pending"). Re-stamped with verdicts-b1-CORRECTED.json. TRUE FINAL: 19/22
      verified, 3/22 flagged (back-to-viewer pose-lost; 2x action-recoil digit defect). The 3
      flagged PNGs moved out of _staging to `_staging_flagged_*` so they stop cluttering reuse/
      board scans while staying on disk for reference.
      Stamped via stamp_review.py --figures into visual-kit/_staging/review.json.
- [x] b2 (20) generate — 19/20 first pass, 1 transient provider error re-issued OK.
- [x] b2 review + stamp — 7 flagged: 4 clean_card (bowl-of-food, briefcase, grid-lined ledger,
      torn-paper prop leaks — same systemic grip-pose pattern as b1), 2 rig (hard-hat/hi-vis
      costume bleed with no authoring clause for it; blue collar/missing tie), 1 rig (shared
      action-recoil channel-asset 5-digit-hand defect, same root cause as b1's two). ONE retry per
      frame. Outcome: 6/7 fixed and accepted, 1/7 (action-recoil) still fails — same shared
      base-asset defect, un-fixable at STEP-1 level. FINAL: 19/20 verified, 1/20 flagged. Filled
      and stamped correctly this time (learned from the b1 bug above).
- [x] b3 (20) generate — 20/20 first pass, no provider errors.
- [x] b3 review + stamp — 10 flagged (heaviest batch yet): 5 clean_card (2 briefcases+breath-cloud,
      floor-tint backdrop leak, leaked clipboard+wrong-suit-color+bg-tint, leaked blank paper,
      leaked brick+block), 5 rig (surrender.png shared digit defect — 2ND base pose primitive found
      with the 5-digit bug, see systemic finding below; glasses worn instead of pushed-up; double
      glasses rendered; missing tie; bald head/wrong skin tone on a costume-authorized tuxedo shot).
      ONE retry per frame. Outcome: 7/10 fixed and accepted, 3/10 still fail — 1 shared base-asset
      digit defect (surrender.png, un-fixable at STEP-1), 1 fresh clean_card-class leak surfaced by
      the rig-retry re-roll (document case), 1 fresh rig deviation surfaced by the clean_card-retry
      re-roll (glasses position). FINAL: 17/20 verified, 3/20 flagged.
- [x] b4 (20) generate — SAFE-STOPPED here per boss handoff to parallel workers. 19/20 generated
      (sitting in _staging, UNREVIEWED — no fresh-eyes pass run yet). 1/20
      (fig-line-worker--sit--expr-smug--58cc68b6) failed generation TWICE ("no image in response":
      original attempt + the one policy re-issue) — needs a fresh regen attempt, not a content
      retry (no content was ever produced to judge).
- [ ] b4 review + stamp — NOT DONE, handed off
- [ ] b5 (20) generate — NOT STARTED, handed off
- [ ] b5 review + stamp — NOT DONE
- [ ] b6 (8) generate — NOT STARTED, handed off
- [ ] b6 review + stamp — NOT DONE

## STOPPED HERE 2026-08-18 — handoff to boss-run parallel workers
Coordinator message received mid-batch-4-generation: boss is taking over as conductor to fan the
remaining work (b4 review, b5, b6) across parallel worker agents. Brought b4 to a safe stop (one
policy re-issue attempted on its single generation failure, still failed, parked as
generation_failed_needs_regen — NOT a 2nd retry, per the one-reissue policy). Started NO new
batches after receiving the handoff. Full machine-readable state, harness/invocation notes, and
the two systemic findings are in `remaining.json` (same directory as this file) — that is the
authoritative handoff artifact; this file's log above is the narrative trail.

IMPORTANT — no wave_coordinator.py/wave_worker.py harness was found under
orgs/faceless-youtube/.claude/skills/image-generation/; this run used forge.py's own CLI
(batch/gen/dry-run) directly and serially per SKILL.md, not a parallel-worker harness. See
remaining.json's `IMPORTANT_deviation_from_boss_ask` field for the full note to whoever picks
this up.

## Systemic finding (for the human / next Pass-1 conductor)
`refs/base/action-recoil.png` AND `refs/base/surrender.png` (2 of the channel's base pose
primitives) themselves render 5-digit hands (thumb + 4 fingers) on their raised/open hands,
violating style-bible §3's "3 fingers + 1 thumb, NEVER five digits" rig law. Every STEP-1 card
seeding either primitive inherits the defect and CANNOT be fixed by a STEP-1-only retry (confirmed
3x now across 3 different characters/poses — action-recoil x2, surrender x1 — defect persists
identically every time). This is a Pass-1/asset-library-level fix (regenerate or hand-correct the
base primitives), out of this Wave-2 run's scope. 4 STEP-1 cards parked on this alone so far
(b1: miniscribe-rep x2 action-recoil, b2: brick-foreman x1 action-recoil, b3: brick-foreman x1
surrender); worth checking EVERY open-splayed-hand base pose primitive for the same bug before
Pass 2 — this looks like it could be a rig-template-wide issue, not two isolated ones.

Separately: grip-pose primitives that store a "generic grey placeholder object" per the skill's own
design (carry-by-handle, hold-one-hand, hold-both-hands, hold-paper-by-sides) reliably leak a
REALIZED, scene-specific object into fresh STEP-1 cards on first pass (briefcase, brick, bowl of
food, ledger with visible grid content, torn paper) despite the assembled prompt explicitly
instructing "empty-handed." The `clean_card` retry route (forge's 2026-08-18 P3 fix) reliably
clears the leaked object, but the resulting pose usually reads as a neutral resting stance rather
than the specific grip shape (the retry drops the derived beat clause per its documented "Era-A
payload shape" tradeoff). Accepted these as verified per this run's judgment (primary defect —
leaked content — is what clean_card exists to fix, and the softened pose is a known, documented
trade rather than a fresh defect) but flagging the pattern since it recurred in every batch so far
and will likely keep recurring on any qt-wiles/brick-foreman/drive-maker/terry-johnson shot using
these 4 poses.

## Spend ledger (call count x engine; $/call not exposed by registry.json, estimated from prior
wave pricing ~$0.17/1K-tier call per memory `bricks-fresh-rendered-arc` wave pricing)
| batch | calls | est. cost |
|-------|-------|-----------|
| b1 | 20 gen + 1 reissue + 8 retry = 29 | ~$4.93 |
| b2 | 20 gen + 1 reissue + 7 retry = 28 | ~$4.76 |
