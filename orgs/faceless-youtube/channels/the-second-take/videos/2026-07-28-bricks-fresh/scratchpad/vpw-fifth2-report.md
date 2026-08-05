# VPW fifth 2 — authoring report (2026-08-05)

Video: `2026-07-28-bricks-fresh` · FRESH-AUTHORING mode under the 2026-08-04 doctrine reset.
$0, no provider call, nothing committed, no git touched. Worktree `boss-bricks-reset` only.

**Read set:** `visual-prompt-writer/SKILL.md` · `scratchpad/vpw-fresh-skeleton.md` ·
`scratchpad/vpw-log-fresh.md` · `script.md` · `assets/voiceover.manifest.json` (real word timings) ·
`visual-kit/visual-grammar.md` + the style-bible descriptor pointer · `references/shots-schema.md` ·
`example-shots.md` · `visual-kit/registry/registry.json` · `assets/library/manifest.json` (cast
vocabulary) · `research.md` (fact ledger) · `scripts/lint_shots.py` and `forge.py` (the laws as
implemented) · the CURRENT `shots.json` (L01–L47, for lineage only). No archived or quarantined file
was read at any point.

---

## 1. Range authored

| | |
| --- | --- |
| **Shots** | **L48 – L89 — 42 new shots** (file now 89 shots, L01–L47 byte-identical, verified) |
| **First / last paragraph** | P07 ("By 1985 the company was in real trouble…") → P09 ("…wasn't. Awkward.") |
| **First / last anchor** | `"By 1985 the company was in real trouble,"` → `"wasn't. Awkward."` |
| **VO span** | t = 102.221 s → 204.080 s = **101.86 s** of measured VO |
| **Cadence** | avg **2.43 s**; every real hold inside 1.5–3.0 s except L74 (1.44 s, below — see §5) |
| **Σ `duration_s`** | 101.9 s over the range (file total 205.3 s of the 540.1 s VO — 37.8 %) |

### Why the end boundary snaps there

The 2/5 mark by words is 653 of 1,632; by VO time it is 216.0 s. The two paragraph boundaries either
side of it are the **end of P09 at 204.08 s (37.8 % of the VO)** and the end of P10 at 225.88 s
(41.8 %). They are almost equidistant from 40 %, and P09's end wins on three grounds:

1. **It is the skeleton's own ACT boundary.** `vpw-fresh-skeleton.md` puts act 2 at P07–P09 and act 3
   at P10–P15. Ending at P09 closes a whole act; ending at P10 would open act 3 and stop one beat in,
   mid-escalation-ladder (the lock-box swap is the first rung of the F-23 ladder that runs to the
   bricks).
2. **It is a story seam, not just a paragraph break.** Act 2 ends with the hole discovered
   ("Four million dollars of product… wasn't. Awkward."); the cover-up starts on the next word.
3. **It ends mid-nothing.** No delta chain, no stage, and no place visit crosses the boundary: L89
   opens its own stage (`hole-found`) and the next fifth starts on a fresh paragraph in a set this
   fifth has already left.

42 shots at the skeleton's act-2 density: the skeleton budgeted ~35 shots for what it estimated as
90.5 s; the REAL act-2 span is 101.86 s, and 35 × (101.86 / 90.5) = 39.4. The extra ~3 are forced by
the VO's own phrasing (see §5) and the file's fifth-1 density (47 shots / 103.3 s = 0.455 shots/s)
is fractionally *higher* than this fifth's 0.412, which is the correct taper — density is weighted
heaviest in the first 60 s.

---

## 2. Places

### New places + plates

| `place` | Plate | Owner decision | Shots | Why that owner call |
| --- | --- | --- | --- | --- |
| `wiles-office` | **L63** (cast-free, no chain parent) | **`owner_ambiguity: true`** | L63, L64, L66, L69 (4) | The script establishes no name on this door. A rented executive suite a thousand miles from the company honestly carries none, and reaching for a drawn owner here would be invented signage. The door glass is authored "plain and unlettered", which is legal ONLY paired with the ambiguity declaration. |
| `miniscribe-boardroom` | **L71** (cast-free, no chain parent) | **`owner_ambiguity: true`** | L71, L72, L73, L77, L78, L79, L80 (7) | An interior meeting room inside a plant whose board is already lettered over its floor entrance carries no second sign. This also declines to mint a second copy of the `MINISCRIBE` literal (fewer authored strings is the highest-leverage defect lever, §4 of the schema). |

