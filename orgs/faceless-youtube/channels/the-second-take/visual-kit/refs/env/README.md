# Environment style anchors (`refs/env/`)

Style-anchor seeds for character-free generations (environments, plates, prop cutouts). `forge.py`
hard-errors on an unseeded `environment`/`style` gen; these anchors are the default seed when no
better one exists (the target plate or the prior frame in a chain always beats a generic anchor).
Paths under `refs/env/` are exempt from `_is_char_seed`, so seeding them never triggers the §2c
rig-hold and can never bleed a figure into an empty scene.

Pick the anchor whose REGISTER matches the shot — the anchor pins line weight, outline color
(`#241a12`), flat-cel render, and palette discipline, not the content:

| Anchor | Register | Provenance |
| --- | --- | --- |
| `env-exterior-vivid.png` | bright/saturated exteriors, fantasy/prosperity beats | Poyais L05 (human-gated render, 2026-07-15) |
| `env-exterior-muted.png` | desaturated/grim exteriors, aftermath/reality beats | Poyais L22 (human-gated render, 2026-07-15) |
| `env-interior-warm.png` | **built warm INTERIORS** — dens, panelled rooms, lamp-lit plant floors | Minted 2026-07-29 for the bricks slice, seeded off `env-exterior-vivid`. The register set had no interior anchor at all, so 26 of that video's 42 shots had no matching anchor and the seed law's "approved on-style scene" fallback did not exist on disk |
| `env-interior-cool.png` | **built cool/industrial INTERIORS** — warehouses, strongrooms, packing stations, grey offices | Minted 2026-07-29, seeded off `env-exterior-muted`. Mirrors the vivid/muted exterior split on the same warm/cool axis |
| `env-map-parchment.png` | maps, documents, aged-paper devices | Poyais L15 plate (verified + human-gated, 2026-07-15) |
| `lettering-marker-italic.png` | ADDED to any text-bearing gen — the locked channel lettering (style-bible §5) | 6-candidate audition, human-picked "relaxed marker italic" (2026-07-15) |
| `stamp-block-outlined.png` | big stamp-down marks (FAKE / FICTION / SOLD) — the locked STAMP register (style-bible §5) | 2-round human audition, picked B1-weight + B2-outline combo (2026-07-15) |

Missing archetypes (night, urban) get added the first time a video needs one: generate
seeded off the closest existing anchor, human-gate it, land it here with a row above.
(**interior** was the gap the bricks slice hit and closed — see the two `env-interior-*` rows.)

## Recurring PROP canonicals also live here

Character-free recurring objects registered with `kind: "prop"`. They are NOT style anchors — do not
reach for them to pin a scene's look; seed them when the shot contains that object, so its design
MATCHES across shots (the match-prop law). They sit under `refs/env/` because `_is_char_seed()`
excludes both this directory and the `prop-` filename prefix, so seeding one can never trigger the
§2c rig-hold and can never bleed a figure into a frame.

| Prop | What it is | Provenance |
| --- | --- | --- |
| `prop-beige-pc.png` | An ORDINARY, deliberately **unpersonified** 1980s beige boxy home computer + attached keyboard | Minted 2026-07-29 (bricks). Also the design source `pc-boxy` (the personified, faced machine) was seeded from, so the two read as the same machine |
| `prop-drive.png` | A period hard-disk drive as a **closed, finished** steel-grey unit | Minted 2026-07-29 (bricks). Closed deliberately: the recurring form is the finished unit on a belt/in a crate, so an opened hero shot seeds THIS and authors the lifted cover, never the reverse |
