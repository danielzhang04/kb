# Track C — forge routing findings (mechanisms ranked by blast radius)

Read-only forensics. No governing file touched, no gen call, $0. Every number below comes from a
full dry-run rebuild of the current 246-shot `shots.json` through `forge.py cmd_batch` (preflight
stubbed because this worktree holds no pixel files; 401 items = 246 scenes + 155 STEP-1 cards, zero
provider calls), cross-checked against the ACTUAL run slates that produced the frames Daniel judged
(`scratchpad/6c2-slate.json`, `scratchpad/p6b-slate*.json`, `scratchpad/p6b-retry-slate.json`) and
the run genlogs. Per-shot rows: `routing-trace.json` (13 traces, 23 defect observations).

Line numbers are `forge.py` at `claude/bricks-taste-forensics` unless stated.

**Verdict split: 15 of 23 observations are `authored_fine_rendered_wrong`, 8 are `authored_boring`.**
The seeding law is not being violated. It is being *satisfied* by payloads that carry no pixel
authority for the thing that then goes wrong.

---

## The one-sentence finding

Every defect Daniel names traces to the same structural fact: **forge routes IDENTITY through
pixels and everything else — action, scale, environment, and (on a delta or a crowd) the face —
through prose.** The seeding law counts seeds; it never asks whether the seed it counted actually
governs what the shot is asking for. Nine of Daniel's ten defect beats are shots where a legal,
preflight-clean slate contained no pixel that could have produced the right answer.

---

## Ranked by blast radius

### 1. M5 — UNANCHORED ENVIRONMENT — **121 / 154 figure-bearing scenes**

A scene that declares no `place` and has no chain parent seeds no plate, and is *excluded by design*
from the §5 scene style tile: `cast_free = not (fig_roles or canon_roles or crowd or anon_declared)`
(**forge.py:1834**). So the moment a shot contains a person, its entire environment — set, depth,
detail level, palette weight, line register — exists only as words.

L30 is the clean example: **one** seed in the whole payload, the Terry figure card
(`6c2-slate.json#L30`). The bare rented unit, breeze-block walls, trestle, stool and roller shutter
are prose. This is the same class `cmd_batch`'s own docstring says it was built to end ("74 of the
audited 214 shots run as independent seedless roots inside sets the video had already established"),
now re-arriving from the authoring side rather than the builder side.

Also the mechanical answer to "there could be a little more detail in the backgrounds": on 121 of
154 figure shots there is nothing in the payload that could carry detail except adjectives.

