# Poyais (liked) vs Bricks-fresh (lacking) — visual forensics

Scope note before the data: this audit does NOT redo `threeway-visual.md` (FRESH vs V2 vs
LIKED-archive) — read that first. This audit adds the piece it didn't have: Daniel specifically
praised **poyais**'s images, and poyais's `assets/scenes/*.png` no longer exist anywhere on disk
(gitignored generated assets, swept per the project's housekeeping norm after the video published
2026-07-21 — confirmed absent in the kb repo, this standalone clone, every worktree, every backup
snapshot, and every private review dir checked). The one surviving visual record of the shipped
poyais stills is the Gate-2 shot-board Claude Artifact
(`https://claude.ai/code/artifact/95987ba7-d47c-4a68-9d2f-8c0cf4bf278f`), which embeds every still as
inline base64 JPEG. WebFetch had already saved the full artifact HTML locally
(`tool-results/artifact-95987ba7-1784603137-6a3c.html`, 5.6MB); this audit decoded 20 of its 117
`data-shot-id` cards back into real image files and read them directly with the Read tool — genuine
pixel content, not a text description. 3 shot ids in the original 20-pick (L30, L63, L117) turned out
to be marked "MISSING" in the board itself (no image was ever embedded for them) and were swapped for
the nearest neighboring id (L29/L31, L62/L64, L116/L118) so the sample stayed at 20 real images.

**Poyais sample (20 of 117 shots, spanning the full runtime):** L01, L03, L07, L09, L13, L18, L23,
L29, L38, L46, L54, L62, L72, L81, L90, L99, L108, L118, L122, L125.

**Bricks-fresh sample (24 of 24 verified, L09 excluded per the parked crowd defect):** L01-L08,
L10-L25.

## Poyais — per-shot table

