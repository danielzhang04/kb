# Pickup — Poyais chunks 3–6 board gate (paused 2026-07-16)

**State: ALL Poyais image generation is COMPLETE (L01–L125). Chunks 1–2 human-released. Chunks 3–6
generated, 3-agent fresh-eyes reviewed, retry round done, manifest stamped; the human is at the BOARD
GATE. Resume by taking his shot feedback on the chunks-3–6 board.**

## Where we are

- **Board (live, reuse this URL — same artifact as all Poyais boards):**
  https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5 — shows chunks 3–6 (L48–L125).
  Session paused right after publishing; expect shot feedback → rework → republish same URL loop, exactly
  like chunk 2.
- **Chunks 1–2 (L01–L47): CLOSED.** Human-released 2026-07-16 after 3 rework rounds (L33/L44 stamps,
  nose fixes, L03 ship, L34, L15–L17 map rework, FICTION matte re-key). All stamped verified true/true.
- **Chunks 3–6 (L48–L125): generated in ONE parallel run** — 24 Opus agent units, ~110 gens ≈ $15,
  then 3 concurrent fresh-eyes reviewers (identity/rig · fidelity · style) over the whole batch, then an
  11-frame retry round (3 agents) → 10 cleared, 1 flagged.
- **Manifest merge VERIFIED (77 entries = {L48..L125} minus L113 which doesn't exist; disk-truth pass;
  L01–L47 untouched).** Backup: manifest.pre-c36-merge-2026-07-16.json. chunk3_6 section = run record.
  Note: c5-u02's unit log was missing — L93/L94/L95 seed provenance inferred (flagged in their notes);
  PASS status solid across all three review axes.
- **The ONE hard flag: L96** — needs exactly 10 grave crosses in a row (7 tall + 3 small); best attempt
  renders 9 (6+3) in an otherwise-correct countable composition; retry spent. Also carries a
  set-continuity tradeoff (fresh env seed departs from L95's shelter set). Human decides.
- **Taste calls riding on the board (stamped true, notes carry them):** serif-lettering cluster
  (L53/L71/L97/L108/L112-plate lean serif/block vs the marker register — rule once for all five);
  red-usage trio (L51/L77/L119); L60 bold-ring vs authored "glow"; L81 canonical face kept over the
  "blends in" gag; L48 extra thematic POYAIS wall signage; soft watches L50/L80/L117 hands, L93/L109
  shading, L116 tone, L101/L102 gaunt. Continuity PASSes: L85/L53 ships, L67/L110 office.

## Session log — what landed 2026-07-16 (commits on feat/pipeline-simplification)

- `4ed8037` two-gen identity pass = DEFAULT for scene-heavy single-character shots (+decisions).
- `62707c3` hastie-wife canonical registered (human-picked cand-1, mob cap).
- `6fe4b9f` mojibake repair (11 glyphs incl. L65 £) + manifest audit notes + STATUS.
- `83d2e9b` L44 stale camera-note fix + rework log.
- `cc3b491` map-sequence rework: engine static-route persistence + `reuse` layer wiring (L15/L16/L17
  share one MacGregor cutout; Bolívar resized 0.42).
- `cd2e29c` seven learnings pinned durably: forge cutout wide-aspect HARD-GUARD (+4 tests), magenta
  chroma law + enclosed-hole keying (bible §8), stamp-exemplar seed law (§6), reuse-one-cutout rule
  (motion-planner), hands-seed-pose-primitive (§5), never-delete-authored-facts (SKILL.md), baked-text
  own-canvas (§6), + decisions entry.
- UNCOMMITTED: the chunks 3–6 asset PNGs (gitignored), manifest (gitignored), scratchpad tooling.

## Batch learnings NOT yet codified (G-route candidates — need human confirm)

1. A delta that REMOVES a transient element should seed the pre-transient ancestor, not the immediate
   predecessor (L89 case).
2. Text-free ban should whitelist a seeded prop's own baked lettering (L92 deed case — VPW authoring).
3. Crowd scenes with one seeded lead: assert lead costume + give competing figures contrasting uniforms
   (prevented starve proactively, L121).
4. Two-figure hand exchanges: seed the interaction primitive (handoff.png) — fixes head-form AND
   open-hand digit drift at once (L48 fix).
5. Cutout gen prompts must force "one solid uniform FLAT magenta field, no glow/gradient" — the fringe
   failures were generation-side glows, not keying failures (retry-cutouts method note).
6. Style-reviewer matte flags on raw cutouts are usually VIEWER ARTIFACTS (transparent-but-colored
   pixels) — always MEASURE opaque-chroma % before regenning (7 flags dismissed this run).

## Queue after the human releases chunks 3–6

1. Any board rework rounds (regen → restamp → republish same URL).
2. **Thumbnail** (primary + challengers, 16:9) — its own small board gate.
3. Full-video **voiceover** ∥ **audio-director** → `build_motion --motion-plan` → chunked Remotion
   render (RENDER_CHUNK_FRAMES=1500) → human ear/eye gate. Render eye-gate items: L15–L17 route
   persistence + at-rest MacGregor slide + Bolívar spacing; L44 camera pull (wired, 1/118).
4. Merge `feat/pipeline-simplification` when the video's done.
5. Standing: mint the visual gold exemplar; harden identity review (nose slip); validate writer on a
   fresh topic; open chunk-1 bugs (`--mode identity` bald head — did NOT bite on L91; head-turn nose).

## Working-model reminders (session-tested)

- Every subagent on Opus 4.8 (`model: "opus"`); deep briefs with clauses injected; VERIFY agent claims
  against disk (this session: 2 generator misses caught by review; 7 reviewer false-positives caught by
  measurement — both directions fail).
- Gen agents: foreground forge only, never pipe through tail/head, --force; 16:9 scenes/plates ONLY
  (cutouts now hard-guarded); no agent touches manifest.json (orchestrator merges).
- Boards: rebuild same html path (scratchpad full-sequence-board.html) or pass `url` → same artifact.
- Unit tooling: session scratchpad `1037de8d-…` holds build_units.py, pass2-brief.md (v2 + this
  session's hardening), review briefs, unit specs/logs, c36-collect.md (the full run ledger).
