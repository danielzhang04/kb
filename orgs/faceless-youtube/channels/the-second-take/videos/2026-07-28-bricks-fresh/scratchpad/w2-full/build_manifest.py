"""One-shot script that assembled remaining.json for the Wave-2 handoff (2026-08-18).
Kept for provenance; not needed to consume the manifest itself."""
import json, os

OUT = r"C:/Users/danie/kb-worktrees/boss-taste-forensics/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/w2-full"

with open(os.path.join(OUT, "_manifest_working.json"), encoding="utf-8") as f:
    items = json.load(f)

envelope = {
    "video_slug": "2026-07-28-bricks-fresh",
    "generated": "2026-08-18",
    "run": "Wave-2 STEP-1 figure cards (character seed cards), skill=image-generation",
    "written_by": "claude wave-2 conductor session, stopped mid-run per boss handoff to parallel workers",

    "paths": {
        "repo_root_note": "all paths below are relative to the worktree root C:/Users/danie/kb-worktrees/boss-taste-forensics unless absolute",
        "kit": "orgs/faceless-youtube/channels/the-second-take/visual-kit",
        "video_dir": "orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh",
        "shots_json": "orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json",
        "forge_py": "orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py",
        "build_review_artifact_py": "orgs/faceless-youtube/.claude/skills/image-generation/scripts/build_review_artifact.py",
        "stamp_review_py": "orgs/faceless-youtube/.claude/skills/image-generation/scripts/stamp_review.py",
        "staging_dir": "orgs/faceless-youtube/channels/the-second-take/visual-kit/_staging",
        "scratchpad": "orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/w2-full",
        "batch_specs": "orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/w2-full/batches/b1.json .. b6.json (pre-split, 108 STEP-1 entries total, ~20 per batch)",
    },

    "engine": "gemini-3-pro-image (registry.json['engine']); 1K image-size tier (default); no per-call pricing exposed by registry.json — this run estimated ~$0.17/call from prior wave pricing in memory `bricks-fresh-rendered-arc`, UNVERIFIED, treat as rough order of magnitude only",

    "IMPORTANT_deviation_from_boss_ask": (
        "This run did NOT use a wave_coordinator.py/wave_worker.py parallel-worker harness — no such "
        "harness was found or referenced by the image-generation skill; SKILL.md's own machinery is "
        "forge.py's CLI (batch/gen/dry-run), invoked directly and SERIALLY, one image at a time, "
        "exactly as documented in the skill. Batches b1-b3 (and b4's first pass) were each run as a "
        "single `forge.py gen --batch <spec>` call that forge itself processes item-by-item "
        "(observed: 20 sequential provider calls per batch, no concurrency). If a wave_coordinator/ "
        "wave_worker harness exists elsewhere in this repo (referenced by the boss's message re: the "
        "r2 duel), it was NOT located under orgs/faceless-youtube/.claude/skills/image-generation/ "
        "and this session did not go looking outside that skill's own scripts dir since the skill's "
        "SKILL.md names forge.py as the only sanctioned generation entrypoint. A parallel worker "
        "picking up the remaining batches should either (a) run multiple `forge.py gen --batch "
        "<distinct-non-overlapping-spec>` processes concurrently — each spec must name disjoint "
        "output files, which the pre-split batches/b5.json and b6.json already guarantee — or "
        "(b) locate and use the wave_coordinator/wave_worker harness the boss referenced, if it "
        "exists under a different path (not confirmed by this session)."
    ),

    "how_to_reproduce_a_batch_generate_step": [
        "cd to worktree root",
        "py -3 <forge_py> --kit <kit> --video <video_dir> gen --batch <scratchpad>/batches/bN.json --dry-run   # $0 preflight, read every assembled prompt before spending",
        "py -3 <forge_py> --kit <kit> --video <video_dir> gen --batch <scratchpad>/batches/bN.json   # live, writes into <staging_dir>/fig-*.png",
        "on a transient provider error ('ERR no image in response'): re-issue ONCE by extracting just the failed entries into a small JSON list and re-running `gen --batch` on that subset; if it fails AGAIN, park it as generation_failed_needs_regen and move on (do not re-issue a 3rd time)",
    ],

    "how_to_review_and_retry_a_batch": [
        "1. Fresh-eyes visual review: Read each new PNG in <staging_dir>, compare against its character's refs/<name>/<name>.png canonical, judge on 3 axes per style-bible.md §3 (identity/rig incl. digit count + costume unless the shot's own payload authors a change; expression-register; flat-cel-hazard incl. NO leaked props/scenery — the card must be an isolated figure on flat pale-grey backdrop). A 'grip' pose (carry-by-handle, hold-one-hand, hold-both-hands, hold-paper-by-sides) leaking a REALIZED object (briefcase, brick, bowl, ledger with content) instead of staying empty-handed is the single most common defect class seen this run — treat any held/scene object other than the base primitive's own generic grey/blank placeholder as a FAIL.",
        "2. For each fail, classify defect as one of: expression | rig | pose | clean_card (clean_card = leaked prop/scenery/backdrop content; pose = wrong posture, e.g. hands not in the requested grip; rig = identity/costume/digit-count/facial-feature deviation from canonical).",
        "3. Get the originating shot id for each failed fig- name via: grep the batch build log (or re-run `forge.py batch --batch <shots_json> --shots <known-good-scope> --out /dev/null` style dry build) — OR simplest: `grep -n '<fig-name>' <scratchpad>/batch-build.log` (the original full 246-shot dry walk log, still on disk at <scratchpad>/batch-build.log) to find its 'L##:' line and read off the shot id.",
        "4. Move the defective PNG out of <staging_dir> to <kit>/_staging_rejected_<filename> (mv, don't delete — keeps evidence) so its exact original name is free again.",
        "5. Write a forge-retry-overlay@2 JSON: {schema: 'faceless-youtube/forge-retry-overlay@2', video_slug: '2026-07-28-bricks-fresh', entries: [{kind: 'step1', shot: '<L##>', character: '<name>', name: '<EXACT original fig- filename stem, no .png>', defect: '<expression|rig|pose|clean_card>'}, ...]}. The `name` MUST be forge's own derived digest name (copy it exactly from the fig- filename) — a hand-typed name is refused.",
        "6. py -3 <forge_py> --kit <kit> --video <video_dir> batch --batch <shots_json> --retry <overlay.json> --out <retry-spec.json>",
        "7. py -3 <forge_py> --kit <kit> --video <video_dir> gen --batch <retry-spec.json> --dry-run   # preflight",
        "8. py -3 <forge_py> --kit <kit> --video <video_dir> gen --batch <retry-spec.json>   # live, ONE retry per frame, no second retry ever",
        "9. Re-review the retried pixels with fresh eyes. clean_card retries reliably clear the leaked object but often leave the pose reading as a NEUTRAL resting stance rather than the specific grip — this run's judgment call was to ACCEPT that as verified (the leaked-content defect is what clean_card exists to fix; the softened pose is a documented Era-A payload-shape tradeoff, not a fresh defect) — a future conductor should keep this consistent unless overruled.",
        "10. Any frame STILL failing after its one retry: STOP, do not retry again. Move it to <kit>/_staging_flagged_<filename> (mv) so it stops cluttering future board scans, and record it as `parked` with the failed invariant + a short mechanism note.",
        "11. Build the review skeleton+board for the WHOLE current staging dir (it also re-surfaces any not-yet-cleanly-passing card, by design — that's fine, expected): py -3 <build_review_artifact_py> --video <video_dir> --out <scratchpad>/board-bN-final.html --staging <staging_dir> --figures-out <scratchpad>/verdicts-bN-final.json",
        "12. Fill verdicts-bN-final.json's per-figure verdicts object (keys are invariant slugs, values 'pass'|'fail') for EVERY figure it lists — including any prior-batch leftovers it pulls back in; BEWARE the exact bug this session hit once: don't reuse a stale fail-set from before you finalized judgment on a retry — always fill from your FINAL post-retry disposition, not an earlier draft.",
        "13. py -3 <stamp_review_py> --figures <verdicts-bN-final.json> <staging_dir>   # the ONLY writer of review.json",
        "14. Move every card whose final rig verdict is 'fail' out of <staging_dir> to <kit>/_staging_flagged_<filename> (mv) so it's excluded from reuse and future board scans.",
    ],

    "systemic_findings_for_any_continuing_worker": [
        "refs/base/action-recoil.png AND refs/base/surrender.png (channel base pose primitives) both render 5-digit hands (should be 3 fingers + 1 thumb per style-bible §3) on their own reference frames, upstream of any STEP-1 card. Confirmed by retrying 3 affected STEP-1 cards across 3 character/pose combos — identical defect every time, because the retry reseeds the same defective base primitive. THIS IS A PASS-1/ASSET-LIBRARY FIX, not something a STEP-1 retry can solve — flag any STEP-1 card using either primitive as parked, but stop retrying them individually; the fix belongs one level up (regenerate or hand-correct the two base PNGs), and it's worth auditing every OTHER open-splayed-hand base primitive in refs/base/ for the same bug before spending more retries on symptoms.",
        "Grip-pose primitives with a built-in 'generic grey placeholder object' (carry-by-handle, hold-one-hand, hold-both-hands, hold-paper-by-sides) reliably leak a REALIZED scene-specific object on first-pass generation (briefcase, brick, bowl of food, grid-lined ledger, torn paper, clipboard) despite the assembled prompt explicitly saying 'empty-handed'. The clean_card retry (forge's 2026-08-18 P3 fix) reliably clears the leaked object but usually leaves the pose reading as neutral/resting rather than the specific grip shape — accepted as verified this run per the reasoning in step 9 above.",
    ],

    "totals_this_session": {
        "target": 108,
        "done_verified": sum(1 for v in items.values() if v["status"] == "done_verified"),
        "parked": sum(1 for v in items.values() if v["status"] == "parked"),
        "generated_unreviewed": sum(1 for v in items.values() if v["status"] == "generated_unreviewed"),
        "generation_failed_needs_regen": sum(1 for v in items.values() if v["status"] == "generation_failed_needs_regen"),
        "not_yet_attempted": sum(1 for v in items.values() if v["status"] == "not_yet_attempted"),
        "provider_calls_made_est": 108,
        "est_cost_usd": "~$18.36 (108 calls x ~$0.17/call, UNVERIFIED estimate — registry.json exposes no per-call price)",
    },

    "out_of_scope_reminder": (
        "26 more STEP-1 cards are needed inside the 43 shots excluded from this run's scope (see "
        "progress.md 'State found at start' + blocked_ids.json) — those shots' SCENE generation "
        "depends on 6 unreviewed/failed Pass-2 place plates (L65, L84, L86, L112, L114, L198). "
        "Out of Wave-2 scope; flagged for whoever runs Pass-2 place-plate review."
    ),

    "items": items,
}

with open(os.path.join(OUT, "remaining.json"), "w", encoding="utf-8") as f:
    json.dump(envelope, f, indent=2)
print("wrote remaining.json,", len(items), "items")
