# Visual Style-Lock System — design spec

**Date:** 2026-07-04 · **Status:** approved (brainstormed), pending implementation
**Author:** Claude + Daniel · **Supersedes:** `2026-07-03-vector-visual-system-design.md` (that spec
predated the Recraft/Nano pivot and assumed Claude-authored SVG + Remotion; this replaces its
illustration-engine half. Remotion as the *motion/compositor* layer survives into Phase 2 here.)

---

## 1. Problem

Every past attempt to generate this channel's illustrated assets drifted:
- **Across terminals:** a fresh session knows nothing the last one learned, so it regenerated blindly —
  wrong character, wrong art style, no match to what was approved.
- **Within one terminal (the worse one):** mid-iteration. The user approves an image, says "iterate on
  *this* character," and the next generation misses completely — because the iteration wasn't *anchored*
  to the approved image; it re-rolled from text, or seeded off a slightly-different (already-drifted)
  frame. This is exactly what produced the `warmface_v2` hair-drift.

The root cause is not "no procedure." It is **no single authoritative, complete, machine-followable style
spec**, and **no enforced verification** that a generated image actually matches it before it's accepted.

## 2. Goal

A **reproducible, self-correcting visual-identity system** — per channel, repeatable for future channels —
that lets image generation produce **exactly the approved character(s), art style, environments, and
variants every time**, and improves rather than drifts as the asset library grows.

The mechanism, in one line: **a thick per-channel style bible (data) + a small canonical reference set
(ground truth) + thin niche-agnostic skills (procedure) whose core move is generate → verify against an
objective checklist → bounded retry / escalate.**

## 3. Non-goals / scope boundaries (read this before building)

- **Not true animation from the image model.** Nano Banana / Recraft are *still-image* generators. A
  character "moving / compressing / animating" is **not** produced here. This system guarantees a rich
  vocabulary of **expressive pose stills** in the locked style. The actual *movement* (rigging,
  squash/stretch, cutting between poses, camera) is a **render-layer job in Remotion — Phase 2.**
  Reference channel "Historically" works this way too: still art, motion composited in After Effects.
- **Not a big pre-generated asset library.** These videos hit many, many different environments; you can
  never pre-make enough. We lock the bible + a *small* canonical reference set and forge on demand.
- **Not realistic skin.** Different "people" are distinguished by a **small locked palette of flat,
  non-realistic stylized head tones**, never photoreal skin (which would destroy the signature).

## 4. Architecture

Four pieces. The first two are per-channel **data**; the last two are niche-agnostic **procedure**.

```
channels/<name>/visual-kit/
  style-bible.md          # (A) the source of truth — locked descriptor, palette, checklist, protocols
  refs/                   # (B) the canonical reference set (the model sheet) — versioned in git
  registry/               # generated, on-model assets, indexed (grows over time)
    registry.json         #     the lookup index (name → file, character, seed-frame, traits)
    <assets>.png

.claude/skills/
  asset-forge/            # (C) consumer skill — generate/iterate any asset via the verify loop
  style-lock/             # (D) establisher skill — build a channel's bible + model sheet from refs
```

### (A) `style-bible.md` — the source of truth

