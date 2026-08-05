# VPW fifth 5 — authoring report (2026-08-05) — THE FILE IS COMPLETE

Video: `2026-07-28-bricks-fresh` · FRESH-AUTHORING mode under the 2026-08-04 doctrine reset.
$0, no provider call, nothing committed, no git touched. Worktree `boss-bricks-reset` only.

**Read set:** `visual-prompt-writer/SKILL.md` · `scratchpad/vpw-fresh-skeleton.md` ·
`scratchpad/vpw-log-fresh.md` (lessons 1–29) · `scratchpad/vpw-fifth4-report.md` · `script.md` ·
`assets/voiceover.manifest.json` (real forced-alignment word timings) · `visual-kit/visual-grammar.md` ·
`visual-kit/style-bible.md` (§2d, §3, §4, §5) · `references/shots-schema.md` ·
`visual-kit/registry/registry.json` (MAIN checkout) · `assets/library/manifest.json` · `research.md` ·
`scripts/lint_shots.py` + `scripts/forge.py` (the laws as implemented) · the CURRENT `shots.json`
(L01–L195, for lineage only). No archived or quarantined file was read at any point.

---

## 1. Range authored — and the file closes

| | |
| --- | --- |
| **Shots** | **L196 – L248 — 53 new shots** (file now **248**; L01–L195 byte-identical, verified) |
| **First / last paragraph** | P19 ("In February 1992 a jury came back…") → P23 ("…selling those bricks.") — the VO **to its end** |
| **First / last anchor** | `"In February 1992 a"` → `"who knows how many"` |
| **VO span** | t = 432.060 s → the end of the track at ~540.08 s = **108.02 s** of measured VO |
| **Cadence** | avg **2.04 s**; **every real hold in the range is inside 1.51–2.85 s** — zero cadence heads-ups, zero base/delta inversions |
| **Σ `duration_s`** | 108.02 s over the range; **file total 541.29 s** |

### How the close lands

The skeleton reserved the **withheld peak for P21–P23** and fifth 4 left it unspent. It is spent here, in
three moves rather than one:

1. **L217 — the peak frame.** `qt-wiles`, `action-recoil`, `expr-shock`, drawn **small and low on the open
   courtroom floor from FLOOR LEVEL**, with the bench rearing over him and the packed jury box leaning out
   above him. It is the only low-angle looking-UP vantage in 248 shots, deliberately held back: the man who
   ran a company by making people stand up in meetings is finally the one being looked down at. It also
   carries the fifth's longest hold in P21 (2.77 s), so the peak gets the air.
2. **L244 — the thesis settled as a contest.** `miniscribe-rep` (`expr-smug`, chest and lapels plain) against
   `auditor-rep` (`expr-crestfallen`) in `action-tugofwar` across a chalk line, the count sheets spilled
   beside it. The line the script says twice ("It beat the audit, it beat the count sheets") gets one image
   that says both.
3. **L248 — the closing frame, a bookend to the hook.** The video ends in the same rented `brick-warehouse`
   aisle the L03 plate opened it with — this time from floor level, the wrapped pallets stepping away past
   the last work lamp into unlit depth **where the back wall never comes**, and a crowd of packers still
   working. "Who knows how many more years" is drawn as an aisle with no end. Held 2.92 s to the end of the
   VO track as the outro beat; `render-builder` re-times it against the real audio.

The three paragraphs between the peak and the close are not spent on staging: P20 is a three-cut collapse
(`slab-prop`: propped → flat → gone) and P22 lands the ironies flat (the doctor's bag open on a kerb, a
podium with one brick on the top step).

**Shot count comes from the VO, not from a target average** (lesson 16). The cut list was built against
the forced-alignment timings BEFORE a word of prose was written (lesson 21); 53 shots at 2.04 s is the
densest fifth in the file because this span's clauses are the shortest in the script.

---

## 2. Places

### New place + plate

