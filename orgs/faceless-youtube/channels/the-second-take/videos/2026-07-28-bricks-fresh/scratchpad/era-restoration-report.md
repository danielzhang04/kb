# Era restoration — build report (2026-08-05)

Worktree `C:/Users/danie/kb-worktrees/boss-bricks-reset` (detached at `89c720e`). Nothing committed;
no git write of any kind. Authority docs: `poyais-mechanism-archaeology.md` + `perspective-analysis.md`
§4 (A2 and the vantage lint were REJECTED and are NOT implemented).

## 0. Era text SHAs used

| Text | Source | Extracted how | Length |
| --- | --- | --- | --- |
| §2b STYLE-ONLY descriptor | `ff36f63:orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md` lines 90-93 | `git show` | 290 chars as parsed by `blockquote_after` |
| `global_prompt_suffix` | `ff36f63:orgs/faceless-youtube/channels/the-second-take/videos/2026-07-04-poyais/shots.json` | `git show` → `json.load` → the field | **643 chars** |
| style-anchor role prose | `ff36f63:.../visual-kit/refs/env/README.md` (quoted in archaeology §2.7) | archaeology verbatim quote | — |

**Correction to the brief:** the era suffix is **643** characters, not 609. 609 is the archaeology
doc's count of its own hard-wrapped rendering. The 643-char string was pulled from the SHA and is
byte-identical in all three places it now lives (grammar header, bricks-fresh shots.json, the
drift-lock test literal) — verified programmatically, not by eye.

`ff36f63` = "import live faceless-youtube working tree", 2026-07-19 — the end-of-era state that
produced the shipped poyais video.

---

## A. `visual-kit/style-bible.md`

### A1 — §2b replaced with the era text verbatim

BEFORE (9 lines, the 2026-07-30/08-04 build):

