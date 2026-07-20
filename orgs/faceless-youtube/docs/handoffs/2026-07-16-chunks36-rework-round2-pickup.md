# Pickup — Poyais chunks 3–6 REWORK ROUND 2 (2026-07-16, feedback received, NOTHING executed)

**State: Daniel reviewed the round-1 board and returned a second rework round (~25 shots) PLUS a
process directive: "We have to change file logic because a lot of the changes I noted last time
just weren't made properly." Resume = FIRST redesign the verification/gen logic (see §Systemic
below), THEN execute round 2 through the redesigned flow. Do not just re-run round 1's machinery —
it demonstrably passes off-rig frames.** Prior context: `2026-07-16-chunks36-rework-round1-done-pickup.md`
(what round 1 did) + `2026-07-16-chunks36-rework-round1-pickup.md` (round-1 verbatim feedback).

Board (republish to SAME url): https://claude.ai/code/artifact/07ac56e9-45fb-4a1f-b86a-3f6791935bd5

## The feedback, VERBATIM (the authority — re-parse against this if the ledger looks wrong)

> L61, Macgregor has eye bags? Why. L62, macgregor has ears. L63, way off rig. L67, macgregor skin
> off rig, 6 fingers. Gen on rig. L68, off crowd rig. Fat, nose ears. L77 inspector not looking at
> "fine print" and has ears, not on crowd rig. L78 where did the bubble go? Where did shots L79 and
> 80 go? L81 way off rig. Macgregor is off, other characters are off rig. Should be character rig
> but heads are way too big. Also background no people, they're off crowd rig too. L86 and 87 off
> crowd rig. Ears and nose. L93 off rig. L95 still has the chest? L96 not seeded properly, one tent
> turned white. L103 why is it off base character? Off crowd rig. L107 what happened to "officer on
> the ground"? L108 macgregor has ears and 5 fingers. Don't generate characters that aren't based
> on asset base poses. L109 woman has 5 fingers. L114, macgregor has 5 fingers. L115 investor
> should be off character rig not crowd rig, he's foreground. L116 macgregor has nose. Also
> soldiers don't match in the two. L117 they have ears. L118 macgregor way off rig. L48 both
> characters have ears. Save this feedback. We have to change file logic because a lot of the
> changes I noted last time just weren't made properly. Save this, I'll have another terminal start
> where we leave off.

## Parsed ledger (round 2)