| `place` | Plate | Owner decision | Shots | Why that owner call |
| --- | --- | --- | --- | --- |
| `jury-courtroom` | **L196** (cast-free, not a delta, first-in-file generated shot declaring it) | **`owner_ambiguity: true`** | L196, L197, L206, L216, L217, L218, L219, L222, L223, L226 (10) | The script names **no court** anywhere — "a jury came back", "the judge threw the whole thing out", "a federal jury convicted him". There is no court name in the narration and none in the fact ledger, so a board over this bench would be signage invented to look decisive. Every nameplate along the bench face and every board on the side wall is authored **blank and unlettered as a positive state**. Ambiguity is also the honest read: two different trials three years apart, and the room is the institution, not a building. |

`place_inventory_check` anchors on the token **`jury`**, which the script itself uses four times.

The place QUALIFIES on recurrence with room to spare: **five non-contiguous runs** (L196–L197 · L206 ·
L216–L219 · L222–L223 · L226), so the plate law applies and L196 satisfies it — zero named cast, no
`stage_role: delta`, and it is the frame every other courtroom shot seeds. Verified in the dry-run, not
asserted:

```
L197: [L196, crowd-exemplar, lettering-marker-italic]   L206: [L196, crowd-exemplar, lettering-marker-italic]
L216: [fig-qt-wiles--action-armscrossed--expr-deadpan, L196, crowd-exemplar]
L217: [fig-qt-wiles--action-recoil--expr-shock, L196, crowd-exemplar]
L218: [L196]                                            L219: [L218]
L222: [fig-qt-wiles--action-shrug--expr-confused, L196, crowd-exemplar]
L226: [fig-brick-foreman--expr-deadpan, L196, crowd-exemplar]
```

**Ten courtroom shots is the arc's spine, not a repeated world.** Each takes a different vantage and a
different piece of the room: the empty wide from the gallery rail (L196), the filled box (L197), the open
side door seen over the packed gallery backs (L206), the dock (L216), the floor-level look up (L217), the
exhibits table (L218/L219), the witness box with the rear doors shut and then open (L222/L223), and the
witness box again with a different man in it (L226) — which is the point that beat makes.

### Places revisited

| `place` | Seeds | Shots in this fifth |
| --- | --- | --- |
| `brick-warehouse` | fifth 1's plate **L03** (`owner_ambiguity`) | L203, L225, L230, L248 (4) |
| `miniscribe-plant` | fifth 1's plate **L28** (`place_owner: "MINISCRIBE"`) | L233, L234 (2) |
| `brick-company-yard` | fifth 3's plate **L113** (`place_owner: "COLORADO BRICK"`) | L242 (1) |

Verified: `L203/L225/L230/L248: [L03, …]` · `L233: [L28]` · `L234: [L233, …]` · `L242: [L113, …]`.

**Both owner literals handled by drafting, per lesson 19.** `miniscribe-plant`: L233 draws the entrance
board's ABSENCE ("the broad plank board that hung over the entrance is gone and a clean pale rectangle
stands on the brickwork where it was"), so no sign is redrawn and the company's name appears nowhere in
either shot's scene prose. `brick-company-yard`: L242 DOES redraw the gate board, so `'COLORADO BRICK'` is
re-quoted character-for-character; it is the place's carried sign, exempt from payload-last, and the rest
of the prose says "red clay bricks" and "the brick yard", never the branded phrase in lowercase.

**36 of 53 shots declare no place:** the four place-exempt classes in the range
(`physicalized-imbalance` L198/L232/L240, `number-glued-to-object` L200/L213/L229/L238,
`symbolic-stand-in-object` L209/L215/L235, and the exempt siblings) plus one-frame worlds the file never
returns to — the bank courtyard weighbeam, the hay barn, the armoury store, the proving yard, the audit
desk, the panelled bank room, the bank portico, the builder's yard, the hired hall, the settlement room,
the strong room, the paying-out counter, the receipt spike, the prison corridor, the works canteen, the
two-storey cutaway, the broker's counter, the courthouse corridor, the immunity counter, the removal
truck's tail, the pavement, the scraped office door, the cell shelf, the payout window, the measures
counter, the podium, the night office floor, the tug-of-war hall, the personnel corridor, the Christmas
locker corridor.

---

## 3. Pricing basis — this fifth, and the WHOLE FILE

### This fifth

