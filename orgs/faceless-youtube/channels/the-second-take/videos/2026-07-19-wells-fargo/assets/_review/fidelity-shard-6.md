# FIDELITY shard 6 — L101 through L119

Judge: fresh-eyes review subagent (did not generate these frames).
Rule applied: every on-screen figure/name/date/charge must trace to an `[F-NN]` in `research.md`, else FABRICATED/BLOCKING.

---

### L101 (plate `assets/plates/L101.png` + cutout `assets/cutouts/L101-stamp.png`)
TRANSCRIBED (plate): "OCC" | "$17.5M" | (a blank certificate field; blue-grey rosette seal with red ribbon, no lettering on the seal)
TRANSCRIBED (cutout): "BANNED FOR LIFE"
PROMPT ASKED: "OCC" | "BANNED FOR LIFE" | "$17.5M"
FACT CHECK:
- "OCC" -> [F-28] (OCC settled with Stumpf Jan 23 2020). OK.
- "$17.5M" -> [F-28] ("a $17.5 million civil money penalty"). Exact, correct glyph `$`, correct magnitude. OK.
- "BANNED FOR LIFE" -> [F-28] ("a lifetime prohibition from the banking industry"). OK.
- No unsourced figure, date, phone number or name appears. The plate deliberately carries NO name, so no living person is captioned. Good.
NOTES ON METHOD: the cutout's raw PNG previews with a magenta interior, but that is the transparent region (alpha=0, 43% of pixels). Composited over cream (`_review/crops/L101-stamp-on-cream.png`) it renders correctly: red block caps, knocked-out interior, no fill contamination. Not a defect.
VERDICT: PASS
FINDINGS:
- [LOW] The prompt asks for the stamp to land "across a banking license"; the plate is an entirely blank certificate with no license lettering at all, so the surface being cancelled reads as a generic blank award certificate (the rosette-and-ribbon shape reads closer to a prize than a license). The read survives because "OCC" + "BANNED FOR LIFE" carry it, but the "license" beat is not delivered in the pixels.

---

### L102
TRANSCRIBED: "8" | (nothing else — the eight held slips are completely blank, verified at 2x in `_review/crops/L102-slips-a.png` / `-b.png`)
PROMPT ASKED: "8"
FACT CHECK:
- "8" -> [F-29] (the OCC action "targeted **eight former executives**"). Correct and it is the only string in frame.
- Figure count physically verified: eight suited figures, evenly spaced. The number in the art matches the number in the ledger — no off-by-one.
- No name, dollar figure, date or penalty amount is lettered anywhere, so nothing unsourced is asserted about any of the eight real named people ([F-29] lists them; the frame wisely names none).
- Prompt instruction leakage checked specifically: the phrase "hold ONLY the rig form" did NOT render as diegetic lettering on the slips. Clean.
VERDICT: PASS
FINDINGS:
- [LOW] Heads are entirely featureless — no dot eyes at all, where the house base rig elsewhere in this video carries dot eyes. Reads as intentional anonymity here and does not change the meaning, but it is a rig deviation.
- [LOW] The slips are blank grey rectangles with no marking of any kind, so the "enforcement-action slip" reading is carried entirely by context; they could equally be blank paper. Omitting text was the right call under the no-unsourced-text rule, so this is noted, not charged.

---

### L103
TRANSCRIBED: "SEC" (inside the rosette seal) | "STUMPF" | "$2.5M"
PROMPT ASKED: "SEC" | "$2.5M" | "STUMPF"
FACT CHECK:
- "$2.5M" -> [F-30] ("Stumpf settled at the outset for a $2.5 million penalty (November 2020)"). Exact; `$` glyph correct for a US story; decimal point correct; no stray comma.
- "SEC" -> [F-30]/[S13]. OK.
- "STUMPF" -> [F-30], a real living named person, but the frame asserts only the settled SEC penalty, which is exactly what the ledger records. Correctly at document altitude — no criminal word appears anywhere in this frame.
- No date is lettered on screen, so the Nov-2020 detail is left to VO. Nothing unsourced added.
VERDICT: PASS
FINDINGS:
- [LOW] The document is cropped so tightly that its top and right edges bleed out of frame; the "charge document" reads as a fragment rather than a whole page. Legibility of all three required strings is unaffected.

