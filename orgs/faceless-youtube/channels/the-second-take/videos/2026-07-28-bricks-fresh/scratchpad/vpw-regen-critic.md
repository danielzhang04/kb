# Shot critic — fresh-eyes review of `shots.json` (2026-08-06 doctrine regen)

**Scope:** 246 long-form shots, 540.9s. Read against `visual-grammar.md`, `example-shots.md`,
`registry/registry.json`, `script.md`. Findings only — the author owns the prose.

**Headline:** this file fixes the defects it was regenerated to fix. Every pressure point in the
brief measures clean or near-clean (numbers in the plan-level block below). The findings are a short
tail: one shot that cannot generate as written, one two-figure geometry gap, two crowd-declaration
mismatches, and a handful of taste calls.

---

## MUST-FIX

### 1. L139 — bare `base` on a fresh stage base (Q3)

The seeded performer is named with an expression card and an action card but **no era-dress prose in
the sentence that names `base`**: "One seeded performer, `base`, `expr-thinking`,
`action-armscrossed`, standing tiny at the near end of the rented unit, dwarfed by a solid wall of
shrink-wrapped pallets…". It is the only non-delta `base` casting in all 246 shots with no costume.
`forge.py` refuses a bare-`base` slate by name, and the card key
`fig-base--<pose>--<expr>--<place>-<dress digest>` has nothing to digest — so the shot either fails
at gen or renders the base template's own clothing, which is the attribute-routing failure the law
exists to prevent.

Secondary on the same shot: it is classed `literal`, but its `notes` describe what the frame actually
does — "the question posed as a size relationship between one man and the fake stock" — which is
physicalized-imbalance.

**Fix direction:** dress the performer in this scene's own costume inside the sentence that names
`base` (the rented-unit grey work coat used at L118/L121/L151 would keep card reuse and cost nothing
extra), and re-derive the `shot_class` from the argument the frame makes.

### 2. L74 — two-figure plane/scale topology (Q6)

The only 2-seeded-figure shot in the file that does not state a relative-head-scale clause. It writes
"The two hold the same plane **down the table** at a matching eye line, with `qt-wiles` **dominant in
the frame**" — a plane and an eye-line are pinned, but scale is replaced by an assertion of dominance,
and "down the table" is a depth clause that will pull the fired performer toward background scale by
implication. This is the audit-drift §D/§E1 mechanism exactly: the clause is correctly written for the
*table* and still miniaturizes the second figure, because nothing pins his head against Wiles's. The
beat is the firing — if the performer shrinks, the shot becomes a man alone at a table.

**Fix direction:** pin the two heads' relative scale explicitly and say which figure is nearer camera,
or restage the firing across the table's *width* so one plane genuinely holds both bodies and
"dominant" comes from pose rather than from unstated depth.

### 3. L163 — full crowd staged, `figures` unset (Q3)

A **fresh stage base** that stages an entire applauding room — "banquet tables running away toward the
dais, **the crowd on its feet applauding between them**" — with no `"crowd": true` declaration, so
`forge.py` never seeds the crowd exemplar and the whole room renders off-rig standing next to a seeded
`miniscribe-rep`. Its immediate neighbour L162 declares the same room's crowd correctly, which is what
makes this read as an omission rather than a choice. This is the award beat — one of the video's two
biggest ironic payoffs — and the audience it is aimed at is the shot.

**Fix direction:** declare the crowd on this shot the way L162 and L165 declare the same room's.

### 4. L159 — crowd declared, no crowd staged; the mass enters on the delta (Q3, Q7)

The inverse defect. L159 declares `"crowd": true`, then stages nobody: "Beyond the bench the rented
unit is dark, the shutter closed, the wrapped pallets only outlines." The mass it was declared for —
the executive's family — actually arrives on the delta L160 ("a small family group **now works** the
far side of the bench"). So the base pays for a seed it never uses, and the delta introduces bodies
into a parent frame that has no pixels for them, which is the reason a figure's entrance is never a
delta.

**Fix direction:** either stage the family in L159 (already at the far bench, coats on) so L160's
delta is a change of *state* rather than an entrance, or drop the declaration from L159 and open the
family's arrival as its own stage base.

---

## SHOULD-FIX

### 5. L223 — undeclared human figures entering on a delta (Q3, Q4)

