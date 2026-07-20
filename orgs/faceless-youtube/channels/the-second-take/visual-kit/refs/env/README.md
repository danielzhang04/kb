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
| `env-map-parchment.png` | maps, documents, aged-paper devices | Poyais L15 plate (verified + human-gated, 2026-07-15) |
| `lettering-marker-italic.png` | ADDED to any text-bearing gen — the locked channel lettering (style-bible §6) | 6-candidate audition, human-picked "relaxed marker italic" (2026-07-15) |
| `stamp-block-outlined.png` | big stamp-down marks (FAKE / FICTION / SOLD) — the locked STAMP register (style-bible §6) | 2-round human audition, picked B1-weight + B2-outline combo (2026-07-15) |

Missing archetypes (interior, night, urban) get added the first time a video needs one: generate
seeded off the closest existing anchor, human-gate it, land it here with a row above.
