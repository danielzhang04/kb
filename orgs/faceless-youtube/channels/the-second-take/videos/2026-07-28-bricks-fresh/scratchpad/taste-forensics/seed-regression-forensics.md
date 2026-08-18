# Seed-card regression forensics — why "perfect in mass" became pro 1/10

Investigator: forensic subagent, 2026-08-18. READ-ONLY. Worktree `C:/Users/danie/kb-worktrees/boss-taste-forensics`, branch `claude/bricks-taste-forensics`, HEAD `31152f12`.

**Question.** W2 STEP-1 character seed cards (character x expression x pose figure cards) were previously
"perfect in mass" per Daniel. The 2026-08-18 engine duel on 10 forge-derived cards scored pro 1/10
strict-verified, flash 0/10. Which of (a) code/doctrine regression, (b) operator error,
(c) verification-standard drift, (d) non-comparable card class does the evidence support?

**Headline, stated up front so the rest can be checked against it.** For three of the ten duel cards
the assembled STEP-1 prompt, the seed list, the engine and the image size are *byte-identical* to the
2026-08-14 A/B round that scored **pro 5/5**. `forge.py` has not been touched since 2026-08-13. The
inputs did not change; the ruler did.

---

## 1. Timeline of relevant commits

Every commit below is on `claude/bricks-taste-forensics` (or its ancestry). "Payload" means the
STEP-1 figure-card prompt assembled by `forge.py:figure_card_payload` (+ `beat_clause`,
`seed_roles_text`).

