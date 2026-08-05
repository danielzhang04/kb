# Fix worker G4 — VPW SCOPED-REPAIR over the R14 critic's target list

Worktree `C:/Users/danie/kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`.
Nothing committed, nothing staged, no provider call, **$0**. The MAIN checkout was read exactly once,
read-only, as the forge `--kit` argument (the `Kit.root` limitation G1/G2 documented). The
archived/quarantined `shots.json` was never read. `forge.py` and both `SKILL.md` files were never
touched (worker G3 owns them this round).

Files written: `shots.json`, `scratchpad/vpw-log-fresh.md` (round-3 entry), and this report.

## Headline

| | before (G2's tip) | after |
| --- | --- | --- |
| long-form shots | 47 | **47** (none added, none removed) |
| Sum `duration_s` | 103.2 s | **103.3 s** (every value still the MEASURED hold) |
| lint HARD | 2 | **2** (both partial-coverage artifacts) |
| lint heads-up | 6 | **4** (L47 artifact + 3 real-timing delta-vs-base artifacts) |
| real holds outside 1.5–3 s | 0 of 46 | **0 of 46** |
| base/delta hold inversions | 3 chains | **0 chains** (0.06 s residual on one, timing-bound) |
| forge whole-file dry-run | 0 refusals | **0 refusals**, 8/8 `fig-*` GENERATE, none REUSED |
| shots touched | — | 25 (20 critic-named, 5 forced neighbours) |
| thumbnail block | — | **byte-identical** |

---

## Per target

### BLOCKING · B-1 · L24 — the delta unwrapped cartons its parent sealed

**Fixed by widening the chain's reserved state, the critic's first fix direction.** L22 now draws the
film hard round the LOWER COURSES and cut back clear of the WHOLE TOP ROW (it previously freed exactly
one carton). L23 opens the front carton of that already-unwrapped row; L24 opens every remaining carton
on it. Each delta is now one flap-fold on cartons the parent physically freed — no delta needs to strip
film its own parent's prose forbids. L25 was already true against the new state and is byte-identical.
`changed_elements` on L24 restated to match ("every remaining carton on the unwrapped top row").

### R-1 · L35 / L36 / L38 / L39 — the money block was one image four times

Re-derived per shot from its own VO line, declared class unchanged in every case:

| shot | class | world now |
| --- | --- | --- |
| **L35** ("and within four years") | crowd-multiplication | **kept** — four pallet stacks stepping up on the apron with a loading crew. This is the one frame the critic's fix direction allows to keep the carton vocabulary; it earns it because the four stacks ARE the four-year climb, not a backdrop. Prose unchanged; `notes` records the decision. |
| **L36** ("million dollars a year.") | number-glued-to-object | a hand-cranked adding machine on a bookkeeper's table, its tape run out over the edge into a coil on the floorboards, '125 MILLION' on the tape's exposed end. A medium object study between two wides, so the cut reads. |
| **L38** ("giants like Compaq") | physicalized-imbalance | the customer's own yard under a low sun: the pallet dwarfed at the mouth of an articulated trailer, the trailer line receding, a crew of yard hands. `figures.crowd` added. |
| **L39** ("over 600 million dollars a year.") | number-glued-to-object | a bank's public banking hall — marble counter, brass grille, tellers behind it, a porter's trolley of banded notes halted on the floor, '600 MILLION' on the trolley board. `figures.crowd` added. |

Three identical palette lines are gone; no two of the five frames in that span (L35–L39) now share a
world, a vantage or a palette. L39's 125-vs-600 juxtaposition was dropped, not restaged — the VO
compares nothing in that line, L36 now carries '125 MILLION' in its own frame, and the comparison the
script does make is L40/L41's inflation board.

### R-2 · L19 — the money staged in the wrong party's room

The prompt no longer opens "A plain back stockroom behind that display". The room is the drive maker's
own shipping back-of-house: its own loading dock and roll-up door, a waiting truck, a pallet of finished
drive units, a cash box on a packing bench. No retail adjacency survives, so the picks-and-shovels thesis
reads the way the script argues it. Crowd (the manufacturers' packing crew) kept, rear zone kept.

### R-3 · L42 — the empty carton contradicted the taught mechanism

Smug `miniscribe-rep` and the '600 MILLION' lettering are kept; the interior is no longer "entirely
empty". One red clay brick lies inside on crumpled paper filling the box exactly — the exact wording
L23/L24 used — so the frame lands as the irony the video earned rather than as a continuity error, and
it is no longer the wrong fraud.

### R-5 · base/delta hold inversions (L12/L17/L19 vs L13/L18/L20)

Closed by moving one anchor per chain to a verbatim later span of the same sentence. No duration was
invented; every declared `duration_s` still equals the measured hold.

| chain | anchor moved to | before (base/delta) | after |
| --- | --- | --- | --- |
| `drive-vault` | L13 → "things after you switch it off:" | 1.52 / 2.72 | **2.09 / 2.15** |
| `shopfront-brawl` | L18 → "and Apple fight over the phone market," | 2.19 / 2.95 | **2.96 / 2.18** |
| `backroom-take` | L20 → "raking it in." | 1.61 / 2.48 | **2.40 / 1.69** |

`drive-vault` keeps 0.06 s of inversion. The only later split point ("after you switch it off:") puts
L13 at 1.45 s, under the 1.5 s floor — so the alternative was a fabricated number, which the brief and
the round-2 doctrine both forbid. Reported rather than hidden.

### R-9 / R-11 · L03 — the opening peak, under-held and closing on palette

L04 re-anchored to "never heard of.", handing 0.61 s back: **L03 1.76 s → 2.37 s**, L04 2.24 s → 1.63 s,
both inside the band. L03's pallets are brought near and high in frame instead of "small in a large dark
room", and the prompt now closes on the pallets. (2.37 s is short of the critic's suggested 2.5–2.8 s;
the next span boundary would drop L04 under the floor. This is what the VO permits.)

### R-11 · L04 and L21 payload ordering

Framing and palette moved ahead of the payload clause on both. L04 ends on "not one head is turned
toward the racks"; L21 ends on the beige drive unit standing among the pick heads, out of place and
unremarked.

### R-4 · L29 / L31 / L32 — the personification reflex

One face was doing arrival, founding and boom in six cuts, in three medium-wides.

- **L29** — `expr-delighted` → `expr-deadpan`; framing medium, him large and off-centre in the doorway
  with the aisle running out stage-right. A flat identification beat; the irony is the viewer's.
- **L31** — expression KEPT (`expr-delighted` is right for the founder's warm intro, and it is now the
  only delighted human frame in the act); scale pushed in from medium-wide to medium.
- **L32** — `expr-greedy` (the money-story register for "And they were HOT", used nowhere else in the
  fifth) on a **low wide angle from floor level**, him large stage-right, the busy floor running back.

STEP-1 figure-card count unchanged at 8 — two cards change identity, none is added.

### R-7 · L07 — the act's largest transformation on the emptiest parent

Re-authored as a **fresh stage base** (`stage: store-rush`, `stage_role: base`), the critic's first fix
direction — the hold is 1.50 s and cannot be lengthened without inventing a duration. It seeds the L05
place-first frame instead of a parent that contains no people, and the queue is stated as a positive
arrangement in a named zone (packed along the counter's far side, ranked back between the bays) rather
than "packs the room". New vantage (down on the floor at counter height) so the cut reads against L05.
The window card sits behind camera at that vantage, so no established literal is carried and the payload
slot stays with the crowd.

### R-8 · L08 — the delta deleted the parent's dominant visual mass

Re-authored so the delta ADDS instead of deletes: every buyer in the queue now carries a boxed beige
machine under one arm. That is also what this shot's own line says ("Anybody with money was buying one"),
and the shelves running bare now lands where the script puts it — on L09's "flying off the shelves",
which is a fresh frame rather than a deletion delta. `stage: store-rush`, delta 1 of 1.

### R-6 · L12 — unpinned scale under a payload that depends on it

The unit's scale is pinned against two things already in the frame: a **waist-high plinth** and **four
courses of the drawer wall** behind it. L14 fills the interior with upright manila folders and boxed
program sleeves; a desk-object-sized parent would have made both payload nouns unreadable at 2.5 s.

### R-10 · L30 (and L28/L29) — lettering-technique words

"Chalked across the end of the nearest crate" → "**Across the plank end** of the nearest crate"; "broad
**painted** board" → "broad **plank** board" on the plate (L28) and on the frame that redraws it (L29),
so the place's sign reads identically wherever it appears. Substrate stated, register left to the suffix.

### R-12 · L18 — two incompatible geometries in one payload clause

One contact geometry now, and it mirrors the cases' lock-up above: the slabs stand upright, **butted face
to face**, shoved hard with a matching dent where they meet and their bottom edges skidded apart under
the push. "Edge pressed to edge and leaning into each other" is gone.

### N-1 · the undeclared L38–L41 figureless run

**Restaged, not merely declared.** L38 and L39 were re-derived into worlds with people working in them
(yard hands; tellers behind the grille), so the run collapses to L40–L41, 3.8 s. Remaining figureless
runs: L12–L16 10.6 s (declared), L26–L28 6.4 s, L05–L06 4.9 s, L40–L41 3.8 s, L36 2.9 s, all others
≤ 2.4 s. **L16's note was corrected** to the claim that is now true and checkable — "the act's ONE
figureless run past the ~10 s self-audit flag" — with the shorter earned runs named in it. Figure-bearing
frames 26 → 28 of 47 (60%).

---

## Neighbours touched (each forced by a flagged chain's state repair)

| shot | what changed | forced by |
| --- | --- | --- |
| L22 | prompt: film state widened from one carton to the whole top row | the L24 BLOCKING repair (the brief scopes L22–L25 as one chain) |
| L23 | prompt: carried restatement updated to L22's new state | same chain |
| L13 | `vo_ref` + `duration_s` only — **prose byte-identical** | the L12 hold rebalance (R-5) |
| L20 | carried restatement rewritten to match L19's re-staged base, plus its own anchor/duration | the L19 location repair (R-2) + R-5 |
| L28 | "painted board" → "plank board" | R-10's own milder half; a place's sign must read identically wherever redrawn |
| L16 | `notes` only, prompt untouched | the brief's requirement that the "one earned run" claim end up true |
| L35 | `notes` only, prompt untouched | R-1: records why this is the frame that keeps the carton vocabulary |
| L17 | `duration_s` + `notes` only, prompt untouched | R-5 (its hold rises when L18 re-anchors) |

Everything else — 22 shots and the entire `thumbnail` block — is byte-identical.

---

## ACCEPTANCE

### 1. Lint — 2 HARD, 4 heads-up, every line classified

```
== lint_shots: channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json ==
long-form shots: 47  |  shorts: 0

HARD violations (2):
  [long-form] Sum of duration_s 103s < 85% of the ~558s runtime (1628 words / 175wpm, per the header)
  [long-form] 47 shots for a ~558s runtime (< 1 cut / 4s) - too few cuts; densify

Heads-up (4):
  [long-form] L47: covers ~1346 words on one anchor (>~8s VO)
  [long-form] L08 (stage 'store-rush' delta): 1.7s - deltas should not be longer than the base
  [long-form] L13 (stage 'drive-vault' delta): 2.2s - ...
  [long-form] L14 (stage 'drive-vault' delta): 2.5s - ...
```

- **HARD ×2 — partial-coverage artifacts**, unchanged from round 2: both measure the whole 9:20 runtime
  against a file covering 18 % of it (SKILL step 3c says to expect exactly these until the file is complete).
- **Heads-up L47 — the same artifact** (the last shot's span absorbs every unwritten fifth).
- **Heads-up ×3 "delta longer than its base" — real-timing artifacts.** Each delta is inside the
  1.5–3 s band; the base's line is simply spoken faster ("They were all the craze." = 1.50 s;
  "A hard drive is the part of your computer" = 2.09 s). Silencing them means writing durations that
  disagree with the render. **L15, L18 and L20 cleared** in this round (6 → 4).
- **Zero real-cadence heads-ups.** Zero payload-last, anchor-order, place, plate/owner, crowd-tier,
  delta-feasibility, text-supply, lettering-cap, carried-literal, rig-clause, render-technique or
  suffix HARDs.
- `--write` deliberately not run (it refuses while any HARD stands, and the two artifacts cannot clear
  until the remaining fifths are authored). `vo_text` stays underived, as in rounds 1 and 2.

### 2. Forge whole-file dry-run — completes, exit 0, ZERO refusals

```
py -3 .claude/skills/image-generation/scripts/forge.py batch \
  --kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit \
  --batch channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json \
  --out <scratch>/slate-G4.json
...
  == batch: 47 scene(s) + 8 STEP-1 figure gen(s), 1 not generated -> <scratch>/slate-G4.json ==
```

- **No `SEEDING LAW` block, no violation, no refusal**; exit 0, spec written. ("1 not generated" is the
  thumbnail note, as in round 2.)
- **All 8 `fig-*` cards show GENERATE, none REUSED** (machine-checked: zero matches for
  `REUSED|SEEDING LAW|violation|refus` in the whole run). Two cards change identity with the R-4 fix —
  `fig-miniscribe-rep--action-powerstance--expr-deadpan` and
  `fig-miniscribe-rep--action-celebrate--expr-greedy` — the count is unchanged at 8.
- **Max seeds on any request = 4 (L33)**; `SEED_CAP` reached, never exceeded, displacement never fires.
- The re-based shop chain seeds as designed: `L07: [L05, crowd-exemplar]`, `L08: [L07, crowd-exemplar]`.
- G3's forge/SKILL edits had **not landed in the worktree** when this ran (`git status` showed only my
  `shots.json` modified), so this dry-run exercised the pre-G3 forge. If G3's displacement work changes
  seeding shapes, the run is worth repeating — nothing in this round's authoring depends on it, and no
  shot in the fifth is at the cap except L33, which is unchanged.

---

## Stopped on / not done

- **The 0.06 s residual inversion in `drive-vault`** (L13 2.15 s vs L12 2.09 s) is timing-bound, not
  authorial: the only later anchor puts L13 under the floor. Left visible.
- **L03 lands at 2.37 s, not the critic's suggested 2.5–2.8 s** — same reason (L04 would fall under the
  floor). The composition half of R-9 (pallets brought up, close on the pallets) is fully done.
- **Critic items outside my target list were NOT touched**: N-2 (L46/L47 same camera), N-3 (L09's queue
  vanishing), N-4 (L11/L34 bench frames), N-5 (bare counts at n≥3), N-6 (single-shot stages), N-7
  (skeleton ids stale, act 1 over its second budget by 2.7 s), N-8 (skeleton friction #2 vs the retired
  lint rule), N-9 (L33's "between and behind"), N-10 (L26 "in plain block colours" + the third arrow),
  N-11 (L44's order book vs `action-armscrossed`), N-12 (L06's `shot_class: literal` label), N-13
  (`auditor-rep` un-minted; the thumbnail primary's two red pointers). Several are cheap; they need a
  caller decision, since VPW never picks its own targets.
- **`vo_text` still underived** and the fifth-1/fifth-2 anchor seam still unexercised (unchanged from
  round 2).
