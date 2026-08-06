# Authoring audit — bricks-fresh shots.json (248 shots), pre-Phase-6c

Read-only audit of the ENTIRE authored file against `visual-grammar.md` S1-S2 and
`visual-prompt-writer/SKILL.md` rules 2-3. Written weaknesses-first. Executive summary is at the END.

Comparison baseline: the pre-reset 214-shot file (`assets/_archive-pre-reset/shots.pre-reset.json`).

## 0. The one number that frames everything: class drift

Same script, same channel, two authorings. Share of the file by `shot_class`:

| shot_class | OLD 214 | NEW 248 | drift |
| --- | --- | --- | --- |
| literal | 6 (2.8%) | 34 (13.7%) | **x4.9** |
| crowd-multiplication | 11 (5.1%) | 37 (14.9%) | **x2.9** |
| ironic-counterpoint | 35 (16.4%) | 42 (16.9%) | flat |
| idiom-pun | 13 (6.1%) | 26 (10.5%) | x1.7 (more labelled, see S1) |
| reaction-shot | 24 (11.2%) | 12 (4.8%) | **halved** |
| physicalized-imbalance | 27 (12.6%) | 9 (3.6%) | **-71%** |
| symbolic-stand-in-object | 32 (15.0%) | 15 (6.0%) | **-60%** |
| staged-interaction | 15 (7.0%) | 13 (5.2%) | flat |
| personified-character | 13 (6.1%) | 18 (7.3%) | flat |
| diegetic-device | 9 (4.2%) | 18 (7.3%) | x1.7 |

The three classes that CARRY comedy and argument in this grammar — reaction-shot,
physicalized-imbalance, symbolic-stand-in-object — lost 55 slots between them (71 -> 36). The two
classes that carry COVERAGE — literal and crowd-multiplication — gained 54 (17 -> 71). That is a
near one-for-one trade of jokes for wallpaper, and it is the measured form of what Daniel saw in the
first tenth.

## 1. COMEDY DRAIN — the jokes are still THERE; nobody is performing them

**The file is not short on comic IDEAS.** L61 (many sanctums = a ring of five office doors round one
man), L62 (five companies = five desks and one chair that belongs to none of them), L74 (two coats
still on the rack outside the room), L135 (the meeting table drawn in section so you see the money on
the carpet), L136 (the whole scheme as one closed loop with the same pallet on it twice), L199 ("fork
up" taken at its word), L201 (a field gun laid dead level at the auditor), L241 (the brick on the
presentation podium), L243 (a set trap that never went off). Several of these are better than
anything in the old 214.

**What is missing is the PERFORMER.** Count of the three joke-carrying classes:

| | idiom-pun | ironic-counterpoint | reaction-shot | ALL 3 |
| --- | --- | --- | --- | --- |
| named cast figure IN the frame | 4 | 20 | 4 | **28 / 80 = 35%** |
| crowd only (no named actor) | 19 | 20 | 4 | 43 / 80 |
| no figure of any kind | 3 | 2 | 4 | 9 / 80 |

**Only 4 of the file's 26 idiom-puns have an actor in them** (L61, L173, L224, and L18's phones are
not even a person). Nineteen are crowd-only — and in 96 of the file's 142 crowd shots (68%) the crowd
is introduced with the *same sentence shape*: "a crowd of X works the far side of Y". The joke sits
alone in the foreground as a still life; the humans are behind a rail, a counter, a trestle, a pane
of glass, or a shelving rack, doing something unrelated, facing away.

### The mechanism (this is a doctrine interaction, not sloppy authoring)

Three rules compose into the drain, and every one of them is being obeyed:

1. `visual-grammar.md` S1 figure-bias — a beat about people must carry bodies.
2. S2 crowd law — "Crowd belongs in a positive REAR zone in the PRIMARY scene clause — far side of
   the real table/shelving, behind a divider, through a doorway."
3. S2 cast tiers — "Every human in frame is either NAMED CAST or CROWD, no third tier." An anonymous
   foreground human does not exist.

So when an author needs a body in a gag, the cheap compliant move is to declare `crowd: true` and put
them at the back. Putting a body ON the joke costs a named-cast slot against the <=2 cap and a
STEP-1 figure gen. The file took the cheap move 19 times out of 26 on idiom-puns. **Rule 1 was
satisfied by POPULATION, not by PERFORMANCE.** That is exactly the frame Daniel saw.

