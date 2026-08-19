# Four-era prompt forensics — POYAIS vs BRICKS-LIKED vs FRESH

Date: 2026-08-19  
Scope: the requested three `long_form.shots[].still_prompt` corpora. “LIKED” is `30d2b7e8:.../shots.json` (214 shots); “FRESH” is the current 245-shot file; “POYAIS” is the final working-tree r10 file (117 shots). This extends, rather than repeats, `prompt-diff-analysis.md`.

## Method and limits

- Counts are shot-presence counts. Crowd noun hits are case-insensitive hits for `crowd`, `audience`, `onlooker`, `queue`, `gathered/gathering`, `mass`, `group/cluster/huddle`, and role-plurals such as `workers`, `shoppers`, `buyers`, or `teams`.
- `>=3` and `>=6` are conservative prompt readings: an explicitly plural crowd/team/group with three or more staged bodies qualifies for the first; a dense/mass/queue or six-or-more described bodies qualifies for the second. They are not pixel face counts.
- Crowd subject/background, depiction class, and delta materiality were hand-coded from the prompt and `changed_elements`, after reading each relevant prompt. Class rows are intentionally non-exclusive where a map, object, or aftermath is also cast-free.
- Delta token change is normalized `SequenceMatcher` token edit share against the latest earlier shot in the same stage. It is an audit trace, not a proxy for visual magnitude: rewritten held-scene boilerplate can produce a high token score for a visually trivial addition.

## 1. Crowd pressure

| Corpus | shots | prompt stages >=3 people | prompt stages >=6 people | crowd-noun hits | declared / explicit crowd shots | crowd is the subject | crowd is background dressing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| POYAIS | 117 | 33 (28.2%) | 27 (23.1%) | 34 (29.1%) | 33 (28.2%) | 17/33 (51.5%) | 16/33 (48.5%) |
| BRICKS-LIKED | 214 | 56 (26.2%) | 45 (21.0%) | 47 (22.0%) | 56 (26.2%) | 32/56 (57.1%) | 24/56 (42.9%) |
| FRESH | 245 | 55 (22.4%) | 43 (17.6%) | 52 (21.2%) | 55 (22.4%) | 37/55 (67.3%) | 18/55 (32.7%) |

The raw crowd count is **not** the main regression: FRESH has 55 explicit crowd shots, almost the liked 56 and below Poyais's percentage. Its pressure is compositional and authorial: **37 of the 55** make the group the event, compared with 32 liked and 17 Poyais. FRESH also stages people outside an explicit crowd declaration in 52 prompts (for example buyer teams, manager clusters, or worker masses).

### Fresh L01–L25 shots behind Daniel’s reaction

The rendered-slice composition audit identifies the direct failures as **L02** (roller-rink wall of heads), **L03** (large foreground crowd), **L06** (crowd pressed to storefront glass), **L07** (money-reaching crowd fills the frame), and **L20–L21** (the formerly wide gold-rush beat is a close seven-person cluster). Current prompt evidence also puts groups at the center of L01–L09, L16–L17, and L22. These are not all equally bad: **L08, L09, and L15** are the counterexamples where the crowd is small or depth-staggered behind a real spatial cue.

The decisive distinction is “people as the topic” rather than “people present.” For example, FRESH L73’s manager mass in two arcs, L80’s inward-turned manager mass, L112’s clusters around the decision table, L170’s employee exodus, and L201’s accountant group all make a human collective the visible argument. Poyais used crowds too, but its 48 cast-free shots (41.0%) gave it frequent relief in maps, objects, landscapes, and aftermaths.

## 2. Depiction class

### Requested classes (non-exclusive reading)

