# Adversarial full-file review — bricks-fresh `shots.json`, all 248 shots

**Artifact:** `videos/2026-07-28-bricks-fresh/shots.json` — `long_form.shots` L01–L248, Σ declared 541.29 s
**Read:** VPW `SKILL.md` (incl. Step-8 critic charter, `references/critics.md`, verbatim) · `references/shots-schema.md` ·
`visual-grammar.md` · `style-bible.md` · `registry/registry.json` · `script.md` · `scratchpad/vpw-fresh-skeleton.md` ·
`vpw-log-fresh.md` · `critic-R14-fresh-fifth.md` · the five `vpw-*-report.md`s · `audit-drift-2026-08-04.md` ·
`assets/voiceover.manifest.json` (real forced-alignment word timings)
**Method:** whole-file read + the Step-8 critic charter run over all 248 (it had only ever run on L01–L47) + machine
sweeps (banned terms, badge prose, place law, seed-cap arithmetic, chain integrity, payload ordering, duplicate
composition, figureless runs) + independent cadence recomputation off the VO manifest + ≥10 spot-checks of claims made
in the fifth reports.
**Date:** 2026-08-05 · fresh context, no share in the authoring run
**Worktree:** `C:/Users/danie/kb-worktrees/boss-bricks-reset` (detached at `89c720e`) · read-only, nothing committed

*(Sections are written incrementally as the pass proceeds; the final counts are at the bottom.)*

---

## 0. What the machine checks say (baseline, all verified independently)

| Check | Result |
| --- | --- |
| `lint_shots.py` (no `--write`) | **HARD violations: none.** 14 heads-ups (1 real-hold, 5 delta-length, 8 seat/support forced-review rows) |
| Lint-banned render-technique terms | **0 hits** across all 248 prompts |
| Crowd-rig §2d boilerplate in prompts | **0 hits** |
| Negation-list absence ("no X, no Y") | **0 hits** |
| Entrance-on-a-delta | **0 violations** |
| Seat/support primitive law | **8/8 `sit` shots name a support + contact** (mechanism-3 fix holds) |
| Stage chains: one base first, ≤3 deltas, contiguous | **0 violations** across 95 declared stages |
| Backticked tokens unresolved | **0** beyond the 5 planned mintable cast (`qt-wiles`, `brick-foreman`, `auditor-rep`, `hq-banker`, `rifenburgh-ceo`) |
| Σ `duration_s` vs VO runtime | 541.29 s vs 540.08 s — **within 1.2 s** |
| REAL holds off the manifest (my own recomputation) | n=247, mean **2.17 s**, min 1.44 s, max **3.00 s** — **0 over the 3 s band**, **1 under the 1.5 s floor (L74, 1.44 s)** |
| declared vs REAL divergence | max **0.60 s** (L47); 244 of 247 within ±0.05 s |
| Figure bias | **77 % of runtime peopled**, 191/248 shots; longest figureless run **10.7 s (L12–L16, declared+earned)** |
| Class variety | 14 classes used; literal share **13 %**; `ironic-counterpoint` (39) is the commonest — the signature move, correctly on top |

**Cadence, seat/support, entrance law, chain mechanics, banned terms and figure bias are genuinely clean.** The five
audit-drift mechanisms that killed the previous run do **not** recur mechanically. What follows are the defects those
checks cannot see.

---

## CONFIRMED DEFECTS

