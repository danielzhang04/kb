# FIDELITY review — shard 3 (L41–L60, incl. plate L44 + cutout L44-stamp)

Judge: fresh-eyes review subagent. Ledger: `research.md` [F-01]–[F-35].

### L41
TRANSCRIBED: "565,000"
PROMPT ASKED: "565,000"
FACT CHECK: 565,000 -> [F-10] / [F-06] (565,433 unauthorized credit-card accounts; VO rounds to "around 565,000") — CLEARED
VERDICT: FLAG
FINDINGS:
- [LOW] The single red accent is applied to only the middle of the numeral — "56" is #241a12 black, "5,0" is red, "00" is black again — so the tag reads as a colour-split "56|5,0|00" rather than one figure; house style wants the accent on the tag, not slicing a number.
- [LOW] Prompt says "unauthorized credit AND debit cards"; every card in the fan is a blank rounded rectangle with a chip — nothing distinguishes credit from debit, so the "credit and debit" pairing is not delivered (harmless, but the shot asserts less than the prompt).

### L42
TRANSCRIBED: "GOOD" | "EXCELLENT" | "POOR" | "100" | "500" | "FEES & INTEREST" | "+$800..." | "+$480" | "+$250" | "+$120" | "+$50" | "THE QUIET DAMAGE OF A CARD NOBODY WANTED."
PROMPT ASKED: no literal strings quoted; "marker lettering only", "no unrequested text (short labels only)"
FACT CHECK:
- "100" / "500" as credit-score gauge endpoints -> FABRICATED **and impossible**. No F-NN gives any score value; FICO/VantageScore ranges are 300–850. A gauge running 100→500 is not a credit score.
- "+$800...", "+$480", "+$250", "+$120", "+$50" -> FABRICATED. The ledger's only fee/refund figures are $2.8M and $3.3M aggregate refunds [F-14]; there is no per-customer fee or interest figure anywhere in the ledger.
- "POOR"/"GOOD"/"EXCELLENT" -> generic band labels, no fact asserted, acceptable.
VERDICT: FLAG
FINDINGS:
- [BLOCKING] The gauge is lettered "100" and "500" as its scale endpoints — an impossible credit score (real range 300–850), and no `[F-NN]` sources any score value; the correct fix is to omit the numeric scale entirely and leave only POOR/GOOD/EXCELLENT bands.
- [BLOCKING] The red column invents five dollar amounts — "+$800...", "+$480", "+$250", "+$120", "+$50" — none of which is traceable to any ledger entry; on a real-person YMYL banking story these must be omitted, not corrected.
- [BLOCKING] The prompt's own descriptive rationale is rendered as diegetic lettering: the frame is captioned "THE QUIET DAMAGE OF A CARD NOBODY WANTED." — that phrase is the still_prompt's editorial gloss ("the quiet damage of a card nobody wanted"), not a requested on-screen string, and the prompt explicitly said "no unrequested text".
- [MEDIUM] The scale is internally incoherent even as a cartoon: "100" sits at the POOR/GOOD boundary and "500" at the GOOD/EXCELLENT boundary, so the two bands the needle is meant to contrast are labelled with numbers that do not bound them.

### L43
TRANSCRIBED: "INSURANCE" (red tag) | "RENTERS" (vertical, right-to-left down the left folder, partly hidden behind the tag) | "LIFE" / "INSURANCE" (right folder, the second word occluded mid-string by the tag — reads "INSURA…CE")
PROMPT ASKED: "INSURANCE" — and explicitly "no unrequested text beyond 'INSURANCE'"
FACT CHECK: renters' insurance and life insurance as unwanted products -> [F-11] — CLEARED (no numbers on frame)
VERDICT: FLAG
FINDINGS:
- [BLOCKING] Two strings the prompt forbade are lettered on the folders and both are damaged: "RENTERS" runs vertically down the left folder and is cut through by the tag, and the right folder's "LIFE INSURANCE" has its second word occluded mid-word by the tag so it renders as a truncated "INSURA…CE".
- [MEDIUM] Rig violation: the customer's hands are rendered as full five-digit, pink, knuckle-shaded human hands with wrist cuffs, not the specified "four-digit hands" of the base rig.
- [LOW] The figure's head is cropped off above the mouth line, so the "round head, NO nose, NO ears" base rig cannot be read at all — the shot delivers a torso, not the specified customer.

