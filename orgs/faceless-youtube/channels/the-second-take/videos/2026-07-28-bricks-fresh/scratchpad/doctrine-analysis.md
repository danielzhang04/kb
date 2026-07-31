# Doctrine analysis — bricks-fresh board verdict → fix design (authoring + review layers)

Read-only analysis. Altitude: doctrine / authoring / review DESIGN. `forge.py` code paths are a parallel
agent's lane; three of my four open questions were answered by its `scratchpad/forensic-seed-trace.md` and are
folded in as **[TRACE RESOLVED]**. One genuinely unowned trace remains (§7-A, `render-builder`).

Every proposal is tagged with its ONE owning layer and sized to land slim (operating-law §F-docs
integrate-don't-append, README §Design rules five-move doctrine: taste defects are never fixed by more
self-checked rules).

---

## 0. Measurement first — what actually predicts a condemn

Parsed Daniel's per-shot condemns into a set of **107 shot ids** (of 215 — half the board), then measured
those against the authoring features of `shots.json`. Rest = the 108 he did not condemn.

| Feature (measured) | Condemned | Rest |
| --- | --- | --- |
| Share of shots bearing ANY figure | **88 %** | 40 % |
| Share with ≥2 distinct figures | **33 %** | 11 % |
| Mean figure load (named + anon_foreground + crowd) | 1.26 | 0.54 |
| Mean tier mix (how many of {named, §2e anon, crowd} in one frame) | 1.07 | 0.44 |
| Mean `still_prompt` length (chars) | **448** | 530 |

Three findings that steer everything below:

