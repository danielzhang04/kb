# Pipeline code archaeology: Poyais vs Bricks-liked vs now

**Scope and method.** Read-only Git review. Poyais predates the KB import, so its source is the archived repository at `C:/Users/danie/faceless-youtube.git-archive`; Bricks-liked is `30d2b7e8` (2026-08-04); now is KB `HEAD` (`5b649837`, with the last relevant source changes below). I used the last commit on each path reachable at that era, not the current dirty worktree. `visual-kit/example-shots.md` did **not** exist in any era; the post-Poyais file is instead `channels/the-second-take/example-shots.md` (59 lines at now, last changed `f8aa5e52`).

## Verdict first

The current pipeline has two direct regressions that explain the morning verdict:

1. **Crowd pressure:** Poyais had three visual-human tiers, including an unseeded full-rig anonymous foreground actor. Bricks/now forbid that tier: a story-bearing anonymous person must become expensive named cast or be restaged as mass action/crowd. That turns many ordinary action/reaction beats into crowds.
2. **No-op chain pressure:** Bricks introduced delta machinery; now explicitly makes a chain the default whenever consecutive beats share a set. The validator still treats an empty `changed_elements` list as a *soft* warning and never verifies a visible delta. This is exactly the incentive structure for no-op chains.

Colour is a smaller but real divergence: current global policy forces warm-tinted neutrals and a warm-biased tail, while Poyais permitted scene palettes to be grey, teal, green, etc. It is not a model/size regression: both Poyais and now are effectively 1K, while the Bricks-liked code temporarily defaulted to 2K.

## Era pins

| Surface | Poyais-final pin | Bricks-liked pin | Now pin |
| --- | --- | --- | --- |
| image-generation SKILL | `478ac04` (2026-07-16) | `30d2b7e8` | `f8aa5e52` (2026-08-19) |
| `forge.py` | `cd2e29c` (2026-07-16) | `dc61405a` | `f8aa5e52` |
| review artifact / crop battery | `879837f` / `cd15c44` | `5693318b` / `dc61405a` | `f8aa5e52` / `dc61405a` |
| `stamp_review.py` / thumbnail finalizer | absent / absent | `dc61405a` / `d85b9f8a` | `46076bff` / `d85b9f8a` |
| VPW SKILL / critics / schema | `d6802fc` / `371fe1c` / `3ebed13` | `30d2b7e8` / `5b1a9b76` / `30d2b7e8` | `f8aa5e52` / `f8aa5e52` / `abd3ed95` |
| `lint_shots.py` | `89bf511` (2026-07-13) | `30d2b7e8` | `f8aa5e52` |
| visual grammar / style bible | `a1ba31e` / `478ac04` | `b55fe0ad` / `a4bbe9ab` | `f8aa5e52` / `f8aa5e52` |

## Problems, ranked