| Class | POYAIS | BRICKS-LIKED | FRESH |
| --- | ---: | ---: | ---: |
| Literal re-enactment | 3 (2.6%) | 6 (2.8%) | 43 (17.6%) |
| Symbolic stand-in / object | 28 (23.9%) | 32 (15.0%) | 4 (1.6%) |
| Number glued to an object | 4 (3.4%) | 15 (7.0%) | 5 (2.0%) |
| Map / plan view | 6 (5.1%) | 6 (2.8%) | 7 (2.9%) |
| Reaction shot | 3 (2.6%) | 24 (11.2%) | 6 (2.4%) |
| Aftermath / palette turn | 7 (6.0%) | 8 (3.7%) | 9 (3.7%) |
| Cast-free / empty-world-capable beat | 48 (41.0%) | 66 (30.8%) | 55 (22.4%) |

The rest of each corpus is made up of personified-character, ironic-counterpoint, physicalized-imbalance, staged-interaction, crowd-multiplication, diegetic-device, and idiom-pun beats. The comparison is structural, not a claim that a single prompt cannot be both an aftermath and a symbolic object.

Poyais’s non-literal register is concentrated at the story’s pivots, not confined to a single act: L03 is a map, L05–L12 build/smash the fantasy-country proposition with a country tableau, FICTION stamp, aftermath, and question-mark pause; L36–L41 turn the guidebook, city, population, and gold into objects on a page; L87–L96 replace promised settlement with washed-out landscape, absent institutions, and graves. It favored **symbolic stand-ins (28)** and **cast-free environments/objects (48)**, with map resets and aftermath turns as breathing spaces. That is the missing non-literal cadence: FRESH has broadly similar map count but only **four** symbolic stand-ins, while it raises literal re-enactment from **3/117 Poyais** and **6/214 liked** to **43/245**.

## 3. No-op delta audit

### Parent comparison

| Corpus | deltas | mean token edit share | median token edit share | camera move | new element | element state change | cosmetic / sub-visible no-op |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| POYAIS | 22 | 0.564 | 0.493 | 0 | 16 | 6 | **0 (0.0%)** |
| BRICKS-LIKED | 73 | 0.668 | 0.730 | 0 | 50 | 17 | **6 (8.2%)** |
| FRESH | 109 | 0.620 | 0.607 | 0 | 68 | 15 | **26 (23.9%)** |

There are no true camera-move deltas in these stage chains: a new framing is normally authored as a base or standalone. FRESH’s 109 deltas are 44.5% of the file, versus 18.8% Poyais and 34.1% liked. It therefore has both the highest chain exposure and roughly **three times** liked’s no-op rate.

### FRESH no-ops — full list

Manual rule: a change is a no-op when it alters only a small/unreadable prop, blank or tiny text, a non-story state, or a local reposition that does not change the shot’s visual argument. The full set is:

`L02, L15, L37, L51, L70, L72, L76, L103, L110, L111, L119, L123, L136, L144, L146, L162, L169, L175, L184, L186, L206, L209, L218, L229, L242, L243`.

| Worst example | Parent -> delta | token edit share | Declared material change | Why it is sub-visible |
| --- | --- | ---: | --- | --- |
| L103 | L102 -> L103 | 0.547 | “one tiny bent paper clip” on a broad corridor floor | The prompt itself calls it tiny; it cannot change the existing auditorium-scale composition. |
| L136 | L135 -> L136 | 0.589 | “ambiguous dark shadow” under an open table gap | Neither object nor action becomes readable; “ambiguous” makes the intended difference especially unlikely to survive generation. |
| L162 | L161 -> L162 | 0.407 | one low wooden step at the family helper’s station | A local support prop does not advance the family-night visual argument. |
| L186 | L185 -> L186 | 0.778 | reported block receives `14 MILLION DOLLARS` | The structural block already exists; the change is chiefly small in-world lettering, which the prompt otherwise asks the engine to keep secondary. |
| L243 | L242 -> L243 | 0.429 | Christmas payroll ribbon spans an existing short card row | Decorative trim on an established card row is not a new scene or consequence. |

