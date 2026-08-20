# Doctrine drift ledger — poyais-final to HEAD

## Scope and reading rule

**Anchor:** `fa104c60` (2026-07-20), the Poyais-final working state.  This is not a guessed
date: `doctrine-recon/era-map.md:5` names that exact commit as E1, and the commit's tail-run
record is the last Poyais working-state record before the subsequent doctrine walk.  **HEAD:**
`001cdc8f` (2026-08-20); its only relevant contribution is this reconciliation corpus, so the
last doctrine change is `f1c3b1aa` (2026-08-19).

I walked `fa104c60..HEAD` in forward topological order across the requested paths.  There are
87 path-touching commits.  This ledger has **65 substantive rows**: it excludes merges, test-only
changes, pointer-only renumbers, and pixel-only reference/canonical mint commits unless they also
changed doctrine or prompt assembly.  A row may batch closely coupled hunks in one commit, but it
does not merge separate commits.  “Validated” means a named failure is later shown closed; green
tests or a review stamp alone do not establish taste improvement.

File abbreviations: **V** = `.claude/skills/visual-prompt-writer/**`; **I** =
`.claude/skills/image-generation/**` including `forge.py`/`stamp_review.py` and other prompt-
assembly helpers; **K** = `channels/the-second-take/visual-kit/**`; **E** =
`channels/the-second-take/example-shots.md`.

Class meanings are mutually exclusive: **fix** = evidence-backed fix; **spec** = speculative
addition; **param** = hyper-specific parameter; **patch** = contradiction-patch; **churn** =
later reverted/superseded.  Trigger citations in brackets are local commit IDs or named local
records; `unknown` means the history did not name a precipitating failure.

## Forward ledger

