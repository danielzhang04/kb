# Pickup — Poyais chunk-2 board iteration (paused 2026-07-15)

**State: chunk 2 fully generated + reworked once; the human is MID-ITERATION on the rework board and
stopped the session. Resume by re-presenting the board and taking the next round of shot feedback.**

## Where we are

- **Board (live, reuse this URL):** https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5
  — currently shows the 6 reworked shots (L33, L40, L41, L43, L44, L46). Human said: *"I have to
  iterate on this board again but stop for now, we'll pick it up from here later."* → expect another
  round of shot edits on these 6 (or a re-cut of the board) before chunk-2 closes.
- **Chunk-2 status:** 15 shots generated (all of L27–L47). 9 human-accepted on the first board
  (L34, L35, L36, L37, L38, L39, L42, L45, L47 — manifest verified true/true). 5 dogfood shots
  (L27, L29–L32) accepted earlier. The 6 reworked shots are stamped verified true/true in the manifest
  **but review was SKIPPED per human directive** — the pending human gate on the current board is the
  real gate; flip any rejects back to blocking.
- **Manifest:** `channels/the-second-take/videos/2026-07-04-poyais/assets/scenes/manifest.json`
  (gitignored) — 41 stamped entries, `chunk2` section carries the run + regen record verbatim.

## What landed this session (all committed on `feat/pipeline-simplification`)

- `fa7842e` style-bible §3 **identity-match invariant** (human-approved): seeded character's head tone
  + hair must match its canonical; blank-base = identity FAIL.
- `91fc9e9` chunk-2 feedback edits: L33 → plate + two identical FAKE stamp overlays (slam motion);
  L40/L41 → hold the L37–39 table set; L43 strict-rig clause; **L44 redesigned** (zoom-out off L43's
  stamped portrait, MacGregor pointing; second FICTION overlay removed); L46 → faithful static prop
  blow-up (blank-vignette gag retired); stamp-slam default in `animation-rules.md`.
- `6db3a61` **stamp lettering register LOCKED**: `visual-kit/refs/env/stamp-block-outlined.png`
  (2-round audition; human picked B1 heavy-ink + B2 dark-contour combo). Style-bible §6: stamps are
  the ONLY exception to the marker-italic family. Registry 59 assets.
- `fcb68b4` **camera pull wired**: `build_motion.py` reads optional per-shot `camera` key; L44 is the
  single authorized move (dry-run: 1/118 moving); regression guard now asserts moves ⇔ plan-authored.
- Audition boards: stamp audition https://claude.ai/code/artifact/52ca0225-67c8-46fd-9ef3-d3f8a3219976

## Chunk-2 tooling (reusable, session scratchpad may be gone — recreate from this recipe if needed)

Old + current scratchpads hold: `build_units.py` (REWORKED for the redesign: multi-seed lists
canonical+pose+expr resolved from `visual-kit/refs/`, engine-layer hard-error, quoted-text detection →
lettering seed, manifest done-skip), `pass2-brief.md` v2 (multi-seed law, baked-text law, env-anchor
rule, identity-starve + thin-background failure modes), `review-brief-c2.md` (3-axis fresh-eyes),
`stamp_chunk2.py` (manifest merge). Current scratchpad:
`C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-faceless-youtube\faa60873-96fc-46b8-9e2b-2c2bfa0e830b\scratchpad\`.
If gone, the chunk-2 board HTML rebuild is one command:
`py -3 .claude/skills/image-generation/scripts/build_review_artifact.py --video channels/the-second-take/videos/2026-07-04-poyais --out <path>.html --shots <ids>` → publish via Artifact tool to the URL above.

## Queue after the human closes chunk 2

1. **Chunks 3–6** — proposed: parallel, one combined board (~85 gens ≈ $12). Gen totals C3=23 C4=24
   C5=21 C6=17. **Blocker for C5: `hastie-wife` has NO canonical** (not on disk, not in registry) —
   generate seeded off `hastie` + style anchors, human-gate it first.
2. **Open G-route candidates (surfaced, not self-applied):** (a) identity-starve hit 3× — consider
   making the two-pass (scene, then identity pass off canonical) the DEFAULT for scene-heavy
   single-character shots; (b) `forge cutout --key-white` option (rembg groups lettering blocks —
   L43's cutout needed a manual white-key refine); (c) L42 five-star stagger not expressible (no
   per-layer delay primitive in motion schema).
3. **Pre-render fixes:** "SimÃ³n BolÃ­var" double-encoding ×8 near L16–L17 in shots.json (2 inside
   vo_ref anchors — must be fixed against the VO anchor matcher, NOT string-replaced; lint currently
   green). L15→L16 vanishing route line. L18/L23 flagged manifest entries stand.
4. **After images:** thumbnail → full-video voiceover ∥ audio-director → `build_motion --motion-plan`
   → chunked Remotion render (RENDER_CHUNK_FRAMES=1500) → ear/eye gate.
5. Standing: operating-law prove-it gate (fresh terminal quote-clause-D test); voiceover
   generation-logging rule gap; merge `feat/pipeline-simplification` when the video's done.

## Working-model reminders (session-tested)

- Every subagent on **Opus 4.8** via Agent tool `model: "opus"`; deep briefs with governing clauses
  injected; verify agent claims against disk (one agent stalled "waiting on monitor" — nudge via
  SendMessage with a foreground-only directive; another self-certified an identity fail the review
  caught). Gen agents: foreground forge only, `--force --aspect 16:9`, never pipe through tail/head,
  never touch manifest.json (orchestrator merges).
- Boards: rebuild the SAME html path and republish → same artifact URL.
