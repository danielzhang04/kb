# Variant D palette forensics — blue/orange convergence

Notation: `V` = `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh`; other doctrine paths are repo-relative.

## Answer

Using an area-and-balance test, the pair-dominant variant frames are **va L01** and **vb L01, L02, L04, L07, L08, L09**; vc has none. The liked comparison also contains **L10, L11, L24**. This is not evidence to ban the pair: vb defaults to it in 6/12 shots, while the expanded liked set uses it in 3/17, for named physical reasons, and also contains neutral-dominant L21–L23 and blue-only L25. The primary fresh cause is authored palette construction; the strongest secondary cause is provider inference in vb L01/L04. The warm/orange style tile is an amplifier, not a blue source.

All variant families were independently reauthored, so va/vb/vc are **not** a controlled suffix A/B. The liked anchor is E2 commit `30d2b7e8` (`doctrine-recon/era-map.md:5`). va/vb final retries are recoverable from their specs/manifests; vc's four final retry overlays were not retained, although its log says each was an exact, issue-specific replacement and dry-run preserved assembly (`claude/bricks-variant-vc:V/scratchpad/vpw-var/genlog.md:157-163,185-192`). No vc frame meets the pair test.

## 1. Measurement

Method: full-resolution PIL/numpy; exclude near-grey pixels at HSV-S < 0.15 for hue statistics; 15° hue bins; warm = [0°,90°) ∪ [300°,360°), cool = [90°,300°); orange O = [15°,45°), blue/teal B = [180°,240°). `CP` is (O+B)/chromatic pixels. A frame is pair-dominant when CP ≥ 50%, O ≥ 10% and B ≥ 10% of chromatic pixels, and O+B ≥ 25% of the whole frame. `grid O/B` is the share of a 4×4 grid whose cell contains ≥10% all-pixel O/B, distinguishing a local accent from a field. The implementation is `V/scratchpad/taste-audit/vd_palette_metrics.py:20-23,48-50,53-98`. Thresholds are an explicit forensic operating definition, not an aesthetic law.

