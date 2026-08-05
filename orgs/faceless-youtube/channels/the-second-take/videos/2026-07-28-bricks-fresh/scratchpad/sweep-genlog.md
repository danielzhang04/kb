# Phase 6a — generation sweep genlog (cast library + place plates)

Worktree `C:/Users/danie/kb-worktrees/boss-bricks-reset` (detached at `89c720e`, working tree carries
the 248-shot `shots.json`). `--kit` = MAIN checkout
`C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit` per brief, so all staged
PNGs land in `<main-kit>/_staging/`. `forge.py` run from the worktree.

Budget: **$8.00 ceiling, STOP+report at $7.00 committed.** Prices per the established ledger
convention (`probe-genlog.md`): 2K = $0.134, 1K = $0.039.

## 0. Pre-flight ($0)

- `python scripts/preamble.py` → `PREAMBLE OK`.
- Whole-file slate built through the BUILDER, never hand-typed:
  `forge.py batch --kit <main-kit> --batch shots.json --out scratchpad/sweep-slate.json`
  → `== batch: 248 scene(s) + 48 STEP-1 figure gen(s), 1 not generated ==`.
  The "1 not generated" is `fig-miniscribe-rep--action-powerstance--expr-deadpan`, REUSED — it
  already carries an all-pass, digest-current record in `<kit>/_staging/review.json`
  (`canonical_sha256 9476a15f…`, verdicts rig/expression-register/flat-cel-hazard all `pass`), which
  is exactly forge's own C-6 reuse gate, so the reuse is confirmed accepted by the tool, not asserted.
  **The 48 emitted `fig-*` cards are therefore 48 NEW cards, not 47** — the brief's "48 minus the
  minted one" undercounts by one; the slate is the truth.
- **Place-plate identification (derived, not assumed).** Computed the first-in-file generated shot per
  `place` over the 248 shots:

  | `place` | plate shot | shots in place |
  |---|---|---|
  | `brick-warehouse` | **L03** | 39 |
  | `computer-shop` | **L05** | 6 |
  | `miniscribe-plant` | **L28** (already minted — REUSE) | 46 |
  | `wiles-office` | **L63** | 11 |
  | `miniscribe-boardroom` | **L71** | 14 |
  | `brick-company-yard` | **L113** | 5 |
  | `denver-newsroom` | **L172** | 2 |
  | `jury-courtroom` | **L196** | 10 |

  This matches the brief's list and resolves its open item: the computer-shop plate is **L05**.
- **Staging-collision guard.** `<kit>/_staging/` still holds pre-reset scene PNGs `L01.png`…`L248.png`
  from the abandoned run. forge's skip-if-exists would have silently returned those as "the" result.
  Rather than `--force` over them (which destroys the evidence), the 7 target plate files were
  **archived, not deleted**, to `_staging/_pre-sweep-archive-2026-08-05/` before generating, so every
  plate below is provably minted under the current unified descriptor. No `fig-*` collisions existed
  (only the 2 reviewed/reused frames sit at `_staging/` root).
- **Dry-runs, both lanes, $0, zero refusals:**
  - plates → `scratchpad/sweep-dryrun-plates.txt`, `== DRY RUN: 7 prompts assembled, 0 API calls ==`,
    all `aspect=16:9 size=2K`, every seed resolved.
  - figures → `scratchpad/sweep-dryrun-figs.txt`, `== DRY RUN: 48 prompts assembled, 0 API calls ==`,
    all `aspect=2:3 size=1K`.
  - `grep -ci "gentle soft cel"` over both = **0 / 0** — the style descriptor speaks with one voice.

## 1. Lane A — place plates (7 minted, L28 reused)

`forge.py gen --kit <main-kit> --batch scratchpad/sweep-plates.json`, 16:13:41 → 16:17:10.
**`== 7 generated, 0 failed, 0 skipped ==` — zero 503s, zero re-issues exercised.**