---

### L104
TRANSCRIBED: "SEC" | "$3M" | "PLUS DISGORGEMENT" | "TOLSTEDT" | (plus one small round emblem, no lettering on it — see finding)
PROMPT ASKED: "SEC" | "$3M" | "PLUS DISGORGEMENT" | "TOLSTEDT"
FACT CHECK:
- "$3M" -> [F-31] ("a $3 million penalty"). Exact; `$` glyph correct; no stray digits.
- "PLUS DISGORGEMENT" -> [F-31] ("disgorgement of $1,459,076 and prejudgment interest of $447,874"). Correctly rendered as a *word*, not a number — the frame deliberately does not letter the disgorgement figure, which is the right call. Spelling verified at 4x in `_review/crops/L104-text.png`: P-L-U-S D-I-S-G-O-R-G-E-M-E-N-T, correct.
- "TOLSTEDT" -> [F-31]/[F-19]. Spelling verified letter-by-letter at 4x: T-O-L-S-T-E-D-T, correct.
- "SEC" -> [F-31]/[S5]. OK.
- No date ("2023") is lettered, so nothing unsourced. No criminal word appears in this frame — correct, since the SEC matter is civil and the only criminal count is [F-32].
VERDICT: PASS
FINDINGS:
- [LOW] The emblem at the bottom is a rendered **U.S. Great Seal eagle** — spread-wing eagle clutching an olive branch and arrows over a striped shield (see `_review/crops/L104-seal.png`) — not an SEC seal. The prompt asked for a seal and said "no logos"; this is a garbled version of a real federal insignia rather than a neutral rosette. It carries no lettering so it asserts nothing false, but it is off-brief and the arrows/branch are mangled.

---

### L105
TRANSCRIBED: "BEST IN THE BUSINESS" | "8" | "PRODUCTS PER HOUSEHOLD"
PROMPT ASKED: "BEST IN THE BUSINESS" | "8" | "PRODUCTS PER HOUSEHOLD"
FACT CHECK:
- "8" -> [F-01] (the "eight products per household" goal). It is the ONLY numeral in the frame — no currency symbol, no comma, no decimal, no second digit. The prompt's explicit numeral lock is honored exactly.
- "PRODUCTS PER HOUSEHOLD" -> [F-01]/[F-03] ("average number of products per customer household"). OK.
- "BEST IN THE BUSINESS" -> [F-03]/[F-20] (the metric "presented as a measure of the bank's success" / "proof it was the industry's best"). This is the *bank's own* claim staged as its own banner, which is exactly the claim↔reality framing the ledger licenses. OK.
- No dollar figure, date, percentage or ratio anywhere. Clean.
VERDICT: PASS
FINDINGS:
- [LOW] The presenter is genuinely back-turned with no face visible (verified at 4x, `_review/crops/L105-presenter.png`) — correct and defamation-safe — but the digest casts this shot as `tolstedt` and the rendered figure reads male (short cropped hair, flat silhouette, trousers). Since the prompt itself de-identifies the presenter, the mismatch is cosmetic, but the frame does not read as the Community Bank head.
- [LOW] The "BEST IN THE BUSINESS" banner sits *on* the screen's top edge rather than above it as the prompt specifies; the read is unaffected.

---

