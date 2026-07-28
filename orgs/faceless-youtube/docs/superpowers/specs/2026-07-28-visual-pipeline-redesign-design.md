# Visual-Pipeline Redesign — Design Spec (wave 3, 2026-07-28)

**Goal:** restructure the visual pipeline's doctrine so VPW is a thin procedure over a channel-owned
depiction grammar (mirroring long-form-writer ↔ storytelling-grammar), image-gen is a two-step
build-then-consume flow over the library, and the style bible is a ~150-line law file — deleting the
laws Daniel retired and moving every rule to the layer that uses it. This wave CHANGES FUNCTION
(unlike waves 1–2): laws die, responsibilities move, shots.json slims to v2, and lint code updates.

**Context that forces this:** the writer no longer emits `[B-ROLL]` cues or `[PAUSE]` tags
(script.md is pure prose) — VPW's cue-expansion spine is gone; VPW invents the whole shot list.

## Daniel's rulings (2026-07-28, binding)

1. **Deleted laws:** hook bar · delta decisiveness (a delta changes ONE element; a world/register
   change is a hard cut — one sentence of chain logic, not a law) · anti-slop guardrail · channel
   translation step · the five-fundamentals / seven-named-laws apparatus. Held tableau demotes to ONE
   line of prompt guidance ("stage poses that hold; don't freeze mid-motion"), not a law.
2. **Non-literal harder-baked:** non-literal is the default with a stated bar; more non-literal than
   Poyais shipped. A new gated exemplar file `channels/the-second-take/example-shots.md`
   (script-line → ideal shot pairs) is the calibration, like example-scripts.md.
3. **Casting moves to image-gen.** VPW references figures/poses/expressions in prose using registry
   VOCABULARY names inline ("MacGregor, `smug`, `salute`, stage-left, facing right"); image-gen
   resolves names → files. No structured cast/pose_ref/expression_ref arrays.
4. **Render mechanics leave VPW** (matcher internals, retiming, stretch-to-fill machinery → render
   docs). VPW keeps authoring obligations only: verbatim anchors in order, coverage, densify.
5. **House style is fixed channel data** — texture / line weight / art style only; palette and light
   are per-shot facts. No per-video distillation step. The one `global_prompt_suffix` string lives in
   visual-grammar.md's header; style-bible + VPW point at it. dna.md's visual section shrinks to a
   pointer + the channel's imagery policy constraints (absorbing what VPW read niche.md for; niche.md
   leaves VPW's read list).
6. **Grammar restructure:** visual-grammar.md becomes THE channel depiction doctrine (absorbs
   universal §13a's table + core doctrine, the condensed literal/non-literal bar, chain logic,
   composition, staging). universal.md §13a shrinks to a stub for future channels. VPW reads grammar
   the way the writer reads storytelling-grammar.
7. **Thumbnails:** VPW derives thumbnail gen-prompts from script + dna (metadata-writer keeps
   title/description/tags only; its thumbnail-concept output is removed).
8. **Image-gen restructure:** Pass 1 then Pass 2 as written, sequential steps. Pass 1: read
   shots.json → derive the full asset list from vocabulary names (characters, groups, recurring
   props, poses, expressions) → surface any asset the registry lacks and STOP for human pre-gen
   approval (the gate moves here from VPW; vetoed → restage) → gen per the explicit character-gen
   rule → store → **write per-shot asset tags back into shots.json**. Pass 2 reads only the tags.
9. **shots.json v2:** drop `from_cue`, `beat`, `narration_type`, `hold_reason`, `cast`, `props`,
   `needed_assets`. Keep `shot_class` (the one audit tag), `id`, `vo_ref`, `duration_s`,
   `stage`/`stage_role`/`changed_elements`, `source`, `still_prompt` (vocab names inline),
   `stock_query?`, `synthetic`, `notes`, the thumbnail + shorts blocks. Pass 1 adds image-gen-owned
   asset tags. Engine-read fields are unchanged → build_motion/render.py untouched.
10. **Style bible ~150 lines.** Descriptor blockquotes (§2/2b/2c/2d/2e + recipe quote) stay VERBATIM
    (they are the payload the engine receives; refs were generated against them). Everything else
    cut to values + tight rules, even at the cost of explanatory function.
11. Waves 1–2 rulings still bind: zero examples outside gated exemplar files and contract skeletons,
    zero provenance, retirement prose only in retired-features.md.

## File-by-file target state

