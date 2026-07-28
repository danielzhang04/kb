# Poyais shots.json / shots.motion.json — edit manifest (2026-07-14)

Source of truth for the user-requested edit pass. Each line = an intended change + its restaging.
Cluster agents implement their range; the intent-critic checks each shot against its line here.

## Global rules (every agent)
- **Keep shot IDs STABLE.** Removed shots are deleted (leave the ID gap); do NOT renumber survivors.
- **Match the existing schema + prompt quality exactly** (read `.claude/skills/visual-prompt-writer/references/shots-schema.md` for shots.json; `.claude/skills/render-builder/references/shots-motion-schema.md` for shots.motion.json). A rewritten `still_prompt` must be as rich/specific as its neighbors (committed palette, light, depth, house-style suffix).
- **Camera is LOCKED** — never author a camera move. Any "push/pull/zoom" request is restaged as a cut/delta/tableau.
- **`cutout_prompt` never uses the literal word "plate"** — say "isolated on a plain flat pale background, no surface under it" (the dinner-plate bug).
- **Crowd rig:** any shot with anonymous people gets the `style-bible.md §2d` crowd-rig clause written VERBATIM into its `still_prompt`. Named characters are `cast` (seeded canonical → full rig), never folded into the crowd clause.
- **Seeding/chains** are authored as INTENT only (`stage`/`stage_role`/`changed_elements` in shots.json; the motion layer in shots.motion.json). Do not author gen mechanism.
- **Both files, targeted:** edit shots.json (still content) AND shots.motion.json (motion layer) for a changed shot; leave unchanged shots' motion entries exactly as-is.
- Every edited shot keeps a valid verbatim `vo_ref` (≥4 words from script.md) + narration order; `lint_shots.py` + `lint_motion_plan.py` must pass after merge.

## Open-item defaults (locked by the user)
- **L04**: POYAIS card is SCREEN-SPACE on the L03 map shot (at_scene geo-pinning is deferred — not "over the destination country" precisely).
- **L44/L71**: restaged WITHOUT camera moves (cut/delta).
- **L59 arrow / L60 glow / L79 circle / L107 anger-mark**: authored as CUTOUT pop-ons (`appear`), gen'd as simple elements — NOT engine-drawn animations.
- **L05 "prince"**: is MacGregor (seed his canonical).

## ★ SEEDED vs LAYERED — judgment call, apply per shot (user-directed)
Where the manifest says "seed off the prior" or "delta", decide per shot which is better — and PREFER a **hybrid cutout layer** for a **large DISCRETE separable element**:
- **Discrete separable thing being ADDED** (a whole character entering, a second ship, a stamp/5-stars, a thought bubble, a shrugging figure, a highlight/circle/arrow, Bolívar appearing) → **HYBRID CUTOUT LAYER**: keep the SAME `stage`, `background.plate: scenes/<prior-id>.png` (reuse the prior scene, no re-gen), and `appear`/`slide` the element on, anchored to its word. This is the *better* option — real motion, cheaper, cleaner — and maps to `animation-rules.md`'s "discrete overlay → hybrid" rule.
- **INTEGRATED change fused into the image** (a costume change ON a figure like MacGregor's general's gear; a landscape/palette morph; a crown splitting; a scene the added thing melds into perspective/lighting) → **SEEDED DELTA** (baked, seeded off the prior frame), per `animation-rules.md`'s "integrated accretion → stays baked".
- Not every "seed" note flips — use the rule above. When in doubt for a clean-mattable large element, choose the LAYER.

---