### L106
TRANSCRIBED: "100" (the giant balloon numeral, verified at full res in `_review/crops/L106-number.png`) | "FAKE ACCOUNT" x4 | "UNAUTHORIZED" x2 — at least two of the "FAKE ACCOUNT" tags are clipped by the frame edge and render as "FAKE / ACCOUN" (see `_review/crops/L106-tags.png` and the bottom-right and bottom-centre of the full frame)
PROMPT ASKED: **(none)** — the prompt says verbatim "no unrequested text, no logos"
FACT CHECK:
- **"100" -> FABRICATED.** There is no `[F-NN]` anywhere in `research.md` supporting a cross-sell / products-per-household metric of 100. The sourced metric value is **8** [F-01],[F-03]. The nearest "100" in the ledger is the CFPB's **$100 million** fine [F-04] and Tolstedt's **$100,000** fine [F-33], but this glyph carries **no `$` and no `M`/`K`** — it is a bare cardinal number rendered as the inflated scorecard metric itself, which is an impossible value for products-per-household and is sourced by nothing.
- "FAKE ACCOUNT" -> conceptually within [F-06]/[F-13], but not requested.
- "UNAUTHORIZED" -> ledger language ([F-13] "potentially unauthorized accounts"), but not requested.
VERDICT: FLAG
FINDINGS:
- [BLOCKING] The balloon is lettered **"100"** where the shot is an explicit callback to "that same scorecard number" — i.e. the sourced **8** [F-01]. "100" is an invented metric value traceable to no `[F-NN]`, it silently contradicts L105 ("8 PRODUCTS PER HOUSEHOLD") and L117 ("8") in the same shard, and read as a dollar figure it would misstate [F-04] by dropping the `$`/`M`. Correct fix: render **8**, or omit the numeral entirely — do not substitute a plausible-looking number.
- [BLOCKING] Multiple "FAKE ACCOUNT" tags are **truncated by the frame edge**, rendering as "FAKE / ACCOUN" at the bottom-centre and bottom-right. Truncated lettering is a blocking defect on its own terms.
- [MEDIUM] The prompt says "no unrequested text"; the frame carries six lettered tags. Even setting aside the truncation, this is unrequested diegetic lettering that the shot did not ask for.
- [LOW] The prompt places the red accent "on the leaking seam of the balloon"; the render puts a red *patch* on the balloon with a grey/white jet escaping past it. Close enough to read.

---

### L107
TRANSCRIBED: "1"
PROMPT ASKED: "1"
FACT CHECK:
- "1" -> [F-32] ("**Tolstedt was the only individual criminally charged**"). Exact and correctly the only string in frame.
- No name is lettered, so the frame does not itself accuse anyone by name. Correct — the naming is left to VO where it is document-attributed.
- No date, dollar figure or charge word. Clean.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The single solid (un-ghosted) figure — the one the "1" points at, and the one the VO names in the same breath as "**Carrie Tolstedt**" — is rendered as a **man**: bald head, shirt-and-necktie, trousers. The ghosted crowd around him contains clearly-coded women (bun hairstyles, skirt suits), so the read is deliberate, not incidental. The frame therefore pins the video's only criminal charge on a male figure while the VO names a woman. Casting does not deliver the shot.
- [LOW] The crowd rig carries mouths (a drawn smile line) on the ghosted figures where the prompt specifies "round heads, dot eyes, no noses/ears/teeth"; no teeth are drawn, so this is at the edge of the rig rather than outside it.

---

### L108  ← **the frame the prior review flagged; CONFIRMED, and it is the worst defect in this shard**
TRANSCRIBED: "FRAUD" (struck through with a red diagonal rule) | "GROSS MISREPRESENTATION"
PROMPT ASKED: "FRAUD" — and explicitly "no unrequested text beyond 'FRAUD'". The prompt asked only for "a different charge... written in below it" and **never supplied the string**, so the generator invented one.
FACT CHECK:
- "FRAUD" -> licensed as the struck-through *negation* ("But not for the fraud", [F-32] note: "the criminal charge was **obstruction of the exam**, not the account fraud itself"). OK in this role.
- **"GROSS MISREPRESENTATION" -> FABRICATED.** This string appears **nowhere** in `research.md`. It is not a count, not a charge, not a finding, not a phrase used by the CFPB, OCC, SEC, DOJ or the sentencing court in any `[F-NN]`. The one and only criminal count in this case is **obstructing a bank examination** [F-32]. The SEC's civil theory [F-20] is about *misleading investors* regarding the cross-sell metric — the ledger nowhere styles it "gross misrepresentation", and in any event that was a **civil** SEC matter, not the criminal charge this charge-sheet frame depicts.
VERDICT: FLAG
FINDINGS:
- [BLOCKING] The charge sheet substitutes an **invented criminal charge, "GROSS MISREPRESENTATION"**, for the sourced one. The frame's entire visual grammar — "FRAUD" struck out, the replacement charge lettered beneath it on a charge sheet — asserts to the viewer that *this* is what Carrie Tolstedt, a real, named, living person, was actually charged with. She was not. She pleaded guilty to **one count of obstructing a bank examination** [F-32]. This is a fabricated criminal accusation against a living person and is the most serious defect class this review can return. Correct fix: letter **"OBSTRUCTION"** (the string the neighbouring L109 and L114 already use and which [F-32] sources), or omit the second line entirely and let the VO carry it. Do **not** ship this frame.
- [HIGH] Root cause is in the prompt, not only the pixels: the `still_prompt` instructs "a different charge is written in below it" without naming the string, while simultaneously forbidding "unrequested text beyond 'FRAUD'". The prompt is self-contradictory and invites exactly this fabrication. It must be repaired before regeneration, or the same defect will recur.