| SHA / date | Files | What changed (load-bearing before -> after) | Trigger | Class | Outcome |
| --- | --- | --- | --- | --- | --- |
| `d505b0e9` 07-22 | V, K | broad visual timing -> **1.5–3 s cadence** plus opt-in motion | “90.6% dead-frame share” engagement record, `fff32ae3` | param | Later superseded by the 07-28 refactor; no render comparison isolates the dial. |
| `06ee112c` 07-22 | V | camera/doctrine suggestions -> linter-enforced engagement gates | engagement review gaps, `eb26b616` | fix | Process-valid: the gate remains; no post-change taste proof. |
| `99ad5bdb` 07-28 | V | expansive schema lore -> terse contract/text laws | trim wave, `be305789` | churn | Re-expanded/recast by `26604ec4`, then reset again; documentation oscillation. |
| `c76241b2` 07-28 | V | repeated laws and war stories -> slim procedure/critic | trim wave, `be305789` | churn | Superseded by `26604ec4` and the August doctrine layers. |
| `ae883f04` 07-28 | K | 775-line style bible -> 460-line folded rules | trim wave, `be305789` | churn | Re-expanded by style/reset work; later audit still finds duplicated/layer-confused doctrine. |
| `33a5aa89` 07-28 | I | 503-line image skill -> 326-line bible pointers | trim wave, `be305789` | churn | Re-expanded by pass and seed mechanics; later plan calls for another boundary cut. |
| `c87af86e` 07-28 | I | duplicated generation doctrine -> bible pointers | trim wave, `be305789` | churn | Later passes put mechanics back in I/forge; superseded. |
| `317f8e63` 07-28 | K | visual grammar measurement narration -> trimmed law | trim wave, `be305789` | churn | August code/lint layers restore detailed requirements elsewhere. |
| `16167c6a` 07-28 | K | style-bible §§7–8 detail -> squeezed sections | trim wave, `be305789` | churn | Later reset/restoration changes supersede the shape. |
| `e8baaccf` 07-28 | E | no depiction exemplars -> 70-line “depiction bar” | unknown; commit says PENDING gate B | spec | Gate later approves it, but current records show authors still collapsed toward literal re-enactment. |
| `edfb340c` 07-28 | E, V | draft examples -> **approved depiction bar** | Gate B, commit title | spec | Valid exemplar source, but no evidence it corrected production behavior; `era-map.md:165`. |
| `9f540aaa` 07-28 | V | dropped fields hard-enforced -> legacy fields merely warn | schema-v2 migration | patch | Later semantics/lint waves re-tighten related behavior; no quality evidence. |
| `f233bd70` 07-28 | K | depiction rules spread through bible -> grammar owns depiction, bible owns LOOK | refactor wave | patch | A sound ownership intent, but `a4bbe9ab` immediately declares a new one-voice repair; not stable. |
| `85d60bdd` 07-28 | I | pass1 procedure -> pass1/pass2 and bible-owned mechanics | refactor wave | patch | Later `2ede5f20` and `6735796d` add mechanics back; contradicted by implementation. |
| `26604ec4` 07-28 | V | thin procedure -> grammar/schema/critic recut | refactor wave | patch | Supersedes the preceding trim; later reset makes it another intermediate layer. |
| `4edc243e` 07-28 | V | assumed WPM / three false positives -> script-header WPM and corrected guards | named runtime/lint failures, commit title | fix | Validated as a correctness fix by added tests; unrelated to visual taste. |
| `94eafe49` 07-28 | V, K | loose pacing/content prompts -> **1.5–3 s**, header-rate, content-only, prop/VO-reference rules | docs wave; no failure named beyond prior cadence work | param | Superseded by later authoring/reset language; untested aesthetically. |
| `79a5dae7` 07-28 | I, K | generic cutout/seed prompt -> object-only cutout, per-layer seed, unlettered tail | docs wave, no named failed frame | param | Later assembly changes supersede portions; no causal validation. |
| `2ede5f20` 07-29 | V, I, K | prose-only shots -> figure declarations, staged authoring, lint guards, **2K** + DSG-lite | “prompting overhaul”; no named pre-change failure | spec | Triggered the large Bricks system, but later reversal waves indict the expansion as not a demonstrated taste win. |
| `dd0ffadf` 07-29 | I | whole pass -> act batches, carry-forward defects, verified-frame seeds | implementation plan, no named failure | spec | Process plausible; later seed-law rewrites show it was not settled. |
| `72cf42a9` 07-29 | K | minimal kit -> cast/pose/environment/prop canonical registry | Bricks slice build, no named fault | spec | Provenance is useful; the volume/role policy later churns repeatedly. |
| `6735796d` 07-30 | V, I, K | loose image generation -> seeded two-tier/plate law and slimmer review | Bricks run defects; title names a “fix wave” but not a single failure | patch | Countered by `f73c7e44` (plate/scale walk-back) and later reset; churn chain A. |
| `d6d07bb4` 08-03 | V, I, K | population-led staging -> subject-not-population; unverified retry -> anchor/retry gate | Daniel confirmation, `d6d07bb4` | fix | Anchor/retry safety survives and later has explicit TDD (`c78b19bb`); validated process fix. |
| `c78b19bb` 08-03 | I | retry rejects local/repaired anchor -> accepts **verified** local/repaired predecessor | named validator failure; TDD/41 tests | fix | Validated and retained; later lineage evidence in `era-map.md:67`. |
| `e8e0f619` 08-03 | V | ordinary scale choice -> foreground-prop scale recipe | “lane-H validated” in title, but narrow probe only | param | Explicitly reverted by `aae75eb0`; indicted. |
| `aae75eb0` 08-03 | V | foreground-prop scale recipe -> removed | Revert title | churn | Ends the short parameter experiment; no replacement proof. |
| `f73c7e44` 08-04 | V, I, K | plate exception/palette lock/scale pressure -> “middle path,” style-card auto-seed | direct walk-back of `6735796d` | churn | Superseded by `a4bbe9ab` reset and then era restoration; chain A. |
| `f4ca9b56` 08-04 | I | flexible style descriptor -> **hardened flat-cel every scene**, no style anchors | probe decided; no named user-visible failure | spec | Indicted by `d1f771a7` removing HARDENED and by Poyais-vs-fresh style audit (`era-map.md:66`). |
| `703b5dc8` 08-04 | V, I | misleading seed roles / unbounded retries -> truthful roles, delta recipe, surgical retry, payload-final zone, spatial gate | six B4 failures, `ec4cdbfc` | fix | Specific failures were closed (`dfb69034`); seed/retry safety retained. |
| `a4bbe9ab` 08-04 | V, I, K | middle-path/multiple sources -> C-1 recipe and “one voice” | integration conflict, title says two reversal decisions | patch | Immediate evidence of contradiction repair; later two-voice restoration supersedes it. |
| `80647cb6` 08-04 | I | hand-written review claims -> machine-emitted invariant rows and figure record | review-machinery gap | fix | Validated as the shared review surface for the 6c2 pass (`era-map.md:101`). |
| `849679f0` 08-04 | V | informal doctrine checks -> place/hard-cut/owner schema + 16 calibrated lints | C-2/3/5/7/8 findings | fix | VPW3 independent critic later catches real defects; retain the generic gate, not taste-specific rubric. |
| `21ec8826` 08-04 | I | identity-only seed -> place>stage>id, derived plates, provenance/cap gate | worker-A review findings | fix | Validated for stale-collision/lineage refusal; `era-map.md:67`. |
| `c5db4883` 08-04 | V, I, K | distributed owner signals -> a single canonical cross-place law | integration seam finding | patch | Useful consolidation, but another layer in the successive one-voice/two-voice reversals. |
| `b55fe0ad` 08-04 | V, K | “fourth voice” / plate style duty -> suffix is lettering only, grammar single source | F1 review | patch | Explicit correction of contradiction; later `d1f771a7` restores a two-voice style arrangement. |
| `5b1a9b76` 08-04 | V | vague ownership/text/chain rules -> forced-choice owner, one plate definition, VO-keyed chain | F2 lint semantics: 28 -> 1 true fire | patch | The false-fire reduction is validated; later `f1c3b1aa` revises chain semantics again. |
| `dc61405a` 08-04 | V, I | review/minter drift -> figure record, manifest provenance, deduped canary | F3 loop closure | patch | Structural result retained, though it patches the preceding stack rather than simplifying it. |
| `5693318b` 08-04 | I | heuristic place-owner check -> `place_owner` key, legibility-only | F4 finding | fix | Validated semantic correction; keep. |
| `30d2b7e8` 08-04 | V, I | false anonymous/crop/plate semantics -> truthful anon, one splitter, source-aware plate | F5 closure | fix | Passed closure verification; crop/plate mechanism remains, though its taste claims are unproven. |
| `b6f16b0d` 08-04 | V, I | red interaction routing and loose carry -> green route, entrance/payload/cadence/figure-bias guards | G1 review | fix | Process tests pass; later closed-world policy changes it, so only routing integrity is kept. |
| `0e7e8d8c` 08-05 | I | arbitrary cap loss -> ordered crowd→template→prop displacement; plate/text/cast cannot drop | G3 failure | fix | Validated control fix (184 green); retain. |
| `240aed74` 08-05 | K | badge-bearing miniscribe canonical -> de-badged root canonical/registry | boss-eye verified defect | fix | Directly validated by approved v2 canonical; keep. |
| `d1f771a7` 08-05 | V, I, K | HARDENED flat-cel/1K? -> era two-voice tail, style tile, **1K default**, perspective removals | era restoration; no controlled causal proof | churn | Counter-change to `f4ca9b56`; later saturation repair and August revisions. |
| `ea71f99e` 08-06 | I, K | tile says “discipline” -> “saturation” | measured grayscale drift: median sat .089 -> .189 | fix | Named metric improved to era prior and card review recorded; validated narrow rendering fix. |
| `27bc7e25` 08-06 | V, I, K | no performer/crowd limits -> three tiers, performer minting, **delta <=2** | B-window review; 0 blockers/4 majors | param | Seeded-performer tier is later abolished by `db0ffd14`; cap remains but no taste proof. |
| `52b17ab2` 08-06 | V, I, K | two-tier -> three-tier / costumed-performer / one-performer cap | doctrine-window completion | patch | Superseded in part by `db0ffd14`; another expansion before rollback. |
| `ede2f56e` 08-07 | I | texture-strip can leak -> forge mechanism refusal/repair | 6c2 run failure | fix | 21/25 verified/promoted; a concrete failure closure, retained. |
| `db0ffd14` 08-12 | V, I, K | seeded-performer tier -> abolished (rollback of `ea71f99e`/reset tier) | Task 8b rollback | churn | Ends the performer-tier arm of chain B; does not validate the remaining tier scheme. |
| `f68ee7c6` 08-12 | I | selective seed review -> Pass-1 gate for every seed asset class | Task 8c identified coverage gap | fix | Verified by expanded fixtures; good fail-loud provenance control. |
| `3d2aea26` 08-12 | V, I, K | generic crowd/plate -> 2–3 crowd tones, plate occupancy and variant law | Task 8d; no named pixel failure | param | Later crowd audit still sees individuation; untested as taste repair. |
| `e088c455` 08-12 | V, I, K | cards as reference -> cards must hold beat act / compose from primitives | Task 8e | param | Later primitive/routing revisions continue; no comparative output. |
| `72a02609` 08-12 | I | broad delta ownership -> face-owner prose; **pose retry enum** | Task 8f | param | Narrow rule; no later outcome evidence. |
| `78dbc47c` 08-12 | I, K | reusable shock/pleading expressions -> remove from library and generation | Task 8g no-op finding | fix | Known no-op assets removed; however E5 comparative no-op closure remains untested. |
| `a1dcb4ec` 08-12 | V, I, K | silent missing kit/role -> whole-surface fail-loud checks | Task 8h | fix | Validated by fixtures; retains safety, not a taste claim. |
| `10b48774` 08-13 | V, I | permissive plate/identity store -> complete-list, plate-scope refusal, digest identity | G4 follow-ups | fix | Integrity failure modes now covered; retain. |
| `e2a955f0` 08-13 | I, K | flexible canonical face / broad grant -> resting-face law and reduced canonical grant | Task 10b | param | Remint shows conformance, but no evidence this visual constraint improves the video. |
| `cc7b1ede` 08-13 | I | `--assets` blanks unnamed store records -> preserves them | observed review-store loss | fix | Direct data-integrity fix, covered by test; keep. |
| `abd3ed95` 08-13 | V, K | vetoed primitives allowed / eyewear vague -> delete primitives, restore handshake, eyewear lint | Daniel asset rulings | fix | Human ruling and subsequent remint validate the concrete asset correction. |
| `1be54d18` 08-13 | I | environment plate is a backdrop -> plate must compose for character placement | Daniel ruling | param | Seven plates promoted, but no comparison against former composition; untested taste rule. |
| `46076bff` 08-17 | V, I | crowd class can be latent -> `figures?` guard and explicit f/s/r stamp | audit `00955e31`, Daniel minimal-fix ruling | fix | Caught L75/L174 and lint reaches 0 HARD; validated guard. |
| `c4ab957b` 08-17 | I, K | crowd must match base rig (3.14 heads) -> match crowd exemplar (~2.7) | Daniel ruling plus measurement | fix | Re-mint loop closed unused after measured current 2.8; validated correction. |
| `a26ccb87` 08-18 | I | retry cannot express gesture/clean card -> gesture extraction, `clean_card`, ground-line removal | Daniel rulings / forensics spec | fix | Specific retry paths get tests; no broad taste validation. |
| `33676421` 08-18 | V, I, K | fixed vantage/flat prompt -> vantage unlock, chains default, warm re-lean, **three-plane read**, parallel default | Daniel taste rulings | param | Later `f8aa5e52` reverses scale staging and de-recipes suffix; evidence says template convergence remained. |
| `f8aa5e52` 08-19 | V, I, K, E | scale staging/suffix recipe -> reverts, era chroma phrase, grammar repair | adversarial GO-WITH-EDITS | churn | Counter-change to `33676421`; current critic still rejects the candidate on five groups (`era-map.md:24`). |
| `f1c3b1aa` 08-19 | V, I, K, E | chain-as-default/crowd-heavy/literal drift -> reveal-only deltas, single-figure default, per-scene palettes, non-literal first-class, closed-world poses | Poyais forensics: 0/22 vs 26/109 no-ops; 28 symbolic vs 4 fresh | fix | Strongly evidence-motivated, but **untested after change**: no current-E5 comparative render exists (`era-map.md:18–23`). |

