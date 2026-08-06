# Perspective / vantage drift — poyais vs bricks-fresh

**Analysis only. Nothing changed. No git actions taken.**
Brief: find what made poyais's compositions FLAT, what in today's grammar re-introduced vantage
authoring, and the MINIMAL removals that restore the flat default.

Evidence base: `videos/2026-07-04-poyais/shots.json` + its 15 `shots.pre-*.json` revisions and its
surviving rendered PNGs; `videos/2026-07-28-bricks-fresh/shots.json` (248 shots); the VPW SKILL +
references; `visual-kit/visual-grammar.md`; `visual-kit/style-bible.md`; `example-shots.md`;
`scratchpad/vpw-fresh-skeleton.md`; `scratchpad/vpw-log-fresh.md`; read-only `git log -S` history.

---

## 1. Framing-vocabulary tables — poyais vs bricks-fresh

### 1a. The structural finding (the headline)

| | poyais (117 shots) | bricks-fresh (248 shots) |
| --- | --- | --- |
| Prompts containing an explicit **`Framing:` clause** | **0** | **202 (81.5%)** |
| Prompts naming an **off-eye-level vantage** | **2 (1.7%)** | **27 (10.9%)** — 17 real + 10 one-point |
| The word **`camera`** anywhere in the prompt corpus | **2** | **78** |

Poyais never had a camera slot. It described **subjects and worlds**; the vantage was whatever the
model does by default with a flat-cel description — which is a frontal picture-plane. Bricks-fresh
authors a **camera position sentence in four out of five shots**, and once you are writing a camera
sentence, "wide static eye-level from the doorway" is boring prose and "low wide angle from floor
level" is interesting prose. **The slot is the disease; the vantage words are the symptom.**

This is not a late-file drift in poyais either. Across all 15 archived revisions
(`shots.pre-vpw-rerun-2026-07-14` → `shots.pre-r10-2026-07-18`), the `Framing:` count is **0 in every
single one**, and the vantage count never exceeds 2. Ten rounds of critic passes, watch-throughs and
rework never once added a camera clause.

### 1b. Poyais's entire vantage vocabulary (the whole list)

| Term | Count | Shot | Note |
| --- | --- | --- | --- |
| `wide low-angle establishing shot` | 1 | L01 | the hook — and the ONE that got promoted to a gold exemplar (see §3.6) |
| `top-down` | 4 | L03, L15, L16, + map deltas | **not a camera vantage** — these are flat plan-view MAP GRAPHICS (a drawn chart lying in the picture plane), the same thing a printed atlas page is |
| `high-angle` | 1 | one shot | — |
| `straight-on` | 1 | one shot | *toward* flat, not away from it |
| `three-quarter` | 1 | one shot | — |
| `overhead` | 2 | — | both are overhead *lighting*, not an overhead camera |
| `corner` | 4 | — | all diegetic room corners, not corner vantages |
| `depth` | 45 | many | the style-bible's fore/mid/background **layering** read, not perspective |

Total genuine off-eye-level camera vantages in poyais: **2 of 117 (L01, one high-angle)**.

### 1c. Bricks-fresh vantage vocabulary (frequency, `Framing:` clause only)

| Term | Count |
| --- | --- |
| `one-point` (view straight down an aisle/table) | 11 |
| `from floor level` / `at floor level` / `from floor height` | 9 |
| `low wide angle` | 6 |
| `looking up` | 3 |
| `looking down` / `high, looking down` / `high wide … looking down` | 3 |
| `low angle` | 1 |
| `from over the bench` | 1 |
| `medium-low` | 1 |
| `three-quarter` | 11 (mostly figure orientation, not camera — mixed) |

Plus a second, quieter layer of **forced-depth** language across **47 distinct shots**:
`receding` (13), `to camera` (12), `depth` (12), `falling away` (4), `stepping away` (4),
`converging` (3), `running back deep`, `close to camera`, `square to camera`, `towering over`.
Poyais's corpus contains `receding` twice and `to camera` zero times.

**Words that exist now that did not exist then:** `one-point view`, `from floor level`,
`at floor height`, `low wide angle`, `high wide from the stair landing looking down`,
`from over the bench`, `medium-low`, `square to camera`, `close to camera`, `running back deep`,
`converging hard at the far end`.

---

## 2. Composition classification of the poyais rendered frames

Eight surviving frames were viewed (`_superseded-2026-07-18-r10/` and `_superseded-2026-07-16/`,
plus `_l48-retry-u2b`). Classification:

| Frame | Composition | Vantage | Perspective depth |
| --- | --- | --- | --- |
| `L11.png` (lakeshore row) | frontal friezé — figures in a single rank across the picture plane | **eye-level frontal** | none; treeline/water/bank are stacked flat bands |
| `L54.png` (ship deck, ~70 emigrants) | frontal, crowd stacked upward = further away | **eye-level frontal** | overlap + vertical stacking only; deck planks barely converge |
| `L57-ship2` (Kennersley Castle) | pure side elevation of a ship | **eye-level, dead broadside** | **zero** — it is a technical elevation with a lettered hull |
| `L62-macgregor` (portrait + chest) | centred single figure, flat vignette ground | **eye-level frontal** | none |
| `L62-dollars` (banknote scatter) | flat graphic field on a solid magenta plane | **no camera at all** | none |
| `L74` (Atlantic map) | flat plan graphic filling frame | **plan view of a drawn artifact** | none |
| `L120` (Bolívar salute + crowd) | frontal street tableau; buildings on both flanks | **eye-level frontal** | **shallow one-point at most** — the cobbles fan slightly, the buildings are near-elevation |
| `_l48-retry-u2b` (land-office counter) | two figures across a counter | **eye-level frontal** | one mild oblique (the counter edge) — **one-point max**, and the walls stay flat planes |

**Verdict: 8/8 are eye-level. 0/8 have a high, low, or corner vantage. Maximum perspective anywhere
in the sample is one shallow oblique edge (L48's counter, L120's cobbles).** Depth is carried by
overlap, vertical stacking, and scale — never by a converging floor or a tilted camera. This is
exactly Daniel's description: *"mostly flat, or there can be perspective but not high corner, low
corner, etc."*

Two further points the frames make:
- The maps (L74) prove `top-down` in poyais meant "a flat drawn map fills the frame", not "the camera
  is above the scene". That distinction has to survive into the whitelist or the map class breaks.
- The style-bible's `fore/mid/background depth read` (§5) was satisfied in poyais by **layering**
  (near figures / water / treeline / sky) with no vanishing point at all. The current corpus reads
  that same clause as *recession*, which is the second half of the drift.

---

## 3. The mechanism — where vantage is invited today

There is no single villain. There are six lines, and they compound. The load-bearing one is #1.

### 3.1 `visual-grammar.md` §2 (line 197–198) — the line that MINTED the `Framing:` slot

> `Lint-enforced, HARD, on the lettering half: a non-delta shot carrying a quoted literal ends on`
> `that literal's clause. A trailing "Framing: … Palette: …" after the payload is the commonest way to`
> `break it — put those facts BEFORE the lettered element, not after.`

Arrived **2026-08-04 (`703b5dc`)**, i.e. *between* poyais and bricks-fresh authoring. It is a
payload-ordering rule, but it names `"Framing: … Palette: …"` as **the** shape a prompt takes, and
tells the author to move that clause earlier rather than to stop writing it. Mirrored verbatim in
`references/critics.md:58`, `references/shots-schema.md:146`, `lint_shots.py:1820`, and — decisively —
in the **test fixtures** `test_round2_guards.py:160,164`, whose canonical example strings are literally
`"Framing: wide static from floor level"` and `"Framing: low wide angle"`. An author reading the
doctrine for the prompt shape sees a low-vantage camera clause presented as the house pattern.
**This is the single highest-yield edit.**

### 3.2 `visual-grammar.md` §3 (lines 203–204) — angle named as an authored variable

> `Framing, scale, and angle are a choice driven by the one thing the viewer must see (the payload) and`
> `the shot's class. Unchosen, it defaults to a centered eye-level medium — fine once, deadly on repeat:`

"**angle** … is a choice" makes camera height a per-shot decision, and "eye-level medium … deadly on
repeat" tells the author the flat default is a failure state to escape. Note the history: this section
used to be worse — it carried a bullet reading *"Angle / distance — top-down for a map or plan, low
for dominance … **Reach past the eye-level medium**"*, which was **deleted 2026-07-28 (`317f8e6`)**.
The deletion was right and incomplete: the framing sentence that motivated it survived.

### 3.3 `SKILL.md` step 4 (lines 106–110) — framing made a MANDATORY stated fact

> `4. State the scene facts the beat needs — CONTENT only — layout, orientation …, the action, what a`
> `   gesture or highlight targets …, framing + scale, the committed scene palette, light/atmosphere,`
> `   and depth (fore/mid/background, filled edge-to-edge).`