| Rank | Behavioural delta (Poyais -> now) | Complaint fed | Evidence and verdict |
| --- | --- | --- | --- |
| 1 | **Three human tiers -> cast-or-crowd only.** Poyais allowed a prominent anonymous individual on the full rig; now says the individual "does not exist" and requires new named cast or mass action. | **Crowds** | Direct. Poyais grammar `a1ba31e:75-83` permits an anonymous large/foreground settler or clerk. Now `f8aa5e52:168-184` forbids it; `lint_shots.py f8aa5e52:1253-54` hard-fails `anon_foreground`. This moves a normal foreground actor into the crowd escape hatch whenever minting cast is disproportionate. |
| 2 | **Chain allowed for enumerations -> chain is the default on a shared set.** | **No-op deltas** | Direct. Now grammar `f8aa5e52:72-82` says “the CHAIN is the default”; Poyais only offered a chain for enumerations (`a1ba31e:173-75`). Current lint `f8aa5e52:325-27` merely *soft*-warns when a delta has no `changed_elements`, and neither era performs a pixel/semantic-difference check. The new default amplifies that inherited gap. |
| 3 | **Scene palette free -> global warm correction.** | **Coloration** | Direct plausible mechanism. Poyais bible `478ac04:264-67`: “a warzone is grey, a bank is teal, a park is green.” Now bible `f8aa5e52:53-57` injects “any grey or neutral clearly TINTED WARM”; current tail says “warm-biased scene palette” (`f8aa5e52` grammar `15`). This overrides local hue/temperature choices after the payload. |
| 4 | **Poyais composition could use an anonymous foreground protagonist -> every story-bearing body must be a Pass-1 cast asset or a mass.** | **Crowds; other (generic staging/cost)** | Direct structural pressure, independent of rank 1's schema detail. Current VPW `f8aa5e52:95-102, 166-72` makes the choice at planning time, so the cost/approval path acts before the shot is written. Poyais made the generic foreground actor a normal prompt fact, not a library project. |
| 5 | **One-run scene composition with character + pose/expression + style anchor -> card/plate/lineage system.** | **Other (over-constrained, recipe-like images)** | Strong bloat concern; not proven as a cause of the three complaints. Poyais scene assembly was seeds then prompt (`478ac04` image SKILL `160-71, 211-20`). Now has a mandatory STEP-1 card for fresh named figures and place/lineage rules (`f8aa5e52` image SKILL `263-81`). This is a real rig-continuity fix, so retain it unless a controlled A/B shows it causes the look loss. |
| 6 | **Poyais softer generic style descriptor -> Bricks one-voice hardening -> now a two-voice tail restoration with a different colour clause.** | **Coloration; other (prompt competition)** | Bricks-liked code hard-injected “one flat base colour… NO gradient… uniform highlight-free” (`30d2b7e8 forge.py:283-89`). Now removed that block but appends a long tail after the payload (`f8aa5e52 forge.py:277-94`). The Poyais tail was likewise long, but it asked for a “locked 2-3 colour scene palette,” not “warm-biased.” Do **not** revert to Bricks hardening; its flat-fill ban is more likely to flatten colour/light than to restore Poyais. |
| 7 | **Prompt/doctrine contradiction: payload must be final, but Forge intentionally adds a style tail after it.** | **Other (payload adherence / rule drift)** | Current grammar says payload final, yet `forge.py f8aa5e52:277-94` produces `descriptor -> policies -> payload -> suffix`. The code calls this intentional because the provider weights the tail. This makes “final payload” false in the actual request and lets a global tail overrule a carefully authored beat. It is a source of confusing repairs, even though a tail also existed in Poyais data. |
| 8 | **Review/lint grew from small structural checks to a large rules engine, while its one relevant no-op check remains soft.** | **No-op deltas; other (rule bloat)** | Poyais lint was 392 lines and checked anchors, cadence, stage base/cap, and a soft cast check. Now it is 2,723 lines with 30+ semantic/routing validators; it hard-forbids the foreground tier but still soft-warns a missing delta change. This is the wrong strictness allocation for the current complaint. |

## Exact prompt assembly, defaults, anchors, and review

| Concern | Poyais-final | Bricks-liked (`30d2b7e8`) | Now |
| --- | --- | --- | --- |
| Model | Registry engine, fallback `gemini-3-pro-image` (`cd2e29c forge.py:162-68`). | Same (`dc61405a:314,333-34`). | Same (`f8aa5e52:325,363-65`). |
| Size / aspect | No `imageSize` supplied: provider default 1K; `2:3` CLI default; scenes explicitly `16:9` (`cd2e29c:220-24`; SKILL `478ac04:185-94`). | Code defaulted **2K** (`IMAGE_SIZE_DEFAULT = "2K"`, `dc61405a:45-55`), with 1K for several generated cards/plates. Aspect policy unchanged. | Default restored to **1K** (`f8aa5e52:49-66`); aspect policy unchanged. This aligns with Poyais, not with the Bricks-liked code. |
| Assembly order | `descriptor + delta + optional rig-hold`; the Poyais `still_prompt` itself ended in the global suffix (`cd2e29c:185-94`; image SKILL `478ac04:211-20`). | `descriptor -> crowd policy -> rig hold -> payload` (`dc61405a:269-75,351-63`) plus `HARDENED_SCENE_STYLE` for scenes. The bricks `shots.json` at the requested commit still carried a full old-style suffix in the prompt data, despite the contemporaneous grammar saying lettering-only. | `descriptor -> crowd policy -> rig hold -> generated policy -> payload -> suffix` (`f8aa5e52:277-94`). This is the actual provider order. |
| Exact suffix/tail | Poyais `shots.json` tail: “**Clean flat 2.5D vector cartoon … built-but-flat environment (flat gradient sky/ground + minimal geometry + one foreground depth prop) … locked 2-3 colour scene palette …; 16:9.**” | Bricks `shots.json` at `30d2b7e8`: “**clean flat cel-shaded cartoon style, an even medium-thick dark warm brown-black #241a12 outline on everything, flat colours with gentle soft cel shading, rounded friendly shapes, no realistic detail, hand-lettered marker capitals for any in-world text**.” Grammar wanted only “**hand-lettered marker capitals for any in-world text**” (`b55fe0ad grammar:12-23`): data/doctrine were already out of sync. | Current exact tail (`f8aa5e52 grammar:15`): “**Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm brown-black (#241a12) outline on everything, flat cel colours with gentle soft shading, rounded friendly shapes, no realistic detail; any in-world lettering hand-lettered in the marker style, short and legible; warm-biased scene palette plus the single red accent #d7402b used only semantically (alarm / prohibition / ownership / the last punch element); no photorealism, no on-screen narrator or host face, no unrequested text, no logos; 16:9.**” |
| Reference/anchor wiring | Every scene/plate required a style anchor after character/pose/expression frames; crowd scenes also seeded a crowd exemplar (`478ac04` image SKILL `160-83`). | Added preflight seed law, Pass-1 figure cards, video-local plates, provenance, and batch/retry construction (`dc61405a:365-80`). | Keeps those gates; cast-free scenes get a style tile, placed scenes get a same-place plate/parent, and cross-place anchors are refused (`f8aa5e52` image SKILL `137`; bible `174-77`). |
| Retry / verification | One fresh re-authored retry after one batched, three-axis review; crop battery was mandatory evidence for rig calls (`478ac04` image SKILL `358-435`). | Adds review artifact, persistent structured verdicts, then `stamp_review.py`; retries are surgical overlays. | Keeps/extends that: only coordinator stamps `verified|parked|unreviewed`, and render ships only verified scenes (`f8aa5e52` image SKILL `449-58`). This is worth keeping. |
| Review axes | Identity/rig; fidelity (including letter-for-letter text); style/taste (palette/depth/register) (`478ac04` image SKILL `376-419`). | Same core axes, more machine-generated rows and seed-asset review. | Same core axes plus deterministic coverage/seed-state gate. Do not remove the honest review stamp merely to restore the image look. |