### L44 (plate: `assets/plates/L44.png`)
TRANSCRIBED: "JUSTICE DEPT"
PROMPT ASKED: "JUSTICE DEPT" and "ADMITTED" (the latter supplied as the separate cutout, correctly absent from the plate)
FACT CHECK: "JUSTICE DEPT" -> [F-12],[F-17] (Feb 21 2020 DOJ deferred-prosecution agreement; the bank admitted false bank records and misuse of personal information) — CLEARED. No figures, dates or names rendered.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] Period drift: the settlement desk is dressed with a **dip pen with an exposed steel nib and a corked glass inkwell**. This is a February 2020 federal DPA; a 19th-century writing set is the wrong century for the only story-anchoring prop in the frame.
- [LOW] Style drift off house spec: the desk is rendered with soft painterly wood-grain gradients and a photographic-style vignette rather than "flat cel with soft shading"; the outline weight on the document is also markedly heavier than on the pen and inkwell, so the frame is not uniformly on the even medium-thick #241a12 outline.
- [LOW] The document body is entirely blank apart from two hairline rules — the prompt called for "a formal settlement document", and a blank sheet reads as an unsigned/unstarted page rather than a settlement being conceded.

### L44-stamp (cutout: `assets/cutouts/L44-stamp.png`)
TRANSCRIBED: "ADMITTED"
PROMPT ASKED: authored text is exactly "ADMITTED"
FACT CHECK: "ADMITTED" -> [F-12] (the DPA admission) — CLEARED. No figures.
VERDICT: FLAG
FINDINGS:
- [LOW] Letter-by-letter the string is correct: A-D-M-I-T-T-E-D, red block caps, double T intact, no truncation or mirroring.
- [MEDIUM] Style drift: the cutout is a stock-style grunge rubber stamp with a 3D bevelled extrusion, inner highlight and drop shadow. The house style is "clean flat 2.5D vector cartoon… even medium-thick #241a12 outline, flat cel"; this asset has no #241a12 outline at all (its outline is red) and its bevel/noise treatment will not sit inside the L44 plate.

### L45
TRANSCRIBED: "CONSENT FORM" (final M clipped by the magnifier bezel) | "YOU NAME" | "SIGNATURE" | "FORGED"
PROMPT ASKED: "FORGED" — and explicitly "no unrequested text beyond 'FORGED'"
FACT CHECK: forged consent as an admitted fact -> [F-12] — CLEARED. No figures, dates or names; the signature is an illegible scrawl, correctly not a real person's name.
VERDICT: FLAG
FINDINGS:
- [BLOCKING] The form's first field is lettered **"YOU NAME"** — a misspelling of "YOUR NAME"; a dropped R on a document the shot pushes in on.
- [HIGH] Three strings the prompt forbade are lettered on the form ("CONSENT FORM", "YOU NAME", "SIGNATURE"), and "CONSENT FORM" is additionally truncated — the final M is cut through by the magnifying-glass bezel.
- [HIGH] The shot's load-bearing action is not delivered: the prompt puts the magnifying glass **over the signature line**, but the glass sits over a blank ruled line in the upper form body while the actual "SIGNATURE" line and its scrawl sit outside the lens at bottom-left. The lens also does not magnify — the signature under it is drawn at the same scale as the one outside, so "revealing it as fake" never happens.
- [MEDIUM] The forged signature is duplicated: the identical scrawl appears twice, once under the lens and once on the SIGNATURE line, which reads as a rendering artefact rather than one forged consent.
- [LOW] The prompt specifies "a small 'FORGED' mark by the signature" as the single red accent; the delivered stamp is a large circular rubber stamp, not a small mark, and is the only red in frame (that part is correct).