1. **Figure presence is the dominant predictor** of a Daniel condemn — 88 % vs 40 %. Directive 3 ("fewer
   character shots") is not a taste preference, it is the highest-leverage defect-rate lever available.
2. **Prompt length is INVERSELY correlated** with failure. Condemned prompts are *shorter*. Figure-bearing
   shots already spend less prose on scene — so "simplify everything else when the rig is complex"
   (directive 2) cannot be implemented as *cut scene words*: that is already happening and still fails.
   The complexity budget has to cut the **figure** side (fewer figures, fewer tiers), not just the scene side.
3. **Board-wide authoring stats:** 137/215 shots figure-bearing (64 %); distinct-figure distribution
   0:88 / 1:84 / 2:39 / 3:4; 21 crowd shots; 54 stages; 42 distinct backticked slugs, **all 42 resolving
   cleanly** against registry+library (zero invented slugs — see §1, proposal dropped).

---

## 1. Rig drift at authoring time

### How VPW instructs shot authors to describe figures

`SKILL.md` Step 2.3 + `visual-grammar.md §2` already carry the right doctrine: reference cast/pose/expression
by backticked registry NAME inline; *"Never author body pose, finger mechanics, or facial expression as prose
— naming the asset IS the authoring act"*; anonymous figures are DECLARED in `figures`, never described in rig
prose. Enforcement today: `lint_shots.py::rig_clause_check` fires **only** on the §2d/§2e clause fingerprint
(the boilerplate blockquote text). Nothing checks ordinary anatomy prose.

### Where drift actually enters

**(a) The anatomy prohibition is self-checked, and it leaked.** It is a prohibition of exactly the subjective
kind README §Design rules says prohibitions never kill. Measured leaks in the shipped file:

- `L91` — names `action-shrug` AND then writes *"palms half-open in a small practiced shrug"*.
- `L196` — names `surrender` AND then writes *"both palms raised open toward the room"*. Daniel: "terrible
  facial expression". Open/raised palms are the style-bible's own documented **five-digit drift point**.
- `L143` — *"faces softened by the low angle of the light rather than shown in detail"* — face prose on a
  shot whose figures are declared `anon_foreground`, i.e. prose competing with the §2e rig clause.
- `L60` — *"the lamplight reaching just far enough to catch their faces too"* — same class.

The pattern is not authors *replacing* the registry name; it is authors **narrating the pose again in words
next to the name**. That prose then competes with the pose/expression SEED at gen time, which is precisely the
attribute-routing the image-gen seed law depends on.

**(b) Tier mixing is uncounted.** Daniel's "too many different character types in one shot" maps to *tier mix*,
not raw count — the authored counts are already low (max 3 distinct figures anywhere on the board). `L60`
stages `qt-wiles` + `brick-foreman` + a declared crowd = named-seeded rig + crowd rig in one frame, and sits
inside the `L60-68` "many off rig" block. Tier mix is 1.07 on condemned shots vs 0.44 on the rest. **No layer
counts it**: `figures` declares anon/crowd, but named cast lives only as backticks in prose, so neither lint
nor forge nor the critic can compute the frame's true figure load or its tier composition.

**(c) The figure cap is unenforceable as written.** `visual-grammar.md §2` sets "plan ≤5 must-stay-distinct
figures per shot" and flags ">3 in physical interaction" — both are prose asks on the author, with no
countable input. `critics.md` explicitly tells the critic *not* to flag a shot for merely having figures.

**(d) Invented-slug drift — measured, NOT a real defect on this run.** All 42 backticked tokens resolved. I am
**not** proposing a lint slug-validator: the failure rate is zero and the bloat is not earned.

### Proposals

**1-A. Make the cast machine-readable: `figures.cast: ["qt-wiles", "brick-foreman"]`.**
*Owning layer: `shots-schema.md §2` (field) + one clause in VPW Step 2.3.*
Today `figures` declares only the anonymous tiers, so the frame's real figure load is invisible to every
downstream check. Adding `cast` to the SAME field completes it — one field, one shape, no new concept, and it
is the input every proposal below needs. VPW authors it as it already authors `anon_foreground`.
**[TRACE RESOLVED — parallel agent, `forensic-seed-trace.md` §1a/§1d]:** forge does **not** derive a cast
list at all. A gen's seed slate is whatever the CALLER passed in `seed: [...]`; on this run the caller was
`scratchpad/build_batch.py`, a per-run throwaway script — which appended the mandatory style anchor LAST and
silently lost it to the cap on 7 shots before being fixed mid-run. So the seed slate is currently derived by
ad-hoc per-run code from prose. `figures.cast` makes it derivable from the durable `shots.json` contract
instead, which is the actual argument for the field.

**1-B. `rig_load` and `tier_mix` as DERIVED fields, computed by `lint_shots.py --write`.**
*Owning layer: `lint_shots.py` (+ one sentence in `shots-schema.md §2` declaring them derived).*
`rig_load = len(cast) + len(anon_foreground) + (1 if crowd)`; `tier_mix` = how many of the three tiers are
present. README §Design rules: derived fields are never generation targets — the schema must say so
explicitly so the author does not read them as a brief. Then lint gates mechanically:
- HARD: `rig_load > 5` (the grammar's existing cap, finally countable).
- HARD: `tier_mix == 3` (named + §2e anon + crowd in one frame — the uncontrollable case).
- SOFT: `tier_mix == 2` where one tier is `crowd` and a named cast member is present (the `L60` shape).
This converts three prose asks into one mechanical check and deletes nothing.

**1-C. Anatomy-prose lexicon check (HARD).**
*Owning layer: `lint_shots.py`, mirroring the existing `rig_clause_check` / `control_leak_check` shape.*
A closed lexicon — `eyelid(s) · eye(s) · nose · ear(s) · face(s) · cheek · jaw · brow · mouth · grin · smile ·
teeth · finger(s) · palm(s) · hand(s) · fist · knuckle · digit` plus proportion words `tall · lanky ·
long-bodied` — HARD-fails inside a `still_prompt` unless it sits inside a quoted authored literal. This is a
**mechanically detectable** violation, which is exactly the class README says prohibitions *can* kill; today
it is enforced only by an author's self-discipline and it demonstrably leaked on ≥4 shots. **Then delete the
prose prohibition's enforcement burden from VPW** — Step 2.3 keeps the one sentence of *why*, lint owns the
*whether* (five-move step 5: collapse the superseded self-checked mechanism).

**1-D. Do NOT add a "describe the rig better" rule anywhere.** The measured dominant rig failure of this run —
identity collapse to `base.png`, ~68 % first-pass flag rate — is a **seed/generation** defect, not an authoring
one (gen-log Stage E: the same character renders perfectly in the adjacent shot from the same prose). Directive
1 ("rig prompting consistently strong, zero drift") is therefore mostly the parallel agent's lane; the
authoring layer's honest contribution to it is 1-A/1-B/1-C, and nothing more.

---

## 2. Complexity budget — derive it from the SEED budget, don't pick it by taste

### The mechanism nobody has written down

`image-generation` SKILL.md's seed law is a **hard cap of <=4 seeds per gen**, and it itemises the cost of one
figure: *canonical + ONE pose primitive + ONE expression frame + one anchor/exemplar*. Two more rules add
cost: **"Style anchor MANDATORY on every environment, plate and composed-scene gen"** (+1) and **"Every
crowd-bearing gen also seeds the crowd exemplar"** (+1); a §2e anonymous foreground figure needs the base rig,
and the law says explicitly *"a figure that needs the base rig spends one of the four on it"* (+1).

So a shot's authored figure declaration determines a **seed cost** the generator may not be able to pay:

```
seed_cost = 3*|cast| + (1 if anon_foreground) + (1 if crowd) + 1 (style anchor)
```

| Authored shape | seed_cost | vs the cap of 4 |
| --- | --- | --- |
| no figures | 1 | fits |
| one named cast member | 4 | exactly at cap |
| one named + a crowd | **5** | over — pose or expression seed must be dropped |
| two named cast | **7** | over — 3 seeds must be dropped |
| two named + crowd (`L60`) | **8** | over — half the identity seeds dropped |

When the cost exceeds 4, something is dropped, and whatever is dropped **reverts to being worded** — which is
exactly the attribute-routing failure the seed law warns about ("a pose re-synthesized from words reverts to
the engine's five-finger prior"). Ears, eyelids, feature placement and proportion are all attributes routed by
the canonical / expression seeds. **Daniel's dominant defect classes are precisely the attributes evicted
first when the figure budget overruns the seed budget.**

### Measured against his condemn list

| `seed_cost` | shots | condemned |
| --- | --- | --- |
| 1 (no figures) | 78 | **13 (17 %)** |
| 2 | 28 | 17 (61 %) |
| 4 (one fully-seeded figure) | 63 | 43 (68 %) |
| 5 (one named + crowd) | 15 | **14 (93 %)** |
| 7 (two named) | 21 | 14 (67 %) |
| 8 | 7 | 5 (71 %) |

Over-cap shots condemn at **76 %**; within-cap at 43 %; **figureless at 17 %**. Two conclusions:

- The named-cast **+ crowd** shape (`seed_cost 5`) is the single most lethal authoring shape on this board —
  14 of 15 condemned. It is also the cheapest thing to forbid.
- Even a *legal* single-figure shot (`seed_cost 4`) condemns at 68 %. The authoring layer cannot fix that;
  only the generator can. Which is why **directive 3 (fewer character shots) is the only high-leverage lever
  the authoring layer actually holds** — moving the board from 64 % figure-bearing to ~40 % would cut expected
  condemns by roughly a third at today's per-class rates, with no generator change at all.

### Proposals

**2-A. State the complexity budget as a seed-cost table in `visual-grammar.md §2`.**
*Owning layer: `visual-grammar.md` (the depiction law both VPW and the shot critic read).*
Replace the current unenforceable prose cap ("plan <=5 must-stay-distinct figures per shot") **in place** —
integrate, don't append — with the budget stated as a consequence, ~8 lines:

> A shot's figure declaration buys seeds out of a fixed budget of four.
> `seed_cost = 3*cast + anon + crowd + 1`.
> - **cost <= 4 -> author freely.**
> - **cost 5-7 -> the shot must pay for it elsewhere:** no crowd alongside named cast; expressions held
>   neutral or carried from the chain base rather than authored per figure; at most one authored literal;
>   scene reduced to the setting plus the one payload object.
> - **cost > 7 -> not authorable. Split it across a delta chain (one figure per frame) or restage as
>   co-presence at crowd tier.**

Same doctrine Daniel stated ("complex rig scene -> simplify everything else"), but expressed as an arithmetic
consequence of a rule that already exists — so it cannot be argued with by taste and introduces no new concept
into any file.

**2-B. Bind it once, consume it twice — no duplication.**
*Owning layer: `lint_shots.py` computes; `visual-grammar.md` states; forge reads.*
`lint_shots.py --write` derives `seed_cost` alongside `rig_load` (§1-B) onto each shot: **HARD** above 7,
**SOFT** at 5-7, and **HARD** on `cast >= 1 && crowd == true` (the 93 % shape). Author side bound. Gen side:
the batch builder reads the same derived number to pick its seed slate deterministically instead of per-run
judgment. One number, computed once by the lint that already rewrites the file, read at both ends. Nothing is
stated twice.

**[TRACE RESOLVED — `forensic-seed-trace.md` §1a]:** the cap is real and hard. `forge.py:644-646` **SystemExits
the whole batch** above 4 seeds (before any spend); the base-rig auto-seed is *dropped with a warning* at the
cap. Forge never silently trims an authored seed — meaning **the dropping happens upstream, in the batch
builder, under no policy at all.** That converts 2-A from a taste rule into the only way to keep a shot
generatable: over-cap authoring forces an unowned script to decide which identity anchor to discard.

**2-C. The figure-vs-figureless authoring bias** is where directive 3 is actually implemented — see 3-D.

---

## 3. Scene / palette diversity

### What currently drives palette

- `style-bible.md §4` locks palette **to the character only**, saying explicitly *"NOT globally —
  scene/background/prop palettes move freely per video"*. There is no channel palette to repeat against.
- `style-bible.md §5` requires *"a committed **warm** scene palette"* per environment. That is the only
  cross-shot palette pressure in the entire system, and it points toward sameness.
- `visual-grammar.md §5`: *"Red is the only emphasis ink, semantic"*.
- VPW Step 3c's per-act self-audit counts **red ink only** ("a rising count means it is turning into
  decoration"). It counts nothing else about palette, and it is a self-check inside the authoring context.

**There is no diversity pressure of any kind across a 215-shot board.** Nothing measures repetition, nothing
assigns palette per act, and the one global palette rule pushes everything warm.

Measured lexicon across the 215 `still_prompt`s: `grey` 108 · `warm` 67 · `red` 44 · `cool` 35 · `green` 32 ·
`cream` 30 · `amber` 27 · `brown` 26 · `near-black` 26 · `blue` 25 · `concrete grey` 25 · `terracotta` 15.
Half the board says grey. `L181-L184` — Daniel's "way too red" — is four consecutive shots across two stages
all authored *"alarm red against near-black"*, and nothing in the pipeline can see a run of four.

### Proposals

**3-A. Act-level palette assignment, decided in VPW Step 3a.**
*Owning layer: `visual-prompt-writer/SKILL.md` Step 3a.*
Step 3a already forces the author to decide — before authoring a shot — the acts, the recurring stages, the
three peaks, the density budget. Add **one line to that same list**: *each act commits a named dominant
palette plus one contrast palette, recorded in `vpw-log.md`; consecutive acts may not share a dominant.*
Cheapest possible mechanism: one decision added to a planning step that already exists, no new file, no new
field, no per-shot rule to self-check — and it is the altitude at which "boring / same-y" is actually decided.

**3-B. A repetition lint that measures what 3-A committed.**
*Owning layer: `lint_shots.py`.*
Colour-lexicon SOFT check, two triggers only: (i) **>=3 consecutive shots** sharing a dominant colour term
across a stage boundary (catches `L181-184` exactly); (ii) any single dominant term above **~35 %** of the
board (catches grey at 50 %). SOFT, not HARD — it is a taste signal; repetition *counting*, however, is
genuinely mechanical, which is what earns it a place per README §Design rules.

**3-C. Delete the warm bias.**
*Owning layer: `style-bible.md §5`.*
*"a committed **warm** scene palette"* -> *"a committed scene palette, chosen against the act's assigned
dominant"* — a two-word edit in place. `warm` is the only global palette instruction in the system and it is a
monotony instruction. LOCKED value -> surface for Daniel's approval, never self-apply (image-generation's own
law).

**3-D. Where VPW decides figure-vs-figureless, and the bias that must change.**
*Owning layer: `visual-grammar.md §1` narration->shot-class table (data), NOT the SKILL prose.*
The call is made at Step 2.1-2.2: classify the line -> pick a class -> invent. **The class table is what
biases it.** Six of its 13 rows resolve to a figure by definition (personification, staged interaction,
personified institution, dialogue reenactment, reaction shot, crowd multiplication), and the channel's
signature class — `ironic-counterpoint`, the most-used on this board at 35 — is silent on figures, so authors
default to staging one. Measured: the figure-classes total ~63 shots, but **137 shots carry figures**. Figures
are being staged far beyond the figure-classes. Fix the table, not the prose:

- Give **every figure-implying row a figureless alternative**, listed FIRST where it is viable ("an
  institution as an actor -> its iconic landmark, its building, its letterhead, its product — or a personified
  character with one identity tag"). Some rows already have one; make it true of all of them.
- One line under the literal/non-literal bar: *"A figure is the expensive option (§2 seed budget). Where the
  beat reads without one, stage the object, the place, or the document."*
- VPW Step 3c's per-act self-audit already counts red ink and class variety — **add figure share** to that
  same paragraph (one clause, no new step), against the target set in 3a.

A data edit plus two sentences. It moves the default without adding a prohibition anyone must self-check.

---

## 4. Continuity groups

### Two separate breakages, one measured, one evidenced

**(a) Continuity is asserted in PROSE that no layer can honor.** 137 of 215 prompts contain "the same X" /
"from earlier" / "the familiar"; **52 of them are NOT deltas** — a quarter of the board claims a place the
pipeline has no machine-readable way to reproduce. Exactly Daniel's condemn list:

- `L207` — *"The same brickyard gate from earlier"* — but it opens a NEW stage (`brick-co-payday`), 100 shots
  after the `brick-co-yard` stage it refers to. Nothing links them. Daniel: L207/208 should be the same shot.
- `L126` — *"the same pallet-canyon warehouse aisle from earlier"* — standalone, no stage at all.
- `L206` — *"The same conference table from the settlement, the three banded stacks still set out"* + a fourth
  stack. Standalone, no stage. Daniel: "two piles of cash makes no sense" — a prose-only re-description of a
  previous frame produced a second, differently-drawn set of stacks alongside the new one.
- `L81/L82` — warehouse differs from the earlier warehouse; both outside any shared stage with it.

`stage` cannot carry this: it is defined as **contiguous** shots with one `base` and <=3 `delta`s. Scene
identity is a different relation — *this is the same PLACE*, possibly 100 shots and several acts apart, with
no delta relationship at all. The schema has no field for it, so authors expressed it in prose, which is
inert.

**(b) Even correctly-authored chains lost the place, because the RETRY WAVE broke them.** `L116-L119` is a
textbook chain (one base + three deltas on `shipping-map`) and Daniel still says "should be the same map".
Cross-checking `assets/_review/flagged_ids.json` against the retry log: `L117, L118, L119` were all in the
120-shot retry wave, and gen-log Stage F states its seed policy plainly — *"seeds re-derived **fresh from the
character canonical(s)** (never the defective frame — the chain-delta shots' prior pattern of seeding ONLY the
parent frame ... was ... corrected here)"*. That policy is `image-generation`'s own **"A rig FIX never seeds
the defective frame"** law. It fixed identity collapse and **destroyed held-set continuity by construction**:
a delta regenerated from canonicals alone re-invents the set. Same story for `L103/104/105` (all three
retried), `L128-L131` (four of six retried), `L81/L82`, `L206/L207`.

**This is a real, unresolved conflict between two laws in `image-generation` SKILL.md** — "a rig FIX never
seeds the defective frame" vs "a delta seeds the PREVIOUS in-stage frame" — and the retry wave resolved it
silently in favour of identity, at the cost of every held set it touched. Naming and resolving that conflict
matters more than any new field.

### Proposal — the slimmest contract

**4-A. `scene_id` — a scene-identity group, non-contiguous.**
*Owning layer: `shots-schema.md §2` (field) + `visual-grammar.md §1` chain logic (the one paragraph that
already defines `stage`).*
One optional string on a shot, shared by every shot depicting ONE place, regardless of distance or delta
relationship. `stage` keeps its current meaning untouched (a contiguous held set, the delta mechanics);
`scene_id` is orthogonal and may span many stages. Contract, four lines in the grammar:

> Shots sharing a `scene_id` depict ONE place. The FIRST such shot in board order is the group's **master
> plate**. Every later member is generated seeding that master plate frame, and its prose carries the place
> facts tightened, never re-invented. A place seen once needs no `scene_id`.

**4-B. Lint catches the prose form (HARD).**
*Owning layer: `lint_shots.py`.*
A `still_prompt` containing continuity language ("the same …", "from earlier", "as before", "the familiar")
HARD-fails unless the shot is a `delta` **or** carries a `scene_id` shared with an earlier shot. Purely
mechanical, catches all 52 of today's unlinked claims, and needs no judgment.

**4-C. Resolve the seed-law conflict explicitly.**
*Owning layer: `image-generation/SKILL.md` — edit the "A rig FIX never seeds the defective frame" row in
place, do not add a rule elsewhere.*
Proposed wording: a rig fix on a shot belonging to a `stage` chain or a `scene_id` group seeds
**[master plate / in-chain parent] + [character canonical] + [expression frame]** — the place comes from the
plate, the identity from the canonical, and the defective frame is still never the identity source. The
existing exception list already contemplates "an authored delta-chain parent"; this makes it the rule for
continuity-bearing shots rather than an exception, and keeps the paired before/after crop-diff requirement.

**[TRACE RESOLVED — `forensic-seed-trace.md` §2a/§2b] — and it sharpens the proposal into a hard trade-off.**
Confirmed in the batch files: the original Pass 2 seeded a delta as `seed: ["_staging/<parent>.png"]` and, on
many shots, **nothing else** — no canonical, no anchor — so a defective parent had nothing to counterweight
it. The retry then went the other way and **dropped the parent frame entirely** (`L87` pass-2
`["_staging/L86.png", expr, pose]` -> retry `["brick-foreman.png", "env-interior-warm.png", expr, pose]`).
`stage_role` has **no effect on seed selection** anywhere in forge — it only switches the §2e clause wording.

So identity and continuity were never both satisfiable: **plate + canonical + expression + pose = 4 slots,
the entire budget.** Sections 2 and 4 are therefore the *same* constraint. The law that follows is derivable
rather than chosen:

> A continuity-bearing shot (a `delta`, or a `scene_id` return) affords **exactly one named figure and no
> crowd** — its four slots are already spent on plate + canonical + expression + pose. A beat needing more
> figures in a held place must split across the chain, one figure per frame.

That is directive 2 ("complex rig scene -> simplify everything else") stated as arithmetic, and it is what
4-C must encode alongside the seed-priority order.

**4-D. What NOT to build.** No separate "continuity critic", no plate-library, no new pass. `scene_id` +
one lint rule + one edited seed-law row covers every continuity condemn on Daniel's list.

---

## 5. Logic / staging sanity — ONE owning layer

### The assignment rule

Split the condemns by **where the nonsense was created**:

| Defect | Created in | Evidence |
| --- | --- | --- |
| `L206` two cash piles | the PLAN — the prompt itself authors "the three banded stacks still set out" *and* "a fourth, much smaller stack" | prompt text |
| `L126-131` weird staging | the PLAN — an auditor holding one carton aloft, a ledger page held beside it at the same height | prompt text |
| `L89-91` wrench vs paper box | the RENDER — the prompt authors a *wax-sealed box with a lock plate*, not a paper box | prompt text vs Daniel's read |
| `L172` authored text missing | the RENDER — `'SEPTEMBER'` was authored and the frame drew a garbled stamp instead | `merged.json` L172 ruling |

So there are two owners, and each already exists:

**Plan-side nonsense -> the VPW Step 8 shot critic (`references/critics.md`). Nothing else.**
Its question 1 is already exactly this job — *"Do the stated facts make sense… causality? Would a viewer who
knows the story spot a wrongness?"* Per README §Design rules the fresh-eyes critic layer IS move 4, and adding
a second layer for a job an existing layer owns is the bloat Daniel's directive 5 forbids. The post-gen judge
**structurally cannot** own it: its fidelity mandate asks whether the image asserts *exactly the prompt's
facts*, so a faithfully-rendered nonsensical plan PASSES by design, and re-pointing it at the script would
duplicate the critic at 3x the cost after the money is spent.

**Render-side nonsense -> the post-gen fidelity judge, which already caught it and then lost it.** `L172` was
flagged by all three judges and stamped `clean` anyway; see §6, which is where that hole is.

### Why the critic missed the plan-side ones

Not scope — budget and suppression:

1. **One critic, 215 shots, five questions each.** gen-log Stage E documents this exact failure mode one layer
   down: all three rig judges *"ran out of turns mid-batch and stopped WITHOUT flagging that they hadn't
   finished"*, leaving a 48-shot silent gap. A single shot critic over 215 shots is the same shape, and
   `critics.md` prescribes exactly one ("deliberately thin — ONE fresh critic").
2. **The "NEVER flag" list is tuned against over-triggering** and suppresses the neighbourhood: *"A shot merely
   for HAVING several figures"*, *"never on a populated scene as such"*, *"A held pose as static"*. Correct
   guardrails, but nothing in the charter asks the plainest question of all: **does the depicted physical
   action make sense for this object?**

### Proposals

**5-A. Fan the critic out per ACT, same charter, with a coverage self-report.**
*Owning layer: `visual-prompt-writer/references/critics.md` — the Dispatch section, edited in place.*
"ONE fresh critic" -> "one fresh critic **per act** (the same acts Step 3a already split), each covering its
act end to end and **reporting N/N shots covered** before it may report done." Findings still merge to the one
author who edits. This preserves the thin, one-cycle design (the doc's whole point) while removing the
documented silent-truncation failure. It is also the same structural fix gen-log finding 3 asks for on the
image side — one mechanism, stated once, reused.

**5-B. One clause added to critic question 1, calibrated by Daniel's own examples.**
*Owning layer: `critics.md` charter.*
> **Physical plausibility:** would this action work on this object, with this tool, at this scale? A tool that
> cannot open that container, two of the same object where the beat has one, a gesture whose target is absent.

Three named failure shapes rather than a general exhortation — `L89`'s wrench, `L206`'s second cash pile,
`L126-131`'s held-carton staging are the calibration set. Two lines, no new question, no new pass.

**5-C. Nothing goes into the post-gen review for plan logic.** Explicitly rejecting that option keeps the
review's scope from growing while §6 shrinks its trust surface.

---

## 6. Review-layer redesign — why the judge verified what Daniel condemns

### Diagnosis, from `assets/_review/merged.json` (176 rulings)

| Fact | Count |
| --- | --- |
| Rulings stamped `worst: clean` (-> `verified`) | 165 |
| Of those, entries carrying a non-empty `why` (i.e. flagged, then downgraded) | **144** |
| Of those, `why` ending in *"RETRY FIXED (orchestrator self-check, viewing scale)"* | **109** |

**Two-thirds of every `verified` stamp on this video was written on the authority of the agent that
generated the retry, checking its own work.** The skill's rig section states the opposite principle in
bold — *"This FRESH-EYES review is the rig authority — a GENERATING agent's self-verification does NOT
substitute for it"* — but a different clause in the same file authorizes exactly what happened: *"Self-check
only the flagged points on the new frame — never re-dispatch the agents or re-review the batch."* The two
clauses contradict; the pipeline followed the second; `stamp_review.py` had no way to tell the difference.
This is the single largest structural cause of the gap between the review's verdict and Daniel's.

Four more contributing causes, each independently sufficient to lose his defect classes:

1. **Viewing scale.** The self-check ran on *"8 contact sheets (15 shots each)"* (gen-log Stage F). Fifteen
   16:9 frames on one sheet is roughly 1/15 of a screen per frame. Ear holes in hair, a missing eyelid, and a
   4 % feature-placement drift are not resolvable at that size — they are not "missed", they are *invisible*.
2. **The escalation model is calibrated to suspicion.** *"An unflagged full-frame PASS stands; nothing further
   is generated for it… evidence exists to help CONDEMN a suspected defect, never to manufacture confidence in
   a clean one."* Sound economics for **hands** (occasional, large). Wrong for **faces**: the whole condemned
   defect class lives below the threshold at which a judge could form the suspicion the model requires as its
   trigger. The skill's own text already concedes this — *"Full-frame reads on this rig err in BOTH
   directions"*, including a documented **false PASS**.
3. **The rig checklist does not name his defect classes.** `style-bible.md §3` says *"same eye style/size/
   position"* and *"No nose, no ears; … a bare earless hairless side gap is a FAIL"*. It says **nothing about
   eyelids** (`L89`, `L93`: "NO EYELIDS — not our design") and **nothing about an ear HOLE drawn into hair**
   (`L137-138`: "no ears, ear HOLES in hair"). A judge issuing a "FORCED PASS/FAIL verdict on each §3
   invariant" cannot fail an invariant that is not written down.
4. **Nothing in the review is cross-shot.** Three mandates (rig / fidelity / style), all per-shot, all inside
   an act batch. Continuity across a batch boundary, palette monotony, and "same-y / boring" have **no owner
   anywhere in the pipeline**. The one cross-shot line that exists — the chain-delta "held-set" check inside
   the rig mandate — is scoped to a single `stage`.
5. **Silent coverage loss** (documented, gen-log finding 3): the original rig judges covered 92 of 111
   figure-bearing shots and stopped without saying so. Fix is the same coverage self-report proposed at 5-A;
   stated once there, not restated here.

### Proposals — the smallest set that would have caught his list

**6-A. `stamp_review.py` may not write `verified` for a self-checked retry. (Highest value change in this
document.)**
*Owning layer: `image-generation/scripts/stamp_review.py` — the ONE writer of the gate.*
A manifest entry with a non-null `retry_cause` and no post-retry fresh ruling stamps **`parked`**, never
`verified`. Structural gate, not a rule: it makes the dishonest stamp impossible rather than discouraged, in
the file that already exists to be the single writer. Then the honest choice becomes explicit and Daniel
prices it: either (i) a second fresh-eyes mini-round scoped to the retried set only, or (ii) accept a large
parked count and review those by board. On this run that is 109 shots — which is exactly the number that
should have been surfaced to him instead of silently passed.

**6-B. Add the missing invariants to §3, then render §3 as a forced row-per-defect table in the judge brief.**
*Owning layer: `style-bible.md §3` (values) — the judge brief renders, never re-states.*
Two value additions, both LOCKED-value edits requiring Daniel's approval: **eyelids** (whatever the canonical
actually has — his words are "not our design") and **no ear-hole / ear-shaped gap drawn into hair** (today §3
only fails a *bare earless hairless side gap*, which is the opposite defect). Then the dispatch renders §3 as
one **row per defect class** with a forced PASS/FAIL — head shape · head-to-body proportion · eye placement ·
eyelid form · brow/mouth placement · ear absence · ear-hole absence · nose absence · digit count per visible
hand · hand-size parity · head tone vs canonical · hair vs canonical · costume vs canonical · outline weight ·
rig tier · expression register. The checklist is **derived from §3**, never hand-maintained beside it — one
source of truth, per README §Design rules.

**6-C. Face crops become unconditional; hands stay suspicion-escalated.**
*Owning layer: `image-generation/SKILL.md`, the escalation-model paragraph, edited in place.*
For every seeded and every §2e figure, `crop_battery.py` cuts the face crop **paired against the canonical**
by default; the judge rules the face rows on the crop, not the full frame. Hands, background contamination and
composition keep today's flag-then-escalate economics. Cost is PIL compute plus judge attention, not
generation spend — `crop_battery.py` and the localizer already exist. Justification is the measured one above:
his entire dominant defect class is sub-viewing-scale, so a suspicion trigger can never fire on it.

**6-D. One cross-shot pass — the mandate that does not exist today.**
*Owning layer: `image-generation/SKILL.md` review section — a fourth mandate, board-scoped, three questions
only.*
One agent, whole board in story order at contact-sheet scale (the scale that is *correct* for these
questions), answering only: (i) does every `scene_id` group (§4-A) render as the same place? (ii) any run of
>=3 consecutive shots sharing a dominant palette, and any palette above ~35 % of the board? — seeded by
`lint_shots.py`'s own §3-B counts, so the agent verifies rather than measures; (iii) any composition/framing
that has become a reflex. Cheap because it is board-scale, and it is the only place "boring / same-y" can be
seen at all.

**6-E. Encode Daniel's condemn list as an `art` facet of the EXISTING `proxy-judge` calibration harness.**
*Owning layer: `knowledge/proxy-me/` (data) — no new mechanism.*
`proxy-judge/SKILL.md` already says *"`idea`/`art` reuse this harness once story is proven"*, and
`knowledge/proxy-me/facets.md` is explicitly extensible (*"Add a new `##` block to add a facet"*), with
`lint_calibration.py` already validating entry schema. So:

```
## art
grammar: channels/<ch>/visual-kit/style-bible.md   (+ visual-grammar.md)
voice:   channels/<ch>/example-shots.md
calibration: knowledge/proxy-me/art/calibration-set.md
```

Seed `art/calibration-set.md` with ~12 entries from THIS run — `image_ref` in place of `script_ref`, verdict
in Daniel's own words: **condemned**, one per dominant class (`L137` ear holes · `L89`/`L93` no eyelids ·
`L115` feature placement · `L133` proportion · `L105` background contamination · `L45` identity/costume ·
`L181-184` palette) and **passed** (`L97`, which he called out as fine, plus a handful of clean frames). The
review judges receive it in their dispatch. **This is the answer to "his condemn list IS the calibration
set"**: what transfers a bar is the *pairing of frame and verdict*, not another rule — README five-move #1,
and a gold exemplar only he can mint.

**6-F. Do not touch the three-state stamp.** `verified` / `parked` / `unreviewed` is honest and correct; the
failure was in what got written into it, not in the states. 31 parked against 107 condemns is a ruling-bar
problem (6-A/6-B/6-C/6-E), not a state-machine problem.

---

## 7. Word-sync + segmentation

### The rule that causes it

Segmentation and anchoring are governed by VPW Step 3b plus `shots-schema.md §2`/§5: `vo_ref` is *"the
**opening words** of that VO line, **>=4** where the sentence has them"*, matched by `render-builder` on the
**first 4 normalized words**. Nothing anywhere anchors a shot's **payload** to a **word**.

The >=4-word rule is the actual root cause of the late landings. It structurally forces every anchor to a
sentence/clause opening, so a payload conceived for a mid-line word cannot be placed at that word — it lands
at the start of whichever shot spans it, up to a full shot-duration early, or at the start of the NEXT shot,
up to a full shot late:

- `L02` `vo_ref: "Home to big hair, Pac-Man,"` — the permed-wig payload lands correctly on "big hair", and
  the Pac-Man payload has nowhere to go inside this shot; the arcade cabinet arrives at `L03`, whose span is
  *"and one of the funniest corporate scams"*. That is Daniel's complaint verbatim, and it is a mechanical
  consequence of the anchor rule, not an authoring lapse.
- `L197` is the mirror failure: derived `vo_text` is literally the single word **"and"**. Densifying to hold
  the 1.5-3s band and the `runtime / 4s` floor pushed a cut onto a function word, and no rule forbids it.

### Proposals

**7-A. Replace the fixed `>=4 words` anchor rule with a UNIQUENESS rule.**
*Owning layer: `shots-schema.md §2` (the rule) + `lint_shots.py` (the check).*
`vo_ref` becomes *"as many verbatim words as it takes to match **exactly once** in the VO word-stream, starting
at the word the shot's payload names"*. Lint already builds the VO stream (`build_vo_stream`) and already
mirrors the matcher, so uniqueness is checkable mechanically and HARD-failable — strictly stronger than the
word-count proxy, which guarantees neither uniqueness nor correct placement. `L02` then splits into
`"Home to big hair"` and `"Pac-Man"`, each landing on its own payload.
**[NEEDS-TRACE — render-builder, NOT forge, so nobody currently owns it: `render.py::retime_by_timings`
matches the first 4 normalized words; confirm it can match a 1-3 word anchor. If it cannot, the fallback is a
`lands_on` word-anchor field the retimer honors — a new field, strictly worse, propose only if forced.]**

**7-B. A minimum-span lint check.**
*Owning layer: `lint_shots.py` (`vo_text` is already derived there).*
SOFT (HARD is too blunt against a legitimate `[PAUSE]`-bounded 3-word line) when a shot's derived `vo_text`
span is a single word, or is composed only of function words — direction: merge into the neighbouring shot.
Catches `L197` mechanically and cannot be Goodharted, since `vo_text` is derived, never authored.

**7-C. One sentence in VPW Step 3b, replacing nothing:** *"A shot's anchor opens on the word its payload
names. If two payloads live in one line, that is two shots."* The positive form of the rule, per README
§Design rules #2 (positive/mechanical checks beat prohibitions).

---

## 8. Exemplar strategy

### What exists

- **Shot authoring:** `channels/the-second-take/example-shots.md` — 8 pairs (script line -> ideal shot +
  why). It is the depiction bar VPW re-reads before every act and the shot critic judges against. Its header
  explicitly sanctions growth: *"each entry Daniel approves stays as the bar, new approved pairs are added
  below it"* — so this is the one file where adding is the designed behaviour, not bloat.
- **Review grading:** **nothing.** The judges rule against §3 *values* with no example of a passing or failing
  frame anywhere in the pipeline.

**The measured problem with the current bar: 6 of its 8 exemplars stage figures** (only #4 the bubble and #6
the medal-and-scroll are figureless, and #6 has to say *"no people in frame"* out loud to get there). README
five-move #1: *"an exemplar teaches its own dimensions"*. A 75 %-figure bar produced a 64 %-figure board. The
bar is doing exactly what it was built to do; it was built for the wrong ratio.

### The 3 exemplars that would most efficiently encode this verdict

**8-1. `knowledge/proxy-me/art/calibration-set.md` — the review-grading gold, ~12 labeled frames.**
*Owning layer: `knowledge/proxy-me/` (data), per §6-E.* Highest leverage of the three: the review layer failed
hardest, has no exemplar at all, and Daniel has just produced a fully labeled 107-item training set for free.
Must be minted WITH him (five-move #1 forbids self-minting) — but the labeling work is already done; what
remains is selecting ~12 and pasting his words.

**8-2. Four figureless pairs appended to `example-shots.md`, drawn from beats this very script proved.**
*Owning layer: `example-shots.md` (data).* The measured 17 %-vs-62 % condemn gap says a figureless shot is
~4x safer, and the bar currently under-teaches it. Best candidates from bricks-fresh itself: `L116` (the
top-down map plan), `L172`'s intent (a stamped document + dated calendar carrying a bankruptcy beat with no
person), `L105` (a loaded truck bed as a countable mass — the count staged as cargo, not as a digit), and
one object-as-institution shot standing in for a personified company. Each with the *why* line the file's
format requires. That single edit moves the taught ratio from 25 % to ~50 % figureless.

**8-3. One continuity-group pair — a worked `scene_id` return.**
*Owning layer: `example-shots.md` (data).* Entry #8 already teaches the contiguous delta chain; nothing
teaches a **return to a place 100 shots later**. One pair — master plate, then the return frame with the place
facts *tightened and identical*, plus the "same place, later" prose discipline — is what would have prevented
`L207` and `L206`. Pair it with the `scene_id` contract (§4-A) so the field and its exemplar land together,
per README's "prove, then register, then emit".

**Not proposed:** a review-side exemplar inside `style-bible.md` (§3 is a values list and must stay one), and
any second authoring exemplar file. Two data files already own this and both are designed to grow.

---

## 9. Ranked change list (for the fix-design gate)

| # | Change | Layer | Why it ranks here |
| --- | --- | --- | --- |
| 1 | `stamp_review.py` cannot `verify` a self-checked retry (6-A) | image-gen scripts | 109 of 165 verified stamps are currently self-issued; nothing else matters until the gate is honest |
| 2 | Seed-cost complexity budget, lint-enforced (2-A/2-B) + `figures.cast` (1-A) | grammar + lint + schema | over-cap shots condemn at 76 %; the named+crowd shape at 93 % |
| 3 | Figureless bias: class-table rows (3-D) + 4 exemplars (8-2) | grammar + example-shots | figureless condemns at 17 % vs 62 %; the only big lever the authoring layer holds |
| 4 | `scene_id` + continuity lint (4-A/4-B) + resolve the seed-law conflict (4-C) | schema + lint + image-gen | 52 unlinked continuity claims; the retry wave broke every chain it touched |
| 5 | §3 gains eyelids + ear-holes; judge brief renders §3 as forced rows (6-B) | style-bible | a judge cannot fail an unwritten invariant |
| 6 | Unconditional paired FACE crop (6-C) | image-gen | his dominant defect class is invisible at the scale the model rules at |
| 7 | `art` calibration facet (6-E / 8-1) | proxy-me data | transfers his bar; reuses an existing harness |
| 8 | Cross-shot board pass (6-D) + palette act assignment (3-A) + repetition lint (3-B) | image-gen + VPW + lint | "boring / same-y" has no owner today |
| 9 | Anchor-uniqueness rule (7-A) + min-span check (7-B) | schema + lint | fixes L02/L03/L197 mechanically |
| 10 | Critic per act + coverage self-report (5-A) + plausibility clause (5-B) | critics.md | plan-side nonsense, in the layer that already owns it |

**LOCKED-value edits needing Daniel's explicit approval before anyone touches them:** style-bible §3 eyelids
+ ear-holes (6-B), style-bible §5 `warm` -> act-assigned palette (3-C). Everything else is skill/schema/lint
work.
