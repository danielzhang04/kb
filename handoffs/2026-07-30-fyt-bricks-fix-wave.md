# bricks-fresh fix-wave handoff — 2026-07-30

**Topic:** Board-verdict → fix-design r3 (two-step seeding law) implemented, dogfooded, and priced;
the repair wave itself is the resume gate. All work committed on `claude/boss-post-103` @ `6735796`
(NOT pushed; local branch on Daniel's machine, cut from post-#103 main).

### What WORKED (with evidence)

- **Two-step seeding probe → WIN** — round-2 probe via the skill's own recipe: 7/7 cards passed the
  card-vs-canonical gate, 6/6 placements held identity, falsifier (Attempt-A paper-doll / Attempt-B
  base-bleed) not tripped. Daniel scoped it: named-cast scenes only. Board artifact published.
- **fix-design r3** — two-step folded in per Daniel's correction: the seeding RECIPE is unchanged
  (canonical + pose + expression, one gen, attribution language); it just MOVES to an isolated
  step 1; step 2 places [figure(s) + plate]. NO "card" system/vocabulary (Daniel rejected that
  framing hard). Named-cast FRESH stage-base gens only; deltas/crowd/env stay single-step.
- **Phase A (opus): forge.py seeding law + `batch`** — hard-errors unseeded figures at $0 before any
  API path; replay of the run's real 209-entry batch caught 24/24 known dropped-pose shots + all 26
  anon_foreground. Cast resolution = channel registry ∪ video `assets/library/manifest.json`
  (closed the validator-shares-generator-blind-spot gap the dogfood found). `--shots` repair scope
  opt-in, no-flag path byte-identical (sha-compared). 23 seed-requirement tests green.
- **Phase B (sonnet): authoring law** — visual-grammar two-tier law (named cast/crowd, ≤2 cast,
  closed pose inventory, objects-before-people), VPW pre-authoring cast+colour + SCOPED-REPAIR mode
  (SKILL.md:30), style-bible rig prompt edits. Greps confirmed superseded text gone.
- **Phase C (sonnet): deletions** — 5 cross-video env plates deleted (git-tracked, recoverable),
  register routing gone, review apparatus slimmed per fix 7, registry cleaned (65 assets, env kinds
  = only the 2 lettering/stamp hands), pc-boxy `no_hands: true`.
- **Phase D dogfood: 9 gens, $0.921 of $1.50 cap, ZERO rig/identity defects** — incl. hardest case
  2 named cast + crowd (L60). L45/L116/L143 VERIFIED banked; L143 = clearest before/after (crowd rig
  correct). Board artifact: https://claude.ai/code/artifact/6151e46c-1333-40d2-8160-bdeb68b367f4
- **Daniel board-note fixes landed**: crowd exemplar contributes ONLY rig simplification, dress from
  scene era (style-bible §2d, forge injects verbatim — forge itself untouched); qt-wiles is a
  BUSINESSMAN (steel-grey three-piece, gold tie clip, NO stethoscope/white coat — "Dr. Fix-It" is
  script flavor only); 8 shots.json hunks rewrote the medical-costume metaphor onto the suit/tie-clip.
- **Wave priced (zero spend)** — scratchpad/wave-plan.md: 142 targets, 203 gens, $24.35,
  recommended cap ≈$30.

### What Did NOT Work (and why)

- **Round-1 probe** — cards seeded [canonical + 2 base primitives] with no attribution language →
  base-bled (majority-vote), runner verified scenes against corrupted cards (circular). Fix: the
  skill's own multi-seed attribution recipe, run via forge, hard mid-run card gate.
- **"Card-first" r3 framing** — REJECTED by Daniel: reads as a second seeding path. The recipe never
  changes; only WHERE it runs.
- **Phase-A v1 cast detection** — channel-registry-only; video-local leads got zero seeds and zero
  violations (validator shared the blind spot). Caught ONLY by the dogfood.
- **fyt-runner spend refusal** — correct behavior: agent-relayed approval ≠ authorization; needs a
  card with Daniel's words or his direct instruction. Boss's attempt to mint the card was
  classifier-blocked (branch switch, card write, worktree remove all denied). Resolution: Daniel
  said run it as a plain subagent; worked.
- **`forge gen` skip-if-exists + stale `_staging/`** — nearly logged a false free win (L45). Gap
  still OPEN for the wave: step 0 must sweep stale staging frames.
- **L61 fidelity** — "archery target on wall" renders as aura around Wiles; IDENTICAL in the shipped
  frame (pre-existing, not a two-step regression). One authored retry queued for the wave.

### What Has NOT Been Tried Yet

- The repair wave itself (task #2): re-authoring pass (VPW scoped-repair) + regen in chain order.
- qt-wiles canonical re-mint (businessman) — wave precondition, listed in fix-design's blocking table.
- SKILL.md still owed a `--shots`/`--video` doc mention (flagged by Phase-A worker, cosmetic).
- Phase-B's class-table figureless-first reorder was applied only to the institution row (design gave
  text only for that one); rest needs the doctrine analysis in hand.

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| `claude/boss-post-103` @ `6735796` | DONE (local) | 24-file fix-wave checkpoint commit: forge.py+tests, SKILL.mds, grammar, bible, registry, plate deletions, shots.json, manifest, fix-design r3, dogfood docs. NOT pushed. |
| `…/bricks-fresh/scratchpad/wave-plan.md` | DONE, uncommitted | The spend gate: 142 targets/203 gens/$24.35/cap $30; 33 taste-pick plate list; risks incl. 73-places reality vs "~5-8" guess |
| `…/bricks-fresh/scratchpad/dogfood-*` | DONE | slice record + board (assets/ 59MB uncommitted) |
| `…/visual-kit/refs/{qt-wiles,hq-banker,brick-foreman,auditor-rep}/` | UNTRACKED extractions | read-only `git show` from 309b341 (branch claude/fyt-gated-pipeline); qt-wiles canonical STALE (stethoscope) pending re-mint |
| `…/bricks-fresh/scratchpad/twostep-probe*` | PRUNABLE | probe scratch; verdict consumed into fix-design r3 |

### Exact Next Step

Present Daniel the wave gate from `wave-plan.md` and get: (1) cap approval (recommend ≈$30, or trim
the 33 taste-pick plate batches to top ~8-10 places to cut cost + his picking labor); (2) ruling on
L97 (verify-only, don't regen a clean shot); (3) note L60/L61 reopen with the qt-wiles re-mint (wave
banks 3 dogfood shots, not 5). Then run the wave per wave-plan §5: stale-staging sweep → qt-wiles
re-mint → VPW scoped-repair over targets → forge batch --shots per phase → gens → slimmed per-act
review → shot-board. Spend authorization lesson: have Daniel's approval in his own words BEFORE
dispatching the executor, quoted in the brief.

### Load list

- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/wave-plan.md`
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/fix-design.md`
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/dogfood-slice.md`
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/board-verdict.md`
- `git log -1 6735796` on `claude/boss-post-103` (the checkpoint diff)
- Skill: `fyt-runner` conducts the wave; VPW SCOPED-REPAIR clause at `visual-prompt-writer/SKILL.md:30`
