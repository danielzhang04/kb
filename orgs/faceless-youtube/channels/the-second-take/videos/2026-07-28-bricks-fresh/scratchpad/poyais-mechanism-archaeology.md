# Poyais-era art-style MECHANISM — archaeology (2026-07-04 → 2026-07-18)

Read-only reconstruction from git history + the era's own files. Nothing changed, nothing committed.
Method: the faceless-youtube tree was imported wholesale, so era state is pinned at the import SHAs,
not at a per-file commit series.

---

## 1. Era file inventory (with SHAs)

| SHA | Date | What it is |
| --- | --- | --- |
| `c3c749d` | 2026-07-15 | "Import faceless-youtube snapshot into orgs/ (text/config only)" — **mid-poyais** state. style-bible.md = 598 lines, §2/§2b/§2c/§2d/§2e already present. |
| `ff36f63` | 2026-07-19 | "import live faceless-youtube working tree" — **end-of-era**, the state that produced the shipped poyais video. style-bible.md = 775 lines. **This is the era authority below.** |
| `6735796` | 2026-07-30 | bricks fix-wave — the commit that **deleted the era's three style-anchor register frames**. |
| `7f38d18` / current | 2026-08-04→05 | today's state (`claude/bricks-doctrine-reset`). |

Era visual-kit layout @ `ff36f63` (differs from today):

```
visual-kit/
  style-bible.md          775 lines, §0 §1 §2 §2b §2c §2d §2e §3 §4 §5 §6 §7 §8 §9 §10
  visual-grammar.md
  registry/registry.json  engine: gemini-3-pro-image
  refs/base/              51 rig primitives (poses, expressions, interactions, crowd-exemplar)
  refs/env/               README.md + 5 anchors  ← THE STYLE MECHANISM
    env-exterior-vivid.png     (from Poyais L05, human-gated 2026-07-15)
    env-exterior-muted.png     (from Poyais L22, human-gated 2026-07-15)
    env-map-parchment.png      (from Poyais L15 plate, human-gated 2026-07-15)
    lettering-marker-italic.png
    stamp-block-outlined.png
  refs/<char>/            base, macgregor, bolivar, mosquito-king, strangeways, hastie, hastie-wife
  scripts/, sweep2/, brand/, audio/
.claude/skills/image-generation/
  SKILL.md
  scripts/forge.py        443 lines  (today: 2316)
videos/2026-07-04-poyais/shots.json   117 long-form shots, generated 2026-07-14
```

**Today's `refs/env/` (for contrast):** `lettering-marker-italic.png`, `stamp-block-outlined.png`,
`prop-beige-pc.png`, `prop-drive.png`, `scene-style-tile.png` (untracked — no git history), README.
The three era **register anchors are gone**, deleted in `6735796`.

---

## 2. Verbatim era descriptor texts

### 2.1 Era `forge.py` prompt assembly (`ff36f63`, lines ~186–196) — the whole thing

```python
def prompt_for(self, mode, delta, hold=False):
    if mode == "identity":
        text = self.desc_identity + "\n\n" + delta
    elif mode in ("new_character", "environment", "style"):
        text = self.desc_style + "\n\n" + delta
    else:
        raise SystemExit(f"unknown mode '{mode}'")
    if hold and self.desc_righold:
        text = text + "\n\n" + self.desc_righold
    return text
```

Three descriptors, all read verbatim from the bible by blockquote. **No hardening block. No
negation list beyond what the bible blockquote itself carried.**

### 2.2 Era §2b STYLE-ONLY descriptor — VERBATIM (`ff36f63`, style-bible.md:90-93)

> Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even
> MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, simple flat colours with gentle
> soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.

This is the descriptor that governed **every environment / plate / cast-free gen** in poyais.

### 2.3 Era §2 LOCKED STYLE descriptor (identity mode) — closing style clause, verbatim

> ...SAME clean FLAT cel cartoon style, even medium-thick line.
> Reads unmistakably as the same guy. No text, plain soft light-grey studio background.

### 2.4 Era §2c RIG-HOLD — closing style clause, verbatim