### L46
TRANSCRIBED: "93 MILLION" | "2011-2015" | LED counter: a dim/blank leading digit then "77,000" — the two 7-segment sevens are malformed (extra strokes, the second reads as a broken 7/1) and the final zero is missing its bottom segment so it renders as a "U". Best literal transcription: `▯77,00U`
PROMPT ASKED: "93 MILLION" and "2011-2015" — and explicitly "no unrequested text beyond '93 MILLION' and '2011-2015'"
FACT CHECK:
- "93 MILLION" -> [F-06] (~93.5 million accounts reviewed; VO says "about 93 million") — CLEARED
- "2011-2015" -> [F-06] (May 2011 – mid-2015 window) — CLEARED
- LED "77,000" -> FABRICATED. No `[F-NN]` contains 77,000 or any variant. The ledger's counts are 2.1M/2.55M/3.5M/981,000/190,000/5,300/23,000/565,433/1,534,280 — none is 77,000.
VERDICT: FLAG
FINDINGS:
- [BLOCKING] The scanner's LED counter displays an unsourced figure — `77,000` — that appears in no ledger entry; on a real-case YMYL frame an invented count on a counting machine is a fabricated fact and the element must be omitted (blank the display), not renumbered.
- [BLOCKING] That same counter is *malformed as rendered*: the leading digit position is dark, both sevens carry stray segments, and the trailing zero is drawn without its bottom segment so it reads as a "U" — a garbled numeral, and it is text the prompt explicitly forbade ("no unrequested text beyond '93 MILLION' and '2011-2015'").
- [LOW] The prompt's single red accent was to sit "on the count window" (i.e. the '2011-2015' window); the only red in frame is the LED counter — the accent has landed on the fabricated element instead of the sourced one.

### L47
TRANSCRIBED: "2.1 MILLION" | "?"
PROMPT ASKED: "2.1 MILLION" and "?"
FACT CHECK: "2.1 MILLION" -> [F-06] (~2.1 million potentially unauthorized accounts) — CLEARED. The "?" correctly carries the [Open Q1] "potentially" hedge.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] Unrequested content changes the read: five dead brown autumn leaves are scattered across the ground plane. Nothing in the prompt puts this scene outdoors, and the leaves relocate a bank-records shot to a yard.
- [MEDIUM] The shot's load-bearing action is not delivered. The prompt calls for "a stack of flagged account cards **pulled aside** out of the swept mass" — the frame shows two undifferentiated cream stacks with no flags, no markers and no sense of separation; nothing has been pulled out of anything, and there is no swept mass for it to have come from.
- [LOW] The prompt puts the red accent "on the '2.1 MILLION' tag"; the tag stock is cream and only the lettering is red — a minor read of the accent spec, noted for consistency with L41/L49 where the same instruction was handled differently.

### L48
TRANSCRIBED: "165 MILLION" | "2009-2016"
PROMPT ASKED: "165 MILLION" and "2009-2016"
FACT CHECK:
- "165 MILLION" -> [F-13] (~165 million retail accounts in the expanded PwC review) — CLEARED
- "2009-2016" -> [F-13] (January 2009 – September 2016 window) — CLEARED
VERDICT: FLAG
FINDINGS:
- [HIGH] The shot is not the one that was ordered. The prompt asks for "the review window drawn wider on a timeline — brackets stretching back and forward over more years". There is no timeline, no years marked, and no brackets: the frame is a slack fishing net slung between two red-and-grey scroll rollers. The prompt's *metaphor* ("a bigger net over more accounts") has been rendered as a literal fishnet, and the widening — the entire point of the beat, and the thing that defuses the "fraud doubled" myth in L50–L53 — is never depicted.
- [HIGH] The net is empty. The beat is that a wider net caught more accounts; not a single account card, ledger sheet or countable object is inside or near it, so the frame asserts nothing about 165 million of anything.
- [MEDIUM] The single red accent was specified "on the widening brackets"; it has landed on two decorative roller end-caps that carry no meaning, so the frame has red without semantics — a direct violation of "the single red accent #d7402b used only semantically".