## Counts

### By class

| Class | Rows |
| --- | ---: |
| evidence-backed-fix | 25 |
| speculative-addition | 6 |
| hyper-specific-parameter | 11 |
| contradiction-patch | 11 |
| churn | 12 |
| **Total** | **65** |

### By doctrine surface (row touches; a multi-file row counts in each touched surface)

| Surface | fix | spec | param | patch | churn | total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| V — visual-prompt-writer | 12 | 2 | 7 | 9 | 7 | 37 |
| I — image-generation / forge / stamp | 20 | 3 | 8 | 6 | 6 | 43 |
| K — visual-kit | 8 | 2 | 8 | 6 | 7 | 31 |
| E — example-shots | 1 | 2 | 0 | 0 | 1 | 4 |

The table intentionally counts row touches, not line changes: a doctrine rule moved between V, I and K
is the same change in three consumption surfaces, which is exactly the blast-radius problem here.

## Churn chains

1. **A — plate/scale ownership:** `6735796d` seeded two-tier + plate law -> `f73c7e44` walks back plate
   exception/palette lock/scale pressure -> `a4bbe9ab` declares the middle path superseded and reasserts
   one voice -> `d1f771a7` restores two style voices.  This is the worst ownership oscillation: doctrine
   moved K -> V/I -> K while the underlying aesthetic was not re-proven.