| Date | SHA | What changed, w.r.t. STEP-1 figure-card prompt assembly |
|---|---|---|
| 2026-07-30 | `6735796d` | **Ground-line clause born.** "on a thin visible ground line with one soft contact shadow directly beneath it" + "This is a reference sheet: the character alone…" first appear — inline inside the seed-roles builder, *no* beat clause. This is the clean pre-beat shape. Wording of the ground-line sentence is unchanged from here to HEAD. |
| 2026-08-03 | `d6d07bb4` | forge anchor/retry layer added (STEP-1 retry overlay origins). |
| 2026-08-04 | `703b5dc8` | Truthful seed roles, delta recipe, surgical retries (overlay@2), payload-final zones. Payload extracted into its own function. |
| 2026-08-04 | `f4ca9b56` | Hardened flat-cel style descriptor forced onto every request (the fixed style header). |
| 2026-08-05 | `d1f771a7` | Era restoration: 2-voice style, HARDENED block deleted, **1K default**, style tile registered. |
| 2026-08-06 | `ea71f99e` | Style-bible §2b/§5 + `STYLE_ANCHOR_ROLE` reworded DISCIPLINE→SATURATION (grayscale-drift fix). |
| **2026-08-06** | **`52b17ab2`** | **Beat clause born.** `The scene this card is minted for reads: {…}` first enters the payload, scoped **clothing-only**: "Take from that description ONLY the CLOTHING it implies — garments, headwear, footwear — … draw none of its setting, props, lettering or other people." Object nouns from the scene sentence begin entering card prompts here. |
| 2026-08-07 | `ede2f56e` | 6c2 wave; `strip_micro_pattern_texture` applied to the clause. Payload otherwise as 08-06. |
| 2026-08-12 | `db0ffd14` | P2 — seeded-performer tier abolished (rollback of `ea71f99`'s tier). |
| **2026-08-12** | **`e088c455`** | **P8 — the act half added.** Clause widened from clothing to clothing + THE BEAT'S OWN ACT. New text: "and the bodily ACT it gives this figure — draw the figure performing that act WITHIN the stance the pose reference holds, **empty-handed and alone, the object or person it acts on left out**". This is the exact self-conflicting pair the w2-partial report isolated: the beat sentence names the rake/brick/carton, then the fence orders it out. |
| 2026-08-12 | `72a02609` | P9+P10 — delta face-ownership prose; **`pose` joins the STEP-1 retry defect enum** (enum now expression/rig/pose — still no `clean_card`). |
| 2026-08-12 | `78dbc47c` | P12 — expr-shock / expr-pleading removed from library + gen logic. |
| 2026-08-12 | `34e39e9c` | Whole-branch fix set, SHIP verdict. |
| 2026-08-13 | `10b48774`, `e2a955f0` | G4 follow-ups, resting-face law, registry truth. |
| **2026-08-13** | **`1be54d18`** | **Last commit to touch `forge.py`.** Plate-composition law (plates compose for character placement). Does not alter `figure_card_payload` / `beat_clause`. |
| 2026-08-13 | `df962f98`, `abd3ed95` | Registry: 4 parked canonicals resolved (flat-fill retries), Daniel asset rulings, vetoed primitives deleted. Last registry change before the duel. |
| **2026-08-14** | **`f1d0071e`** | **Engine A/B round 1: pro 5/5, flash 4/5.** Frozen spec `taste-forensics/ab-test-items.json` — 3 STEP-1 figure cards + 2 scenes, 1K, gemini-3-pro-image / gemini-2.5-flash-image. |
| 2026-08-14 | `4eacbdfa`, `8aeaf5e1` | Spend-law correction only ($0.134/gen, not $0.039) + ledger deltas. No prompt/code effect. |
| 2026-08-17 | `46076bff` | Crowd-rig minimal wave: `lint_shots.py` figures? guard, `stamp_review.py`, `build_review_artifact.py`, three shot rewords (L87/L75/L174). **`forge.py` untouched; none of the reworded shots are in the duel set.** |
| 2026-08-17 | `c4ab957b` | Crowd-proportion doctrine: `style-bible.md` §2d crowd prose + `test_forge_figures.py` expectation. **Crowd-rig only — STEP-1 named-cast cards do not read the crowd clause.** `forge.py` untouched. |
| 2026-08-18 | `05e50d0c` | The W2-slice duel: 10 forge-derived STEP-1 cards x pro/flash, K=2 workers, fresh-eyes verifier pair, strict merge. pro 1/10, flash 0/10. |
| 2026-08-18 | `31152f12` | Duel board (49 embeds, verdict chips, lightbox). |

**The load-bearing fact in this table:** between the 2026-08-14 A/B round (pro 5/5) and the 2026-08-18
duel (pro 1/10) **no commit touched `forge.py`, `beat_clause`, `figure_card_payload`, the registry, or
any style/doctrine text that a named-cast STEP-1 card reads.** The two 08-17 commits are crowd-rig and
lint scoped and provably out of the duel's path.

---

## 2. Prompt diff — perfect era vs now

### 2.1 The decisive comparison: 2026-08-14 vs 2026-08-18, same cards

Three card IDs appear in **both** the 08-14 A/B frozen spec and the 08-18 duel spec:

- `fig-drive-maker--carry-by-handle--expr-deadpan--f1c1d333` (from L18)
- `fig-brick-foreman--back-to-viewer--7a3b93be` (from L22)
- `fig-brick-foreman--hold-one-hand--expr-deadpan--ecc1ee75` (from L27)

Sources compared:
`.../scratchpad/taste-forensics/ab-test-items.json` (08-14, field `prompt` = full assembled request)
vs `.../scratchpad/w2-slice/slice-spec.json` (08-18, fields `delta` + `payload`; forge prepends the two
fixed headers at send time, so the 08-14 `prompt` minus its first two paragraphs is the comparable text).

Result after dropping the two fixed headers and repairing a cp1252 mojibake artifact in the 08-14 JSON:

| Card | 08-14 tail == 08-18 `delta` | Seeds identical | Similarity before mojibake repair |
|---|---|---|---|
| `…carry-by-handle…f1c1d333` | **YES** | YES (`drive-maker.png`, `expr-deadpan.png`, `carry-by-handle.png`) | 0.97787 |
| `…back-to-viewer…7a3b93be` | **YES** | YES (`brick-foreman.png`, `back-to-viewer.png`) | 0.99320 |
| `…hold-one-hand…ecc1ee75` | **YES** | YES (`brick-foreman.png`, `expr-deadpan.png`, `hold-one-hand.png`) | 0.99314 |

The *only* residual differences were literal em-dash bytes: the 08-14 driver stored `—` as cp1252-mangled
`\u00e2\u20ac\u201d` inside its own JSON snapshot. That is a **storage artifact of `ab-test-items.json`,
not of the sent prompt** — the 08-14 driver report itself records "An independent reassembly from
`ab-dry-full.json` compared all five prompts byte-for-byte". Same engine (`gemini-3-pro-image`), same
`image_size: 1K`, same aspect.

**There is no prompt regression between the 08-14 pro-5/5 round and the 08-18 pro-1/10 duel. The
STEP-1 request is the same request.**

### 2.2 The longer-baseline diff: what a STEP-1 card prompt looked like per era

Reconstructed from `git show <sha>:orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py`.

**Era A — 2026-07-30 (`6735796d`), pre-beat / poyais-shape.** No beat clause at all. The card carried
seed-role prose plus:

> The whole figure is in frame head to feet, standing or seated exactly as the pose reference shows, on a thin visible ground line with one soft contact shadow directly beneath it. Flat solid pale-grey studio backdrop, no scenery, no props, no furniture. This is a reference sheet: the character alone, fully resolved, ready to be placed into a separate scene.

No scene object noun could reach the card, because no scene text was spliced in. This is the only era
that is structurally immune to the object-leak mechanism.

**Era B — 2026-08-06 → 2026-08-11 (`52b17ab2`, `ede2f56e`; the 6c2 wave), clothing-only beat clause.**

> The scene this card is minted for reads: {clause} Take from that description **ONLY the CLOTHING it implies** — garments, headwear, footwear — and dress the figure in it for that era, work and setting, never the rig template's default hoodie; draw none of its setting, props, lettering or other people.

The object noun now reaches the card (the clause is the raw scene sentence), but the very next words
narrow the read to *clothing only* and give the model no instruction to depict any action. The fence
and the quoted text do not disagree about what the body is doing.

**Era C — 2026-08-12 → today (`e088c455` P8, unchanged through HEAD).**

> The scene this card is minted for reads: {clause} Where that description AUTHORS clothing — garments, headwear, footwear — dress the figure in it for that era, work and setting; where it authors none, the costume the canonical seed pins governs unchanged, and never the rig template's default hoodie**; and the bodily ACT it gives this figure — draw the figure performing that act WITHIN the stance the pose reference holds, empty-handed and alone, the object or person it acts on left out**. Draw none of its setting, props, lettering or other people.

**The exact divergent clauses, Era B → Era C:**

| | Era B (08-06/6c2) | Era C (08-12 → now) |
|---|---|---|
| scope of the quoted scene text | `Take from that description ONLY the CLOTHING it implies` | `Where that description AUTHORS clothing … where it authors none, the costume the canonical seed pins governs unchanged` |
| action instruction | *absent* | `and the bodily ACT it gives this figure — draw the figure performing that act WITHIN the stance the pose reference holds` |
| object fence | implicit (clothing-only read) | explicit negation: `empty-handed and alone, the object or person it acts on left out` |
| ground line | identical | identical |
| reference-sheet sentence | identical | identical |
| backdrop fence | identical | identical |

So Era C is where "draw the act, but not the thing the act is done to" was created. It is a genuine
prompt-design defect — a positive instruction to depict an interaction immediately followed by a
negation of the interaction's object, with the object still named a sentence earlier. It is the
mechanism behind the duel's `clean_card` and `payload_fidelity` failures (pro 3/10 leaked, flash 6/10
leaked, per `w2-partial/report.md`).

