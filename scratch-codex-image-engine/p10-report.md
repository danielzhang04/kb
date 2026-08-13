# P10 production-shape composer report

Mode: fake only. No real generation was requested or run.

## Delivered

- `p10_matched.py` — 335 lines.
- `test_p10_matched.py` — 108 lines, 8 tests.
- Fake artifacts: `.superpowers/sdd/2026-08-11-codex-image-engine/p10-fake-results-final/`.

The driver preserves Forge's ordered roles and paths, using only the established
missing-staged-file resolution (baseline substitution for a Forge-named earlier
scene, or fake placeholders). It does not trim a place plate or add a Gemini
baseline anchor. It uses `forge_codex` only via `RunOptions(compose_fn=...)`.

Fake 8/8 completed with staged names `L*-p10-match-r1`; a second run resumed
with zero `run_item` calls. The real-mode gate returns exit 2 without
`--i-am-the-boss-with-p10-go`.

## Verification

- P10: 8 passed.
- Engine `test_forge_codex.py`: 132 passed (one Pillow deprecation warning).
- P6 siblings: 8 passed.
- P7 siblings: 15 passed.
- P8 siblings: 9 passed.
- `git diff --check`: clean.
- Entropy scan: zero hits in the two P10 files.

## Composed L28 prompt (fake mode, verbatim)

```text
Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, flat colours laid down at FULL cel strength — every fill a real colour, and any grey or neutral clearly TINTED warm or cool, so a cold scene reads COLD-COLOURED and never drains to greyscale — with gentle soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.
Image 1: lettering exemplar — use its hand-lettering style only.
Image 2: production style tile — cast-free style reference (line register + palette only); do not copy objects or layout.
A single-storey assembly floor seen wide and head-on, entirely empty of people: two long steel benches running back into the depth with anti-static mats and part trays laid along them, a rack of empty tote bins stage-left, a roller door shut at the far end, strip lights in rows overhead. Cool grey-teal-cream palette, flat even industrial light, foreground depth from a cropped bench end cutting the lower-right corner. Over the entrance at the back of the floor hangs a plain painted board carrying one word: 'MINISCRIBE'.
Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm brown-black (#241a12) outline on everything, flat cel colours with gentle soft shading, rounded friendly shapes, no realistic detail; built-but-flat environment (flat gradient sky/ground + minimal geometry + one foreground depth prop); any in-world lettering hand-lettered in the marker style, short and legible; locked 2-3 colour scene palette plus the single red accent #d7402b used only semantically (alarm / prohibition / ownership / the last punch element); no photorealism, no on-screen narrator or host face, no unrequested text, no logos; 16:9.
Avoid: photorealism, painterly or 3D-render look, specular highlights, glossy or plastic or metallic sheen, reflections, ambient occlusion, global gradients, bevels, rim light, bloom, volumetric light, 3D material rendering, heavy solid-black ink, on-screen narrator or host face, logos, watermark, depth-of-field blur, bokeh, soft focus, words, letters, numerals or signage EXCEPT the exact string(s): MINISCRIBE.
```

## Composed L36 prompt (fake mode, verbatim)

```text
Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, flat colours laid down at FULL cel strength — every fill a real colour, and any grey or neutral clearly TINTED warm or cool, so a cold scene reads COLD-COLOURED and never drains to greyscale — with gentle soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.
Image 1: character reference — match exactly — do not copy its background or style.
Image 2: lettering exemplar — use its hand-lettering style only.
`miniscribe-rep`, `expr-greedy`, `action-powerstance`, planted on top of a banded bale of banknotes the size of a car that fills the centre of the frame. Two smaller bales sit stage-left and stage-right at half its height on a flat cream ground, charcoal-cream-green palette, even frontal light, foreground depth from a cropped bale corner across the bottom of the frame. The wide paper band strapping the big bale carries the stencilled figure '125 MILLION'.
Surface colors: money-bill paper fill exactly #d3d3a9 (light sage — NOT dark olive); bill hatching as thin #7b835e linework only; oval seals on bill faces #b8c493; wrap band cream #f4e5c8 with black marker-caps text.
Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm brown-black (#241a12) outline on everything, flat cel colours with gentle soft shading, rounded friendly shapes, no realistic detail; built-but-flat environment (flat gradient sky/ground + minimal geometry + one foreground depth prop); any in-world lettering hand-lettered in the marker style, short and legible; locked 2-3 colour scene palette plus the single red accent #d7402b used only semantically (alarm / prohibition / ownership / the last punch element); no photorealism, no on-screen narrator or host face, no unrequested text, no logos; 16:9.
Avoid: photorealism, painterly or 3D-render look, specular highlights, glossy or plastic or metallic sheen, reflections, ambient occlusion, global gradients, bevels, rim light, bloom, volumetric light, 3D material rendering, heavy solid-black ink, on-screen narrator or host face, logos, watermark, depth-of-field blur, bokeh, soft focus, words, letters, numerals or signage EXCEPT the exact string(s): 125 MILLION.
```

## Mojibake finding

The current shared writer is not the corruption source: `forge_codex.write_prompt_file`
writes with `encoding="utf-8"` and preserves the composer's LF output (`newline=""`).
The current P6/P7/P8 sources and their available `_codex/prompts/*.txt` archives also
contain zero matches for the P10 mojibake regex. The historical P8 artifact described
in the contract is therefore not present in this checkout, so a more specific source
cannot be established from observed code. P10 prevents recurrence by composing normal
Unicode, ending its output with `\n`, and rejecting `Ã¢â‚¬` / `Ãƒ.` before the shared writer
is called.

## Disclosed contract tension

The requested literal §2b head plus literal video suffix are already roughly 1,700
characters together. With the mandatory still prompt, seed roles, and Avoid line, no
target can satisfy the stated 1,300–1,900 target band without deleting required
content. P10 enforces the specified hard limit instead: all eight prompts are
2,006–2,371 characters (<2,600), with no trimming.