---

### L109
TRANSCRIBED: "OBSTRUCTION" (red-underlined) | (four abstract squiggle rules above it on the same sheet — verified at 4x in `_review/crops/L109-doc.png` as non-lettering placeholder marks, not garbled words)
PROMPT ASKED: "OBSTRUCTION"
FACT CHECK:
- "OBSTRUCTION" -> [F-32] ("one count of **obstructing a bank examination**"). Exact, correctly spelled O-B-S-T-R-U-C-T-I-O-N, and it is the only lettering in frame. **This is the string L108 should have used.**
- No date, no dollar figure, no sentence detail lettered. Nothing unsourced.
- Depicting a real living person at a courtroom lectern is licensed by [F-32] (she did plead guilty); the frame asserts only the sourced count.
VERDICT: PASS
FINDINGS:
- [LOW] Digest specifies `pose_ref: hold-one-hand`; the figure rests **both** hands on the lectern. Costume is on-pin (burgundy blazer) and expression reads deadpan as specified, so the shot lands.
- [LOW] The courtroom background is soft-focus/blurred rather than the house flat-cel treatment, which is a slight render-style drift from "flat cel with soft shading and depth". Period is correct (modern US courtroom — no drift).

---

### L110
TRANSCRIBED: (none)
PROMPT ASKED: (none) — "no unrequested text, no logos"
FACT CHECK: No figure, name, date, amount or claim is rendered anywhere. Nothing to source, nothing fabricated. The shot asserts only the sourced act of obstructing an examination [F-32].
VERDICT: PASS
FINDINGS:
- [LOW] Both figures are entirely featureless — no dot eyes at all — where the house rig elsewhere carries them; the prompt bans noses and ears but does not ask for eyeless heads.
- [LOW] The right-hand figure's head circle tangents its own shoulder mass so that at a glance the two rounded shapes read as two overlapping heads (`_review/crops/L110-right.png`). Shape separation is poor, though on inspection the anatomy is correct.
- Period: correct (modern office, no drift). Red accent correctly on the magnifier rim. The blocking gesture and the magnifier both read as specified.

---

### L111
TRANSCRIBED: "3 YRS PROBATION" | "6 MO HOME" | "$100K FINE" | "120 HRS SERVICE"
PROMPT ASKED: "3 YRS PROBATION" | "6 MO HOME" | "$100K FINE" | "120 HRS SERVICE"
FACT CHECK: every element traced, all to [F-33] (the Sept 15 2023 sentence):
- "3 YRS PROBATION" -> [F-33] "three years' probation". OK.
- "6 MO HOME" -> [F-33] "six months of home confinement". OK.
- "$100K FINE" -> [F-33] "a $100,000 fine". `$` glyph correct for a US story; `100K` == $100,000; numerals verified unmalformed at 3x in `_review/crops/L111-100k.png`. OK.
- "120 HRS SERVICE" -> [F-33] "120 hours of community service". OK.
- Nothing beyond the four sourced lines. No invented fifth item, no prison figure, no date.
VERDICT: PASS
FINDINGS:
- [MEDIUM] The lettering is heavy extruded/bevelled bubble type with a drop shadow, not the "marker lettering" the prompt (and the house style, and every neighbouring frame in this shard) specifies. Set against L109's genuine marker hand on "OBSTRUCTION" or L107's marker "1", this card is visibly a different typographic system and will read as an inserted title card rather than part of the film.
- [LOW] The frame is a pure text card with no illustrated element at all; permissible for `register-shift-infographic`, but it delivers none of the "flat cel with soft shading and depth" the prompt asks for.