The delta opens a window onto "the packing line runs at full tilt **with figures bent over cartons**".
Those are human bodies, they enter on a delta, and the whole chain (L222 / L223 / L224) carries
`figures: null` — so they get neither the crowd rig nor a seed. They are also the entire load-bearing
content of the frame: this is the signature unmasking, and the thing that contradicts Wiles's words is
the one element the generator has been given least help with.

**Fix direction:** put the working line in the base (the window present but blank/curtained) and let
the delta open it, or declare and stage those bodies as crowd so the rig carries them.

### 6. L219 — the verdict chain closes on its weakest frame (Q7, Q1)

Three seconds — one of the longest holds in the file — spent on "two heavy banded document blocks now
stand side by side on the rail directly in front of him, squared up and waist high" to carry "of
securities fraud and insider trading". Two unlettered boxes do not read as two criminal counts; a
viewer sees two boxes. L218 has already delivered the conviction with twelve turned heads, so the
chain's last shot delivers *less* than its middle. The shot also silently flips
`expr-deadpan` → `expr-worried` while `changed_elements` declares only the blocks, so the frame makes
two changes and admits one.

**Fix direction:** let the chain close on the consequence the VO promises rather than on an inventory
of the counts, and declare whatever single change the reworked frame actually makes.

### 7. L108 + L109 — two shots drawing one sentence's verbs (Q2)

"Something an auditor could **walk up to**" → a man walking toward pallets. "**put his hands on**, and
tick off a list" → the same man, same aisle, touching the stack. Both classed `literal`, but the line
is a *hypothetical specification* of what a fraud needs, not a physical event that happened — the one
case the bar reserves literal for. Two consecutive frames each drawing one verb of the same sentence,
without leaving the aisle, is the shape the grammar calls a failure and reclassifies.

**Fix direction:** collapse the requirement into one frame that argues what "something you can put
your hands on" is *worth* to a fraud (the gap between what a ledger claims and what a hand can
verify), and let the second beat take the departure the grammar defaults to.

### 8. L136 — the under-table geometry is unpinned (Q1)

The frame is asked to show two things a single eye-level frontal shot cannot hold at once: "both
looking innocently at each other **over the cloth**" and "**Below the tabletop, in clear view at body
scale**, a fat unsealed envelope passes between their knees." A restaurant table with a cloth occludes
the knees from the house vantage; nothing states how the camera sees both. This is the file's funniest
staging idea and it is the one most likely to generate wrong.

**Fix direction:** pin the camera's relationship to the table — a side-on two-shot at a bare café table
with no cloth reaching the floor is the cheapest version — or move the exchange to a place one frame
holds.

### 9. L131 — the destination is lettered on the wrong side of the journey (Q1)

The action is departure: "a crane sling swings two wrapped pallets **out over the water toward a ship's
open hold**", with a US dock crowd watching the load go up. The lettering is "Painted large on the quay
wall behind them: **'SINGAPORE'**" — which makes the quay they are standing on the *arrival* port and
puts the loading crew in the wrong hemisphere.

**Fix direction:** move the destination onto the thing that travels — the ship's hull, or a stencilled
shipping mark on the wrapped pallets — and leave the departure quay unlettered.

### 10. L233 — the acquirer reads as a removal man (Q1, roles-read-at-a-glance)

"a rival drive maker called Maxtor" is signified by nothing but a colour swap: "in a **navy** work coat
and a **navy** cap", performing the same wheeling-a-pallet act the video's own MiniScribe packers have
performed six times in grey. §2 is explicit that a role the viewer must deduce is a staging failure,
and colour-against-remembered-colour is a deduction across four minutes.

**Fix direction:** give the buyer one unmistakable non-colour signifier, or stage the beat as an act of
*ownership* (taking possession of the floor) rather than one more removal.

### 11. L84–L86 — the longest figureless run lands on the story's turn (plan-level, figure bias)

6.5s across three consecutive frames — the plan's longest dead stretch — sitting exactly where the
audit arrives. L84 (audit-room plate) and L86 (warehouse plate) each earn their absence individually
under the plate law and say so in `notes`. The weak link is the middle: L85 renders "which means
**somebody counts** what your books say" — a line that names a person doing an act — as a chalkboard
diagram. Scheduling both plates plus a register shift back to back is what turns three defensible
choices into one flat stretch.

**Fix direction:** keep the plates and re-derive L85 with the body the line names, or move one plate
out of the run so the two absences are not adjacent.

---

## NOTE

### 12. `brick-co-seller` — the new cast name is JUSTIFIED (Q3, Q8)

