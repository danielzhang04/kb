# Crowd-variety analysis — uniform cream/bald vs varied hair/outfits

Written for Daniel's question on the probe-fix pass (2026-08-05): is the crowd rig meant to be
uniform cream/bald, or varied hair/outfits — and what's the difficulty trade-off? $0, research only,
no generation. Sources: `visual-kit/style-bible.md` §1/§2d/§3/§5, `visual-kit/refs/base/crowd-exemplar.png`,
this video's `scratchpad/vpw-log.md` + `vpw-log-fresh.md`, `scratchpad/audit-drift-2026-08-04.md`,
`scratchpad/doctrine-analysis.md`, and this session's own L35 probe generations (`_staging/L35.png`,
`_staging/L35-retry1.png`).

## (a) What §2d currently demands

`style-bible.md` §2d locks the crowd rig on **face/head simplification and proportion only**:

> round cream-family heads, DOT EYES, one simple consistent mouth (neutral / smile / downturn only),
> NO noses, NO ears, NO teeth, the EXACT same squat head-to-body proportion as the base rig ... hands,
> where visible, are the same four-digit cartoon hand.

Then, in the same clause, it explicitly **forbids** locking clothing to the seed:

> The seed reference contributes ONLY this head/face/hand simplification, NEVER its own clothing:
> dress every crowd figure for THIS shot's own scene era and setting, not the seed's period dress.

So current doctrine is already **not** "uniform cream/bald": outfit varies by design (every shot's
crowd wears that shot's own era/setting clothing). §2d is silent on **hair** specifically — it locks
head *tone* to "cream-family" and the face to the simplified set, but never says "bald" or "varied
hair." `refs/base/crowd-exemplar.png` itself — the seed every crowd gen carries — depicts five
visibly different figures (one bald, one in a headscarf, one in a top hat, one in a bonnet, one in a
cap), i.e. the exemplar's own reference image teaches variety in silhouette/headwear, not a single
repeated look.

## (b) What past rounds actually authored

`vpw-log.md` (this video) shows "varied hair" as an established, repeated authoring pattern, not a
one-off: at least 11 separate crowd-tier notes across multiple rounds explicitly declare "varied-haired
crowd" (L08, L17–L18, L63, L66–L68/L73/L80–L82/L93/L100–L101, L108–L109/L161–L162, etc.), and one note
states the convention outright: *"Crowd figures in all three crowd-tier repairs explicitly carry
varied hair; none is authored as uniformly bald."* So variety has been the channel's actual practice
for as long as this video's log runs, not something newly proposed.

Searching the audit/critic trail (`audit-drift-2026-08-04.md`, `doctrine-analysis.md`) for a crowd
*variety*-caused defect turned up **none**. The crowd-related defect that IS heavily documented is a
different mechanism entirely: **seed-cost economics**. `doctrine-analysis.md`'s stats show the
"named cast + crowd" shape is the single most lethal authoring combination on this board — 14 of 15
shots in that shape condemned (93%) — because `seed_cost = 3×cast + anon + crowd + 1` blows the
4-seed cap the moment a named character shares a frame with a crowd, forcing a seed to drop and
degrading rig fidelity. That is a budget/authoring problem, not a hair/outfit-variety problem — it
fires identically whether the crowd is bald or varied. No prior round logged an identity-bleed or
review-load complaint tied specifically to crowd hair/outfit variety.

## (c) What this session's own probe adds

This probe's own L35 (crowd-only, no named cast, so outside the lethal shape above) still failed twice
independently of variety: the first pass cropped a loader's head at the frame edge (Daniel's ruling),
and the retry — after fixing the crop and re-asserting the squat-proportion clause — still rendered a
visible **nose** on every crowd figure, a direct §2d invariant violation the auto-appended clause
already states in plain words ("NO noses"). Proportion also only partially corrected: closer to the
squat exemplar than the first pass, but still more elongated/adult than the exemplar's own ratio.

This is the load-bearing fact for the recommendation: **the crowd rig is already failing to hold its
existing, LIMITED simplification (face shape, no nose) at CURRENT variety levels**, in a shot with no
named cast competing for seed budget. Any move toward MORE per-figure distinctiveness (a different
invented hairstyle or outfit detail per individual crowd member, rather than the shot-level "dress
for this scene" instruction §2d already gives) adds more free variables for the provider to improvise
on, which is the same failure mode already observed, not a new one.

## Risk read, each way

- **Uniform (revert to cream/bald-only):** cheapest to hold — one fewer axis (hair) for the provider
  to invent per figure, closest to the literal minimum §2d states. Costs: reads as a "cloned mannequin"
  background, works against §5's "rich, not sparse ... edge-to-edge" recipe, and risks visual confusion
  with the base template itself (`refs/base/base.png` is also bald/cream and "never appears in
  videos" — an all-bald crowd edges toward looking like stray copies of the template, not a populated
  scene). Also a real regression against 2+ months of established practice with no defect history
  pointing at it as the cause of anything.
- **Varied (current practice, uncapped):** richer, matches the channel's actual authored history and
  §5's density mandate, and the crowd-exemplar seed already teaches it. Costs: more provider-side
  invented detail per figure is more surface for drift (this session's nose leak is exactly that,
  independent of the crowd/cast seed-cap issue in (b)); a crowd figure drawn with enough individual
  distinction (a memorable hat, a strong hair color) risks reading as a candidate for a returning named
  character — identity-bleed in the other direction from what the doctrine usually guards against; and
  it raises review load, since a "same channel, ordinary viewing scale" pass must now eyeball several
  visually distinct small figures per crowd shot instead of one repeating silhouette.

## Recommendation

Keep variety — reverting to uniform bald/cream would be a real regression against established, working
practice with no defect evidence behind the change, and would fight the channel's own richness recipe.
But **bound it explicitly instead of leaving it open-ended**, and use the freed clause space to
re-state the face invariant harder, since that is what actually broke this session:

1. **Cap the silhouette count, don't cap variety to zero.** Add one sentence to §2d: vary hair/headwear
   across at most 2–3 repeating silhouettes per crowd group (e.g. one bald head, one simple hairstyle,
   one simple cap/hat) — never invent a distinct hairstyle or outfit accessory per individual figure
   beyond that small set. This keeps the "populated, not cloned" read while giving the provider a
   closed set to repeat instead of an open invitation to individuate, which is what pushes a crowd
   figure toward identity-bleed and adds per-figure invented risk.
2. **Make the face-simplification imperative explicit for MULTI-figure group shots specifically**,
   since that's exactly where it broke here (a 5-loader group shot, zero named cast, still leaked a
   nose onto every figure): add a clause such as *"In a multi-figure crowd shot, apply the identical
   simplified face — dot eyes, one simple mouth, no nose, no ears — to EVERY visible figure without
   exception; a single detailed/individuated face anywhere in the group is a rig FAIL,"* to close the
   gap between "the rule is stated once" and "the rule is actually checked per-figure in a group."

Both are §2d wording changes only (a LOCKED value edit, human-approved, boss-routed) — no generation
required to validate the reasoning, and both are aimed at the two things this probe actually measured:
the established variety practice with no defect history behind it, and the specific face-invariant
leak this session reproduced.
