# VPW fifth 4 — authoring report (2026-08-05)

Video: `2026-07-28-bricks-fresh` · FRESH-AUTHORING mode under the 2026-08-04 doctrine reset.
$0, no provider call, nothing committed, no git touched. Worktree `boss-bricks-reset` only.

**Read set:** `visual-prompt-writer/SKILL.md` · `scratchpad/vpw-fresh-skeleton.md` ·
`scratchpad/vpw-log-fresh.md` (lessons 1–23) · `scratchpad/vpw-fifth3-report.md` · `script.md` ·
`assets/voiceover.manifest.json` (real forced-alignment word timings) · `visual-kit/visual-grammar.md` ·
`visual-kit/style-bible.md` (§1, §2, §2d) · `references/shots-schema.md` ·
`visual-kit/registry/registry.json` (MAIN checkout) · `assets/library/manifest.json` · `research.md` ·
`scripts/lint_shots.py` + `scripts/forge.py` (the laws as implemented) · the CURRENT `shots.json`
(L01–L148, for lineage only). No archived or quarantined file was read at any point.

---

## 1. Range authored

| | |
| --- | --- |
| **Shots** | **L149 – L195 — 47 new shots** (file now 195 shots; L01–L148 byte-identical, verified) |
| **First / last paragraph** | P15 ("And this wasn't a one time thing.") → P18 ("…They sued everybody.") |
| **First / last anchor** | `"And this wasn't a one"` → `"They sued everybody."` |
| **VO span** | t = 333.461 s → 432.060 s = **98.60 s** of measured VO |
| **Cadence** | avg **2.10 s**; **every real hold in the range is inside 1.52–2.81 s** (zero cadence heads-ups) |
| **Σ `duration_s`** | 98.57 s over the range (file total 433.3 s of the 540.1 s VO — **80.0 %**) |

### Why the end boundary snaps there

The 4/5 mark is 432.06 s of VO. **The end of P18 lands on 432.060 s — exactly 80.0 %.** No other
paragraph boundary in the file is that close to its fraction; the neighbours are P17 at 76.6 % and P19
at 84.2 %. Four things make it the right snap rather than a lucky number:

1. **It is a paragraph AND a movement seam.** P15–P18 is the fall: the escalation ladder, the layoff
   that leaks it, the new team's restatement, and the bankruptcy that ends the company. P19 opens the
   LEGAL movement ("In February 1992 a jury came back…") and P19–P23 is one continuous arc — verdict,
   reversal, settlement, conviction, the HR close.
2. **It leaves the final fifth coherent and whole.** The skeleton reserves the withheld peak for
   P21–P23 (Wiles convicted + the HR punchline); the last fifth now carries that peak with its whole
   run-up intact, rather than starting one beat into it.
3. **The act-3/act-4 seam is nowhere near 80 %.** The skeleton's seam (P15/P16) sits at 67.8 % — the
   brief's "snap to the act seam if it lies near 80 %" branch does not apply, so the paragraph boundary
   at the fraction wins.
4. **It ends mid-nothing.** No delta chain, no stage and no place visit crosses the boundary: L195
   declares no place and no stage, and the last chain (`gate-after`, L190+L191) closes five shots
   earlier.

**Shot count comes from the VO, not from a target average** (lesson 16). 47 shots at 2.10 s is denser
than fifth 3's 2.19 s because this span's clauses are shorter: nine of the 47 cuts exist only because
the alternative merge would have run past 3.0 s. Nothing was split to hit a number, and nothing was
held to fill one.

---

## 2. Places

### New place + plate

| `place` | Plate | Owner decision | Shots | Why that owner call |
| --- | --- | --- | --- | --- |
| `denver-newsroom` | **L172** (cast-free, no chain parent, no stage) | **`owner_ambiguity: true`** | L172, L174 (2) | The script names "the Denver newspapers" — a plural CLASS, not a paper. There is no masthead in the fact ledger and none in the narration, so a board over these desks would be signage invented to look decisive, which is the fabrication the owner law exists to stop. Ambiguity is also the truer read: the tip went to the Denver papers, and the room is any of them. Every board and proof surface in the plate is authored blank as a positive state. |