Ranked most-damaging first. Repair route is one of: **scoped-repair** (re-author that shot from its own
`vo_ref`'d VO line, per SKILL's SCOPED-REPAIR mode) · **doctrine fix** (the rule belongs in a named
file+clause, not in the shot) · **Pass-1 prerequisite** (image-generation's human gate, no VPW edit).

---

### BLOCKING — fix before any generation token is spent

#### B-1 · `L29` `L32` `L65` · badge prose on a DE-BADGED canonical (goal 6)

Exact defective text, all three:

- `L29`: "…facing the camera and unobstructed, **the drive-shaped badge at his lapel catching the light** and the broad plank board carrying 'MINISCRIBE'…"
- `L32`: "…stands mid-aisle facing the camera and unobstructed, **the drive-shaped badge at his lapel catching the light**."
- `L65`: "…the company man stands a pace off stage-right with his shoulders drawn in, **the drive-shaped badge at his lapel catching the tube light**."

`miniscribe-rep`'s canonical and registry costume were de-badged at commit `240aed7`
("chest and lapels plain — no badge, pin, or logo"). Every fifth-4/5 appearance of the character authors
that state explicitly and correctly — `L163`, `L168`, `L183`, `L244` all read "his chest and lapels
plain". The three shots above are stale fifth-1/fifth-2 prose instructing the generator to draw an object
the canonical no longer contains: prose fighting the seed, the exact class the two-voice audit (§9) named.

`L65` was **not** on the caller's known list. It is a third instance and its phrasing is a copy of
`L29`/`L32`.

**Repair route:** scoped-repair `L29`, `L32`, `L65` from their own VO lines. Replace the badge clause with
the de-badge clause fifths 4–5 already use. Do **not** substitute the string in bulk across the three —
SKILL's process law bans exactly that; each is re-derived, and `L29` additionally has to keep its
`'MINISCRIBE'` L-1 carry intact.

**Environment hazard for the repair worker:** the worktree `boss-bricks-reset` sits at `89c720e`, which
**predates** `240aed7`. Its `visual-kit/registry/registry.json` still reads *"ONE small steel-grey
drive-shaped enamel badge pinned at the left lapel (its single identity tag)"*. A worker reading costume
from that worktree will re-introduce the badge. Repair from the main checkout, or rebase the worktree first.

#### B-2 · `L66` → `L69` · the quota-ratchet is drawn going DOWN (goals 2, 7)

`L66` ("He set sales targets. Hit them,"): *"The board's field stands blank and unlettered but for one
horizontal rule struck **high** across it in red."*
`L69` ("And when you hit them, he raised them,"): *"The board now carries two horizontal rules: the
earlier one struck across it in charcoal at **mid height**, and a second ruled a hand's width above it in
red."*

The beat's entire payload is that the line went UP. As written, the viewer sees a red rule near the top of
the board, then three cuts later sees the red rule sitting just above **mid** height — visibly lower than
where it was. Nothing rescues it in pixels: `L66` and `L69` are two separate stage bases (`target-line`,
`target-raised`) whose only shared seed is the `wiles-office` plate `L63`, which contains **no board at
all**, so each frame invents the board fresh and the "same board, three cuts later" reading `L69`'s note
depends on is prose-only. `L69`'s note states the mechanism it needs and then contradicts it.

**Repair route:** scoped-repair **`L66`** (one shot) — author its single red rule **low on the board**, so
`L69`'s "a hand's width above it" lands legibly higher. Repairing `L69` instead does not work: its
two-rule state is what makes the ratchet readable at all.

#### B-3 · `L153`–`L156` · the escalation chain is a re-run of the pallet-build chain (goal 4)

`L117` framing: *"Framing: medium-wide at trestle height, the open cartons running away stage-right through the lamp pool."*
`L153` framing: *"Framing: medium-wide at trestle height, the open cartons running away stage-right through the lamp pool."* — **byte-identical.**

And so is the world around it: both are the rented warehouse under its work lamp, roller door shut at the
rear, empty shelving down the right wall, a long packing trestle across the lit floor, a row of open brown
cartons ranked along it, a crowd of packers working the far side of the trestle. Content-word Jaccard
**0.61 — the highest long-range similarity in the file.** `L117`/`L118` is "they put the bricks in boxes";
`L153`–`L156` is the junk-padding escalation, a **4-shot / 7.6 s** chain, and it is staged as the same
image. The beat must read as *growth past the bricks*; as written the audience cannot tell it apart from
the original packing line except by the objects going into the cartons.

**Repair route:** scoped-repair **`L153`** into a different vantage and world inside `brick-warehouse`
(the rear-wall stacking face the chain's own last delta already reserves, the scrap source, or a high
vantage over the floor), then carry that new base's facts through `L154`/`L155`/`L156`'s held
restatements. Basing on the rear wall costs nothing — `L156`'s delta reserves it anyway.

---

### HIGH

#### H-1 · `L33` · two incompatible stagings inside a `handshake` two-shot (goal 2)

*"**Between and behind them** a loaded pallet of flat cartons waits at the door's lip"* — on the file's
first `interaction`-template shot (`ibm-suit` + `terry-johnson` in `handshake`). "Between" and "behind"
are different stagings, and a pallet actually between two clasping figures destroys the contact geometry
the template exists to protect. Flagged by R14 (N-9) on the previous pass and **not repaired**.

**Repair route:** scoped-repair `L33` — pick one ("behind them"). Seed-cap is clean here (2 cast +
`handshake` + plate = 4, no displacement), so nothing else moves.

#### H-2 · `L44` · a prop staged into the pose the seed already occupies (goal 2)

*"`ibm-suit`, `expr-deadpan`, `action-armscrossed`, stands planted … **a shut order book tucked under one
arm** and his back to the building."* `action-armscrossed` is a folded-arms reference card; a book under
one arm competes with the geometry the seed carries, and the grammar's rule is that a named asset IS the
authoring act and prose must not fight it. R14 (N-11) flagged this; **not repaired**.

**Repair route:** scoped-repair `L44` — put the order book on the stranded pallet or the apron (it reads
better there anyway: the thing he is walking away from), or drop `action-armscrossed` for a pose that
holds a book.

#### H-3 · `L87` and `L090` · a place-exempt class breaks the place seed mid-run (goals 4, 5)

Both shots sit **inside a contiguous `miniscribe-plant` run** and declare no `place`, because their
`shot_class` is on the exempt list:

- `L87` (`number-glued-to-object`) — *"The bare upper half of a storage shelf bay…"*, between `L86` and `L88`, both `place: miniscribe-plant`.
- `L090` (`physicalized-imbalance`) — *"A storage bay in the plant's stores seen straight on…"*, between `L089` and `L091`, both `place: miniscribe-plant`.

So the discovery sequence `L86 → L87 → L88 → L089 → L090 → L091` runs plate-seeded, **root**,
plate-seeded, plate-seeded, **root**, plate-seeded. The two roots re-invent the shelf bay the beat depends
on being the *same* bay — and `L87`'s whole payload is a card wired to *"the shelf's front edge at the
level where the stack stops"*, which only means anything against the bay `L88` then shows.

The schema names the fix and the author used it deliberately elsewhere — `L114`'s note: *"Authored in a
non-exempt class deliberately so the beat keeps its SET"*; `L128`'s: *"Authored in a non-exempt class on
purpose so the beat keeps its `place`"*. It was simply not applied at `L87`/`L090`.

**Repair route:** scoped-repair both — re-class `L87` as `literal` and `L090` as `ironic-counterpoint` (or
`literal`), declare `place: miniscribe-plant`, and record the swap in `notes` exactly as `L114`/`L128` do.
No prose rewrite is required beyond the class/place fields plus the note.

#### H-4 · `L158` · a named lead stands in for a tier the script separates (goal 5)

VO: *"One of **the executives** even brought his own family in at night to help pack the boxes."*
Shot: `brick-foreman`, the character the plan defines as *"the middle-manager lead who packs the bricks"*,
introduced by the script as one of *"a room full of **middle managers** in Colorado"*.

The script draws a tier line between middle managers and executives and this beat is on the far side of
it. The shot's own note concedes the lint pass is a token coincidence: *"this shot's own span says
'executives', a generic plural, and the named lead is justified only because the adjacent span (L157) says
'bricks' — the slug token."* That is `audit-drift §E7`'s mechanism (a named lead covering a generic
narrated role) surviving where lint cannot see it. Elsewhere in the same fifth the author gets this
exactly right — `L187`, `L202`, `L214`, `L215`, `L239` all refuse a named lead on a generic plural and say
so in `notes`.