## VPW and doctrine comparison

### Depiction, camera, and crowd

| Rule | Poyais | Bricks-liked | Now |
| --- | --- | --- | --- |
| Literal vs symbolic/reaction/number-object | Non-literal default; literal only real actions/objects; number/object and personification guidance lived primarily in `universal.md` (`a1ba31e:100-08`). | Explicit table adds symbolic object, personification, number glued to referent, reaction/cutaway, and literal-reserved (`b55fe0ad grammar:30-64`). | Same table; adds person-subject performance and a non-binding `~10s` figureless-run flag (`f8aa5e52:56-70`). This is a good authoring improvement, but it conflicts with the cast-or-crowd removal of the anonymous actor. |
| Camera/vantage | Composition explicitly varied: top-down, low, extreme close-up, wide; fixed camera in render (`a1ba31e:87-108,152-60`). | Same broad choice; eye-level framing not a formal rest position. | “Eye-level frontal is the house REST position” but still tells authors to go past it (`f8aa5e52:251-67`). This is not evidence for crowd-centering. |
| Crowd guidance | Size-based: small/many/background crowd; large/foreground anonymous full-rig individual (`a1ba31e:75-83`). | Cast-or-crowd, crowd must be rear-zone and at crowd scale; no anonymous foreground (`b55fe0ad:123-42`). | Same, more prescriptive: crowd must have depth/overlap and recurring silhouettes; foreground individual must be cast or mass action (`f8aa5e52:168-203`). This is the crowd regression. |
| Chain vs standalone | Standalone composition is normal; delta-chain explicitly used for enumerations/reveals (`a1ba31e:173-75`). | Formal stage/base/delta protocol, but no “default chain” wording (`b55fe0ad:66-79`). | Adds “CHAIN is the default” for a same set (`f8aa5e52:72-88`). This is the no-op regression. |

### Palette / register

Poyais had the same high-level recipe—warm, rich environments with 2–3 colours plus semantic red—but its base style-only descriptor was permissive: “simple flat colours with gentle soft cel shading” and “palette is free” (`478ac04:88-98,264-79`). Bricks turned that into a hard flat-fill/no-gradient policy. Now restores soft shading but adds two global hue instructions not present in Poyais:

> `f8aa5e52 style-bible.md:53-57` — “any grey or neutral clearly TINTED WARM, so the frame never drains to greyscale; a genuinely cold scene cools its LIGHT, never its neutrals.”

> `f8aa5e52 visual-grammar.md:15` — “warm-biased scene palette …”.

Those clauses are post-authoring global constraints. They are the credible code-level explanation for a palette that feels incorrectly warmed even when the local scene calls for industrial grey, teal finance, blue night, or cold institutional light.

## What the validators enforced