| frame | top-3 hue bins (centre/share of chromatic) | W/C % | R−B | S | V | neutral % | O/B % chromatic | CP % chromatic/frame | grid O/B % | flag |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| va/L01 | 217.5°/40.5%, 22.5°/24.1%, 7.5°/12.8% | 51.3/48.7 | -4.1 | .351 | .474 | 5.5 | 29.0/46.6 | 75.6/71.4 | 50.0/75.0 | YES |
| va/L02 | 22.5°/41.7%, 37.5°/39.7%, 52.5°/6.1% | 89.8/10.2 | 53.6 | .411 | .566 | 4.2 | 81.4/0.0 | 81.4/78.0 | 100.0/0.0 | — |
| va/L03 | 37.5°/34.8%, 22.5°/30.1%, 172.5°/11.0% | 72.2/27.8 | 33.0 | .390 | .494 | 10.7 | 64.9/9.2 | 74.1/66.2 | 93.8/18.8 | — |
| va/L04 | 37.5°/28.6%, 172.5°/25.8%, 157.5°/20.5% | 47.3/52.7 | 8.4 | .272 | .683 | 18.4 | 34.5/0.3 | 34.8/28.4 | 81.2/0.0 | — |
| va/L05 | 22.5°/57.5%, 37.5°/32.5%, 7.5°/2.9% | 95.7/4.3 | 62.3 | .447 | .636 | 14.0 | 90.0/0.0 | 90.0/77.4 | 100.0/0.0 | — |
| va/L06 | 37.5°/44.1%, 22.5°/24.2%, 157.5°/15.9% | 72.8/27.2 | 52.2 | .420 | .677 | 12.2 | 68.3/0.0 | 68.3/60.0 | 100.0/0.0 | — |
| va/L07 | 37.5°/44.2%, 22.5°/23.2%, 172.5°/9.9% | 75.7/24.3 | 30.0 | .334 | .592 | 15.5 | 67.4/3.0 | 70.5/59.5 | 100.0/6.2 | — |
| va/L08 | 22.5°/43.0%, 37.5°/31.4%, 172.5°/6.7% | 81.2/18.8 | 41.4 | .398 | .570 | 9.8 | 74.4/1.9 | 76.3/68.8 | 100.0/6.2 | — |
| va/L09 | 37.5°/64.2%, 22.5°/20.9%, 52.5°/4.5% | 91.7/8.3 | 18.9 | .207 | .640 | 44.6 | 85.1/0.7 | 85.8/47.5 | 87.5/0.0 | — |
| va/L10 | 37.5°/44.1%, 22.5°/22.7%, 157.5°/21.0% | 69.6/30.4 | 49.0 | .418 | .721 | 1.9 | 66.8/0.0 | 66.8/65.5 | 81.2/0.0 | — |
| va/L11 | 22.5°/59.4%, 37.5°/23.5%, 52.5°/9.8% | 93.6/6.4 | 62.7 | .422 | .694 | 19.9 | 82.9/0.0 | 82.9/66.4 | 75.0/0.0 | — |
| va/L12 | 172.5°/38.9%, 37.5°/24.9%, 22.5°/23.8% | 54.8/45.2 | 12.4 | .369 | .598 | 16.0 | 48.7/0.1 | 48.8/41.0 | 75.0/0.0 | — |
| vb/L01 | 22.5°/41.0%, 7.5°/28.4%, 217.5°/10.7% | 82.4/17.6 | 19.7 | .403 | .337 | 15.7 | 48.5/14.6 | 63.1/53.3 | 81.2/25.0 | YES |
| vb/L02 | 202.5°/30.5%, 37.5°/21.7%, 22.5°/16.2% | 47.4/52.6 | 6.5 | .213 | .761 | 49.4 | 37.9/52.0 | 89.9/45.5 | 68.8/81.2 | YES |
| vb/L03 | 37.5°/43.4%, 22.5°/30.1%, 172.5°/10.6% | 77.8/22.2 | 50.2 | .348 | .718 | 18.8 | 73.5/0.0 | 73.5/59.6 | 100.0/0.0 | — |
| vb/L04 | 217.5°/33.2%, 37.5°/25.4%, 22.5°/19.2% | 48.4/51.6 | -0.5 | .169 | .625 | 46.0 | 44.6/49.5 | 94.2/50.8 | 87.5/87.5 | YES |
| vb/L05 | 37.5°/35.8%, 22.5°/31.1%, 127.5°/13.0% | 72.1/27.9 | 40.0 | .350 | .664 | 24.1 | 66.9/3.4 | 70.4/53.4 | 93.8/12.5 | — |
| vb/L06 | 37.5°/33.2%, 52.5°/24.6%, 22.5°/13.8% | 73.2/26.8 | 36.0 | .316 | .721 | 4.7 | 47.0/6.0 | 53.0/50.5 | 100.0/18.8 | — |
| vb/L07 | 37.5°/42.9%, 202.5°/27.0%, 22.5°/22.5% | 67.0/33.0 | 8.3 | .223 | .686 | 41.1 | 65.5/33.0 | 98.4/58.0 | 81.2/50.0 | YES |
| vb/L08 | 37.5°/46.3%, 22.5°/21.1%, 202.5°/15.9% | 70.7/29.3 | 29.6 | .328 | .726 | 3.6 | 67.3/29.3 | 96.6/93.1 | 100.0/50.0 | YES |
| vb/L09 | 37.5°/38.5%, 22.5°/35.5%, 202.5°/7.7% | 82.1/17.9 | 22.5 | .305 | .600 | 21.5 | 74.0/14.3 | 88.3/69.3 | 87.5/50.0 | YES |
| vb/L10 | 22.5°/54.9%, 37.5°/37.7%, 202.5°/2.3% | 95.2/4.8 | 85.1 | .514 | .742 | 2.1 | 92.5/4.2 | 96.7/94.7 | 100.0/12.5 | — |
| vb/L11 | 37.5°/31.2%, 22.5°/29.5%, 97.5°/12.3% | 83.9/16.1 | 46.1 | .395 | .528 | 12.9 | 60.7/0.0 | 60.7/52.8 | 87.5/0.0 | — |
| vb/L12 | 37.5°/47.3%, 82.5°/16.2%, 52.5°/15.9% | 100.0/0.0 | 55.7 | .384 | .636 | 0.2 | 60.1/0.0 | 60.1/60.0 | 100.0/0.0 | — |
| vc/L01 | 37.5°/59.2%, 22.5°/30.2%, 67.5°/6.0% | 98.8/1.2 | 73.6 | .472 | .682 | 1.9 | 89.4/1.2 | 90.6/88.9 | 100.0/0.0 | — |
| vc/L02 | 37.5°/50.3%, 22.5°/34.1%, 7.5°/12.8% | 99.5/0.5 | 71.9 | .453 | .715 | 11.1 | 84.4/0.0 | 84.4/75.0 | 93.8/0.0 | — |
| vc/L03 | 37.5°/73.7%, 22.5°/24.0%, 52.5°/1.8% | 100.0/0.0 | 66.8 | .355 | .831 | 0.3 | 97.7/0.0 | 97.7/97.3 | 100.0/0.0 | — |
| vc/L04 | 37.5°/64.6%, 172.5°/12.8%, 157.5°/7.2% | 76.3/23.7 | 20.8 | .209 | .629 | 42.1 | 70.3/3.2 | 73.4/42.5 | 100.0/6.2 | — |
| vc/L05 | 37.5°/57.3%, 22.5°/29.4%, 142.5°/9.6% | 89.7/10.3 | 48.5 | .334 | .664 | 14.6 | 86.8/0.0 | 86.8/74.1 | 100.0/0.0 | — |
| vc/L06 | 37.5°/76.2%, 22.5°/23.4%, 52.5°/0.2% | 100.0/0.0 | 57.0 | .322 | .768 | 2.0 | 99.6/0.0 | 99.6/97.6 | 100.0/0.0 | — |
| vc/L07 | 37.5°/67.6%, 22.5°/14.6%, 157.5°/9.8% | 84.2/15.8 | 32.9 | .304 | .637 | 14.0 | 82.3/0.0 | 82.3/70.7 | 100.0/0.0 | — |
| vc/L08 | 22.5°/53.4%, 37.5°/34.2%, 142.5°/6.3% | 91.1/8.9 | 79.5 | .539 | .626 | 1.4 | 87.5/0.0 | 87.5/86.3 | 100.0/0.0 | — |
| vc/L09 | 37.5°/65.0%, 22.5°/25.3%, 157.5°/4.1% | 92.4/7.6 | 50.9 | .336 | .682 | 12.7 | 90.3/0.0 | 90.3/78.8 | 100.0/0.0 | — |
| vc/L10 | 37.5°/36.1%, 22.5°/26.9%, 157.5°/12.4% | 74.2/25.8 | 35.8 | .325 | .710 | 17.6 | 63.0/0.1 | 63.1/52.0 | 81.2/0.0 | — |
| vc/L11 | 37.5°/63.9%, 172.5°/14.5%, 7.5°/10.1% | 82.6/17.4 | 32.2 | .238 | .800 | 39.0 | 65.4/0.0 | 65.4/39.9 | 100.0/0.0 | — |
| vc/L12 | 22.5°/67.7%, 37.5°/19.5%, 157.5°/8.2% | 89.4/10.6 | 55.7 | .375 | .659 | 17.2 | 87.2/0.0 | 87.2/72.2 | 100.0/0.0 | — |
| liked/L01 | 22.5°/74.0%, 37.5°/20.4%, 7.5°/5.6% | 100.0/0.0 | 92.7 | .613 | .622 | 0.3 | 94.4/0.0 | 94.4/94.1 | 100.0/0.0 | — |
| liked/L02 | 22.5°/66.8%, 37.5°/17.8%, 7.5°/13.7% | 99.2/0.8 | 86.3 | .569 | .581 | 8.4 | 84.6/0.0 | 84.6/77.5 | 100.0/0.0 | — |
| liked/L03 | 22.5°/52.9%, 7.5°/25.5%, 37.5°/16.4% | 98.0/2.0 | 84.9 | .568 | .580 | 7.7 | 69.3/0.2 | 69.5/64.2 | 100.0/0.0 | — |
| liked/L04 | 22.5°/45.8%, 7.5°/30.0%, 37.5°/15.2% | 97.2/2.8 | 82.0 | .561 | .581 | 5.9 | 61.0/0.3 | 61.3/57.7 | 100.0/0.0 | — |
| liked/L05 | 22.5°/61.3%, 37.5°/33.5%, 7.5°/4.0% | 99.8/0.2 | 65.2 | .407 | .689 | 16.1 | 94.8/0.0 | 94.8/79.6 | 100.0/0.0 | — |
| liked/L06 | 22.5°/67.0%, 37.5°/23.0%, 7.5°/9.4% | 100.0/0.0 | 67.5 | .423 | .687 | 15.3 | 90.0/0.0 | 90.0/76.2 | 100.0/0.0 | — |
| liked/L07 | 22.5°/68.2%, 37.5°/16.3%, 7.5°/14.3% | 99.8/0.2 | 70.3 | .438 | .680 | 12.5 | 84.5/0.1 | 84.6/74.0 | 100.0/0.0 | — |
| liked/L08 | 22.5°/63.3%, 7.5°/20.1%, 37.5°/12.9% | 99.7/0.3 | 68.2 | .426 | .687 | 12.9 | 76.2/0.2 | 76.4/66.6 | 100.0/0.0 | — |
| liked/L09 | 22.5°/74.4%, 37.5°/22.5%, 7.5°/3.1% | 100.0/0.0 | 78.0 | .526 | .612 | 0.1 | 96.9/0.0 | 96.9/96.8 | 100.0/0.0 | — |
| liked/L10 | 217.5°/53.8%, 22.5°/21.3%, 37.5°/9.0% | 36.7/63.3 | 4.5 | .474 | .404 | 5.3 | 30.3/60.1 | 90.4/85.6 | 56.2/81.2 | YES |
| liked/L11 | 22.5°/50.2%, 37.5°/23.6%, 187.5°/13.6% | 83.7/16.3 | 8.5 | .292 | .219 | 24.5 | 73.9/14.4 | 88.3/66.7 | 87.5/25.0 | YES |
| liked/L12 | 22.5°/56.1%, 37.5°/38.0%, 7.5°/5.1% | 99.8/0.2 | 32.9 | .278 | .478 | 37.3 | 94.1/0.1 | 94.2/59.1 | 93.8/0.0 | — |
| liked/L21 | 37.5°/53.1%, 22.5°/26.0%, 172.5°/4.8% | 87.4/12.6 | 5.7 | .125 | .527 | 89.2 | 79.1/1.9 | 81.0/8.7 | 43.8/0.0 | — |
| liked/L22 | 22.5°/59.5%, 37.5°/25.0%, 7.5°/7.4% | 94.2/5.8 | 7.1 | .122 | .531 | 84.4 | 84.5/3.6 | 88.1/13.7 | 68.8/0.0 | — |
| liked/L23 | 37.5°/42.9%, 22.5°/34.6%, 7.5°/16.9% | 95.6/4.4 | 2.1 | .133 | .480 | 70.6 | 77.5/3.3 | 80.8/23.8 | 56.2/0.0 | — |
| liked/L24 | 37.5°/68.2%, 187.5°/21.4%, 22.5°/8.8% | 77.9/22.1 | 35.7 | .350 | .839 | 41.6 | 77.0/21.7 | 98.7/57.7 | 93.8/50.0 | YES |
| liked/L25 | 202.5°/53.9%, 217.5°/36.5%, 37.5°/4.0% | 6.5/93.5 | -20.2 | .239 | .446 | 6.4 | 4.7/91.9 | 96.6/90.4 | 18.8/100.0 | — |