`framing + scale` sits in the enumerated must-state list, so a conscientious author writes a framing
sentence on every shot — hence 202/248. The poyais-era SKILL (`c3c749d`, 2026-07-15) carried the same
phrase, but as prose inside a longer "a prompt states its FACTS" paragraph rather than as an item in a
crisp checklist; the 2026-07-28 recut (`26604ec`, "thin procedure over grammar") promoted it into a
numbered slot. **Turning prose into a checklist item is what made it a form field.**

`depth (fore/mid/background, filled edge-to-edge)` in the same sentence is the source of the 47-shot
forced-depth layer: authors satisfy "depth" with `receding` / `converging` / `stepping away` rather
than with poyais's layered overlap.

### 3.4 `SKILL.md` Step 3 (lines 138–141) — the decay warning

> `Depiction register decays across a long pass: the back half of a one-pass file drifts literal,`
> `reuses the same two or three classes, and settles into the centered eye-level medium.`

Arrived **2026-07-29 (`2ede5f2`)** — after poyais, before bricks-fresh. It names "centered eye-level
medium" as a **symptom of decay**. Combined with §3.2, the author's model of quality is now
"eye-level = I got lazy".

### 3.5 `vpw-log-fresh.md` — the lesson and the worked precedent (the strongest live pressure)

Line 386–387, the file's own codified lesson #12:
> `A repeated CLASS is not the monotony risk; a repeated WORLD is. … Vary the world and the vantage`
> `per shot, not just the class.`

Line 337–338, the R-4 repair record the next fifth's author reads as a model:
> `Split across the dial and across scale: L29 expr-deadpan, medium … L31 keeps expr-delighted … but`
> `pushes in to a medium; L32 goes expr-greedy on a low wide angle from floor level (the boom).`

Also line 314: *"takes a new vantage (down on the floor at counter height)"*, presented as a fix.
`vpw-log-fresh.md` is an explicit input to every subsequent fifth (stated in the FIFTH-2 header), so
these are not archived notes — they are live instructions, and they say the quiet part out loud.
**Fifths 2–5 will reproduce the defect unless this file is corrected.**

### 3.6 `example-shots.md:19` + `visual-grammar.md:136` — the gold exemplar and the reveal recipe

- `example-shots.md:19` **Ideal shot:** `wide low-angle dock at dawn; …` — poyais's single vantage
  exception (L01) is the channel's canonical "ideal shot".
- `visual-grammar.md:136` — `a big reveal: spotlight / low angle / arrival` — offers low angle as one
  of three named reveal recipes. In bricks-fresh, **3 of the character reveals took it** (L32, L53, L56).

### 3.7 The structural hole underneath all six

`universal.md §13a-iii` line 1370 locks **camera MOVEMENT** ("Camera law — locked by default"). Nothing
anywhere locks **camera POSITION**. `style-bible.md` §5 says environments are *"built but flat … no
parallaxed realism"* but never states a house vantage. So the only sentences in the corpus that talk
about vantage at all are the ones warning against sameness. **A default that is never stated cannot
be defended; the flat look in poyais was an accident of not having a camera slot, not a law.** Making
it a law is the fix.

---

## 4. MINIMAL-CHANGE proposal — removal-first, ranked

Nine edits. Seven are deletions or word-swaps; two add a short positive law (needed because §3.7 shows
the default is currently unstated). No new sections, no new files, no code written here.

### Tier 1 — REMOVALS (do these first; they carry most of the effect)

**R1. `visual-kit/visual-grammar.md:197–198`** — stop exhibiting the framing clause.
Replace `A trailing "Framing: … Palette: …" after the payload is the commonest way to break it — put
those facts BEFORE the lettered element, not after.`
with `Any trailing scene-fact clause after the payload breaks it — state scene facts BEFORE the
lettered element, never after.`
*Reason: keeps the ordering law intact and deletes the template the corpus copied 202 times.*

**R2. `visual-kit/visual-grammar.md:203–204`** — delete `angle` from the authored-variable sentence
and delete the "deadly on repeat" stigma against eye-level.
Replace with: `Framing and scale are a choice driven by the one thing the viewer must see (the
payload) and the shot's class. The vantage is not a choice — it is the house eye-level frontal (§3a).`

**R3. `.claude/skills/visual-prompt-writer/SKILL.md:108`** — narrow the mandatory fact.
`framing + scale` → `subject scale and stage position (stage-left / centre / stage-right)`.
And `depth (fore/mid/background, filled edge-to-edge)` → `layered depth (fore/mid/background by
overlap and scale, filled edge-to-edge)` — this alone kills most of the 47-shot recession layer.