| Era | Enforced hard | Only advisory / absent | Consequence |
| --- | --- | --- | --- |
| Poyais (392-line lint) | Verbatim/in-order `vo_ref`; duration and shot-count floors; unique IDs; first base and <=3 deltas per stage. | Missing `changed_elements` was soft; registry cast mention was soft; no schema, prompt, place, figure-tier, or text-route system. | Flexible authoring, weak protection from no-op delta descriptions. |
| Bricks-liked (2,237 lines) | Adds v2 schema, supplied/short text, control-leak, rig-clause, figures shape and `anon_foreground` ban, placement/plate/owner/same-place, semantic cast, action and two-cast rules; 1 base + <=3 deltas. | Empty delta change remains soft. | Strongly constrains authoring and removes the Poyais foreground tier. |
| Now (2,723 lines) | Bricks checks plus suffix equality/two-voice, delta entrance, payload-last, lettering route, interaction/cast, actual cadence heads-up, plate variants, and <=2 deltas. | Empty `changed_elements` remains **soft**; no visual difference test between parent and child. | More rule coverage, but no gate matching Daniel’s no-op complaint. |

The current source proves the mismatch: `f8aa5e52 lint_shots.py:315-27` makes the delta cap/base order hard but emits “no `changed_elements` — a delta must name what changed” through `soft.append`. A literal no-op can therefore pass the mandatory gate.

## Script inventory and net lines

Production scripts only; test files excluded. The named `example-shots.md` at the requested `visual-kit/` path is absent in all three eras.

| Scope | Poyais | Bricks-liked | Now | Net now vs Poyais |
| --- | ---: | ---: | ---: | ---: |
| image-generation: SKILL + forge + review artifact + crop + stamp + thumbnail finalizer | 1,303 | 3,671 | 4,990 | **+3,687** |
| VPW: SKILL + critics + schema + lint | 1,341 | 2,824 | 3,480 | **+2,139** |
| visual grammar + style bible | 972 | 362 | 496 | **-476** |
| reviewed production surface total | 3,616 | 6,857 | 8,966 | **+5,350** |

Script evolution: Poyais had `forge.py` (443), `build_review_artifact.py` (268), `crop_battery.py` (101), and `lint_shots.py` (392). Bricks adds `stamp_review.py` (301) and `finalize_thumbnail.py` (97), expands Forge to 2,128 and lint to 2,237. Now reaches Forge 3,219, review artifact 724, stamp 334, lint 2,723. This is accumulated **mechanism/rule bloat**, not doctrine-document bloat: the two doctrine documents are actually 476 lines shorter than Poyais. The bloat verdict is therefore not “too much prose”; it is too much control-path state and too many mandatory authoring decisions relative to the remaining high-signal checks.

## What a full Poyais-code revert would lose

Keep these post-Poyais fixes even if rolling back the three complaint drivers:

- **Persistent honest render gate:** `stamp_review.py` prevents a locally present but unreviewed/failed frame from quietly shipping. Poyais review was good but manually represented.
- **Seed preflight, same-place discipline, and reviewed seed assets:** these prevent cross-place/style drift and avoid spending before an invalid seed slate is caught.
- **Structured text supply/lettering checks:** prevent invented/garbled/unroutable in-image words, a separate production failure.
- **Step-1 figure cards for fresh named cast:** credible rig/hand/face consistency improvement; do not discard without an A/B.
- **No stage-delta figure entrance and exact retry overlays:** both prevent known image-seed failure modes and make retries auditable.
- **1K default:** now matches Poyais; a full revert is unnecessary here. Do not reintroduce Bricks-liked 2K merely because the commit is the liked reference.
- **Place variants and cadence measurement:** useful anti-repetition/retention tooling, provided they do not force a delta chain.

## Ranked minimal-revert list

1. **Undo “CHAIN is the default” only** in `visual-kit/visual-grammar.md` and the mirrored VPW instruction; restore Poyais’s optional use of chains for genuine progressive reveal/enumeration. Keep the <=2 cap and entrance/feasibility protections. Add one narrow hard gate: a delta must have a non-empty, semantically distinct `changed_elements` declaration; do not claim pixel-level verification until an actual image diff criterion exists.
2. **Restore the Poyais anonymous full-rig foreground route**—not as named cast and not as crowd—in schema/Forge/lint plus the grammar. It should be the old narrow case: one prominent, non-recurring actor with a generic fitting outfit/hair, full rig, no canonical. Retain named cast for recurring/identified people and crowd for genuine masses.
3. **Replace the current global warm correction with Poyais palette freedom:** remove “neutrals clearly TINTED WARM … cold scene cools its LIGHT, never its neutrals” and replace the tail’s “warm-biased scene palette” with Poyais’s “locked 2-3 colour scene palette.” Keep the semantic red and per-shot committed-palette requirement.
4. **Do not revert review stamping, seed preflight, same-place anchors, or 1K.** They are later correctness fixes and are not mechanisms for the three complaints.

That is the smallest targeted rollback: it restores Poyais’s actor choice, standalone-cut bias, and palette latitude without throwing away the later verification/asset-integrity work.