**Verdict: keep it; the Pass-1 gate it triggers is earned.** Three uses — L115 (the purchase), L239
and L240 (the last-laugh payoff) — spanning about 4½ minutes and bookending the Colorado Brick arc.
The closing joke *is* recognition: the same face that sold the bricks, now standing on top of them
next to a new pickup. A seeded performer cannot deliver that — it mints no canonical, so the L115 and
L239 faces are not guaranteed to match across the gap, and that gap is the joke. No existing cast
member fits either: `miniscribe-rep` is on the buyer's side of the transaction, and demoting the
seller to crowd would delete the beat's only performer.

Two things for the gate:
- L239 authors a costume variation ("straw hat **pushed back**") against a canonical that does not
  exist yet. The pinned outfit is correctly stated once at L115; flag the L239 variation so Pass 1
  mints the canonical hat-on-square and treats the pushed-back hat as the shot's authored change.
- Registry accounting: `qt-wiles` (30 uses), `auditor-rep` (10) and `hq-banker` (6) are *also* absent
  from `registry/registry.json`, but all three already exist as minted entries in this video's own
  `assets/library/manifest.json`. So `brick-co-seller` is the **only genuinely new mint in the file**,
  and the prior run's `brick-foreman` is now unused and can be retired at the same gate.

### 13. L54 — the reveal's only reaction channel is left unauthored (Q3)

The boardroom mass gets a position but no attitude: "the seated figures on the far side of the table
**drop into that shadow**". L53 authored the same room "expectant and a little stiff"; L54 — the
antagonist's reveal, the mid-act peak — spends its 1.3s on the back light instead. Crowd prose is a
crowd's only expression channel, and this is the beat where the room's reaction is the story. One word
of attitude fixes it.

### 14. L22 / L52 / L220 — seeded figure with a pose but no `expr-` card

All three are deliberately faceless (back-to-viewer, black silhouette, walking away through a gate), so
nothing is lost on screen. Flagged only so Pass 1 knows the empty expression slot in the card key is
intentional rather than dropped.

### 15. L244–L245 — the counterfactual is marked only by a warmth reversal

"The assembly floor **as it never was**" is signalled inside the frame by nothing except being warm
where every earlier visit to this place was cold — a comparison the viewer has to make across four
minutes. It probably reads, because the VO says "If", and L246 immediately returns to the bricks. If it
feels ambiguous on the render, one unreal note in the frame is the cheap fix.

---

## Plan-level facts (reported whether or not flagged)

- **Longest figureless run: 6.5s (L84–L86, three shots)** — finding 11. Total figureless 73.6s of
  540.9s (13.6%) across 34 shots; no other run exceeds 5.8s. Against the reset's measured failure (29
  of 41 frames figureless in the prior first fifth), this is the strongest number in the file.
- **Place monotony: clean.** Largest single place is `rented-warehouse` at 39.9s / 7.4% of runtime;
  next is `miniscribe-floor` at 6.5%. Longest consecutive in-place run is 4 shots / 10.8s (`audit-room`
  L96–L99). Prior file: 34% in two interiors. Nothing to flag.
- **Stage grouping: sound.** 70 stages, every one a base plus ≤2 deltas; 8 recurring places revisited
  across acts with chains in each. Semantically these read as genuinely held sets, not as a place
  re-used because it was already established.
- **Cadence: sound.** 246 shots, mean 2.20s, range 0.9–4.0s, no run of 4+ identical durations. The six
  sub-1.5s snaps (L52, L126, L176, L188, L211, L212) all sit on one- or two-word lines; the single 4.0s
  hold (L186) is a number reveal. Nothing to flag.
- **Figure cap: clean.** No shot exceeds 2 seeded figures. No shot casts two `base` performers. Of 10
  two-figure shots, 9 state the full plane / eye-line / relative-head-scale trio (the tenth is L74).
- **Payload ordering (FORCED ROW): clean.** Every non-delta shot carrying a quoted literal closes on
  that literal's clause — L04, L36, L39, L50, L59, L114, L115, L131, L163, L184, L186, L199, L214. The
  one apparent exception is L29, where 'MINISCRIBE' is an L-1 place-sign under the stated exemption and
  the shot's real payload (the character reveal) leads the prompt in the identity zone, which is
  correct. On the non-lettered majority the payload is the prompt's subject and leads; the trailing
  "…palette, …light, foreground depth from a cropped X" sentence is a composition instruction the
  generator can safely read last. **No shot in the file buries a real payload behind boilerplate** —
  the 2026-08-04 fresh-fifth failure (9 of 9 non-delta text shots closing on palette) does not recur.