Set means clarify what the flag does. va = 1/12 flags, mean O/B whole-frame 56.1/4.8%, S/V .370/.612, neutral 14.4%; vb = 6/12, 50.4/11.4%, .329/.645, neutral 20.0%; vc = 0/12, **72.7/0.3%**, .355/.700, neutral 14.5%; liked L01–L12 = 2/12, 69.1/5.7%, .465/.568, neutral 12.2%; liked all 17 = 3/17, 54.3/9.9%, .385/.567, neutral 25.8%. Thus vc removed the pair by collapsing orange-only, not by restoring variety. CP alone is misleading when one component is absent; component floors are necessary.

The liked set is not simply less saturated: .385 exceeds vb's .329 (the prior .326 figure used a different 13-frame exemplar selection: `V/scratchpad/taste-audit/threeway-metrics-summary.md:11`). It differs in **sequence distribution**: L01–L09 are largely orange-only, L21–L23 are 70.6–89.2% neutral, and L25 is blue-only (91.9% of chromatic pixels blue, 4.7% orange). Its three pair frames are grounded: L10 is cold night versus lit amber shop; L11 is a warm/dark field with localized teal (grid 87.5/25.0); L24 maps ochre land against blue water. L10 and L24 prove a liked pair may be two fields, not merely an accent. A mandatory third colour is unsupported: mean chromatic share outside O+B is **13.5% liked versus 21.3% vb**.