| # | plate | place | attempt | result | 2752x1536 SHA-256 | price |
|---|---|---|---|---|---|---|
| 1 | L03 | brick-warehouse | 1, OK | `_staging/L03.png` | `049c7e03fee4e188be3ee8c7107b88697ed33a88befb022b49b004f8b40ea688` | $0.134 |
| 2 | L05 | computer-shop | 1, OK | `_staging/L05.png` | `9447bfc1a479727b8d52c2a69156af91da12c4603187350b5289ea55cccecec5` | $0.134 |
| 3 | L63 | wiles-office | 1, OK | `_staging/L63.png` | `90cc0c123df5821042c9d53d0f4ee30bce5fcc8ae6b7e5bac76f5d1a575af230` | $0.134 |
| 4 | L71 | miniscribe-boardroom | 1, OK | `_staging/L71.png` | `cd55cb7f52372b6f06afdf543aa0e4ca4dfe492b253c32c1b77513e96d85da49` | $0.134 |
| 5 | L113 | brick-company-yard | 1, OK | `_staging/L113.png` | `ddb31283f4d1d9e74b13262bfdb146120c83619ff4bd8a89a0addab37ae92cd0` | $0.134 |
| 6 | L172 | denver-newsroom | 1, OK | `_staging/L172.png` | `ca18a8eb7dff715c16300d01ab5b5da950e07c8a43ab105120f3e656270f36d3` | $0.134 |
| 7 | L196 | jury-courtroom | 1, OK | `_staging/L196.png` | `35d8f855d7481c55cafcb62778cf032d967a5d0e54b9c0184addd8277dbfa65c` | $0.134 |
| — | L28 | miniscribe-plant | **REUSED** | `_staging/L28.png` (probe, human-verified) | `99265f53efda5135f091517c4c6acf2495b234c25de4cbf1c4ed7fac8d956da8` | $0.00 |

Lane A spend: **$0.938**.

## 2. Lane C — `rifenburgh-ceo` Pass-1 new-cast mint

`forge.py gen --batch scratchpad/sweep-rifenburgh-canonical.json`, 16:17:25 → 16:18:32.

| item | mode | seed | attempt | result | SHA-256 | price |
|---|---|---|---|---|---|---|
| `rifenburgh-ceo` canonical | `new_character`, 2:3, 1K | `refs/base/base.png` (role `reference`) | 1, OK | `_staging/rifenburgh-ceo.png` (848x1264) | `d20758210fe88371aad98c282ff511d4ade20b167cab722b387d084f65236499` | $0.039 |

Identity derived from the script + skeleton, not invented: script P17 — *"In February 1989 a new
management team took over from Wiles, under a guy named Richard Rifenburgh, and they went looking"* —
and the skeleton's cast map (`vpw-fresh-skeleton.md` §3: "To mint at the Pass-1 gate later:
`rifenburgh-ceo` (P17)"). Costume is **script-earned**: L177 authors "a plain dark suit", L185 "dark
suiting". Deliberately carries **no badge, pin, logo, pocket square, tie clip, watch chain or
jewellery** — the de-badging doctrine, stated as an explicit negative list so the engine cannot
improvise one. Distinctness from the existing executive cast was designed in rather than left to
chance: `qt-wiles` = grey 3-piece + tie clip + silver swept hair; `hq-banker` = brown pinstripe
3-piece + gold watch chain + grey hair; `ibm-suit` = navy pinstripe 3-piece + white pocket square +
close-cropped grey hair. Rifenburgh is a **plain unpatterned charcoal TWO-piece, no waistcoat, with
dark-brown hair** — the only dark-haired executive and the only one without a waistcoat or a metal
accessory. Head tone `#caa07a` (§4 "one per cast member"), distinct from `miniscribe-rep`'s `#e2b78c`
and `ibm-suit`'s `#7a4f33`.

Lane C spend so far: **$0.039**.


## 3. Lane B — STEP-1 figure cards (48 minted, 1 reused)

Run in chunks of 12 as the fail-fast mechanism (forge reports an ordinary provider error as `ERR` at
$0 and CONTINUES, so the chunk boundary is where a systemic failure gets caught).

| chunk | window | result | spend |
|---|---|---|---|
| c1 | 16:18 - 16:26 | `12 generated, 0 failed, 0 skipped` | $0.468 |
| c2 | 16:36 - 16:45 | `12 generated, 0 failed, 0 skipped` | $0.468 |
| c3 | 16:45 - 16:49 | `10 generated, 2 failed` | $0.390 |
| c4 | 16:45 - 16:52 | `11 generated, 1 failed` | $0.429 |

Failures, all clean mechanical `ERR no image in response` at **$0**, isolated rather than a 503 wall
(surrounding calls in the same chunk succeeded), so the spend law's ONE unchanged re-issue applied
directly with no canary round needed:

| card | attempt 1 | re-issue | result | price |
|---|---|---|---|---|
| `fig-brick-foreman--expr-smug` | ERR no image, $0 | 16:50:53 **OK** | GENERATED | $0.039 |
| `fig-miniscribe-rep--expr-deadpan` | ERR no image, $0 | 16:51 **OK** | GENERATED | $0.039 |
| `fig-brick-foreman--expr-deadpan` | ERR no image, $0 | 16:53:18 **OK** | GENERATED | $0.039 |