### L49
TRANSCRIBED: "3.5" / "MILLION" (two lines on one red cap sign)
PROMPT ASKED: "3.5 MILLION"
FACT CHECK: "3.5 MILLION" -> [F-13] (~3.53 million potentially unauthorized accounts, Aug 31 2017 expanded review) — CLEARED
VERDICT: FLAG
FINDINGS:
- [BLOCKING] Setting drift of exactly the kind the brief names as disqualifying: the entire background is a **drowned mangrove swamp** — mangrove prop roots, dead standing trees, rotted stumps, cattails and open floodwater. This story is 1999–2023 American retail banking; nothing in the prompt puts this shot outdoors, let alone in a wetland, and the swamp is roughly 80% of the frame.
- [HIGH] Because of the swamp, the object no longer reads as the ordered shot. The prompt asks for "a tally figure climbing up a marker bar to a new top reading '3.5 MILLION'" — as delivered it reads as a flood-depth staff gauge or a roadside sign standing in water, so the *climbing tally* metaphor (the count going up) is lost and replaced by an accidental "rising water" metaphor the beat never asked for.
- [MEDIUM] The whole frame is desaturated blue-grey with the red sign as the only chroma; the prompt specified a "cool slate-and-cream palette", and the cream is essentially absent — the frame has drifted into the desaturated gravity register reserved for L57/L58.
- [LOW] The climbing figure has a completely blank head — no dot eyes, no mouth — which is neither the base rig nor the crowd rig described elsewhere in this shot list.

### L50
TRANSCRIBED: "FRAUD" / "DOUBLES"
PROMPT ASKED: "FRAUD DOUBLES"
FACT CHECK: "FRAUD DOUBLES" -> this is deliberately the *misreport*, staged to be corrected by L51–L53; it is covered by the ledger's own myth entry ("Myth: the number of fake accounts 'doubled' from 2.1M to 3.5M") built on [F-06],[F-13] — CLEARED as an intentional depiction of a wrong headline, not an assertion. No figures, dates or names rendered.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] Palette miss: the prompt specifies a "cool newsprint-grey-and-cream palette", but the background is a warm street of tan, pink and brown buildings under a blue sky — the frame's dominant colours are the opposite temperature to spec, and the warm-brick street reads more period-town than 2017 news cycle.
- [MEDIUM] Style break: the background is rendered with a heavy photographic depth-of-field blur (a lens effect), not "flat cel with soft shading and depth". No other frame in this shard uses optical bokeh, so this one will not cut with its neighbours.
- [LOW] The newspaper carries two grey masthead blocks and two grey column blocks that read as placeholder text-plates; they are unlettered so nothing is misspelled, but they are unrequested furniture on a frame specified as text-minimal.

### L51
TRANSCRIBED: "2.1M" (struck through with a red X) | "2.55M"
PROMPT ASKED: "2.1M" and "2.55M"
FACT CHECK:
- "2.1M" -> [F-06] — CLEARED
- "2.55M" -> [F-13] (3.53M = 2.55M from the original window + 981,000 from the added years) — CLEARED
VERDICT: FLAG
FINDINGS:
- [HIGH] The shot's load-bearing content is missing entirely. The prompt asks for the correction to be made "over the SAME window" using "a longer ruler" — the point of the beat, per [F-13] and the ledger's myth entry, is that *the period did not change, only the measuring did*. The frame delivers two floating numbers on an empty gradient: no ruler, no window, no timeline, no same-period anchor. The viewer is given 2.1→2.55 with no reason it changed, which is precisely the misreading L50–L53 exist to prevent.
- [MEDIUM] Style break: both figures are 3D-extruded bevelled balloon type with drop shadows and highlight rims — not "marker lettering" on an "even medium-thick #241a12 outline, flat cel". "2.55M" additionally has a red outline rather than a #241a12 one.
- [MEDIUM] The prompt requires the frame be "filled edge-to-edge"; it is a bare blue-grey vignette gradient with no scene, no ground plane and no objects.
- [LOW] The red X is centred on the decimal point of "2.1M", cutting through the "." and the "1", so the struck figure is partially obscured at the exact characters that distinguish it from 2.55M.