| | Count |
| --- | --- |
| **Scenes** (every shot is `ai-gen`) | **53** |
| **STEP-1 figure gens emitted over the range** | **17** |
| …of which are **NEW to the file** | **10** |
| …already minted earlier and merely shared | 7 |
| Plates inside those 53 scenes | **1** (L196) |
| Text-bearing scenes (§5 lettering exemplar derived) | 11 — 8 distinct literals |
| Crowd-rig scenes | 34 |
| Max seeds on any single request | **3** — never at `SEED_CAP` (4); no displacement anywhere in the range |

The 17 STEP-1 cards forge emits over L196–L248, with the whole-file verdict:

```
fig-auditor-rep--hold-paper-by-sides--expr-caught  (L201)         NEW
fig-hq-banker--action-armscrossed--expr-crestfallen(L204, L212)   NEW  (shared inside the fifth)
fig-hq-banker--expr-deadpan                        (L205)         NEW
fig-qt-wiles--expr-smug                            (L205)         NEW
fig-auditor-rep--hold-paper-by-sides--expr-deadpan (L212)         shared (fifth 2 L86 / fifth 3 L139, L143)
fig-qt-wiles--action-armscrossed--expr-deadpan     (L216)         shared (act 2)
fig-qt-wiles--action-recoil--expr-shock            (L217)         NEW
fig-qt-wiles--carry-by-handle--expr-crestfallen    (L220)         shared (fifth 4 L176)
fig-brick-foreman--sit--expr-smug                  (L221)         shared (fifth 4 L173)
fig-qt-wiles--action-shrug--expr-confused          (L222)         NEW
fig-qt-wiles--point-at-thing--expr-deadpan         (L224)         shared (act 2)
fig-brick-foreman--expr-deadpan                    (L226)         shared (fifth 4 L158)
fig-qt-wiles--sign-with-pen--expr-smug             (L227)         NEW
fig-qt-wiles--action-armscrossed--expr-crestfallen (L236)         NEW
fig-miniscribe-rep--expr-smug                      (L244)         NEW
fig-auditor-rep--expr-crestfallen                  (L244)         NEW
```

Proof, not assertion: the whole-file dry-run emits **48** STEP-1 gens against **38** for L01–L195 alone.

### WHOLE-FILE totals — the definitive generation pricing basis

| | Count |
| --- | --- |
| **Total scenes** | **248** (every shot `ai-gen`; no stock/chart/screencap/archival anywhere) |
| **Total STEP-1 figure cards** | **48** distinct (`fig-*`), across 8 cast slugs |
| **Total plates** | **8** — one per declared place: L03 `brick-warehouse` · L05 `computer-shop` · L28 `miniscribe-plant` · L63 `wiles-office` · L71 `miniscribe-boardroom` · L113 `brick-company-yard` · L172 `denver-newsroom` · L196 `jury-courtroom` (plates are ordinary scenes, already inside the 248) |
| Owner decisions | 2 `place_owner` (`MINISCRIBE`, `COLORADO BRICK`) · 6 `owner_ambiguity` |
| Text-bearing scenes file-wide | 46 |
| Crowd-rig scenes file-wide | 141 |
| Max seeds on any request file-wide | 4 (L33, act 1) — at `SEED_CAP`, nothing displaced |

**`rifenburgh-ceo` — still the one un-minted slug, and still a hard prerequisite for fifth 4's shots.**
This fifth authors him nowhere (the last movement belongs to the jury, the judge, Wiles and Maxtor), so
nothing new was added to that debt. It stands exactly where fifth 4 left it: **image-generation must mint
`rifenburgh-ceo` at its Pass-1 gate before a token is spent on L177 or L185.** Forge's behaviour is
unchanged and re-verified on this run — it emits no STEP-1 card for either shot and ships the backticked
token as scene prose, silently (`L177: [L71, crowd-exemplar]`, `L185: [L71]`).

`miniscribe-rep` is cast once in this fifth (L244) and the prompt authors "his chest and lapels plain";
no prompt in the range contains "badge", "pin", "lapel object" or "logo" (grep-verified).

---

## 4. Chains, cast and the laws that shaped the staging

**12 stages, 7 of them carrying deltas, 8 deltas total.** No chain exceeds one base + 3 deltas, every run
is contiguous, and **no delta is longer than its base anywhere in the range** (zero inversions — the cut
list was balanced on the timing table before authoring, per lesson 21).