2. **B — figure tier / performer policy:** `2ede5f20` figure declarations -> `27bc7e25`/`52b17ab2`
   three-tier seeded performer plus one-performer cap -> `db0ffd14` abolishes seeded performer ->
   `f1c3b1aa` changes the surviving default to one seeded figure/crowd exception.  Four policies in 21
   days, with only individual control tests, not comparative taste evidence.
3. **C — prompt register/style hardening:** `f4ca9b56` hardens flat-cel and removes anchors ->
   `d1f771a7` deletes HARDENED and restores era two-voice/1K -> `ea71f99e` repairs grayscale by changing
   one tile word -> `f8aa5e52` de-recipes the suffix -> `f1c3b1aa` revises palette again.  This is the
   strongest support for the owner’s warning about prompt parameter accretion.

Additional short chain: `e8e0f619` foreground-prop scale recipe -> `aae75eb0` revert.  The July
trim cluster (`99ad5bdb` through `16167c6a`) is a second-order churn chain: deletion of doctrine detail
followed within a week by re-expansion through reset, lints and code.

## Trouble curve

This is a **semantic-row** count (not noisy line churn): “addition” means a new rule/gate/asset policy;
“deletion” means an explicit removal, rollback, or rule contraction.  Churn is a subset flag and is shown
separately.

