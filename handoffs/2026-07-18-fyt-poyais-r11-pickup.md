# Pickup — Poyais R11 round (written 2026-07-18, parked awaiting watch-through №6)

**State: R10 RENDERED + VERIFIED. Daniel will deliver watch-through-№6 feedback in a NEW terminal.**
This doc is that terminal's resume state. Live status: `docs/handoffs/STATUS.md` (current). Decisions:
`knowledge/decisions.md` (R10 entry 2026-07-18).

## What just happened (R10, one line each)

- All 12 watch-through-5 W-notes landed (`_watch-through-5-notes-2026-07-17.md` +
  `_r10-fix-plan-2026-07-18.md` in the video dir — read both first).
- **VO splice defect root-caused by measurement and fixed in the engine** (breath.py): valley cut +
  pad-to-target sentence law (0.65s/0.45s totals) + room-tone gap fill + splice-continuity gate in
  audio_checker, wired into render QA via build_motion. Raw vo.mp3 was always clean.
- Audio doctrine: LONG fades by default (music_fade_s 1.2/2.5, switch gap 1.2, card fades 2.5);
  music_present_db 10; halo pool → halo_vocal-1; floating-book ahh = pinned composite
  `halo_vocal_book-1` (5-link, 4.44s, L36 only); five-star boom cue deleted.
- Visual: L11 + L54 crowd-rig regens; L75 trio regenerated FRESH on the base rig (R9's "REUSE -
  on-rig" was a mis-inspection — struck in scenes/manifest); slim L27 arrow at [0.302,0.42]
  hf 0.085; Chile neck chroma despilled deterministically.
- **Render: 492.8s (~8:13), −14.2 LUFS, 117 shots, cues_unresolved=0, 6 cards, 10/10 probes
  correct.** Board republished (R10 content): https://claude.ai/code/artifact/aaba522c-9d2e-4426-909e-680c5e55c38d
- A/B chain in assets\: final.mp4 (R10) · final.pre-r10-2026-07-18.mp4 (R9) ·
  final.pre-r9-2026-07-17.mp4 (R8).
- Commits: b36ddcd + 0309e9e + 6830095 (engine) · cb00a55 (audio+doctrine) · e0a3fa1
  (visual+decisions) · 6f5c789 + c167af6 (notes+plan) · a1991a7 + b6ec5f6 (STATUS).

## The round pattern (proven ×4 — follow it)

Notes file with stable IDs (next: X01…) → clarifying questions FIRST → verified Opus 4.8 agents
(`model: "opus"`, agent logs its model ID as report line 1 — never assume) with incremental
scratchpad reports → staging in `assets/r10-staging/`-style dirs → SINGLE-WRITER merge (only the
orchestrator writes shots.json / shots.motion.json / audio-plan.json / audio-tokens.json /
manifests; one merge script, --dry first) → lints + build_motion --dry-run (anchors, tail-overshoot
warns) → foreground-sequential render in a subagent → verify by measurement → board republish to
the SAME artifact URL (`url` param) → `Start-Process` the mp4 → explicit-path commits (never
`git add -A` / `commit -a`).

## Gotchas that bit this round (don't re-learn)

- **Fresh-eyes reviewers disagree; the orchestrator eyeballs the tiebreak** (R9 rule, fired twice:
  the trio "nose" claim was false — pixel scan + eyeball beat one dissenting reviewer; the
  "staged trio is a regression" claim was backwards — the ON-DISK trio had ears + dot eyes).
- **The continuity gate must measure at the valley cut_s, not at_s** — resolve_cut_points returns
  a COPY, so pre-splice gap dicts lack cut_s; the gate now resolves valleys itself (6830095).
  First render reported 4 false FAILs for this reason; audio was clean.
- **Timeline shrink cascades**: pad-to-target removed ~36s → L36 shrank → the 6-link composite
  rang 0.41s past it (caught by the M20 dry-run warn) → rebuilt 5-link. Any future length-tuned
  pinned asset must be re-checked after ANY timing-law change.
- **uint8 overflow in pixel checks** (`g + 25` wraps) — cast to int before arithmetic; it produced
  phantom "remaining chroma" counts mid-despill.
- GateGuard blocks the FIRST Write/Edit per file: present the 4 facts, retry identically — passes.
- cp1252 shell: never inline non-ASCII in `py -3 -c`; write UTF-8 .py helpers to the scratchpad.

## Open flags for Daniel's №6 gate (ear/eye judgment, not bugs)

1. End-card music exemption — Monkeys plays under the end card (R8 ruling carried). Silence instead?
2. Death-onset buzzer stays removed (somber beat only). Dread cue wanted?
3. L75 trio shading softness (one reviewer dissent) — his eye decides on the board's W07 section.
4. Overall pacing: every sentence beat tightened (0.65s target) — does the faster read feel right?
5. Carried minors: cha-ching tail under "one problem" · 4 warn-only SFX ring-tails · independent
   true-peak −0.7 dBTP (loudnorm claimed −1.0; inaudible) · 96 kHz AAC (parked bug).

## After the gate passes (the tail — unstarted)

metadata-writer check → thumbnail → CC-BY credit block (Incompetech beds incl. upbeat-4 + **Marty
Gots a Plan** + crack-3/halo-1/collapse-1 — audio/manifest.json is the provenance source) →
compliance + QA gate → publish-queue (Stage 0: Daniel publishes). Then the **§G codification
session** (R6 candidates 1–15 + R7/R8 + R9 + new R10 candidates: valley-cut/pad-to-target as
portable law · gate-must-measure-what-shipped · length-tuned assets re-check after timing changes ·
reviewer-tiebreak-by-orchestrator now proven ×3) — each needs Daniel's explicit confirmation.
Then **F-clean sweep at video lock**: all `*.pre-r*` backups, `_superseded-*` dirs, r10-staging,
watch-note/plan scratch files, despill backups.

## Still-open parked bugs

forge.py pick path-id crash · `--mode identity` bald head · head-turn NOSE · AAC 96 kHz.