The place QUALIFIES on recurrence: L172 and L174 are two non-contiguous runs (L173, the exit-interview
punchline, sits between them and declares no place), so the plate law applies and L172 satisfies it —
zero named cast, no `stage_role: delta`, and it is the frame L174 seeds (`L174: [L172, crowd-exemplar]`,
verified in the dry-run).

### Places revisited

| `place` | Seeds | Shots in this fifth |
| --- | --- | --- |
| `brick-warehouse` | fifth 1's plate **L03** (`owner_ambiguity`) | L153, L154, L155, L156, L158, L159, L160, L161, L164, L170, L178, L179, L193 (13) |
| `miniscribe-boardroom` | fifth 2's plate **L71** (`owner_ambiguity`) | L149, L152, L175, L177, L180, L185 (6) |
| `miniscribe-plant` | fifth 1's plate **L28** (`place_owner: "MINISCRIBE"`) | L165, L167, L168, L169, L190, L191 (6) |
| `wiles-office` | fifth 2's plate **L63** (`owner_ambiguity`) | L150, L151, L176 (3) |

Verified against forge with the plates added to `--shots` (lesson 17), not asserted:

```
L149: [L71, crowd-exemplar]        L153: [L03, crowd-exemplar]
L150: [fig-qt-wiles--point-at-thing--expr-smug, L63]
L165: [fig-auditor-rep--action-walk--expr-deadpan, L28]
L167: [L28, crowd-exemplar]        L174: [L172, crowd-exemplar]
L177: [L71, crowd-exemplar]        L178: [L03, crowd-exemplar]
L185: [L71]                        L190: [L28, lettering-marker-italic]
L193: [L03]
```

**17 of 47 shots declare no place:** the five place-exempt classes
(`physicalized-imbalance` L157/L186, `number-glued-to-object` L162/L184/L188/L182,
`symbolic-stand-in-object` L189) plus one-frame worlds the file never returns to — the regulator's
counter hall, the home hallway, the personnel interview room, the accounting bench, the accounting
corridor, the hotel press room, the broker's counter, the law-office corridor, the courthouse filing
counter.

**The `MINISCRIBE` carry, handled by drafting rather than by lettering** (lesson 19): the four
`miniscribe-plant` shots that do NOT draw the entrance board (L165, L167, L168, L169) never write the
company's name in scene prose at all — the only place it appears is inside the backticked
`` `miniscribe-rep` `` control token, which lint blanks. L190/L191, which DO draw the board, re-quote
`'MINISCRIBE'` character-for-character; it is the place's carried sign, so it is exempt from
payload-last and never displaces either shot's real payload.

---

## 3. Pricing basis — what generation this fifth costs

| | Count |
| --- | --- |
| **Scenes** (every shot is `ai-gen`) | **47** |
| **STEP-1 figure gens emitted over the range** | **11** |
| …of which are NEW to the file (fifths 1–3 do not mint them) | **8** |
| …already minted earlier and merely shared on a whole-file run | 3 |
| Plates inside those 47 scenes | 1 (L172) |
| Text-bearing scenes (§5 lettering exemplar derived) | 11 (L162, L163, L164, L180, L182, L184, L186, L188, L189, L190, L191 — 6 distinct literals between them) |
| Crowd-rig scenes | 31 |
| Max seeds on any single request | **3** — nowhere near `SEED_CAP` (4); no displacement anywhere in the range |

The 11 STEP-1 cards forge emits over L149–L195, with the whole-file verdict:

```
fig-qt-wiles--point-at-thing--expr-smug          (L150)              shared  (fifth 2 L069 / fifth 3 L101)
fig-brick-foreman--expr-smug                     (L152)              shared  (fifth 3 L100)
fig-auditor-rep--action-walk--expr-deadpan       (L165)              shared  (fifth 3 L107)
fig-brick-foreman--expr-deadpan                  (L158)              NEW
fig-miniscribe-rep--hold-one-hand--expr-delighted(L163)              NEW
fig-miniscribe-rep--expr-deadpan                 (L168)              NEW
fig-brick-foreman--expr-crestfallen              (L169, shared L170) NEW
fig-brick-foreman--hold-one-hand--expr-smug      (L171)              NEW
fig-brick-foreman--sit--expr-smug                (L173)              NEW
fig-qt-wiles--carry-by-handle--expr-crestfallen  (L176)              NEW
fig-miniscribe-rep--expr-caught                  (L183)              NEW
```

So the marginal figure cost of this fifth is **8 cards, not 11**: three frames deliberately reuse a
card an earlier fifth already mints, and L170 shares L169's. Proof, not assertion — a whole-file
dry-run (all 195 shots minus L29) emits **38** STEP-1 gens against **30** for L01–L148 alone.

**One card that looks reusable and is not:** L168 needed `miniscribe-rep` deadpan, and act 1's L29
already mints a deadpan card — but L29's is `fig-miniscribe-rep--action-powerstance--expr-deadpan`, a
different POSE, and a planted wide stance is the wrong body for a man handing out layoff notices. The
card name is the reuse key, so a near-miss on the pose is a new card whatever the expression says.

**`rifenburgh-ceo` — the one un-minted cast slug, and a hard prerequisite.** The skeleton plans him for
P17 and this fifth authors him on his naming line (L177) plus one reaction (L185). The dry-run proves
what that costs today: forge cannot resolve a slug the registry and the video's Pass-1 library both
lack, so it emits **no STEP-1 card** for either shot and ships the backticked token as prose in the
scene payload. That is the designed Pass-1 authoring gap (`visual-grammar.md` §2), not a defect — but
it means **image-generation must mint `rifenburgh-ceo` at its Pass-1 gate before a generation token is
spent on L177 or L185.** Both shots' `notes` say so.

`miniscribe-rep` is cast on three frames (L163, L168, L183) and every one authors "his chest and lapels
plain": the de-badged canonical is honoured in prose, and no prompt in the range contains "badge",
"pin", "lapel object" or "logo" (grep-verified).

---

## 4. Chains, cast and the laws that shaped the staging

**Stages (27), 5 of them carrying deltas.** No chain exceeds one base + 3 deltas, every run is
contiguous, and none crosses the fifth's boundary. The act's set-piece chains:
`target-ratchet` (L150 + 1δ, the quota wire stepping up) · `junk-padding` (L153 + 3δ, at the cap —
castings, scrap, the drift, the wall) · `night-shift` (L158 + 1δ, the family arriving) ·
`went-looking` (L178 + 1δ, the carton opening on the brick) · `books-again` (L181 + 1δ) ·
`below-nothing` (L188 + 1δ) · `gate-after` (L190 + 1δ, the closing pair).

**Every cast entrance is a stage BASE, never a delta**, and both cast-bearing deltas (L151, L159)
re-state the pose AND the expression their base seeded, so the delta slate stays `[parent + canonical]`
and no register is ever changed by prose alone (lesson 13 applied at authoring, not caught at the
dry-run). Verified: `L151: [L150, qt-wiles]`, `L159: [L158, brick-foreman, crowd-exemplar]`.

**Feasibility gates are sized to the LAST delta of each chain** (lesson 10), and each says so in
`notes`: L153 authors clear room above the castings (L154), a swept floor (L155) AND a bare rear wall
(L156, three shots downstream); L158 authors the floor inside clear and the trestle empty; L178 authors
the sample carton sealed, square and at chest height with the film already cut back; L181 authors the
bench's near end bare; L188 authors the floor hatch shut and flush beside the pallet; L190 authors the
approach road clear and empty.

**Two-cast shots: none.** Act 4's beats are one lead against a room, so no `interaction` slug and no
two-cast presence clause is in play anywhere in the range.

**Casting kept off the plural-role spans, decided BEFORE the prose** (lessons 14/18). Four spans in
this fifth name a generic plural role from the check's own list:

- **L158** — "One of the **executives** even brought his own family in at…". `brick-foreman` survives
  ONLY because the adjacent span (L157) says "bricks", which singularizes onto the slug token. That was
  read off the tiled span before the prompt was written; had L157 been re-anchored a few words later
  the beat would have had to restage.
- **L165** — "wasn't the **auditors**" justifies `auditor-rep` directly (the check singularizes both
  sides), so the ironic counterpoint keeps its named lead.
- **L168** — "cut a batch of **employees** loose" justifies `miniscribe-rep`, whose slug token sits in
  the same span.
- **L187** — "By the time the **accountants** finished redoing the books". "accountant" is NOT an
  `auditor-rep` token and no neighbour supplies one, so this beat is staged as **mass action with crowd
  only** — trolleys of shut ledgers leaving down a corridor. That is also the better read: the line's
  subject is the work ending, not any one person.

### Self-audit (SKILL step 3c)

- **Non-literal share.** 41 of 47 are non-literal. The 6 `literal` frames are concrete physical objects
  or actions the line describes (the cartons taking scrap ×4, the opened carton with the brick, the
  books being wheeled out). No shot merely draws its line's words.
- **Class variety.** 12 of the 14 classes appear: crowd-multiplication 10 · ironic-counterpoint 8 ·
  personified-character 7 · literal 6 · number-glued-to-object 4 · diegetic-device 3 ·
  physicalized-imbalance 2 · idiom-pun 2 · reaction-shot 2 · staged-interaction 1 ·
  symbolic-stand-in-object 1 · aftermath-palette-turn 1. The heaviest is 21 %.
  **A reflex was caught and fixed here:** the first pass ran `crowd-multiplication` on 14 of 47 (30 %),
  because act 4's beats are mostly rooms full of people and the class was becoming the default answer
  to "there are people in it". Four were re-derived to the class the beat actually is — L152 to
  `staged-interaction` (a conspiracy huddle IS an interaction), L179 to `literal` (the found brick is a
  concrete object), L182 to `number-glued-to-object` (a year on a ledger spine), L187 to `literal`.
  `map-plan-view` and `register-shift-infographic` are unused: this span has no territory beat and no
  mechanism to explain — the mechanism was act 3's job.