## 2. Cause trace

Dispatch was audited from emitted assembly fields, not inferred from `shots.json` alone: vb's final retry spec stores seed-role prose plus the final payload (`V/scratchpad/vpw-var/spec-vb-retry1.json:3-27,30-56,59-83,119-172`), and L08 separately stores its parent/tile roles and held palette (`spec-vb-L08.json:3-33`); va's final retry stores the same layers plus its exact suffix (`claude/bricks-variant-va:V/scratchpad/vpw-var/retry-spec-r1.json:3-15`). Forge then assembles descriptor → rig/seed-policy prose → authored payload, with image seeds sent before text (`image-generation/scripts/forge.py:165-166,819-841`). vb's style-only descriptor names flat cel and a warm brown-black outline, but no blue, teal, orange, temperature, “1980s,” wood, or interior (`visual-kit/style-bible.md:77-81`); vb's suffix is empty (`style-bible.md:102`). The tile role says transfer saturation but not hue/temperature (`forge.py:928-936`).

Upstream vocabulary is uneven. `visual-grammar.md` only says palette codes tone (`:13-18`) and the VPW SKILL delegates house palette to channel DNA (`visual-prompt-writer/SKILL.md:88`); neither names this pair. va's plan only requires local 2–3-colour families and reserves terracotta (`claude/bricks-variant-va:V/scratchpad/vpw-var/plan.md:11`), so va L01's pair is the author's selection within the rule. vb's plan explicitly chooses “blue/cream retail” (`V/scratchpad/vpw-var/plan.md:24`), directly feeding L02/L07/L08/L09. vc's plan names amber then teal (`claude/bricks-variant-vc:V/scratchpad/vpw-var/plan.md:7-11`), yet its pixels are orange-only; palette labels are not render control.

