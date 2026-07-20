# FIDELITY review — shard 5 (L81–L100)

Judge: fresh-eyes FIDELITY subagent, shard 5. All 22 images opened with Read.
Fact authority: `research.md` fact ledger [F-01]–[F-35]. Any on-screen figure without an F-NN is a fabrication.

### L81
TRANSCRIBED: "SENATE"
PROMPT ASKED: "SENATE"
FACT CHECK: Stumpf as CEO seated before Senate Banking Committee, Sept 2016 -> [F-02]; silver-haired older CEO, navy pinstripe, burgundy tie = casting spec, no factual claim. No numbers rendered.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The prompt places the sign "on the panel front"; the pixels put the "SENATE" placard flat on the *witness* table under Stumpf's own hand, so the sign reads as labelling the witness rather than the committee — the panel front carries only a blank red strip.
- [LOW] Six senator heads are on the crowd rig as specified (round heads, dot eyes, no noses/ears/teeth) and the single red accent sits on the panel nameplate strip as asked; no defect there.

### L82
TRANSCRIBED: "8 = GREAT"
PROMPT ASKED: "8 = GREAT"
FACT CHECK: the eight-products target chosen partly because eight rhymed with "great" -> [F-01],[F-02]. No numbers beyond the "8".
VERDICT: FLAG
FINDINGS:
- [LOW] A wooden gavel is rendered on the table — not requested by the prompt; it pushes the read toward a courtroom rather than a Senate hearing table, though gavels do exist at Senate hearings, so the read is only mildly muddied.
- [LOW] The prompt says the placard sits "in front of the witness chair"; the frame stages it in front of three anonymous suited torsos that read as panel/counsel side, not as the witness seat. Geography is soft rather than wrong.

### L83
TRANSCRIBED: "OCT" | "2016" (two lines on one tent card, crop `_review/crops/s5_L83_date.png` confirms all four numerals clean and unmirrored)
PROMPT ASKED: "OCT 2016"
FACT CHECK: Stumpf resigned October 12, 2016 -> [F-25]. Month/year only, no fabricated day.
VERDICT: PASS
FINDINGS: none