- **Disclosure order: clean, and deliberately worked.** Wiles is withheld across three frames (L51 the
  coat only, L52 a silhouette, L53 the room waiting) and revealed on the word "Wiles." at L54. The
  bricks stay in sealed cartons at L22–L23 and land on "red clay bricks" at L24. The HR punchline is
  never pre-shown.
- **Comedy/idiom beats: staged as performances.** All 24 `idiom-pun` shots put a body in the
  foreground doing the thing (L19 the rake, L45 the cliff lip, L70 the chopping block, L94 the carton
  flap, L113 the shopping trolley, L182 wading through paper, L197 every door). The prior file's
  measured defect — 19 of 26 idiom-puns demoting their performer to background crowd — does not recur
  anywhere I could find.
- **Crowd emotion: authored almost everywhere.** 62 crowd-bearing shots; all but L54 (finding 13) carry
  a beat-fit attitude in prose ("expectant and a little stiff", "faces flat and tired", "keen and
  conspiratorial", "the same carefully mild expression", "smiling faintly").
- **Literalism: within the bar.** 38 `literal` shots (15.4%), of which 7 are cast-free place plates and
  most of the rest are the scheme's genuinely physical mechanics (L118–L122, L145, L97–L98). The only
  word-drawing pair is L108/L109 (finding 7).

## Verdict

**MUST-FIX 4 · SHOULD-FIX 7 · NOTE 4 — ship-with-edits.**

**Three strongest:** **L222→L223→L224** (the defence-rail chain — the signature unmasking done three
ways inside one held frame: the claim as a pose, the contradiction as a window, the verdict as one red
brick; contingent on finding 5) · **L42** (the balance beam's left column falling away to a hollow
painted shell — the video's entire thesis in one delta, paid off again at L195) · **L172** (red clay
dust on the cuffs of the man holding his own pink slip — the whole causal chain of the story delivered
as one detail on a body already in frame).

**Three weakest:** **L139** (cannot generate as written; bare `base` plus a mis-derived class) ·
**L219** (the least legible payload in the file, on one of its longest holds) · **L109** (the flat half
of a two-shot sentence-drawing).

---

## Repair round (2026-08-06, SCOPED-REPAIR)

Each touched shot was re-authored fresh from its own `vo_ref`'d VO line against the current doctrine
(`visual-grammar.md`, `shots-schema.md`, `example-shots.md`); no bulk substitution was used, and the
cast list declared in `vpw-regen-log.md` was reused, not re-declared. **20 shots touched**
(L54, L74, L85, L108, L109, L131, L136, L139, L159, L160, L163, L164, L219, L220, L222, L223, L224,
L233, L234, L239); every other shot is byte-identical. **14 findings ADDRESSED, 1 REJECTED.**
Final lint: **0 HARD, 80 heads-ups** — the same heads-up count as the pre-repair baseline.

### MUST-FIX

1. **L139 — bare `base`** — ADDRESSED. Re-authored with the rented unit's own grey work coat written
   inside the sentence that names `base`, so the STEP-1 card keys on this scene's dress. Class
   re-derived to `ironic-counterpoint` (the argument is that the fake stock is indistinguishable at
   warehouse scale) rather than the critic's `physicalized-imbalance`, which is a place-exempt class
   and would have cost the shot its declared `rented-warehouse` place — the schema's own exempt-class
   escape, recorded in `notes` as the file does at L90/L91/L152.
2. **L74 — two-figure topology** — ADDRESSED. Restaged with both men on the near side of the table,
   on one plane at equal camera distance, heads at a single eye line and an equal relative head scale;
   `qt-wiles` now reads dominant through the reach of the accusation, not through unstated depth. The
   "down the table" depth clause that miniaturized the fired man is gone.
3. **L163 — crowd staged, `figures` unset** — ADDRESSED. `figures.crowd: true` declared and the
   applauding room re-staged into a positive rear zone (beyond the banquet tables, between them and
   the dais) with its attitude authored. Its delta **L164** carried the identical defect (crowd in
   prose, no declaration) and was declared too, so the held room keeps one rig across the chain.
4. **L159/L160 — crowd declared, no crowd staged** — ADDRESSED via the critic's first option. The
   family is now present in the L159 base, coats and scarves on, waiting in the dark by the shuttered
   bay, so the declared rig is used where it is paid for; L160's single change is their **move** to
   the far side of the bench and into the work, not an entrance into a parent frame with no pixels
   for them. `changed_elements` restated accordingly.

### SHOULD-FIX

5. **L223 — undeclared humans entering on a delta** — ADDRESSED with both halves of the critic's fix
   direction. **L222** now establishes the window in the wall behind him with its venetian blind down
   its full drop (a positive shut state), **L223**'s one change is the blind rolling up onto the
   working packing line, and the packers are declared `figures.crowd: true` on L223 **and** on L224 so
   the rig carries them for the rest of the chain. L222 also lost its pose prose ("both hands raised
   open at his shoulders") competing with the `surrender` seed.
6. **L219 — chain closes on its weakest frame** — ADDRESSED. The two unlettered document blocks are
   gone; the delta's one change is now `qt-wiles` going into `action-slump` at the counsel table — the
   consequence the VO promises, landing on the man rather than on an inventory of counts. The silent
   `expr-deadpan` → `expr-worried` flip is removed, so the frame makes exactly the one change it
   declares. Class re-derived to `reaction-shot`.
7. **L108 + L109 — two shots drawing one sentence's verbs** — ADDRESSED. L108 collapses the
   requirement into one frame that argues what sheer bulk is worth to an auditor (satisfied,
   `action-powerstance`, planted against a carton wall that fills the frame, clipboard sheet blank),
   re-classed `literal` → `ironic-counterpoint`. L109 takes the departure the grammar defaults to and
   becomes an `idiom-pun`: on a flat cream ground, a row of cartons spaced like the entries of a list,
   every one already ticked but the nearest. Neither frame draws its line's verb.
8. **L136 — unpinned under-table geometry** — ADDRESSED. Bare cafe table on a thin pedestal, no cloth
   and nothing beneath it, the pair staged side-on to the viewer, so the house eye-level frontal
   vantage genuinely holds both the innocent look over the tabletop and the envelope below it.
9. **L131 — destination on the wrong side of the journey** — ADDRESSED. The quay wall is now bare
   rendered concrete and the hull plates plain; `'SINGAPORE'` is stencilled across the film on the near
   pallet's face — the thing that travels — and still closes the prompt as its payload clause.
10. **L233 — the acquirer reads as a removal man** — ADDRESSED. Restaged as an act of possession: navy
    suit, white hard hat, rolled floor plan, planted `action-powerstance` dead centre on the stripped
    floor, arrived *inward* through the door every removal in the video has gone out of. Class
    re-derived `literal` → `personified-character`. **L234** (its delta) now restates him, so the
    delta makes only its one declared change instead of silently losing the figure.
11. **L84–L86 — longest figureless run on the story's turn** — ADDRESSED at the weak link. L85 is
    re-derived with the body its line names ("somebody counts"): a man at body scale between an
    outsize ledger and an outsize shelf bay, the cord running level between them. The plates either
    side are kept. The 6.5s run is broken into 2.6s and 1.8s, and the file's longest figureless run
    now sits elsewhere.

### NOTE

12. **`brick-co-seller`** — ADDRESSED by accepting the critic's verdict: the name **survives**, so no
    beats were restaged and `vpw-regen-log.md` needed no correction (the log-edit allowance was
    conditional on removal). The gate flag was added to L239's `notes`: mint the canonical from L115's
    pinned straw-hat-square-on outfit and read the pushed-back hat here as this shot's authored change.
13. **L54 — unauthored crowd reaction** — ADDRESSED. The boardroom mass now carries its attitude in
    prose (every head turned up to him, jaws tight, shoulders rigid, one water glass stopped halfway
    up), which is a crowd's only expression channel.
14. **L22 / L52 / L220 — pose with no `expr-` card** — ADDRESSED for L220 only: its `notes` now record
    that the faceless staging makes the empty `expr-` slot intentional. L22 and L52 were left
    byte-identical — REJECTED as churn: neither shot has a defect, the observation is addressed to the
    Pass-1 human, and touching two clean shots to restate what this section already records is the
    kind of edit the repair law exists to prevent.
15. **L244–L245 — counterfactual marked only by a warmth reversal** — REJECTED. The frame already
    carries three signals no earlier visit to this place has: paper chains on the trusses, party hats
    on the whole crowd, and every ceiling fitting lit. Adding a deliberately unreal note would fight
    the `aftermath-palette-turn` register the act's script note asks for, and the critic's own reading
    is that it probably lands. If it reads ambiguous on the render, that is a human eye-gate call with
    a one-clause fix still available.