> ...SAME even medium-thick dark warm brown-black (#241a12) outline, SAME clean FLAT cel render.

### 2.5 Era poyais `global_prompt_suffix` — VERBATIM (the trailing style voice)

```
Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm
brown-black (#241a12) outline on everything, flat cel colours with gentle soft shading, rounded
friendly shapes, no realistic detail; built-but-flat environment (flat gradient sky/ground +
minimal geometry + one foreground depth prop); any in-world lettering hand-lettered in the marker
style, short and legible; locked 2-3 colour scene palette plus the single red accent #d7402b used
only semantically (alarm / prohibition / ownership / the last punch element); no photorealism, no
on-screen narrator or host face, no unrequested text, no logos; 16:9.
```

609 characters. VPW baked a per-shot–tailored condensation of this into the **tail** of each
`still_prompt`. Per era SKILL.md:211-213 — *"forge.py auto-prepends the bible descriptor (§2/§2b by
mode); your delta is the shot's `still_prompt` (which already carries the file's
`global_prompt_suffix` AND the authored framing/composition — VPW owns it)"*.

### 2.6 Era `house_style.palette` (poyais shots.json)

```
locked 2-3 colour scene palette per beat + the one red accent #d7402b; character colours fixed
(cream/tan heads, #241a12 outline)
```

### 2.7 Era seed law — the HARD ERROR that no longer exists (`ff36f63` forge.py cmd_gen)

```python
if mode in ("identity", "new_character"):
    seeds = [k.base_frame(r.get("character", "base"))]
else:
    raise SystemExit(
        f"{name}: environment/style gens must carry a style-anchor seed (a refs/env/ "
        "anchor, the target plate, or an approved on-style scene) — unseeded gens fall "
        "back to a stock-clipart prior")
```

And era SKILL.md's seeding law, verbatim:

> a **style anchor / plate — MANDATORY on every scene/plate gen, not just character-free ones**
> (the character seeds pin identity, NOT art style; pick the shot's continuity parent frame — a
> prior in-stage/set frame or the plate this scene evolves — else a `refs/env/` register anchor,
> else an approved on-style scene). **Cross-chunk ART-STYLE drift is the proven failure when scene
> gens run unanchored** (a batch of cast-seeded-but-style-unanchored scenes drifted to different
> renders chunk-to-chunk — a softer/detailed-middle look, mismatched line weight; human-caught
> 2026-07-16).

And the era `refs/env/README.md`, verbatim:

> Style-anchor seeds for character-free generations (environments, plates, prop cutouts). `forge.py`
> hard-errors on an unseeded `environment`/`style` gen; these anchors are the default seed when no
> better one exists (the target plate or the prior frame in a chain always beats a generic anchor).
> ... Pick the anchor whose REGISTER matches the shot — **the anchor pins line weight, outline color
> (`#241a12`), flat-cel render, and palette discipline, not the content**

---

## 3. Poyais shots.json — seeding + prose stats (117 long-form shots)

The era shot schema had **no `seeds` field**. Seeds were derived at gen time from `cast` +
`stage`/`stage_role` + the mandatory style anchor. Shot keys:
`beat, cast, changed_elements, duration_s, from_cue, id, narration_type, notes, on_screen_text,
props, shot_class, source, stage, stage_role, start_hint, still_prompt, synthetic, transition_in,
vo_ref, vo_text`.

### 3.1 Pixel-anchor structure

| Cohort | Count | % | What it seeded |
| --- | ---: | ---: | --- |
| Shots with ≥1 `cast` entry (character canonical + `pose_ref` + `expression_ref`) | **44** | 38% | char canonical + pose frame + expression frame **+ a mandatory style anchor** |
| Shots with a `stage` (held-set chain) | 35 | 30% | `stage_role: base` (13) → seeds the anchor; `stage_role: delta` (22) → seeds its chain parent |
| Shots with BOTH cast and stage | 10 | 9% | — |
| Shots with **neither** (pure environment / symbolic) | **48** | 41% | **a `refs/env/` register anchor or a prior on-style frame — never zero-seed (hard error)** |
| Crowd-bearing (§2d wording authored inline) | 33 | 28% | + `refs/base/crowd-exemplar.png` |