---

### L112
TRANSCRIBED: "NO PRISON" | "SINGLED OUT" (spelling verified at 3x, `_review/crops/L112-fixtures.png`)
PROMPT ASKED: "NO PRISON" | "SINGLED OUT"
FACT CHECK:
- "NO PRISON" -> [F-33] ("**no prison time**"). OK.
- "SINGLED OUT" -> [F-33] ("the judge... remarking she had been **singled out**"). OK — and correctly rendered as a bare tag rather than as quoted speech attributed to the judge, which keeps it at document altitude.
- The prosecutors' "one year" recommendation and the 16-month exposure are NOT lettered; correct, they stay in VO.
- No date, no dollar figure, no name. Nothing unsourced.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The cell's plumbing is a **duplication artifact**: three overlapping fixtures are drawn where one toilet and one sink belong — a toilet at far left, a second toilet bowl melting into a sink basin in the centre, and a third bowl behind the sink, with the sink's trap and the toilet's tank interpenetrating. Clearly visible at 3x. It is the only detailed object in an otherwise empty frame, so the eye goes straight to it.
- [LOW] The cell door's barred panels read ambiguously — the left panel is fixed bars and the right is the swung-open door, but they share the same top rail, so the door's hinge geometry does not resolve.
- Period: correct (modern US cell block, no drift). Red accent correctly confined to "NO PRISON".

---

### L113
TRANSCRIBED: "1 CONVICTION" (the "1" in red, "CONVICTION" in dark marker) | (a gavel-and-block glyph on the card, no lettering)
PROMPT ASKED: "1 CONVICTION"
FACT CHECK:
- "1" -> [F-32] ("Tolstedt was the **only** individual criminally charged") + [F-33] (sentenced, so the charge became a conviction). The count of exactly one is sourced.
- "CONVICTION" -> [F-32]/[F-33]. She pleaded guilty and was sentenced, so "conviction" is accurate and is not an overstatement of the record.
- No name, date or dollar figure. Nothing unsourced.
VERDICT: PASS
FINDINGS: none — the shot delivers exactly what it claims: one stamped card, wide empty table, big negative space, red accent confined to the "1", marker lettering on-style, no extra text.

---

### L114
TRANSCRIBED: "OBSTRUCTION"
PROMPT ASKED: "OBSTRUCTION"
FACT CHECK:
- "OBSTRUCTION" -> [F-32]. Exact, correctly spelled, only string in frame.
- The fake-account card carries **no digits** — no account number, no expiry, no name embossed. This is the right call: any lettered card number would have been a fabrication. Verified: the card's data fields are blank grey blocks.
VERDICT: PASS
FINDINGS:
- [LOW] The background is a hard vertical split between slate and cream, a literal two-panel divide rather than a single staged space. It reads as a diptych, which is a slightly blunter device than the prompt's "on one side... on the other side" implies, but the contrast lands.
- [LOW] The red accent sits as a magnetic stripe *across* the card rather than "on the un-charged fake card's edge" as specified. Semantically it still points at the card, so the accent discipline holds.

---

### L115
TRANSCRIBED: (none)
PROMPT ASKED: (none) — "no unrequested text, no logos"
FACT CHECK: no figure, name, date, amount or claim rendered. Nothing to source, nothing fabricated. The empty-chair device asserts only "nobody in the room", which is the ledger's own framing ([F-32] note / Exoneration paragraph: "no single con-man who invented the fraud").
VERDICT: PASS
FINDINGS:
- [LOW] A foreground chair back sits dead-centre and partly occludes the table run toward the head chair; it slightly crowds the "big quiet negative space" the prompt asks for. The red target-dial on the head chair is correct, glowing, and is the only red in frame.
- Period: correct (modern corporate boardroom, no drift).

---