None was re-issued twice. **48/48 cards verified present on disk by name against the slate.**
Lane B card spend: **$1.872**.

## 4. Retries — 4 fired, 4 fixed, all on the first attempt

All authored as versioned `forge-retry-overlay@2` manifests through `forge.py batch --retry`, never
hand-typed and never seeding the failed frame.

| # | target | kind / defect | authority | result | SHA-256 | price |
|---|---|---|---|---|---|---|
| 1 | `L196-retry1` | `scene` / `content` | exact `{from,to}` on the ONE calendar clause, `changed_spans: 1`, all other bytes held | **FIXED** - `1992` now in marker register | `511272e8b3bd73a6da690730315bdb4f4357609fd39d53427a6f35b4a85df06f` | $0.134 |
| 2 | `fig-ibm-suit--action-armscrossed--expr-deadpan-retry1` | `step1` / `rig` | shot L44, instruction restoring only the pinned white pocket square | **FIXED** | (see `sweep-shas.md`) | $0.039 |
| 3 | `fig-brick-foreman--expr-fear-retry1` | `step1` / `rig` | shot L091, instruction naming the pinned costume and forbidding the base hoodie by name | **FIXED** | (see `sweep-shas.md`) | $0.039 |
| 4 | `fig-qt-wiles--action-armscrossed--expr-crestfallen-retry1` | `step1` / `rig` | shot L236, instruction pinning face AND hands to the canonical cream | **FIXED, measured**: head pixel `(191,197,195)` grey -> `(247,232,201)` warm cream | (see `sweep-shas.md`) | $0.039 |

## 5. C-6 gate

`build_review_artifact.py --video <video> --out scratchpad/sweep-c6-board.html --staging <main-kit>/_staging`
-> board (51 images, 5.4 MB) + `assets/_review/figure-verdicts.json` with **51 pending figures**, every
verdict EMPTY, `canonical_sha256` precomputed. **NOT stamped** - `stamp_review.py` is the orchestrator's
call and the only writer of a verdict.

## 6. TOTAL SPEND: $3.100

| lane | items | spend |
|---|---|---|
| A - place plates | 7 x 2K | $0.938 |
| A - L196 retry | 1 x 2K | $0.134 |
| B - STEP-1 cards | 48 x 1K | $1.872 |
| B - STEP-1 retries | 3 x 1K | $0.117 |
| C - rifenburgh canonical | 1 x 1K | $0.039 |
| provider failures | 3 | $0.000 |
| **TOTAL** | **59 paid calls** | **$3.100** |

$4.90 under the $8.00 ceiling, $3.90 under the $7.00 stop line. Nothing aborted for budget.

**Not touched:** git, `refs/`, `registry.json`, `shots.json`, `decisions.md`, `review.json`,
`assets/scenes/manifest.json`.

## 7. Follow-up (2026-08-05, separate pass) — `rifenburgh-ceo` STEP-1 unblock

Boss promoted `rifenburgh-ceo` between passes: `refs/rifenburgh-ceo/rifenburgh-ceo.png` (SHA-256
`d20758210fe88371aad98c282ff511d4ade20b167cab722b387d084f65236499` — byte-identical to the Lane-C
canonical minted above) plus a `registry.json` `characters.rifenburgh-ceo` entry (`head_tone
#caa07a`, pinned charcoal-two-piece costume line, `base` pointing at the promoted file). This clears
both refusals §"BLOCKED" (sweep-report.md) named: the slug now resolves against `registry.json`, and
`_is_canonical()` accepts the `/refs/rifenburgh-ceo/` path.

Budget for this leg: **$0.20 hard ceiling.**

### 7.0 Pre-flight ($0)

- `forge.py batch --kit <main-kit> --batch shots.json --shots L177,L185 --out
  scratchpad/rifenburgh-step1-slate.json` → `== batch: 2 scene(s) + 2 STEP-1 figure gen(s), 0 not
  generated ==`. **Exactly 2 STEP-1 GENERATE cards, as expected** — the 2 `L177`/`L185` scene items
  in the same slate are out of this card's scope (STEP-1 only) and were not built.
  Filtered the slate to the 2 `fig-rifenburgh-ceo*` STEP-1 items only →
  `scratchpad/rifenburgh-step1-only.json`.
- **Dry-run, $0, zero refusals:** `forge.py gen --dry-run --batch
  scratchpad/rifenburgh-step1-only.json` → `scratchpad/rifenburgh-step1-dryrun.txt`,
  `== DRY RUN: 2 prompts assembled, 0 API calls, 0 files written ==`. Both resolved their 3-seed
  triple (`rifenburgh-ceo` canonical + expression ref + pose ref) correctly against the newly-live
  registry entry.