### Worked examples, against the old file

**L20 "raking it in" — Daniel's own example. HIGH.**
New (`brick-warehouse` backroom delta): *"a long garden rake now lies across the floor with its head
buried in a raked heap of loose banknotes, drag lines fanning out behind it through the dust"* — the
rake is on the ground, nobody's hands on it; the crew is on the far side of the racks banding notes
into a strongbox. The gag is a crime-scene photo of a joke that already happened.
**OLD L19** staged the identical line as: *"A blue-boilersuit loading-yard crew works as a mass AROUND
a long-handled garden rake PLANTED in a deep drift of loose banknotes, SWEEPING the notes into one
neat heap."* The crew is mid-ground and ON the tool. Old also stated three-plane depth ("money
foreground, crew and pallet mid-ground") — the crowd was in the picture, not behind it.

**L45 "MiniScribe fell off a cliff" — HIGH, and the notes' justification does not hold.**
New: an empty red-rock lip, twin skid ruts, a burst pallet on the scree below, *"the plain above the
lip runs empty to the horizon."* The note claims *"absence EARNED — putting bodies at the bottom of a
cliff is the gore reading the policy forbids."*
**OLD L40** proves that is a false dichotomy: `miniscribe-rep` (`expr-fear`, `action-recoil`) holds at
the very lip, with the plant's assembly conveyor running out over the rock and *ending dead in mid-air
at the same lip, its last drive on the final roller with nothing beyond it*. A face at the top, no body
at the bottom, no gore — plus a better invention (the production line that just stops in the air).
The current frame has neither the face nor the conveyor.

**L09 "flying off the shelves" — MED.** New: one winged box hanging over an emptied bay. **OLD L09:**
five winged machines in a row along the bare top shelf, all facing the same way, *and one clean gap
left of centre where a sixth sat, its dust outline still on the shelf board.* Same idiom, one more
turn of the screw, and the multiplication does the work.

**L68 "your head was on the chopping block" — MED.** A butcher's block, a cleaver, a swivel chair
pulled up to it, *"nobody in it."* The gore rule bans a head on the block; it does not ban the man
standing beside it watching, or `expr-worried` seated in that chair. As authored it is a prop still-life
on a punchline beat.

**L194 "were out for blood" — HIGH, and the note admits it.** *"Anger staged as pressure and volume
rather than as faces, which keeps it inside the channel's register and off the gore line."* Anger on
faces is not gore. This is the single clearest instance of the crowd-emotion suppression (S4) and
comedy drain landing on the same shot.

**L211 "Just kidding" — HIGH.** The gag is that only the prize leaves and *"the cheering stays"* — and
the cheering is authored as *"arms still up"* with zero faces. The joke IS the faces holding a
celebration that has nothing left to celebrate.

### Beats where the joke is drained to coverage (full list, severity in the fix-list)

