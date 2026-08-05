# VPW fifth 3 — authoring report (2026-08-05)

Video: `2026-07-28-bricks-fresh` · FRESH-AUTHORING mode under the 2026-08-04 doctrine reset.
$0, no provider call, nothing committed, no git touched. Worktree `boss-bricks-reset` only.

**Read set:** `visual-prompt-writer/SKILL.md` · `scratchpad/vpw-fresh-skeleton.md` ·
`scratchpad/vpw-log-fresh.md` (lessons 1–17) · `scratchpad/vpw-fifth2-report.md` · `script.md` ·
`assets/voiceover.manifest.json` (real forced-alignment word timings) · `visual-kit/visual-grammar.md` ·
`visual-kit/registry/registry.json` (worktree) + the MAIN-checkout registry (the de-badged
`miniscribe-rep` canonical) · `references/shots-schema.md` · `assets/library/manifest.json` ·
`scripts/lint_shots.py` and `scripts/forge.py` (the laws as implemented) · the CURRENT `shots.json`
(L01–L89, for lineage only). No archived or quarantined file was read at any point.

---

## 1. Range authored

| | |
| --- | --- |
| **Shots** | **L090 – L148 — 59 new shots** (file now 148 shots; L01–L89 byte-identical, verified) |
| **First / last paragraph** | P10 ("And coming up short like that…") → P14 ("…what a box with a hard drive in it weighs.") |
| **First / last anchor** | `"And coming up short like that"` → `"box with a hard drive in"` |
| **VO span** | t = 204.080 s → 333.461 s = **129.38 s** of measured VO |
| **Cadence** | avg **2.19 s**; **every real hold in the range is inside 1.5–3.0 s** (zero cadence heads-ups) |
| **Σ `duration_s`** | 129.4 s over the range (file total 334.7 s of the 540.1 s VO — **61.7 %**) |

### Why the end boundary snaps there

The 3/5 mark is 324.05 s of VO. The two paragraph boundaries either side of it are the end of **P13
at 307.700 s (57.0 %)** and the end of **P14 at 333.461 s (61.7 %)**. P14's end wins on four grounds:

1. **It is nearer 60 %** — 9.4 s past it, against P13's 16.4 s short of it.
2. **It does not split the skeleton's mid-video re-arm.** `vpw-fresh-skeleton.md` §6 reserves the
   video's strongest staging for "the ship-and-return loop and the test count (P13–P14)". Stopping at
   P13 would cut that designated peak in half across two fifths and two authoring sessions.
3. **It is a beat seam, not just a paragraph break.** P14 ends on the mechanism's punchline ("a box
   with a brick in it weighs exactly what a box with a hard drive in it weighs") — the scheme fully
   explained. P15 opens the escalation ladder ("And this wasn't a one time thing"), a fresh movement.
4. **It ends mid-nothing.** No delta chain, no stage and no place visit crosses the boundary: the last
   chain (`same-weight`, L147+L148) closes on L148, and L148 declares no place at all.

The skeleton's act 3 is P10–P15; this fifth takes P10–P14 and leaves P15 to open fifth 4, which is
where the act's own escalation ladder starts.

**Shot count comes from the VO, not from a target average** (lesson 16): the cut points are the
clause boundaries the forced-alignment timings actually allow with every hold held inside 1.5–3.0 s.
59 shots at 2.19 s average — between fifth 1's 2.20 and fifth 2's 2.43, and the file is now at
148 shots against the whole-runtime floor of 140, which is why that HARD has cleared.

---

## 2. Places

### New place + plate

| `place` | Plate | Owner decision | Shots | Why that owner call |
| --- | --- | --- | --- | --- |
| `brick-company-yard` | **L113** (cast-free, no chain parent, no stage) | **`place_owner: "COLORADO BRICK"`** | L113, L114, L115, L116 (4) | This is the one business in the story the script names out loud AND puts a transaction through: "they went shopping at a local company: the Colorado Brick Company." A board over its own gate is read off the script, not invented — which is exactly the test the owner law sets. Two words, 14 glyphs, inside every lettering cap, quoted verbatim in the plate's own prompt and in its final clause. |