`verdict-return` (L196 + 1δ, the plate then the jury returning with the number) ·
**`slab-prop` (L207 + 2δ, the fifth's set piece: '550 MILLION' propped on one strut → flat on the ground →
gone, nothing left but its imprint)** · `prize-giving` (L210 + 1δ, the cheque leaves and the cheering
stays) · `settlement-table` (L212) · `dock` (L216) · `conviction` (L217) · `exhibits-table` (L218 + 1δ) ·
`defense-stand` (L222 + 1δ, the rear doors opening on the pallets) · `share-counter` (L227 + 1δ) ·
`bank-door` (L205) · `plant-cleared` (L233 + 1δ, the empty apron then the buyer's truck) ·
`rope-line` (L244).

**Every cast entrance is a stage BASE, never a delta**, and both cast-bearing deltas (L223, L228) re-state
the pose AND the expression their base seeded, so the delta slate stays `[parent + canonical]` and no
register is ever changed by prose alone (lesson 13 applied at authoring). Verified:
`L223: [L222, qt-wiles, crowd-exemplar]`, `L228: [L227, qt-wiles]`.

**Feasibility gates sized to the LAST delta of each chain** (lesson 10), each stated in `notes`: L207
authors the yard floor swept bare to the flags (so the slab can lie flat at L208 AND leave a clean imprint
at L209, two shots downstream); L210 authors the cheque board on two separable easels; L218 authors the
table's far half bare; L222 authors the rear doors shut and flush with clear corridor beyond; L227 authors
the counter top beyond the book bare; L233 authors the loading apron clear and empty.

**Two-cast shots: three, all fresh stage bases**, which is the only legal slate for an `interaction` slug:
- **L205** `handoff` — `hq-banker` hands `qt-wiles` the doctor's bag on the bank's portico. The irony the
  VO states ("since they sent Wiles in to begin with") staged as the transaction that caused it.
- **L212** no slug — the settlement table, two parties and one shut folder between them.
- **L244** `action-tugofwar` — the thesis frame (§1).

All three state a plane clause, an eye-line clause and a relative-head-scale clause.

**Casting kept off the plural-role spans, decided BEFORE the prose** (lessons 14/18). Five spans in this
fifth carry a role from the check's own closed list, and every one is staged cast-free or as mass action:

- **L202** — "the **accountants** who had signed off". `auditor-rep` is barred here, so the sign-off is drawn
  as the document act (a signed page, a pen across its foot) and the named lead takes the CLEAN adjacent
  span at **L201**, whose own words are "punishment aimed straight at Coopers & Lybrand".
- **L214** — "paid out by the **executives**, the bank, and". Mass action: three queues at one counter.
- **L215** — "and the **accountants**. As". Cast-free: three paid chits on a receipt spike.
- **L239** — "and the **investors** collected". Mass action: a payout window, one envelope each.
- L226 and L231 sit on "**people**" and "**men**", neither of which is on the list, so the named lead
  (`brick-foreman`) and the queue are both free there.

L204/L205 are additionally safe because their own spans name Hambrecht & Quist directly.

**No judge and no juror is cast.** An anonymous individual with a face requirement would have to be named
cast, and the video's planned cast closed four acts ago — so L206 draws the JUDGE'S ACT (the verdict card
out on the corridor floor past the open side door) rather than the man, and every juror is crowd.

### Self-audit (SKILL step 3c)

- **Non-literal share.** 47 of 53 are non-literal. The 6 `literal` frames are concrete physical objects or
  actions the line describes (the exhibits row and the slip added to it, the transfer signing and the block
  of certificates, the audit page, the removal truck taking the racks). No shot merely draws its line's
  words.
- **Class variety.** 12 of the 14 classes appear: ironic-counterpoint 10 (18.9 %) · idiom-pun 8 ·
  crowd-multiplication 7 · literal 6 · physicalized-imbalance 4 · number-glued-to-object 4 ·
  staged-interaction 4 · symbolic-stand-in-object 4 · aftermath-palette-turn 3 · diegetic-device 1 ·
  personified-character 1 · reaction-shot 1. `map-plan-view` and `register-shift-infographic` are unused:
  this span has no territory beat and no mechanism to explain — act 3 owned the mechanism. Ironic
  counterpoint leading is correct rather than reflexive: this is the vindication act, where every beat is a
  claim being contradicted, and it is the channel's declared signature move (`visual-grammar.md §4`).
  **Watched for lesson 27's shape** — a repeated ANSWER to a repeated question. Three beats that the first
  pass would have answered with `crowd-multiplication` were re-derived to what they actually are: L232 is a
  weighing (`physicalized-imbalance`), L235 is a remnant (`symbolic-stand-in-object`), L241 is the VO's own
  idiom (`idiom-pun`).
- **World variety (lesson 12), audited explicitly.** 4 declared places plus **30 distinct one-frame worlds**;
  no two consecutive shots reach for the same nouns. Four repeats are deliberate arguments the script itself
  makes: the courtroom (the arc's spine, ten different vantages), the doctor's bag (handed over L205,
  carried into prison L220, open on a kerb L236), the witness box (Wiles L222, the men below him L226), and
  the warehouse aisle (walked out of L203, worked at night L225, holed L230, endless L248).
- **Red-ink count: 2 distinct semantic uses across 53 frames** — the aiming stripe on the field gun (L201,
  alarm) and the lone inventory tag hanging in a punched gap (L230, ownership). Every other "red" in the
  range is scene palette on an established object: mahogany red-brown, pale brick red-brown, and the clay
  brick's own colour. **Whole-file semantic red: 6 / 3 / 6 / 4 / 2 across the five fifths.**
- **Human use: 43 of 53 frames carry figures (81 %)**, 16 with named cast and 34 with crowd. The **longest
  figureless run in the range is 3.18 s** and the next is 2.70 s — nothing remotely near the ~10 s
  self-audit flag, and the range has no figureless PAIR at all. Every figureless frame names its earn in
  `notes`: L196 (the room before the people, who arrive on the next cut), L200 (a number, aimed at a party
  standing in the next frame), L202 (a document act), L213 (a settlement figure), L215 (the record of three
  payments closing), L218 (the exhibits), L219 (its delta), L229 (a date), L233 (the emptiness IS the
  argument, and the next cut fills the same apron), L238 (a term's length). Nothing was populated to hit a
  share: every added crowd sits on a line whose own words name people.
- **Cadence vs the 3a budget.** The skeleton budgeted ~70 shots for act 4 (P16–P23); fifths 4+5 deliver
  47 + 53 = **100 shots across it**, because the skeleton sized off the header's 175 wpm while both fifths
  sized off the forced-alignment timings (lesson 4). The whole-file plan was ~208 shots / 559.5 s; the file
  lands at **248 shots / 541.29 s**, denser and shorter than the estimate, and every `duration_s` in this
  fifth is a MEASURED hold.

**Lettering: 8 distinct literals in 11 text-bearing shots** — `'1992'` [F-18], `'550 MILLION'` [F-18/F-19],
`'200 MILLION'` [F-18], `'128 MILLION'` [F-19], `'1988'` [F-21], `'MAXTOR'` [F-17], `'HR'` [F-14], plus the
carried `'COLORADO BRICK'` [F-06]. All are the script's own words; every non-delta one sits in its shot's
final clause; every other text-bearing surface in the fifth is authored blank as a positive state — the
courtroom nameplates and side-wall boards (L196), the presentation cheque and its banner (L210/L211), the
three paid chits (L215), the exhibits' certificate faces and their cards (L218), the transfer slip (L219),
the typed statement and the immunity slip (L232), the scraped door panel (L237), the cell ledger spines
(L238) and the payout envelopes (L239).

**Two values were deliberately NOT lettered.** L238's "three years" is drawn as three ledgers on a shelf
rather than a lettered '3 YEARS' card, and L240's "about a quarter" is a level in a glass measure rather
than a percentage: both are quantities the composition can carry, and a string not authored cannot garble.

---

## 5. Cadence — the cut list, built first

Zero real-cadence heads-ups and zero base/delta inversions over the range: **all 53 real holds sit inside
1.51–2.85 s.** The 53 cuts were chosen on the forced-alignment table before any prose existed, by walking
each paragraph's word stream and taking the latest split point that kept BOTH halves in band — which is
also why nine anchors start mid-sentence on a verbatim interior span (`"dollars. Not even Jordan"`,
`"Quist got hit too,"`, `"million evaporated. It was"`, `"went to prison. Karma"`).

Six candidate cuts were rejected during that pass for missing the 1.5 s floor by ≤0.005 s
(`"knew, and it came"` at 1.497 s, `"scheme testified in exchange"` at 1.496 s, `"people on the payroll"` at
1.497 s among them); each was moved to the next legal split rather than declared and left to disagree with
the render.

**One anchor was chosen to dodge the matcher, not the cadence.** `render-builder` and lint build the needle
from `vo_ref.split()` with empty-normalizing tokens DROPPED, while the VO-timing stream KEEPS them — so an
ampersand inside the first four words makes the needle un-matchable. P19's H&Q beat therefore anchors on
`"Quist got hit too,"` (2.48 s) rather than on `"Hambrecht & Quist got"`, which would have failed to tile.

Four anchors are four words or shorter; none is under three words; every one is a verbatim span of
`script.md` in strict narration order.

**The final shot.** L248 holds 2.92 s, from `"who knows how many"` at 537.160 s to the end of the audio at
~540.08 s. `real_cadence_check` skips the last shot by design (it has no next anchor), and the fifth-4
`"~338 words on one anchor"` LONG_SPAN heads-up on L195 has **cleared** now that a real shot follows it.

---

## 6. Acceptance evidence

### Lint — ZERO HARD, whole file

`py -3 .claude/skills/visual-prompt-writer/scripts/lint_shots.py channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`

```
== lint_shots: channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json ==
long-form shots: 248  |  shorts: 0

HARD violations: none — every anchor matches verbatim + in narration order.

Heads-up (14):
  [long-form] L74: REAL hold 1.44s ... below the 1.5s floor.               <- fifth 2's, documented
  [long-form] L08 / L13 / L14 (stage deltas): ... not longer than the base.    <- fifth 1's
  [long-form] L096 (stage 'lockbox-swap' delta): 2.7s ...                  <- fifth 3's, documented
  [long-form] L182 (stage 'books-again' delta): 2.3s ...                   <- fifth 4's, documented
  [long-form] L48 / L62 / L64 / L79 / L80 / L129 / L173 / L221: `sit` with support authored -
             confirm the render's FRAMING actually shows the support (forced review row).
```

**Both partial-coverage HARDs have genuinely cleared, and nothing was forced to clear them.** The arithmetic:

- **Duration sum.** The check needs Σ `duration_s` ≥ 85 % of the header-derived runtime. Runtime =
  1,628 VO words ÷ 175 wpm × 60 = **558.2 s**; the bar is **474.5 s**. The file sums to **541.29 s**
  (fifths 1–4 contributed 433.27 s, this fifth 108.02 s) = **97.0 % of the runtime**, 66.8 s clear of the
  bar. Nothing was densified to reach it and no hold was lengthened — the 108.02 s is simply the measured
  VO of P19–P23.
- **Shot floor.** The check needs ≥ 558.2 ÷ 4 = **140 shots**. The file carries **248**. (It had already
  cleared at fifth 3.)

Every other check passed on the run: anchors matched verbatim and in strict narration order against the
real VO word-stream (zero unmatched), place key/inventory/exempt-class laws, conditional plate law,
place-owner forced choice, `place_anchor` same-place law, delta character-entrance, delta feasibility,
interaction-template, two-cast presence, seat/support, action-chain, semantic-cast, crowd tiering, spatial
tier, text-supply, lettering word/count/char caps, carried literals (L-1), payload-last, banned render
terms, control leak, rig-clause fingerprint, suffix one-voice, shot-class enum, `figures` shape.

**Heads-ups over MY range: exactly one**, L221's `sit` row — the law's own mandatory review row, not a
defect: the sentence names the support and the contact ("sits well back on a canteen bench with his hips
right back on the bench"). Zero cadence heads-ups, zero delta-inversion heads-ups over L196–L248.

### Forge dry-run — WHOLE FILE, exit 0, zero refusals

```
py -3 .claude/skills/image-generation/scripts/forge.py batch \
  --kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit \
  --video channels/the-second-take/videos/2026-07-28-bricks-fresh \
  --batch .../shots.json --out <spec> --shots <all 247 ids except L29> --dry-run
```

```
  L248: [L03, crowd-exemplar] (no cast - the scene composes from the place)
  == batch: 247 scene(s) + 48 STEP-1 figure gen(s), 0 not generated -> <spec> ==
  == scoped to 247 shot(s); 0 seeding-law violation(s) remain OUTSIDE the scope, unaddressed by this spec ==
EXIT=0
```

**Exit 0. ZERO refusals. ZERO seeding-law violations, in scope or out** — `0 seeding-law violation(s)
remain OUTSIDE the scope` is the whole-file settlement lesson 24 asks for, and it covers every shot in the
file, not just this fifth's. Max 3 seeds on any request in the range, 4 file-wide (L33), no displacement
anywhere.

**L29 is the one documented exclusion, and it is exactly what fifths 3 and 4 recorded.** Running the file
with L29 in scope exits 1 on `figure_reuse_refusal`:

```
fig-miniscribe-rep--action-powerstance--expr-deadpan: staged STEP-1 refused as a seed - it has no
review record in channels/the-second-take/visual-kit/_staging/review.json.
```

That frame is sitting in the **MAIN checkout's `_staging/`** awaiting a human review verdict — pre-existing
state from fifth 1's gen leg, unrelated to this fifth, untouched by it, and clearable only by
`stamp_review.py`, which is image-generation's tool and not VPW's. L29 contributes no NEW STEP-1 card
(`fig-miniscribe-rep--action-powerstance--expr-deadpan` is already in the 38-card pre-fifth baseline), so
the 48-card whole-file total is complete as stated.

`rifenburgh-ceo` (L177/L185): forge emits **no STEP-1 card and no refusal** — the slates read
`L177: [L71, crowd-exemplar]` and `L185: [L71]`, with the backticked slug passing into the scene payload as
prose. Exactly the behaviour lesson 25 documents; it is a Pass-1 mint prerequisite, not a dry-run failure.

### One real defect found by the dry-run and FIXED, not explained

L212's first draft gave BOTH cast members `expr-deadpan`. Forge binds an expression token once per shot, so
the second figure's card came back register-less — `fig-auditor-rep--hold-paper-by-sides` with no
expression at all, a 49th card that would have generated a faceless-register reference. The fix re-derived
the beat's register rather than the wording: `hq-banker` takes `expr-crestfallen` (the bank paying out
after installing the man), `auditor-rep` keeps `expr-deadpan`. Both cards now already exist elsewhere in
the file, so the corrected shot costs **zero** new figure gens instead of one wrong one, and the whole-file
total came down 49 → 48.

### L01–L195 untouched

The first **263,545 bytes** of the file — everything through L195's closing brace — and the entire 2,431-byte
`thumbnail` tail are byte-identical to the pre-run copy. Verified by byte-wise prefix scan and suffix
comparison against a backup taken before the first write, and re-verified after the L212 fix. The
divergence begins exactly at the `\r\n    ]` that used to close the shots array.

---

## 7. Hand-off — what remains before a token is spent

- **The shot list is COMPLETE.** 248 shots, L01–L248, covering the VO end to end at 541.29 s. `status`
  stays `shots-drafted`.
- **SKILL step 8 — the fresh-eyes shot critic — has NOT been run on the completed file.** Fifths 1–4 were
  critiqued in pieces (R14 ran over fifth 1 only); the whole-file critic pass per `references/critics.md` is
  the remaining gate before image-generation, and it is the caller's to dispatch.
- **`lint_shots.py --write` has never been run**, so `vo_text` is still underived. It refuses while any HARD
  remains; there are now none, so this is the moment it can run — it is a mechanical derivation, and a
  caller should run it (with the file's CRLF line endings in mind) before hand-off to image-generation.
- **`rifenburgh-ceo` must be minted at image-generation's Pass-1 gate before L177 or L185 generate** (§3).
- **L29's staged STEP-1 needs a human review verdict** (`stamp_review.py`) before any batch containing L29
  can run. Nothing in the shot list can clear it.
- **Generation pricing basis:** 248 scenes + 48 STEP-1 figure cards. 8 of the 248 are place plates; 46 are
  text-bearing (lettering exemplar derived); 141 carry the crowd rig.
