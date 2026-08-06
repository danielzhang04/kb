---
id: eng-fold-motion
project: faceless-youtube
action: draft:engagement-motion-delta
target: orgs/faceless-youtube/docs/deltas
risk-tier: T2
profile: scanner
owner: dashboard-engine
state: blocked
execution-controller: dashboard
---

## Work order

Author a doctrine-delta document at `orgs/faceless-youtube/docs/deltas/2026-07-22-motion-doctrine.md`.
You write exactly ONE new file and change nothing else. The delta document proposes exact text changes
for a human integrator to apply on a review branch — you are drafting the change, not applying it.

Context: the channel's first released long-form video was measured against its reference channels
(2026-07-21 engagement measurement). The verdict on the motion axis: **90.6% of our runtime sits on a
completely frozen frame vs 6.4–25.4% for the reference channels (a 3.6–14x gap — the single largest
engagement gap). Frozen stretches of 3s+ occur 9.8/min for us vs 0.34–1.05/min for them. Hard cuts are
11.2/min for us vs 7.3–15.4 for them — ALREADY IN BAND, do not add cut-density rules. The references get
their alive feel from within-shot motion: elements entering frame, slow push-ins and drift on stills,
charts populating live timed to the spoken word.** The channel owner has ruled: the 2026-07-10
"fully-locked look" directive (camera is furniture, frames hold dead-still, idle float zeroed) is now
reversed with better information. Craft research adds: slow subtle motion on ~80–100% of stills; hold
lengths deliberately varied (mix ~3s reveals with 10–12s breathing holds); a burst of 4–6 quick cuts
every 2–3 minutes at an emphasis beat, then return to calm; texture varies BY BEAT TYPE — motion density
rises on absurdity beats, and human-cost beats KEEP the static frame + quiet treatment (the references
measurably do the same; that lock survives).

Read for context (this repo): `orgs/faceless-youtube/knowledge/research/niche-playbooks/universal.md`
section 13a (the motion grammar — this is your primary edit target) and
`orgs/faceless-youtube/.claude/skills/motion-planner/SKILL.md` (how motion is authored per shot).

Baseline note (authoritative, embedded because newer branches are not visible here): the channel's
`channels/the-second-take/visual-kit/motion-tokens.json` currently carries:
- an `idle` block: `bob_px: 0, period_s: 2.4, breathe_scale: 0` with a note that the float is OFF by
  the 2026-07-10 directive and that restoring `5 / 0.005` brings it back;
- a `camera` block whose note says the camera is ALWAYS LOCKED and no move is derived, with dormant
  dials `push_scale 0.14, pull_from 1.18, whip_frames 13, pan_frac 0.06`.

Your delta document must contain, in order:
1. A short statement of the measured problem (cite the numbers above).
2. For `universal.md` section 13a: each proposed change as a block — the existing passage being
   replaced (quote enough to locate it unambiguously), the full replacement text verbatim, and a
   one-line rationale tied to a number above. Cover: the within-shot-life default (slow push/drift on
   most stills), live element/chart population timed to the spoken word, varied hold lengths, the
   periodic quick-cut burst, beat-typed texture with the human-cost exception, and the explicit
   reversal of the dead-still default.
3. For `motion-tokens.json`: the exact proposed new token values (idle float restored; which camera
   dials become live and their proposed values) with rationale.
4. For the motion-planner skill: a short list of authoring-rule changes (what the planner must now do
   per shot) written as replacement-ready prose.
5. A "what does NOT change" section: cut-density stays as-is; human-cost beats stay static and quiet;
   the channel's locked register and the hard-cut grammar remain.

Write in the repo's existing doctrine voice: dense, imperative, measured-fact-cited. Do not touch any
existing file. If any needed context file is unreadable, say so in the delta document and finish with
what you have.