### L52
TRANSCRIBED: "+981,000"
PROMPT ASKED: "+981,000"
FACT CHECK: "+981,000" -> [F-13] (981,000 additional accounts from the newly-added periods) — CLEARED
VERDICT: FLAG
FINDINGS:
- [BLOCKING] The same disqualifying setting drift as L49, worse: the frame is almost entirely a **drowned mangrove swamp** — prop-rooted mangroves, dead trees, rotting stumps, cattails, floodwater and a storm sky. The prompt asked for "a small extra slice of the timeline… contributing a marker figure '+981,000' onto the pile". A wetland appears nowhere in the prompt or the ledger.
- [HIGH] The subject object is unreadable. What the callout points to is a half-sunken dome woven out of ruler/tape bands, sitting in the water. It is neither a slice of a timeline nor a pile of accounts, so the beat's entire claim — *new years, not new fraud* — is not depicted; a viewer cannot tell what the 981,000 is being added to.
- [HIGH] Continuity break with the number trail: L46/L47/L51/L53/L54 all render accounts as cream card stacks on a clean slate ground. L52 abandons that vocabulary mid-sequence, so the "+981,000" does not visibly join the same pile the surrounding shots have been building.
- [MEDIUM] Palette: specified "cool slate-and-cream"; delivered is near-monochrome storm grey with no cream at all.

### L53
TRANSCRIBED: "SAME" / "PILE" (two lines on the tag)
PROMPT ASKED: "SAME PILE"
FACT CHECK: no figures, dates, names or amounts rendered. The claim carried ("the pile did not change, the measuring did") -> [F-06],[F-13] and the ledger's myth entry — CLEARED
VERDICT: FLAG
FINDINGS:
- [LOW] Neither ruler is actually measuring anything: both lie flat on the tabletop parallel to the viewer, offset from the stack, rather than laid against the pile. The prompt's gag depends on the *same* pile being measured twice — as drawn the rulers are props beside the pile, not instruments on it, which softens the strongest visual argument in the whole 2.1M→3.5M correction sequence.
- [LOW] The "SAME PILE" tag wraps onto two lines and hangs off the pile's right edge at a slight rotation; legible, correctly spelled, no truncation — noted only because the tag partially overlaps the stack's lower cards.
- Otherwise the shot delivers exactly what was ordered: one pile, one short ruler, one long ruler, and the single red accent confined to the long ruler's tip (semantic use, correct).

### L54
TRANSCRIBED: "190,000" | "FEE"
PROMPT ASKED: "190,000" and "FEE"
FACT CHECK: "190,000" -> [F-14] (about 190,000 accounts incurred fees and charges under the expanded review) — CLEARED
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The prompt specifies "a smaller marked-off subset of account cards **each** carrying a red 'FEE' dot". Only the single top card of the small stack is marked; every card beneath it is blank, so the frame does not read as 190,000 marked accounts — it reads as one marked account on top of an unmarked stack.
- [LOW] The marked card carries two red dots (one immediately left of "FEE", one below it) where the prompt calls for one dot per card; the lower dot is an unexplained duplicate.
- [LOW] The prompt puts the red accent "on the fee dots and tag"; the tag has been rendered as a solid red field with #241a12 lettering reversed out of it, which inverts the house convention used on L41/L47 (cream tag, red mark) and makes the red a background rather than an accent.