**But Era C is 2026-08-12 and the pro-5/5 A/B round is 2026-08-14.** The defect was already live and
already in these exact prompts when the round scored 5/5. It therefore explains *some card failures*
but cannot explain the *change in score*.

### 2.3 The ground line: unchanged text, newly enforced

`git log -S'thin visible ground line' -- forge.py` returns exactly one commit: `6735796d`, 2026-07-30.
The sentence has been word-for-word identical for 19 days across every era, including the whole
"perfect in mass" period. The duel fails it on **15 of 20 cards** with the identical verbatim finding
("only a soft contact-shadow ellipse is visible under the feet, with no distinct thin ground line").
(Recounted from `verdicts/{pro,flash}-B.json`: pro 6 + flash 9 = 15. `w2-slice/build_duel_board.py:121`
says 14/20; the verdict files are the primary record and say 15.)

A clause that has never changed, on a model that has never drawn it, failing 75% of cards only now,
is by construction a *measurement* event, not a *generation* event.

**It was noticed before — and explicitly ruled cosmetic.** Two prior reviewers saw the same miss and
passed the card anyway:

- `scratchpad/sweep-report.md` (2026-08-05), as an aside outside the scored invariants on a canonical's PASS verdict: *"**minor miss:** the authored 'thin visible ground line' is absent (contact shadow present) — consistent with `qt-wiles` and `hq-banker`, which also ship without one."*
- `scratchpad/6c2-genlog.md:175` (2026-08-07), inside a PASS verdict's evidence: *"…proportion, ground line + single contact shadow and text-free all hold…"*

So the behaviour is at least 13 days old, was seen, and was tolerated as forgivable by the very eras
that produced the "perfect" cards. **Crucially, the rulebook the review procedure names does not
contain it at all:** `image-generation/SKILL.md` states *"The rules this review judges by are
`style-bible.md` §3 … there is no separate reviewer rulebook"*, and `style-bible.md` §3/§5 carry no
ground-line invariant. Verifier B's `framing` axis is therefore **out-of-rubric** — it enforces a
generation-prompt flourish that the reviewer's own rulebook never made a law.

Its arithmetic weight is recorded in the duel's own merge file
(`w2-slice/verdicts/merged.json`, `strict` block):

```
pro:   verified 1 / 10   |  verified_excl_groundline 3 / 10
flash: verified 0 / 10   |  verified_excl_groundline 2 / 10
```

The ground-line axis alone is worth 2 of pro's 9 failures.

---

## 3. Verification-standard comparison

### 3.1 The four rulers, applied to the SAME ten duel cards

All four numbers below are computed from the duel's own stored verdicts
(`w2-slice/verdicts/{pro,flash}-{A,B}.json`) and from `w2-partial/verdicts.json`.

| Ruler | Axis set | pro | flash |
|---|---|---:|---:|
| **Machine tier** (`w2-partial/verdicts.json`, "machine-tier vision review", 2026-08-18) | `identity_vs_canonical`, `head_face`, `hands`, `outline`, `flat_cel_palette`, `pose`, `expression`, `clean_card` (8) | **7/10** | n/a |
| **Verifier A alone** (duel) | `rig`, `identity`, `proportion`, `pose`, `expression`, `integrity` (6) | **6/10** | 4/10 |
| **Old-standard-equivalent** (A's axes + B's `clean_card`/`style`/`lettering`; the two never-before-used axes excluded) | 9 | **4/10** | 2/10 |
| **Duel strict merge** (A AND B, all 11 axes conjunctive) | + `framing`, `payload_fidelity` | **1/10** | 0/10 |

For scale, the actual "perfect in mass" record — a *different* card set under a *different* ruler,
included here to show what the remembered number was made of:

| Reference | Axis set | score |
|---|---|---:|
| **6c2 figure board, 2026-08-07** (`6c2-figure-rulings.json`) | `rig`, `expression-register`, `flat-cel-hazard` (3) | **19/19** |

The entire strict score is set by verifier B: B alone scores pro 1/10 and flash 0/10, identical to the
merge. Verifier A contributes nothing to the headline number. **The 1/10 is verifier B's number.**