Both qualify under the recurrence test (each forms two or more non-contiguous runs), both plates carry
zero named cast and no `stage_role: delta`, and both place ids anchor to script vocabulary
(`wiles`, `miniscribe`).

### Places revisited

| `place` | Seeds | Shots in this fifth |
| --- | --- | --- |
| `miniscribe-plant` | **fifth 1's plate L28** (`place_owner: "MINISCRIBE"`) | L48, L52, L53, L56, L57, L65, L67, L81, L82, L83, L84, L86, L88, L89 (14) |

Verified against forge, not asserted: with L28 in the batch scope, every in-place shot resolves it as
its place seed — `L48: [fig-miniscribe-rep--sit--expr-worried, L28]`, `L53: [… , L28]`,
`L65: [… , … , L28]`, `L86: [… , … , L28]` (probe run, §6). L81 redraws the plant's board and
re-quotes `'MINISCRIBE'` verbatim under L-1; as a carried owner sign it is exempt from payload-last,
so that slot stays with the dated calendar.

17 of 42 shots declare no place — the place-exempt classes (`symbolic-stand-in-object`,
`number-glued-to-object`, `physicalized-imbalance`) plus one-frame worlds the file never returns to
(the Ramsay kitchen, the four shopfronts, the corridor of doors, the chopping block, the post room,
the coat rack).

---

## 3. Pricing basis — what generation this fifth costs

| | Count |
| --- | --- |
| **Scenes** (every shot is `ai-gen`) | **42** |
| **STEP-1 figure gens (new `fig-*`)** | **16** — all resolve GENERATE, none REUSED |
| Plates inside those 42 scenes | 2 (L63, L71) |
| Text-bearing scenes (lettering exemplar derived) | 5 (L50, L51, L58, L81, L87) |
| Crowd-rig scenes | 21 |
| Max seeds on any single request | 3 (well under `SEED_CAP` 4) — no displacement anywhere |

The 16 STEP-1 cards:

```
fig-qt-wiles--action-powerstance--expr-smug      (L53, shared by L61)
fig-qt-wiles--action-accuse--expr-annoyed        (L56)
fig-qt-wiles--sit--expr-deadpan                  (L62)
fig-qt-wiles--sit--expr-smug                     (L64)
fig-qt-wiles--action-armscrossed--expr-deadpan   (L65)
fig-qt-wiles--point-at-thing--expr-deadpan       (L66)
fig-qt-wiles--point-at-thing--expr-smug          (L69)
fig-qt-wiles--action-accuse--expr-deadpan        (L72)
fig-miniscribe-rep--sit--expr-worried            (L48)
fig-miniscribe-rep--expr-fear                    (L65)
fig-hq-banker--action-armscrossed--expr-deadpan  (L49)
fig-brick-foreman--sit--expr-worried             (L79)
fig-brick-foreman--expr-worried                  (L86)
fig-brick-foreman--hold-paper-by-sides--expr-caught (L89)
fig-auditor-rep--action-present--expr-deadpan    (L82)
fig-auditor-rep--hold-paper-by-sides--expr-deadpan (L86)
```