| File | Now | Target | State after |
| --- | --- | --- | --- |
| `channels/the-second-take/example-shots.md` | — | ~60 NEW | 6–10 exemplar pairs (script line → ideal shot, skewing non-literal), drafted from Poyais/Wells-Fargo bests + invented ideals; **GATE: Daniel edits/approves** before it becomes the bar. Header states: match the depiction thinking, never clone content. |
| `channels/…/visual-kit/visual-grammar.md` | 114 | ~170 | THE depiction doctrine: `global_prompt_suffix` string (header) · narration-type → shot-class table (from universal §13a, kept verbatim as a table) · core doctrine (~8 one-liners) · the literal/non-literal bar (a few points, non-literal default, example-shots pointer) · stage/chain logic (one element per delta; world change = hard cut; ≤3 deltas; disclosure order) · composition (§2 kept) · staging conventions (slimmed; tableau one-liner here) · register/policy constraints (from dna + niche quirks). |
| `.claude/skills/visual-prompt-writer/SKILL.md` | 259 | ~130 | Thin procedure: identify → read (script.md · dna.md pointer block · visual-grammar.md · example-shots.md · registry.json) → per-line classify→invent against the example bar, vocab-name references, scene facts, chain grouping → walk + densify to cadence + coverage → thumbnails from script+dna (§8 rules condensed) → shorts → policy (compressed) → write v2 + lint → critic. Supplied-text law: one line + schema §4 pointer. Deleted laws gone. |
| `.claude/skills/visual-prompt-writer/references/shots-schema.md` | 175 | ~100 | v2 contract: slimmed skeleton + field semantics + Pass-1 asset-tag fields (image-gen-owned) + supplied-text/lettering laws (unchanged home) + source taxonomy. Render-mapping table moves to render-builder's motion-schema.md. |
| `.claude/skills/visual-prompt-writer/references/critics.md` | 118 | ~70 | Charter rewritten to the surviving checks: scene logic/facts · literal-check (against the bar) · vocab-name resolution (every referenced figure/pose/expression names a registry entry or is flagged) · renderability · disclosure order · cadence taste. Hook-bar question deleted; never-flag list kept. |
| `.claude/skills/visual-prompt-writer/scripts/lint_shots.py` (+tests) | code | code | Drop from_cue/hold_reason/cast/props/needed_assets enforcement; keep verbatim+order anchors, supplied-text, lettering L1–L4, delta caps, runtime÷5 + Σ-coverage; add v2-schema field validation + unknown-legacy-field warning. Tests updated to v2 fixtures. |
| `channels/…/visual-kit/style-bible.md` | 432 | ~150 | Identity+rig (~20) · descriptors verbatim (~90 incl. surrounding one-liners) · §3 checklist as bare invariant list (~15) · palette table (~8) · seed rules as a tight list (~20: one-run multi-seed order, ≤4 cap, regen-fresh, provenance routing, style-anchor rule, map-crop, match-prop, chain exceptions) · recipe quote + lettering/stamp registers (~15) · §7/§8 collapse to build-order + the measured laws (measure-not-eyeball, magenta chroma + interior sampling, anchored-iteration diff proof, one re-authored retry) (~15) · registry pointer (~5). |
| `.claude/skills/image-generation/SKILL.md` | 299 | ~180 | Rewritten as steps: **Pass 1** (read shots.json → derive asset list from vocab names → missing-asset human gate (pre-gen approval; veto → flag VPW to restage) → character-gen rule (seed off template base, 2:3, rig-gate, register) → reuse-before-regenerate → store library + manifest → write asset tags into shots.json) → **Pass 2** (read tags → per-shot technique table (kept) → aspect rules → two-gen identity pass → layered shots) → **batched review** (kept: crop battery, forced verdicts, letter-by-letter, one re-authored retry, stamp states) → single-asset loop → report. |
| `knowledge/research/niche-playbooks/universal.md` §13a | ~90 | ~15 | Stub: each channel owns visual-grammar.md (the moved table + doctrine); _TEMPLATE gets a skeleton pointer. §13/§13a-ii/iii untouched from wave 2 except pointer updates. |
| `channels/…/dna.md` visual section | ~25 | ~8 | Pointer to visual-kit docs + the channel's imagery policy constraints (business niche: no defamatory depiction of real people; analysis-not-gore posture). |
| `.claude/skills/metadata-writer/SKILL.md` | — | small edit | Thumbnail-concept output removed; title/description/tags/chapters/pinned-comment remain. |
| `.claude/skills/shot-board/`, `compliance-check/`, `motion-planner/` | — | pointer sweep | Read v2 fields only; any reference to dropped fields updated. motion-planner unchanged functionally (stage fields survive). |

## Gates

- **GATE A (spec):** Daniel approves this spec.
- **GATE B (exemplars):** Daniel edits/approves the drafted `example-shots.md` before it is wired as
  the bar (VPW SKILL + grammar reference it provisionally until then).
- **GATE C (acceptance):** lint + all VPW/image-gen script tests green on v2 fixtures; purge/pointer
  greps; fresh-eyes comprehension probe (v2 authoring flow, the literal/non-literal bar, Pass-1→Pass-2
  tag flow, the missing-asset gate, seed rules); Daniel's read of visual-grammar.md + VPW SKILL.md.

## Constraints

- Engine/render code untouched (v2 keeps every engine-read field). lint_shots.py + its tests are the
  only code in scope; forge.py untouched (image-gen doc flow changes, not forge mechanics).
- Descriptor blockquotes byte-identical. Frontmatter descriptions updated ONLY where behavior moved
  (VPW loses thumbnail-concepts-from-metadata wording; metadata-writer loses thumbnail wording) —
  deliberate, reported diffs.
- Waves 1–2 hygiene rulings bind throughout. Branch: `claude/fyt-stack-trims`. Explicit-path staging;
  the r2 writer terminal owns writer/grammar/judge files — do not touch them.
- decisions.md + STATUS.md records at close; retired-features.md gains the deleted-laws entry
  (hook bar, delta decisiveness, anti-slop, needed_assets-in-VPW, per-video house_style distillation,
  metadata thumbnail concepts, structured cast arrays).