## Cluster A — opening / map (L02–L11)
- **L02** — REMOVE.
- **L03** — still: the Atlantic map must show **Europe** on the east side too, not just a lone floating Britain (Britain + the European coastline at the right edge). Keep the ship `path` + `draw_line` (already in motion.json). **ADD** to motion.json: a `chapter-card` engine layer content "POYAIS", anchored to the VO word "Poyais" (screen-space), so L04's card now lands on THIS shot.
- **L04** — REMOVE (its POYAIS card absorbed into L03 above).
- **L05** — still: NOT a "brochure" (that word makes image-gen draw a literal brochure object). Reword as a **mostly full-frame flat illustration of the fantasy paradise** (a golden fantasy capital, lush country) filling the frame. This is the **base** of the paradise stage (keep `stage`, `stage_role: base`). The whole chain SEEDS off this frame.
- **L06 / L07 / L08** — rework the paradise chain: instead of re-genned delta scenes, each named element **POPS ON as an `appear` cutout layer** over the held L05 base (hybrid; `background.plate: scenes/L05.png`). Map the elements to the beats across L05→L08 in narration order: **capital, national bank, banknotes, cathedral, and the prince (= MacGregor, seeded)** — one element per `appear` layer, each `anchor`ed to the VO word that names it. Do NOT re-describe the whole paradise in these deltas' still_prompts (the set persists from L05). If more than 3 elements fall in one shot, split across L06/L07/L08 so each shot carries ≤ a couple pop-ons.
- **L09** — REMOVE.
- **L10** — change to a **FICTION stamp slamming down** (`appear`, `style:"slam"`) as a hybrid over the prior in-stage scene (`made-up-reveal` stage) — replace whatever L10 currently depicts with the stamp beat. cutout_prompt = a bold red diagonal 'FICTION' rubber-stamp, isolated on a plain flat pale background.
- **L11** — still: add the crowd-rig clause (anonymous emigrant figures). Keep the desaturated human-cost register.

