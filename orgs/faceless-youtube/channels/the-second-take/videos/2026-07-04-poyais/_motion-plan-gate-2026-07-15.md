# Motion-plan human gate — Poyais, simplification re-plan (2026-07-15)

**What ran:** the `motion-planner` skill, re-authored under the rewritten doctrine (engine device-cards +
engine-drawn text ABOLISHED; all in-video text now baked diegetic; cutout-only menu; re-base rule).
**Result:** `shots.motion.json` is **lint-clean — 0 errors** (`lint_motion_plan.py` with `shots.json`),
down from 15. No `source:"engine"` layers and no `background.subtract` fields remain. 118 shots.
**Backup:** `shots.motion.pre-simplification-2026-07-15.json`.

## Re-expression tally (the 12 retired engine cards)

| Choice | Count | Shots |
| --- | --- | --- |
| **Baked diegetic text** | 11 | L12, L19, L39, L47, L48, L52, L54, L58, L65, L75, L84 |
| **Dropped (beat reads without it)** | 1 | L03 (the "POYAIS" title — map + VO carry it) |
| New delta-chain | 0 | — |
| New cutout layer | 0 | — |

Of the 11 baked-text, **7 already bake the text in their `still_prompt`** (L39/L47/L48/L52/L54/L58/L65 →
no further work). **4 need a diegetic home** (L12/L19/L75/L84 → see the shot-edits file). Fresh-eyes critic
confirmed these 4 and confirmed no other card-removed shot was left with an orphaned payload.

## Changed shots — what it had → what it has now → why

| Shot | Had | Now | Why |
| --- | --- | --- | --- |
| **L03** | ship `path` cutout **+ `title` chapter-card (engine)** | ship `path` cutout only | Engine title retired. Title dropped (map + VO "a country called Poyais" carry the beat; the card never rendered anyway). Ship cutout + `plates/L15.png` plate untouched (chunk-1 approved). |
| **L12** | blank-slate plate + `subtract` + `pivot` chapter-card (engine) | plain passthrough `scenes/L12.png` | Engine pivot retired; `subtract` removed. **Approved scene is a blank blackboard — regen flagged** (its own `still_prompt` bakes a `?`). |
| **L19** | scene + `subtract` + `acres` stat-card "8,000,000 ACRES" (engine) | plain passthrough `scenes/L19.png` | Engine card retired. **Payload hole — `still_prompt` bakes no number; edit + regen flagged.** |
| **L24** | delta-chain passthrough → `scenes/L22.png` (cross-stage) | plain plate → **its own `scenes/L24.png`** | Fixed the 2 lineage lint errors from the stale `empty-swamp`/`swamp-con` split. Reconciles to the already-fixed one-swamp chain (chunk-1 seeded `scenes/L24.png` exists). Render unchanged (layer-less shots resolve by shot-id regardless). |
| **L39** | scene + `subtract` + counter→20,000 (engine) | plain passthrough `scenes/L39.png` | Engine counter retired; `still_prompt` already bakes the "20,000" banner. |
| **L47** | scene + `subtract` + reveal London/Edinburgh/Paris (engine) | plain passthrough `scenes/L47.png` | Engine reveal retired; `still_prompt` already bakes legible "POYAIS OFFICE" signs. (Optional: add city labels — shot-edits file.) |
| **L48** | scene + `subtract` + stat-card "2 shillings/acre" (engine) | plain passthrough `scenes/L48.png` | Engine card retired; `still_prompt` already bakes "2 SHILLINGS / ACRE". |
| **L52** | scene + `subtract` + counter→500 (engine) | plain passthrough `scenes/L52.png` | Engine counter retired; `still_prompt` already bakes the "500" tally. |
| **L54** | scene + `subtract` + counter→70 (engine) | plain passthrough `scenes/L54.png` | Engine counter retired; `still_prompt` already bakes "~70". |
| **L58** | scene + `subtract` + counter→200 (engine) | plain passthrough `scenes/L58.png` | Engine counter retired; `still_prompt` already bakes "~200". |
| **L65** | scene + `subtract` + stat-card "£200,000" (engine) | plain passthrough `scenes/L65.png` | Engine card retired; `still_prompt` already bakes "£200,000". |
| **L75** | scene + `subtract` + reveal Colombia/Peru/Chile (engine) | plain passthrough `scenes/L75.png` | Engine reveal retired. **Payload hole — `still_prompt` says "NO baked country-name text"; edit flagged.** |
| **L84** | scene + `subtract` + stat-card "$0" (engine) | plain passthrough `scenes/L84.png` | Engine card retired. **Payload hole — `still_prompt` says "NO price tag"; edit flagged.** |

L17 (the `reuse`-cutout lint false-positive) was fixed in **`lint_motion_plan.py`** (reuse layers exempt
from the `cutout_prompt` requirement) + a test — no plan change; its assets stay valid.

## Retained (unchanged) — cutout layers reviewed and kept

All conform to the cutout-only menu (slide/path/appear/bob) and are seedable; critic checks 1 (no plate
leak) and 2 (menu/source) came back clean:
L13 (MacGregor slide) · L15 (MacGregor path + route line) · L16 (MacGregor appear) · L17 (MacGregor reuse +
Bolívar slide) · L23 (three debunk icons) · L25 (thought bubble) · L36 (book bob) · L42 (five stars) ·
L43 / L44 (FICTION stamp) · L57 (second ship) · L59 (arrow) · L60 (glow) · L62 (MacGregor + dollars) ·
L68 (SOLD slam) · L78 (bubble) · L79 (fine-print) · L80 (MacGregor shrug) · L91 (king slide) ·
L107 (officer + anger-mark) · L112 (two stagecoach paths + route lines).
~104 shots are baked passthroughs.

## Proposed `shots.json` edits (human decides; VPW applies)

Full detail in **`_motion-replan-shot-edits-2026-07-15.md`**. Summary:
- **Required (payload holes):** L19 (bake "8,000,000 ACRES" + regen), L75 (bake COLOMBIA/PERU/CHILE labels),
  L84 (bake "£0"/"WORTHLESS" tag).
- **Regen only:** L12 (regen from its own `still_prompt` to bake the `?` — no text edit).
- **Optional:** L24 (reconcile `stage` fields to the one-swamp chain), L47 (add city labels).

## Chunk-1 regen risk (prominent)

Two **already-approved chunk-1 assets** lose an on-screen payload under the new doctrine and would need a
**regen** to restore it diegetically:
- **L12** — approved scene is a blank blackboard (the pivot text/`?` is gone).
- **L19** — approved scene shows no "8 million acres" number (VO still says it).

Both were *already* rendering without these payloads in the approved chunk-1 MP4 (the current `build_motion`
silently drops `source:"engine"` layers, so the cards never appeared). Dropping them here changes **nothing**
in what shipped — it only makes the plan honest. Restoring the payloads is a deliberate regen choice, flagged
here rather than silently planned.

## Gate ask

Approve the lint-clean plan as the production spec, and pick which proposed `shots.json` edits + regens to
apply before image-gen resumes (chunk 2 onward).
