# Phase 6a — generation sweep REPORT

Companion to `sweep-genlog.md` (call-by-call ledger) and `sweep-shas.md` (every output's SHA-256).

Worktree `C:/Users/danie/kb-worktrees/boss-bricks-reset` (detached at `89c720e`; working tree carries
the 248-shot `shots.json`). `--kit` = MAIN checkout `.../the-second-take/visual-kit`, so every staged
PNG lands in `<main-kit>/_staging/`. `forge.py` run from the worktree.

**Budget $8.00 ceiling / $7.00 stop line. Actual committed: $3.100.** Prices per the established
ledger convention: 2K = $0.134, 1K = $0.039.

> Presented neutrally — the human calibrates the bar. Weaknesses first; nothing below is called
> "good enough". Nothing was registered, promoted, or stamped: `refs/`, `registry.json`,
> `shots.json` and `review.json` were not touched.

---

## Headline

| | count |
|---|---|
| Place plates minted | **7** (L03, L05, L63, L71, L113, L172, L196) |
| Place plates reused | **1** (L28, the probe frame — unchanged on disk) |
| STEP-1 cards minted | **48** |
| STEP-1 cards reused | **1** (`fig-miniscribe-rep--action-powerstance--expr-deadpan`) |
| New cast canonicals minted | **1** (`rifenburgh-ceo`) |
| Surgical retries fired | **4** (1 scene, 3 STEP-1) — **4/4 fixed their named defect** |
| **Banked (defect survived, or blocked)** | **1 blocked** (`rifenburgh-ceo` STEP-1 cards, $0, structural) |
| Provider failures | 3 `no image in response`, all $0, all cleared on the one allowed re-issue |
| **Total spend** | **$3.100** |

---

## Weaknesses first — what deserves Daniel's ruling

1. **Crowd-variety bound is not holding, in both directions.** The amended §2d clause ("vary
   hair/headwear across at most **2–3 repeating silhouettes**") is live in the main-checkout kit
   (verified: worktree and main-checkout §2d are byte-identical) and is in the assembled prompt.
   L172's newsroom crowd still invents an open-ended hairstyle per figure (6+ silhouettes) and gives
   one figure **round spectacles** — which the clause itself calls a rig FAIL. L71's boardroom crowd
   went the opposite way: **every figure uniformly bald**, zero variety, reading as a clone rank.
   **The half that DID land is the important half:** the per-figure face rule held on *both* crowd
   plates — zero noses, zero ears, dot eyes on every figure. That is exactly the defect the edit was
   written to kill (L35's every-loader-grew-a-nose), and it is dead on this evidence. The *bound* is
   the part the provider treats as decoration.
2. **L03 draws FOUR pallets where the shot authors THREE**, and stages them against the stage-left
   wall rather than "stranded alone in the **middle** of a large dark room". A count is a
   load-bearing authored fact, so this is a fidelity FAIL, not softened. **Deliberately NOT retried**
   — see "Retries I did not take" below.
3. **`rifenburgh-ceo`'s STEP-1 cards are blocked at $0** and need one boss action to unblock.
4. **Soft skin shading is systemic, not per-frame.** Cast hands and faces carry a *blended*
   light-to-dark ramp rather than §2b's "ONE hard-edged single-step shadow shape". At ordinary
   viewing scale every frame reads flat-cel; on a crop it does not. Called honestly rather than
   downgraded, but it is a **channel-wide engine trait visible on the existing approved canonicals
   too** (`qt-wiles`, `hq-banker`, `auditor-rep`), so it is a doctrine question, not a defect of this
   batch.

---

## Lane A — place plates

`forge.py gen --batch sweep-plates.json`, 16:13:41 → 16:17:10. **`7 generated, 0 failed, 0 skipped`** —
zero 503s. All 2752x1536, `--aspect 16:9`, 2K.

**Place plates were derived, not assumed:** computed the first-in-file generated shot per `place`
over all 248 shots. This resolved the brief's open item — the computer-shop plate is **L05**.

| plate | place | shots in place | SHA-256 | verdict |
|---|---|---|---|---|
| L03 | brick-warehouse | 39 | `049c7e03fee4e188be3ee8c7107b88697ed33a88befb022b49b004f8b40ea688` | **FLAGGED** — pallet count |
| L05 | computer-shop | 6 | `9447bfc1a479727b8d52c2a69156af91da12c4603187350b5289ea55cccecec5` | clean |
| L63 | wiles-office | 11 | `90cc0c123df5821042c9d53d0f4ee30bce5fcc8ae6b7e5bac76f5d1a575af230` | clean |
| L71 | miniscribe-boardroom | 14 | `cd55cb7f52372b6f06afdf543aa0e4ca4dfe492b253c32c1b77513e96d85da49` | clean (variety note) |
| L113 | brick-company-yard | 5 | `ddb31283f4d1d9e74b13262bfdb146120c83619ff4bd8a89a0addab37ae92cd0` | clean |
| L172 | denver-newsroom | 2 | `ca18a8eb7dff715c16300d01ab5b5da950e07c8a43ab105120f3e656270f36d3` | **FLAGGED** — crowd variety |
| L196 | jury-courtroom | 10 | `35d8f855d7481c55cafcb62778cf032d967a5d0e54b9c0184addd8277dbfa65c` | **superseded** by retry |
| L196-retry1 | jury-courtroom | — | `511272e8b3bd73a6da690730315bdb4f4357609fd39d53427a6f35b4a85df06f` | **retry FIXED lettering** |
| L28 | miniscribe-plant | 46 | `99265f53efda5135f091517c4c6acf2495b234c25de4cbf1c4ed7fac8d956da8` | **REUSED, $0** — probe frame, Daniel-ruled, byte-unchanged on disk (mtime 02:03 Aug 5) |

**Staging-collision guard.** `_staging/` still holds pre-reset scene PNGs `L01`…`L248` from the
abandoned run, which forge's skip-if-exists would have silently returned as "the" result. Rather than
`--force` over them (destroying evidence), the 7 targets were **archived, not deleted**, to
`_staging/_pre-sweep-archive-2026-08-05/`. Every plate above is provably minted under the current
unified descriptor.

### Per-invariant verdicts (forced, ordinary viewing scale)

**L03 — brick-warehouse.** flat-cel PASS · place facts PASS (bare grey concrete, shut roller door
rear, empty steel shelving right wall, high black windows, one tripod work lamp stage-left throwing a
hard amber pool) · all-surfaces-unlettered PASS · palette PASS · **subject count FAIL** — authored
"**three** shrink-wrapped pallets", drawn **four** · **placement FAIL (soft)** — authored "stranded
alone in the **middle** of a large dark room", drawn against the stage-left wall, which weakens the
isolation read · framing authored "from **floor level**", rendered nearer eye-level.

**L05 — computer-shop.** flat-cel PASS · place facts PASS (three shelf bays of beige boxed home
computers, varnished oak counter foreground-right with brass till, cream-and-teal linoleum, street
door open stage-left with light spilling) · cast-free PASS · palette PASS · **DSG lettering PASS** —
window card reads `1983`, transcribed 1-9-8-3, in true §5 register: leaning hand-lettered numerals,
baseline bounce, `#241a12` ink.

**L63 — wiles-office.** flat-cel PASS · place facts PASS (walnut desk angled to a venetian-blinded
window wall stage-right, swivel chair pushed back and empty, hard light bars across the carpet, low
filing cabinet with fern stage-left, black telephone + wire tray, shut background door with a plain
unlettered glass panel, palms through the slats) · unlettered PASS · palette PASS · framing PASS
(wide static from the doorway; the door edge is in frame). **No defect on any axis.**

**L71 — miniscribe-boardroom.** flat-cel PASS · place facts PASS (long table straight down frame,
crowd seated both far sides with folders shut, **two figures standing clear of their chairs at the far
end** — the authored beat, held — plain unlettered plaster, pendant shades down the table's length,
shut door) · framing PASS (one-point down the table) · **CROWD FACE RIG PASS on every figure** — dot
eyes, one simple mouth, no noses, no ears, no teeth · crowd proportion PASS (large round head, short
compact body) · **note, not a fail:** hair/headwear variety is **zero** — the group reads as a clone
rank; the amended clause sets an upper bound (≤2–3) which this satisfies vacuously. Daniel's call
whether the clone read is the joke here · minor: door on the side wall, authored "at the far end".

**L113 — brick-company-yard.** flat-cel PASS · place facts PASS (ranks of red clay brick stacks
running to a low open-fronted drying shed, yard crane on rails, flat steel trolley empty in the
roadway, packed red dust, wide pale sky) · cast-free PASS · **DSG lettering PASS** — gate board reads
`COLORADO BRICK`, transcribed C-O-L-O-R-A-D-O / B-R-I-C-K, complete and correct, in §5 marker capitals
with a slight lean · palette PASS.

**L172 — denver-newsroom.** flat-cel PASS · place facts PASS (desk rows with a typewriter and shaded
lamp each, pigeonhole bank, rail of hanging galley proofs, night-black window; foreground receiver
lifted off its cradle onto a **blank** spiral pad under a lit lamp) · unlettered PASS · framing PASS ·
palette PASS · **CROWD FACE RIG PASS** (verified on a crop — dot eyes, no noses, no ears on every
figure) · **crowd variety FAIL** — 6+ distinct hair silhouettes against the ≤2–3 bound, plus one
figure given round spectacles, which the clause names as a rig FAIL.

**L196 — jury-courtroom (original).** flat-cel PASS · place facts PASS (jury box beyond the rail with
both rows bare, rail clear, raised bench empty with chair pushed back, two counsel tables, boarded
floor, panelled walls to tall sash windows stage-right, every nameplate blank) · cast-free PASS ·
palette PASS · **DSG lettering FAIL (blocking)** — the calendar `1992` is spelled correctly
(1-9-9-2) but rendered in a **clean bold digital sans-serif**, the one thing §5's LOCKED lettering
rule prohibits by name. The `lettering-marker-italic` exemplar **was** seeded and obeyed on L05/L113,
so the request was correctly configured and the render did not comply.

**L196-retry1 — the one sanctioned retry, FIXED.** Authored as a `forge-retry-overlay@2` scene entry
with `defect: content` and exactly ONE authority: an exact `{from, to}` replacement of the single
calendar clause, `changed_spans: 1`, every other byte of the payload held identical, seeds unchanged
(never the failed frame). **Verified on a crop: `1992` now renders in true marker register** —
rounded hand-lettered numerals with a slight lean and baseline bounce in `#241a12`. All the original's
place facts survive. **Honest caveat:** the retry re-rolled the whole composition, so the bench sits
centre-left rather than the authored "bench **centre**", and more of the right wall is in frame. On
the blocking axis the retry wins; on framing the original is closer to the authored line. **Both are
on disk — Daniel picks.**

Lane A spend: **$1.072** (7 plates + 1 retry).

---

## Lane B — STEP-1 figure cards

The slate emits **48 NEW cards**, not 47: `fig-miniscribe-rep--action-powerstance--expr-deadpan` is
the "1 not generated" reuse and is *not* among the 48. Its reuse is confirmed by forge's own C-6
gate, not asserted — it carries an all-pass, digest-current record in `<kit>/_staging/review.json`
(`canonical_sha256 9476a15f…`, verdicts `rig`/`expression-register`/`flat-cel-hazard` all `pass`).

Run in **chunks of 12** so a provider failure surfaces within one chunk instead of after 48 calls
(forge reports an ordinary provider error as `ERR` at $0 and *continues*, so chunking is the
fail-fast mechanism). Re-running a chunk is free and safe — `skip (exists in staging)` protects every
survivor.

| chunk | result | spend |
|---|---|---|
| 1 | 12 generated, 0 failed | $0.468 |
| 2 | 12 generated, 0 failed | $0.468 |
| 3 | 10 generated, **2 failed** (`no image in response`) | $0.390 |
| 4 | 11 generated, **1 failed** (`no image in response`) | $0.429 |
| re-issues | 3 generated, 0 failed — all three cleared on the single allowed re-issue | $0.117 |
| **48/48 present on disk** | verified by name against the slate | **$1.872** |

The three failures (`fig-brick-foreman--expr-smug`, `fig-miniscribe-rep--expr-deadpan`,
`fig-brick-foreman--expr-deadpan`) were clean mechanical no-image responses at **$0**, isolated
rather than a 503 wall (the surrounding calls in the same chunks succeeded), so the spend law's one
unchanged re-issue applied directly with no canary needed. None was re-issued twice.

### Per-invariant review — 48/48 covered

Reviewed on 12 four-up contact sheets at ~640px per figure, with targeted crops on every open,
spread, raised or pointing hand (§3 names those the digit drift point) and a Pillow measurement where
a tone was disputed. Judged against each character's **approved canonical**, which I opened and read
for `qt-wiles`, `hq-banker`, `ibm-suit`, `auditor-rep` and `brick-foreman` rather than an idealized rig.

**44 of 48 clean on every invariant. 3 FAILED and were retried. 1 soft pose miss, banked.**

What HELD across all 48, worth stating because these were the historical killers:
- **No nose, no ears: 48/48.** Not one violation.
- **Four digits (three fingers + a thumb): 48/48**, including the hardest cases — `terry-johnson`'s
  raised spread palm and `qt-wiles--action-recoil`'s TWO raised open palms, both crop-verified at
  thumb + 3 fingers, both hands the same size.
- **De-badging carried through: every `miniscribe-rep` card renders chest and lapels plain** — the
  promoted v2 canonical is doing its job in the seed pixel, with no prose workaround.
- **Identity tags held** where the registry pins one: `qt-wiles`'s gold tie clip, `hq-banker`'s gold
  watch chain, `auditor-rep`'s spectacles-pushed-up-on-the-forehead + brown ledger.

**The 3 FAILURES and their retries — all three fixed on the first retry:**

| card | defect | retry authority | outcome |
|---|---|---|---|
| `fig-ibm-suit--action-armscrossed--expr-deadpan` | **costume/identity FAIL** — the registry's "ONE plain white pocket square … **its single identity tag**" was dropped; the sibling `fig-ibm-suit--expr-deadpan` has it | `step1`, shot L44, `defect: rig`, instruction restoring only the pocket square | **FIXED** — `-retry1` renders it at the breast pocket, clear of the crossed forearms; everything else held |
| `fig-brick-foreman--expr-fear` | **costume/identity FAIL — base-template bleed.** He wears a **brown drawstring HOODIE**, which is the base template's costume, not his pinned cream short-sleeve shirt + dark tie. This is the seed law's named failure mode verbatim ("base-derived seeds are … **hoodied**, so any attribute not sourced from the CHARACTER seed bleeds a base trait") | `step1`, shot L091, `defect: rig`, instruction naming the pinned costume and forbidding the hoodie by name | **FIXED** — `-retry1` renders the cream shirt, dark tie with clip, brown trousers; fear expression held |
| `fig-qt-wiles--action-armscrossed--expr-crestfallen` | **head-tone/identity FAIL** — the face drained to a cold grey-blue while the hands stayed cream, which is both §3's "head tone must MATCH its canonical" and the seed-routing gate's named "hands off the character's tone" defect. **Measured, not eyeballed:** head pixel `(191,197,195)` — R≈G≈B, a neutral grey | `step1`, shot L236, `defect: rig`, instruction pinning face AND hands to the canonical cream | **FIXED** — retry head pixel `(247,232,201)`, warm cream, face and hands one tone; silver hair, grey 3-piece, tie clip, crossed arms, crestfallen all held |

**Banked (no retry spent, surfaced instead):**

- `fig-miniscribe-rep--hold-one-hand--expr-delighted` — **pose FAIL (soft).** The `hold-one-hand`
  primitive did not route: both arms hang at his sides, with no held object and no raised hand. The
  primitive demonstrably works — `fig-brick-foreman--hold-one-hand--expr-smug` renders the grey
  placeholder box correctly from the same primitive. `suspected_mechanism_layer: provider_limitation`
  (softest-seed drop, the same class as expression landing weak). Banked rather than retried because
  the shot consuming it may not need the held object to read; that is a Daniel call, and a retry
  spent now cannot be spent later.

**Minor inconsistencies noted, no retry, no FAIL:** `brick-foreman`'s tie renders brown on
`expr-crestfallen` and black elsewhere; his slim tie clip is present on most cards and absent on
`action-armscrossed--expr-worried`. `hq-banker`'s "deadpan" carries a faint smile on two cards.
`expr-worried` sits toward the big end of its register on `fig-miniscribe-rep--sit--expr-worried` and
`fig-brick-foreman--sit--expr-worried` — the portable card cannot be ruled against a beat, so the
scene review owns that call.

Lane B spend: **$1.989** (48 cards + 3 step1 retries).

---

## Lane C — `rifenburgh-ceo` new-cast mint

| item | mode / size | seed | SHA-256 | price |
|---|---|---|---|---|
| `rifenburgh-ceo` canonical | `new_character`, 2:3, 1K | `refs/base/base.png` (role `reference`) | `d20758210fe88371aad98c282ff511d4ade20b167cab722b387d084f65236499` | $0.039 |

Staged at `_staging/rifenburgh-ceo.png` (848x1264). **Not promoted** — `refs/` and `registry.json`
are boss-owned and untouched.

**Identity is script-earned, not invented.** Script P17: *"In February 1989 a new management team took
over from Wiles, under a guy named Richard Rifenburgh, and they went looking"* — plus the skeleton's
stated Pass-1 mint (`vpw-fresh-skeleton.md` §3). Costume comes from the shots: L177 authors "a plain
dark suit", L185 "dark suiting".

**Per-invariant verdict:** round near-circle head PASS · **no nose PASS · no ears PASS** · dot/oval
eyes on family style PASS · **four-digit hands PASS** (thumb + three fingers, both hands, crop-checked)
· head tone PASS — measured `(217,163,119)` ≈ `#d9a377`, in the warm-mid-tan band asked for and clearly
separated from the cream template and from `miniscribe-rep`'s `#e2b78c` · costume PASS — plain charcoal
single-breasted two-piece, **no waistcoat, no pinstripe**, white shirt, slate-blue tie ·
**de-badging PASS** — chest, lapels, breast pocket and cuffs completely plain: no badge, pin, logo,
pocket square, tie clip, watch chain · neutral face PASS (correct for a canonical) · **flat-cel
BORDERLINE** — soft blended ramp on skin, the systemic trait noted above, present on the existing
approved canonicals too · **minor miss:** the authored "thin visible ground line" is absent (contact
shadow present) — consistent with `qt-wiles` and `hq-banker`, which also ship without one.

**Cast distinctness was designed, not left to chance.** `qt-wiles` = grey 3-piece + gold tie clip +
silver swept hair; `hq-banker` = brown pinstripe 3-piece + gold watch chain + silver hair; `ibm-suit`
= navy pinstripe 3-piece + white pocket square + cropped grey hair. Rifenburgh is the **only
dark-haired executive**, the **only one without a waistcoat**, and the **only one with no metal
accessory** — three independent separations, so he cannot be confused with any of them at a glance.

### BLOCKED — his STEP-1 cards, $0, structural (confirmed empirically, not assumed)

`forge.py batch --shots L177,L185` returns **`2 scene(s) + 0 STEP-1 figure gen(s)`**. Two independent,
correct refusals stack:

1. **The slate emits no card.** forge cannot resolve the slug `rifenburgh-ceo` against `registry.json`
   or the video's `assets/library/manifest.json`, so L177/L185 emit no STEP-1 request and ship the
   backticked token as prose. Both shots' `notes` predicted exactly this.
2. **The seeding law would refuse it anyway.** `_is_canonical()` tests the seed's real PATH — either
   `/refs/<character>/` in it, or the filename stem matching the registry's pinned `base` stem. A
   `_staging/rifenburgh-ceo.png` satisfies neither, and the STEP-1 branch inspects the path directly
   rather than the declared role, so no honest labeling clears it. Identical to the block
   `probe-genlog.md` §12.2 hit and documented.

**Unblock path — one boss action:** promote `_staging/rifenburgh-ceo.png` to
`refs/rifenburgh-ceo/rifenburgh-ceo.png`, add the `characters.rifenburgh-ceo` registry entry
(`head_tone` `#caa07a`, the pinned costume line, `base` pointing at that file) and the video library
manifest row. His two cards then build straight out of `forge.py batch --shots L177,L185` with no
hand-authoring: **`fig-rifenburgh-ceo--action-armscrossed--expr-deadpan`** (L177) and
**`fig-rifenburgh-ceo--hold-paper-by-sides--expr-shock`** (L185), 2 × 1K = **$0.078**.

Lane C spend: **$0.039**.

---

## Retries I did NOT take, and why

- **L03's pallet count.** Doctrine allows exactly one retry per frame and it is a one-shot resource.
  L03 is otherwise the strongest plate in the set and is the seed for **39 shots** — the largest
  place group in the video. A fresh gen re-rolls the whole composition (L196-retry1 just demonstrated
  that), so spending the retry here risks trading an excellent 39-shot anchor for a corrected count
  on a frame whose miscount most viewers will not register. **Surfaced for Daniel instead**: if he
  wants three pallets, the retry is still unspent and costs $0.134.
- **L71's zero crowd variety.** The amended clause sets an upper bound, not a floor, so this is not a
  clause violation — it is a taste call about whether a clone rank of identical bald managers is the
  right read for a boardroom beat. Not mine to spend a retry on.
- **L172's crowd variety.** This one IS a clause violation, but the mechanism is the same one that
  survived a full doctrine edit and a retry on L35: the clause is present, correct and unambiguous,
  and the provider does not hold it on a large multi-figure group. `suspected_mechanism_layer:
  provider_limitation`. Re-rolling an unchanged mechanism is what the doctrine forbids; the fix is a
  mechanism change (a per-shot cap on the crowd's declared figure count, or a bounded-silhouette list
  named in the shot's own prose), which is a doctrine proposal, not a retry.

---

## C-6 gate — skeleton built, NOT stamped

```
py -3 build_review_artifact.py --video <video> --out scratchpad/sweep-c6-board.html \
    --staging <main-kit>/_staging
```
→ `sweep-c6-board.html` (51 images, 5.4 MB) and
→ `assets/_review/figure-verdicts.json` — **51 STEP-1 figures pending a C-6 ruling** (48 cards + 3
retries), pre-keyed by id with `canonical_sha256` computed from the bytes on disk and **every verdict
left EMPTY**, exactly as the single-writer law requires.

**Not stamped, by design.** `stamp_review.py` is the only writer of a verdict anywhere in this
pipeline and the orchestrator alone runs it. The verdicts above are this pass's fresh-eyes rulings
and are the *input* to that step, not a substitute for it. Until the boss runs

```
py -3 stamp_review.py --figures <video>/assets/_review/figure-verdicts.json <main-kit>/_staging
```

**forge will refuse to reuse any of the 51 cards as a seed** — already observed live: a full-file
`forge.py batch` now reports refusals naming the freshly-minted cards and printing the re-mint
invocation. That is the C-6 reuse gate working, not a defect, and it is the hard blocker on the
scene-generation leg.

---

## Spend ledger

| lane | items | spend |
|---|---|---|
| A — place plates | 7 × 2K | $0.938 |
| A — L196 surgical retry | 1 × 2K | $0.134 |
| B — STEP-1 cards | 48 × 1K | $1.872 |
| B — STEP-1 surgical retries | 3 × 1K | $0.117 |
| C — `rifenburgh-ceo` canonical | 1 × 1K | $0.039 |
| provider failures | 3 × no-image | $0.000 |
| **TOTAL** | **59 paid calls** | **$3.100** |

Against the $8.00 ceiling: **$4.90 unspent**, and $3.90 below the $7.00 stop line. Nothing was
aborted for budget.

---

## Follow-up (2026-08-05) — `rifenburgh-ceo` STEP-1 cards, unblocked and minted

The boss promoted `rifenburgh-ceo` (`refs/rifenburgh-ceo/rifenburgh-ceo.png`, SHA-256
`d2075821…6499` — byte-identical to the Lane-C canonical above; `registry.json` `characters`
entry live), clearing the two refusals recorded in "BLOCKED — his STEP-1 cards" above. Dry-run
confirmed **exactly 2 STEP-1 GENERATE cards** (`forge.py batch --shots L177,L185`), matching the
prediction; both fired live under the $0.20 hard budget for this leg.

| card | shot | result | verdict |
|---|---|---|---|
| `fig-rifenburgh-ceo--action-armscrossed--expr-deadpan` | L177 | generated, attempt 1 | **PASS** — no defect on any axis |
| `fig-rifenburgh-ceo--hold-paper-by-sides--expr-shock` | L185 | generated, attempt 1 | **PASS** — four-digit hands crop-verified both sides, hand tone matches head tone (measured) |

Both cards cleared full-invariant review on the first attempt: round head, no nose/no ears, the
pinned charcoal two-piece with no waistcoat, dark-brown hair, complete de-badging (no badge/pin/
pocket-square/tie-clip), and head tone in the `#caa07a` family (sampled `(220,163,118)` /
`(214,163,116)`). No provider failures, no 429/503, no re-issue exercised, zero retries spent —
neither card carried a named defect. Full ledger: `sweep-genlog.md` §7.

**Spend this leg: $0.078** (2 x 1K STEP-1, $0.039 each) against a $0.20 hard ceiling —
**$0.122 unspent.** Running total across both passes: **$3.178.**

**Still open (unchanged from above, not in this leg's scope):** the two `L177`/`L185` **scene**
composites (the actual boardroom-arrival and corridor shots) are not yet built — this leg minted
only the two STEP-1 figure cards the boss's card asked for. They now build straight off
`forge.py batch --shots L177,L185` once the C-6 gate stamps these two figures (`stamp_review.py
--figures`, orchestrator-only, not run by this pass — same single-writer law as the rest of the
sweep). Not touched: git, `refs/`, `registry.json`, `shots.json`, `review.json`.

## Files this pass wrote

- `scratchpad/sweep-genlog.md` — call-by-call ledger
- `scratchpad/sweep-report.md` — this file
- `scratchpad/sweep-shas.md` — SHA-256 for all 53 minted assets
- `scratchpad/sweep-slate.json` — the whole-file 296-item slate (248 scenes + 48 cards)
- `scratchpad/sweep-plates.json`, `sweep-figs.json`, `sweep-figs-c1..c4.json` — batch specs
- `scratchpad/sweep-rifenburgh-canonical.json` — the new-cast mint spec
- `scratchpad/sweep-retry-L196.json` / `-slate.json` — the scene retry overlay + slate
- `scratchpad/sweep-retry-step1.json` / `-step1b.json` + slates — the three STEP-1 retry overlays
- `scratchpad/sweep-dryrun-plates.txt`, `sweep-dryrun-figs.txt` — $0 pre-flight, zero refusals
- `scratchpad/sweep-c6-board.html` — the C-6 board
- `assets/_review/figure-verdicts.json` — the C-6 skeleton, all verdicts empty
- `<main-kit>/_staging/_pre-sweep-archive-2026-08-05/` — the 7 archived pre-reset plate PNGs

**Not touched:** git, `refs/`, `registry.json`, `shots.json`, `decisions.md`, `review.json`,
`assets/scenes/manifest.json`.