| Shot | Fix |
| --- | --- |
| L48 | Both characters have EARS. (NEW — not in round 1; was in the original release set.) |
| L61 | MacGregor has EYE BAGS ("why?") — identity pass introduced a non-canonical face detail. |
| L62 | MacGregor has EARS. |
| L63 | WAY off rig (round-1 identity pass did not land). |
| L67 | MacGregor skin off rig + SIX fingers. "Gen on rig." (NEW — not in round 1.) |
| L68 | Crowd off crowd rig: FAT figures, noses, ears (fix-round de-nose did not land/regressed). |
| L77 | Inspector: has EARS, not on rig, and is NOT LOOKING at what he inspects. |
| L78 | "Where did the bubble go?" — the thought-bubble layer missing on the board card. See §Board-bug. |
| L79, L80 | "Where did they go?" — cards likely rendered as bare L76 plate (layers not composited). See §Board-bug. |
| L81 | WAY off rig: MacGregor off; the country-personification characters should be CHARACTER rig but heads are WAY TOO BIG; background figures off crowd rig ("background no people, they're off crowd rig too" — verify against verbatim: possibly ALSO missing background people). |
| L86, L87 | STILL off crowd rig — ears + nose (fix round claimed these cleared; they didn't). |
| L93 | Off rig. |
| L95 | "Still has the chest?" — a leftover crate/chest (likely inherited from the L94 struck-symbols delta) should be gone. |
| L96 | Not seeded properly — ONE TENT TURNED WHITE vs the chain parent. Re-delta off L95 holding the camp. |
| L103 | Pictogram grid is off the BASE character rig / off crowd rig — figures must be the house figure, miniaturized. |
| L107 | "What happened to 'officer on the ground'?" — the authored officer-on-the-ground element is missing (L107 has cutouts `L107-poyais-officer.png` / `L107-anger-mark.png`; either the layer vanished from the motion plan or the board card didn't composite it. NEW shot — not in round 1). See §Board-bug. |
| L108 | MacGregor has EARS + FIVE fingers. **Plus the directive: "Don't generate characters that aren't based on asset base poses."** |
| L109 | The woman has FIVE fingers. (NEW — not in round 1.) |
| L114 | MacGregor has FIVE fingers (fix unit claimed 4-digit verified — it was wrong). |
| L115 | The foreground investor must be on the CHARACTER rig (§2e full base rig), NOT the crowd rig — he's foreground. |
| L116 | MacGregor has a NOSE. Also the (two) soldiers don't match each other ("soldiers don't match in the two" — verify parse; could mean L116 vs L117). |
| L117 | Guards STILL have EARS. |
| L118 | MacGregor WAY off rig. |

## Systemic — WHY round 1 failed and what must change ("change file logic")

Round 1's stack was: unit self-check → 3-axis fresh-eyes zoom review → fix unit with zoom
"verification" → orchestrator marks verified. **Daniel immediately caught ears/noses/5-6 fingers/
proportion fails on ~20 frames that this entire stack passed — including frames the fix round
explicitly claimed zoom-verified (L86/L87 ears, L114 fingers, L68 noses).** Diagnosis candidates
for the next terminal (design the fix FIRST, confirm with Daniel, then execute round 2 through it):

1. **Model-vision review at full-frame scale does not reliably see rig invariants.** Agents claim
   "zoomed 3-4x" but pass real ears/noses/finger counts. Candidate mechanisms: (a) a deterministic
   face/hand CROP battery — script crops every face + hand region at high zoom into a contact sheet
   the reviewing agent (and ultimately Daniel) judges crop-by-crop, per-figure structured pass/fail,
   never whole-frame; (b) reviewer must return the crop file paths as evidence per figure, not
   prose claims; (c) count fingers on the crop explicitly per hand.
2. **Daniel's directive is a gen-side law: EVERY generated character must be based on the asset
   base poses** (`refs/base/` pose primitives + base.png for anonymous figures). Round 1's units
   often genned anonymous/foreground figures from prose descriptions (no pose seed) — that's where
   ears/noses/fingers/eye-bags creep in. Make pose-primitive seeding mandatory for EVERY figure
   incl. §2e anons and crowd-rig figures (seed base.png at minimum), and make an UNSEEDED figure a
   lint/hard error if mechanically checkable.
3. **Identity/fix passes can REGRESS other attributes** (L61 eye bags, L62 ears, L116 nose appeared
   in/after passes that "held the scene"). A fix pass needs a before/after crop diff on EVERY
   figure, not just the targeted one.
4. **§Board-bug: the round-1 board compositor likely dropped cutout layers on some plate-backed
   cards** (L78 bubble, L79/L80 reading as bare L76, L107 officer). Suspect: field-name mismatch in
   `build_board_rework36.py` `composite_for()` (reads `layer.cutout`/`layer.asset`; verify against
   the actual shots.motion.json layer schema, incl. `reuse:` wiring). FIRST verify on disk whether
   the assets/motion entries are intact and it's board-only — if so, L78/L79/L80/L107 may need no
   gen work at all, just a fixed board. Also check L107's motion entry wasn't clobbered by the U3
   edit round.
5. **The "verified" manifest stamps from round 1 are NOT trustworthy** — treat
   `rework36_round1`-touched entries' `verified:true` as void for the shots in this ledger.

## Not executed / open

- NOTHING from this round has been executed — no gens, no file edits beyond this pickup + STATUS.
- Round-1 open items still standing: L30 tall redcoat (released chunk 1) — unaddressed by Daniel
  this round (silence ≠ acceptance; re-surface); serif-lettering taste calls not ruled on; L96
  cross-count was fixed but the frame now has the white-tent seed defect (see ledger).
- The VPW-side prop-lettering whitelist routing gap (from round 1) still open.
- Dashboard 07-05→07-15 timeline backfill still queued.

## Key paths

- Round-1 session scratchpad (unit briefs, logs, board builder + `board-flags.json`, merge tooling):
  `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-faceless-youtube\1945d41a-6f2e-40b2-bc2e-253bcdac82a7\scratchpad\`
- Gen law (pass2-brief v2) + review axis briefs: `...\1037de8d-223e-44bc-b3ce-cbc5c6b1e82f\scratchpad\`
- Video: `channels/the-second-take/videos/2026-07-04-poyais/` (manifest stamp `rework36_round1`;
  `_rework-log-2026-07-16.md`; superseded PNGs in `assets/*/_superseded-2026-07-16/` — round-1
  originals survive there if a diff is needed).
- Standing rules: all grunt work to Opus 4.8 agents (verify model in logs); board republishes to
  the SAME artifact URL; supersede-first; orchestrator-only manifest merges; UTF-8 by codepoint.