**R4. `.claude/skills/visual-prompt-writer/SKILL.md:139–140`** — remove the eye-level stigma.
`reuses the same two or three classes, and settles into the centered eye-level medium`
→ `reuses the same two or three classes, and reaches for the same nouns and the same staging`.
*The real decay symptom is a repeated WORLD (the log's own lesson #12 first half was correct); the
vantage half was the wrong cure.*

**R5. `visual-kit/visual-grammar.md:136`** — remove low angle from the reveal recipes.
`(a big reveal: spotlight / low angle / arrival; a minor one: a clean introduction)`
→ `(a big reveal: spotlight / scale / arrival into a held scene; a minor one: a clean introduction)`.

**R6. `channels/the-second-take/example-shots.md:19`** — re-word the gold exemplar.
`wide low-angle dock at dawn` → `wide eye-level dock at dawn`. The rendered poyais frame that shipped
does not read as a low angle; the exemplar's wording is more dramatic than the pixel it points at, and
it is the first framing phrase every author sees.

**R7. `videos/2026-07-28-bricks-fresh/scratchpad/vpw-log-fresh.md:386–387` and `:337–338` and `:314`** —
correct the live lessons. Lesson #12 → `Vary the WORLD per shot — the nouns, the set, the palette —
not the vantage; the vantage is fixed house eye-level.` Strike the R-4 record's
`on a low wide angle from floor level` and the line-314 `takes a new vantage (down on the floor at
counter height)` justification. *Without R7, fifths 2–5 re-author the same defect from the log.*

**R7b. `.claude/skills/visual-prompt-writer/scripts/test_round2_guards.py:160,164`** — change the two
fixture strings off `"Framing: wide static from floor level"` / `"Framing: low wide angle"` to
`"Framing: wide static eye-level"` / `"Framing: medium eye-level"`. Test fixtures are read as
exemplars; these two are the most concrete vantage examples in the whole repo. (Behaviour-neutral —
the assertions are about payload ordering, not the framing text.)

### Tier 2 — ADD the missing positive law (two edits)

**A1. `visual-kit/style-bible.md` §5, in the Environments bullet (line 138)** — add one sentence,
because the LOOK law is where a house vantage belongs and today it is silent:
> **Vantage is LOCKED: eye-level frontal.** The picture plane is parallel to the wall behind the
> subject. Depth is carried by overlap, vertical stacking and scale — never by a converging floor, a
> raised or lowered camera, or a tilted horizon. A flat plan graphic (a map, a chart, a document
> filling the frame) is a drawn artifact in the picture plane, not an overhead camera, and is exempt.

**A2. `visual-kit/visual-grammar.md` §3, new first paragraph (a "§3a" of ~6 lines)** — the operational
whitelist the author writes against:

> **Legal framing vocabulary (the whole list).**
> Distance: `close` · `medium` · `medium-wide` · `wide`.
> Position: `subject stage-left` · `stage-right` · `centre` · `foreground-left/right`.
> Vantage: `eye-level frontal` — and nothing else. `straight-on` and `head-on` are synonyms and legal.
> A shot may state one shallow oblique on a single surface (a counter edge, a table edge) and no more.
>
> **Banned vantages (HARD):** high corner · low corner · high angle · low angle · overhead / bird's-eye
> / top-down camera · floor-level or foot-of-the-object look-up · from-above / from-below · dutch or
> tilted horizon · one-point / two-point perspective view · forced depth (`receding`, `converging`,
> `stepping away`, `falling away`, `vanishing point`, `running back deep`).
> **Not banned:** a flat plan-view MAP or CHART filling the frame (it is a drawn artifact, not a camera
> position); `overhead lights/tubes` and other diegetic nouns that merely contain a banned word.

### Ranking rationale

R1 + R3 remove the *slot*; R2 + R4 + R5 + R6 + R7 remove the *encouragement*; A1 + A2 supply the
*default* so the next author has something to write instead of inventing one. If only three edits can
be made: **R1, R3, R7** (the template, the checklist item, and the live log the next fifth reads).

---

## 5. The smallest lint check — flag-only spec (no code written)

**Name:** `vantage_check(label, prompts, hard)`
**Slot:** `lint_shots.py`, immediately after `render_technique_check` (~line 1420). It takes the exact
same `prompts` shape `[(id, field, text)]` that `render_technique_check` and `text_supply_check`
already use, so it slots into `main()` on the same line and automatically covers `still_prompt`,
`global_prompt_suffix`, the thumbnail `gen_prompt`, and each short's `first_frame`. One new module-level
regex + one ~15-line function; nothing else in the file changes.

**Severity:** HARD (append to `hard`), matching `render_technique_check` — this is a LOOK law like the
banned render terms, not a taste heads-up.

### Pattern list — `_BANNED_VANTAGE`

```
low[- ]angle | low wide angle | high[- ]angle | high wide
from floor level | at floor level | from floor height | floor[- ]level | at ground level
medium[- ]low | medium[- ]high
looking up | looking down | look(?:s|ing)? up (?:at|the) | gazing down
from above | from below | seen from above | seen from below
overhead (?:shot|view|vantage|camera|angle)
bird'?s[- ]eye | worm'?s[- ]eye | aerial (?:view|shot)
top[- ]down (?:shot|view|camera|vantage)      # NOT bare "top-down"
one[- ]point (?:view|perspective) | two[- ]point (?:view|perspective)
dutch (?:angle|tilt) | tilted horizon | canted
(?:high|low) (?:corner|vantage) | from the corner of the room
from over the | from the stair landing | from the mezzanine | from the rafters | from the ceiling
receding | converging | stepping away | falling away | vanishing point | running back deep
foreshorten\w* | square to camera | close to camera | near to camera
```

### Required exemptions (each one is a real false positive already present in the corpus)

1. **`without looking up` / `never looking up` / `did not look up`** — L123 in the current file is
   exactly this: a crowd's *action*, not a camera. Exempt any match preceded within 12 chars by
   `without` / `never` / `not`.
2. **Diegetic nouns containing a banned word** — `overhead tubes`, `overhead lights`, `overhead
   lamp`, `overhead crane`, `a yard crane`, `a garden rake` / `raked heap` (L20, L113, L114 today).
   Require `overhead` to be followed by `shot|view|vantage|camera|angle` to fire; never match bare
   `crane` or `rake*`.
3. **Flat plan graphics** — bare `top-down` on a `map-plan-view` shot_class, and any prompt whose
   subject sentence is a map/chart/document filling the frame. Simplest mechanical form: skip the
   `top-down` / `plan view` patterns entirely when `shot_class == "map-plan-view"`.
4. **`depth`** is NOT in the pattern list — the style bible legitimately requires a fore/mid/background
   depth read; only the *recession verbs* are banned.

### Message shape (mirroring the C-2 message)

> `[{label}] {pid}.{field}: banned vantage term {match!r} — the house vantage is LOCKED eye-level frontal
> (style-bible §5). Depth comes from overlap, stacking and scale, never a raised/lowered camera or a
> converging floor. A diegetic noun (overhead lights, a yard crane) is never this — only the camera-
> POSITION word is banned.`

### Expected result on today's file

**28 shots fire; 1 is a false positive (L123) that exemption #1 removes → 27 true fires.** The
forced-depth half additionally fires on ~20 more shots beyond the 27; recommend landing the vantage
patterns HARD first and the recession verbs as a second, SOFT wave so the repair is one bounded pass.

---

## 6. Shots that fail the proposed lint, with a repair route

### Tier A — off-eye-level vantage (17 shots). Every one is a single-clause rewrite.

| id | offending clause | one-line repair route |
| --- | --- | --- |
| L03 | `wide static from floor level, the lamp pool close to camera` | `wide static eye-level from the doorway, the lamp pool centre-near`; keep the dark falling-off as a palette fall, not a spatial one |
| L16 | `low wide angle straight down the shelf's length` | `wide eye-level broadside to the shelf` — the shelf face parallel to frame, drives ranked across it (this is the L11 lakeshore-frieze shape) |
| L22 | `wide static from floor level, the lit pallets filling the lower two-thirds` | drop `from floor level`; `wide static eye-level` — the lower-two-thirds fill already does the work |
| L32 | `low wide angle from floor level, him large stage-right against the overhead tubes` | `wide eye-level, him large stage-right`; the boom reads from his SCALE against the small deep floor, which is already authored (poyais L01's actual mechanism) |
| L34 | `high, looking down into the open case from over the bench` | `medium eye-level broadside to the open case at bench height, its front bay square-on` |
| L53 | `low wide angle from floor level, him large stage-right` | `medium-wide eye-level, him large stage-right` — reveal sized by scale + spotlight, per R5 |
| L56 | `low angle from the foot of the bench, him large stage-left` | `medium-wide eye-level, him large stage-left`, bench edge as one shallow oblique |
| L70 | `wide from the foot of the flight looking up its length, the steps rising and receding stage-right` | restage as a **side elevation of the staircase** — steps as a flat rising diagonal across the picture plane (the L57 ship-elevation shape); no look-up, no recession |
| L83 | `low wide angle straight down the shelf run … the bays receding stage-left` | `wide eye-level broadside to the shelf run, the ledger near stage-right, bays ranked stage-left` |
| L122 | `medium-low from floor level, the open ledger near and stage-right` | `medium eye-level at desk height, the ledger stage-right` |
| L125 | `low wide angle looking up the face of the stacked block, the raised pallet high and central` | `wide eye-level broadside to the stacked block, the raised pallet high in frame` — height in FRAME, not height by camera (the idiom-pun still lands) |
| L135 | `low wide angle from floor height, the table edge across the upper third` and body `seen from the side at floor level so the whole underside stands open to camera` | this shot's whole idea is "see under the table". Repair = **side elevation** — cut the table in section at eye-level so the underside is visible as a flat compartment, not a floor-cam look-up |
| L137 | `medium-wide from floor level, the pallet and ledger near stage-right with the run receding stage-left` | `medium-wide eye-level, pallet + ledger stage-right, the run ranked stage-left` |
| L138 | body `wide static from floor level`; framing `one-point view down the narrow aisle, the ranks filling both sides up to the roof` | **restage the aisle as a wall**: `wide eye-level broadside to a solid rank of wrapped pallets filling the frame`. The "endless" read comes from edge-to-edge fill, not from convergence |
| L153 | `high wide from the stair landing looking down over the back third of the floor` | `wide eye-level from the floor's near end`; the "one low course vs the bare rest" contrast is a left/right or near/far *arrangement*, not a top-down one |
| L217 | `wide static from floor level looking up the length of the room, him small and low with the bench towering over him` | `wide eye-level, him small and low stage-centre with the bench large and high in frame` — the imbalance is SCALE, which is exactly what poyais L01 did |
| L248 | `wide static at floor level straight down the aisle, the lit near pallet large stage-right` | `wide eye-level broadside to the wrapped ranks, the lit near pallet large stage-right, the rest falling into dark` |

### Tier B — one-point recession views (10 shots)

These are eye-level and centred, so they are *closer* to legal than Tier A — but poyais contains none
of them, and 10 corridor-recession shots is the second half of the look Daniel is reacting to.
**Recommendation: ban them too (they are in the A2 banned list above), with one shared repair route.**

| id | clause | shared repair route |
| --- | --- | --- |
| L37, L52, L88, L107, L138\*, L140, L141, L145 | `wide one-point view straight down the aisle/rows` | → `wide eye-level broadside to the rank` (the camera stands at the aisle's side, not its mouth); the endlessness reads from edge-to-edge fill and cropped frame edges |
| L71, L77, L109 | `wide one-point view straight down the table from its near end` | → `wide eye-level broadside to the table`, seated rows ranked left-to-right across the frame (the L54 ship-deck shape: stacked upward = further back) |

\*L138 is counted once, in Tier A.

**Totals: 27 shots need a scoped repair — 17 Tier A (mandatory), 10 Tier B (recommended).** All 27 are
`still_prompt` framing-clause rewrites; none requires a re-plan, a stage change, a cast change, or a
new asset. 23 of the 27 are a straight word-swap; **four are genuine restages** — **L70** (staircase),
**L125** (stacked block), **L135** (under-table), **L138** (aisle wall).

---

## 7. Genuinely ambiguous — for the boss to rule

1. **Are Tier-B one-point aisle views in or out?** Daniel said "there can be perspective, but not high
   corner, low corner". A centred one-point aisle is perspective without a corner vantage, so it is
   arguably legal by his words — but poyais has zero of them, and they are 10 of the 27. This
   proposal bans them; a "cap at N per video" rule is the alternative.
2. **The 47-shot forced-depth layer** (`receding` / `converging` / `stepping away`). Banning these
   verbs is a much wider blast radius than the 27 vantage shots and pulls against `style-bible.md` §5's
   own `fore/mid/background depth read`. Proposed here as a SOFT second wave, not a HARD gate.
3. **Whether L01's `wide low-angle` gold exemplar (R6) should be re-worded or re-shot.** The shipped
   pixel is not low-angle; changing the wording makes the doc match the artifact, but it also edits
   the channel's canonical ideal-shot text, which is a taste call, not a lint call.
