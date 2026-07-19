# Pose/expression seeding — the two-step character build (design)

**Date:** 2026-07-10 · **Status:** approved (brainstorm complete), pre-plan
**Owner files (each concept, one home):**
- Seed doctrine + hand-tone rule → `channels/the-second-take/visual-kit/style-bible.md` **§5** (+ §7/§8 alignment)
- The two-step process (Pass 0/1/2) → `.claude/skills/image-generation/SKILL.md`
- Authoring (select pose/expression refs, surface missing) → `.claude/skills/visual-prompt-writer/SKILL.md` **Step 5**
- The fields → `.claude/skills/visual-prompt-writer/references/shots-schema.md`

**Untouched (deliberately):** `forge.py` (multi-seed gen + §2c auto-append already do everything the merge needs — no engine change); `render-builder` (consumes the final scene PNGs, upstream is invisible to it); `universal.md §13a` (class→composition table, unchanged); the `beat_type`/motion layer.

## Problem

The channel was built on a premise (style-bible §1/§3): the shared rig lets a pose/expression, *built once, map onto any character*. A library exists — **18 expressions + 13 action poses** on the base template. **But the pipeline never seeds them.** Scene generation seeds only the character's *identity* canonical (§5 seed rule; image-gen Pass-2 technique b) and drives pose/expression from **words in the `still_prompt`**. So the correct 4-digit hand that lives in the library pose frame is thrown away and re-synthesized from the word "clasp" — reverting to the engine's dominant 5-finger prior on any non-trivial hand. **Prompt text cannot override that prior** (proven: explicit "never five" + a callout + regen still shipped 5-finger hands). The library is used only as an authoring *vocabulary*, never as a generation *seed* — the whole point, unimplemented.

## Validated findings (the tests this design is built on)

Run on MacGregor + the base `offering` pose (open hands = the worst case) + `smug` expression:

1. **Seeding [pose + identity] directly into a gen works** — identity bound from one ref, pose+4-digit hands from the other, scene composed from words. No prompt-fighting; the hand came from the pose frame. (Architecture A.)
2. **Seeding [pose + expression + identity] (3-seed) also works** — all three bound; the smug face + offering hands + MacGregor identity held.
3. **Hand-tone learning:** the transferred hand takes the *pose frame's* skin tone (cream), NOT the character's. **Fix = a fixed delta rule:** every skin patch **including both hands** renders in the CHARACTER's head tone, never the pose reference's. (Held once instructed.)
4. **Two-step beats one-step** — not mainly for asset reuse, but for **isolation + validate-before-spend:** the delicate 3-seed binding is resolved in ONE merge you approve (hands/tone/expression/identity on a clean portrait) *before* any scene gen; the scene gen is then a **safe single-seed** (what the pipeline already does reliably). If the binding bleeds, you lose one cheap merge, not a full scene.

## The design — two-step, pose/expression seeded

### Authoring (VPW) — select refs, don't describe mechanics

VPW Step 2.5 already **casts characters** from the registry (Step 4: "name the registry asset so image-gen seeds it"). Extend the *same pattern* to pose + expression:

