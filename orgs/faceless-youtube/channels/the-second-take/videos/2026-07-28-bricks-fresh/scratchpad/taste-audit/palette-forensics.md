# Palette forensics — Bricks VPW3

Scope: the current 204-shot `shots.json`; Poyais at its final commit
`9e32269d`; the liked Bricks era at `30d2b7e8`; 24 verified VPW3 frames
L01–L25 (L09 excluded because parked); and the 13 explicitly LIKED board frames.
All counts and per-frame measurements are reproducible with
`palette_forensics.py`; the complete machine-readable rows are in
`palette-forensics-data.json`.

## 1. Authored palettes

Method: words are hue-normalised (`teal`/`steel`/`cold`/`dusk` → blue;
`amber`/`gold`/`oak`/`walnut`/`brass`/`beige`/`brown` → orange; etc.). `red`
is retained in each shot's word list but omitted from the family key because it
is the globally reserved semantic accent and would otherwise drown out the
story palette. This is deliberately a *prompt-word* measurement, not a claim
about rendered pixels.

| File / era | Shots | Blue + orange named | Top five normalised palette families |
| --- | ---: | ---: | --- |
| NEW VPW3 | 204 | **102 (50.0%)** | blue+orange+neutral 55 (27.0%); blue+orange 38 (18.6%); blue+green+neutral 28 (13.7%); blue+neutral 17 (8.3%); orange+neutral 15 (7.4%) |
| POYAIS final | 117 | 26 (22.2%) | orange+neutral 66 (56.4%); blue+orange+neutral 18 (15.4%); orange+green+neutral 11 (9.4%); blue+orange+green+neutral 6 (5.1%); neutral 4 (3.4%) |
| LIKED Bricks (`30d2b7e8`) | 214 | 51 (23.8%) | neutral 45 (21.0%); orange+neutral 31 (14.5%); blue+orange+neutral 29 (13.6%); blue+neutral 29 (13.6%); orange 23 (10.7%) |

NEW therefore doubles the rate of authored blue+orange coexistence relative to
both comparison files. It is concentrated at the opening: 37 of A1's 47
shots (78.7%).

| Act | Shots | Blue + orange | Full family distribution (all non-zero families) |
| --- | ---: | ---: | --- |
| A1 | 47 | 37 (78.7%) | blue+orange 24; blue+orange+neutral 12; orange+neutral 5; blue+neutral 4; blue+orange+green 1; blue+pink+neutral 1 |
| A2 | 52 | 25 (48.1%) | blue+green+neutral 27; blue+orange+neutral 23; blue+orange 1; blue+orange+purple+neutral 1 |
| A3 | 51 | 14 (27.5%) | blue+orange 11; neutral 11; blue+neutral 8; blue+pink+neutral 6; blue 4; orange+neutral 3; blue+orange+neutral 2; orange 1; green+neutral 1; orange+green+neutral 1; orange+green 1; green 1; blue+orange+pink+neutral 1 |
| A4 | 54 | 26 (48.1%) | blue+orange+neutral 18; orange+neutral 7; orange+green+neutral 6; blue+neutral 5; orange 5; blue+orange+green+neutral 3; blue+orange 2; blue+orange+pink 2; neutral 1; blue 1; blue+green+neutral 1; green+neutral 1; purple+neutral 1; blue+orange+pink+neutral 1 |

## 2. Rendered pixels

Method: Pillow samples each PNG to 320×180, keeps saturated HSV pixels
(S ≥ .18), finds the leading hue-histogram mode, suppresses its ±25°
neighbourhood, then takes the next mode. `opposition` is their shortest hue
distance. Orange/teal means 15–75° plus 155–220°. It is a neutral repeatable
measurement, not an aesthetic judgment.

| Set | Frames | Orange/teal dominant pair | Pair distribution |
| --- | ---: | ---: | --- |
| NEW verified (L01–L25, no parked L09) | 24 | **11 (45.8%)** | orange+teal 11; orange+green 6; orange+orange 3; blue+orange 2; orange+red 2 |
| LIKED pre-reset board baseline | 13 | 4 (30.8%) | orange+red 5; orange+orange 4; orange+teal 4 |

### NEW per-frame modes

| Frame | Hue modes (degrees) | Pair | Opposition |
| --- | --- | --- | ---: |
| L01 | 17.5, 227.5 | blue+orange | 150.0° |
| L02 | 22.5, 167.5 | orange+teal | 145.0° |
| L03 | 37.5, 227.5 | blue+orange | 170.0° |
| L04 | 27.5, 167.5 | orange+teal | 140.0° |
| L05 | 27.5, 57.5 | orange+orange | 30.0° |
| L06 | 32.5, 67.5 | orange+orange | 35.0° |
| L07 | 32.5, 152.5 | green+orange | 120.0° |
| L08 | 27.5, 152.5 | green+orange | 125.0° |
| L10 | 32.5, 152.5 | green+orange | 120.0° |
| L11 | 32.5, 62.5 | orange+orange | 30.0° |
| L12 | 27.5, 167.5 | orange+teal | 140.0° |
| L13 | 22.5, 177.5 | orange+teal | 155.0° |
| L14 | 32.5, 162.5 | orange+teal | 130.0° |
| L15 | 167.5, 32.5 | orange+teal | 135.0° |
| L16 | 27.5, 167.5 | orange+teal | 140.0° |
| L17 | 32.5, 152.5 | green+orange | 120.0° |
| L18 | 27.5, 152.5 | green+orange | 125.0° |
| L19 | 37.5, 167.5 | orange+teal | 130.0° |
| L20 | 22.5, 172.5 | orange+teal | 150.0° |
| L21 | 27.5, 157.5 | orange+teal | 130.0° |
| L22 | 27.5, 212.5 | orange+teal | 175.0° |
| L23 | 22.5, 102.5 | green+orange | 80.0° |
| L24 | 32.5, 2.5 | orange+red | 30.0° |
| L25 | 32.5, 2.5 | orange+red | 30.0° |