The plate/reveal seam is used again, in its disclosure-order form: **L112 declares no place at all**
(an unbranded builders'-merchant counter for "and went shopping at a local company:") because the VO
has not yet said the name, and **L113 is the plate on the clause that names it**. Authoring L112 in
the yard would have made *it* the plate and forced the brand on screen a line early.

### Places revisited

| `place` | Seeds | Shots in this fifth |
| --- | --- | --- |
| `brick-warehouse` | fifth 1's plate **L03** (`owner_ambiguity`) | L111, L117, L118, L120, L121, L122, L125, L127, L128, L133, L137, L138, L139, L141, L143, L144, L145 (17) |
| `miniscribe-plant` | fifth 1's plate **L28** (`place_owner: "MINISCRIBE"`) | L091, L093, L094, L095, L096, L098, L100, L104, L105, L106, L107 (11) |
| `wiles-office` | fifth 2's plate **L63** (`owner_ambiguity`) | L101, L102, L129, L134 (4) |
| `miniscribe-boardroom` | fifth 2's plate **L71** (`owner_ambiguity`) | L109, L110 (2) |

Verified against forge, not asserted (probe run, §5): with the plates in scope,
`L091: [fig-brick-foreman--expr-fear, L28]`, `L101: [fig-qt-wiles--point-at-thing--expr-smug, L63]`,
`L129: […, L63]`, `L143: [fig-auditor-rep--…, fig-brick-foreman--expr-worried, L03, crowd-exemplar]`.
`brick-warehouse` is the act-3 revisit the skeleton reserved for it and is now the fifth's home set.

21 of 59 shots declare no place: the five place-exempt classes (`physicalized-imbalance`,
`symbolic-stand-in-object`, `map-plan-view`, `register-shift-infographic`) plus one-frame worlds the
file never returns to (the merchant counter, the caper table, the drive-maker's bench, the exercise
bike, the dock frontage, the wholesale stockroom, the meeting-table underside, the accounting floor,
the airport screening line).

**Two beats were deliberately authored in a non-exempt class to keep their SET** (the schema's own
sanctioned swap, recorded in `notes`): L114 (a `number-glued-to-object` beat authored
`crowd-multiplication` so it keeps `brick-company-yard`) and L128 (a symbolic-insert beat authored
`ironic-counterpoint` so it keeps `brick-warehouse`).

---

## 3. Pricing basis — what generation this fifth costs

| | Count |
| --- | --- |
| **Scenes** (every shot is `ai-gen`) | **59** |
| **STEP-1 figure gens emitted over the range** | **10** — all resolve GENERATE, none REUSED |
| …of which are NEW to the file (fifths 1–2 do not mint them) | **8** |
| …already minted by fifth 2 and merely shared on a whole-file run | 2 |
| Plates inside those 59 scenes | 1 (L113) |
| Text-bearing scenes (§5 lettering exemplar derived) | 3 (L113, L114, L130) |
| Crowd-rig scenes | 33 |
| Max seeds on any single request | **4** (L143, exactly at `SEED_CAP`) — no displacement anywhere |

The 10 STEP-1 cards forge emits over L090–L148:

```
fig-brick-foreman--expr-fear                        (L091)                     NEW
fig-brick-foreman--action-armscrossed--expr-worried (L094, shared by L106)     NEW
fig-brick-foreman--expr-smug                        (L100)                     NEW
fig-auditor-rep--action-thumbsup--expr-deadpan      (L098)                     NEW
fig-auditor-rep--action-walk--expr-deadpan          (L107)                     NEW
fig-qt-wiles--sit--expr-greedy                      (L129)                     NEW
fig-qt-wiles--action-present--expr-delighted        (L134)                     NEW
fig-qt-wiles--point-at-thing--expr-smug             (L101)   shared with fifth 2's L69
fig-auditor-rep--hold-paper-by-sides--expr-deadpan  (L139, shared by L143)  shared with fifth 2's L86
fig-brick-foreman--expr-worried                     (L143)   shared with fifth 2's L86
```

So the marginal figure cost of this fifth is **8 cards, not 10** — three of the eleven cast-bearing
frames deliberately re-use a card fifth 2 already mints, and two more (L106, L143) share a card
minted inside this fifth. No pose, interaction or expression slug outside `registry.json` was
authored; all three cast slugs (`brick-foreman`, `auditor-rep`, `qt-wiles`) already sit in this
video's Pass-1 `assets/library/manifest.json`, so **nothing new is minted at the Pass-1 gate**.

`miniscribe-rep` is not cast anywhere in this fifth, so the de-badged canonical never comes up:
no prompt in the range contains "badge", "pin", "lapel" or "logo" (grep-verified).

---

## 4. Chains, cast and the laws that shaped the staging

**Stages (28), 10 of them carrying deltas.** No chain exceeds one base + 3 deltas, every run is
contiguous, and none crosses the fifth's boundary. The act's set-piece chains:
`lockbox-swap` (L094 + 2δ — pry, tools, swap) · `target-again` (L101 + 1δ, the quota rule moving up) ·
`paper-bridge` (L104 + 1δ) · `plan-room` (L109 + 1δ) · `handpicked` (L115 + 1δ) ·
`pallet-build` (L117 + 1δ) · `wrap-line` (L120 + 1δ) · `test-count` (L143 + 1δ) ·
`same-weight` (L147 + 1δ, the closing frame).

**Every cast entrance is a stage BASE, never a delta** — `brick-foreman` L091/L094/L100/L106,
`auditor-rep` L098/L107/L139, `qt-wiles` L101/L129/L134. Every delta re-states the pose AND the
expression its base seeded, so the delta slate stays `[parent + canonical]` and **no expression is
ever changed by prose alone** (lesson 13 applied up front, not caught at the dry-run).

**Feasibility gates are sized to the LAST delta of each chain, not the next shot** (lesson 10),
and each one says so in `notes`: L094 authors the sprung lid flat and clear (for L095's tools) AND
the trestle's near end empty (for L096's sheaf); L104 puts the press weight on the floor beside the
pallet so L105 only has to move a thing the parent already contains; L109 authors the boardroom table
completely bare; L115 authors the near-end carton open and empty; L117 authors every carton open with
its end face clear; L120 leaves two stacks loose and the near pallet half-wrapped; L143 authors the
rest of the trestle top clear; L147 authors the right pan empty and high.

**Two-cast shots (2):** L143 and its delta L144 (`auditor-rep` + `brick-foreman` over the sample
cartons). L143 is a fresh stage base and states plane, eye line and relative-head-scale; no
`interaction` slug — the beat is a standoff across a trestle, not contact, and the free slot is left
unspent. Its slate is 4 seeds, **exactly at `SEED_CAP` with nothing displaced**.

**Casting kept off the plural-role spans, decided BEFORE the prose** (lesson 14). Three spans in this
fifth name a generic plural role, and all three are staged as mass action with crowd only:

- **L093** — its VO span is "The real sheets were locked in the accountants' own", which names
  *accountants*. This is why L093 is a **cast-free frame of the shut deed boxes** and the chain base
  is L094, one cut later, whose own span ("boxes, so they popped the boxes open with") is clean. The
  first draft put `brick-foreman` on L093 and the semantic-cast law caught it at $0.
- **L109 / L110** — "So the managers put their heads together" — the boardroom ring of heads, crowd
  only. The line's subject genuinely is a room agreeing with itself.

`auditor-rep` on L107 is the opposite case and stays named: its own VO span says "Something an
**auditor** could walk up to" — singular, and the plural-role test never fires on it.

### Self-audit (SKILL step 3c)

- **Non-literal share.** 48 of 59 are non-literal. The 11 `literal` frames are concrete physical
  objects or actions the line actually describes (the locked boxes, the sprung lid, the tools, the
  swap, the empty rented shell, the yard, the pattern drive, bricks going into cartons, the wired
  tickets, the pallets coming back in, the packed-out warehouse). No shot merely draws its line's
  words.
- **Class variety.** 12 of the 14 classes appear: literal 11 · ironic-counterpoint 10 ·
  idiom-pun 8 · crowd-multiplication 7 · reaction-shot 5 · diegetic-device 4 ·
  personified-character 4 · physicalized-imbalance 3 · symbolic-stand-in-object 2 · map-plan-view 2 ·
  staged-interaction 2 · register-shift-infographic 1. The heaviest is 19 %, and
  `ironic-counterpoint` is the channel's declared signature move on a beat carrying a lie, a boast or
  a euphemism — which is most of act 3. `number-glued-to-object` and `aftermath-palette-turn` are
  unused: this span has no grim beat, and its one bare count (26,000) is authored inside a peopled
  yard frame instead of as a floating number frame.
- **World variety (lesson 12), audited explicitly.** The fifth runs through 5 declared places plus 9
  distinct one-frame worlds, and no two consecutive shots reach for the same nouns. The two
  deliberate repeats are BOTH callbacks the script itself makes: the caper table (L099 → L126, empty
  roll then full roll, same light) and the inventory ledger on its crate (L122 → L137, the same
  object counted twice, which is the line's joke).
- **Red-ink count: 6 distinct uses across 59 frames** — L092's struck column line (falsification),
  L101/L102's quota rule (the one carried motif), L130's shipping arrow, L132's roped-off cord
  (prohibition), L136's closed loop (the mechanism). Every one is alarm, prohibition or ownership;
  none is decoration. Brick red and packed red dust are scene palette, not accent. Whole-file count
  stays low: fifth 1 six, fifth 2 three, fifth 3 six.
- **Human use: 45 of 59 frames carry figures (76 %).** The longest figureless run is **5.1 s**
  (L147+L148, the closing balance pair), nowhere near the ~10 s self-audit flag; next longest 3.5 s
  (L092+L093). Every figureless frame names its earn in `notes`: L092 (the sheet), L093 (whose boxes
  they are, plus the semantic-cast call above), L099 (the empty pockets ARE the joke), L103 (the
  accumulating paper), L108 (the procedure's residue), L113 (a plate is cast-free by law),
  L124 (an object nobody is using — the gag), L126 (a punchline about objects), L128 (the emptiness
  IS the argument), L130/L136 (territory and route), L142 (a procedure), L147/L148 (a physical
  equivalence a body would only compete with). Nothing was populated to hit a share: every added
  crowd sits on a line whose own words name people working.
- **Cadence vs the 3a budget.** The skeleton budgeted ~62 shots for the whole of act 3 (P10–P15,
  estimated 172.1 s); this fifth covers 129.38 s of it with 59 shots, which at the same rate would be
  ~47 — the extra 12 are forced by the VO's own clause lengths (§5). Every `duration_s` is the
  MEASURED hold from the forced-alignment timings, not an estimate off the header's 175 wpm.

**Lettering: 3 distinct literals in 59 shots** — `'COLORADO BRICK'` (the yard plate's owner cue),
`'26,000'` [F-05] and `'SINGAPORE'` [F-09]. All three are the script's own words, all three land in
their shot's final clause, and every other text-bearing surface in the fifth is authored blank as a
positive state. Five places where a value could have been invented are deliberately blank or
illegible instead: the falsified column (L092), the typewriter platen (L097), Wiles' quota board
(L101/L102 — the script names no figure), the wired serial tickets (L118), and every ledger and
count-sheet column in the fifth. `'SINGAPORE'` is the payoff of L026's authored restraint in act 1,
which drew the same routing unlettered precisely because the script had not yet named a destination.

---

## 5. Cadence — the inversions closed, and the one left visible

**Zero real-cadence heads-ups over the range**: every one of the 59 real holds is inside 1.5–3.0 s.

Five base/delta hold inversions were closed by moving ONE anchor to a verbatim later span of the same
sentence, never by inventing a duration (round-3 lesson 11):

| chain | anchor moved to | before | after |
| --- | --- | --- | --- |
| `target-again` | L102 → `"target, it raises it."` | 1.63 / 2.79 | **2.18 / 2.24** |
| `plan-room` | L110 → `"came up with a brilliant plan."` | 1.56 / 2.58 | **2.08 / 2.06** |
| `handpicked` | L116 → `"real boxed hard drive."` | 1.65 / 2.20 | **1.91 / 1.93** |
| `test-count` | L144 → `"sample matches the paperwork,"` | 1.66 / 2.08 | **1.99 / 1.76** |
| `same-weight` | L148 → `"box with a hard drive in"` | 2.42 / 2.66 | **2.71 / 2.37** |

**One inversion is left visible rather than papered over: L096 (2.7 s) against its base L094
(2.3 s).** The only remaining split point inside "took the real count out and put the fake one in"
lands at 217.312 s, which leaves L096 at 1.43 s — under the floor. Moving L094's anchor earlier is
worse: it would pull "the accountants' own" into L094's span and trip the semantic-cast law on the
shot that casts `brick-foreman`. The VO simply speaks the base's line faster than the delta's; the
declared numbers are the real ones and disagree with nothing.

Four anchors are under four words (`"but pretty close."`, `"They needed product."`,
`"books as inventory."`, `"It's the TSA."`). Three are the full text of their own sentence; the
fourth (`"books as inventory."`) is the only interior split point in "premium Colorado clay sitting
on the books as inventory" that leaves BOTH halves above the 1.5 s floor, and it buys the fifth's
thesis pair — the pallets, then the ledger they are booked into.

---

## 6. Acceptance evidence

### Lint

`py -3 .claude/skills/visual-prompt-writer/scripts/lint_shots.py channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`

```
== lint_shots: channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json ==
long-form shots: 148  |  shorts: 0

HARD violations (1) - render sync WILL degrade, fix before handoff:
  [long-form] Sum of duration_s 335s < 85% of the ~558s runtime (1628 words / 175wpm, per the
  header) - durations don't cover the VO (stretch-to-fill risk); size shots near real seconds or
  densify.

Heads-up (12):
  [long-form] L74: REAL hold 1.44s ... below the 1.5s floor.            <- fifth 2's, documented
  [long-form] L148: covers ~644 words on one anchor (>~8s VO)
  [long-form] L08 / L13 / L14 (stage deltas): ... not longer than the base.   <- fifth 1's
  [long-form] L096 (stage 'lockbox-swap' delta): 2.7s ... not longer than the base.
  [long-form] L48 / L62 / L64 / L79 / L80 / L129: `sit` with support authored - confirm the
             render's FRAMING actually shows the support (forced review row).
```

**The ONE surviving HARD is a pure partial-coverage artifact, named:** the duration-sum check
measures Σ `duration_s` against the WHOLE 9:20 runtime, and this file covers 61.7 % of it (fifths
1+2+3 of 5). It cannot clear until the last fifth is authored. **The second artifact fifths 1 and 2
carried — the `runtime ÷ 4s` = 140-shot floor — has CLEARED**, because the file now holds 148 shots.

Everything else passed on the run: anchors matched verbatim and in strict narration order against the
real VO word-stream (zero unmatched), place/plate/owner laws, place inventory, conditional plate law,
two-cast presence, seat/support, action-chain, semantic-cast, delta character-entrance, delta
feasibility, interaction-template, crowd tiering, spatial tier, text-supply, lettering caps, carried
literals (L-1), payload-last, banned render terms, control leak, rig-clause fingerprint, suffix
one-voice, shot-class enum, `figures` shape.

**Heads-ups over MY range, each accounted for:**
- **L148's "~644 words on one anchor"** — the same partial-coverage artifact fifth 2's L89 carried:
  the last shot of an incomplete file tiles to the end of the script. It drops to 8 words the moment
  fifth 4 lands.
- **L096's delta-longer-than-base** — a real-timing artifact of the legacy rule, explained in §5 and
  left visible on purpose.
- **L129's `sit` row** — the law's own mandatory review row, not a defect: the sentence names the
  chair and the contact ("leans forward on the swivel chair … with his hips right back in the chair").

Two real defects were found by lint during authoring and FIXED, not explained: L093's original
casting (the semantic-cast trap on "the accountants' own", §4) and the five base/delta hold
inversions (§5).

### Forge dry-run over the authored range

```
py -3 .claude/skills/image-generation/scripts/forge.py batch \
  --kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit \
  --video channels/the-second-take/videos/2026-07-28-bricks-fresh \
  --batch .../shots.json --out <spec> --shots L090,…,L148 --dry-run
```

```
  L146: [crowd-exemplar] (no cast - the scene composes from the place)
  L147: [ROOT-TEXT] (PLATE - place-first frame, hardened descriptor, no image anchor)
  L148: [L147] (no cast - the scene composes from the place)
  == batch: 59 scene(s) + 10 STEP-1 figure gen(s), 0 not generated -> <spec> ==
  == scoped to 59 shot(s); 5 seeding-law violation(s) remain OUTSIDE the scope ==
EXIT=0
```

**Zero refusals, no `SEEDING LAW` block, exit 0.** 59 scenes, 10 STEP-1 figure gens, every `fig-*`
**GENERATE** (none REUSED — none of these cast members has an approved staged card yet), 0 not
generated, max 4 seeds (L143, exactly at the cap, nothing displaced).

**The 5 out-of-scope violations are fifth 2's, and they are scoping artifacts, not defects** —
L50, L51, L57, L73, L80, each "delta beat staging `<cast>` with no in-chain parent frame … in the
slate", because each one's chain parent (L49, L56, L72, L79) sits OUTSIDE `--shots`. Proved by
running the pre-run file scoped to L48–L89: `42 scene(s) + 16 STEP-1 figure gen(s) … 0 seeding-law
violation(s) remain OUTSIDE the scope`. Nothing in L090–L148 appears in that list.

### Place-seed lineage, verified

A probe run with the four plates added to `--shots` confirms every revisit resolves as designed
(lesson 17 — an in-place shot shows no place seed purely because its plate sits outside the scope):

```
  L091: [fig-brick-foreman--expr-fear, L28]
  L094: [fig-brick-foreman--action-armscrossed--expr-worried, L28]
  L098: [fig-auditor-rep--action-thumbsup--expr-deadpan, L28, crowd-exemplar]
  L101: [fig-qt-wiles--point-at-thing--expr-smug, L63]
  L129: [fig-qt-wiles--sit--expr-greedy, L63]
  L143: [fig-auditor-rep--hold-paper-by-sides--expr-deadpan,
         fig-brick-foreman--expr-worried, L03, crowd-exemplar]
```

A WHOLE-FILE dry-run (no `--shots`) exits 1, on **L29 — a fifth-1 shot whose STEP-1 frame is already
sitting in the MAIN checkout's `_staging/` awaiting human review** (`figure_reuse_refusal`). That is
pre-existing staging state, unrelated to this fifth, and it is exactly the case lesson 17 records:
scoping is how a partial file gets a clean run while an unrelated staged STEP-1 elsewhere refuses.

### L01–L89 untouched

The first **125,436 bytes** of the file — everything through L89's closing brace — and the entire
`thumbnail` tail are byte-identical to the pre-run copy. Verified by prefix and suffix comparison
against a backup taken before the first write.

---

## 7. Hand-off notes for fifth 4

- Fifth 4 opens on **P15**, `"And this wasn't a one time thing."` (word 996, t = 333.461 s). P15 is
  the escalation ladder (junk padding, the family packing at night, "best managed company"), and it
  runs to 366.364 s.
- `brick-warehouse` is now the file's densest set (21 shots) with `brick-company-yard` plated at
  L113; the skeleton's `denver-newsroom` (act 4, P16) is still un-plated and needs its own owner
  forced choice — the script gives it "the Denver newspapers", so a `place_owner` there would have to
  be sourced from those words or the honest call is `owner_ambiguity`.
- `rifenburgh-ceo` (P17) is still the only cast slug left to mint at the Pass-1 gate.
- STEP-1 cards already in the file that fifth 4 can share rather than re-mint: eight `qt-wiles`
  cards (act 2) plus `--sit--expr-greedy` and `--action-present--expr-delighted` (this fifth), five
  `brick-foreman` cards, and four `auditor-rep` cards.
- The act-4 semantic-cast traps: P16 says "employees", P17 "a new management team", P19 "the
  accountants", P21 "the people below him", P22 "the investors". `brick-foreman` IS justified across
  P16 ("the same people who had been packing the **bricks**" — 'brick' is a slug token);
  `auditor-rep` is NOT justified by "accountants" alone (lesson 14) and needs the adjacent clean span.