`cast` was 44 shots, 34 of them MacGregor (12 distinct pose×expression combos); plus bolivar,
mosquito-king, strangeways, hastie, hastie-wife.

**The headline: 100% of poyais gens carried at least one pixel anchor.** Character-bearing frames
were anchored by canonicals; the 48 cast-free frames were anchored by a register exemplar. Zero
frames ran on text alone.

### 3.2 Style + palette in shot prose (all 117 `still_prompt`s)

| Signal | Poyais era | Today (bricks-fresh, 248 shots) |
| --- | ---: | ---: |
| mean `still_prompt` length | **862 chars** | 594 chars |
| explicit `Palette:` clause authored per shot | 102 (**87%**) | 202 (81%) |
| names `#d7402b` / "red accent" | 97 (**82%**) | 13 (**5%**) |
| says "warm" | 109 (**93%**) | 66 (**26%**) |
| carries `#241a12` inline | 115 (**98%**) | 0 (**0%**) |
| carries "flat-cel" / "house style" inline | 116 (**99%**) | 0 (**0%**) |
| style words in the **last 300 chars** | 102 (**87%**) | 0 (0%) |
| `global_prompt_suffix` length | **609 chars** | **46 chars** ("hand-lettered marker capitals for any in-world text") |

Sample era tails (the style voice sat at the END, where these models weight hardest):

- L34 — `…-black (#241a12) outline, flat cel colours, rounded shapes; built-but-flat; marker lettering only; locked 2-3 colour palette plus the single red accent #d7402b used only semantically; no photorealism, no on-screen narrator, no unrequested text, no logos; 16:9.`
- L01 — `…Palette: cool grey-blue dock, warm gold horizon glow; one red accent on a single ship pennant. Filled edge-to-edge, no dead air. […] Flat-cel 2.5D vector house style, even medium-thick #241a12 outline, warm cel shading with genuine depth (not flat or empty); any in-image text hand-lettered marker and legible; no on-screen narrator or host face; 16:9.`

**Answer to "committed warm palette — authored or emergent?": AUTHORED, per shot, at 93%
saturation**, on top of a suffix that named the 2–3-colour + one-red rule in every prompt. It was
never emergent. Today it is 26% / 5%.

Also note L01's `warm cel shading with genuine depth (not flat or empty)` — the era actively pushed
*against* flatness at the shot level while the descriptor held flat-cel. The two pulled in opposite
directions and the equilibrium is the poyais look.

---

## 4. Mechanism delta table — era vs today