### 7.1 Live gen — 2 fired, 2 clean on the first attempt, 0 re-issues

`forge.py gen --kit <main-kit> --batch scratchpad/rifenburgh-step1-only.json --video <video>`,
single foreground call (well under the 4-min ceiling; no polling/backgrounding needed at N=2).
`== 2 generated, 0 failed, 0 skipped ==` — no 429/503, no mechanical no-image, so the spend law's
one-unchanged-re-issue path was never exercised.

| card | shot | attempt | result | 848x1264 SHA-256 | price |
|---|---|---|---|---|---|
| `fig-rifenburgh-ceo--action-armscrossed--expr-deadpan` | L177 | 1, OK | `_staging/fig-rifenburgh-ceo--action-armscrossed--expr-deadpan.png` | `57949216cc0265c15b92baf3cc35e3814d21083ea6449d780dff7ee2d79a2f33` | $0.039 |
| `fig-rifenburgh-ceo--hold-paper-by-sides--expr-shock` | L185 | 1, OK | `_staging/fig-rifenburgh-ceo--hold-paper-by-sides--expr-shock.png` | `7da8f6c5fc4956cabd3c297dfc3a35972993f817a6682dcf0925abbf02ea299b` | $0.039 |

Leg spend: **$0.078**.

### 7.2 Fresh-eyes review — 2/2 covered, both PASS, no retry spent

Judged against bible §3 and the promoted `rifenburgh-ceo` registry costume line, viewed at ordinary
scale plus targeted hand crops (both cards expose hands — armscrossed tucks them at the forearm,
hold-paper-by-sides grips the sheet by both edges — so both got the digit check §3 requires).

**`fig-rifenburgh-ceo--action-armscrossed--expr-deadpan` (L177) — PASS, no defect.** Round near-circle
head PASS · no nose PASS · no ears PASS · flat-cel line/fill PASS (soft skin ramp present — the
channel-wide systemic trait already surfaced as a doctrine question in §"Weaknesses first" above, not
a per-frame defect) · costume PASS — plain charcoal two-piece, **no waistcoat**, white shirt,
muted-blue tie, dark shoes · **de-badging PASS** — chest, lapels, breast pocket plain: no badge, pin,
pocket square, tie clip · hair PASS — short side-parted **dark-brown**, the cast's only dark-haired
executive · head tone PASS — sampled `(220,163,118)`, in the warm-tan `#caa07a` family · hands mostly
occluded by the crossed-arm pose (expected for this primitive), no exposed digit to mis-render ·
expression PASS — deadpan register, moderate not big.

**`fig-rifenburgh-ceo--hold-paper-by-sides--expr-shock` (L185) — PASS, no defect.** Round near-circle
head PASS · no nose PASS · no ears PASS · **four-digit hands PASS on both hands** — crop-verified
thumb + three fingers each side gripping the paper edge (crops in `_staging/_crop-*hand*.png`) ·
**hand tone matches head tone** — measured, not eyeballed: head `(214,163,116)`, left hand
`(213,159,113)`, right hand `(208,154,110)` — one uniform warm-tan family, no cold/grey hand-tone
bleed (the seed-routing defect class named in the skill's seed law) · costume PASS — same pinned
charcoal two-piece, no waistcoat · **de-badging PASS** · hair PASS — dark-brown, side-parted · head
tone PASS, same family as L177's card · expression PASS — shock register (wide eyes, open mouth) is
correctly the big end for this primitive, not a moderate-register violation.

**2/2 covered. 0 retries spent** (0 available since neither card carried a named defect — the
surgical-retry / bank-with-mechanism path was not needed).

### 7.3 Spend — this leg

| item | count | spend |
|---|---|---|
| `fig-rifenburgh-ceo--action-armscrossed--expr-deadpan` (L177) | 1 x 1K | $0.039 |
| `fig-rifenburgh-ceo--hold-paper-by-sides--expr-shock` (L185) | 1 x 1K | $0.039 |
| retries | 0 | $0.000 |
| **TOTAL, this leg** | **2 paid calls** | **$0.078** |

Against the **$0.20 hard ceiling: $0.122 unspent.** Combined with §6's $3.100, running total across
both passes: **$3.178**.

**Not touched:** git, `refs/`, `registry.json`, `shots.json`, `decisions.md`, `review.json`,
`assets/scenes/manifest.json`. (The registry/refs promotion that unblocked this leg was the boss's
own prior action, not this pass's.) C-6 verdicts above are this pass's fresh-eyes ruling, not a
`stamp_review.py` write — same single-writer law as §5: the orchestrator stamps, this pass only
rules and records.
