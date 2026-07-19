# Pickup — Poyais chunks 3–6 REWORK ROUND 1 (paused 2026-07-16, feedback received, work NOT started)

**State: Daniel reviewed the chunks 3–6 board and returned a full rework round (~30 shots + one
batch-wide consistency question). NOTHING has been executed yet — no gens fired, no files changed.
Resume = execute this round end-to-end.** Prior context: `2026-07-16-chunks36-board-gate-pickup.md`
(same folder) — board URL, manifest state, run ledger, working-model reminders. Board (republish to
SAME url): https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5

**His stated goal for this round:** "I want these changes made, learnings saved. Ideally this run
should allow us to move onto the next step of rendering with everything." → be thorough enough that
the next board is the release gate.

## The feedback, VERBATIM (the authority — re-parse against this if the ledger below looks wrong)

> L53 art style is different. L54 people aren't the right height proportions. L57 what? Have L57 same
> scene, ship, etc as L53 (which should be changed first), same setting, but maybe change buildings,
> colors, and have the side read kennersley castle instead. L59 have motion draw a thick arrow
> instead. No need for shot 60 circle. L61 macgregor off kit. L62 instead of layer, try regen with
> those notes flying around off L53. L63 macgregor is off kit. L68 is a terrible shot. Regen something
> else. L71, have the bond design of all 3 the exact same as the bond design we already have, used in
> shot L65. L74 and 75, use the map from way earlier but zoomed into south america (you can just crop
> it yourself. L74 should have crown breaking, and stay there. L75 should use motion ideally (layers
> is fine) to add the country borders of the three countries as they are said in order. Does our crowd
> rig make characters super short or more human proprtion/height? Beacuse in shots like L76 and L73
> they're taller, but in shots L51, 53, 69, etc, they're a lot shorter. We have to make this
> consistent, and not just shots I named, there's more. L77 character is really weird. L78 art style
> is different. L79 layer is cut off. L81 off rig. L85 art style is different. L86-89 characters way
> off rig. Have them facing towards land not out towards ocean. Can reuse the imagined capital city
> and swamp shots from way eearlier as seeds. L93-95 are off rig and art style. L101-102 are off rig,
> 103 has noses, 104 kid has a nose. L108 macgregor is off rig. Don't write victim on his head, have
> it hanging on the wall or something. L112 just have the 2D map, exact same style as all other 2D
> maps but zoomed in on a europe with country borders ( doesn't have to be perfect). Scrap 114 framing
> is good, but foreground characters are off rig and investors has 5 fingders. L116 is way off, 117
> guards are in weird uniform, use uniform from 115 and they have ears, 118 it should say not guilty.
> L120 use the exact same map, macgregor from before, motion drawn arrow to venezuela, then to L121.
> L122 is way off rig. L124 and 125 aren't great either. I want these changes made, learnings saved.
> Ideally this run should allow us to move onto the next step of rendering with everything

## Parsed rework ledger

| Shot(s) | Fix |
| --- | --- |
| L53 | Art style off → regen ON-STYLE (seed style anchor / continuity plate). **Do FIRST — L57 + L62 chain off it.** |
| L57 | Currently unreadable ("what?"). Regen = SAME scene/ship/setting as the NEW L53, vary buildings + colors, ship's side reads "KENNERSLEY CASTLE" (baked text, lettering law). |
| L62 | Drop the cutout-layer approach → regen as a full scene seeded off the NEW L53 with the banknotes flying around. Remove its layer entries from motion plan. |
| L54 | Figure height proportions wrong → regen with squat-rig proportion facts stated. |
| L59 | Whatever arrow/route is baked/authored now → replace with a MOTION-drawn THICK arrow (engine path/draw_line, cf. L15–17 static-route work, commit cc3b491). Likely plate edit + shots.motion.json edit. |
| L60 | Remove the circle/ring entirely (human: "no need") — drop the ring layer from motion plan + manifest; keep base. |
| L61, L63 | MacGregor off kit → identity regen (two-gen identity pass over good frames if env is fine). |
| L68 | "Terrible shot. Regen something else." → RE-AUTHOR the composition for the same VO beat (human authorized replacement, not just retry). |
| L71 | The 3 bonds must EXACTLY match the bond design already used in L65 → seed L65's bond asset as prop canonical, regen. |
| L74 | Use the EARLIER 2D map (chunk-1 Atlantic/route map, cf. L15–17 assets) CROPPED to South America — crop it ourselves, no regen of the map. Crown BREAKING on it, and the broken crown STAYS (motion or layered; end-state persists). |
| L75 | Same cropped South-America map. Country borders of the three countries draw on IN ORDER as VO names them — motion ideally (layers fine). |
| L112 | Scrap current. JUST the 2D map, exact same style as all other 2D maps, zoomed on Europe with country borders (need not be perfect). If the existing map canonical doesn't cover Europe, gen one seeded off the map style. |
| L120 | Use the EXACT same map + the MacGregor cutout from before (L17 cutout, `reuse:` wiring exists); motion-drawn arrow to Venezuela, then continuity into L121. |
| L77 | Character "really weird" → regen. |
| L78, L85 | Art style different → regen on-style. |
| L79 | A cutout layer is CUT OFF (clipped) → regen/re-key the layer complete. |
| L81 | Off rig → regen. (Prior round's "canonical face over gag" taste note is superseded by this rig fail.) |
| L86–L89 | Characters WAY off rig; figures must face TOWARD LAND, not out to ocean; seed the earlier imagined-capital-city and swamp scenes (chunk 3, ~L49–L52 region — verify IDs on disk) as continuity seeds. |
| L93–L95 | Off rig AND art style → regen cluster (note: c5-u02 provenance was already shaky — full redo). |
| L101–L102 | Off rig → regen. |
| L103 | Noses → identity/rig fix. |
| L104 | The kid has a nose → fix (hastie-wife canonical is locked, `refs/hastie-wife/`). |
| L108 | MacGregor off rig; do NOT write "VICTIM" on his head — re-author the label onto a wall-hanging sign or similar. |
| L114 | Framing is GOOD — keep composition; fix off-rig foreground characters + the investor's 5-finger hand (identity/rig pass holding the frame). |
| L116 | "Way off" → full regen. |
| L117 | Guards' uniform weird → use the uniform from L115; guards have EARS → remove (rig). |
| L118 | Baked text must read "NOT GUILTY". |
| L122 | Way off rig → regen. |
| L124, L125 | "Aren't great" → regen better takes (some re-authoring latitude). |

## The batch-wide question — CROWD/ANON PROPORTION (answer + sweep required)

Daniel: crowd figures are TALLER in L76/L73 but much SHORTER in L51/L53/L69 etc — "we have to make
this consistent, and not just shots I named, there's more."

- **The law says squat:** style-bible base rig + pass2-brief §2e ("same squat base head-to-body
  proportion as the seeded character — NOT tall, NOT lanky") — so squat/short IS the standard; the
  taller shots are the drift. **Answer his question explicitly in the wrap-up and confirm the call,
  but proceed on squat.**
- **Action: a dedicated audit agent sweeps ALL 118 frames** for anonymous-figure proportion, classifies
  squat vs tall, and every tall one (beyond the shots already in the ledger) joins the rework queue.

## Open items to surface to Daniel (do NOT block on them — note in wrap-up)

1. **L96 (the one hard flag, 9 grave crosses vs authored 10) was NOT mentioned** in his feedback.
   Prior rounds he said "everything else is good" explicitly; this time he didn't. Treat unmentioned
   as accepted BUT call it out for confirmation.
2. Crowd-proportion standard = squat (per bible) — state the answer + decision.
3. "Scrap 114 framing is good" parsed as: keep L114's framing, fix rig + fingers.

## Planned execution (authored this session, not yet run)

1. **Orient:** dump shots.json + shots.motion.json entries for all ledger IDs (read-only py script —
   was about to run when paused); locate on disk: the chunk-1 2D map asset (L15–17 plates/cutouts),
   L65 bond frame, L115 uniform reference, capital-city + swamp scene IDs, hastie-wife canonical.
2. **Fire the crowd-proportion audit agent** (Opus, background) over all 118 frames in parallel with
   brief-authoring.
3. **~8 rework units, ALL Opus 4.8 (`model: "opus"`), parallel** except the L53→L57/L62 chain (serial
   within one unit). Each brief carries: pass2-brief.md law (v2, at the OLD session scratchpad —
   absolute path below), the shot's ledger row + verbatim quote, seeds resolved on disk, ONE
   re-authored retry, incremental disk logs, JSON return, NEVER touch manifest.json.
   Suggested split: U1 L53/L57/L62 · U2 L54/L61/L63/L68/L71 · U3-maps L74/L75/L112/L120 asset work
   (crop via PIL, deterministic) · U3b-motion shots.motion.json edits (L59 arrow, L60 ring removal,
   L62 layer removal, L74 crown, L75 borders, L120 arrow; follow render-builder animation-rules +
   static-route/`reuse` wiring from cc3b491) · U4 L77/L78/L79/L81/L85 · U5 L86–89 · U6 L93–95/
   L101–104 · U7 L108/L114/L116/L117/L118 · U8 L122/L124/L125 (+crowd-audit extras).
4. **3-agent fresh-eyes review** (identity/rig · fidelity · style) over every reworked frame — style
   axis explicitly checks cross-chunk style match (this round's top defect) and proportion.
5. **Orchestrator merges manifest** (supersede-first: move replaced PNGs to `_superseded-2026-07-16/`),
   restamp, **republish board to the SAME artifact URL**, wrap up with the open items above.
6. **Learnings ("learnings saved" — he confirmed):** codify this round's — (a) style anchors must be
   seeded on EVERY scene gen, cross-chunk drift is the proven failure; (b) anonymous-figure proportion
   is a stated FACT in every delta + a review axis; (c) arrows/routes/reveals are MOTION elements,
   never baked; (d) maps: crop/zoom the existing map canonical, don't regen new maps; (e) match-prop
   shots seed the prior shot's prop frame (L65→L71). Route per §G (bible / pass2 brief / review brief /
   motion rules) + decisions.md, human-confirm generalizations in the wrap-up. Also revisit the 6
   pending G-route candidates in the prior pickup — his "learnings saved" arguably confirms them;
   codify unless contradicted.

## Key paths

- Old session scratchpad (tooling + briefs, survives on disk):
  `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-faceless-youtube\1037de8d-223e-44bc-b3ce-cbc5c6b1e82f\scratchpad\`
  → `pass2-brief.md` (v2 gen law), `build_units.py`, `c36-collect.md` (run ledger), review briefs
  `review-c36-*.md`, `full-sequence-board.html` (board file — rebuild THIS path or pass `url`).
- Video: `channels/the-second-take/videos/2026-07-04-poyais/` (shots.json, shots.motion.json,
  assets/{scenes,plates,cutouts,library}, assets/scenes/manifest.json — orchestrator-only).
- Kit: `channels/the-second-take/visual-kit/` (style-bible.md, registry, refs/).
- Forge: `py -3 .claude/skills/image-generation/scripts/forge.py` from repo root; `--force`; 16:9
  scenes/plates ONLY (cutout wide-aspect is hard-guarded); foreground, never piped through tail/head.