## Cluster B — backstory / king / trade (L15–L21)
- **L15–L17** — make this a **delta chain** (shared `stage`).
  - **L15** = base, ANIMATED: MacGregor is a `path` cutout that slides across a Europe→South-America campaign map with `draw_line` trailing his route (like L03's ship, but the traveler is MacGregor). still/plate = the aged campaign map; cutout = MacGregor marching figure.
  - **L16** = delta seeded off L15: same map/context, MacGregor now in **general's uniform** (changed_elements: "MacGregor gains general's gear"). (Seed — do not re-describe the map.)
  - **L17** = delta seeded: **spawn Bolívar** in at the SAME size next to MacGregor (changed_elements: "+ Bolívar beside MacGregor"). Cast Bolívar (registry).
- **L18** — base (Miskito-king intro on the tropical shore). Keep.
- **L19** — seed off L18 (same backdrop/positions): the king hands the land-grant deed to MacGregor AND MacGregor hands **rum + jewellery** back — **double-handed trade** (fold in the removed L20). changed_elements name the added trade goods + MacGregor. NOTE: L18 is currently king-only, so this delta ADDS MacGregor + goods.
- **L20** — REMOVE (double-handing folded into L19).
- **L21** — REMOVE (reveals the swamp one beat early — disclosure-order fix).

## Cluster C — swamp / invention (L23–L29)
- **L23** — the small "no towns / no farms / nobody" debunk elements should be **bigger** and **POP ON as `appear` cutout layers** as each is named in the VO (layers + pop-on), not a static cluster. Anchor each to its word.
- **L24** — still: same swamp backdrop as L25 (shared scene/seed).
- **L25** — same swamp; restage as **MacGregor + a thought-bubble popping up containing a lazy/complacent London character** (nobody will bother to check). The thought bubble is an `appear` cutout (bubble + the London figure inside). Cast MacGregor.
- **L26** — still: seed off / share the SAME swamp as L24/L25 (the cardboard fantasy kingdom propped on the same grey swamp).
- **L28** — REMOVE.
- **L29** — still: do NOT prompt a "younger MacGregor" (a variant is hard/unreliable). Use the standard canonical MacGregor.

## Cluster D — guidebook / book / Strangeways (L36, L40–L44)
- **L36** — still: the guidebook is NOT closed on a desk. It's **floating, alone, nothing else in frame**. motion.json: add a **`bob`** cutout for THIS shot only (the book bobs slightly). Keep the '350 PAGES' incidental (baked, not carded).
- **L40 / L41** — seed off the book similarly ("on pages") — a held-book chain; author as deltas seeded off the prior book frame (changed_elements name what changes per page/beat).
- **L42** — do NOT restyle the book as a glossy resort brochure. It's the **SAME book as the previous frame, closed, floating like L36 (but NO bob)**, with **5 red marker stars stamped** down its cover — the stamp is an `appear` cutout over the held book. changed_elements: "+ five red stars stamped".
- **L43** — still: **Strangeways as an actual portrait** (a real seeded character — cast `strangeways` — NOT a gray/hollow silhouette). motion.json: a **FICTION stamp `appear`** lands when the "didn't exist" line rolls.
- **L44** — layered/hybrid over the prior Strangeways scene: the **FICTION stamp positioned specifically OVER Strangeways** (cutout placed on his figure), not the whole frame. Strangeways stays a real seeded figure. The earlier "camera pulls out to MacGregor pointing" is restaged as this framing (MacGregor present/gesturing + the stamp on Strangeways) — NO camera move.

## Cluster E — sales / ships / money (L53, L56, L57, L59–L62)
- **L53** — still: add a **Poyais flag on the ship** (at the top mast). Keep the Honduras Packet leaving London.
- **L56** — still: simplify to **MacGregor, smug, holding the Poyais flag**. Cast MacGregor (expr-smug).
- **L57** — seed off L53 (same ship scene): a **second ship POPS ON** (`appear` cutout, "ship 2"). Both ships carry the Poyais flag (top mast).
- **L59** — still: NOT literal — **big coins + big Poyais dollars** on screen, nothing else. motion.json: a **fat arrow** pops on (`appear` cutout) pointing from the coins to the Poyais dollars.
- **L60** — seed off / extend L59 + a **glow or circle emphasis** as an `appear` cutout (highlight the conversion). Something decent.
- **L62** — seed off L53 (ship scene): **Poyais dollars around/flying off the boat** + MacGregor in the foreground beside his **treasure chest** of the settlers' real gold (already has the chest — add the flying dollars).

## Cluster F — bonds / collapse (L71, L74, L75, L78, L79, L80, L84, L85)
- **L71** — restage the "camera push into the Poyais bond" as a **hard cut to a tight framing** of the Poyais bond among the real ones — NO camera move.
- **L74** — still: a map; the colonies are NOT visibly cracking. Instead a **Spanish crown splits in two** over that part of the map. (Optionally the split is an `appear`/delta; a clean baked still is acceptable.)
- **L75** — seed off the L74 map: **Colombia, Peru, Chile pop / borders draw / highlight** at the VO cue when each country is named — a `reveal` (pop) or per-country `appear`, each anchored to its word.
- **L78** — still/motion: a **large bubble with "1820" inside** (a simple dated bubble; author as an engine card/text bubble or a drawn bubble element).
- **L79** — seed off L76: add **fine print off to the side that the investors aren't looking at, circled** (an `appear` cutout circle around fine print, or a fine-print paper on the ground) — "nobody reads the fine print".
- **L80** — seed off L76/L79: **spawn a shrugging MacGregor into the foreground** (`appear`/`slide` cutout, seeded MacGregor).
- **L84** — read **"$0"** instead of "worthless" (a `stat-card` "$0", or the diegetic figure — prefer a card, subtract).
- **L85** — still: reuse the **same ship as prior** (L53/L57) — one or two ships, with the Poyais flag. Seed the ship look.

## Cluster G — aftermath (L91, L105, L107, L110, L112–L113, L115)
- **L91** — Miskito king slides in with animation (already a `slide` hybrid off L90 — confirm/keep it).
- **L105** — still: a **MacGregor portrait on the wall, a small crowd looking at it, NO negative emotion** — happy/content faces (crowd rig). Cast none named; crowd-rig clause.
- **L107** — seed off L105 (same framing/portrait): **spawn a smaller Poyais officer underneath** + a **comic anger-mark** (the 4-right-angle-line "cross-pop vein" symbol — NOT an emoji face) as an `appear` cutout, and the crowd looking at the officer. Cast the officer (registry).
- **L110** — reuse / seed off the prior shot of MacGregor's office (same image).
- **L112 + L113** — MERGE into ONE longer shot (delete the second ID, keep L112): a Europe map with a **`draw_line` to Italy**, then a **second `draw_line` to Paris** during the "Paris" VO word — two path/draw_line layers on one shot, each anchored to its word. Not two seeded shots — one shot, two sequential line-draws.
- **L115** — still: label **"France"** somewhere on the map; add **small crowd-rig police/officers in the background looking at them**. Crowd-rig clause.

## Global rig sweep (separate pass, all 125 shots)
After the cluster edits merge: read every shot. For any shot whose `still_prompt` depicts **anonymous people/crowd** but lacks the §2d crowd-rig clause → add it verbatim. For any shot with a **named figure** that isn't in `cast` (should be seeded) → flag/add to cast. This catches the under-enforced rigs the user is worried about.