| Month after anchor | Additions | Deletions / contractions | Churn rows | Reading |
| --- | ---: | ---: | ---: | --- |
| 2026-07 (22 rows) | 13 | 9 | 7 | The initial engagement changes are quickly buried by large trim/rearchitecture and then a prompting expansion. |
| 2026-08 (43 rows) | 30 | 13 | 5 | The stack grows faster: tiers, caps, seed roles, gates, cards, palettes, retries and review rules; many are correction layers on prior rules. |

**Verdict:** yes—the record supports “more troublesome since Poyais.”  The evidence is not merely more
files: additions rise from 13 to 30 while the second month still has 13 contractions and five explicit
churn rows.  The system became more rule-dense and more self-contradictory without a corresponding
post-change visual comparison that demonstrates a better result.  The important exception is narrow
integrity work (seed provenance, stale-collision, data preservation, actual lint false positives), which
is evidence-backed and should not be thrown out with prompt doctrine.

## Keep-list — genuine validated fixes

These are the post-Poyais changes with a named failure and later closure.  “Keep” does not endorse their
surrounding taste prose.

- `4edc243e` — header-WPM runtime and false-positive correction.
- `d6d07bb4`, `c78b19bb` — verified anchor/retry lineage.
- `703b5dc8` — B4 truthful roles, surgical retry and payload ordering.
- `80647cb6` — machine-emitted review invariants.
- `849679f0` — generic critic/lint gate (keep it channel-neutral).
- `21ec8826`, `0e7e8d8c`, `10b48774`, `f68ee7c6` — seed provenance, non-droppable critical seeds,
  plate scope/digest integrity and Pass-1 review gate.