`L20` rake unmanned · `L45` cliff unpeopled · `L68` chopping block · `L09` winged box ·
`L59`/`L60` the risotto pass (cooks face away across the range while the ledger lands on the plate) ·
`L097` the typewriter typo (one raised key foreground, the counters a doorway away) ·
`L112` the wire shopping basket on a trade counter (best gag in act 3, nobody holding the basket) ·
`L125` "next level" (a forklift, crowd guiding it in from behind the block) ·
`L146` "It's the TSA" (pallet on the belt, travellers queued behind a webbing barrier, nobody watching it) ·
`L160` "bring your kid to work" (the child is authored, but as a silhouette folding flaps *"at the same
steady rate as the adults"* — the pun needs the face, not the rate) ·
`L194` out for blood · `L199` "fork up" (the men are ranged along the shaft — this one is close, it needs
strain on faces) · `L206` the verdict card on the corridor floor (the packed gallery is authored
"turned toward the open door", no reaction) · `L210`/`L211` prize-giving · `L241` podium brick (the
onlookers pack the rope line and are given nothing to feel about the winner being a brick) ·
`L243` the set trap (clerks file past "every head turned toward the door" — away from the payload) ·
`L221` "karma for being a dick" (the ONE frame in the video authored to land vindication on a laid-off
crowd, and the crowd is given no expression at all).

**Not broken, leave alone:** L61, L62, L74, L135, L136, L173, L224, L236, L237, L244, L245, L246, L247.

## 2. LITERALISM — the letter of the rule is kept; the spirit is spent in the middle third

Scoring method: every shot read against S1 rule 2 ("non-literal by DEFAULT; literal reserved for a
concrete physical action or object; when a line could go either way, go non-literal"). Physical-action
beats are NOT counted as failures — that is where literal is correct. What IS counted is a beat that
was **literal-ELIGIBLE and taken literally where a non-literal read was available**, because that is
the choice the rule tells the author to skew against.

### The blunt number first

`shot_class: "literal"` is 34/248 = **13.7%**, against **2.8%** in the old 214 — a 4.9x rise. But the
per-50 distribution is dead flat (14 / 14 / 14 / 14 / 12 %), so this is not one bad act. It is a
uniform lowering of the invention bar.

### Literal-restatement density by fifth (hand-scored, 248/248 read)

| fifth | shots | literal-restatement | density | verdict |
| --- | --- | --- | --- | --- |
| F1 `L01–L48` | 48 | 5 | **10%** | healthy. Best invention run in the file (L12–L15 vault, L36 adding machine, L38 trailer, L39 banking hall, L42 the brick in the lettered carton) |
| F2 `L49–L096` | 48 | 8 | **17%** | strong first half (L61, L62, L70, L74, L76), then the audit block sags |
| F3 `L097–L148` | 52 | 16 | **31%** | **the problem fifth** |
| F4 `L149–L195` | 47 | 19 | **40%** | **the problem fifth** (though ~6 of these are legitimately physical) |
| F5 `L196–L248` | 53 | 11 | **21%** | recovers hard — the best-invented fifth after F1 |

### The boring stretches (this is the finding, not the single shots)

**STRETCH A — `L111–L121`, 11 shots, ~23s: the operations montage. WORST IN FILE.**
The video's centrepiece mechanic rendered as a corporate process video: rent the warehouse (L111) ->
go shopping (L112) -> the brick yard (L113) -> buy 26,000 (L114) -> handpick them (L115) -> put a
pattern drive beside them (L116) -> put bricks in boxes (L117) -> wire a serial ticket on (L118) ->
[L119 invents] -> wrap them (L120) -> all wrapped (L121). **8 of 11 draw exactly the nouns of their
own line.** Three genuinely invent (L112 the wire basket, L119 the real drive with the identical
ticket, L122 the ledger squared up beside the pallets it lies about) and they are the only frames in
the stretch a viewer will remember. Every literal in it is *legal* — packing is a physical action —
which is precisely why lint never caught it.

**STRETCH B — `L153–L156`, 4 shots, 7.6s: junk padding.** A base and three deltas, each one adding
the next noun of the sentence (broken drives -> factory scrap -> whatever else -> it grew). Enumeration
staged as enumeration. Also a chain-cap violation (S3).

**STRETCH C — `L081–L088`, 8 shots, ~22s: the audit arriving.** Accountants come in (L081) -> set up
a trestle (L082) -> a ledger beside a shelf (L083, invents) -> everybody counts (L084) -> [L085
invents, the spike] -> hold the paper against the shelf (L086) -> the shelf is bare (L087) -> the room
stares at the bare shelf (L088). The discovery is stated three consecutive times (L086, L087, L088)
in the same bay. The file's own notes flag this ("the FIFTH consecutive frame of the same shelf bay
saying the shelf is short, 12.4s in one bay") and repaired only L090, leaving L086–L088 intact.

**STRETCH D — `L167–L174`, 8 shots, ~17s: the layoff and the leak.** notice board -> handing out
notices -> a man holding a pink slip -> the crowd streaming out -> [L170 invents, the join] -> a phone
in a hallway -> a newsroom -> the papers ran. Two inventions in eight.

**STRETCH E — set monotony, F5: 9 near-identical institutional frames.** `L194` law corridor,
`L195` filing counter, `L214` paying counter, `L231` courthouse corridor, `L232` courthouse corridor
again, `L237` office corridor, `L239` payout window, `L240` payout trestle, `L245` HR corridor. Every
one is "institutional green / cold strip light, a counter or corridor running the width, a crowd
beyond a rail or grille, one small buff object large in the near ground." L232's own note records the
file catching this exact reflex once (the third beam-balance) and fixing it by moving to... another
corridor. 35 shots across the whole file fit that description.

### Individual shots that fail the bar outright (not part of a stretch)

- `L16` "Every computer needs one" -> a shelf of identical computers each holding a drive. Draws the
  sentence. Class says `crowd-multiplication`; the depiction is a restatement.
- `L37` "at their peak in 1988" -> a busy factory floor. The peak is asserted by business.
- `L107` "something an auditor could walk up to, put his hands on" -> an auditor walking up to it.
- `L131` / `L138` / `L145` — three separate frames whose whole content is "there are a lot of pallets."
- `L143`/`L144` "they pull a sample, count it" — the procedure drawn as the procedure, immediately
  after `L142` already gave it a clean schematic. One of the two is redundant.
- `L11` and `L34` — the file's own notes admit these were the same bench picture twice and repaired
  the framing; both remain static object studies on an explainer beat.

### Where it is fine, it is fine

F1 and F5 do not need this pass. F5 in particular (L198 derrick, L200 cannonball, L201 field gun,
L207–209 the propped slab going down then gone, L217 the scale peak, L220 the bag in the wrong
corridor, L236 the open empty bag on the kerb, L238 three year-ledgers on a cell shelf, L243 the trap,
L244 the tug-of-war, L248 the aisle with no back wall) is the strongest sustained invention in the
file. Do not touch it.

## 3. RUN LENGTHS — 3 cap violations, 13 over-long set runs, and one 46-second stretch

### 3a. Stage chains over the NEW <=2-delta cap (HARD, 3 of them)

All three are `base + delta + delta + delta`. Each needs exactly one shot re-based or moved out.

| stage | shots | proposal |
| --- | --- | --- |
| `drive-vault` | `L12` b, `L13` d, `L14` d, `L15` d | **Re-base at `L15`.** L15's change (a curtain drawn across the bottom shelf) is a punchline on a NEW idea, not a further fill. Make L15 a fresh base — same room, tighter framing on the bottom shelf with the curtain already drawn. Chain becomes 1+2 / 1+0. Cheapest option: no prose invented, one field flipped and one framing clause tightened. |
| `brick-tease` | `L22` b, `L23` d, `L24` d, `L25` d | **Merge `L24` into `L23`.** L23 opens the front carton on one brick; L24 opens the rest of the row; the two are the same reveal at two scales. Author one delta whose change is "the whole unwrapped top row now stands open, one red clay brick in each" and give the recovered 1.7s to the lettering delta L25 (currently 1.9s, the payload frame). Chain becomes 1+2. **Alternative if Daniel wants the beat count kept:** re-base at L25 — the lettering frame is a new payload and reads fine as its own establishing frame. |
| `junk-padding` | `L153` b, `L154` d, `L155` d, `L156` d | **Merge `L154` into `L155`.** Both are "more junk goes in" (metal offcuts; then slats/banding/tape reels) — one transformation stated as two. Combined change: "the ring of cartons is filled to the flap line with offcuts and swarf, and a drift of broken slats, banding coils and tape reels is tipped across the concrete." Chain becomes 1+2. This ALSO fixes the S2 enumeration problem (Stretch B). |

### 3b. Runs of >3 consecutive shots on one set (13, `place`-keyed)

Ordered worst-first. `n` = consecutive shots, `t` = seconds on that set without a cut away.

| set | shots | n | t | proposal |
| --- | --- | --- | --- | --- |
| `miniscribe-plant` | `L86–L091` | 6 | 14.8s | The discovery said three times (L86 hold-up, L87 bare shelf + FOUR MILLION, L88 the room stares). **Cut `L88`** and give its 2.9s to L89 (the face, currently 1.8s) — the aftermath beat is already carried by L090's shuttered pay hatch. Alternative: **intercut** — move L085's spike frame (currently sitting before L86) between L87 and L88. |
| `miniscribe-plant` | `L28–L33` | 6 | 11.9s | Six openers in one plant: plate, rep, date, founder, boom, handshake. **Intercut `L30` out** — "founded in 1980" does not need to be inside the plant at all; it is currently a lit bench in the dark with a crate lettered '1980'. Re-derive as a non-plant world (a founding document, a garage, a first order) and the run splits 2 / 3. |
| `computer-shop` | `L05–L10` | 6 | 13.3s | Two chains plus two roots in one shop. **`L10` (the anachronistic dawn launch-queue) should not declare `place: computer-shop`** — it is a transplanted modern world and the only thing it borrows is a counter. Drop the place, re-derive the interior as a generic shopfront. Run splits 5 / 1. |
| `miniscribe-plant` | `L81–L84` | 4 | 11.0s | **Re-derive `L081`** (accountants filing in through the lobby). The arrival does not have to be inside the plant — a fleet of deed boxes coming out of a car boot, or the audit engagement letter, both cut away and both non-literal. Splits 1 / 3. |
| `brick-warehouse` | `L153–L156` | 4 | 7.6s | Fixed by the 3a merge (becomes 3). |
| `miniscribe-plant` | `L093–L096` | 4 | 8.5s | Four consecutive `literal` on one trestle. Legal (a physical break-in), but flat. **Split with `L099`** — the two-item tool roll on the baize card table currently sits three shots later at L099 and is the funniest frame in the sequence. Move it between `L095` and `L096`; it lands better on "Allen wrenches and paper clips" than on "not exactly Ocean's Eleven". |
| `brick-company-yard` | `L113–L116` | 4 | 8.8s | Part of Stretch A. **Cut `L114` or `L115`** — "bought 26,000" and "handpicked to match" are two labour wides of the same yard; one of them should become a non-literal read (see the S2 fix-list). Splits to 3. |
| `miniscribe-boardroom` | `L77–L80` | 4 | 9.6s | Acceptable — two 2-shot chains with different subjects (the room's rhythm, then one man). **Lowest priority; leave.** |
| `miniscribe-plant` | `L104–L107` | 4 | 8.1s | Acceptable — the paper-bridge pun, a reaction, and a want; three different registers. **Leave.** |
| `brick-warehouse` | `L158–L161` | 4 | 8.6s | Acceptable — the family gag needs its set. **Leave.** |
| `brick-warehouse` | `L22–L25` | 4 | 8.7s | Fixed by the 3a merge (becomes 3). |
| `drive-vault` | `L12–L15` | 4 | 8.7s | Fixed by the 3a re-base (becomes 3+1). |
| `jury-courtroom` | `L216–L219` | 4 | 7.5s | Acceptable — dock, conviction peak, exhibits. **Leave.** |

### 3c. The real problem is bigger than any single run: near-contiguous set stretches

Counting stretches where a set dominates a window even if a one-shot cutaway breaks the literal run:

| set | span | shots in span | in-set | seconds |
| --- | --- | --- | --- | --- |
| **`miniscribe-plant`** | **`L81–L100`** | **20** | **16** | **46.0s** |
| `brick-warehouse` | `L137–L145` | 9 | 7 | 22.0s |
| `brick-warehouse` | `L153–L161` | 9 | 8 | 18.3s |
| `miniscribe-plant` | `L28–L37` | 10 | 8 | 20.7s |
| `computer-shop` | `L05–L10` | 6 | 6 | 13.3s |
| `brick-warehouse` | `L117–L122` | 6 | 5 | 11.7s |

**`L81–L100` is 46 consecutive seconds in one factory with four brief escapes** (L085 a spike on a
desk, L092 a struck sheet on a desk, L097 a typewriter — and even that one looks back through a
doorway into the plant — and L099 the card table). Across the whole file `miniscribe-plant` carries 46
shots and `brick-warehouse` 39: **85 of 248 shots, 34% of the video, in two grey industrial interiors
with the same palette line.** No individual run breaks a rule; the cumulative effect is what makes the
middle of the video feel like one long room. Fixing the three cap violations does not touch this — it
needs 3–4 beats in `L81–L100` re-derived into worlds outside the plant (the S2 fix-list marks which).

**Doctrine flag:** there is no rule in `visual-grammar.md` that caps consecutive-shots-on-one-`place`
or total-time-in-one-`place`. The <=3 (now <=2) delta cap governs a `stage`, and a `place` can be
re-entered by an unlimited number of fresh stages back to back — which is exactly what L81–L100 does
(five separate stages plus four roots, all in the plant). If Daniel wants this class of drift caught
by lint rather than by audit, that is a doctrine ADDITION, not a restage.

## 4. MISSING CROWD EMOTION — 142 crowd shots, ~4% author any feeling on the crowd

### The measurement

- Crowd shots (`figures.crowd: true`): **142** of 248 (57%).
- Shots where the prompt contains ANY emotion-bearing token anywhere: **29 (20%)** — and most of those
  tokens belong to a NAMED CAST `expr-` slug standing in the same frame, not to the crowd.
- Shots where a plain-word emotion is authored **on the crowd itself**: **5**, and three of those are
  my regex catching the adjacent named cast. Genuinely: `L07` ("a queue of **eager** buyers").
  **One shot in 142.**

Poyais ran authored crowd emotion on ~60% of its crowd shots. The "~10%" figure in the brief is
generous to this file; on the crowd itself the honest number is **under 1%**.

### What the crowd is doing instead

96 of 142 (68%) introduce the crowd with the same construction: **"a crowd of X works the far side of
Y"**. Verb census across all 142: `works` 33 · `working` 12 · `stands` 13 · `is` 8 · `sits` 6 ·
`files` 3 · `streams` 2 · `queued` 2 · `packed` 2 · `has` 2 · `bent` 1 · `walking` 1. Only **13 of 142**
give the crowd any attention beat at all (a head turned, a look, a watch) — and even those are
directional, never emotional.

The crowd is therefore doing three things across the entire video: working, standing, or queuing —
always behind something, always facing away or facing down. That is not a cast; it is a texture.
Combined with S1's finding (19 of 26 idiom-puns are crowd-only), it means **the file's comedy is
carried by figures the prompts explicitly instruct not to emote.**

### Fix targets: crowd shots whose VO carries energy the frame does not

One plain word each, to be authored on the crowd in the crowd's own clause (not as an `expr-` slug —
crowd has no canonical and takes prose, per S2 scope law).

| id | VO | word |
| --- | --- | --- |
| `L17`/`L18` | the market watching two firms brawl in a shop window | **entertained** |
| `L19`/`L20` | the manufacturers "quietly raking it in" | **gleeful** |
| `L32` | "And they were HOT." | **elated** |
| `L46` | "They let a quarter of their people go" | **downcast** |
| `L52` | the whole floor waiting for the man to walk in | **apprehensive** |
| `L54` | the kitchen crew watching the Ramsay set | **amused** |
| `L67` | the pay queue on "you got a fat bonus" | **hopeful** |
| `L70` | staff hauling themselves up risers that keep growing | **exhausted** |
| `L71` | two managers made to stand up in a meeting | **uneasy** |
| `L72` | fired on the spot in front of the room | **afraid** |
| `L76` | assemblers looking up at a door-sized target sheet | **dismayed** |
| `L88` | the count stops, the room looks at the bare shelving | **alarmed** |
| `L090` | the pay hatch shuttered and padlocked | **anxious** |
| `L109` | the managers putting their heads together | **conspiratorial** |
| `L138` | accountants at the foot of a wall of pallets | **daunted** |
| `L158`/`L159` | a family brought in at night to pack boxes | **weary** (children **sleepy**) |
| `L163` | trade press at the "best managed company" award | **admiring** |
| `L167` | the works notice board on layoff day | **stunned** |
| `L168`/`L169` | employees filing out with boxes before Christmas | **grim** |
| `L174` | the newsroom the morning the story ran | **excited** |
| `L183` | press at the "owned up to one bad quarter" lectern | **sceptical** |
| `L192` | bondholders holding certificates up at the counter | **worried** |
| `L194` | **"were out for blood"** | **furious** — the file's clearest miss |
| `L197` | the jury standing to return a 550-million verdict | **grave** |
| `L206` | the gallery as the verdict card lands in the corridor | **outraged** |
| `L210` | bondholders with their arms up at "Congratulations!" | **jubilant** |
| `L211` | the same arms still up after the prize is gone | **jubilant** (unchanged — the joke IS the unchanged faces) |
| `L217` | jurors leaning out over the rail at the conviction | **implacable** |
| `L221` | laid-off packers at "karma for being a dick" | **satisfied** |
| `L239`/`L240` | investors getting a quarter of what they were promised | **disappointed** |
| `L242` | the brick yard's men queuing for their payday | **cheerful** |
| `L247` | staff walking out down a corridor strung with paper chains | **glum** |

**Leave alone (the emotionlessness is the argument):** `L04` (commuters, "not one head turned toward
the racks"), `L131` (dock hands going nowhere near the pallets), `L141` (accountants walking past the
one thing that would end it), `L166` (clerks with their heads down over other business), `L243`
(clerks stepping over the trap).

**Doctrine note:** every proposal above is prose inside the crowd's own primary-scene clause and
therefore legal today — S2 explicitly says "the prose still stages crowd figures — where they stand,
what they do, what they wear." Nothing here needs a rule change. The only thing that has to be true
is that image-generation's crowd-exemplar seed does not overwrite the authored expression, which is
the poyais-era mechanism being restored.

---

## EXECUTIVE SUMMARY

1. The file is not badly authored. Its notes show three repair rounds of real rigour, and acts 1 and 5
   contain the best invention in either version of this video. The drain is concentrated and diagnosable.
2. **The comic IDEAS survived; the PERFORMERS did not.** Of 80 joke-class shots, only 28 (35%) have a
   named figure in frame. Of 26 idiom-puns, **4**. Nineteen are crowd-only — and in 96 of 142 crowd
   shots (68%) the crowd arrives in the identical sentence "a crowd of X works the far side of Y".
3. **This is a doctrine interaction, not carelessness.** Figure-bias says put bodies in; the crowd law
   says crowd goes in a REAR zone; the tier law says an anonymous foreground human does not exist. The
   compliant cheap move is to declare crowd and park them at the back. Figure-bias got satisfied by
   POPULATION rather than by PERFORMANCE. Putting a hand on the rake costs a named-cast slot.
4. Daniel's own example checks out: L20's rake lies unmanned on the floor while the crew bands notes
   behind the racks. Old L19 had the crew working AROUND the planted rake, mid-ground. Same for L45 —
   the new cliff is empty; old L40 had `expr-fear`/`action-recoil` at the lip and the conveyor ending
   in mid-air. The current note calls that absence "earned" on gore grounds; the old frame proves it
   is a false dichotomy.
5. **Class drift, measured:** literal 2.8% -> 13.7% (x4.9) and crowd-multiplication 5.1% -> 14.9%
   (x2.9), while reaction-shot halved, physicalized-imbalance fell 71% and symbolic-stand-in fell 60%.
   Seventy-one joke/argument slots traded for coverage.
6. **Literalism is spent in the middle third**: restatement density runs 10 / 17 / **31** / **40** / 21%
   across the five fifths. Almost every literal is technically LEGAL (packing is a physical action) —
   which is why nothing caught it. The rule broken is "when a line could go either way, go non-literal".
7. **Worst stretch: L111–L121** — the video's centrepiece mechanic rendered as a corporate process
   video, 8 of 11 shots drawing their line's own nouns. Also L153–L156 (enumeration), L081–L088 (the
   discovery said three times in one bay), L167–L174 (the layoff), and 9 near-identical institutional
   corridor/counter frames in act 5.
8. **Chains: 3 cap violations** (drive-vault L12–15, brick-tease L22–25, junk-padding L153–56), each
   fixable by one merge or one re-base. **13 runs of >3 consecutive shots on one set.**
9. **The bigger run problem has no rule behind it:** L81–L100 is **46 consecutive seconds** with 16 of
   20 shots inside `miniscribe-plant`, and 85 of 248 shots (34% of the video) sit in two grey
   industrial interiors. Doctrine caps deltas within a `stage` but nothing caps re-entering a `place`.
10. **Crowd emotion is effectively zero: 1 shot in 142** authors a feeling on the crowd itself
    (L07's "eager buyers"). Poyais ran ~60%. L194 "out for blood" is authored with no faces at all,
    and its note says so on purpose.
11. **Fix-list: 85 proposals across 77 shots** (35 crowd-emotion, 23 literal, 18 comedy, 9 chain;
    35 high / 40 med / 10 low). L19/L20/L21 excluded per brief.
12. **Three proposals need a doctrine call, not a restage:** L20 and L112 (a foreground gag-performer
    is illegal unless it is named cast), and L100 (a place-run cap does not exist).
13. **Do not touch act 5** (L196–L248) except for the crowd-emotion and Stretch-E merges. It is the
    strongest sustained invention in the file and re-opening it will cost more than it buys.