| # | Mechanism | POYAIS ERA (`ff36f63`) | TODAY | Plausible register effect |
| --- | --- | --- | --- | --- |
| **D1** | **§2b STYLE-ONLY descriptor text** | *"**Draw in the SAME art style as the reference image**: a clean FLAT cel-shaded **CARTOON** look, an **even** MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, **simple flat colours with gentle soft cel shading**, rounded friendly shapes, no realistic detail. No text, no words, no labels."* | *"MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, flat colour fills — one flat base colour per surface plus at most ONE hard-edged single-step shadow shape, no feathered or blended transitions, uniform highlight-free surfaces — rounded friendly shapes, no realistic detail. No text, no words, no labels."* | **Largest text delta.** Lost: the seed-authority sentence, the word **CARTOON**, the word **even** (line-weight evenness), and the soft-cel clause. Gained: technical vector-illustration wording ("uniform highlight-free surfaces", "single-step shadow shape"). Cartoon→vector-diagram register shift; thinner/harder line read; flatter, less committed colour. |
| **D2** | **Hardening block** | **None.** Only the bible blockquote. Its negations were content-level ("no realistic detail", "no photorealism", "no unrequested text, no logos"). | `HARDENED_SCENE_STYLE`, added 2026-08-04, auto-appended to every `environment`/`style` scene gen: *"NO gradient; NO gloss or specular highlight; NO bloom; NO depth-of-field blur or soft focus; NO subsurface or rim light; NO photorealistic texture."* | Six render-technique negations, four with **no era ancestor**. A negation-dense prompt drives this provider toward its flat-vector/clipart prior — precisely a thinner, harder line and desaturated, uncommitted fills. |
| **D3** | **Style-anchor pixel seed on cast-free gens** | **MANDATORY**. `cmd_gen` HARD-ERRORS on an unseeded `environment`/`style` gen: *"unseeded gens fall back to a stock-clipart prior"*. 3 register anchors in `refs/env/` (vivid exterior / muted exterior / parchment map), themselves promoted poyais frames (L05/L22/L15). 48/117 cast-free shots used them. | **Forbidden.** SKILL.md:108 — *"No OTHER image style anchor exists: hardened descriptor text was the probe winner over a rendered-scene anchor."* Zero-seed legal for derived place plates + no-place shot classes. The three era anchors DELETED in `6735796`. | **The mechanism inversion.** The era's own diagnosis of unanchored gens — *"a softer/detailed-middle look, mismatched line weight"* — is exactly the drift class under investigation. Cast-free frames now re-synthesize line weight and palette from prose on every call. |
| **D4** | **Where style words sit in the prompt** | Style stated **twice, both ends**: descriptor at the head, a 609-char `global_prompt_suffix` condensation at the **tail** of 87% of `still_prompt`s. 98% carried `#241a12`; 99% carried "flat-cel"/"house style". | Stated **once, head only**. `global_prompt_suffix` = 46 chars, lettering only. 0% of shot prose carries `#241a12` or "flat-cel". Style is 100% delegated to the descriptor. | Last-position dominance is real on this provider. The era sandwiched scene content between two style statements; today the only style statement is the furthest token from the image decision. |
| **D5** | **Palette commitment** | Authored per shot: "warm" in 93%, `#d7402b` in 82%, an explicit `Palette:` clause in 87%, plus the suffix's "locked 2-3 colour scene palette plus the single red accent" on every call. | "warm" 26%, `#d7402b` 5%. The only palette pressure is `HARDENED_SCENE_STYLE`'s one sentence: *"Commit the authored scene palette; it is never neutral grey alone."* | The "committed warm palette" was never emergent — it was 109 hand-written warm clauses. Removing them removes the palette. |
| **D6** | **Engine resolution** | `imageConfig: {aspectRatio}` only — **no `imageSize`** ⇒ provider default (1K). | `imageConfig: {aspectRatio, imageSize}`, `IMAGE_SIZE_DEFAULT = "2K"`. | Same model (`gemini-3-pro-image` both eras), 4× pixel count. At 2K the same "medium-thick" instruction renders a **proportionally finer stroke** and the model spends the extra budget on detail the era never had room for. A direct, under-suspected line-weight and detail-density mover. |
| **D7** | Aspect | `--aspect 16:9` per scene, forge default `2:3` | unchanged | none |
| **D8** | Engine | `gemini-3-pro-image` | `gemini-3-pro-image` | none |
| **D9** | Cast seeding structure | structured `cast[]` with `pose_ref`/`expression_ref` → canonical + pose + expression frames, cap 4 | backticked slugs in prose → THE SEEDING LAW preflight, cap 4, `fig-` step-1 frames | Not a regression — today's is stricter. **Not a lean-back candidate.** |

Nine deltas; **six** (D1–D6) plausibly move line register or palette.

---

## 5. Proposal — minimal lean-back edits, ranked

Ranked by (register impact ÷ edit size). Every edit restores era text verbatim or era structure; no
new adjectives are invented anywhere below.

### E1 — Restore the era `global_prompt_suffix` and its TAIL position (D4 + D5)

Biggest effect, smallest edit, zero code change. This one instrument carries line weight, palette
discipline, the red-accent law, and the built-but-flat environment rule, and puts them in
last position on every call.

**File:** `videos/2026-07-28-bricks-fresh/shots.json`