The individual LIKED-frame modes are retained in the JSON evidence file; its
four orange/teal results are L11, L20, L24, and L25. The comparison is not
that LIKED had no warm/cool frames—it did—but that this fresh opening produces
them at a materially higher rate.

## 3. Source hunt and attribution

| Candidate source | Evidence | Attribution |
| --- | --- | --- |
| Doctrine wording | Poyais-final `style-bible.md` §4 said scene/background/prop palettes “move freely” (examples: grey warzone, teal bank, green park). Its VPW skill nevertheless required each prompt's “committed scene palette (2–3 colours + one red accent).” Poyais's frozen suffix said “**locked 2-3 colour scene palette**”; the current `visual-grammar.md:15` suffix instead says “**warm-biased scene palette**.” | The general palette rule is not a blue+orange instruction. The substantive engine-tail change is from a neutral lock to an always-warm bias. |
| Locked VPW3 plan | `plan.md:18` requires each prompt to state a locked 2–3-colour palette and calls for cool/desaturated late passages. It only names a strong “terracotta/clay contrast” for the A3 peak (`:35`); it never directs blue+orange as a video palette. | Contributing constraint, not decisive pair source. It makes colour declarations salient and gives the brick story warm material vocabulary, but it does not plan a video-wide complementary pair. |
| Four act fragments | Independently authored fragment rates: A1 35/47 blue+orange (74.5%); A2 23/52 (44.2%); A3 24/51 (47.1%); **A4 2/54 (3.7%)**. | This disproves “all four independently copied the same pair.” It does show early/middle authoring convergence in three fragments; A4 initially escaped it, so doctrine-example leakage is partial rather than universal. |
| Plates / style tile | Exact L01–L25 frozen specs contain **no `place` seed**. `scene-style-tile` is directly seeded only by L13–L15 and L23–L25; L23 additionally seeds `lettering-marker-italic`. The rest either have no environmental seed or inherit a local parent (L02←L01, L03←L02, L05←L04, L06←L05, L08←L07, L11←L10, L12←L11, L14←L13, L15←L14, L17←L16, L19←L18, L20←L19, L24←L23, L25←L24). Tile pixel modes are 32.5° orange + 77.5° green (45° apart); lettering is 32.5° orange + 2.5° red (30° apart). Neither is teal+orange. | Not the source. No referenced plate carries an orange/teal pair, and the actual first-slice spec does not seed a prebuilt place plate. |
| Frozen dispatch suffix / engine tail | Every L01–L25 request carries exactly: “**warm-biased scene palette plus the single red accent #d7402b used only semantically** …”. Pixels then show orange+teal in 11/24 new verified frames (45.8%), versus 4/13 LIKED frames (30.8%). | Decisive universal pressure toward warm/orange; it does not name teal, but paired with authors reaching for blue/teal depth it mechanically favours the complement. |

## 4. Daniel’s direct question

**No: the evidence does not support “Poyais had diversity without per-scene
palette naming.”** At the Poyais-final commit, the VPW skill already required a
prompt to carry a committed 2–3-colour scene palette plus red accent, and the
final Poyais `shots.json` is **117/117 (100%)** prompts with direct colour
terms under the conservative direct-name test. Poyais also had only 22.2%
blue+orange prompts, versus NEW's 50.0%, because its doctrine simultaneously
said scene/background/prop palettes moved freely and its authors actually used
more orange/neutral and green alternatives.

So the current “every prompt locks 2–3 named colours” formulation is a
strengthening of Poyais's flexible scene-palette language, **not a clean new
addition and not a sufficient explanation of the failure**. Palette naming
alone cannot be the convergence engine: Poyais named colours in every prompt
and remained more diverse. The evidence instead isolates the changed always-on
warm engine suffix plus early/middle Bricks authoring as the interacting cause.

## Verdict and smallest fixes

This is primarily **authoring convergence amplified by the engine tail**, not
teal/orange embedded in the plates or tile and not proof that all four fragment
authors copied one doctrine example. The plan's locked-palette instruction made
the condition easy to reproduce, but it never specified the pair; its strongest
evidence is A1's 78.7% authored blue+orange rate. The smallest source-scoped
fixes are: **(1)** revert the frozen suffix clause from `warm-biased scene
palette` to Poyais's neutral `locked 2-3 colour scene palette` (keep the
semantic-red clause); **(2)** reword the VPW3 plan's “not generic
cream/charcoal” clause to the existing Poyais freedom principle (“palette moves
with the beat”), while retaining the 2–3-colour commitment; **(3)** re-author
only the 37 A1 blue+orange prompts before generating further A1 frames, using
the already planned story turns as palette changes; **(4)** make no plate/tile
change, because their measured pixels do not carry the pair. These are
revert/rewording/local-authoring changes, not new rules.