| flagged frame | authored source of blue → warm | attached reference / tail | measured spatial result; attribution |
| --- | --- | --- | --- |
| va L01 | “dusk-blue” → walnut/beige in the final retry payload (`claude/bricks-variant-va:V/scratchpad/vpw-var/retry-spec-r1.json:6-8`) | orange-only tile; va tail adds warm outline + neutral 2–3-colour lock (same citation) | grid O/B 50/75; both halves authored; tile/tail can amplify warm but name no blue. |
| vb L01 | **no blue term**; warm 1980s den/night, beige, walnut, clay-red, TV glow, starlit window (`claude/bricks-variant-vb:V/shots.json:19`) | orange-only tile; no suffix (`V/scratchpad/variant-frames/vb/manifest.json:7-19`) | grid 81/25: warm field, localized blue. Blue is **INFERRED provider completion** of night/window against the authored warm interior. |
| vb L02 | cobalt → peach/cream (`claude/bricks-variant-vb:V/shots.json:32`) | crowd exemplar; no suffix (`V/scratchpad/variant-frames/vb/manifest.json:22-34`) | grid 69/81: two fields. Pair is authored; crowd seed is mostly neutral/warm, not causal for blue. |
| vb L04 | **no palette and no 1980s phrase**; only canonical beige PC, electronics aisle, bright rear door (`claude/bricks-variant-vb:V/shots.json:52`) | pc-boxy only; no tile, no suffix (`V/scratchpad/variant-frames/vb/manifest.json:52-64`) | grid 88/88 despite 46% neutrals: strongest provider test. Blue/cool aisle and orange/beige cartons are **INFERRED provider priors**, not prompt/tile/suffix. |
| vb L07 | cool blue → cream/walnut/brass (`claude/bricks-variant-vb:V/shots.json:84`) | orange-only tile; no suffix (`V/scratchpad/variant-frames/vb/manifest.json:98-110`) | grid 81/50; pair is explicit and broad, with tile plausibly amplifying warm. |
| vb L08 | held blue/cream/walnut → brass (`claude/bricks-variant-vb:V/shots.json:99`) | parent vb L07 + tile; no suffix (`V/scratchpad/variant-frames/vb/manifest.json:113-126`) | grid 100/50, CP 93.1% of frame. Authored hold plus parent seeding propagates the pair. This is local chain continuity, not registry colour seeding. |
| vb L09 | cobalt → cream/walnut/brass (`claude/bricks-variant-vb:V/shots.json:112`) | crowd exemplar only; no suffix (`V/scratchpad/variant-frames/vb/manifest.json:129-141`) | grid 88/50; pair is explicit; no orange tile is present. |
| liked L10 | “Cold blue night” → “warm amber” shop/pine (`30d2b7e8:V/shots.json:201`) | crowd exemplar; generic no-palette tail (`30d2b7e8:V/shots.json:8`) | grid 56/81: intentional light-source opposition (outside night vs inside shop), not an unstated default. |
| liked L11 | deep teal → warm dark brown, against steel grey/near-black spotlight (`30d2b7e8:V/shots.json:218`) | near-neutral `prop-drive` seed (`30d2b7e8:V/shots.json:221`) | grid 88/25: orange/warm field with localized teal; explicit object/display palette. |
| liked L24 | pale sea blue → warm ochre/parchment (`30d2b7e8:V/shots.json:445`) | named `env-map-parchment` (`30d2b7e8:V/shots.json:448`) | grid 94/50: explicit land/water material classes; both prompt and plate carry the intentional mapping. |