### L116
TRANSCRIBED: "8"
PROMPT ASKED: (no text — but "8" is the sourced scorecard number the shot is built on)
FACT CHECK:
- "8" -> [F-01]/[F-03]. Correct, and it is the only string in frame. No dollar figure, no percentage, no count.
- Note the internal consistency this frame has and **L106 lacks**: here the chased number is 8, as sourced. L106 renders the same object as "100".
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The crowd breaks the specified rig. The prompt says "Crowd on the crowd rig" (per L107: "round heads, dot eyes, **no noses/ears/teeth**"). At 4x (`_review/crops/L116-crowd-a.png`, `-b.png`) the figures carry clearly drawn **ears** and **nose** bumps in profile, and open oval mouths. This is a different character system from L107's crowd in the same shard, so the two crowd shots will not cut together.
- [MEDIUM] The register is wrong for the beat. The prompt asks for a crowd "still chasing" a target — the render is a **celebration**: arms thrown up in triumph, broad open smiles, a hero figure leaping with both hands raised. It reads as a rally the bank is winning, not a workforce being driven, which softens the shot's argument.
- [LOW] Standard crowd degradation in the mid and far ranks — several background faces are melted blobs, and one mid-left figure has a malformed feature cluster where the face should be.

---

### L117
TRANSCRIBED: "8" | "GREAT" (red-underlined) | "1999"
PROMPT ASKED: "8" | "GREAT" | "1999"
FACT CHECK:
- "8" -> [F-01]. OK.
- "GREAT" -> [F-01] ("the number eight was chosen partly because it **rhymed with 'great'**"). OK.
- "1999" -> [F-01] (the "Going for Gr-eight" campaign was formalized **in 1999**, per the 1999 annual report). Exact, four digits, unmalformed. OK.
- No name attached — correct, since [F-01] attributes the origin to the 1999 campaign / Kovacevich and explicitly warns not to pin it on Stumpf. The frame names nobody, so the attribution stays clean.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] The prompt specifies a **"near-black field"** and "Near-black ground" — an abstract card. The render instead places the black shape as a dark basin inside a **sandy desert landscape**: tan dunes, ridge lines and scrub bushes fill the entire upper third. That environment is nowhere in the prompt and nowhere in the story (this is a 1999–2023 US retail-banking narrative). It also breaks the read — the black field stops being a void and becomes a pit or lake in a desert, which is a meaningless image for a rhyme callback.
- [LOW] The red underline runs under "GREAT" but overshoots to the right past the final T; the prompt's accent target is otherwise correct.
- Lettering is genuine marker style here and on-brief, unlike L111.

---