Eight of the sixteen are `qt-wiles`, because act 2 is his act — he leads nine of these 42 frames.
One card is deliberately shared (L61 reuses L53's powerstance/smug), which is why the count is 16 and
not 17. No pose or interaction slug outside `registry.json` was authored; every expression and pose
named already exists. All four act-2 cast slugs (`qt-wiles`, `hq-banker`, `brick-foreman`,
`auditor-rep`) were planned in the skeleton and already sit in this video's Pass-1
`assets/library/manifest.json`, so nothing new is minted at the gate.

---

## 4. Chains, cast and the laws that shaped the staging

**Stages (13):** `hq-desk` (L49 + 2δ) · `wiles-arrival` (L53) · `wiles-pass` (L56 + 1δ) ·
`plated-service` (L59 + 1δ) · `fear-floor` (L65) · `target-line` (L66) · `target-raised` (L69) ·
`firing` (L72 + 1δ) · `quarter-room` (L77 + 1δ) · `foreman-desk` (L79 + 1δ) · `audit-setup` (L82) ·
`stores-run` (L83) · `held-up` (L86) · `hole-found` (L89). 14 bases, 7 deltas; no chain exceeds one
base + 3 deltas and none crosses the fifth's boundary.

**Every cast entrance is a stage BASE, never a delta** — `hq-banker` L49, `qt-wiles` L53 (on the plant
set) and L72 (on the boardroom set), `brick-foreman` L79, `auditor-rep` L82. That is the law fifth 1's
L47 was re-authored for, applied up front here.

**Two-cast shots (2):** L65 (`qt-wiles` + `miniscribe-rep`, the fear beat) and L86 (`auditor-rep` +
`brick-foreman`, the count held against the shelf). Both are fresh stage bases, both state plane,
eye-line and relative-head-scale clauses. Neither takes an `interaction` slug — both beats are
standoffs, not contact, and the free slot is left unspent rather than filled for its own sake.

**The plate/reveal seam is used once, exactly as the SKILL's worked example:** L63 is the cast-free
`wiles-office` plate on the clause that names the office, and L64 is the cast-bearing reveal on the
sentence's tail. Two cuts, not a two-shot lag.

**Q.T. Wiles' own reveal (L53)** takes the naming words whole. The anchor is two words because that
span's only interior split points leave one half under the 1.5 s floor — the VO gives 2.27 s and the
reveal takes all of it.

**Casting kept off the beats where the narration is plural.** `lint`'s semantic-cast law fires when a
shot's VO span names a generic plural role and the cast it names is unjustified nearby. Four shots in
this fifth sit on such spans — L71 ("managers"), L78 ("managers"), L81 ("accountants"), L84
("accountants") — and all four are staged as mass action with crowd figures and no named lead. That
is not a lint dodge: each of those lines genuinely has a room, not a person, as its subject, and the
individual who carries the beat lands on the very next cut (L72 Wiles, L79 the foreman, L82 the
auditor). `hq-banker` on L49 is the opposite case and stays named: its own VO span says "their
bankers".

### Self-audit (SKILL step 3c)

- **Non-literal share.** 40 of 42 are non-literal; the two `literal` frames (L63 the office plate, L83
  the shelf run beside its own ledger) are concrete physical places the line actually describes. No
  shot merely draws its line's words.
- **Class variety.** 12 of the 14 classes appear. Heaviest is `crowd-multiplication` at 7 of 42
  (17 %) and it is never two in a row; `ironic-counterpoint` 5, `personified-character` /
  `diegetic-device` / `idiom-pun` / `reaction-shot` 4 each, `symbolic-stand-in-object` /
  `staged-interaction` 3, the rest 2. No reflex.
- **Red-ink count: 3 distinct uses across 42 frames** (L66's target rule, L69's raised rule, L77's
  struck quarter blocks carried into L78's delta). All three are alarm or ownership; none is
  decoration. Fifth 1 carries 6, so the whole-file count stays low.
- **Human use: 35 of 42 frames carry figures (83 %)**, up from fifth 1's 60 %. The seven figureless
  frames are all single shots between peopled ones — **longest figureless run is 2.94 s**, nowhere
  near the ~10 s self-audit flag, and each names its earn in `notes`: L58 (the beat IS the nickname
  plate), L63 (a plate is cast-free by law and the man lands on the next cut), L68 (the idiom names a
  body the gore policy forbids drawing), L74 (the joke is that the two men left without their coats),
  L83 (the subject is the audit procedure), L85 (the subject is the paper), L87 (the subject is the
  gap). Nothing was populated to hit a share: every added crowd is on a line whose own words name
  people.
- **Cadence vs the 3a budget.** Target 39–42 shots for 101.86 s of real VO → authored 42 at 2.43 s
  average. Every `duration_s` is the MEASURED hold from the forced-alignment timings, verified
  shot-by-shot against `render-builder`'s own matcher, not an estimate off the header's 175 wpm.

**Lettering: 5 distinct literals in 42 shots** — `'20 MILLION'` [F-27], `'DOCTOR FIX IT'` [F-02],
`'MINISCRIBE'` + `'1987'` [F-11/F-12], `'FOUR MILLION'` [F-08]. Every one is sourced from the script's
own words and the fact ledger; every non-delta text-bearing shot ends on its payload clause. Two
places where a value could have been invented are deliberately blank instead: the quota figure on
Wiles' board (L66/L69 — the script names none) and the number the foreman writes down (L80, authored
as an illegible inked run under the supplied-text law's third resolution, which is also the truer
image — what went in the column was not a number anybody had).

---

## 5. The cadence exceptions, stated rather than papered over

- **L74 real hold 1.44 s, 0.06 s under the floor.** "What a dick." is the paragraph's punchline and
  this channel's grammar puts a deadpan cutaway ON the payload word. The VO gives exactly 1.44 s
  between it and the next paragraph; the only alternative is folding it into L73 for a 3.46 s hold
  that buries the joke inside the previous frame. Left visible, declared honestly at 1.4 s.
- **Four base/delta hold inversions were closed by moving one anchor**, never by inventing a duration
  (round-2 lesson 5 / round-3 lesson 11 applied):

  | chain | anchor moved to | before | after |
  | --- | --- | --- | --- |
  | `hq-desk` | L50 → `"20 million dollars in and"`, L51 → `"own turnaround guy to run it."` | 1.98 / 1.94 / 2.46 | **2.47 / 2.04 / 1.87** |
  | `plated-service` | L60 → `"quarterly statements. And, like Doctor"` | 1.82 / 2.91 | **2.47 / 2.26** |
  | `quarter-room` | L78 → `"full of middle managers in Colorado"` | 1.55 / 2.22 | **1.91 / 1.85** |
  | `foreman-desk` | L80 → `"one down anyway. Then in January"` | 2.72 / 3.00 | **2.96 / 2.75** |

  Each moved anchor also lands the cut on a better word than the one it replaced — the number frame
  now cuts on "20 million dollars", the ledger-on-the-plate on "quarterly statements".
- Four anchors are under four words (`"Q.T. Wiles."`, `"Doctor Fix It."`, `"What a dick."`,
  `"wasn't. Awkward."`). Each is the full remaining text of its sentence or sentence pair, and in
  every case the alternatives put one half of the split under the 1.5 s floor or the whole beat over
  the 3 s band.

---

## 6. Acceptance evidence

### Lint

`py -3 .claude/skills/visual-prompt-writer/scripts/lint_shots.py channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`

```
== lint_shots: .../2026-07-28-bricks-fresh/shots.json ==
long-form shots: 89  |  shorts: 0

HARD violations (2) - render sync WILL degrade, fix before handoff:
  [long-form] Sum of duration_s 205s < 85% of the ~558s runtime (1628 words / 175wpm, per the header)
  [long-form] 89 shots for a ~558s runtime (1628 words / 175wpm, per the header) (< 1 cut / 4s)

Heads-up (10):
  [long-form] L74: REAL hold 1.44s (declared 1.4s) is below the 1.5s floor.
  [long-form] L89: covers ~1038 words on one anchor (>~8s VO)
  [long-form] L08 / L13 / L14 (stage deltas): ... not longer than the base.
  [long-form] L48 / L62 / L64 / L79 / L80: `sit` with support authored - confirm the render's FRAMING
             actually shows the support (not lint-decidable; forced review row).
```

**Both surviving HARDs are pure partial-coverage artifacts**, and each is named:

1. *Σ `duration_s` 205 s < 85 % of 558 s* — the duration-sum check measures the WHOLE 9:20 runtime.
   This file covers 37.8 % of it (fifths 1+2 of 5). It cannot clear until the last fifth is authored.
2. *89 shots for a ~558 s runtime* — the `runtime ÷ 4 s` = 140-shot floor is likewise whole-file.
   89 shots for the 205 s actually covered is 1 cut / 2.3 s, well inside the band.

Everything else passed on the run: anchors matched verbatim and in strict narration order against the
real VO word-stream (zero unmatched), place/plate/owner laws, place inventory, conditional plate law,
two-cast presence, seat/support, action-chain, semantic-cast, delta character-entrance, delta
feasibility, interaction-template, crowd tiering, text-supply, lettering caps, carried literals (L-1),
payload-last, banned render terms, rig-clause fingerprint, suffix one-voice.

**Heads-ups, each accounted for:** L74 is the VO-forced 1.44 s punchline (§5). L89's "~1038 words on
one anchor" is the same partial-coverage artifact — the last shot of an incomplete file tiles to the
end of the script; it drops to 2 words the moment fifth 3 lands. L08/L13/L14 are fifth 1's, untouched,
already documented in round 3 as real-timing artifacts of the legacy "delta not longer than its base"
rule. The five `sit` rows are the law's own mandatory review rows, not defects — each names its
support and contact in the same sentence (crate, chair, chair, chair, chair).

**One real defect was found by lint and fixed, not explained:** L89 originally declared no chain while
sharing the prop noun "product" with L88 in the same place (the L88–L91 action-chain drift). It now
opens its own stage `hole-found` — the honest fix, since the foreman's reaction genuinely continues
the stores-aisle scene.

### Forge dry-run over the authored range

`py -3 .claude/skills/image-generation/scripts/forge.py batch --kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit --video channels/the-second-take/videos/2026-07-28-bricks-fresh --batch .../shots.json --out <spec> --shots L48,…,L89 --dry-run`

(The CLI needs the `batch` subcommand plus `--batch`/`--out`; `--shots` scopes the blocking set to the
authored range, which is exactly what "zero refusals over your range" asks for.)

```
  L87: [lettering-marker-italic] (LETTERING - text-bearing prompt; §5 exemplar derived)
  L88: [crowd-exemplar] (no cast - the scene composes from the place)
  L89: [fig-brick-foreman--hold-paper-by-sides--expr-caught] (STEP-1 ... GENERATE)
  == batch: 42 scene(s) + 16 STEP-1 figure gen(s), 0 not generated -> <spec> ==
  == scoped to 42 shot(s); 0 seeding-law violation(s) remain OUTSIDE the scope ==
EXIT=0
```

**Zero refusals, zero `SEEDING LAW` violations, exit 0.** 42 scenes, 16 STEP-1 figure gens, every
`fig-*` **GENERATE** (none REUSED — none of these four cast members has an approved staged card yet),
0 not generated, max 4 seeds never approached (3 is the peak). Fifth 1's L01–L47 report 0 violations
outside the scope.

**One refusal WAS hit and removed during authoring:** L73 was first authored as an expression-swap
delta (`qt-wiles` deadpan → smug), which forge refuses under the seeding law — an expression changed
by prose alone reverts to the engine's prior, and clearing it would have required authoring
image-generation's own `delta_primitives` field, which VPW does not own and which the SKILL says is
declared only "after that exact route proved necessary". L73 was re-authored so its one change is a
SCENE change (the whole table sitting bolt upright), which carries the same beat — the demonstration
landing — without borrowing a downstream field. This is the new lesson 13 below.

### Place-seed lineage, verified

A probe run with L28 in scope confirms the revisit chain resolves as designed:

```
  L48: [fig-miniscribe-rep--sit--expr-worried, L28]
  L53: [fig-qt-wiles--action-powerstance--expr-smug, L28]
  L65: [fig-qt-wiles--action-armscrossed--expr-deadpan, fig-miniscribe-rep--expr-fear, L28]
  L86: [fig-auditor-rep--hold-paper-by-sides--expr-deadpan, fig-brick-foreman--expr-worried, L28]
```

(In the L48–L89-scoped run those shots show no L28 seed purely because L28 sits outside `--shots`;
fifth 1's own L33/L44/L47 behave identically under the same scoping. Not a lineage defect.)

### L01–L47 untouched

The first 69,632 bytes of the file — everything through L47's closing brace — are byte-identical to
the pre-run copy. Verified by prefix comparison against a backup taken before the first write.

---

## 7. Hand-off notes for fifth 3

- Fifth 3 opens on **P10**, `"And coming up short like that meant somebody"` (word 596, t = 204.080 s).
  The DP-checked minimum for P10 alone is 8 shots over 21.80 s.
- `brick-foreman` and `auditor-rep` are both established in `miniscribe-plant` and can take deltas
  there; `qt-wiles` is established in `miniscribe-plant`, `wiles-office` and `miniscribe-boardroom`.
- `brick-warehouse` (plate L03, `owner_ambiguity`) is still waiting for its act-3 revisit; the
  skeleton's `brick-company-yard` and `denver-newsroom` are still un-plated.
- The act-3 semantic-cast trap: P14 says "auditors" and P12 says "managers" — same shape as this
  fifth's four mass-action frames. `brick-foreman` IS justified across P12–P13 there, because those
  spans say "bricks" and "boxes" ("brick" is a slug token).