Reference measurements corroborate the trace:

| seed | S | neutral % | O/B % chromatic | pair % frame | finding |
| --- | ---: | ---: | ---: | ---: | --- |
| scene-style-tile | .512 | 0.0 | 89.0/0.0 | 89.0 | saturated orange-only; warm amplifier, no blue |
| lettering | .315 | 3.1 | 99.4/0.0 | 96.3 | orange-only |
| pc-boxy | .098 | 68.6 | 75.2/0.0 | 23.6 | mostly neutral, no blue |
| expr-confused / surprised | .167 | 73.5/73.7 | 88.9/0.0; 87.4/0.0 | 23.6/23.0 | mostly neutral, no blue |
| crowd exemplar | .199 | 66.1 | 72.4/8.4 | 27.4 | mostly neutral/warm; minor blue, not a pair field |
| prop-drive | .022 | 97.0 | 97.9/0.0 | 3.0 | effectively neutral |

Ranked causes: **(a) authored palette vocabulary/construction > (c) provider prior > (d) style tile/reference images > (b) bible descriptor > (e) forge registry seeding in a pair-rendered palette**. Evidence: five of seven fresh flags explicitly author both halves (va L01; vb L02/L07/L08/L09); vb L01/L04 expose provider completion; flags occur with tile, crowd, pc, and parent seeds, while no measured registry/style asset contains a blue+orange field pair. The tile is nonetheless a credible warm amplifier because its whole frame is saturated and 89% orange. The descriptor contributes only a thin warm outline. Registry-pair seeding is disproved for these frames; only L08's non-registry scene parent propagates the pair. No wholly colourless final L01–L12 prompt exists, so (c) cannot be isolated perfectly; L04 is the nearest test and shows the effect without a named cool colour, tile, suffix, or “1980s.”

Suffix evidence: vb proves a tail is not necessary (six flags with `global_prompt_suffix: ""`: `V/scratchpad/vpw-var/genlog.md:11`). va's tail adds warm outline/red but no blue; va has one pair flag and mostly orange-only frames. vc's present tail coexists with zero pairs but severe orange-only output. Therefore suffix presence is not the root blue source, and cross-variant differences cannot identify its independent effect.

## 3. Why the existing rules did not prevent it