BEFORE:
```json
"global_prompt_suffix": "hand-lettered marker capitals for any in-world text"
```
AFTER (verbatim era text, poyais shots.json @ `ff36f63`, with `16:9` kept):
```json
"global_prompt_suffix": "Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm brown-black (#241a12) outline on everything, flat cel colours with gentle soft shading, rounded friendly shapes, no realistic detail; built-but-flat environment (flat gradient sky/ground + minimal geometry + one foreground depth prop); any in-world lettering hand-lettered in the marker style, short and legible; locked 2-3 colour scene palette plus the single red accent #d7402b used only semantically (alarm / prohibition / ownership / the last punch element); no photorealism, no on-screen narrator or host face, no unrequested text, no logos; 16:9."
```

**Plus** the era's authoring rule that made it work: VPW appends a per-shot condensation of the
suffix to the **tail** of every `still_prompt` (era: 87% of shots), and authors an explicit
`Palette: <2-3 colours>; one red accent on <element>.` clause (era: 87% / 82%). Today's shots hit
81% on `Palette:` already — the gap is the *content* of those clauses (warm 26% vs 93%) and the
missing trailing style sentence.

### E2 — Restore §2b verbatim; cut the four hardening clauses with no era ancestor (D1 + D2)

**File:** `visual-kit/style-bible.md` §2b blockquote

BEFORE (current):
> MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, flat colour fills — one flat
> base colour per surface plus at most ONE hard-edged single-step shadow shape, no feathered or
> blended transitions, uniform highlight-free surfaces — rounded friendly shapes, no realistic
> detail. No text, no words, no labels.

AFTER (era verbatim, `ff36f63` style-bible.md:90-93):
> Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even
> MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, simple flat colours with gentle
> soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.

**File:** `image-generation/scripts/forge.py`, `HARDENED_SCENE_STYLE`

The 2026-08-04 audit added this block to resolve a contradiction ("gentle soft cel shading" in one
place vs "NO gradients" in another). The era never had that contradiction because it never had a
NO-list — it had only the soft side. Restoring §2b re-introduces "gentle soft cel shading", so the
NO-list must shrink or the contradiction returns inverted.

Minimal era-faithful cut — keep only the clauses with an era ancestor in the suffix
("no photorealism", "no realistic detail", "flat cel colours"), delete the four with none:

BEFORE:
```
"...even medium-thick dark warm brown-black outlines on everything. NO gradient; NO gloss or
specular highlight; NO bloom; NO depth-of-field blur or soft focus; NO subsurface or rim light;
NO photorealistic texture. Commit the authored scene palette; it is never neutral grey alone."
```
AFTER:
```
"...even medium-thick dark warm brown-black outlines on everything. NO photorealism, NO
photorealistic texture. Commit the authored scene palette; it is never neutral grey alone."
```

**Candidate deletions in the current §2b — wording with NO era ancestor** (flagged as asked; these
are not survivors, they are 2026-07-30/08-04 inventions):
- `flat colour fills — one flat base colour per surface plus at most ONE hard-edged single-step shadow shape`
- `no feathered or blended transitions`
- `uniform highlight-free surfaces`

**Missing era survivors that should return** (present in the era, absent today):
- `Draw in the SAME art style as the reference image:` — **the sentence that makes a seed a style authority.** Without it the seed is just a picture.
- `a clean FLAT cel-shaded CARTOON look` — the word CARTOON is gone from §2b entirely.
- `an even MEDIUM-THICK…` — "even" (line-weight evenness) was dropped.
- `simple flat colours with gentle soft cel shading`

### E3 — Set scene gens back to the era's resolution (D6)

**File:** `image-generation/scripts/forge.py:52`

BEFORE: `IMAGE_SIZE_DEFAULT = "2K"`
AFTER: `IMAGE_SIZE_DEFAULT = "1K"`   *(the era sent no `imageSize` at all ⇒ provider default 1K)*

One line. The whole poyais board — the reference register — was rendered at 1K. Any line-weight
comparison against poyais that runs at 2K is not comparing the same instrument. Worth running as a
2-frame A/B before adopting, but it is the cheapest experiment on this list.

### E4 — Restore the register-anchor seed for cast-free frames (D3)

Structure, not text — the era's preferred lever, and per Daniel's instruction the one to favour.