### L55
TRANSCRIBED: "ESTIMATE" (red tag) | the big figure reads `100` + a large red tilde overlaid mid-string + `000` — i.e. `100~000`. There is no comma; the tilde sits *between* the third and fourth digits and its lower stroke crosses the bowls of the third "0" and the fourth "0".
PROMPT ASKED: "~" and "ESTIMATE" — "a single big marker figure with a '~' tilde **in front of it**"
FACT CHECK:
- `100~000` / 100,000 -> **FABRICATED**. No `[F-NN]` contains 100,000. The ledger's counts are 2.1M/2.55M/3.5M/981,000/190,000/93.5M/165M/5,300/23,000/565,433/1,534,280; its only $100,000 figure is Tolstedt's criminal fine [F-33], which is a dollar amount from a completely different beat and is not what this shot is about.
- "ESTIMATE" -> [Open Q1] (both totals are the bank's own estimates of *potentially* unauthorized accounts) — CLEARED as a caveat label.
VERDICT: FLAG
FINDINGS:
- [BLOCKING] The frame's entire subject is an unsourced number: `100,000`. This beat's VO is about the caveat attached to *the numbers already on screen* (3.5M / 2.55M / 981,000 / 190,000); the shot invents a sixth figure that exists in no ledger entry. On a real-case YMYL video the fix is to omit the figure or reuse a sourced one, not to guess.
- [BLOCKING] The tilde is in the wrong place and mutilates the numeral. The prompt says the "~" goes **in front of** the figure; as rendered it is dropped into the middle of the digit string and its strokes cut through two zeros, so the number cannot be read cleanly at all — a garbled numeral by the letter of the transcription rule.
- [MEDIUM] The "ESTIMATE" tag is a solid red field with cream lettering and the tilde is also solid red, so the shot carries the red accent twice at full saturation against a spec of "the single red accent #d7402b used only semantically".
- [LOW] Unrequested background furniture: a bank vault door and two banks of filing cabinets are drawn behind the figure. Harmless, but the prompt described only "a single big marker figure" and the vault is the visual language of cash, not of an account-count caveat.

### L56
TRANSCRIBED: (none)
PROMPT ASKED: (none) — "no unrequested text"
FACT CHECK: no figures, dates, names or amounts rendered. The claim carried ("the cost landed on the employees") -> [F-15],[F-16] — CLEARED
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The red accent is broken. The prompt calls for "one red accent on the tipping arrow"; what is drawn is two disconnected chevrons — a red segment on the left of the fulcrum and a separate cream-and-#241a12 segment with a cream arrowhead on the right — so the arrow reads as two unrelated marks rather than one weight transferring from the executives' pan to the workers'. Half the accent is not even red.
- [MEDIUM] The prompt's "empty pan at the top (the executives)" is empty in the literal sense but carries no signal that it *is* the executives — no suits, no desk, no marker, nothing. With one pan blank and one full of workers, the frame reads as a generic "workers outweigh nothing" scale rather than the specified blame asymmetry.
- [LOW] All eight crowd figures share one identical head, one identical mouth and near-identical shirts; the crowd rig permits "varied ordinary work clothes" and the copy-paste repetition is visible at full frame.
- [LOW] Palette: specified "cool slate-and-cream"; the room behind is a flat mid-blue with essentially no cream, so the huddle does not separate from its ground.

### L57
TRANSCRIBED: "5,300 FIRED" | "EXIT"
PROMPT ASKED: "5,300 FIRED" — and "one faint red accent on the exit sign" (so the sign is called for, though its lettering is not quoted)
FACT CHECK: "5,300" -> [F-15] (about 5,300 employees fired for sales-practices violations, 2011–2016) — CLEARED
VERDICT: FLAG
FINDINGS:
- [HIGH] The shot's staging is inverted. The prompt asks for "a long line of anonymous counter-employees **filing out through a single exit door**". As drawn the line walks *toward the camera* down a corridor, past the exit; the EXIT door sits far left, off the line of travel, and not one figure is heading through it or even facing it. The image of people leaving the building — the whole point of the beat — is never made.
- [MEDIUM] "a **single** exit door" was explicit; the corridor contains at least six doors (the EXIT door plus five interior doors right and centre), which dilutes the funnel the prompt was after and makes the corridor read as an office hallway rather than a way out.
- [LOW] The "5,300 FIRED" sign is drawn as a rustic hanging wooden plank with grain and rope; in a grey modern corporate corridor this is a small period/register incongruity, and the prompt asked for "marker lettering", not a carved wooden sign.
- [LOW] "EXIT" is on-frame lettering beyond the one string the prompt quoted; it is correctly spelled and is implied by the prompt's own reference to an exit sign, so it is noted rather than blocked. The exit sign's red is correctly the only red in frame.
- Crowd rig is otherwise correct: cream round heads, dot eyes, single downturned mouths, no noses, no ears, no teeth, consistent squat proportion, varied greys, and a genuinely deep receding line.

### L58
TRANSCRIBED: "23,000+"
PROMPT ASKED: "23,000+"
FACT CHECK: "23,000+" -> [F-15] (more than 23,000 employees referred for sales-practices investigation) — CLEARED
VERDICT: FLAG
FINDINGS:
- [HIGH] Costume period drift across the whole crowd. At least ten figures in the front two ranks wear **buckled bib overalls**, and several others wear **brown waistcoats over collarless shirts**. This is a 2011–2016 American retail bank; the prompt asked for "varied ordinary work clothes". As drawn the crowd reads as early-20th-century farm and factory labour, which is exactly the wrong claim for a shot about bank tellers and personal bankers referred for investigation.
- [MEDIUM] The prompt's staging — "an even larger crowd of anonymous employees **behind the fired line**" — is not delivered. There is no fired line anywhere in frame, so the shot does not read as 23,000 stacked *behind* L57's 5,300; it reads as a standalone crowd, and the "the number multiplies" beat is lost.
- [MEDIUM] Nothing marks the crowd as "marked for investigation" — no tags, no marks, no flags, no separation. Only the overhead sign carries the idea, so the image itself asserts only "many people".
- [LOW] The "23,000+" placard is a white field with a red border and #241a12 lettering; the prompt asked for "one faint red accent on the tag", and a full red border is the boldest red in the frame rather than a faint accent.
- Crowd rig is otherwise correct: round cream heads, dot eyes, single neutral mouths, no noses, no ears, no teeth, consistent squat proportion.

### L59
TRANSCRIBED: "CLOSED" (red till sign, floor, lower level — correctly spelled, unmirrored) | the antique register's display window carries a row of illegible sub-pixel tick-glyphs that resolve to no readable characters
PROMPT ASKED: "CLOSED" — and otherwise "no unrequested text"
FACT CHECK: no figures, dates, names or amounts rendered. The claim carried ("punished below, undisturbed above") -> [F-15],[F-16] — CLEARED
VERDICT: FLAG
FINDINGS:
- [BLOCKING] Flagrant period drift on both floors, hitting three of the brief's named disqualifiers at once. Upstairs, the executive floor is populated by figures in **bonnets and long 19th-century gowns** and men in high-collar frock-coat suits, in a room with an arched fanlight doorway and oil landscapes. Downstairs, the single most prominent object on the emptied counter floor is an **antique brass crank cash register with its cash drawer hanging open** — and a second identical antique register sits on the upper floor at frame left. This story is 1999–2023 American banking; nothing in the prompt is period, and the props and costumes relocate the shot to roughly 1900.
- [HIGH] The period dress destroys the beat's argument. The point is that the *same institution, same era* punished the counter and left the executive floor untouched. With the upper floor in Victorian dress and the lower floor in modern grey office fit-out, the two levels read as two different centuries rather than two floors of one bank on one day.
- [MEDIUM] The prompt specifies "the ground-floor **counter** level… (the tellers and personal bankers)". The lower floor is drawn as a cubicle farm with glass partitions and office chairs, not a teller counter line, so the "people at the counter" claim the VO makes over this frame is not what the pixels show.
- [LOW] The antique register's display window carries garbled micro-lettering — no readable string, but a text-like artefact on a frame specified as text-free apart from "CLOSED".
- [LOW] The upstairs figures are drawn with upturned smiling mouths; "untouched, calm" was the spec, and visible smiling on the executive floor tips the frame from the reported-fact register toward editorialising about living named executives.

### L60
TRANSCRIBED: "INDEPENDENT" / "INVESTIGATION" (two lines on the cover label; letter-by-letter I-N-D-E-P-E-N-D-E-N-T / I-N-V-E-S-T-I-G-A-T-I-O-N — correct, though the terminal N of "INVESTIGATION" is clipped by the label's rounded edge)
PROMPT ASKED: "INDEPENDENT INVESTIGATION" (the cover label)
FACT CHECK: the board's independent investigation -> [F-16] / [S11] (Wells Fargo board independent investigation, Shearman & Sterling, April 2017) — CLEARED. No figures, dates or names rendered, correctly — the report is not attributed to any named firm or person on screen.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The prompt calls for "a thick bound investigation report **opening** on the boardroom table". The book is shut. The beat is "the board finally looking inward" — a closed cover is the opposite gesture, and the magnifying glass laid on top of a closed book reinforces that nothing is being read.
- [MEDIUM] The magnifying glass is drawn with a clear, empty lens showing bare slate-blue tabletop through it rather than the cover beneath it, so it neither magnifies nor sits believably on the book; combined with the closed cover, the shot's one piece of action does not resolve.
- [LOW] "Boardroom table" is only gestured at — two pale chair backs at the top edge; the table is an unmarked slate plane, and the prompt's "filled edge-to-edge" is met only in the sense that a flat colour reaches the edges.
- [LOW] The terminal "N" of "INVESTIGATION" runs into the label's rounded corner and is partially clipped; still legible, but the string does not sit cleanly inside its own plate.

## Shard 3 summary

| id | verdict | worst severity |
|---|---|---|
| L41 | FLAG | LOW |
| L42 | FLAG | **BLOCKING** |
| L43 | FLAG | **BLOCKING** |
| L44 (plate) | FLAG | MEDIUM |
| L44-stamp (cutout) | FLAG | MEDIUM |
| L45 | FLAG | **BLOCKING** |
| L46 | FLAG | **BLOCKING** |
| L47 | FLAG | MEDIUM |
| L48 | FLAG | HIGH |
| L49 | FLAG | **BLOCKING** |
| L50 | FLAG | MEDIUM |
| L51 | FLAG | HIGH |
| L52 | FLAG | **BLOCKING** |
| L53 | FLAG | LOW |
| L54 | FLAG | MEDIUM |
| L55 | FLAG | **BLOCKING** |
| L56 | FLAG | MEDIUM |
| L57 | FLAG | HIGH |
| L58 | FLAG | HIGH |
| L59 | FLAG | **BLOCKING** |
| L60 | FLAG | MEDIUM |

**Totals:** 21 images ruled, 0 PASS, 21 FLAG. **8 frames carry BLOCKING findings** (L42, L43, L45, L46, L49, L52, L55, L59); 4 more carry HIGH as their worst (L48, L51, L57, L58).

**Cross-cutting patterns**
1. **Fabricated figures on a real-case YMYL video (4 frames).** L42's `100`/`500` credit-score endpoints and its five invented dollar amounts, L46's `77,000` LED counter, and L55's `100,000` are all unsourced by any `[F-NN]`. None should be corrected from general knowledge; each element should be omitted.
2. **Period drift, severe and clustered (4 frames).** L49 and L52 are set in a drowned mangrove swamp; L59 puts bonnets, 19th-century gowns and two antique brass crank cash registers into a story about 2011–2016 bank branches; L58 dresses bank staff in bib overalls and waistcoats. These are the brief's named disqualifiers, not judgement calls.
3. **Prompt-instruction leakage and forbidden lettering (3 frames).** L42 letters its own still_prompt gloss ("THE QUIET DAMAGE OF A CARD NOBODY WANTED."); L43 and L45 letter strings the prompt explicitly forbade, and in both cases those strings are occluded or misspelled ("YOU NAME", truncated "CONSENT FORM", truncated "LIFE INSURA…CE").
4. **The 2.1M→3.5M correction sequence does not do its job.** L48, L51 and L52 were the three frames carrying the "the window widened, the fraud did not double" argument — the single most important precision in this research dossier ([F-13] note, Myth #1). L48 has no timeline and an empty net, L51 has no ruler and no window, L52 is an unreadable object in a swamp. Only L53 lands the idea, and its two rulers never touch the pile.