**Repair route:** scoped-repair `L158`/`L159` as mass action with `figures.crowd` only (per `visual-grammar
§2`: an anonymous foreground individual does not exist, so the beat becomes mass action) — the family
arriving through the doorway carries the gag without asserting which employee it was. Keeping the foreman
for cast economy is a legitimate **reject-with-a-reason**, but it must be recorded, because the shot
currently argues the opposite in its own note.

---

### MEDIUM

#### M-1 · vantage reflex inside the two big places (goal 4)

Measured across every `Framing:` clause, grouped by `place`:

| Place | Repeated vantage | Shots |
| --- | --- | --- |
| `brick-warehouse` (39 shots, 21 runs) | "wide static from floor level" | `L03` `L22` `L120` `L128` (+ `L137` "medium-wide from floor level", `L122` "medium-low from floor level", `L248` "wide static at floor level") |
| `brick-warehouse` | "wide static from inside the floor looking out through the open door" | `L127` `L133` |
| `brick-warehouse` | "medium-wide at chest height up the aisle" | `L164` `L178` |
| `brick-warehouse` | "wide static at chest height straight down the aisle" | `L161` `L203` |
| `miniscribe-plant` (44 shots, 21 runs) | "medium at chest height" | `L091` `L098` `L165` `L168` `L169` |
| `miniscribe-plant` | "wide one-point view straight down the aisle" | `L52` `L88` `L107` |

The `L127`/`L133` pair is a deliberate and effective rhyme (pallets out, pallets back — the round trip is
the point) and should be left alone. The rest are reflex: the warehouse's establishing vantage is
"floor-level wide static" **seven times** across the video, and the plant's is "one-point down the aisle"
three times plus "medium at chest height" five times. This is the monotony the caller's goal 4 names, and
it is concentrated exactly where the goal predicted — the two places with 20+ revisit runs each.

**Repair route:** scoped-repair a subset — pick 2 of the 4 floor-level warehouse wides (`L120`, `L128` are
the least load-bearing; `L03` is the plate and `L248` is the deliberate closing bookend, both keep it) and
2 of the 5 plant chest-height mediums (`L098`, `L168`), and re-derive their composition from their own
beats. This is taste, not law — flagged so the human can price it.

#### M-2 · payload-ordering: a fixed closing template from `L090` onward (goal 7, charter Q3 forced row)

**Forced row, all 248 shots.** Three shapes:

| Shape | Count | Verdict |
| --- | --- | --- |
| Delta | 46 | **46/46 clean** — every one closes on its one change + "everything else exactly as established" |
| Non-delta, carrying a quoted literal | 33 | **33/33 clean** — 30 close on their own literal's clause; `L29` `L190` `L242` close on palette while carrying `'MINISCRIBE'`/`'COLORADO BRICK'`, and are **correctly exempt** (an L-1 carried owner sign is not that shot's payload) |
| Non-delta, no lettering | 169 | **149 close on `Palette: …`** as a fixed template |

The lettered half — the half that broke 0/9 on 2026-08-04 — is now perfect. The unlettered half is where
the charter says to look, and the seam is sharp: of the 20 unlettered non-delta shots that close on their
**payload** rather than on palette, **every single one is in fifth 1 or fifth 2** (`L03` `L04` `L07` `L21`,
then `L48` `L49` `L52` `L53` `L54` `L55` `L56` `L59` `L61` `L62` `L63` `L64` `L67` `L68` `L75` `L77`).
From `L090` to `L248` the count is **0 of ~125**. Fifth 2's author was closing on the payload as a
practice (`L48`: "The door behind him stays down and nothing on the apron is waiting to go out."; `L52`:
"One long shadow is thrown in through the doorway and runs the whole length of the aisle toward camera…"),
and that practice did not cross the `L89`→`L90` seam.

Harmless where the payload is the whole frame (most of them). It costs the payload where the payload is
one small object inside a large frame — the shots worth repairing are `L108` (the column of pencil ticks),
`L128` (the empty cash drawer and bare invoice spike), `L166` (the one dusty unopened folder), `L193` (the
certificate propped against the film), `L243` (the sprung-trap that never went off), `L247` (the one open
empty locker).

**Repair route:** two parts. (a) **scoped-repair** the six named shots — move `Framing:`/`Palette:` ahead
of the payload clause, exactly as the lettered shots already do. (b) **doctrine fix** —
`visual-grammar.md §2` (ordering law) currently states the payload-last rule and lint enforces only its
lettering half; add one sentence making the **unlettered** payload explicit as an authoring requirement,
because 149/169 shots defaulting to one closing template is a template, not 149 decisions. `critics.md`
already carries the forced row; the grammar does not carry the rule it forces.

#### M-3 · scale-comparison device saturation, against the file's own stated discipline (goal 4)

`physicalized-imbalance` runs 12 shots, and the device vocabulary inside it repeats:

- **Two-pan beam balance:** `L147`/`L148` (box vs box), `L198` (derrick beam, verdict vs Belfort), `L232` (immunity exchange).
- **Two masses side by side on a counter/apron:** `L157` (bricks vs junk), `L186` (14 M vs the real number), `L240` (quarter-filled measure vs emptied one).

`L157`'s own note says: *"the beam-balance vocabulary belongs to L147/L148 and is deliberately **not
reused**"* — a discipline fifth 3 stated and fifth 5 then broke twice (`L198`, `L232`), and `L157`'s own
alternative (two masses side by side) was itself reused twice more (`L186`, `L240`). Six of the video's
twelve imbalance frames are two of one shape.