One per channel. Fields:
1. **Identity** — channel, style name, one-line look description, engine + model, default aspect ratios.
2. **LOCKED STYLE descriptor** — the verbatim text block prepended to *every* generation prompt (the
   promoted, canonical version of `gen_locked.py`'s `STYLE` string). Character model-sheet traits +
   art-style rules + render rules + hard negatives ("no text, no letters, no logos").
3. **Palette** — every color as an exact hex with a role (base head tone, outline, red accent, teal…),
   including the **small locked set of flat stylized head tones** for cast diversity.
4. **Acceptance checklist (invariants only)** — the binary verify items are the identity **invariants**
   that must never change, e.g. *bald egg head? · head one uniform flat tone from the locked palette,
   no gradient/skin? · outline the locked weight + colour? · the locked eye/brow style + **no nose**? ·
   flat cel cartoon render? · exactly one character unless the scene declares two? · no text/letters?*
   The loop checks these. It deliberately does **not** check pose, expression, or proportions — those
   are **flexible** and are *supposed* to change, and to exaggerate, per scene. Locking proportions
   would wrongly reject a squash-and-stretch action pose as drift (see §5a).
5. **Canonical reference registry** — each locked model-sheet asset: name, what it is, file path, and its
   **seed rule** (identity vs. style — see §5).
6. **Expression / pose / action vocabulary** — a first-class section: the enumerated range of emotions
   and expressions AND the body-pose/action range, explicitly including **exaggerated squash-and-stretch
   action poses** (HeyHistorically-style: recoiling, leaning-in, running, deforming proportions to sell
   motion), all while holding the invariants. Seeded from the Historically analysis (§7).
7. **Recurring cast & world** — a growing registry of locked characters (narrator + cast, each with its
   assigned flat head tone and canonical seed frame) and locked environments/props.
8. **Generation + iteration protocols** — the base-then-fan-out method and the anchored-iteration rule.
9. **Lock status & change log** — what is locked, when, and the rule that **edits to this file require
   human approval** (see §6).

### (B) The canonical reference set (`refs/`)

The small model sheet the skill seeds from: the narrator neutral **base**, the approved identity frames,
an **expression turnaround**, each additional cast member's base, and a few environment/prop exemplars.
**Versioned in git** — unlike the throwaway sweeps, this *is* the locked memory and must not live only on
one local disk.

### (C) `asset-forge` — the consumer skill (built first; highest value)

Used constantly. For any request ("draw the narrator worried in a bank"; "give me the banker, surprised"):
1. **Registry lookup first — reuse before regenerate.** If a matching asset already exists, return the
   **file**; do not generate. Generation happens only for variants not in the registry.
2. **Seed correctly** (§5): character variant → seed off that character's stored canonical frame;
   brand-new character → seed off the base for *style only* + mint a new identity.
3. **Prompt = verbatim locked descriptor + only the scene/pose delta.**
4. **Generate → verify → loop** (§6).
5. **Save** accepted assets into `registry/` and index them in `registry.json`.

### (D) `style-lock` — the establisher skill (Phase 2 generalization; the process we run for warmface now)

Used once per channel: analyze the user's approved references, extract the exact descriptor, generate +
verify the canonical model sheet (base + expression turnaround + cast), and write `style-bible.md`.
For warmface we run this process semi-manually in Phase 1 and capture it as the skill afterward.

## 5. Identity vs. style seeding (the reproducibility rule)

- **Character identity** (the recurring narrator, a named cast member): seed off that character's stored
  canonical frame so the *same* head/face/proportions come back. Change exactly one variable (outfit,
  expression, pose). Never seed a character variant off a downstream derivative (that is the `warmface_v2`
  mistake).
- **Style-only** (environments, props, a brand-new character): seed off the neutral base for *line +
  palette + render* only — identity is intentionally new.
- **Reuse:** an exact registry hit is returned as a file, never re-rolled.

## 5a. Invariants vs. flexible traits (what "locked" actually means)

The lock is on **identity**, not on posture. Every asset splits its traits into two sets:
- **Invariants** — never change; these are what the verify loop checks: bald egg head, the locked flat
  head tone, the outline (weight + colour), the eye/brow style, **no nose**, the flat cel cartoon render.
- **Flexible** — *expected* to change, and to exaggerate, per scene: pose, expression, camera framing,
  and **body proportions** (squash-and-stretch for action). The loop must NOT treat these as drift.

This distinction is load-bearing: it is what lets the character recoil, lean, run, and deform for
Historically-style action while still reading as unmistakably the same character. Validated 2026-07-04 by
the base stress-test (3 emotions + 2 exaggerated action poses off one calm base; identity held, proportions
flexed). The base head tone `#f5ead6` (cleaner cream) + outline `#241a12` (dark warm brown-black) + the
calm no-nose face are the working locked base pending final sign-off.

## 6. The verify-and-iterate loop (the core mechanic)

```
generate the asset
  → open each PNG and check EVERY acceptance-checklist item (objective, binary)
  → all pass?  → accept, save to registry, done
  → a check fails?
       ├─ fault is the one-off SCENE/POSE prompt  → adjust that transient prompt, regenerate (≤3 total)
       └─ fault is a LOCKED file (bible / canonical reference)
             → STOP this asset. Diagnose the culprit input. Present the best candidate + a PROPOSED edit
               to the locked file, and wait for human approval. NEVER self-edit a locked file.
               MEANWHILE: keep generating the other, non-dependent assets that look safe.
  → same checklist item fails 3× (systematic, not stochastic) → stop, diagnose, escalate as above.
```

Principles:
- **Bounded.** Max ~3 attempts per asset. No infinite loop (pro testing has already burned $25+).
- **Stochastic miss vs. systematic miss.** A one-off bad roll → retry (optionally push the violated trait
  harder into the negative). The *same* trait failing repeatedly means an input is wrong → stop, don't
  keep paying for rolls.
- **The lock only changes with human sign-off.** Auto-patching the bible mid-loop would silently corrupt
  the exact thing we're locking — the failure mode we are eliminating.
- **Verification is objective.** Claude actually opens each PNG and ticks each checklist item; "looks
  right" is banned.

## 7. Expression range + Historically analysis (Phase-1 input)

Analyze 1–2 Historically videos with `video-perception` / `claude-video-vision:watch-video` to extract a
catalog of: pose archetypes, the emotion/expression range, scene compositions, and *motion* archetypes.
**What it buys us:** (a) the enumerated expression/pose vocabulary to generate as stills (§4-A-6), and
(b) the spec for Phase-2 Remotion motion. **What it does not buy us:** a way to make Nano animate — the
art stays stills; motion is composited later. Historically is a *quality/expressiveness target*, not a
clone template (its painterly-halftone look was deliberately rejected for warmface's clean flat look).

## 8. Engine details (carried from prior work)

- **Model:** Nano Banana `gemini-3-pro-image` via `generateContent`, `responseModalities:["IMAGE"]`,
  `imageConfig.aspectRatio`. Seed-from-reference = pass approved frames as `inlineData` + the descriptor.
- **Recraft `style_id`** is deferred (Approach-2 option): a stronger *style* lock for environments/props
  if Nano-only proves inconsistent, but weaker on character identity and a second engine to maintain.
  Not in Phase 1.
- **Gotchas:** run scripts with native `py -3` (msys python lacks a CA bundle); prefer `certifi`. Recraft
  (if later) needs a browser `User-Agent` (Cloudflare 1010). Nano can leak style hints as on-image text →
  "no text" in every prompt + a checklist item.
- **QC:** Claude reads the PNGs directly to verify; ffmpeg montages optional for human review artifacts
  (big images + click-to-enlarge lightbox is the standing default for review artifacts).

## 9. Base-tone decision (execution Step 0)

The narrator's head tone is the identity everything seeds from, and the user is unsure if `#f3e3c8` is
too creamy. **Before the reference set is locked**, run a quick 3-way base comparison (current cream vs.
slightly whiter vs. one between); the user picks; that becomes the locked base tone in the palette. Do not
lock the model sheet until this is chosen.

## 10. Phasing

**Phase 1 (now) — lock The Second Take + prove the loop:**
1. Base-tone comparison → user picks the locked tone (§9).
2. Historically analysis → expression/pose/scene catalog (§7).
3. Write `channels/the-second-take/visual-kit/style-bible.md` (§4-A), from `gen_locked.py`'s descriptor +
   the `warmface_final` references + the decisions above.
4. Build the canonical reference set (base + expression turnaround + 2nd cast member + a few plates),
   verifying each; version bible + refs in git.
5. Build the `asset-forge` skill (§4-C, §5, §6).
6. **Acceptance test:** (a) forge a *new* dynamic/compressed narrator pose — style + identity hold via the
   checklist; (b) an "iterate on this" single-variable variant off an approved frame; (c) a registry
   reuse hit returns the file with no regeneration.

**Phase 2 (later):**
- Generalize the `style-lock` establisher skill from the warmface process.
- **Remotion motion layer** — the actual "movement" (rig/animate the stills, squash/stretch, pose-to-pose,
  camera). This is where Historically-style motion is realized.
- Pipeline integration: `visual-prompt-writer` emits style-locked scene specs → `asset-forge` forges them
  → `render-builder` consumes them (replaces JSON2Video inline gen for this channel; add a `visual_engine`
  flag to the dna Pipeline block).

## 11. Acceptance criteria (Phase 1 done = )

- `style-bible.md` exists, complete, no placeholders, committed.
- Canonical reference set + `registry.json` exist and are versioned.
- `asset-forge` generates a new on-model asset that passes its checklist, self-corrects a deliberately
  induced drift within the retry cap, anchors an iteration to an approved frame, and reuses an existing
  registry asset without regenerating.

## 12. Open decisions (deferred, not blocking Phase 1)

- Whether to add a Recraft `style_id` in Phase 2 for environment/prop style-consistency.
- Exact registry match/lookup heuristic (how "close enough to reuse" is judged) — settle during
  `asset-forge` build.
- The Remotion motion approach (layered-rig vs. pose-to-pose vs. hybrid) — Phase 2.