> THICK, BOLD dark warm brown-black (#241a12) outline on everything, at the SAME weight as the
> character rig's own outline — NOTHING in the frame is drawn with lines finer than that rig
> outline, and no hairline or micro-pattern detail at any depth (blind slats, lattices, grilles,
> railings, distant filigree, fine grain, repeated thin stripes); flat colour fills — one flat
> base colour per surface plus at most ONE hard-edged single-step shadow shape, no feathered or
> blended transitions, uniform highlight-free surfaces, and every skin or head-tone patch is ONE
> flat uniform fill with no airbrush, no gradient and no soft shading of any kind — chunky
> simplified furniture, foliage and props, rounded friendly shapes, no realistic detail. No text,
> no words, no labels.

AFTER (era verbatim, 3 lines):

> Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even
> MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, simple flat colours with gentle
> soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.

Explicitly deleted with it, as instructed: `one flat base colour per surface` · `at most ONE
hard-edged single-step shadow shape` · `no feathered or blended transitions` ·
`uniform highlight-free surfaces`. Restored era survivors: the seed-authority sentence
(`Draw in the SAME art style as the reference image:`), the word **CARTOON**, the word **even**
(line-weight evenness), and `simple flat colours with gentle soft cel shading`.

Text prohibition: the era text carries its own — `No text, no words, no labels.` — so era phrasing
won and no current sentence was retained.

Heading structure preserved; `blockquote_after` re-verified (see §H).

### A2 — §5 Environments bullet amended in place

BEFORE: `composed **edge-to-edge with a fore/mid/background depth read**`
AFTER:  `composed **edge-to-edge, depth read by overlap and scale, eye-level frontal**`

### A2b — the earlier build's stage-set paragraph DELETED from §5

The whole `**PLATES are STAGE SETS (LOCKED …)**` bullet is gone (frontal/eye-level/one-point-at-most,
overlapping planes, open floor plane, `insertability` + `line-register` judging). Its vantage/depth
content is folded into the amended Environments phrase, which is now the single owner.

The style-tile seeding sentence it contained was **preserved verbatim** as its own §5 bullet (E4
keeps the tile plumbing, and `forge.py` quotes this sentence as the source of `STYLE_TILE`):

> **`refs/env/scene-style-tile.png` seeds every cast-free plate/scene gen** — it contributes **line
> register and palette discipline ONLY, never content, layout, or the place it depicts**; a
> figure-bearing gen carries its own register in the cast seeds and does NOT take the tile.

R5 (remove `low angle` from the reveal recipe) lives in `visual-grammar.md`, not §5 — applied there
(see B4). No new paragraphs were added to §5.

### A3 — §3 review axes

- `line-register` row: **KEPT**, unchanged.
- `insertability` row: **DELETED**. Its trailing sentence `**Count** — exactly the characters the
  scene declares.` was re-homed as its own one-line bullet rather than lost.
- `Head tone` row amended to the era wording (see the dedup list, D-6).

### A4 — §2d

Untouched, byte-identical.

---

## B. `visual-kit/visual-grammar.md`

### B1 — R1, the framing template deleted

BEFORE: `A trailing "Framing: … Palette: …" after the payload is the commonest way to break it — put
those facts BEFORE the lettered element, not after.`
AFTER: `Any trailing scene-fact clause after the payload breaks it — state scene facts BEFORE the
lettered element, never after.`

The ordering law is intact; the template the corpus copied 202 times is gone.

### B2 — R2, `angle` removed and the eye-level stigma deleted

BEFORE: `Framing, scale, and angle are a choice driven by the one thing the viewer must see (the
payload) and the shot's class. Unchosen, it defaults to a centered eye-level medium — fine once,
deadly on repeat:`
AFTER: `Framing and scale are a choice driven by the one thing the viewer must see (the payload) and
the shot's class. The vantage is not a choice — it is the house eye-level frontal (`style-bible.md`
§5).`

**One deviation from the literal R2 text, flagged:** R2's replacement wording ends `(§3a)`. §3a is
A2, which was REJECTED, so that cross-reference would point at nothing. It points at
`style-bible.md` §5 — the surviving owner of the amended vantage phrase — instead. No other wording
changed.

### B3 — the era suffix restored as the grammar header

BEFORE: `> hand-lettered marker capitals for any in-world text` (46 chars, lettering only)
AFTER: the 643-char era suffix, verbatim, as a single blockquote line (single line so
byte-identity with `shots.json` is trivially checkable).

The era suffix already carries the hand-lettering law — `any in-world lettering hand-lettered in the
marker style, short and legible` — so nothing was appended; the lettering law survives inside it.

The explanatory paragraph under it was amended in place because the restore made it FALSE. Deleted
sentence: `Texture, line weight, and art style are stated ONCE, in style-bible.md §2b (the single
style source), and reach every request through forge.py's descriptor, never through this suffix.`
Replaced by the two-voice statement. Everything else in that paragraph (the never-write-style rule,
`one voice, one home`) is unchanged.

### B4 — R5, low angle out of the reveal recipe

BEFORE: `(a big reveal: spotlight / low angle / arrival; a minor one: a clean introduction)`
AFTER: `(a big reveal: spotlight / scale / arrival into a held scene; a minor one: a clean
introduction)`

---

## C. `visual-prompt-writer/SKILL.md`

### C1 — R3, the must-state list

- `framing + scale` → `subject scale and stage position (stage-left / centre / stage-right)`
- `depth (fore/mid/background, filled edge-to-edge)` → `layered depth (fore/mid/background by
  overlap and scale, filled edge-to-edge)`

### C2 — R4, the decay warning

BEFORE: `reuses the same two or three classes, and settles into the centered eye-level medium`
AFTER: `reuses the same two or three classes, and reaches for the same nouns and the same staging`

### C3 — the stale line-111 claim, made true

BEFORE: `the global_prompt_suffix and the style bible's forge descriptors inject those on every gen`
(false — nothing appended the suffix)
AFTER: `forge.py prepends the style bible's §2b descriptor at the HEAD of every scene gen and
appends this file's global_prompt_suffix at its TAIL, so both reach every gen without you`

This is now literally what `assemble_prompt` does — proved in the dry-run (§H).

---

## D. `example-shots.md`, `vpw-log-fresh.md`, test fixtures

### D1 — R6, the gold exemplar

`**Ideal shot:** wide low-angle dock at dawn;` → `**Ideal shot:** wide eye-level dock at dawn;`

### D2 — R7, the live log

| Line | BEFORE | AFTER |
| --- | --- | --- |
| lesson #12 | `Vary the world and the vantage per shot, not just the class.` | `Vary the WORLD per shot — the nouns, the set, the palette — not the vantage; the vantage is fixed house eye-level.` |
| R-4 record (L32) | ``L32 goes `expr-greedy` on a low wide angle from floor level (the boom).`` | ``L32 goes `expr-greedy` on a wide (the boom).`` |
| R-7 record (L07) | `and takes a new vantage (down on the floor at counter height). The window card is behind camera at that vantage, so no literal is carried…` | `and stays on the house eye-level frontal. The window card is outside that framing, so no literal is carried…` |

The L07 repair went one clause further than a bare strike because the NEXT sentence depended on the
struck clause (`at that vantage`); leaving it would have produced a dangling reference.

### D3 — R7b, the two fixture strings

`test_round2_guards.py`: `"Framing: wide static from floor level"` → `"Framing: wide static
eye-level"`; `"Framing: low wide angle"` → `"Framing: medium eye-level"`. Behaviour-neutral as
predicted — both assertions are about payload ordering and still pass unchanged.

---

## E. `forge.py` (+ tests)

### E1 — `HARDENED_SCENE_STYLE` DELETED as a voice

`self.desc_scene` is gone; `prompt_for`'s `scene` parameter is gone. `prompt_for` for
`environment`/`style` is now byte-for-byte the era shape (archaeology §2.1): three descriptors,
mode-selected, no hardening block.

**Every deleted line, with its era ancestor (or lack of one):**

| Deleted clause | Era ancestor? | Where it survives now |
| --- | --- | --- |
| `flat colour fills — one flat base colour per surface plus at most ONE hard-edged single-step shadow shape` | **None** (2026-08-04 invention) | Nothing. Nearest era text: `flat cel colours with gentle soft shading` (suffix) / `simple flat colours with gentle soft cel shading` (§2b). |
| `no feathered or blended transitions, uniform highlight-free surfaces` | **None** | Nothing — folds into nothing, as instructed. |
| `THICK BOLD dark warm brown-black outlines on everything, at the SAME weight as the character rig's own outline` | **Yes** — §2b `an even MEDIUM-THICK … outline on everything` + suffix `even medium-thick dark warm brown-black (#241a12) outline on everything` | Both restored voices, at both ends of every prompt. |
| `NOTHING in the frame is drawn with lines finer than that rig outline: no hairline or micro-pattern detail at any depth (…)` | **None** as a prompt voice | Survives as a **judge** axis only — style-bible §3 `line-register`. It no longer speaks to the provider. |
| `Furniture, foliage and props are CHUNKY and simplified.` | **None** | Nothing. Nearest era text: `rounded friendly shapes, no realistic detail` (both voices). |
| `Every skin or head-tone patch is ONE flat uniform fill — NO airbrush, NO soft shading.` | **None**; and it directly contradicted restored §2b's `gentle soft cel shading` | The airbrush half survives as a judge axis (§3 `line-register`) and as the VPW prose lint (E5). |
| `NO gradient; NO gloss or specular highlight; NO bloom; NO depth-of-field blur or soft focus; NO subsurface or rim light` | **None** (archaeology D2: four negations with no era ancestor) | Nothing. |
| `NO photorealistic texture` | **Yes** — suffix `no photorealism` | The suffix, at the tail of every scene gen. |
| `Commit the authored scene palette; it is never neutral grey alone.` | **Yes** — suffix `locked 2-3 colour scene palette plus the single red accent #d7402b used only semantically` | The suffix. |

Net: 6 of 9 clauses had no era ancestor and fold into nothing; 3 are covered by the restored voices.
The dry-run confirms **zero** remnants of any of them in 297 assembled prompts (§H).

### E2 — the suffix tail-append

- `assemble_prompt(descriptor, payload, figures_text, righold, suffix)` — new final zone.
- `prompt_for(..., suffix="")` passes it through.
- `cmd_batch` reads `doc["global_prompt_suffix"]` once and writes `"prompt_suffix"` onto every scene
  item, exactly as `still_prompt` flows into `payload`/`delta`. The scene retry path inherits it for
  free (`out = dict(item, …)`).
- `cmd_gen` passes `r.get("prompt_suffix")` into `prompt_for`.

**One deliberate narrowing of "every generation prompt", flagged for the boss.** STEP-1 figure cards
(`fig-*`) do NOT carry the suffix, and neither does an ad-hoc `forge gen` request. Reason: a STEP-1
card is a `2:3` identity card on a plain ground, and the suffix's `16:9`, its built-but-flat
ENVIRONMENT recipe, and `no on-screen narrator or host face` are scene facts that would fight it.
This mirrors the carve-out the deleted `scene=` gate already made (the old test asserted
`"HARDENED SCENE STYLE" not in step1`), and it matches the era, where the suffix lived in shots.json
and reached scene prompts only. Expressed structurally — by which items carry the field — rather
than as a branch inside `prompt_for`. Measured result: 248/248 scene requests carry it, 0/49 step-1
cards do.

### E3 — `IMAGE_SIZE_DEFAULT` `"2K"` → `"1K"`

Comment rewritten to state the era-register reason and to name the accepted cost (1K@16:9 ≈
1344×768, below the 1920×1080 delivery frame). `--image-size 2K|4K` still available.

**2K-assumption sweep — every hit in the repo, and its disposition:**

| Location | Finding | Action |
| --- | --- | --- |
| `forge.py:45-52` | the tier comment argued FOR 2K | rewritten (era register + accepted cost) |
| `forge.py:2297` `--image-size` help | interpolates `IMAGE_SIZE_DEFAULT` | correct automatically |
| `forge.py:1567`, `2034` (`image_size: "1K"` on STEP-1 cards) | already 1K | unchanged |
| `test_forge_figures.py` resolution test | asserted `!= "1K"` | retargeted to `== "1K"` |
| `image-generation/SKILL.md:126` | `requests imageSize: 2K` + a paragraph arguing the delivery frame | rewritten to the era-register rationale |
| `image-generation/SKILL.md:132` | "4K … ~6× the 1K price" | still true, unchanged |
| `crop_battery.py` | **0 hits** — no resolution assumption; already RETIRED per SKILL §Seed law | none needed |
| `finalize_thumbnail.py` | 0 hits | none |
| `render-builder` skill | 0 hits | none |
| `knowledge/stack.md:21` cost table | per-tier prices ($0.039 1K / $0.134 2K / $0.24 4K) are still correct; the derived `~$15–30 per full video` assumed the 2K default and now **over**-estimates (~$5–7 at 1K) | **NOT edited — out of the named scope** (a `knowledge/` doc, not the skill's). Flagged for the boss: the per-video budget line is now conservative, not wrong-dangerous. |
| `wells-fargo/assets/image-gen-lab.md`, `bricks-fresh/assets/library/manifest.json` | historical run records citing the 2K tier they actually ran at | correctly left alone — they are records, not assumptions |

### E4 — style tile KEPT; role text retargeted; drift-lock retargeted

- All style-tile plumbing kept (`STYLE_TILE`, `STYLE_ANCHOR_ROLE`, derivation, cap arithmetic,
  role-truthfulness gate) and its 15 `test_forge_style_tile.py` tests still pass.
- **Role text retargeted** to the archaeology's env-exemplar spec, which did differ:

  BEFORE: `Copy from it exactly two things: the LINE REGISTER (that outline weight, thick and
  uniform, with no element drawn finer and no hairline or micro-pattern detail anywhere) and the
  flat warm PALETTE discipline.`
  AFTER: `It pins LINE WEIGHT, the outline colour (#241a12), the FLAT-CEL RENDER, and PALETTE
  DISCIPLINE, and nothing else.`

  The era `refs/env/README.md` names four things the anchor pins — line weight, outline colour
  `#241a12`, flat-cel render, palette discipline. The old text named two and carried the deleted
  08-04 hardening vocabulary. The `Take NOTHING else … NOT the place it depicts` half is unchanged.
- **Two-voice drift-lock retargeted.** Forge no longer carries a style copy, so the test now asserts
  the era §2b parses from the bible **verbatim** (exact string equality) and the era suffix appears
  verbatim in `visual-grammar.md`, plus `not hasattr(forge, "HARDENED_SCENE_STYLE")` so a third
  voice cannot reappear silently. Renamed
  `test_the_look_is_stated_in_exactly_two_voices_at_the_two_ends`.
- New sibling test `test_the_tail_voice_reaches_every_scene_request_and_no_step1_card` pins E2's
  routing.

### E5 — `airbrush\w*` KEPT

Unchanged in the C-2 banned-prose list (`lint_shots.py:1389`). It guards authored prose, not
provider prompts. A new assertion in `test_c2a_the_render_technique_ban_still_owns_authored_prose`
pins that it still fires on a `still_prompt`.

### E6 — the suffix LINT, which blocked acceptance (not in the brief; flagged)

`suffix_one_voice_check` was the enforcement arm of the doctrine E1/E2/B3 revert: it HARD-failed any
style vocabulary in `global_prompt_suffix` ("the suffix states LETTERING ONLY"). With the era suffix
restored it fired **11 HARDs** on `shots.json`, making the acceptance criterion "zero HARDs"
unreachable by construction.

Retargeted rather than deleted, so the one-voice law survives where it is mechanically decidable:

- DELETED: `_SUFFIX_SOFT` (gentle/soft/blend/feather) and `_SUFFIX_STYLE_VOCAB` (the recipe's own
  terms) — both banned exactly what the suffix is now FOR.
- DELETED: the C-2 render-technique ban's application to the suffix. It guards authored per-shot
  prose; the channel suffix legitimately names `flat gradient sky/ground` and `no photorealism` as
  fixed human-approved channel data. It is untouched on `still_prompt` / thumbnail / `first_frame`.
- ADDED: `channel_suffix(vdir)` + a verbatim-copy check. The suffix has ONE home
  (`visual-grammar.md`'s header blockquote) and a video's `shots.json` carries a COPY; byte-drift
  between them is the second-voice mechanism under another name, and unlike a word list it cannot
  false-positive on correct text. An empty suffix HARD-fails (it would delete half the LOOK from
  every gen). An unreachable kit downgrades to the non-empty check rather than inventing a canonical.

Six `test_doctrine_reset_guards.py` tests encoded the old doctrine and were retargeted accordingly,
including the e2e wiring test.

---

## F. `shots.json` (bricks-fresh)

`global_prompt_suffix`: `"hand-lettered marker capitals for any in-world text"` (46 chars) → the
643-char era suffix. Written by surgical string replacement on the raw JSON text so no other byte in
the file moved. Verified: `doc["global_prompt_suffix"] == era_text == grammar_header_line[2:]` — all
three True. No other shots.json change (the 17 shot repairs are a separate worker's).

---

## G. Dedup sweep — every deletion, with its surviving owner

Owners after this wave: **style voices** = §2b (head) + `global_prompt_suffix` (tail), and nothing
else · **depth/vantage** = style-bible §5's amended Environments phrase · **framing facts** = VPW
SKILL step 4's must-state list · **lettering** = the grammar suffix line + style-bible §5's lettering
block.

| # | Deleted from | The sentence/clause | Surviving owner |
| --- | --- | --- | --- |
| D-1 | style-bible §5 | the whole `PLATES are STAGE SETS (LOCKED …)` bullet — frontal/eye-level/one-point-at-most, "depth comes from OVERLAPPING PLANES", the open-floor-plane rule | §5 Environments: `edge-to-edge, depth read by overlap and scale, eye-level frontal` |
| D-2 | style-bible §3 | the `insertability` review-axis row | none — the axis is retired with the stage-set paragraph (the review-artifact code keeps its own row; see the residual below) |
| D-3 | visual-grammar §3 | the `PLATES are not a framing choice — they are a STAGE SET…` bullet, which restated D-1 and cited `insertability` | §5 Environments (same as D-1) |
| D-4 | visual-grammar §3 | `Unchosen, it defaults to a centered eye-level medium — fine once, deadly on repeat` | §5's `eye-level frontal` — stated as a positive law rather than a failure state |
| D-5 | visual-grammar header | `Texture, line weight, and art style are stated ONCE, in style-bible.md §2b …, never through this suffix.` | the two-voice sentence that replaced it (§2b head + suffix tail) |
| D-6 | style-bible §3 | `Head tone — one uniform flat tone, no gradient, no airbrush, no soft shading, no realistic skin.` → restored to era verbatim `one uniform flat tone (no gradient, no realistic skin, no blush)` | `no soft shading` directly contradicted restored §2b's `gentle soft cel shading`; the airbrush gate survives with ONE owner, the §3 `line-register` row (`airbrushed or gradient skin FAILs`) |
| D-7 | forge.py | the entire `HARDENED_SCENE_STYLE` block (a third style voice) | §2b + the suffix — itemised clause-by-clause in E1 |
| D-8 | lint_shots.py | `_SUFFIX_SOFT` + `_SUFFIX_STYLE_VOCAB` and their "the suffix states LETTERING ONLY" refusals | the suffix IS a style voice now; the one-voice law is the verbatim-copy check against `visual-grammar.md` |
| D-9 | lint_shots.py | the C-2 render-technique ban's application to `global_prompt_suffix` | C-2 still owns authored prose (`still_prompt`, thumbnail `gen_prompt`, short `first_frame`) |
| D-10 | image-generation SKILL.md ×4 | `forge's hardened scene descriptor` (:70), `Forge appends ONE hardened flat-cel/palette block to every scene request.` (:108), `zero-seed under the hardened descriptor` (:217), `mode with the hardened scene descriptor` (:421) | replaced by the two-voice statement; these named a constant that no longer exists |
| D-11 | image-generation SKILL.md :108 | `No OTHER image style anchor exists: hardened descriptor text was the probe winner over a rendered-scene anchor.` | amended to name the §5 scene style tile as the ONE registered image style anchor — the sentence already contradicted the tile plumbing described 30 lines below it in the same file |
| D-12 | image-generation SKILL.md :361 | `fore/mid/background depth` in the style/taste review question | `layered depth by overlap and scale (§5)` — points at the owner |
| D-13 | forge.py `why` text | `PLATE — place-first frame, hardened descriptor, no content anchor` | `bible descriptor + style suffix` |
| D-14 | shots-schema.md :84 | `seedless roots under the hardened descriptor` | `under the bible descriptor + style suffix` |
| D-15 | lint_shots.py :1455 / :1533 | two comments referencing "the hardened scene style" | reworded to "the channel's two style voices" / "the bible descriptor + style suffix" |
| D-16 | forge.py style-anchor role prose | `the LINE REGISTER (that outline weight, thick and uniform, with no element drawn finer and no hairline or micro-pattern detail anywhere) and the flat warm PALETTE discipline` | the era README spec (line weight, `#241a12`, flat-cel render, palette discipline) |

**Residual flagged, not fixed:** `build_review_artifact.py` still emits an `insertability` review row
(with 4 passing tests behind it). Deleting it is a review-surface change with its own test wave and
sits outside A–G's named scope; the doctrine row it cited (style-bible §3) is gone, so the artifact
row is now un-anchored. Boss call.

---

## H. Acceptance evidence

| Check | Result |
| --- | --- |
| `image-generation/scripts` pytest | **200 passed** (baseline 199; +2 new, −1 merged) |
| `visual-prompt-writer/scripts` pytest | **252 passed** (baseline 253; 6 doctrine tests retargeted into 5, +1 e2e merged from 2) |
| forge whole-file dry-run over bricks-fresh | **exit 0**, `297 prompts assembled, 0 API calls, 0 files written` |
| refusals in the dry-run | **0** (`ERR ` count 0, tracebacks 0) |
| era suffix at TAIL of every scene request | **248 / 248** |
| era §2b at HEAD of every scene request | **248 / 248** |
| STEP-1 cards carrying the suffix | **0 / 49** (deliberate — see E2) |
| HARDENED block remnants across all 297 prompts | **0** for each of 9 distinct clause probes |
| style tile seeds cast-free plates only | 58 requests carry the `style-anchor` role; **0** of them are figure-bearing |
| tile role prose is the era spec | 58 / 58 |
| resolution tier in every emitted request | **1K** (only tier present) |
| `blockquote_after` on the edited bible | §2 → 777 chars · §2b → 290 · §2c → 795 · **§2d → 964** — all four parse |
| `lint_shots.py` on bricks-fresh shots.json | **exit 0, HARD violations: none** (13 pre-existing heads-up, unchanged) |

### Dry-run mechanics (two harness notes, no repo mutation)

1. This worktree has no repo-root marker file, so `Kit` cannot walk up to find the root. The dry-run
   was driven **in-process** with `k.root` set explicitly — exactly what the forge test suite does.
   An attempt to create an empty marker was correctly **BLOCKED by the hard-ceiling guard**; it was
   not worked around, and no credential file was read, created, or copied. `dry=True` loads no key
   and builds no request URL, so the path cannot reach the engine.
2. The worktree is detached at a commit predating three cast ref dirs (`auditor-rep`,
   `brick-foreman`, `hq-banker`) that exist and are tracked in the main checkout. Seed RESOLUTION
   falls back to the main checkout in the harness only; no file was written into the worktree and no
   prompt text came from the fallback.

### Sample assembled request — L01, head and tail

Head (bible era §2b, verbatim, first bytes of the prompt):

```
Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even
MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, simple flat colours with gentle
soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.
```

…then the §2d CROWD-RIG clause, the §2c RIG-HOLD block, the SEED ROLES prose, then the authored
payload, which begins:

```
A wood-panelled suburban den at dusk, wide static eye-level from the doorway. A boxy television on a
low walnut cabinet holds the centre with its screen dark and blank; orange shag carpet runs to the
f…
```

Tail (era `global_prompt_suffix`, verbatim, last bytes of the prompt):

```
Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm
brown-black (#241a12) outline on everything, flat cel colours with gentle soft shading, rounded
friendly shapes, no realistic detail; built-but-flat environment (flat gradient sky/ground + minimal
geometry + one foreground depth prop); any in-world lettering hand-lettered in the marker style,
short and legible; locked 2-3 colour scene palette plus the single red accent #d7402b used only
semantically (alarm / prohibition / ownership / the last punch element); no photorealism, no
on-screen narrator or host face, no unrequested text, no logos; 16:9.
```

(The tail is one unwrapped line in the actual request; wrapped here for the page.)

---

## I. Open items for the boss

1. **The archaeology's own prediction is now live.** Caveat §7: restoring `gentle soft cel shading`
   **without** its era companions is "the one combination this archaeology predicts will fail". Two
   of the three companions are now restored — 1K rendering (E3) and a mandatory pixel anchor on
   cast-free gens (the style tile, kept). The third, the era's per-shot authored palette saturation
   (warm 93%, `#d7402b` 82%), is NOT restored: bricks-fresh sits at 26% / 5%. The restored suffix
   states the palette law on every call, but the era also hand-wrote it into 109 of 117 prompts.
   This wave did not touch shot prose (the 17 shot repairs are a separate worker), so the palette
   half remains open.
2. **E6 was not in the brief.** The suffix lint had to be retargeted or "zero HARDs" was unreachable.
   It is the enforcement arm of the reverted doctrine, so the retarget is in the wave's spirit — but
   it is a live lint law and worth an explicit ruling.
3. **`knowledge/stack.md`'s per-video cost estimate** now over-estimates ~3× (out of scope, E3).
4. **`build_review_artifact.py`'s `insertability` row** is un-anchored after A3 (see G, residual).
5. **The brief's "609-char" suffix is 643 chars.** The 609 figure is a wrap artefact in the
   archaeology doc, not the era text.
