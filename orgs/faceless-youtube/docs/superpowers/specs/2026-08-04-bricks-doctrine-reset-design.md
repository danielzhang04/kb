# Bricks doctrine reset + fresh gated run — design (2026-08-04)

Daniel-approved design closing the B4/B5 drift wave. Root-cause source:
`videos/2026-07-28-bricks-fresh/scratchpad/audit-drift-2026-08-04.md` (5 mechanisms, all of
Daniel's nine failures pinned). Era analysis: style/place anchor conflation — the probe-refuted
*style* anchors (`f4ca9b5`, decisions.md 2026-08-04) were removed together with *place* anchors,
whose content bleed is the desired set-holding behavior. Prior shot work is quarantined; the
video regenerates fresh under the corrected doctrine.

## Keep / revert verdicts (Daniel, 2026-08-04)

- **KEEP** hardened flat-cel text (probe-proven), no rendered-scene style anchors any video
  (same-video L160→L100 bleed), two-tier cast law, digest pins, builder slates, retry overlays,
  three-state stamps, lint hard checks.
- **REVERT** seedless roots in established places (L89–L91 mechanism), the style contradiction
  ("gentle soft cel shading" vs "NO gradients"), and bulk-substitution repair authoring
  (B3's wholesale generic→named conversion caused L100–L101).

## 1. Doctrine changes ($0, land before any generation)

### Style — one voice, text-only
- `style-bible.md` §2b/§2c/§5: delete "gentle soft cel shading" and all soft/gradient-permissive
  wording; one positive recipe — flat base fill + at most one hard-edged single-step shadow per
  surface, even medium-thick #241a12 outlines, committed scene palette — stated once, cited
  everywhere else.
- `forge.py`: the scene descriptor derives from the bible's unified recipe; `HARDENED_SCENE_STYLE`
  may remain only as reinforcement of the *same* words (no second voice).
- VPW: `global_prompt_suffix` inherits the recipe; `lint_shots.py` hard-fails prompts/suffix
  carrying style vocabulary contradicting the bible.

### Place — pixels-only, per video
- `forge.py` seed law: zero-seed legal **only** for a new place-first *plate*; every scene in an
  established place seeds that place's plate or an in-place approved frame. Cross-video env
  rejection stays.
- VPW SKILL: place-first plate law — enumerate the script's places, one plate per place, owner
  branding (e.g. `'MINISCRIBE'`) authored on the plate once and inherited by its chain under L-1.
- Place-owner lint: institution-owned interiors must carry the owner cue on their plate or record
  intentional ambiguity.

### Authoring feasibility (lint, hard)
- **Seat/support**: named `sit`/seated ⇒ named support object + contact + framing establishes it.
- **Two-cast plane/scale**: named figures sharing furniture/depth ⇒ each figure's plane, eye line,
  relative head scale stated; "dominant" resolves to posture/framing, never anatomical size.
- **Action-chain**: consecutive VO actions on "same" props ⇒ stage base/delta plan or explicit
  hard cut; critic judges cause→effect, not noun presence.
- **Semantic cast**: a named character may appear only where script/research establishes that
  identity; generic narrated groups stay crowd-rigged.

### Process law (VPW SKILL)
- Repair rounds re-author each shot from its VO line; bulk vocabulary substitution across shots is
  banned.

### Forge gates
- **Verified-asset reuse**: a staged STEP-1 is seedable only with a per-invariant review record
  pinned to its canonical/expression SHA; file existence or a genlog PASS is insufficient.
- **Parent provenance/depth**: manifest records scene-parent depth + longest canonical lineage;
  a child refuses a parent carrying any parked rig/style/topology defect; propagated failure
  forces a re-base.
- **Expression-delta**: a delta authoring a changed expression must supply the expression
  primitive or a verified combined STEP-1, else refuse (L75 mechanism).

### Review operationalization (`stamp_review.py` + review artifact)
- Structured forced per-invariant verdicts; aggregate "rig holds" sentences structurally
  impossible.
- New forced axes: support/contact, relative scale, semantic cast, place owner, flat-cel hazards
  (face gradients, specular bands, gloss, atmospheric blur), crowd scale/lead visibility.
- Review artifact embeds canonical-vs-candidate side-by-side crops per named figure (existing
  crop scripts).

Every code change lands TDD in the owning skill's test files; skill docs edited per
`.claude/skills/README.md` design rules; decision logged in `knowledge/decisions.md`.

## 2. Quarantine

All bricks-fresh generated content — `assets/scenes/`, `assets/_review/`, video-local `_staging`
figures, thumbs, old boards, old `shots.json` — moves to
`videos/2026-07-28-bricks-fresh/_archive-pre-reset/` as evidence. Scene manifest reset. Kept
live: `script.md`, `vo.mp3` + voiceover manifest, `research.md`, channel-level canonical refs.
Fresh VPW authors from `script.md` alone. Downstream `shots.motion.json`/audio plan are archived
with the rest and replanned after visuals settle.

## 3. Style probe (~$0.30, human gate)

One place plate + one reminted STEP-1 + one character scene composed from both, under the unified
descriptor. Daniel rules flat/not-flat before any slice fires. Remaining STEP-1 remints happen
inside the slice that needs them, under the proven descriptor.

## 4. Run plan

- VPW authors the **complete** `shots.json` once (whole-script view: place inventory, cast map,
  stage chains, retention cadence), doctrine-compliant, lint + forge dry-run clean.
- Generation runs in **fifths**: gen lanes → fresh-eyes per-invariant review → board →
  **Daniel's verdict gates the next fifth**. Spend law per lane: plan-gate table first
  (operating-law §D), first-429 fail-fast, one precision retry, 4-min stall + one re-issue,
  per-lane genlogs.
- Budget pacing: deliberately deferred (Daniel). Rough shape: ~$30–40 all-in, ~$7–8/fifth.

## Execution routing (this wave)

Claude subagents in the boss session (Daniel 2026-08-04, supersedes codex-only for this wave):
haiku mechanical, sonnet standard build, opus for review-gate code and adversarial review. Model
of every subagent verified at grading via transcript grep. Work branch
`claude/bricks-doctrine-reset` in worktree `kb-worktrees/boss-bricks-reset`; boss does git
plumbing and grading.

## Out of scope

Whole-video style rerender decisions beyond the fresh run; motion/audio replanning; budget cap
changes; the >L101 deferred-slice and tranche-E word-sync items from the superseded middle-path
queue (subsumed by the fresh authoring).