Other especially clear no-ops are L37’s small `1988` year marker, L70’s inert chopping-block pedestal, L72’s single quota tooth, L76’s expression-only swap, L110’s open safety gate, L119’s blank paper tab, L175’s two blank newsprint bundles, and L209’s empty evidence tray. The six liked baselines are L22 (a worker looks at camera), L32 (a bale band gains lettering), L157 (newspaper masthead), L167 (one total line), L175 (a crack on one certificate), and L200 (calendar plus hairline crack). None of the 22 Poyais deltas falls below the rule: each adds/removes a legible story object, character, population, map state, or decisive environmental transformation.

## 4. Coloration language

| Signal | POYAIS | BRICKS-LIKED | FRESH |
| --- | ---: | ---: | ---: |
| Warm | 109 (93.2%) | 62 (29.0%) | 26 (10.6%) |
| Golden | 18 | 1 | 1 |
| Amber | 1 | 43 | 27 |
| Cool / cold | 10 / 13 | 28 / 36 | 11 / 9 |
| Grey | 28 | 87 | 13 |
| Cream / charcoal | 37 / 0 | 33 / 14 | **126 / 58** |
| Green / red | 20 / 106 | 41 / 35 | 1 / 55 |
| Other leading named palette words | brown 95; black 92; muted 22 | white 34; brown 32; steel 45 | muted 42; tobacco 33; teal 27; clay 24; steel 30 |
| Explicit `Palette:` clause | 102 (87.2%) | 114 (53.3%) | 1 (0.4%) |

Poyais is **per-beat chosen but globally warm-committed**: 102 distinct palette clauses name local contrasts (for example cool grey-blue dock / warm gold horizon, or cold-grey aftermath), while 109 prompts also state warm and 97 carry the semantic red accent. Its repeated style tail reinforced that decision; it did not replace it.

LIKED distributes colour across scene-specific vocabulary: grey 87, warm 62, amber 43, green 41, cold 36, red 35, white 34, cream 33, brown 32. FRESH is less overtly warm in authored prose, but is substantially more **cream/charcoal-tokenized**: cream occurs in **126/245 (51.4%)** and charcoal in **58/245 (23.7%)**. A recurring cream/charcoal scene vocabulary is not the same thing as Poyais’s beat-specific warm/cool choices.

Dispatch matters here, but is not re-archaeologized in this report: the prior audit established that current dispatch appends an 80-word warm-biased suffix after every authored scene, whereas the liked full-generation path appended no suffix; Poyais supplied a strong tail and per-shot palette. Thus language counts describe authoring, while the present tail can still systematically amplify warmth/cream in images. The existing pixel comparison makes that amplification plausible: FRESH L01–L25 mean R-minus-B is 64.84 versus liked 37.68.

## 5. Synthesis — complaint ownership

| Daniel’s complaint | Verdict | Decisive evidence |
| --- | --- | --- |
| Too many crowd-centered / literal people shots | **Authoring-born, with engine magnification** | FRESH puts the crowd in subject position in 37/55 crowd shots (67.3%), versus 32/56 liked (57.1%) and 17/33 Poyais (51.5%); it has 43 literal shots versus 6 liked and 3 Poyais; symbolic stand-ins collapse to 4 versus 32 liked and 28 Poyais. The L02/L03/L06/L07/L20/L21 renders show the engine can magnify an already crowd-led premise into a wall of figures. |
| Coloration is wrong | **Both** | Authored FRESH says cream in 126/245 and charcoal in 58/245 while its explicit palette clauses fall to 1/245 from Poyais’s 102/117. Engine input then appends the warm-biased 80-word tail to every prompt; FRESH pixel warmth is 64.84 R-minus-B versus liked 37.68. |
| Deltas change almost nothing / change does not matter | **Authoring-born** | FRESH has 109 deltas (44.5% of shots) and 26 no-ops (23.9%); liked has 73/214 deltas and 6 no-ops (8.2%); Poyais has 22 deltas and 0 no-ops. The engine may fail to show a small change, but it cannot make L103’s tiny paper clip or L162’s wooden step a meaningful visual beat. |

### Guardrail check

All three requested corpora and the earlier audit were accessible. This report is prompt/metadata forensics only: no image generation, network access, source mutation, or claim that a lexical count proves a rendered pixel result.