The exact target rule is: “beat-local 2–3-colour palette”; warm/cool/mixed/neutral/desaturated are legitimate, and “No global temperature or fixed complementary pair” (`doctrine-recon/goal-state.md:54-59`). Strictly, that wording is a reconstructed goal, **not a literal operational vb clause**. The vb style bible only says scene palettes “move freely” (`visual-kit/style-bible.md:217-220`); its schema asks for “≤2–3 core colors + accent” and a still prompt containing lighting/palette (`shots-schema.md:30-38,61`). vb's operative plan then chose “blue/cream retail … factory teal … slate/paper” (`V/scratchpad/vpw-var/plan.md:24`).

That passes on paper but controls the wrong variable. L02's cobalt/peach/cream is three colours; L07's cool-blue/cream/walnut and L09's cobalt/cream/walnut are three; L08 correctly holds L07. Yet “blue/cream retail” occupies L02, L05, L07–L10, while warm material reality (cream/beige cartons, walnut/oak shelves, brass rails) supplies the other half. Each local palette is legal; the **same cross-shot hue axis** recurs. L01/L04 show the model can add the axis even when the author does not.

The pipeline has no enforcement at the relevant level. The plan critic judges prompts, not renders (`critics.md:43`) and is explicitly told not to flag palette codes (`critics.md:52-56`). `lint_shots.py` has no pixel or hue-axis measurement. The suffix removal only removed a universal tail; it did not change the plan's repeated cool-background + warm-material construction, the orange tile, or provider completion. “2–3 colours” limits within-frame complexity, not rendered area, spatial role, or recurrence across beats.

## 4. Smallest remedy direction

Do **not** require an off-axis third colour: the liked data has less third-chromatic share than vb. Make one canonical logic change in `visual-kit/style-bible.md:219-220`:

> Derive each beat's dominant field from its actual light source and dominant material. Warm/cool complements remain valid when those facts create them, but no complementary axis is the unstated fallback across adjacent beats; a palette turn must visibly change the dominant field, not merely rename the same cool-background/warm-material pair.

Then align existing homes, without adding a doctrine section or a new pipeline file:

1. `visual-prompt-writer/SKILL.md`, Step 3 near `:130-164`: the palette trajectory records **dominant field + light/material basis** per beat, rather than aesthetic labels alone. `shots-schema.md:61` says the prompt authors those facts when colour is load-bearing. Do not duplicate colour recipes.
2. `lint_shots.py`: soft pre-render diagnostic only. Map explicit palette terms to hue angles, calculate the circular distance between each shot's dominant two-colour axis and adjacent shots' axes, and surface low-distance persistence across distinct beats. “Unscorable” is valid for colourless prompts; never hard-fail word counts.
3. `image-generation/scripts/build_review_artifact.py`, in its existing scene-card collection (`:217-271`): compute O/all, B/all, CP/chromatic, neutral share, 4×4 O/B coverage, and a rolling six-shot area-weighted pair score. Surface, but do not auto-reject, a frame at this report's component-balanced threshold; flag a **default** only when the rolling window repeats a balanced pair across distinct beats without the plan's light/material rationale. This measures pixels and persistence, not colour words.
4. `critics.md:43-56`: retain permission for a justified single palette; consume the lint/render rows and challenge only repeated low-distance axes or measured pair persistence lacking a story cause. This implements the existing goal-state distinction: fail a board-wide default, not justified recurrence (`doctrine-recon/goal-state.md:234-239`).
5. `style-bible.md:271-273` / `forge.py:928-936`: keep saturation-only seed semantics, but make tile approval measurable: a style tile used as hue-neutral calibration must not itself have a dominant temperature/pair. The current tile fails that intent at 89% whole-frame orange. Replace it at the same registry key only after a controlled tile/no-tile A/B; do not change forge routing from this evidence alone.

Consistency obligation: the bible owns palette logic; grammar/VPW/schema point to it; lint computes prompt-axis diagnostics; the image review computes rendered area/spread; critics interpret recurrence and rationale; forge transports the authored payload and enforces eligible seed roles. Keep `global_prompt_suffix` empty. A fix that changes only the descriptor, only the tile, or only prompt words will leave another convergence path active.
