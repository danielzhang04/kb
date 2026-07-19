# Poyais — shots.json edits proposed by the motion re-plan (2026-07-15)

These are edits to **`shots.json`** (VPW territory) that the motion re-plan surfaced but did **not** make.
The motion plan (`shots.motion.json`) is already lint-clean (0 errors) without them; these restore the
**text payloads** that the retired engine device-cards used to supply, now that all in-video text must be
**baked diegetic** into the still. The human decides at the gate; VPW applies the approved ones, then
image-gen (re)generates the affected scenes.

Cause: under the old doctrine these shots' `still_prompt`s **subtracted** their number/label and let an
engine card draw it. Engine cards are gone, so the payload has no diegetic home unless the `still_prompt`
bakes it. (The other 7 card-removed shots — L39/L47/L48/L52/L54/L58/L65 — already bake their text in the
`still_prompt`, so they need no edit.)

## Required — text-payload holes (VPW `still_prompt` edit + regen)

| Shot | Generated yet? | Current `still_prompt` state | Proposed edit |
| --- | --- | --- | --- |
| **L19** | YES (chunk 1, approved) | Bakes NO number — ends "A whole country for a bottle and some trinkets"; the `notes` claim a "diegetic banner" the prompt never authors. Approved `scenes/L19.png` shows no number. | Add a legible diegetic marker — a banner/label glued to the land or the rolled deed reading **`8,000,000 ACRES`** (or `8 MILLION ACRES`). **Requires a regen of `scenes/L19.png`.** |
| **L75** | no (chunk 5) | `still_prompt` explicitly says "WITHOUT any name label … **NO baked country-name text** (the reveal supplies it)". | Replace that clause: bake **`COLOMBIA` / `PERU` / `CHILE`** as marker labels on the three highlighted regions. Pre-gen edit (no regen — not yet generated). |
| **L84** | no (chunk 5) | `still_prompt` says the bond "read complete and natural with **NO price tag or marker text** … (the value card pops on)". | Replace that clause: bake a diegetic marker tag on the fallen bond reading **`£0`** or **`WORTHLESS`**. (This is a money/value figure, not a human-cost count, so a legible figure is on-grammar even in the grim register.) Pre-gen edit. |

## Regen only — no `still_prompt` edit needed

| Shot | Generated yet? | Issue | Action |
| --- | --- | --- | --- |
| **L12** | YES (chunk 1, approved) | Approved `scenes/L12.png` is a **blank blackboard** — the old motion-plan `subtract` stripped the hand-lettered `?` its own `still_prompt` authors, and the "So what happened?" pivot card is gone. Asset ≠ prompt. | **Regen `scenes/L12.png` from the untouched `still_prompt`** (bakes the `?`). No VPW text edit needed. Optionally the `still_prompt` could bake the words "So what happened?" if a legible pivot line is wanted over the `?`. |

## Optional — doc hygiene / nice-to-have

| Shot | Suggestion | Why optional |
| --- | --- | --- |
| **L24** | Reconcile the `shots.json` `stage` fields: L24 is `swamp-con` while L22 is `empty-swamp`, but chunk-1 fixed them into **one chained swamp** (L22→L24→L26). Set L24 (and L26) to L22's stage, or unify all three under one `swamp` stage. | The motion plan already sidesteps the stale split (L24 now references its own `scenes/L24.png`), so lint passes without this. It is doc-truth cleanup so a future re-lint/re-plan reflects the real one-swamp chain. |
| **L47** | Optionally bake city-name labels **London / Edinburgh / Paris** beside the office pins. | The `still_prompt` already bakes legible `POYAIS OFFICE` signs on a Europe map, which carries the "offices across Europe" beat; the city names were card reinforcement. Not yet generated. |

## Not an edit — flagged for the record

- **L03 plate reference** (`plates/L15.png`, the campaign-map chart, not the Atlantic crossing chart): the
  critic flagged this as wrong geography, but it is the **already human-accepted chunk-1 deviation** — see
  `docs/handoffs/2026-07-15-poyais-chunk1-pass2-pickup.md` §4 ("the map is L15's aged-parchment chart … the
  hero ship sails past decorative ships. User: 'I don't care, this is great.' Left deliberately."). Left as-is
  (changing it would invalidate an approved chunk-1 asset and force a regen).
- **Invented-cutout seed anchors** (stamps, arrow, glow, stars, icons, bubble, etc.): these route through the
  known chunk-1 forge gap (`mode=environment` cites a seed that doesn't exist; `refs/env/` unpopulated). That
  bites at image-gen materialization, not in this plan — fix `refs/env/` before spending chunk-2+ gens.