- **Step 5 (restructured):** after the scene is conceived (scene-first ordering — the still_prompt drives, pose/expression fit it, never the reverse), select each prominent character's **`pose_ref`** and/or **`expression_ref`** from the registry vocabulary (mirroring Step 4). These are recorded **structurally** (see schema) — the `still_prompt` describes the *scene + the character's placement/action intent* but **no longer authors hand/finger/pose mechanics** (the pose asset owns those; double-authoring removed).
- **Reuse-or-surface:** VPW judges each needed pose/expression against the registry. A close-enough existing asset → reference it (the delta may still adjust body *angle*; the asset supplies the *hand*). Nothing close → name a NEW slug and record it in **`needed_assets`** (surface-the-list). VPW never generates pixels.
- **Modular:** `pose_ref` and `expression_ref` are each optional per character — pose-only, expression-only, both, or neither (neither = today's plain identity canonical).

### Schema (`shots-schema.md`) — two additions

- Per shot, optional **`cast`** array (present on character-forward shots, omitted on character-free ones):
  ```json
  "cast": [
    { "character": "macgregor",    "pose_ref": "offering", "expression_ref": "smug" },
    { "character": "miskito-king", "pose_ref": "present" }
  ]
  ```
  `character` = registry name (required if `cast` present); `pose_ref`/`expression_ref` = registry slugs (each optional). This is INTENT (which pose/expression the figure has), consistent with the schema's intent-not-mechanism discipline; it also replaces prose-parsing as how image-gen enumerates a shot's figures.
- Top-level **`needed_assets`** (per video): a single uniform array, one entry per library gap VPW surfaced — `[ { "kind": "pose | expression | interaction", "slug": "...", "wants": "<a clear description of the pose/expression/interaction>", "why": "<which shot/beat needs it>" } ]`. **Interactions are just another `kind`** — no special path. An entry is surfaced only after VPW checked the registry and found nothing close; `wants` is what makes the request actionable (the human/generation knows exactly what to draw).

### The human gate + veto loop (between VPW and generation)

VPW's run **hard-stops** after writing `shots.json` + `needed_assets` — it does NOT proceed to image-gen. Then:

1. **You approve or veto each surfaced pose/expression.** Approved → generated on the base (Pass 0) and you **rig-gate the generated frames** (two light touchpoints: approve the *list*, then rig-gate the *pixels*).
2. **On a veto** (too niche/hard), VPW **re-stages that beat using ONLY existing library assets** — it may NOT request a *new* asset for a vetoed beat. This is the **convergence rule**: a veto forces a restage from what exists, so there is no endless surface→veto→surface loop. If a beat genuinely cannot be staged from existing assets, VPW **flags that single beat** back to you rather than silently re-requesting. (This applies uniformly to poses, expressions, and interactions.)

Only once every shot's poses/expressions/interactions are available (approved+generated, or restaged onto existing assets) does generation proceed.

### Generation (image-generation) — Pass 0 / Pass 1 / Pass 2

- **Pass 0 — library coverage (NEW).** Read `needed_assets`. For each missing pose/expression, generate it **on the base** (single-asset loop, base-seeded), **human-approves** (rig gate — a base pose is a channel asset), `register` into the registry. Now the library covers the video. (Same human-gated shape as the existing library-build flow.)
- **Pass 1 — posed-character merge (EXTENDS "identity lock").** Step 1a is today's identity lock (materialize each recurring character's canonical — the merge *seeds* it, so it must exist first). Step 1b (new): for each distinct `(character, pose_ref, expression_ref)` combo the shots' `cast` declares, MERGE via **seed [character canonical + pose frame + expression frame]** with the binding delta: *identity+costume from the character; pose+hands from the pose frame; face from the expression frame; **every skin patch incl. hands in the character's head tone** (the §5 hand-tone rule)*. Verify (hands/tone/expression/identity on the clean portrait). Register as a **per-video posed-character asset** in `assets/library/`, keyed `<character>--<pose|none>--<expr|none>` (a combo used by many shots is merged ONCE and reused). A `cast` entry with neither ref → the plain identity canonical (today's Pass 1, unchanged).
- **Pass 2 — scene placement (RESTRUCTURED).** For each character-forward shot, **seed the posed-character asset(s)** for its `cast` (single-seed per figure) + compose environment/props from `still_prompt`. The current "seed identity + describe the pose in the delta" is **superseded and removed** — pose now arrives in the seed, not the words. Chains unchanged: the posed-character is the stage `base`; deltas seed the prior frame.

### Seed doctrine (style-bible §5) — the one governing change

§5 today: *"seed the character canonical; change ONE variable (expression/pose/…)"* — i.e. word-driven. **Rewrite** §5 to state the two-step, seeded doctrine: pose + expression come from **seeded library frames** composed into a posed-character (Pass 1), then placed (Pass 2); and the **hand-tone rule** (skin incl. hands = character tone, never the pose frame's). This supersedes the word-driven line — it is replaced, not appended-beside. §7 (library build spec) gains one clause naming the expressions/poses as the **seed source** for merges (their purpose made explicit); §8 (scene assembly) aligns to "place the posed-character (single-seed)."

## Non-goals (scope discipline)

- **Interactions are just another asset `kind`, not a special pass.** A two-figure interaction pose is a base-pose category the library doesn't have yet. A shot needing one surfaces it in `needed_assets` (`kind: interaction`) like any pose, through the same gate. The **merge mechanism generalizes** (seed the interaction-pose frame + the involved character canonicals → a posed-interaction asset); the added risk is binding two identities to two positions, which is **validated empirically on first use** (as single poses were), not special-cased in the flow. This build does not pre-generate the interaction category — the human generates it when a shot first needs it.
- **No `forge.py` change** — multi-seed gen + §2c already suffice; the binding + tone rule live in the delta the skill authors.
- **No `render-builder` change** — it consumes final scene PNGs.
- **No new pre-gen critic checkpoint** unless a gap appears — the fix is the seeded mechanism + the Pass-1 verify, not a new rule (fix-generation-not-prohibitions).

## Anti-trap checklist (the user's explicit bar)

**Single-home ownership map — no overlapping functionality.** Every visual concern has exactly ONE authoring/generation home; the plan enforces this and a cross-file audit verifies it:

| Concern | Its ONE home | Must NOT also live in |
| --- | --- | --- |
| Scene / environment / placement / narrative action | `still_prompt` (VPW) | — |
| Body pose + hands (the gesture) | `pose_ref` → seeded pose asset (Pass 1 merge) | `still_prompt` prose (**removed**) |
| Facial expression | `expression_ref` → seeded expression asset | `still_prompt` prose (**removed**) |
| Identity + costume | character canonical seed + registry pinned costume | the merge delta **points to** it, never restates the coat |
| Skin/hand tone | §5 hand-tone rule (merge delta = character tone) | — |
| Form invariants (round head, no nose/ears, 4-digit) | §2c auto-append (gen prior) + §3 (review) | a distinct function (consistency prior + verify), NOT the specific pose |
| Which figures are in a shot | `cast` array | prose figure-parsing (**replaced**) |

- **Governing structure is rewritten, not appended:** §5 seed rule, image-gen Pass 1/2, and VPW Step 5 are *restructured* to the seeded model; the superseded word-driven pose guidance is **removed**, not left contradicting.
- **One home per concept:** seed doctrine + hand-tone → §5; process → image-gen SKILL; authoring → VPW Step 5; fields → shots-schema; class→composition stays only in §13a; library build purpose → §7.
- **No dead/duplicated content:** the still_prompt stops authoring pose/hand mechanics (removed from Step 5's prose output), so pose lives in exactly one place (`pose_ref` → the seeded asset). `cast` replaces prose figure-parsing, not duplicates it.
- **Cross-file alignment:** the `cast`/`needed_assets` fields (schema) ↔ VPW authoring ↔ image-gen consumption ↔ §5 doctrine must name the same keys; a final alignment sweep verifies.

## Success criteria

- A character-forward shot renders with the character's **library hand** (4-digit) and **correct head tone on the hands**, because Pass 1 seeded the pose frame and applied the tone rule — verifiable on the posed-character portrait before the scene is generated.
- VPW emits `cast` (+ `needed_assets` when gaps exist); image-gen runs Pass 0→1→2; no shot's pose/expression comes from `still_prompt` prose.
- Cross-file read confirms one home per concept and no surviving word-driven pose guidance.
- Proven on a re-gen of a hand-forward shot (an L19-type offering/holding shot) through the full two-step path → human count holds 4 digits + tone.