### L84
TRANSCRIBED: "2018" | "FIRST" (on the red hang-tag; crop `_review/crops/s5_L84_tool.png` shows the device's teal display carries abstract bar glyphs only, no lettering)
PROMPT ASKED: "2018" and "FIRST"
FACT CHECK: February 2, 2018 Fed asset cap, first time the Fed capped an entire firm -> [F-34]. No dollar figures on screen.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The "brand-new, never-before-used tool" is rendered as an incoherent sci-fi prop — a crowbar/pry-bar fused mid-shaft into a glowing electronic handset with a teal readout and three red LEDs, hanging from a cable with a floating hook — it does not read as any real tool, so the shot's "unprecedented instrument" beat lands as futuristic gadgetry rather than regulatory power.
- [LOW] Two wall-mounted security cameras and background gears were not requested; harmless vault set dressing, no text.

### L85
TRANSCRIBED: "FEDERAL RESERVE" (crop `_review/crops/s5_L85_sign.png` — all 14 characters clean, correctly spaced, not mirrored)
PROMPT ASKED: "FEDERAL RESERVE"
FACT CHECK: the Fed as the actor that imposed the cap -> [F-34]. No numbers, no dates rendered.
VERDICT: PASS
FINDINGS: none

### L86
TRANSCRIBED: "$1.95T"
PROMPT ASKED: "$1.95T"
FACT CHECK: assets capped at roughly end-2017 level, ~$1.95 trillion -> [F-34]. Currency glyph is "$" (correct for a US story; no £/€ present). Dial carries no other numerals — no fabricated scale values.
VERDICT: FLAG
FINDINGS:
- [LOW] The prompt asks for "its needle locked at a marker reading '$1.95T'"; the red needle points to a bare tick on the right-hand side while the "$1.95T" label floats up-left of it, so the number is not actually the value the needle indicates — the meter reads as decorative rather than as a locked reading.

### L87
TRANSCRIBED: (none)
PROMPT ASKED: (none — prompt explicitly says "no unrequested text")
FACT CHECK: no on-screen figures, names, dates or claims. Nothing to source.
VERDICT: FLAG
FINDINGS:
- [LOW] The prompt asks for the building "visibly pressing up against" the ceiling; the render leaves a clear air gap between the pediment and the slab, so the compression beat is weaker than specified. Red accent correctly confined to the four clamp bolts; no text leaked; period-correct neoclassical bank, no drift.

### L88
TRANSCRIBED: "7 YEARS" | "LIFTED 2025" (crop `_review/crops/s5_L88_tag.png` — "2025" numerals clean and unambiguous)
PROMPT ASKED: "7 YEARS" and "LIFTED 2025"
FACT CHECK: cap held more than seven years -> [F-34]; lifted June 3, 2025 -> [F-34]. No fabricated month/day added.
VERDICT: PASS
FINDINGS: none

### L89
TRANSCRIBED: "$3 BILLION"
PROMPT ASKED: "$3 BILLION"
FACT CHECK: $3 billion combined DOJ/SEC resolution, Feb 21 2020 -> [F-17]. Currency glyph "$" correct for a US story. Banknote faces carry blank ovals and no denominations, so no invented note values.
VERDICT: FLAG
FINDINGS:
- [LOW] The prompt asks for a "settlement table"; the render puts the cash under a bare wooden trestle frame with upright posts that reads closer to a market stall or auction booth than a settlement table.

### L90 (plate)
TRANSCRIBED: "2002-2016" | a legible cursive signature reading approximately "Cehan Jan" (crops `_review/crops/s5_L90_span.png`, `_review/crops/s5_L90_sig.png`)
PROMPT ASKED: "2002-2016" and (on the separate cutout) "ADMITTED"
FACT CHECK: misconduct admitted to have run 2002–2016 -> [F-17]. Span digits render clean and unoccluded. The signature name traces to NO F-NN -> unsourced rendered name string.
VERDICT: FLAG
FINDINGS:
- [HIGH] The document carries a legible hand-lettered signature that spells out roughly "Cehan Jan" — an unsourced person-name-shaped string on a legal admission document in a story about real, named, living people; the prompt authorized only "2002-2016" on this plate. The prompt did call for a "signed" document, so the fix is an illegible squiggle, not removing the signature.
- [LOW] The two heavy black bars across the document head read as redaction bars, and "2002-2016" sits riding on the upper bar; on a shot whose whole point is a concession made *on the record*, redaction styling works against the beat.

### L90-stamp (cutout)
TRANSCRIBED: "ADMITTED"
PROMPT ASKED: "ADMITTED" (authored text, exact)
FACT CHECK: the bank admitted the misconduct in the 2020 DPA -> [F-12],[F-17]. No numbers.
VERDICT: PASS
FINDINGS: none — eight characters, correct spelling, stamp-register red block caps, not mirrored, no truncation.

### L91
TRANSCRIBED: "$500M /" | "FOR INVESTORS" (crop `_review/crops/s5_L91_tag.png` — the solidus is rendered as a visible glyph trailing the "M")
PROMPT ASKED: "$500M" and "FOR INVESTORS"
FACT CHECK: $500 million of the $3 billion paid to the SEC for distribution to harmed investors -> [F-18]. "$" glyph correct; no £/€ present.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The prompt's own line-separator "/" from the phrase "'$500M / FOR INVESTORS'" has been rendered as diegetic lettering on the placard — the frame's final text clause authorized only "$500M" and "FOR INVESTORS", so the sign reads "$500M /" with a dangling slash.
- [LOW] Crowd rig is compliant (round heads, dot eyes, line mouths, no noses/ears/teeth); the single female figure's hair is an addition but breaks nothing.

### L92
TRANSCRIBED: "?"
PROMPT ASKED: "?"
FACT CHECK: no figures, names, dates or claims on screen. Nothing to source.
VERDICT: PASS
FINDINGS: none — two empty executive chairs at the head of a boardroom table, one hand-lettered question mark, red accent confined to the question mark's dot exactly as specified.

### L93
TRANSCRIBED: "NOTHING" (crop `_review/crops/s5_L93_tag.png` — spelling correct but the string is rotated roughly 90° clockwise, reading top-to-bottom down a hanging tag)
PROMPT ASKED: "NOTHING"
FACT CHECK: no figures or claims on screen. Nothing to source.
VERDICT: FLAG
FINDINGS:
- [BLOCKING] The shot was not delivered: the prompt says "The SAME two executive chairs, still and undisturbed, a little dust settling" — a continuity beat off L92's boardroom — but the render drops the two chairs into a **fog-bound mangrove swamp**, complete with stilt-rooted mangroves, cypress stumps standing in standing water, cattails and floating dead leaves. Mangrove swamp is exactly the setting drift this brief enumerates; it also destroys the L92→L93 match.
- [BLOCKING] The "NOTHING" string is rendered rotated ~90° on a hanging luggage tag rather than as a flat marker tag; per the transcription rule a rotated string is blocking, and here it is also unreadable at scroll speed.
- [MEDIUM] The chairs are swapped for a different pair — L92's high-back leather boardroom chairs become caster-wheeled task chairs — breaking the "same two chairs" requirement independently of the swamp.

### L94
TRANSCRIBED: "COMMUNITY BANK" as authored, but as rendered on screen the "I" is completely hidden behind the character's head — the visible string is "COMMUN‸TY BANK" (crop `_review/crops/s5_L94_sign.png`)
PROMPT ASKED: "COMMUNITY BANK"
FACT CHECK: Tolstedt headed the Community Bank division ~2007–2016 -> [F-19]. No numbers, dates or dollar figures rendered — correctly, since none were prompted. Casting (blonde-grey short bob, burgundy blazer) matches the pinned look.
VERDICT: FLAG
FINDINGS:
- [BLOCKING] The banner's lettering is occluded by the subject: her head and hair sit dead-centre over the sign and swallow the "I" of "COMMUNITY", so the on-screen word reads "COMMUNTY". An occluded word is a blocking text defect; the fix is to lower the character or raise the sign, not to re-letter it.
- [LOW] The red accent is on the sign underline as specified, but the underline is also partly hidden behind her head; background branch staff are on the crowd rig with hair additions, acceptable.

### L95
TRANSCRIBED: "THANK YOU"
PROMPT ASKED: "THANK YOU"
FACT CHECK: retirement announced and praised months before the scandal broke -> [F-27] note. The watch face carries tick marks and hands but no numerals, so no invented date/time. No dollar figures.
VERDICT: FLAG
FINDINGS:
- [BLOCKING] The prompt asks for "just outside the frame's edge storm clouds gather"; the render instead builds a literal picture-frame around the send-off and fills everything outside it with the **same fog-bound mangrove swamp used in L93** — dead stilt-rooted mangroves, water-standing stumps, cattails. Mangrove swamp is enumerated setting drift and it replaces the specified gathering-storm read with a wetland that means nothing in a 2016 American banking story.
- [MEDIUM] Nesting the whole scene inside a hard rectangular picture frame was not asked for and reads as a poster of a retirement rather than the retirement itself, muting the irony the shot exists to carry.

### L96
TRANSCRIBED: (none)
PROMPT ASKED: (none — "no unrequested text")
FACT CHECK: both were initially set to leave with pay intact -> [F-26],[F-27] and the ledger's note that "before that both had been set to leave with their pay". No on-screen figures. Casting/costume correct: Tolstedt LEFT in burgundy blazer, Stumpf RIGHT in navy pinstripe, both deadpan, both on their pinned looks.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The prompt says "each carrying a fat money bag" — one apiece. Stumpf is rendered with TWO money bags to Tolstedt's one, which silently asserts a 2:1 split of the payout that no ledger entry supports (the actual totals are ~$69M vs ~$67M, [F-26],[F-27] — near-equal).
- [LOW] The "one red accent on the money-bag ties" lands on only Stumpf's middle bag; Tolstedt's bag tie and Stumpf's right-hand bag tie are untinted, so the accent is inconsistent rather than semantic.

### L97
TRANSCRIBED: (none)
PROMPT ASKED: (none — "no unrequested text")
FACT CHECK: months of public and political pressure preceded the board clawback -> [F-26],[F-27] and [Q-04]. No on-screen figures; banknotes carry blank ovals, no denominations, so no invented note values.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The prompt asks for a crowd "and a raised gavel TOGETHER pressing on a big lever"; the render fuses the two — the gavel's handle IS the lever and the crowd is shoving the gavel — so the political/judicial authority is no longer a second force applying pressure, it is the thing being pushed. The "lever" itself is rendered as a red mailbox-shaped block with no fulcrum or mechanism.
- [LOW] The clawing hand is pulling banknotes UP and OUT toward itself with no direction cue back to a payer, so it reads as much like someone helping themselves as like a reluctant clawback.
- Crowd rig compliant: round heads, dot eyes, no noses/ears/teeth.

### L98
TRANSCRIBED: "$69M" | "STUMPF"
PROMPT ASKED: "$69M" and "STUMPF"
FACT CHECK: ~$69 million total forfeited/clawed back from Stumpf -> [F-26]. "$" glyph correct. "STUMPF" is a real named person whose $69M figure is sourced, so the name is permissible here.
VERDICT: FLAG
FINDINGS:
- [HIGH] "Clawed back" has been rendered literally as a **monster's talon** — a grey scaled reptilian claw with four hooked talons on a shaggy grey-and-cream limb — gripping the money bag. Nothing in the prompt or the story calls for a creature; it drops a fantasy beast into a documented 2016 board action and breaks register with L97, where the same clawback is a human hand in a suit cuff.
- [LOW] The ground is rendered as pale ice and grey boulders rather than the specified "cool slate-and-cream" interior/neutral setting, adding an unexplained arctic exterior.

### L99 (plate)
TRANSCRIBED: "$67M" (set on a steep diagonal, roughly 50° off horizontal) | "TOLSTEDT" (rotated 90°, reading top-to-bottom up the tag's edge)
PROMPT ASKED: "$67M" and "TOLSTEDT" (plus "FIRED FOR CAUSE" on the separate cutout)
FACT CHECK: ~$67 million total forfeited/clawed back from Tolstedt -> [F-27]. "$" glyph correct. "TOLSTEDT" is a real named person whose $67M figure and for-cause retroactive termination are both sourced -> [F-27].
VERDICT: FLAG
FINDINGS:
- [BLOCKING] Both strings on the tag are rotated: "TOLSTEDT" runs vertically at 90° and "$67M" sits on a ~50° diagonal. Per the transcription rule a rotated string is blocking; at playback speed neither reads, and "TOLSTEDT" — the load-bearing name attaching the $67M to a real person — is the harder of the two to parse.
- [MEDIUM] The prompt reserves the frame's single red accent for the "FIRED FOR CAUSE" stamp, but the plate already carries a large saturated-red tag occupying roughly a fifth of the frame; when the stamp composites on top there will be two competing reds and the stamp will no longer be the semantic accent.
- [LOW] The clawing hand here is an ordinary human hand, which is correct — but it means L98 and L99, the matched pair of clawback shots, disagree with each other (talon vs hand).

### L99-stamp (cutout)
TRANSCRIBED: "FIRED FOR CAUSE"
PROMPT ASKED: "FIRED FOR CAUSE" (authored text, exact)
FACT CHECK: the board terminated Tolstedt for cause, retroactively -> [F-27]. No numbers.
VERDICT: PASS
FINDINGS: none — spelling exact across all thirteen characters and two words' spacing, stamp-register red block caps, alpha channel clean (transparent background verified, min alpha 0), plate and lettering sampled at ~#b03020/#c03020, in the house red family with no off-palette hue.

### L100
TRANSCRIBED: "BANK" (fascia sign on the building) | "rig form" (lowercase italic, on the document the middle official holds — crop `_review/crops/s5_L100_rigform.png`)
PROMPT ASKED: (none — "marker lettering only … no unrequested text, no logos")
FACT CHECK: regulators turning from the institution to individuals -> [F-28],[F-29]. No numbers, dates or dollar figures rendered, correctly.
VERDICT: FLAG
FINDINGS:
- [BLOCKING] The document is lettered **"rig form"** — the prompt's own casting instruction ("Anonymous base-rig officials … hold ONLY the rig form") has been rendered as diegetic lettering on a prop inside the frame. This is the textbook instruction-leak case and it is the single worst defect in the shard.
- [HIGH] The building fascia reads "BANK" — unrequested text in a frame whose prompt explicitly forbids any text, and it labels the institution in a way no other shot in the shard does.
- [LOW] Nine executive silhouettes are lined up; the OCC action named **eight** former executives [F-29]. No count is asserted on screen so this is not a fabrication, but a viewer counting heads gets the wrong number — nine should be trimmed to eight.
- [LOW] The prompt puts the single red accent "on a pointing seal"; the red dot sits on the held document while the pointing is done by a separate bare hand, so the accent and the gesture are on different objects.

## Shard 5 summary

| id | verdict | worst severity |
|---|---|---|
| L81 | FLAG | MEDIUM |
| L82 | FLAG | LOW |
| L83 | PASS | — |
| L84 | FLAG | MEDIUM |
| L85 | PASS | — |
| L86 | FLAG | LOW |
| L87 | FLAG | LOW |
| L88 | PASS | — |
| L89 | FLAG | LOW |
| L90 (plate) | FLAG | HIGH |
| L90-stamp | PASS | — |
| L91 | FLAG | MEDIUM |
| L92 | PASS | — |
| L93 | FLAG | BLOCKING |
| L94 | FLAG | BLOCKING |
| L95 | FLAG | BLOCKING |
| L96 | FLAG | MEDIUM |
| L97 | FLAG | MEDIUM |
| L98 | FLAG | HIGH |
| L99 (plate) | FLAG | BLOCKING |
| L99-stamp | PASS | — |
| L100 | FLAG | BLOCKING |

**Counts:** 22 frames ruled. 6 PASS, 16 FLAG. 5 frames carry BLOCKING findings (L93, L94, L95, L99, L100); 2 carry HIGH (L90, L98).

**Fact-sourcing result:** no fabricated figure was found anywhere in this shard. Every rendered number traces to the ledger — "$1.95T" [F-34], "7 YEARS"/"LIFTED 2025" [F-34], "$3 BILLION" [F-17], "$500M" [F-18], "2002-2016" [F-17], "$69M" [F-26], "$67M" [F-27], "OCT 2016" [F-25], "2018" [F-34], "8 = GREAT" [F-01],[F-02]. No invented criminal charge appears (nothing in this shard asserts any charge; the obstruction count [F-32] is not reached until later shots). Every currency glyph is "$" — no £ or € anywhere. The only unsourced name-shaped string in the shard is the fake cursive signature on the L90 plate.

**Pattern worth flagging to the batch owner:** the defects cluster by kind, not by chance. Three frames (L93, L95, and the ice field behind L98) put American-banking beats in wet/arctic wilderness settings that no prompt requested — L93 and L95 share the identical mangrove swamp, which suggests one bad generation seed reused. Three frames (L93 "NOTHING", L99 "$67M"/"TOLSTEDT") rotate authored strings onto tags instead of setting them flat. And two frames leak non-diegetic material into the picture: the prompt's own separator in L91 ("$500M /") and, far worse, the prompt's rig instruction lettered onto a prop in L100 ("rig form").