- **World variety (lesson 12), audited explicitly.** The fifth runs through 5 declared places plus 11
  distinct one-frame worlds, and no two consecutive shots reach for the same nouns. Three repeats are
  deliberate arguments the script itself makes: the quota wire (L150/L151 set up, L176 pays off
  stripped), the plaque (L163 awarded, L164 hung over the bricks), and the shop counter (L184's single
  bundle, L186's stack beside it) — the last with L185 between them so it reads as a comparison rather
  than as one image twice.
- **Red-ink count: 4 distinct semantic uses across 47 frames** — the quota rule (L150/L151, the file's
  one carried motif, continued from act 3's L101/L102), the correction stroke through '14 MILLION'
  (L186, the punch element), the bankruptcy seal on the gate (L190/L191, prohibition), and the cord
  tying each filed suit (L195, ownership). Brick red and mahogany red-brown are scene palette, not
  accent. Whole-file count stays low: 6 / 3 / 6 / 4 across the four fifths.
- **Human use: 40 of 47 frames carry figures (85 %).** The longest figureless run is **6.57 s**
  (L188–L190), well under the ~10 s self-audit flag; next longest 2.81 s. Every figureless frame names
  its earn in `notes`: L162 (a date), L184 (a figure on a page), L186 (a physical comparison a body
  would compete with), L188/L189 (a valuation given mass), L190 (aftermath — the emptiness IS the
  argument, and the next cut fills the same road), L193 (a claim about an asset, with the people who
  bought it in the frames either side). Nothing was populated to hit a share: every added crowd sits on
  a line whose own words name people.
- **Cadence vs the 3a budget.** The skeleton budgeted ~70 shots for the whole of act 4 (P16–P23,
  estimated 196.4 s); this fifth covers 98.60 s of it — P15 plus P16–P18 — with 47 shots. Every
  `duration_s` is the MEASURED hold from the forced-alignment timings, not an estimate off the header's
  175 wpm.

**Lettering: 6 distinct literals in 47 shots** — `'1988'` [F-28], `'BEST MANAGED'` [F-28],
`'MASSIVE FRAUD'` [F-15], `'1986'` [F-15], `'14 MILLION'` [F-16], `'88 MILLION'` [F-16], plus the
carried `'MINISCRIBE'` [F-01]. All are the script's own words; all sit in their shot's final clause
(or, on a delta, inside the one held restatement); every other text-bearing surface in the fifth is
authored blank as a positive state — the pinned works notice (L167), the target cards (L150/L151), the
untouched regulator file (L166), the pink slip (L169), the spiral pad and every board in the newsroom
(L172), the bond certificates (L192/L193) and the ticket strip (L194).

**One value was deliberately NOT lettered.** L186's "The real number was closer to 40" could have
carried a '40 MILLION' card opposite the '14 MILLION' one. The script says "closer to 40" and never
says "40 million" in that clause, so lettering it would have been the image extending the VO. The shot
draws the real figure as MASS instead — a block three times the height, with nothing propped against
it — and keeps the only literal on the struck-through card the script did supply.

---

## 5. Cadence — the inversions closed, and the one left visible

**Zero real-cadence heads-ups over the range**: all 47 real holds are inside 1.52–2.81 s (the L195
"~338 words on one anchor" heads-up is the standard partial-coverage artifact — the last shot of an
incomplete file tiles to the end of the script, exactly as fifth 2's L89 and fifth 3's L148 did).

The cut list was built against the forced-alignment timings BEFORE a word of prose was written
(lesson 21), then three base/delta inversions were closed by moving ONE anchor inside its own sentence
— never by inventing a duration:

| chain | anchor moved to | before (base / delta) | after |
| --- | --- | --- | --- |
| `junk-padding` | L154 → `"and factory scrap, and whatever"`, L155 → `"whatever else was lying around,"` | 1.56 / 2.34 / 2.20 / 1.52 | **2.35 / 1.65 / 2.10 / 1.52** |
| `night-shift` | L159 → `"to help pack the boxes."` | 2.12 / 2.26 | **2.58 / 1.80** |
| `books-again` | L182 → `"1986. MiniScribe had owned up"` | 1.79 / 2.52 | **2.01 / 2.30** |

The `junk-padding` move paid a content dividend as well as a cadence one: the base now takes the broken
drives its OWN span names, and the delta takes the factory scrap its own span names, instead of the
base showing empty cartons through a line that is already describing what goes in them.

**One inversion is left visible rather than papered over: L182 (2.30 s) against its base L181
(2.01 s).** Every other split point inside "…redo the books all the way to 1986." puts one half under
the 1.5 s floor (the next candidate leaves L181 at 1.95 s and L182 at 2.36 s, no better, and the one
after that leaves 0.55 s), and pulling L181's anchor earlier would take L180 to 1.25 s. The VO simply
speaks the base's line faster than the delta's; the declared numbers are the real ones and disagree
with nothing.

Four anchors are four words or shorter. Two are the full text of their own sentence
(`"It was a layoff."`, `"They sued everybody."`); the other two are exact four-word interior spans
(`"Each quarter, Wiles raised"`, `"sales targets and management"`), which is the floor the schema sets.
No anchor is under three words, and every one is a verbatim span of `script.md` in strict narration
order.

---

## 6. Acceptance evidence

### Lint

`py -3 .claude/skills/visual-prompt-writer/scripts/lint_shots.py channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`

```
== lint_shots: channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json ==
long-form shots: 195  |  shorts: 0

HARD violations (1) - render sync WILL degrade, fix before handoff:
  [long-form] Sum of duration_s 433s < 85% of the ~558s runtime (1628 words / 175wpm, per the
  header) - durations don't cover the VO (stretch-to-fill risk); size shots near real seconds or
  densify.

Heads-up (14):
  [long-form] L74: REAL hold 1.44s ... below the 1.5s floor.              <- fifth 2's, documented
  [long-form] L195: covers ~338 words on one anchor (>~8s VO)             <- partial-coverage artifact
  [long-form] L08 / L13 / L14 (stage deltas): ... not longer than the base.   <- fifth 1's
  [long-form] L096 (stage 'lockbox-swap' delta): 2.7s ...                 <- fifth 3's, documented
  [long-form] L182 (stage 'books-again' delta): 2.3s ...                  <- §5, left visible
  [long-form] L48 / L62 / L64 / L79 / L80 / L129 / L173: `sit` with support authored -
             confirm the render's FRAMING actually shows the support (forced review row).
```

**The ONE surviving HARD is the partial-coverage artifact the brief names, and nothing else:** the
duration-sum check measures Σ `duration_s` against the WHOLE 9:20 runtime, and this file covers 80.0 %
of it (fifths 1+2+3+4 of 5). It cannot clear until the last fifth is authored. The `runtime ÷ 4s` =
140-shot floor cleared at fifth 3 and stays clear at 195 shots.

Everything else passed on the run: anchors matched verbatim and in strict narration order against the
real VO word-stream (zero unmatched), place key/inventory/exempt-class laws, conditional plate law,
place-owner forced choice, `place_anchor` same-place law, delta character-entrance, delta feasibility,
interaction-template, two-cast presence, seat/support, action-chain, semantic-cast, crowd tiering,
spatial tier, text-supply, lettering word/count/char caps, carried literals (L-1), payload-last, banned
render terms, control leak, rig-clause fingerprint, suffix one-voice, shot-class enum, `figures` shape.

**Heads-ups over MY range, each accounted for:**
- **L195's "~338 words on one anchor"** — the last shot of an incomplete file tiles to the end of the
  script. It drops to 3 words the moment fifth 5 lands.
- **L182's delta-longer-than-base** — a real-timing artifact of the legacy rule, explained in §5 and
  left visible on purpose.
- **L173's `sit` row** — the law's own mandatory review row, not a defect: the sentence names the chair
  and the contact ("sits well back on the visitor's chair … with his hips right back in the chair").

Two real defects were found by lint during authoring and FIXED rather than explained: the three
base/delta hold inversions (§5) and the `crowd-multiplication` reflex at 30 % of the range (§4).

### Forge dry-run over the authored range

```
py -3 .claude/skills/image-generation/scripts/forge.py batch \
  --kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit \
  --video channels/the-second-take/videos/2026-07-28-bricks-fresh \
  --batch .../shots.json --out <spec> --shots L149,...,L195 --dry-run
```

```
  L193: [ROOT-TEXT] (PLATE - place-first frame, hardened descriptor, no image anchor)
  L194: [crowd-exemplar] (no cast - the scene composes from the place)
  L195: [crowd-exemplar] (no cast - the scene composes from the place)
  == batch: 47 scene(s) + 11 STEP-1 figure gen(s), 0 not generated -> <spec> ==
  == scoped to 47 shot(s); 10 seeding-law violation(s) remain OUTSIDE the scope ==
EXIT=0
```

**Zero refusals, no `SEEDING LAW` block, exit 0.** 47 scenes, 11 STEP-1 figure gens, 0 not generated,
max 3 seeds on any request (never at `SEED_CAP`, nothing displaced anywhere).

**The 10 out-of-scope violations are fifths 1–3's, and they are scoping artifacts — proved, not
asserted** (lesson 23). Two probes settle it:

- Scoping to L01–L148 (minus L29) reports **2** remaining outside — exactly this fifth's two
  cast-bearing deltas (L151, L159), which have no slate at all when they sit outside the scope. Same
  shape as fifth 3's five.
- Scoping to **all 194 shots** (the whole file minus L29) reports
  `194 scene(s) + 38 STEP-1 figure gen(s), 0 not generated` and
  **`0 seeding-law violation(s) remain OUTSIDE the scope`, exit 0.** With everything in scope there is
  no violation anywhere in the file, which is the definitive proof that every scoped run's count is an
  artifact of the scope and not a defect.

L29 is excluded from the whole-file probes for the reason fifth 3 recorded: its STEP-1 frame is
already sitting in the MAIN checkout's `_staging/` awaiting human review, so any run containing it
exits 1 on `figure_reuse_refusal`. That is pre-existing staging state from fifth 1, unrelated to this
fifth, and untouched by it.

### Place-seed lineage, verified

A probe run with the four existing plates added to `--shots` confirms every revisit resolves as
designed (lesson 17 — an in-place shot shows no place seed purely because its plate sits outside the
scope): see the slate table in §2.

### L01–L148 untouched

The first **201,779 bytes** of the file — everything through L148's closing brace — and the entire
`thumbnail` tail are byte-identical to the pre-run copy. Verified by prefix and suffix comparison
against a backup taken before the first write, and re-verified after every edit pass.

---

## 7. Hand-off notes for fifth 5 (the final fifth)

- Fifth 5 opens on **P19**, `"In February 1992 a jury came back"` (word 1297, t = 432.060 s) and runs
  to the end of the VO at 539.515 s — **107.5 s, P19–P23**, five paragraphs: the $550M verdict, the
  reversal, the settlement, Wiles convicted, and the HR close. The skeleton's **withheld peak
  (P21–P23)** lives entirely inside it and is unspent.
- **`rifenburgh-ceo` must be minted at image-generation's Pass-1 gate before L177/L185 generate** (§3).
  Fifth 5 does not need him — the script hands the last movement to the jury, the judge, Wiles and
  Maxtor — so no further un-minted slug is planned.
- `hq-banker` is the one planned cast member the file has not used since act 2 and P19 calls for him
  directly ("Hambrecht & Quist got hit too"). "bankers" is not in P19's wording, but the slug token
  `banker` is not needed: the span says "Hambrecht & Quist", which trips no plural role at all.
- **Act-5 semantic-cast traps** (check the tiled span BEFORE casting, lessons 14/18): P19 says
  "the **accountants** who had signed off" — that does NOT justify `auditor-rep`, and the adjacent span
  is "Two hundred million of it was punishment aimed straight at Coopers & Lybrand", which is clean.
  P21 says "the people below him testified"; "people" is not on the check's list, so that one is free.
  P22 says "the **investors** collected about a quarter" — a listed plural with no cast slug near it.
- **Places available to revisit:** `brick-warehouse` (L03), `miniscribe-plant` (L28), `wiles-office`
  (L63), `miniscribe-boardroom` (L71), `brick-company-yard` (L113 — P22's "The big winner was probably
  the Colorado Brick Company" is its natural payoff and it already carries `place_owner:
  "COLORADO BRICK"`, so any yard shot that redraws the gate board must re-quote it verbatim),
  `denver-newsroom` (L172), `computer-shop` (L05, act 1 only).
- **A courtroom is the obvious new place and it does NOT obviously qualify.** P19, P20 and P21 all put
  a jury or a judge on screen; if those runs are contiguous it is a `stage`, not a `place`, and needs
  no dedicated cast-free plate. Decide that from the authored cut list, not from the paragraph count.
  If it does qualify, `owner_ambiguity` is almost certainly the honest call — the script names no
  court.
- **STEP-1 cards already in the file that fifth 5 can share rather than re-mint:** eleven `qt-wiles`
  cards (act 2's eight, plus `--sit--expr-greedy`, `--action-present--expr-delighted`,
  `--carry-by-handle--expr-crestfallen`), nine `brick-foreman`, four `auditor-rep`, and now
  `fig-miniscribe-rep--expr-deadpan` / `--expr-caught` / `--hold-one-hand--expr-delighted`. Check the
  list before minting a near-duplicate; the pose is half the key.
- **The duration-sum HARD clears when fifth 5 lands** — and only then. Fifth 5 must cover ~107.5 s;
  at the file's running 2.1–2.2 s that is roughly 48–52 shots, and the file finishes near 245.