- `5693318b`, `30d2b7e8` — correct `place_owner` and source-aware plate/crop semantics.
- `240aed74`, `ea71f99e`, `ede2f56e`, `abd3ed95`, `c4ab957b`, `46076bff` — directly observed asset,
  saturation, texture-strip, primitive, crowd-proportion and latent-class fixes.
- `cc7b1ede` — review-store preservation.
- `a26ccb87` — gesture/clean-card retry paths for the Daniel-identified defects.

**Keep-list size: 20 commits (18 distinct failure classes).**

## Indicted-list — recut deletions

These changes have later direct reversal or evidence that the added doctrine made the visual/prompt
system worse or failed to establish a benefit.  Delete their narrow rule prose and any duplicate
enforcement that exists only to service it; do not delete generic provenance or review integrity.

- `d505b0e9`, `94eafe49` — the 1.5–3 s cadence dial.
- `2ede5f20` — the broad figure/2K/DSG prompting overhaul: it began the later tier/plate/seed
  accumulation but has no isolated visual win.
- `e8e0f619` — foreground-prop scale recipe (explicitly reverted by `aae75eb0`).
- `f4ca9b56` — hardened flat-cel/no-anchor policy (undone by era restoration; current register remains
  indicted in `era-map.md:66`).
- `6735796d`, `f73c7e44`, `a4bbe9ab`, `c5db4883`, `b55fe0ad` — the plate/one-voice/middle-path
  ownership stack; retain only one clear canonical source after recut.
- `27bc7e25`, `52b17ab2` — seeded-performer tier and related narrow tier policy (rolled back by
  `db0ffd14`).
- `3d2aea26`, `e088c455`, `72a02609` — crowd-tone/occupancy, primitive-composition and pose-enum
  parameterization: no demonstrated quality win.
- `33676421` warm/three-plane/chain-default recipe portions, later countered by `f8aa5e52` and still
  associated with the VPW3 convergence rejection.

**Indicted-list size: 16 commits / policy clusters.**

## Evidence limits

The current Poyais-revert changes (`f1c3b1aa`) are not in the keep-list yet.  They have the strongest
burden-of-proof trigger in the ledger—Poyais 0/22 no-op deltas versus fresh 26/109, and Poyais 28 symbolic
beats versus fresh four—but remain a hypothesis until a comparable current render wave is judged.
`doctrine-recon/era-map.md:173` makes the same distinction: known process failure classes are covered;
there is no blanket current taste validation.