| Shot | People | Crowd: subject or dressing? | Fig height | Literal / non-literal | Palette + temperature | Light | Composition |
|---|---|---|---|---|---|---|---|
| L01 | ~25-30 | Crowd is the subject (dockside investors) sharing the frame with a symbolic glowing city | ~40-50% (large foreground figures, cropped) | Literal dock scene + non-literal glowing fantasy-city on the horizon | Warm gold/amber sunrise | Volumetric sunburst rays backlighting the crowd into near-silhouette | Symmetric wide harbor; ship right, glowing city centered on the horizon, crowd banding the full foreground |
| L03 | 0 | n/a | n/a | Non-literal — aged parchment world map, no scene | Warm sepia/aged paper | Flat, but paper-grain texture + soft radial vignette | Centered compass rose, continents symmetric left/right |
| L07 | 0 | n/a | n/a | Non-literal establishing landscape (no characters) | Warm gold-green sunset | Volumetric sunburst fanning from behind the hills, painterly sky gradient | Temple fg, winding road mid, city distant — layered depth, rule-of-thirds |
| L09 | 0 | n/a | n/a | Same establishing landscape + a fanned stack of banknotes inserted bottom-right (object overlay) | Warm gold-green, same as L07 | Same volumetric sunburst | Same landscape, banknote graphic punctuates bottom-right |
| L13 | 0 | n/a | n/a | Non-literal — empty theater stage/spotlight, metaphor for "the stage for the con" | Warm brown/amber | Single directional spotlight pool, rest in shadow — strongest single directional-light beat in the sample | Theatrical proscenium framing, curtains flanking, centered spotlight |
| L18 | 1 | n/a (single character) | ~55-60% | Literal character portrait (Mosquito Coast king) | Warm sand/red robe + a cool turquoise-sea note — mixed temperature | Flat-ish with soft warm-to-cool sunset sky gradient | Centered between two palm trees, driftwood foreground leading line |
| L23 | 0 | n/a | n/a | Non-literal symbolic icon — red "X" over a farmstead/silo pictogram (rejecting a land claim) | Muted green/tan under a red overlay | Flat, glowing red vignette at the edges | Centered icon, diagonal red cross |
| L29 | 1 | n/a | ~65-70% (close bust-to-thigh) | Literal character beat staged like a trophy-wall cutaway (invented display, semi-symbolic) | Warm brown + gold medal accents | Flat character lighting, no strong directionality | Character right, prop rack (medals/hat/scrolls) left |
| L38 | 0 | n/a | n/a | Non-literal object-hero — open guidebook on a table, illustrated skyline inside its pages | Warm wood + warm sepia page art | Soft directional top-left highlight | Centered book, angled 3/4 view |
| L46 | 0 | n/a | n/a | Non-literal object-hero — single fake banknote fills the frame | Sepia-olive-brown, warm/muted | Flat, subtle paper-grain shading | Centered, slightly rotated, symmetric ornamental border |
| L54 | ~70 (numeral-captioned) | Crowd IS the subject | ~15-20% each (dense, many rows) but crowd fills the whole frame | Literal departure scene + non-literal "~70" numeral overlay substituting for individuated faces | Warm brown/tan, muted/restrained (least saturated warm frame in the sample) | Flat overcast sky, minimal shading | Symmetric ship-bow funnel, crowd fills it, rigging frames the top |
| L62 | 1 + ~6 small bg | Small bg crowd is dressing; MacGregor + treasure chest are the subject | MacGregor ~55%, bg crowd ~15% | Literal re-enactment + symbolic wealth prop (coin chest) + graphic device (flapping "Poyais" tags) | Warm brown ship-wood + gold coins, pale cool-grey sky note | Flat-ish, soft sky gradient | Triangular: chest fg-left, figure mid, ship+crowd bg-right |
| L72 | 1 | n/a | ~55% | Literal interior character beat | Rich warm mahogany + brass, warm | Directional lamp-glow pool + ambient corner falloff | Centered figure flanked symmetrically by clock (left) and bookshelf (right) |
| L81 | 0 | n/a | n/a | Non-literal empty-world shot — a fully deserted period London street | Cool desaturated beige-grey — the coolest/greyest frame in the sample | Flat, soft overcast, minimal shadow — mood via desaturation, not contrast | Single-point perspective straight down the street, converging symmetric building lines |
| L90 | ~14 | Crowd IS the subject (settlers' misery) | ~10-12%, small and distant | Literal re-enactment | Cool grey-green, heavily desaturated — coolest "peopled" frame in the sample | Moody overcast, volumetric haze/mist in the background treeline | Symmetric converging rows to a hazy vanishing point, tents framing both sides |
| L99 | 0 | n/a | n/a | Non-literal minimalist symbol — tiny ship silhouette + a floating "?" in empty sea | Near-monochrome blue-grey — the single coolest, most desaturated frame in the whole sample | Flat, soft horizon gradient, no directional drama — mood carried by minimalism/color alone | Rule-of-thirds, tiny subject in vast negative space |
| L108 | 1 | n/a | ~55% | Literal character beat + symbolic overlay (halo) + textual joke prop ("VICTIM" framed sign) | Warm firelit red-orange | Directional firelight glow — best warm volumetric flame-light in the sample | Centered armchair figure, fireplace left balances the framed sign right |
| L118 | 1 | n/a | ~55% | Literal walking character shot + symbolic graphic ("NOT GUILTY" stamp mark) | Warm cream stone + blue sky (mixed warm/cool) | Flat bright daylight + soft volumetric sunburst behind him | Centered figure walking toward camera, symmetric flanking buildings/flags, stamp punctuates fg-right |
| L122 | ~40-50 | Crowd IS the subject (state funeral) | Crowd ~10-20%, 4 honor-guard soldiers ~25% | Literal re-enactment | Warm cream/stone architecture + palm-green window accents, restrained warm (not garish) | Flat-ish architectural light, soft window glow | Deep multi-arch receding hall, crowd symmetric around a centered flag-draped coffin |
| L125 | 0 | n/a | n/a | Non-literal symbolic closing image — a single ornate book on a shelf | Warm mahogany-brown library tones | Volumetric dust-beam light shafts crossing diagonally — clearest "god-ray" example in the sample | Rule-of-thirds, one vertical accent object against horizontal shelf rhythm |

## Bricks-fresh — per-shot table

| Shot | People | Crowd: subject or dressing? | Fig height | Literal / non-literal | Palette + temperature | Light | Composition |
|---|---|---|---|---|---|---|---|
| L01 | ~25 (+ balcony bg) | Crowd is dressing, but foreground figures are large/prominent enough to read as a subject | Fg trio ~25-30%, mid ~10-15% | Literal mall interior | Warm cream-gold, balanced | Flat-cel, soft skylight ceiling glow | Elevated two-story symmetric atrium, skylight vanishing point, fg planter breaking the floor |
| L02 | ~25+ | Same, but individuation (hair color/style, smiles) now present throughout, not just fg | Same as L01 | Literal, same setting | Same warm cream-gold | Same flat-cel + skylight glow | Same |
| L03 | ~25+ | Same (delta of L02) | Same | Literal, near-identical to L02, one kiosk sign left blank | Same | Same | Same |
| L04 | ~9 + 1 mascot | Crowd is dressing (queue); mascot is the non-literal element | Queue ~35-40%, mascot ~35% | Literal shop scene + non-literal personified-computer sidekick | Warm wood-tan + cool teal cabinetry/floor — one of the few genuinely mixed-temp bricks frames | Flat-cel, warm shop-window glow outside | 4-plane depth (bench/mascot fg, shelving mid, counter+queue, street windows bg), diagonal stair leading line |
| L05 | ~11 + 1 mascot | Same, 2 more queue figures added, mascot screen now dark | Same | Same | Same | Same | Same |
| L06 | ~11 + 1 mascot | Same; only the shelf inventory boxes changed | Same | Same | Same | Same | Same |
| L07 | ~35-40 | Crowd IS the subject | Near-cam ~35-40%, receding to ~10% | Literal auction-hall queue | Warm cream/gold, balanced | Flat-cel, no directional drama | Nested arches receding, raised platform with two counters, elevated 3/4 vantage |
| L08 | ~35-40 | Same — pixel-identical to L07, no visible change found | Same | Same | Same | Same | Same |
| L10 | 0 human, 1 mascot | n/a | Mascot ~55% | Non-literal personified-object character beat | Warm neutral tan + cool teal cabinets/screen — mixed temp | Directional overhead work-lamp triangular wall glow — strongest directional light in the bricks set | Close single-subject workbench beat, pegboard + coiled cables as texture |
| L11 | 0 human, 1 mascot | n/a | Same | Same, mascot screen now dark/off | Same | Same | Same |
| L12 | 0 human, 1 mascot | n/a | Same | Same; drive now opened showing circuit chips (real content change) | Same | Same | Same |
| L13 | 0 | n/a | n/a | Non-literal object-hero pedestal (storage drive) | Warm cream/gold + soft amber glow on the hero object | Flat-cel, best soft radial glow accent outside the lamp-lit shots | Perfectly symmetric, centered, triple-plane depth (pedestal fg, monitor mid, shelving flanks) |
| L14 | 0 | n/a | n/a | Same; drive now shows a glowing stack of papers inside (added story detail) | Same | Same | Same |
| L15 | 0 | n/a | n/a | Same; a leather wallet/journal added beside the drive | Same | Same | Same |
| L16 | ~20-25 | Crowd IS the subject | Near-cam ~35-40% | Literal "SOLD"-counter queue | Warm amber, balanced | Flat-cel, pooled overhead lamp glow | Nested-arch corridor — strongest architectural depth device in the bricks set, loft/stair visible left |
| L17 | ~25-30 | Same; MORE figures appeared in the left loft/stairwell vs L16 (crowd density escalated, not just repeated) | Same | Same | Same | Same | Same |
| L18 | 0 human, 2 mascots | Small distant bg silhouettes correctly left unindividuated | Mascots ~45-55% | Non-literal personified-object confrontation | Warm terracotta/wood | Flat-cel + genuine soft edge vignette — best mood-lighting device in the bricks set | Circular arena, dark pit-hole centerpiece, symmetric mascots, elevated ringside vantage |
| L19 | 0 human, 2 mascots | Same | Same | Same; a velvet-rope barrier added | Same | Same | Same |
| L20 | 0 human, 2 mascots | Same | Same | Same; two small hard-drive props placed in the pit | Same | Same | Same |
| L21 | 1 | n/a | ~55-60% | Literal character beat (prospector), pulley/scale prop | Warm wood + cool teal wall — mixed but mostly warm | Flat-cel, no directional drama | Flattest/shallowest frame in the set — one railing/pulley fg plane, character mid, closed door bg; reads as "figure in front of a backdrop" |
| L22 | ~8 | Crowd is dressing; 2-3 near-cam customers individuated (same creep pattern in miniature) | Seller ~50% | Literal market-stall scene | Warm brown, balanced | Flat-cel, but bg market street is genuinely blurred — rare depth-of-field device, closest bricks analog to poyais's atmospheric technique | Counter fg, seller mid, blurred receding street bg |
| L23 | 0 | n/a | n/a | Non-literal pure world/object shot — deep structured pallet racking | Warm amber-cream, warm | Flat-cel + sunbeam highlight rectangles on the back wall — best light-beam execution in the bricks set (thinner than poyais's diffuse rays) | Deep racking receding 3 rows, elevated interior vantage |
| L24 | 0 | n/a | n/a | Same; one box opened, red brick visible (payoff begins) | Same | Same | Same |
| L25 | 0 | n/a | n/a | Same; multiple boxes now opened along the racking (clean reveal progression) | Same | Same | Same |

## Synthesis

### (a) What poyais does about PEOPLE that fresh doesn't

Half the poyais sample (10/20: L03, L07, L09, L13, L23, L38, L46, L81, L99, L125) has **zero human
figures** — pure maps, objects, empty-world establishing shots, and symbolic icons carry entire
story beats alone. Another 30% (L18, L29, L62, L72, L108, L118) are true **single-character** beats:
MacGregor alone with his medals, alone in his study, alone by the fire, alone walking to trial. Only
4-5 of the 20 sampled frames are genuine crowd scenes, and each solves the "many faces" problem with
a specific device rather than individuated rendering: L54 swaps ~70 rendered faces for a small blank
crowd plus a "~70" numeral caption; L90 keeps the crowd distant, small, and folded into atmospheric
haze; L122's dense funeral crowd stays on the simplified blank-rig even at moderate foreground
distance, with no individuation creep. Bricks, by contrast, has no true single-human-character beat
in the whole 24 except L21 (also independently flagged as the worst-composed frame in the set) — its
12 human-bearing frames (L01-08, L16-17, L21-22) are ALL either full mall/queue/auction/showroom
crowds of 8-40 people, or nothing at all (the other 12 frames are either a personified mascot or a
pure object/world shot). Bricks solves "no people needed" the same way poyais does (mascot device,
object pedestals, pure world shots) — but every time it DOES put humans in frame, it defaults to a
crowd, and nearly every one of those crowd shots (L01-03, L07-08, L16-17, and miniature in L22) lets
near-camera individuation creep back into the simplified rig — the same mechanism flagged as the
parked L09 defect, recurring unaddressed across a third of the human-bearing frames.

### (b) Poyais COLORATION character vs fresh

Poyais's palette range is genuinely wide: roughly 13 of 20 frames sit in a vivid warm gold/amber
family, but three frames are unambiguously **cool and desaturated** — L81 (beige-grey overcast empty
street), L90 (grey-green desaturated swamp camp), and L99 (near-monochrome blue-grey seascape,
essentially the coolest frame in the sample) — plus cooler notes bleeding into otherwise-warm frames
(L18's turquoise sea, L62's pale grey sky, L118's blue sky). Poyais deploys these cool/grey passages
specifically at the story's emotional low points (the con collapsing, the settlers' misery, the
uncertainty of the crossing) — palette functions as a narrative lever, and even the warm frames run
more saturated/glowing (radial sunburst, gold city-glow, firelight) than a flat fill. Bricks-fresh, in
contrast, sits in one narrow warm cream-gold/amber/brown band across essentially all 24 sampled
frames; the only coolness anywhere in the set is mild teal/cyan accent furniture (L04's cabinet,
L10's screen/cabinets, L21's wall) — no frame is cool-dominant or desaturated-moody, and the palette
never shifts with the underlying story beat (a broken drive reads visually identical-warm to a
repaired one). Bricks has no equivalent of a deliberate "cool passage."

### (c) Other qualities poyais has that fresh lacks

Poyais uses **volumetric/directional light** as a repeated storytelling device — god-ray sunbursts
(L01, L07, L09, L125), a true spotlight beat (L13), and firelight glow (L108) appear across a
majority of its warm frames, reading as diffuse and atmospheric. Bricks' comparable moments (L10-12's
lamp wash, L18-20's vignette, L23-25's sunbeam rectangles) are real but read flatter and thinner —
literal highlight patches rather than diffuse fanning light. Poyais also runs a much wider
**non-literal device vocabulary**: maps, hero objects (banknote, guidebook, book), symbolic icons
(red-X farm rejection, halo, "VICTIM" sign, "NOT GUILTY" stamp, a floating "?"), and a fully empty,
atmospheric world shot (L81) with nobody in it at all. Bricks' non-literal beats are narrower — almost
entirely the personified-mascot device (L10-12, L18-20) plus object-pedestal shots (L13-15) and one
pure world shot (L23-25) — it never reaches for on-screen text/graphic devices, symbolic icons, or a
genuinely empty establishing shot. Poyais also has two moments of real **minimalism/negative space**
(L99 especially) that bricks never attempts — bricks' "empty" shots (L13, L23) stay fairly dense and
symmetric rather than spare — and more instances of atmospheric haze/depth cueing (L90's misty
treeline, L81's overcast falloff) versus bricks' single blurred-background instance (L22).

### (d) Honest counter-list — where fresh does better than poyais

Bricks' architectural depth ambition genuinely exceeds the poyais sample in places: the colosseum
(L18-20) and nested-archway showroom (L16-17) are more structurally ambitious multi-plane builds than
anything sampled from poyais, whose interiors (L72's study, L13's stage) are comparatively simple
single-room boxes. The personified-mascot device (vintage computer vs. tower PC, L10-12/L18-20) is a
distinctive, on-brand storytelling tool poyais's sampled frames don't have an equivalent of inside the
image itself. Bricks' micro-continuity chains are legible and well-built: L23→L24→L25's progressive
box-opening reveal and L13→L14→L15's added-papers-then-wallet sequence are cleaner, more deliberate
payoff structures than some of poyais's minor chain moves (e.g., L18-20's rope-then-drives additions
are comparably incremental). The mall's skylight/ceiling gradient (L01-03) is a nice ambient touch
poyais's flatter interiors don't attempt (poyais compensates with lamp/fire glow instead in its
interior shots). And bricks' pedestal/colosseum symmetry (L13-15, L18-20) is cleaner bilateral
symmetry than most poyais frames, which favor asymmetric rule-of-thirds staging.