1. Restore the three deleted anchors from git (they still exist at `ff36f63`; they are promoted
   poyais frames L05 / L22 / L15):
   `git show ff36f63:.../visual-kit/refs/env/env-exterior-vivid.png` (+ `-muted`, `env-map-parchment`)
   and their registry rows (`kind: environment`, tags `exterior-vivid` / `exterior-muted` /
   `map-parchment`).
2. Restore the era selection rule verbatim from `refs/env/README.md`: *"Pick the anchor whose
   REGISTER matches the shot — the anchor pins line weight, outline color (`#241a12`), flat-cel
   render, and palette discipline, not the content."*
3. Restore the era hard error for unseeded `environment`/`style` gens.

**Conflict to resolve first (do not silently override):** the 2026-08-04 ruling
(`knowledge/decisions.md:3761`) forbids image style anchors, and the 2026-08-04 narrowing forbids
cross-place image seeding. E4 as written contradicts both. See §6 — the probe that decided it never
tested the era's instrument, but re-opening the ruling is Daniel's call, not this document's.

---

## 6. Style-tile verdict

**As currently designed (a content-free swatch card): NO — it is not the faithful equivalent of the
era's anchor.**

**As a content-thin registered ENVIRONMENT register frame: YES — that is exactly what the era ran,
with 117 shots of evidence behind it.**

Evidence:

1. **The era's anchor was a rendered on-style SCENE, not a card.** `env-exterior-vivid.png` =
   poyais L05. `env-exterior-muted.png` = poyais L22. `env-map-parchment.png` = poyais L15 plate.
   All three human-gated 2026-07-15. The README states their job explicitly: *"the anchor pins line
   weight, outline color (#241a12), flat-cel render, and palette discipline, not the content"* —
   and it selected by REGISTER (vivid exterior / muted exterior / parchment document), which is
   precisely a bleed-management strategy: match the register so any bleed is already correct.

2. **The 7-way probe that ruled anchors out tested both ends of the axis and skipped the middle.**
   Per `round-B2-genlog.md` + `decisions.md:3761`:
   - Candidates 1–3 were **abstract swatch fields** — *"evenly spaced rounded rectangles, circles,
     pebble blobs, and arc fragments"*. Result: *"swatch style-cards changed nothing (candidate 3
     bled its swatches)"*. An abstract card has no line weight to inherit, so of course it moved
     nothing and leaked its own geometry.
   - Candidate G was a **full narrative scene from a DIFFERENT place** (L160). Result: *"bled
     catastrophically (L160's people/furniture/calendar replaced the scene)"* — a content-rich
     frame, which is the failure mode the era README's register-matching rule was written to avoid.
   - **Not probed: a content-thin, register-matched, purpose-registered environment exemplar** —
     the era's actual instrument, and the only class with 117 shipped shots of evidence.

3. So the correct reading of the probe is narrower than the ruling it produced. It proved
   *"abstract swatch cards do nothing"* and *"cross-place story scenes bleed"*. It did not test
   *"a register-matched content-thin environment exemplar"*, which is what poyais used on 48/117
   frames without the drift under investigation.

**Recommendation:** if a style tile is built, build it as the era built it — generate/promote ONE
content-thin environment frame per register class, human-gate it, register it `kind: environment`
under `refs/env/`, and select it by register match. Do not build it as a swatch card (probe-refuted)
and do not seed a narrative scene (probe-refuted). And re-run the probe against **that** class
before adopting or re-rejecting it; the existing probe does not decide it.

---

## 7. Caveats

- The era's advantage was **layered**, not single-cause. Six mechanisms (D1–D6) all moved at once
  between 07-19 and 08-04. Restoring one and measuring is the honest sequence; E1 and E3 are
  cheapest, E2 is text-only and reversible, E4 requires re-opening a ratified ruling.
- Poyais itself went through **11 render/rework rounds** (r6–r12, 2026-07-16 → 07-20) with heavy
  human gating. The era's register was not a first-pass output.
- E2's restored "gentle soft cel shading" is the exact phrase the 2026-08-04 audit named as the
  gloss/drift mechanism. It shipped the poyais register anyway, because the era paired it with
  mandatory pixel anchors (D3) and 1K rendering (D6). Restoring the phrase **without** its
  companions is the one combination this archaeology predicts will fail.
