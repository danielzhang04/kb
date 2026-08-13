# 2026-08-13 — bricks taste-forensics: Phase-3 SHIPPED + G4 mint DONE, Daniel's G4 ruling pending

Supersedes handoffs/2026-08-11-fyt-bricks-taste-forensics.md (consumed — deleted this commit).

## State

- **Branch `claude/bricks-taste-forensics` @ 0a3f7a6, PUSHED (remote == local), UNMERGED.**
  Full Phase-3 chain: 801dad1 (P1 pins) → db0ffd1 (P2 rollback) → f68ee7c (P3 gates) →
  3d2aea2 (P4-6) → e088c45 (P8) → 72a0260 (P9-10) → 78dbc47 (P11 no-op + P12) → a1dcb4e (8h
  sweep) → 34e39e9 (final fix set, whole-branch review verdict SHIP) → 0471fc7 (9b store
  isolation) → 0a3f7a6 (G4 run state + evidence). 536 tests green at 0471fc7; +11 more at 34e39e9
  (527) — final suite count 527 pre-9b, 536 post; every task opus-implemented, opus/sonnet
  reviewed, all models transcript-grep-verified.
- **G4 mint: 13/18 verified, 3 parked, $0.780 of $5.00** (20 gens, ledger entry this commit).
  Verified live: P2 casting (incl. line-worker NEW cast via standard wave), P3 gate (live
  refusal + hold/release), P4 crowd routing, P12 veto refusal, C-1 retry-name guard.
- **Results board artifact** (side-by-side old/new + defect exhibits): published from the boss
  session — URL in the boss conversation; file at
  `videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/g4-results-board.html`.
- **6c3 remains FROZEN** until Daniel's G4 ruling.

## The two G4 findings (Daniel rules)

1. **P8 pose regression (parked: L39+L48 cards).** Compose-from-primitives re-authoring stripped
   act words; `beat_clause` then carries no act text; a pose REFERENCE image alone does not
   transfer posture (controlled: 4/4 untouched-prose cards landed pose, 0/2 stripped, L46
   same-primitive control landed with prose intact). P10 re-mint can't recover (same recipe).
   **Candidate fix (needs ruling, one function):** when a figure sentence names a primitive in
   backticks, `beat_clause` derives the act text FROM the primitive's own act description, so
   the doctrine stays compose-from-primitives AND the clause carries the act.
2. **P9 half-landed (parked: L34).** Hair core fixed (37.58%→6.51%); face interior NOT
   (29.79%→43.70%); ibm-suit held — same one-figure asymmetry as 6c2. Role prose landed in the
   payload (verified); the provider ignores half of it. May need render-side iteration or
   acceptance; no code defect identified.

## Open items (from the final review triage + run)

- Follow-ups (ship-safe): gate reports one asset per run (vs complete-list doctrine); review
  store machine-local (this machine's store is curated: 2 P12 FAILs + 17 grandfather rows +
  run verdicts — re-verify before any future mint; MAIN checkout has a DIFFERENT 71-row store);
  lint blind to `base` castings (deliberate trade — forge catches at preflight; surface to
  Daniel); stem-keyed store collision (fires when a video mints its own crowd-exemplar);
  legacy visual-kit/scripts class ruling; sliced batch silently drops place plate unless the
  minting shot is included (operational trap, noted in 9c report); ~17 stale scene-manifest
  `verified` rows + L169 `file: null` (sanctioned emitter should fix); brick-co-seller unminted
  (L115/L239/L240 — VPW rerun); M-1..M-12 minors in the final-review transcript record.
- **Worktree `C:\Users\danie\kb-worktrees\boss-taste-forensics` holds an untracked `.env` COPY**
  (Daniel copied it for the mint; boss deletes it at close — if you find it, delete it).
- Full shots.json re-author (P2's 116 castings, P5 plate prose, palette) belongs to the later
  VPW rerun per Daniel's P12 ruling — NOT this branch.

## Load list (on resume)

1. This file.
2. `kb-worktrees/boss-taste-forensics/.superpowers/sdd/2026-08-11-bricks-taste-forensics/progress.md`
   (the complete task/verdict/deferral record).
3. `videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/change-list.md` (G2 rulings).
4. `.superpowers/sdd/.../task-9c-report.md` + `scratchpad/taste-forensics/g4-genlog.md`.
5. `memory/claude-boss.md` 2026-08-13 section (lessons).

## Next actions

1. Daniel views the results board → G4 ruling: (a) accept 13/18 as recovered + rule on the P8
   candidate fix (one bounded fix round + ~$0.16 re-mint of the 2 cards + 2 scenes), or (b) park
   deeper. On accept: unfreeze 6c3, merge branch, sweep worktree.
2. On merge: session close ritual (fetch --prune, delete merged branch, worktree remove, DELETE
   the .env copy first).