**Fix direction — NOT a rollback.** No prior state anchored these frames; the old 214-shot file was
worse. The doctrine exists already (`SKILL.md` place/plate seed law: "Every OTHER in-place shot seeds
its own place's first approved frame"); what is missing is that 121 shots simply declare no place.
That is an authoring-discipline finding for the synthesis worker, enforceable in the lint that
already knows `place`, not new forge function.

### 2. M1 — THE SEEDED-PERFORMER TIER — **116 / 246 shots**

`base` — registry role "BASE TEMPLATE / rig anchor — not an on-screen character", `head_tone`
`#f5ead6`, bald, no hair vocabulary — was admitted as an on-screen figure by deleting four
characters from one condition in `shot_cast`:

- before (**ea71f99:469**, 2026-08-06): `if n in chars and n != "base":`
- after (**27bc7e2:486 → current 495**): `if n in chars:`

and, in the same window, visual-grammar §2's law "**An anonymous foreground human does not exist;**
an anonymous person with an individual count, action, or face requirement is CAST or the beat
becomes mass action" (**ea71f99 visual-grammar.md:148**) was replaced by the three-tier law that
mints that person off the bare rig instead.

Consequences the trace confirms:

- **P03-L27 "cream and bald… not a cast character. Doesn't make sense."** Correct reading of the
  tier. The derived dress clause supplies GARMENTS only ("Take from that description ONLY the
  CLOTHING it implies", 1380-1383); nothing in the route can give the figure hair or a head tone.
- **P05-L38 "the big guy in named is the COMPAQ character, in unnamed, he's nobody."** Exact.
  Old file (`7cfa9ab#L34`): "`ibm-suit`, the customer institution personified (`sit`,
  `expr-deadpan`), sits colossal… signboard… lettered 'COMPAQ'". New file (`d680fda#L38`): "One
  seeded performer, `base`". `seed_roles_text:1287-1291` literally instructs the engine that this
  figure "is an ANONYMOUS figure, not a recurring identity: it claims no name and recurs nowhere."
  He is describing the spec.

**Fix direction — ROLLBACK, with one guard kept.** Candidate state: **ea71f99** (forge.py:469 +
visual-grammar.md:148). The naked rollback re-opens the silent drop that motivated the change
(naming `base` resolved to `[]`, so the performer "minted no card, seeded nothing, raised nothing,
and then measured `cast_free`" — `shot_cast` docstring, 482-488). That hole is already closed by an
existing refusal: `seeding_law_violations` refuses `figures.anon_foreground` **by name** with a
restaging instruction (763-767). Restoring the exclusion *and pointing the existing refusal text at a
`base` casting* is a rename of a refusal already in the file, not new function.

### 3. M2 — POSE-VOCABULARY GAP — **91 / 154 figure-bearing scenes**

The channel owns 30 body primitives (registry: 17 `pose` + 13 `action`), all of them stances:
`hold-one-hand`, `hold-both-hands`, `action-armscrossed`, `sit`, `point-at-thing`, `surrender`…
None of them is an act. When a shot authors an act, `_split_primitives` binds the nearest stance,
the STEP-1 card is minted on that stance (a pose-less card is told outright to stand "squarely at
rest, arms relaxed at the sides", **1377-1378**), and the scene then re-poses the figure in prose —
which redraws the hands, and with a re-posed body the head that sits on it.

| beat | seeded pose | what the shot actually asks the body to do | Daniel |
| --- | --- | --- | --- |
| L27 | `hold-one-hand` | "hauling a grey dust sheet off the front face of a pallet stack" | "5 fingers, in a pose that wasn't seeded from anything" |
| L39 | `hold-both-hands` | "shoving the rear doors of an armoured cash truck shut" | "isn't seeded from any library pose, thus he's off rig" |
| L48 | `action-slump` (card came back **upright**) | "a real SLUMP the drawing must execute" | "the expression … is thus off" |
| L33 | *no pose at all* on both cards | two figures "clasped in `handshake`" | "hair is off rig" |
| L19 (old) | none — crowd only | "a crew works as a mass around a rake" | "since the pose isn't seeded, the guy has four fingers" |

This is not a missing law. `SKILL.md`'s own seed-law table already says it: *"Exposed hands are
seeded, never free-drawn… **No library pose covers it → that was a Pass-1 gate item, not an ad-hoc
scene invention.**"* Nothing in forge or lint enforces it — no code compares the authored action to
the seeded primitive.

**Fix direction — enforcement of an existing law, not new doctrine and not a rollback.** The old-era
authoring did obey it by accident (old L26: "stands `action-powerstance`, `expr-smug`, at the head of
an assembly line" — the prose IS the primitive). Two levers exist, both re-using machinery already
present: (a) a lint refusal when a shot's figure sentence authors a bodily act while the bound
primitive is a stance — same shape as lint's existing seat/support law; (b) `figure_card_payload`
already derives a per-shot CLOTHING clause from the shot's own prose (1358-1389) — the same
derivation could mint the card in the beat's own action. Neither adds a tier or a feature.

### 4. M3 — CROWD IS PROSE-ONLY — **66 / 246 shots (18 with no cast seed at all)**

A crowd frame's total figure authority is one exemplar image whose role prose grants "**only** its
anonymous crowd proportion and face tier" (**1317**) plus the §2d clause as words. The §2c rig-hold
block, which states the four-digit hand law, then explicitly hands crowd figures *back* to §2d ("do
NOT force this full rig onto them"). And visual-grammar §2 was amended in the same 2026-08-06 window
to say it outright: **"a crowd-rig figure names no asset and carries no seeded pose or expression, so
its expression and attitude are authored in plain prose."**

I dry-assembled the real p6b L19 request at $0. The provider prompt is: §2b style descriptor → §2d
crowd clause ("NO noses, NO ears, NO teeth… the EXACT same squat head-to-body proportion") → §2c
rig-hold (which exempts crowd) → "SEED ROLES. The FIRST image is the crowd exemplar" → the shot
prose. **One image, zero pose seeds, zero expression seeds.** Noses (L19-unchosen), off-rig
proportions (L07) and four-digit failures are the predicted output of that payload, not anomalies.

Two of Daniel's crowd asks are **already law and were simply not rendered** — §2d since commit
aa576b9 says "dress every crowd figure for THIS shot's own scene era and setting" and "vary
hair/headwear across at most 2–3 repeating silhouettes". So *era attire and hair are not missing
doctrine; they are unhonoured doctrine.* Only "round **cream-family** heads" actually blocks the skin
tone he wants, and that is one clause.

**Fix direction — mixed, and the cheapest half is a ROLLBACK.** The prose-expression exemption
sentence entered at **27bc7e2**; removing it restores the pre-existing universal attribute-routing
rule. The cream-family head-tone clause is a genuine doctrine EDIT (one phrase in §2d), not a
rollback — nothing earlier permitted crowd skin tone. Nothing here justifies a new mechanism, and
note his real request at L19 ("one center character foreground, can be character rig instead of
crowd rig") is *already* the current tier-routing law — its current answer is the M1 performer, which
he rejects, so M1 and M3 must be resolved together.

### 5. M4 — DELTA CANONICAL EXPRESSION LEAK — **31 / 44 delta beats**

A delta drops the verified STEP-1 card its own base used and seeds parent + canonical instead
(**1734-1750**). Neither role owns the face: canonical grants "identity, head tone, hair and the
pinned costume" (**1306-1307**), parent grants "its held set and existing composition" (**1309**).
The expression gate (**913-920**) fires only when the delta authors an expression *different* from
the one its chain already holds (**1715-1718**) — so the common case, a delta restating the held
expression, is ungated by design and the face is re-synthesized from a canonical.

This is P03-L30/31's "Terry eyes … are crowd rig bead eyes" on the new frame, and it is the same
mechanism the 6c2 run's own r2 verifier isolated on L34 and parked: *"CANONICAL EXPRESSION LEAK —
same L34 spec produced correct per-figure behaviour on `ibm-suit` … and incorrect on
`miniscribe-rep` … because `seed_roles` never states which seed owns expression — **a spec gap, not
a generator lottery**"* (`6c2-genlog.md` STAGE 6b). Place-seed diff on that frame measured
0.00–0.11% while the failure was 100% confined to one head.

**Fix direction — NO rollback achieves it.** The delta recipe (parent + canonical, ≤4 seeds) is the
pipeline's founding shape and no prior state stated expression authority; the gap has existed since
`seed_roles_text` was written. The minimal generalized change is one string: the `parent` and
`canonical` role details already enumerate what each seed grants — they simply never name the face.
Saying which seed owns eye/brow/mouth on a delta is an edit to prose forge already emits, not a new
mechanism.

### 6. M7 — PRE-GEN GATE COVERAGE (structural; see question (b) below)

### 7. M6 — NO REPAIR CLASS FOR A POSE DRIFT (affects every retry wave)

`_retry_scene` accepts `defect` ∈ {content, seed, mechanism} (**2118-2119**), hard-refuses any
additive `instruction` (**2125-2127**), and `_EXPRESSION_RETRY` (**1981-1984**) refuses any
expression word anywhere in a scene retry. `_retry_step1` accepts `defect` ∈ {expression, rig}
(**2228**). **A pose/action drift is in neither set**, so a card that came back in the wrong posture
can only be argued with in scene prose — which is what moved L48's face. The 6c2 worker hit this wall
and logged it verbatim: *"a POSE/ACTION drift is neither, so the card itself cannot be re-minted
through the sanctioned retry path."*

**Fix direction — extend an existing enum** (`pose` as a third `_retry_step1` defect class). Not a
rollback; not a new mechanism either — the re-mint path already exists and already rebuilds the card
from its own recipe.

### 8. M8 — SEED-CAP ORDERED DISPLACEMENT — **0 / 246. FALSIFIED.**

The named suspect (commit `0e7e8d8`, ordered displacement crowd → interaction template → tagged
prop, **1861-1906**) **never fires on this video**. Measured over the full dry-run rebuild: maximum
seed count is 4, exactly **one** shot sits at the cap (L33), and `assets_omitted` is empty on every
one of the 246 scenes. No card was ever dropped by the cap. Every "unseeded" figure Daniel saw was
unseeded because nothing was ever built to seed it — not because a seed was displaced.

**Fix direction — none. Do not roll back `0e7e8d8`; it is inert here.**

---

## Daniel's question (a): "did we loosen character, expression, skin tone, poses, rigging?"

**Mechanically: the RIG was not loosened — it was tightened. What was loosened is WHO may appear and
WHAT the prose is allowed to do without a seed.** Evidence, axis by axis:

| axis | verdict | evidence |
| --- | --- | --- |
| **rigging** | **TIGHTENED** | §3 gained a `line-register` FLOOR for the whole frame, not just the figure, and head tone gained "no blush" (diff `aa576b9…52b17ab`, style-bible.md §3). `depicts_figures` (198-204) widened the rig-hold trigger to prompt CONTENT. `forge.py` gained a fail-loud base guard (27bc7e2). |
| **character (identity)** | **LOOSENED — this is the real change** | `shot_cast`: `if n in chars and n != "base":` → `if n in chars:` (**ea71f99:469 → 27bc7e2:486**). visual-grammar §2's "An anonymous foreground human does not exist… is CAST" (**ea71f99:148**) was replaced by the seeded-performer tier. 116 of 246 shots now stage an identity-less figure. |
| **skin tone** | **NOT loosened — it is PINNED, and that is the complaint** | Named cast head tones live in the registry (`terry-johnson` #f5ead6, `ibm-suit` #7a4f33, `miniscribe-rep` #e2b78c…). A performer has no entry: it inherits `base`'s #f5ead6 through role prose that says "head/face/hand form, proportion and **head tone** come from this image" (**1301-1304**). Crowd is locked to "round **cream-family** heads" (§2d). Cream is the rule, not drift. |
| **expression** | **LOOSENED for two tiers, unchanged for STEP-1** | STEP-1 still seeds `expr-*` as its own image part (`6c2-slate.json` cards). But (i) crowd was explicitly exempted in the 2026-08-06 window — "carries no seeded pose or expression, so its expression … [is] authored in plain prose"; (ii) a delta never carried expression authority at all (M4). |
| **poses** | **NOT loosened — never sufficient** | The 30-primitive library is unchanged and `seeding_law_violations` still refuses a named-but-unseeded primitive (819-822 on a STEP-1 card, 936-939 on a scene). What is unenforced is `SKILL.md`'s own "No library pose covers it → that was a Pass-1 gate item", which is why 91/154 figure scenes act in prose over a stance card. |

So: **yes on character identity and on crowd/delta expression; no on rig, skin tone and poses.** The
single line that did the most damage is the deleted `and n != "base"`.

## Daniel's question (b): does a pre-gen asset review gate already exist beyond the C-6 figure stamp?

**A pre-gen human gate exists, and the four classes he named are precisely the ones outside it.**

What is gated **before** generation:

1. **`SKILL.md` Pass-1 step 2 — "HUMAN PRE-GEN APPROVAL — the gate. STOP. … Generate nothing until
   the human rules."** Its scope is set by step 1, which lists what earns a slot: named characters,
   groups, recurring props, and pose/expression/interaction primitives. This gate fires **only for
   assets the registry/library LACKS** — step 3 ("Reuse before regenerate") records an existing hit
   as `reused` with no human ruling, so an already-registered pose or expression is never re-gated.
2. **C-6, in code: `figure_reuse_refusal` (forge.py:1769-1775)**, and only on the **REUSE** path —
   a staged STEP-1 card that already exists on disk needs an all-pass review record whose
   `canonical_sha256` still matches the bytes. A card **minted in the same batch is not gated by any
   code at all**; the 6c2 run's card-before-scene split ("6c2-wave1-figs.json / 6c2-wave2-scenes.json
   so every performer card is rig-verified BEFORE a scene spends on it") was an *operator convention*
   in that worker's genlog, not a forge law.
3. **Parked-parent refusal (forge.py:2086-2088)** — a chain parent whose scenes-manifest
   `review_status` is `parked` may not be inherited. Negative half only, and it reads
   `assets/scenes/manifest.json` — a plate living in `visual-kit/_staging/` (where **every frame of
   this entire run lives**) has no manifest record, so `_scene_manifest_entry` returns `None` and
   **no gate applies**. The L28 plate that seeded six children was reviewed by a human operator, not
   by the pipeline.

What is **not** gated, by explicit design — `SKILL.md` Pass-1 step 1, final bullet, verbatim:

> **"Environments, plates, one-off props and anonymous crowds get NO slot."**

Grep confirms it in code: the only review stores forge ever reads are `FIGURE_REVIEW`
(`<kit>/_staging/review.json`, figures only) and the scenes manifest. `vfile()` resolves every pose,
expression, interaction template, prop and environment reference straight from the registry with **no
review record consulted anywhere** (cmd_batch:1639-1641).

**So Daniel's proposal is half-built.** The classes he named — plates, poses/expressions as a
standing library, objects — have either no gate (plates, environments, one-off props, crowd) or a
one-time build-only gate that never re-fires (poses, expressions).

**Fix direction — generalize the existing predicate, do not build a new wave.**
`figure_reuse_blocker(staging_dir, fn, frame, store_label)` (**1500-1527**) is already
asset-agnostic: it takes a staging dir and a name, and is already documented as deliberately
callable without a `Kit` so the review board and forge cannot disagree about what "reusable" means.
Pointing it at plates/props/primitives and letting `stamp_review.py --figures`' existing store carry
their verdicts covers Daniel's ask with the machinery already in the file. A separate pre-gen
"review wave" would duplicate a gate that exists.

---

## Notes for the synthesis worker (rollback-over-addition ledger)

| mechanism | rollback available? | target / why not |
| --- | --- | --- |
| M1 performer tier | **YES** | `ea71f99` — forge.py:469 `and n != "base"` + visual-grammar.md:148. Keep the loud refusal by re-pointing the existing `anon_foreground` refusal text (763-767) at a `base` casting. |
| M3 crowd prose-expression exemption | **YES (half)** | remove the sentence added at `27bc7e2`. The cream-head clause is a doctrine EDIT (§2d, one phrase), no rollback exists. Crowd hair + era attire need **nothing** — already law since `aa576b9`, simply unrendered. |
| M2 pose gap | **no** | the library was never richer. Enforce `SKILL.md`'s existing "No library pose covers it → Pass-1 gate item" in lint, or extend the existing per-shot costume derivation to carry the action. |
| M4 delta expression authority | **no** | never existed. One-string generalization of `seed_roles_text`'s `parent`/`canonical` role prose. |
| M5 unanchored environments | **no** | authoring: 121 figure shots declare no `place`. Lint already knows `place`. |
| M6 pose retry class | **no** | add `pose` to `_retry_step1`'s existing defect enum (2228). |
| M7 gate coverage | **no** | generalize `figure_reuse_blocker` (1500-1527) — already asset-agnostic by design. |
| M8 seed-cap displacement | **N/A** | 0/246. Inert. Leave `0e7e8d8` alone. |

Two of Daniel's own asks are **already satisfied on paper and failed in the render** — crowd hair and
setting-appropriate crowd attire (§2d since `aa576b9`). Proposing new doctrine for them would add
rules to fix an obedience problem.