Two of B's five axes had never been used to judge a STEP-1 card before this duel:

- **`framing`** — enforcing "a thin visible ground line", failing **15/20** cards. Clause unchanged since 2026-07-30, and absent from `style-bible.md` §3, the rulebook `SKILL.md` names as the review's only authority (§2.3).
- **`payload_fidelity`** — "is the figure empty-handed and alone AND performing the named act". Failing 7/20.

### 3.2 What the perfect-era ruler actually accepted — direct visual audit

This is the part that settles it. The 2026-08-14 A/B round-1 images are still on disk at
`.../scratchpad/taste-forensics/ab-out/`. Three of them are the *same cards, same prompts, same engine*
as the duel. I opened both generations of each pair.

| Card | 2026-08-14 image (counted inside "pro 5/5") | 2026-08-18 image (PARKED) |
|---|---|---|
| `…carry-by-handle…f1c1d333` | Figure carries a **fully rendered metal briefcase**. **No ground line** — contact-shadow ellipse only. | Figure holds only a vague handle/rod stub. **Has a clean thin ground line** spanning the frame. |
| `…hold-one-hand…ecc1ee75` | Figure hauls a **grey dust sheet off a four-tier shrink-wrapped pallet stack on a wooden pallet** — an entire built environment on a "reference sheet: the character alone". **No ground line.** | **Completely clean**: figure alone on flat pale-grey, zero props, zero scenery. No ground line. |
| `…back-to-viewer…7a3b93be` | Figure plus a **lit doorway/window with a cast light wedge** (scenery). **A visible ear is drawn** through the hair. Has a ground line. | Clean, no scenery. A visible ear is drawn (verifier A's `rig` fail). No ground line. |

Read that table twice. Under the duel's strict standard the 2026-08-14 "5/5" set would have scored
**0/3** — every one of them fails `clean_card`, two fail `framing`, and one fails `rig` on the very
same drawn ear the duel flagged. Meanwhile the 08-18 `ecc1ee75` card is a *dramatically better*
character seed card than its 08-14 counterpart — perfectly clean where the accepted one carried a
whole pallet set — and it was PARKED.

**The perfect-era ruler did not measure `clean_card`, `framing`, or `payload_fidelity` at all, and did
not catch a drawn ear.** Nothing in `ab-driver-report.md` defines a pass criterion; the report defines
only the frozen spec, the $0 dry-run proof, the seed-SHA check and the cost cap.

**"pro 5/5" is a delivery tally, and this is provable in code, not inferred.**
`taste-forensics/ab_board.py:111-112` hard-codes the board's own summary rows:

```
gemini-3-pro-image      … 5/5 … "one 503, cleared on re-issue"
gemini-2.5-flash-image  … 4/5 … "200-no-image twice on the same card"
```

Those are HTTP outcomes — requests that returned an image. The flash "4/5" is a *transport* failure,
not a quality failure. The board's only quality guidance is unscored instructional prose aimed at a
future human viewer (`ab_board.py:139`: *"Judge identity fidelity, flat-cel register, outline weight,
palette discipline — zoom everything."*). **No verdict JSON exists for round 1 — nor for ab2, ab3 or
ab4**, whose headline numbers are likewise "30/30 delivered", "24/24 OK", "20/20 OK". The first round
to even stage a fresh-eyes rubric is `ab5-real` (2026-08-17), whose
`ab5-real/{pro,flash}/verdict-skeleton.json` carry axes `rig` / `expression-register` /
`flat-cel-hazard` with **every field left as an empty string** — never scored, and it fed the same 10
card IDs straight into the 08-18 duel.

So the number Daniel's "perfect in mass" most plausibly attaches to was never a quality measurement
at all.

### 3.3 The duel's ruler, and why it is harsher than any predecessor

- **Two fresh-eyes verifiers with disjoint axis sets** (A: 6 rig/identity axes; B: 5 card-discipline axes), neither seeing the other's rubric.
- **Conjunctive strict merge** across all 11 axes: one fail anywhere on either side parks the card. With 11 independent axes and a fresh-eyes reader instructed to hunt defects, the per-card survival probability collapses even at high per-axis quality.
- **New axes minted for this run.** `framing` and `payload_fidelity` are not in forge's own review vocabulary. Forge's STEP-1 retry enum (`forge.py:2736`) still permits only `expression`, `rig`, `pose` — the pipeline has no way to *act* on a `framing` or `clean_card` verdict, which is why the w2-partial operator had to file `clean_card` failures under `rig` to obtain a re-mint.
- **`payload_fidelity` is scored against a self-contradicting instruction** (see §4, problem P1), so some cards fail it for obeying the fence and fail `clean_card` for obeying the act.
- **`framing` has no basis in the rulebook.** `SKILL.md` defines the review as **three** axes — *Identity/rig*, *Fidelity*, *Style/taste* — and states *"The rules this review judges by are `style-bible.md` §3 … there is no separate reviewer rulebook."* `style-bible.md` §3/§5 contain no ground-line invariant. Verifier B enforced a generation-prompt flourish as law.
- **The duel's axis split comes from `w6-orchestration-protocol.md:66-67`**, which assigns A "identity/rig, count, canonical match, costume, proportion, hands/head/face, held-set continuity, expression register" and B "fidelity to `still_prompt` + full `vo_text`, place/seed routing, style/taste, flat-cel and line register, crowd bounds, DSG-lite for lettering". Note B's brief is written for **scenes** — "fidelity to `still_prompt` + full `vo_text`", place routing, crowd bounds. Applied to a STEP-1 *reference sheet*, "fidelity to the prompt" becomes `payload_fidelity`, i.e. demanding the card depict a scene act it is simultaneously forbidden to depict. **B's rubric was not written for this artifact.**

**Axis-vocabulary instability, in one line:** on 2026-08-18 alone, three different axis sets judged the
same card class — verifier A's 6, verifier B's 5, and the machine tier's 8 — while `SKILL.md` defines
3 and forge's retry enum knows 3 different ones again.

**Net:** "perfect in mass" and "1/10" were produced by rulers that do not share a single card-discipline
axis. The 6c2 ruler that returned 19/19 scored `rig` / `expression-register` / `flat-cel-hazard`; the
duel's 1/10 was set entirely by `clean_card` / `framing` / `payload_fidelity`. **The two rulers have an
empty intersection on the axes that decided each outcome.** They are not comparable numbers, and the
gap between them is not evidence about pixels.

### 3.4 Which era I adopt as the "perfect" baseline, and why

Daniel is not supplying a reference board, so I anchor it from disk and git. Two different sets are
needed, because no single one is both *genuinely mass-verified* and *prompt-identical to the duel*.

**Baseline 1 — the quality anchor: the 6c2 figure board, 2026-08-07.**
`scratchpad/6c2-figures-board.html` + `scratchpad/6c2-figure-rulings.json`, commit `ede2f56e`.
This is **the real "perfect in mass" event**: **19 distinct STEP-1 figure cards, 19/19 PASS on every
recorded axis**, with a filled-in fresh-eyes verdict record rather than a delivery count. It is the
only board in the whole scratchpad tree where a two-digit set of STEP-1 cards carries a complete
100%-pass verdict. Its surviving cards are the `fig-*.png` files in
`.../the-second-take/visual-kit/_staging/`.

Two facts about it are load-bearing:

1. **Its ruler had three recorded axes** — `rig`, `expression-register`, `flat-cel-hazard` — collapsing a 10-item rig checklist (`6c2-verify.md:11-14`: head form, no-nose/no-ears, 4-digit hands, outline/line-register, flat cel, uniform head tone, proportion, identity-vs-canonical, expression register-fit, text-free). **No `clean_card`. No `framing`. No `payload_fidelity`. No `pose`.** A card could hold a prop, miss the ground line and mis-hold the pose and still score 19/19.
2. **It is Era B** — the clothing-only beat clause, *before* P8 added the act half (§2.2). So it is not the same prompt class the duel ran.

**Baseline 2 — the controlled comparison: the 2026-08-14 A/B round-1 cards.**
`taste-forensics/ab-out/*__pro.png`, commit `f1d0071e`. Not a quality baseline (its "5/5" is an HTTP
tally, §3.2), but the **only** set whose exact assembled prompts and seed lists survive on disk
(`ab-test-items.json`) and which shares three card IDs with the duel. That makes it the sole
same-card / same-prompt / same-engine / same-size control available — the strongest possible design
for isolating ruler change from input change, which is why §2.1 and §3.2 lean on it.

**Together they bracket the question:** Baseline 1 shows what the "perfect" *ruler* was (3 axes, none
of them the ones that sank the duel); Baseline 2 shows the *inputs* did not change. Neither leaves
room for an image regression.

**Considered and rejected as the primary baseline:**

- **Poyais-era / pre-2026-07-30 cards.** Era A had *no beat clause at all* (§2.2), so those cards cannot leak an object and are not the same artifact class. If Daniel's memory reaches this far back, the honest answer is **(d)**: he remembers a card type that no longer exists, and the fix is to restore its cleanliness (§5, P2).
- **`cast-board.html` (2026-08-04, 33 cards).** More cards than any other board, but it is explicitly a *drift/root-cause audit* board ("5 mechanisms, fix list") — a catalogue of problems, not a pass record.
- **`ab5-real` (2026-08-17).** Verdict skeletons staged and never filled; no scores exist.
- **The `w2-partial` run (2026-08-18, 7/10).** Same day, same ruler family as verifier A — a useful third data point on *today's* images, not a "perfect era".

---

## 4. VERDICT

**The evidence supports (c) STANDARD DRIFT as the dominant cause, with (d) as a real secondary
component and a narrow, specific slice of (a). (b) OPERATOR ERROR is supported only in the limited
sense that the duel was scored against a baseline that never existed. It is NOT an image regression.**

Weighted: **(c) ~70%, (d) ~20%, (a) ~10%, (b) small but real.**

### (c) STANDARD DRIFT — SUPPORTED, and it is the main story

*For:*

1. **Byte-identical inputs.** Three duel cards share prompt, seeds, engine and size with the 08-14 pro-5/5 round, exactly (§2.1). Same request in, wildly different score out.
2. **No code path changed.** `forge.py` untouched since 2026-08-13, before the 5/5 round (§1). The two 08-17 commits are crowd-rig / lint scoped and out of a named-cast card's path.
3. **The old ruler, applied to today's images, reproduces the old number.** Machine tier on the same card class today: **7/10**. Verifier A alone on the duel's own pro images: **6/10**. Only when B's two novel axes are added does it fall to 1/10 (§3.1). And the ruler behind the genuine 19/19 record scored only `rig` / `expression-register` / `flat-cel-hazard` — **none** of the three axes that decided the duel.
4. **The pixel audit inverts the claim.** The 08-14 cards counted inside "pro 5/5" carry a briefcase, a lit doorway, and *an entire shrink-wrapped pallet stack with a dust sheet*; two lack the ground line; one draws an ear. Under the duel's ruler that set scores **0/3**. The 08-18 `ecc1ee75` card is visibly cleaner than the 08-14 one that passed (§3.2).
5. **The 5/5 was never a quality verdict.** `ab-driver-report.md` defines a frozen spec, a $0 dry-run, seed SHAs and a cost cap — and no pass criterion. Five requests returned five images.
6. **An unchanged clause newly enforced, against the rulebook.** "thin visible ground line" has one commit in its life (2026-07-30), is absent from `style-bible.md` §3 (the only rulebook `SKILL.md` authorises the review to judge by), was twice seen and waved through as a "minor miss" in 2026-08-05/08-07 reviews — and now fails 15/20 (§2.3).
7. **The "5/5" was a delivery tally in code.** `taste-forensics/ab_board.py:111-112` hard-codes the row `gemini-3-pro-image … 5/5 … "one 503, cleared on re-issue"` and `gemini-2.5-flash-image … 4/5 … "200-no-image twice on the same card"`. It counts HTTP successes. No verdict JSON exists for round 1, nor for ab2/ab3/ab4 ("30/30 delivered", "24/24 OK", "20/20 OK" — all delivery counts).

*Against:* nothing found. Verifier B's individual findings are, on inspection, factually accurate — the cards really do lack ground lines and really do leak objects. B is not wrong; B is simply the first ruler to look.

### (d) DIFFERENT CARD TYPE / SETTINGS — SUPPORTED, and stronger than I first assessed

*For:* the only genuine mass-pass record in the tree — **6c2, 19/19 STEP-1 cards, 2026-08-07** — is an
**Era B** card: clothing-only beat clause, *no instruction to perform the beat's act, no
"empty-handed and alone" fence* (§2.2, §3.4). The duel generated **Era C** cards. So the artifact that
was "perfect in mass" is literally not the artifact that scored 1/10; P8 (2026-08-12) changed the card
type in between. If Daniel's memory reaches further back still, it is **Era A** — no scene text
spliced in at all, structurally incapable of leaking an object.

*Against:* the *most recent* referent (08-14) is Era C and byte-identical to today — so (d) cannot be
the whole story either. (d) explains why the card class got harder to satisfy; (c) explains why the
score fell.

### (a) CODE / DOCTRINE REGRESSION — SUPPORTED ONLY for 2026-08-12 `e088c455` (P8)

*For:* P8 genuinely introduced a self-contradicting instruction — "draw the figure performing that act
... **empty-handed and alone, the object ... left out**" — after a sentence that names the object. This
is a real defect, it is the mechanism behind `clean_card` and `payload_fidelity`, and it touches **5 of
10** pro cards. Era B's clothing-only clause did not have it.

*Against:* it **cannot explain the score change**, because it was already live, in these exact
prompts, during the 08-14 pro-5/5 round. It lowers the true quality ceiling; it did not move between
the two measurements. Nothing else in code, registry, or style doctrine regressed.

### (b) OPERATOR ERROR — SUPPORTED narrowly

*For:* the run itself was executed correctly — right pipeline (W6 harness), right card class (real
forge-derived STEP-1 cards), unedited forge prompts, seeds SHA-checked. The error is *inferential*: a
freshly-minted 11-axis conjunctive rubric was compared against a remembered number produced with no
rubric at all, and the difference was reported as a regression. Two of the eleven axes had never
judged a card before, and forge cannot even act on them (`forge.py:2736` allows only
`expression`/`rig`/`pose`), which is why w2-partial had to mis-file `clean_card` failures as `rig`.

*Against:* the duel's per-card findings are accurate and its artifacts are honest and complete; it
also correctly surfaced the two real forge mechanisms. As a defect-discovery exercise it succeeded.

### Bottom line

Nothing broke between 08-14 and 08-18. The seed cards today are at least as good as the ones that
were called perfect — on one directly comparable card, visibly better. What changed is that somebody
finally applied a strict rubric, and it found (i) a real P8 double-bind that has been quietly
degrading cards since 2026-08-12, and (ii) a ground-line clause that the model has *never* reliably
obeyed and that nobody had ever checked. Both are worth fixing. Neither is a regression, and the
"1/10" should not be read as one.

---

## 5. Problems found + minimal proposed fixes

Proposals only — no edits were made. Ordered by evidence weight.

### P1 — The P8 double bind (REAL defect, highest value)

`forge.py:1547-1556`. The clause orders the figure to *perform the act* and simultaneously orders the
act's object *out*, one sentence after naming it. Cards fail `clean_card` for obeying the act and
`payload_fidelity` for obeying the fence. Unwinnable as written; touches 5/10 pro, 6/10 flash.

**Minimal fix (recommended): restore Era B's scope for the object, keep P8's act.** Name the act
*without* its object rather than naming it *with* an object and then negating. Concretely: keep "draw
the figure performing that act WITHIN the stance the pose reference holds" and drop "empty-handed and
alone, the object or person it acts on left out" *once the object noun is no longer present to
negate* (see P2). A negation whose referent is still on the page is the weakest possible guard — the
same lesson `beat_clause` already learned for quoted literals ("negative prose is the weaker guard
against a drawn glyph", `forge.py:560`).

### P2 — Assessment of the proposed fix "strip the object noun at assembly"

**Endorsed in intent; the naive form will not work.** Stripping object nouns from a free-prose scene
sentence needs a parse, and `beat_clause`'s existing design note is explicit that no such detection
belongs in code ("No garment detection in code: the model reads its own quoted description",
`forge.py:1527-1529`). A regex noun-stripper will mangle the clothing half, which shares the sentence.

**Minimal viable form:** do not strip in code — **narrow the quoted scope in prose**, Era-B style, and
let the model do the extraction it is already trusted to do for clothing. One clause, no parser:

> The scene this card is minted for reads: {clause} Take from that description ONLY (i) the CLOTHING it implies ... and (ii) the BODILY POSTURE the figure holds — never the objects, people, setting or props it names, which belong to the scene and not to this card.

This keeps P8's benefit (the card is minted in the beat's posture, so the scene stops re-posing a
stance card and redrawing the hands) while removing the name-then-negate pattern entirely. It is a
~2-line change to `figure_card_payload` plus a test.

**Why this shape and not another:** the Era-B clause it restores is the one under which 19/19 cards
passed on 2026-08-07 (§3.4). That is the only STEP-1 clause in this repo's history with a filled-in
mass-pass record behind it. Reverting *to* it is evidence-backed; inventing a third phrasing is not.

### P3 — Assessment of the proposed fix "add a `clean_card` retry type"

**Endorsed, and strictly necessary regardless of P1/P2.** `forge.py:2736` permits only `expression`,
`rig`, `pose`. The w2-partial operator had to file real `clean_card` defects under `rig` "with no
instruction, solely to obtain the sanctioned re-mint" — the retry ledger is therefore **lying about
why cards were re-minted**, which will corrupt any future mechanism analysis.

**Minimal fix:** add `clean_card` to the STEP-1 enum at `forge.py:2736`, with a retry route that
suppresses the derived clause entirely for that attempt (fall back to the Era-A payload shape: seed
roles + stance + backdrop, no beat clause). Rationale: if the card leaked an object, the clause is the
proven cause, so the surgical retry should remove the cause rather than argue with it. Add `framing`
to the same enum only if P4(B) is chosen.

### P4 — The ground line: enforce it or delete it (choose one; do not leave it)

The clause is 19 days old, has never been obeyed reliably, and had never been checked. 15/20 cards
fail it, and it is worth 2 of pro's 9 failures. It appears in the *generation* prompt but **not in
`style-bible.md` §3**, which `SKILL.md` names as the review's only rulebook — so the generator is
asked for it and the reviewer is not authorised to require it. It is currently a **latent trap**:
every future strict verifier will re-fail the entire library on it.

**Two minimal options — this needs a Daniel ruling, not an engineering choice:**

- **(A) Drop it.** Change to "with one soft contact shadow directly beneath it" and delete the ground-line phrase. Justification: the contact-shadow ellipse already conveys ground contact, downstream compositing does not consume the line, and the accepted 08-14 `carry-by-handle` and `ecc1ee75` cards both lacked it. Cost: one clause, one test. Immediately converts 6/10 pro fails to non-fails.
- **(B) Keep and strengthen.** Move it out of the run-on framing sentence into its own imperative at the *end* of the payload (position matters — the payload's own comment notes the fence is "stated last" deliberately), e.g. "Draw one thin straight horizontal ground line across the full width of the frame at the figure's feet." Cost: same, but expect a residual miss rate and a re-mint budget.

Recommendation: **(A)**. It is a stylistic flourish being enforced as a law, and no consumer needs it.

### P5 — The verification standard itself is unversioned

Six vocabularies are in use for one artifact: `SKILL.md` defines 3 axes, the 6c2 record stores 3
different ones, the machine tier uses 8, verifier A uses 6, verifier B uses 5, and forge's retry enum
knows 3 more. Scores from different runs are therefore not comparable — which is the entire reason
this investigation was needed.

**Minimal fix — extend the existing authority, do not invent a parallel one.** `SKILL.md` already
names the single rulebook (*"there is no separate reviewer rulebook"* — `style-bible.md` §3). So:

1. Add the STEP-1 card's card-discipline invariants **to `style-bible.md` §3** (clean card = no props/scenery/other figures; whole figure in frame; ground line — *only if* P4(B) is chosen). Anything not written there is not a fail.
2. Version it, and have every verifier prompt and every stored verdict JSON carry `rubric: step1-card@N`.
3. Derive forge's STEP-1 retry enum from that list rather than letting it drift (closes P3 structurally).

Until this exists, no future "X/10" is meaningful, and any verifier can re-open this same question by
inventing an axis.

### P6 — `ab-test-items.json` stores mojibake em-dashes

Cosmetic but it cost real investigation time here, and it will silently break the next byte-for-byte
comparison. The 08-14 driver wrote UTF-8 text through a cp1252 path into its own JSON snapshot. The
*sent* prompts were verified correct at the time; only the archive is corrupt.

**Minimal fix:** whichever driver writes these specs should open with `encoding='utf-8'` and dump with
`ensure_ascii=False`. (`aa576b9b` already fixed one mojibake bug in `forge.py` — same class.)

### What NOT to do

Do not "fix" the engine, re-tune the style bible, or re-mint the library in response to the 1/10. The
images are not the problem. Fix P1/P2 (real, ~5/10 of failures), rule on P4 (~6/10 of failures), land
P3 and P5 so the next measurement is trustworthy — then re-run the same 10 cards under the versioned
rubric and compare against **4/10** (the old-standard-equivalent baseline in §3.1), not against a
remembered "perfect".

---

## Appendix — reproducible checks behind the load-bearing claims

Run from the worktree root `C:/Users/danie/kb-worktrees/boss-taste-forensics`.

**A1. `forge.py` is byte-identical between the pro-5/5 round and the duel.**

```
git log --oneline f1d0071e..HEAD -- orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py
git diff --stat f1d0071e HEAD -- orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py
```

Both return **empty**. No commit, no diff.

**A2. The registry did not change in that window; the style bible changed only inside the crowd clause.**

```
git diff --stat f1d0071e HEAD -- orgs/faceless-youtube/channels/the-second-take/visual-kit/registry/registry.json   # empty
git diff        f1d0071e HEAD -- orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md
```

The style-bible diff is exactly two lines, both inside the §2d CROWD-RIG block, replacing "the base
rig" with "the crowd exemplar" as the crowd proportion comparator. `forge.py` appends that clause only
when a shot declares `figures.crowd: true`; a STEP-1 named-cast figure card never carries it.

**A3. Prompt/seed byte-identity (§2.1)** — reproduced by loading
`taste-forensics/ab-test-items.json` and `w2-slice/slice-spec.json`, dropping the two fixed headers
from the 08-14 `prompt` (`'\n\n'.join(prompt.split('\n\n')[2:])`), repairing the archive's mojibake
(`s.encode('cp1252').decode('utf-8')`), and comparing to the 08-18 `delta`. Equal for all three shared
cards; seed basenames equal.

**A4. Engine and size parity for the duel arm.** The duel run logs do not record the model id, but the
committed spend does: pro $1.34 / 10 gens = **$0.134/gen** (`gemini-3-pro-image`), flash $0.39 / 10 =
**$0.039/gen** (`gemini-2.5-flash-image`) — the exact rates frozen in `ab-test-items.json.rate_usd` for
the 08-14 round. `slice-spec.json` records `"image_size": "1K"`, matching the 08-14 spec.

**A5. Score recomputation (§3.1)** — recomputed directly from `w2-slice/verdicts/{pro,flash}-{A,B}.json`
by all-axes-pass counting; the strict figures match the `strict` block already stored in
`merged.json` (pro 1/10, flash 0/10), which validates the recomputation.

**A6. Images inspected for §3.2** (opened and read directly, both generations of each pair):

- `taste-forensics/ab-out/fig-drive-maker--carry-by-handle--expr-deadpan--f1c1d333__pro.png` vs `w2-slice/pro/fig-drive-maker--carry-by-handle--expr-deadpan--f1c1d333.png`
- `taste-forensics/ab-out/fig-brick-foreman--hold-one-hand--expr-deadpan--ecc1ee75__pro.png` vs `w2-slice/pro/fig-brick-foreman--hold-one-hand--expr-deadpan--ecc1ee75.png`
- `taste-forensics/ab-out/fig-brick-foreman--back-to-viewer--7a3b93be__pro.png` vs `w2-slice/pro/fig-brick-foreman--back-to-viewer--7a3b93be.png`

**A7. Read-only discipline.** The only file this investigation wrote is this report. `git status`
shows one pre-existing unrelated modification (`test_forge_style_tile.py`) and untracked asset/scratch
files that predate the session; nothing in `forge.py`, the skill, the registry, or the style bible was
touched, and no commit, push, or branch change was made.

**A8. Verifier-rubric provenance (gap now closed).** The duel's axis split is defined in
`w6-orchestration-protocol.md:66-67` (`w6-harness-design.md` is generation plumbing only and defines
no axes). The canonical review procedure is `image-generation/SKILL.md:402-423` — three axes
(Identity/rig, Fidelity, Style/taste) judged against `style-bible.md` §3, which carries no ground-line
invariant. The best-specified older machine-tier checklist is `6c2-verify.md:11-14` (10 rig items,
recorded as 3 axes). The axis sets quoted in §3 are read off the stored verdict JSONs themselves,
which remains the strongest evidence for what was actually scored.

**A9. Prior-era acceptance records** (`6c2-figure-rulings.json` / `6c2-figures-board.html` 19/19;
`ab_board.py:111-112` delivery tally; `ab5-real/*/verdict-skeleton.json` blank; `sweep-report.md` and
`6c2-genlog.md:175` ground-line asides) were located and quoted by a parallel read-only search agent
and spot-checked against the primary files cited.