**Repair route:** scoped-repair **`L232`** (the immunity exchange — the least anchored of the three
balances; a swap can be staged as a handoff, a door held open, a name struck off a list) and **`L240`**
(the payout fraction — the class table's "countable mass" or a crowd-multiplication read both fit). Leave
`L147`/`L148` (the mechanism the whole fraud rests on), `L198`, `L157`, `L186`.

#### M-4 · `L126` and `L186` · "The same X" with no seeding mechanism (goal 7 — doctrine gap)

- `L126`: *"**The same green baize card table** under its one hard spotlight in the dark room…"* — callback to `L099`, 27 cuts earlier. `L099` and `L126` both declare **no `place`, no `stage`, no `place_anchor`**, and are separated by 26 shots. Their `Framing:` clauses are byte-identical, which is the tell that the author intends a held set.
- `L186`: *"**The same bare shop counter** in flat daylight."* — callback to `L184`, with `L185` between them. Same: no place, no stage, no anchor on either.

Forge gives these pairs nothing in common: both members are seedless roots, so "the same table" and "the
same counter" are prose against two independently generated images. This is precisely the mechanism
`audit-drift §E4` documented (*"'Same' in L89/L90 is prose without a continuity seed"*) — the version of it
that survived, because the action-chain lint fires only on **adjacent** shots sharing a **declared
`place`**, and these pairs are neither.

Note this is **not** an authoring mistake so much as a hole in the tooling: `place_anchor` requires both
shots to declare the same `place`, and a two-shot non-adjacent rhyme in an otherwise unnamed set has no
legal way to declare one without minting a place for a set the file visits twice.

**Repair route:** **doctrine fix** — `shots-schema.md §2` (`place` / `place_anchor` bullets) needs a
sanctioned shape for a *non-adjacent two-shot rhyme in an unnamed set*: either allow `place` on a
two-visit set with no plate obligation, or state plainly that a cross-cut "the same X" callback is not
supported and must be re-authored as a self-contained frame. Until that exists, the cheapest per-shot
mitigation is to make `L126` and `L186` **self-sufficient** — describe the table/counter fully rather than
relying on "the same", so that whatever the generator returns still reads as the joke.

#### M-5 · `L26` and `L130` · render-technique vocabulary in the prompt (goal 1)

`L26`: *"A flat wall map of the world **in plain block colours**, pinned at its corners and seen straight on."*
`L130`: *"A flat wall map of the Pacific **in plain block colours**, pinned at its corners and seen straight on…"*

"Block colours" is how the map is *drawn*, not what it *is* — the style bible's §2b descriptor owns that
and `forge.py` injects it on every gen. R14 flagged `L26` (N-10); it was not repaired, and fifth 3 then
copied the exact phrase into `L130` — evidence that stale prose in an early fifth propagates forward when a
later fifth reads the file for precedent. The author demonstrably knows the rule: `L30`'s note records
fixing "Chalked" for exactly this reason, and `L36`/`L39` record fixing "stencilled".

**Repair route:** scoped-repair both — state the map as depicted content ("its land masses flat olive, its
oceans pale blue"), which is a committed scene palette and legal, rather than as a drawing technique.

#### M-6 · `L185` authors an empty boardroom against a crowd-bearing plate (goal 2)

`miniscribe-boardroom`'s plate is `L71`, whose subject is *"A crowd of managers … seated along both far
sides"* of a full table with `figures.crowd: true`. `L185` then declares the same `place` and authors
*"the long table runs away behind him … and **the rest of the room empty of people**."* The plate is the
strongest image input every in-place shot receives, and here it contains the precise thing the shot needs
absent. This is the `L75`-class mechanism from the audit (§E3: prose-only state opposed by a stronger
parent image), transplanted from expression to occupancy.

**Repair route:** scoped-repair `L185` — either stage the beat outside the boardroom (it is Rifenburgh
reading the real number; a corridor, a desk, or the `L180` report table all work), or keep the room and
author the emptiness as a positive state of the furniture that a crowded plate cannot contradict ("every
chair along the table turned out and pushed back"), which is the device `L175` already uses successfully
in the same room.

---

### LOW

- **`L74` real hold 1.44 s, under the 1.5 s floor** (goal: real-timing cadence). The only band violation in
  247 measured holds, confirmed by my own recomputation off `voiceover.manifest.json` as well as by lint's
  heads-up. Its VO span is the two-word punchline "What a dick." — genuinely short.
  **Repair route:** scoped-repair by **merging** — drop `L74` and let `L73` (a 2.76 s delta on the firing
  tableau) carry the punchline, or re-anchor `L75` earlier. Do **not** lengthen a hold. Lowest priority
  finding in the file: 0.06 s under a soft floor on a deadpan cutaway.
- **Lettering/printing-technique adjectives on surfaces authored blank** (goal 1). "stiff **engraved**
  bond certificates … their ruled faces **blank and unlettered**" (`L192` `L193` `L218` `L219`, and
  `L228` "engraved share certificates"); "a plain **typed** sheet" (`L226`), "a stack of **typed** slips"
  (`L231`), "a folded **typed** statement" (`L232`); "freshly **printed** newspapers" (`L174`). Same class
  as the "Chalked"/"stencilled" defects the author fixed at `L30`/`L36`/`L39`: they name a text-production
  technique next to a surface the shot deliberately left unlettered, which both contradicts the LOCKED
  marker-capitals register and invites the generator to draw glyphs nobody authored.
  **Repair route:** scoped-repair the substrate, not the technique ("stiff bordered bond certificates", "a
  plain sheet", "a bundle of fresh newspapers"). Cheap, mechanical, 9 shots.
- **`L06` `shot_class: "literal"` on a non-literal depiction** (R14 N-12, unrepaired). The narration is an
  abstract property ("had only been invented a few years earlier") and the depiction is a sound
  non-literal stand-in (a fresh crate, a machine half-unwrapped). Label defect only — but it inflates the
  file's literal share and distorts the class self-audit. **Repair route:** scoped-repair the field to
  `symbolic-stand-in-object` (or `diegetic-device`). Note: re-classing to an exempt class would strip its
  `computer-shop` place, so `diegetic-device` is the safe pick.
- **`L11` / `L34` reflex bench composition** (R14 N-4, unrepaired). Both: a beige machine + a drive + hand
  tools + a work lamp, "Framing: medium at bench height", palette "beige, steel…, warm lamp amber". 23
  cuts apart, so not adjacency damage. **Repair route:** optional scoped-repair of `L34`'s framing.
- **`L46` / `L47` share a byte-identical palette line** ("Palette drained to grey-beige and cold steel")
  and the same set (R14 N-2, framing was differentiated but palette was not). Consecutive. Low.
- **`L164` states two heights for one object**: *"**High** on the bare block wall above the aisle, **at
  head height** over the pallet tops."* Resolvable but ambiguous in a closing clause. **Repair route:**
  scoped-repair — pick one referent.
- **Shot-id zero-padding is inconsistent**: `L01`–`L89`, then `L090`–`L099`, then `L100`–`L248`. No
  collision exists (there is no `L90`), so nothing breaks today — but forge/board tooling names staged
  frames `assets/scenes/<id>.png` from these strings, and any lexical sort interleaves them wrongly.
  **Repair route:** Pass-1 prerequisite / mechanical rename decision for the caller, not a VPW authoring
  fix. Note that renaming `L090`→`L90` would require touching 10 ids and any scratchpad referencing them.
- **Fifth 4 declares two-decimal durations** (`2.04`, `2.08`, `1.85`, `2.11`, `2.51`…) where every other
  fifth uses one. Cosmetic seam artifact; `duration_s` is an estimate and `render-builder` re-times off the
  VO anyway. No repair needed.

---

### THUMBNAIL BLOCK — 2 confirmed, 1 of them the file's second-worst defect

#### T-1 · challenger 1 · a real named person depicted as the perpetrator of a fraud he had left (HIGH — policy)

> `terry-johnson`, **`expr-caught`**, `hold-one-hand`, … holding one red clay brick up level with his
> shoulder where a drive should be … *(text_overlay: "Serial number included")*
> *composition:* "**the caught founder** on the right…"

`research.md` [F-27]: *"he took over from founder Terry Johnson (**departed late 1984**)."* The script says
so too: *"and Terry Johnson was out the door."* The brick scheme runs 1987–88. This candidate thumbnail
puts a **real, named** individual, caught red-handed, at the centre of a fraud the video's own sources
place after his departure — `visual-grammar §6` ("No defamatory depiction of a real named person — stage
the documented mechanism, never an invented humiliation") and SKILL Step 6 ("Illustrate the VO, never
extend it") both refuse it. It is also the highest-exposure frame the video will produce.

**Repair route:** scoped-repair challenger 1 — swap the hero to `miniscribe-rep` (the personified company,
which is what the channel's grammar is for) or `brick-foreman`, keeping the raised-brick framing and the
`expr-caught` register that makes the challenger genuinely different from the primary.

#### T-2 · primary · two red pointer devices plus a red subject (MEDIUM)

> "A drawn **red ring** circles the brick **and** a short **red arrow** points down into the open box from
> the upper right." — plus the subject itself is a **red clay brick**.

SKILL Step 4: "**The ONE red accent POINTS**". Three red elements compete, and at 168 px the ring and the
arrow will read as one red smear over a red object. R14 flagged this (N-13); **unrepaired**.

**Repair route:** scoped-repair the primary — keep the arrow (it points into the box, which is the reveal)
and drop the ring, or vice-versa. Challengers 1 and 2 each carry exactly one pointer and are correct.

*(Both challengers and the primary correctly set `synthetic: false` for the drawn register; overlay text is
≤3 words and not all-caps on all three; `auditor-rep` on challenger 2 is a Pass-1 mint, not a defect.)*

---

## THE FOUR FIFTH-BOUNDARY SEAMS

Checked for: broken/orphaned chains · place-visit continuity · tonal/world repetition at the joint · seed
lineage · duplicated composition either side.

| Seam | Chains | Place continuity | Seed lineage | Verdict |
| --- | --- | --- | --- | --- |
| **`L47`→`L48`** | `founder-exit` closed at `L47` (base, 0 deltas — legal); `L48` opens no chain | both `miniscribe-plant`; aisle → loading apron | both seed plate `L28` | **sound, one weakness** (below) |
| **`L89`→`L090`** | `hole-found` closed at `L89`; `L090` opens no chain | `L89` `miniscribe-plant` → `L090` **no place** | `L89` plate-seeded, **`L090` a root** | **weakest seam — carries 3 findings** |
| **`L148`→`L149`** | `same-weight` closed at its 1 delta; `L149` opens `quarter-again` | no place → `miniscribe-boardroom` | `L149` seeds plate `L71` | **clean** |
| **`L195`→`L196`** | no chain → `verdict-return` base | no place → **new place `jury-courtroom`, plate** | `L196` is the plate, cast-free, `owner_ambiguity` | **clean, the best of the four** |

**`L47`→`L48` — the one weakness.** Both sides are the same shot-shape one cut apart: a single named
personified figure, alone, medium-wide, in a drained-palette emptied plant (`L47` "Palette drained to
grey-beige and cold steel"; `L48` "Palette: cold concrete grey, drained beige, brown board, pale sky").
The act boundary is not marked by any world change. Compositions differ (`L47` stage-right in the doorway
with the aisle deep behind; `L48` stage-left and low with the shut door filling the upper two-thirds), so
this is a tonal repeat rather than a duplicate. **Non-blocking.**

**`L89`→`L090` — three separate findings land on this one joint:**

1. **H-3** — `L090` is the place-seed break (exempt class, no `place`, both neighbours `miniscribe-plant`).
2. **M-2** — the payload-last practice stops dead here: 20 of 20 unlettered non-delta shots that close on
   their payload are on the `L01`–`L89` side; **0 of ~125** are on the `L090`–`L248` side.
3. **The shot-id padding changes here** (`L89` → `L090`), which is how the seam is visible in the raw file.

Plus a **fourth, seam-specific monotony finding — M-7 (MEDIUM)**: the shortfall is drawn **five consecutive times in one
shelf bay** across this joint — `L86` (the count sheet held up against the bay), `L87` (the card at the
level where the stack stops), `L88` (the whole aisle bare to the pegboard), `L089` (the man in front of
the bare run), `L090` (a string line over the short stack). That is **12.4 s in one bay**, four of the
five frames making the identical point that the shelf is short. Fifth 2 closed on the hole and fifth 3
re-opened on it.

**Repair route for the seam-specific finding:** scoped-repair **`L090`** — it is already being repaired
for H-3, so re-derive it into a different world at the same time. Its beat is *"coming up short like that
meant somebody was getting fired"*, which is a consequence beat, not a fifth restatement of the shortfall;
the chopping-block/pay-window vocabulary act 2 built (`L67`, `L68`) is the register the line actually
wants.

---

## R14 CRITIC METHOD APPLIED TO FIFTHS 2–5 (whole-file self-audit table)

The R14 method (`scratchpad/critic-R14-fresh-fifth.md`) run over the four fifths it had never seen:

| Fifth | Shots | Σ dur | literal share | classes used | crowd shots | named-cast shots | "red" mentions / explicit "one red accent" |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 (`L01`–`L47`) | 47 | 103.3 s | 17 % | 13 | 22 | 8 | 9 / 5 |
| 2 (`L48`–`L89`) | 42 | 102.0 s | 5 % | 12 | 21 | 20 | 4 / 3 |
| 3 (`L090`–`L148`) | 59 | 129.4 s | 19 % | 12 | 33 | 15 | 11 / 5 |
| 4 (`L149`–`L195`) | 47 | 98.6 s | 13 % | 12 | 31 | 16 | 8 / 0 |
| 5 (`L196`–`L248`) | 53 | 108.0 s | 11 % | 12 | 34 | 16 | 6 / 0 |

- **Non-literal share 87 % whole-file** (literal 33/248), and every literal I read is a concrete physical
  object or action — the one place literal is correct. No class has become a reflex: 12–13 distinct
  classes in *every* fifth, `ironic-counterpoint` (39) correctly the commonest as the channel's signature
  move.
- **Red is not decorating.** 38 of 248 prompts contain the word "red" at all, and a large share of those
  are the red clay brick — the story's own material, correctly called out as material rather than accent
  in `L179` and `L241`'s notes. The explicit "one red accent" construction tapers to zero in fifths 4–5,
  which is the right direction, not drift.
- **Figure bias is strong and improves after fifth 1**: 191/248 shots and **77 % of runtime** carry a
  named figure or crowd. Longest figureless run in the whole file is still fifth 1's `L12`–`L16` at
  **10.7 s**, declared and earned in `L16`'s note. Next: `L188`–`L190` 6.6 s, `L26`–`L28` 6.4 s, `L147`–`L148`
  5.1 s. **No undeclared run over 10 s anywhere in fifths 2–5.**
- **Cadence**: see §0 — I recomputed every hold off the manifest myself rather than trusting the reports.
- **No unauthorable mechanism anywhere in fifths 2–5.** Every action beat is a held tableau: the forklift
  is "stopped", `L52`'s arrival is a shadow already inside the room, `L206`'s "threw it out" is the card
  lying where it landed, `L209`'s "evaporated" is a clean imprint in the dust. `L107` and `L165` and `L220`
  use `action-walk` on a three-quarter turn, which is a pose, not motion.

---

## SPOT CHECKS — claims I re-derived instead of trusting (16, incl. 3 cadence)

| # | Claim (source) | My check | Result |
| --- | --- | --- | --- |
| 1 | **Cadence** — reports/lint say the band holds | Recomputed all 247 holds from `voiceover.manifest.json` word timings with my own anchor matcher | **VERIFIED** — mean 2.17 s, min 1.44, max 3.00, 0 over band, 1 under floor (`L74`) |
| 2 | **Cadence** — Σ duration ≈ runtime | Summed `duration_s` vs `long_form_est_runtime_s` | **VERIFIED** — 541.29 s vs 540.08 s |
| 3 | **Cadence** — the 2026-08-04 failure was a +2.36 s declared-vs-real divergence | Computed per-shot divergence | **VERIFIED FIXED** — max 0.60 s (`L47`); 244/247 within ±0.05 s. The file was sized against the real manifest, not the header rate |
| 4 | R14: "payload ordering on lettered shots 10/10 clean" (fifth 1) | Extracted every real quoted literal across all 248 and re-ran the rule | **VERIFIED + EXTENDED** — 33/33 whole-file (30 close on their literal, 3 are exempt L-1 owner carries) |
| 5 | R14 **BLOCKING** B-1 (`L24` unwraps cartons its parent sealed) claimed repaired | Read `L22`/`L23`/`L24` | **VERIFIED REPAIRED** — `L22` now frees "the whole top row"; `L24` changes only flaps on it |
| 6 | R14 R-2 (`L19` staged in the retailer's room) | Read `L19` | **VERIFIED REPAIRED** — now "A drive maker's own shipping back-of-house, off its loading dock" |
| 7 | R14 R-3 (`L42` empty carton contradicts the mechanism) | Read `L42` | **VERIFIED REPAIRED** — brick now in the box, `'600 MILLION'` kept |
| 8 | R14 R-1 (money block = one image four times) | Read `L35` `L36` `L38` `L39` | **VERIFIED REPAIRED** — 4 distinct worlds (apron / bookkeeper's table / customer yard / bank hall) |
| 9 | R14 R-10 (`Chalked` at `L30`) | Read `L30` and its sibling `L26` | **HALF-REPAIRED** — `L30` fixed; `L26`'s "in plain block colours" (N-10) was not, and fifth 3 copied it to `L130` → **M-5** |
| 10 | R14 N-9 (`L33` pallet between the handshake) | Read `L33` | **NOT REPAIRED** → **H-1** |
| 11 | R14 N-11 (`L44` `action-armscrossed` + book under arm) | Read `L44` | **NOT REPAIRED** → **H-2** |
| 12 | R14 N-13 (thumbnail primary carries two red pointers) | Read the thumbnail block | **NOT REPAIRED** → **T-2** |
| 13 | Reports claim the seat/support mechanism (audit §E2) is closed | Extracted every `sit` binding and its sentence | **VERIFIED** — 8/8 name a support from the allowed list + a contact phrase in the same sentence |
| 14 | Reports claim seed-cap discipline | Recomputed cast+crowd+interaction+plate+lettering+prop for every non-delta shot | **VERIFIED** — **0 shots over `SEED_CAP` 4**; no displacement is ever needed, so no drop is ever recorded |
| 15 | Entrance-never-a-delta | Walked all 95 stages tracking each cast member's first appearance | **VERIFIED** — 0 violations |
| 16 | Place-owner forced choice / derived plates real | Derived each place's plate mechanically (first generated shot declaring it) and checked the forced choice, the field's exclusivity, and literal-in-prompt | **VERIFIED** — 8/8 places; both `place_owner` literals (`'MINISCRIBE'` `L28`, `'COLORADO BRICK'` `L113`) are script vocabulary and appear verbatim in their own plate's prompt |

---

## REFUTED CANDIDATES — do not churn on these

1. **`miniscribe-plant` L-1 carry looks catastrophic (4 of 43 later in-place shots re-quote `'MINISCRIBE'`) — it is correct.** L-1 binds only shots that **redraw** the sign. The board sits above the floor entrance; almost every plant shot is down the aisle, at a bench, in the stores, at the pay window or at the vehicle gate, where the board is legitimately out of frame. The four that do redraw it (`L29`, `L81`, `L190`, `L191`) all re-quote verbatim. `L233` deliberately authors the board **gone** ("a clean pale rectangle stands on the brickwork where it was") and records that in `notes`. Ownership is not invisible: audit failure #6 is closed.
2. **`computer-shop` declares a `place` for a single unbroken visit (`L05`–`L10`).** The schema calls that "pure waste" only where it forces a dedicated cast-free plate — and the conditional plate law does not qualify this place (it neither recurs nor declares `place_owner`). So no plate obligation attaches, lint is correctly silent, and the declaration buys a shared seed across six shots for free. Not a defect.
3. **`L33` is NOT over the seed cap.** A first-pass regex read "the door's lip" as a quoted literal. `L33` carries no literal, so its slate is 2 step-1 cards + `handshake` + plate = **exactly 4**. No displacement, no refusal. (Its real defect is H-1, the geometry.)
4. **Six shots initially flagged "lettered but not payload-last" are apostrophe false positives**; the three genuine ones (`L29`, `L190`, `L242`) carry L-1 owner signs, which the schema exempts by name.
5. **`miniscribe-boardroom` chose `owner_ambiguity` where the skeleton planned `place_owner: "MINISCRIBE"`.** That is a legitimately changed decision, not drift. The script establishes no branding in that room, and the schema is explicit that ambiguity is the honest default and that reaching for `place_owner` to look decisive *is* the fabrication the law exists to stop. The audit's fix #5 is satisfied by recording the decision, which the plate does. Same reasoning clears `wiles-office`, `denver-newsroom`, `jury-courtroom`, `brick-warehouse` and `computer-shop`. **All 6 ambiguity calls are script-earned; no signage is invented anywhere in the file.**
6. **"hand-inked marks, none of them legible at this distance" (`L80`, `L092`, `L118`) is not a lettering-technique defect.** It is the supplied-text law's resolution 3 executed correctly — the value is deliberately unauthored and the illegibility is stated as a property of the depicted thing (L-2 compliant). Contrast the genuine LOW cases, where "engraved"/"typed" sit beside a surface the shot authored *blank*, so the technique word has nothing to qualify.
7. **"plain rendered plaster" / "blank rendered walls" / "pale render grey" (`L70`, `L201`, `L209`)** — "render" is the building finish, not the render technique. Not banned-term hits.
8. **`L26`'s "three red arrows … the Pacific and the Atlantic" (R14 N-10, second half).** The clause resolves: "each ending on a small brown carton resting on a **different coast**" — three arrows, three coasts, two oceans crossed. Not a defect.
9. **The ~55 single-shot "stages" are not a lint-silencing hack.** Each is a positive continuity statement *and* seeds its `place` plate — strictly better than the audit-drift §E4 shape (three unlinked roots with no `place` at all). Every consecutive-action run I walked in acts 3–4 is either a real declared chain (`lockbox-swap` `L094`–`L096`, `pallet-build`, `wrap-line`, `handpicked`, `test-count`, `junk-padding`, `went-looking`, `slab-prop`, `share-counter`, `exhibits-table`, `defense-stand`, `prize-giving`, `gate-after`, `plant-cleared`) or genuinely discontinuous. **Audit failure #4 is closed.**
10. **`L152` casting `brick-foreman` for "management came up with better ways"** looks like H-4 and is not: the beat leads straight into the padding operation the file has established as this character's own work, and he is staged **with** the crowd of managers rather than instead of them. Legitimate lead.
11. **`L71` (the boardroom plate) carrying `figures.crowd: true`.** The plate law forbids **named cast**, not crowd, and every later beat in that room wants a populated table. Correct call. The one shot it fights is `L185` — that is M-6, a per-shot issue, not a plate defect.
12. **`L174` "The same newsroom…"** is not the `L126`/`L186` prose-rhyme defect: `L174` declares `place: denver-newsroom` and therefore seeds plate `L172`. Real seed, real continuity.
13. **`L136` (`map-plan-view`) names a warehouse without a `place`** — unlike H-3's cases it depicts *tokens on a plan field* ("one warehouse token drawn at the centre"), not the set. Correctly exempt, correctly seedless.
14. **The one-voice goal is met mechanically.** Zero lint-banned render-technique terms, zero §2d crowd-rig boilerplate, zero negation-list absences across 248 prompts; the `global_prompt_suffix` is the lettering clause and nothing else. The only style vocabulary that leaked is M-5's two instances.

---

## NOTES FOR THE CALLER — non-blocking, decision-needed

1. **`shorts: []` — the file contains zero shorts.** SKILL Step 5 requires a `first_frame` plus an ordered shot list for every short. If shorts are in scope for this video the plan is incomplete; if they are deliberately deferred, nothing is wrong. **Decision needed before the folder is called done.**
2. **Five cast names must be minted at image-generation's Pass-1 gate** before any token is spent: `qt-wiles`, `brick-foreman`, `auditor-rep`, `hq-banker`, `rifenburgh-ceo`. All five are in the skeleton's plan; the file invents no unplanned slug. Every other backticked token — poses, expressions, actions, interactions, props — resolves in `registry.json`. This is a **Pass-1 prerequisite**, not a defect.
3. **Two plates carry a third of the video.** `brick-warehouse` is 39 shots in 21 runs; `miniscribe-plant` is 44 in 21. Every one of those 83 frames seeds plate `L03` or `L28`. **Which candidate a human picks for those two plates is the single highest-leverage decision in the run** — higher-leverage than any shot repair in this document.
4. **Plate lighting will fight ~a third of its children.** Plate `L03` is night / one work lamp / dark room. Thirteen of its 39 shots are authored in flat grey or working daylight (`L111` `L128` `L133` `L137` `L138` `L141` `L145` `L161` `L164` `L178` `L193` `L203` `L230`). This is legal — lighting is a scene fact the shot may change — but it is worth watching in the first gen batch rather than pre-emptively repairing, because the fix depends on what the plate actually returns.
5. **Density is a cost decision, not a defect.** 248 shots against a 140-shot lint floor (+77 %), mean real hold 2.17 s. The cadence is genuinely inside the channel's 1.5–3 s dial and the file sums to the VO exactly — but it is also 248 scene generations. Confirm the cut feels right before pricing.
6. **The skeleton is stale relative to the file** and should be reconciled if any further authoring runs off it: it planned ~208 shots (the file has 248); its chain names `plant-thinning`, `restatement-desk` and `verdict-bench` were never used; and the `wiles-office` / `miniscribe-boardroom` owner decisions both landed on ambiguity rather than the planned literals.
7. **All three skeleton peaks are honoured**, which is worth stating because it is what a monotony sweep would otherwise hide: `L03` (the plate as the hook), `L136` (the mid-video re-arm — the closed shipping loop with the same pallet visibly on the circle twice), `L217` (the withheld peak — Wiles small on the courtroom floor with the bench and the jury box towering over him). `L217` is the strongest staging in the last fifth and nothing earlier spends it.
8. **The two-cast presence law is applied consistently and well.** All seven two-cast shots (`L33` `L65` `L86` `L143` `L205` `L212` `L244`) state plane, eye-line and relative head scale explicitly, and `L65`'s "`qt-wiles` dominant in the frame" resolves dominance through framing rather than anatomy — which is exactly the wording `audit-drift §D` asked for. **Audit failure #1 is closed at the authoring layer.**
9. **Every repair named in this document is $0 of generation.** Nothing has been generated from this file yet, so the entire fix set is text editing. BLOCKING + HIGH touches **14 shots + 1 thumbnail challenger**; adding MEDIUM brings it to **~29 shots + 2 thumbnail entries**.
10. **Two of the findings are doctrine, not artifact, and should be fixed in the named file rather than patched per-shot:** M-2(b) — `visual-grammar.md §2` states the payload-last ordering law but only its lettering half is enforced or written as a requirement, which is why 149 of 169 unlettered shots default to one closing template; and M-4 — `shots-schema.md §2` has no sanctioned shape for a non-adjacent two-shot "the same X" rhyme in an unnamed set, which is why `L099`/`L126` and `L184`/`L186` have no legal way to share a seed.

---

## VERDICT

**Not generation-ready as it stands; generation-ready after the 3 BLOCKING and 5 HIGH repairs (14 shots +
1 thumbnail challenger, all $0).** The MEDIUM set is quality-of-result and can be taken in the same pass
cheaply, since a worker is already re-opening the file.

This is a materially better file than its predecessor. All five mechanisms from `audit-drift-2026-08-04`
are closed at the authoring layer — seat/support (8/8), two-cast plane/scale (7/7), place ownership (8/8
forced choices, none invented), causal action chains (every consecutive-action run is a real chain), and
semantic cast (five shots in fifth 5 alone refuse a named lead on a generic plural and say so). Cadence,
seed-cap arithmetic, the entrance law, chain mechanics, banned terms and figure bias are all clean on
independent recomputation. The defects that remain are of a different and smaller class: **stale prose
that survived a canonical change (B-1), a geometry that inverts its own beat (B-2), and monotony —
which is exactly where the caller predicted it would be.**