### L118
TRANSCRIBED: "ETHICS LINE" | (the ID badge on the desk carries only abstract rule-marks and a generic silhouette avatar — **no name, no number**, verified at 5x in `_review/crops/L118-badge.png`) | (the register's display window and keypad are **blank** — no digits, verified at 4x in `_review/crops/L118-register.png`)
PROMPT ASKED: "ETHICS LINE" — and "no unrequested text"
FACT CHECK:
- "ETHICS LINE" -> [F-22] ("employees who raised concerns through Wells Fargo's **ethics hotline** were met with no action or were terminated"). OK.
- No employee name, badge number, phone number or date is lettered anywhere. This matters: an invented ethics-hotline **phone number** would have been a fabrication, and the frame correctly renders none. Clean.
VERDICT: FLAG
FINDINGS:
- [MEDIUM] An **electronic cash register** sits on the counter under the poster — unrequested, and it relocates the scene. The prompt asks for "a row of empty office chairs... their desks vacated"; a till turns the space into a shop or checkout counter rather than the bank back-office where an ethics line lives. It is the largest object in frame after the poster.
- Period note: the register is a late-80s/90s **electronic** unit with an LED window and a rubber keypad, **not** an antique brass crank register, so it does not breach the 1999–2023 window. Flagged as unrequested set dressing, not as period drift.
- [LOW] The gravity register is otherwise correct — fully desaturated grey-and-cream, comedy off as the prompt demands, the single red accent confined to the abandoned badge's lanyard. That part of the shot lands well.

---

### L119
TRANSCRIBED: "8"
PROMPT ASKED: "8" — "no unrequested text beyond '8'"
FACT CHECK:
- "8" -> [F-01]. Exact, unmalformed, and the only string in the frame. The benches, judge's bench, flags and door in the background carry no lettering of any kind — verified. No fabricated case caption, docket number or seal.
- The image asserts no claim about any named person. Correct for a closing frame.
VERDICT: FLAG
FINDINGS:
- [LOW] The witness stand is scaled like a miniature — it reads roughly bench-height and sits as a free-standing object in an open floor pool rather than as an architectural fixture attached to the bench, so it looks like a model of a witness stand set on the floor. The "8" is nearly as tall as the box that contains it. The metaphor still reads, but the space does not resolve.
- [LOW] The prompt asks for "near-black-and-cream"; the render is near-black-and-**warm-brown**, with the courtroom millwork in brown rather than the cream the close's palette calls for. Minor drift.
- Red accent correctly and solely on the witness-stand rail. Period correct (modern US courtroom).

---

## Shard 6 summary

| id | verdict | worst severity |
|---|---|---|
| L101 (plate + `L101-stamp` cutout) | PASS | LOW |
| L102 | PASS | LOW |
| L103 | PASS | LOW |
| L104 | PASS | LOW |
| L105 | PASS | LOW |
| L106 | FLAG | **BLOCKING** |
| L107 | FLAG | MEDIUM |
| L108 | FLAG | **BLOCKING** |
| L109 | PASS | LOW |
| L110 | PASS | LOW |
| L111 | PASS | MEDIUM |
| L112 | FLAG | MEDIUM |
| L113 | PASS | none |
| L114 | PASS | LOW |
| L115 | PASS | LOW |
| L116 | FLAG | MEDIUM |
| L117 | FLAG | MEDIUM |
| L118 | FLAG | MEDIUM |
| L119 | FLAG | LOW |

**Two BLOCKING frames — L108 and L106. Neither may ship as rendered.**

- **L108** letters an invented criminal charge, "GROSS MISREPRESENTATION", onto a charge sheet about a real, named, living person whose only criminal count was **obstructing a bank examination** [F-32]. The prior ad-hoc report is **CONFIRMED by transcription**. The prompt is also defective (it demands "a different charge" without naming the string while banning unrequested text) and must be fixed before regeneration or the fabrication will recur. Fix: letter `OBSTRUCTION`, the string L109 and L114 already use correctly.
- **L106** letters "**100**" as the inflated cross-sell metric. No `[F-NN]` sources a metric value of 100; the sourced number is **8** [F-01],[F-03], which L105, L116, L117 and L119 all render correctly. The same frame also truncates at least two "FAKE ACCOUNT" tags at the frame edge, and carries six lettered tags against a "no unrequested text" instruction. Fix: render **8** or drop the numeral; re-frame so no tag clips.

**Fact-sourcing verdict on the rest:** every other number, name and date in this shard traces cleanly — `$17.5M` [F-28], `$2.5M` [F-30], `$3M` + `PLUS DISGORGEMENT` [F-31], `8` (executives) [F-29], `8` (products) [F-01], `1` [F-32], `1 CONVICTION` [F-32]/[F-33], `3 YRS PROBATION` / `6 MO HOME` / `$100K FINE` / `120 HRS SERVICE` [F-33], `NO PRISON` / `SINGLED OUT` [F-33], `OBSTRUCTION` [F-32], `1999` [F-01], `ETHICS LINE` [F-22]. No `£` or `€` glyph appears anywhere; every currency mark is `$`. No invented phone number appears. No frame outside L108 asserts a criminal charge.

**Cross-frame consistency defect worth escalating:** L106 ("100") contradicts L105/L116/L117/L119 ("8") on what the scorecard number *is*. Whichever way it is fixed, the shard must land on 8.

**Period:** no drift found. No top hats, bonnets, crinolines, gas-lamp streets or brass crank registers. The two environment complaints — L117's desert and L118's cash register — are off-brief set dressing within the correct era, not period drift.

**Recurring craft issues** (not blocking, but they will show in the cut): rig inconsistency between crowd shots (L102/L110 eyeless, L107 dot-eyed, L116 with ears and noses), and typography inconsistency (L111's extruded bubble lettering against genuine marker lettering everywhere else).
