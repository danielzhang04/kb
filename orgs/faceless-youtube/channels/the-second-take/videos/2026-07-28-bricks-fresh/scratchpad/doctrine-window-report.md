# Doctrine window — crowd expression + delta cap + seeded everyman

Worker report for the bricks-fresh crowd-expression restoration wave.
Worktree `kb-worktrees/boss-bricks-expression`, branch `claude/bricks-expression-restoration`.
Sources of law: spec `docs/superpowers/specs/2026-08-06-crowd-expression-restaging-design.md`;
Daniel's rulings in `knowledge/decisions.md` (2026-08-06 entry, points 2–4).

---

## 1. DOCTRINE MAP (written before any edit)

### 1.1 Where the figure-tier law actually lives today

| Home | What it says (pre-edit) |
| --- | --- |
| `style-bible.md` §1, last bullet | "**Two tiers of figure — by IDENTITY, per figure per shot:** named/recurring cast → seeded from its canonical, §2c auto-appends the form · crowd → the §2d CROWD RIG." |
| `visual-grammar.md` §2, tier bullet | "**Every human in frame is either NAMED CAST or CROWD — no third tier, no promotion path.** … An anonymous foreground human does not exist; an anonymous person with an individual count, action, or face requirement is CAST or the beat becomes mass action. … People without a story-bearing identity are staged at crowd scale." |
| `visual-grammar.md` §2, scope law | "two-step seeding applies to named-cast FRESH stage-base gens only … Combined with this tier law and the ≤2-cast cap below, **no other shot shape exists that a step-1 figure applies to**." |
| `visual-grammar.md` §2, cast-cap table | "**at most 2 named cast per shot**"; "Crowd-rig figures are a mass, not identities, and don't count against the cap." |
| `visual-grammar.md` §1, figure bias | A beat naming a person/party/decision/act is staged with the bodies doing it; a figureless frame must EARN its absence. |
| `visual-prompt-writer/SKILL.md` rule 3 | Registry names inline; "Never describe body pose, finger mechanics, or facial expression in words"; crowd declared `"crowd": true`; the same anonymous-person sentence as the grammar. |
| `style-bible.md` §2c | RIG-HOLD: "Hold ONLY this form — **costume, pose, expression, head tone, build, and framing are set by the generation delta**, not here." |
| `style-bible.md` §2d | CROWD-RIG: dot eyes, ONE simple mouth (**neutral / smile / downturn**), identical across the group without exception; "the seed reference contributes ONLY this head/face/hand simplification, **NEVER its own clothing**". |

### 1.2 **§2e does not exist.** (Correction to the brief's premise.)

The brief asked me to reconcile "§2e (unseeded full rig, generic outfit, no seed)" with the seeded
route. **There is no §2e in the current `style-bible.md`** — its headings run
§1 · §2 · §2b · §2c · §2d · §3 · §4 · §5 · §6. `git log -S"## 2e"` puts the removal in `f73c7e4`
("two-tier migration complete"): the unseeded anonymous-full-rig tier was ABOLISHED there, replaced by
the two-tier law above. §2e now survives only in historical review artefacts (the wells-fargo
`assets/_review/rig-shard-*.md` files and the poyais `_image-gen-plan`), which are records of a
run judged under the old law, not live doctrine.

Consequence for edit 3: there is no contradictory second tier to bound or integrate. The seeded
everyman is **not a revival of §2e** — §2e was defined by having *no seed* (which is exactly why
those reviews measured lanky proportion drift and blank mannequin faces: "§2e figures carry no seed
to pin proportion"). The everyman is inside the SEEDED tier. The reconciliation owed is therefore a
three-way tier statement in the two live homes (style-bible §1, grammar §2), not a §2e rewrite.
The abolished-tier residue that *is* live is `figures.anon_foreground`, hard-refused by name in both
`forge.py` (~L660) and `lint_shots.py` (~L1254) — see §1.5.

### 1.3 How forge treats a named `expr-`/`action-` slug on a non-cast figure — **it does not**

`forge.py::shot_cast` (L461-473) walks the backticked slugs in authoring order:

```python
if n in chars and n != "base":
    cast.append((n, []))
elif cast and assets.get(n, {}).get("kind") in _PRIMITIVE_KINDS:
    cast[-1][1].append(n)
```

Two facts follow, and I verified both empirically against the REAL registry rather than by reading:

```
prompt: "A brick-yard clerk, `base`, `expr-worried`, `action-slump`, stage-left in a 1980s office."
  shot_cast() -> []
prompt: "A brick-yard clerk, `expr-worried`, `action-slump`, stage-left in a 1980s office."
  shot_cast() -> []
prompt: "`macgregor`, `expr-smug`, stage-left."
  shot_cast() -> [('macgregor', ['expr-smug'])]
```

1. `base` is **explicitly excluded** from cast, so naming it is a no-op.
2. A primitive with no preceding cast name is **silently discarded** (the `elif cast and …` guard).

So today: naming `` `base` `` + its `expr-`/`action-` slugs mints **no STEP-1 card, seeds nothing,
and raises nothing**. Worse, the shot then measures `cast_free = not (fig_roles or canon_roles or
crowd or anon_declared)` (forge L1633) → TRUE, so forge derives the §5 scene style tile as if the
frame held no people. The everyman renders on style prose alone with no rig anchor — the exact
unseeded shape §2e was abolished for.

All the *rest* of the machinery is already correct for the route: every `expr-*`/`action-*`/`pose-*`
asset in `registry.json` carries `character: base` and `seed_frame: refs/base/base.png`; `characters.base`
has a canonical; `figure_frame_name("base", pose, expr)` → `fig-base--action-x--expr-y`; the STEP-1
recipe would seed [base canonical + expression card + pose card] and the scene would then seed that
card. **The entire gap is the four tokens `and n != "base"`.**

### 1.4 Why the current law demotes performers (the audit's mechanism, confirmed)

`authoring-audit.md` §1 measures it: only 28 of the 80 joke-carrying shots (idiom-pun /
ironic-counterpoint / reaction-shot) have a named figure in frame; 43 are crowd-only; 96 of 142 crowd
shots use the same "a crowd of X works the far side of Y" sentence shape. The composition is:
figure-bias (§1) demands a body → the tier law says an anonymous body cannot exist in the foreground →
a foreground performer therefore costs a named-cast slot against the ≤2 cap plus a STEP-1 gen → the
cheap compliant move is `crowd: true` in a rear zone. **Figure bias gets satisfied by POPULATION, not
PERFORMANCE.** The seeded everyman is precisely the missing cheap-and-legal route.

### 1.5 Couplings found (all recorded, none forced)

- **BLOCKER — `shot_cast`'s `base` exclusion (§1.3).** Doctrine can route to the seeded everyman;
  the engine cannot resolve it. One-token fix + a pinned test, owed as its own scoped code task
  (same handling as the fail-silent place-plate defect already queued in `decisions.md`). Not made
  here: forge.py was read-scope in this brief and it is a generation-spend engine.
- **`figures.anon_foreground` refusal text is now incomplete** in BOTH engines: it offers exactly two
  remedies ("name the figure in the video's cast (seeded) or stage the people at crowd scale"). The
  third route now exists. `lint_shots.py`'s own docstring pins the two messages as deliberately
  identical ("so lint never hands the author a second, different fix"), so this is one paired edit on
  both engines + their tests, not a lint-only touch. Left alone; routed with the blocker above.
- **`cast_free` / style-tile derivation** (forge L1633) will start reading everyman shots correctly
  only once the blocker lands — until then it silently mis-anchors them.
- **`stage_check` docstring, `shots-schema.md`, `critics.md`, `image-generation/SKILL.md`,
  `animation-rules.md`, `shots-motion-schema.md` and two Python docstrings** all restate the delta cap
  number; all were updated so no file states a superseded contract (§2.2).
- **Existing chains at base+3 are now violations** — 3 quads in the current bricks-fresh file
  (incl. L22–25). Per the spec these route to the audit fix-list, NOT a hot patch. `lint_shots.py`
  will HARD-fail that file until the audit restages them; that is intended, not a regression.

---

## 2. EDITS

13 files, all integrated in place. No new field, no new mechanism, no vocabulary list, no simplicity
rulebook. `shots.json` untouched. `style-bible.md` §2d untouched.

### 2.1 Edit 1 — crowd expression/pose restoration (2 files)

- **`visual-prompt-writer/SKILL.md` rule 3.** The ban is re-scoped, not deleted: "**On a
  registry-backed (cast or seeded) figure**, never describe body pose, finger mechanics, or facial
  expression in words — that figure's seed carries them, and naming the asset IS the authoring act."
  One new sentence gives crowds their channel back: "**A crowd-rig figure has no seeded pose or
  expression, so plain scene prose is its ONLY expression channel** — write the beat's simple
  expression ("grinning", "worried", "deadpan") and the group's whole-body attitude, exactly as any
  other scene fact. An unauthored crowd renders uniformly neutral, which is how a comic beat arrives
  dead."
- **`visual-grammar.md` §2**, the parallel clause ("the prompt may not narrate what the seed already
  carries"): scoped with one sentence — "**This is a rule about SEEDED figures only:** a crowd-rig
  figure names no asset and carries no seeded pose or expression, so its expression and attitude are
  authored in plain prose (below)." The crowd staging sentence in the tier bullet now lists expression
  and group attitude alongside where they stand / what they do / what they wear.
- **`references/critics.md` §3** (found by grep, not in the brief): the critic's own prompt-construction
  check said "is … facial expression written as PROSE where a registry name is the authoring act?" —
  which a critic could read as a blanket ban and re-flag every restored crowd. Scoped to seeded figures,
  with the inverse finding named: absence of crowd emotion on a beat whose energy lives in the VO.
- **Not touched:** style-bible §2d (its "identical simplified face … without exception" hardening stands;
  the L07 re-mint is the canary per the spec).

### 2.2 Edit 2 — delta-chain cap ≤3 → ≤2 (9 files)

Behaviour: `lint_shots.py::stage_check` `deltas > 3` → `> 2`, message now "N delta frames (>2) — cap
the chain at 2, then re-base or hard-cut."; its docstring follows. Pins in `test_stage_check.py`: the
over-cap fixture is now base+3 asserting `">2"`, the at-cap fixture is base+2 asserting clean, the
per-stage-reset fixture uses two 2-delta chains, and the module docstring states ≤2.

Wording updated everywhere the number states THIS contract (all verified single-occurrence):
`visual-grammar.md` §1 · `visual-prompt-writer/SKILL.md` (step 2.5 chain logic, step 3a place/stage
definition) · `references/shots-schema.md` (×2) · `references/critics.md` (mechanical caps the critic
must not re-flag) · `image-generation/SKILL.md` recipe row (e) · `motion-planner/references/animation-rules.md` ·
`render-builder/references/shots-motion-schema.md` · `knowledge/research/niche-playbooks/universal.md`
§13a-ii (the "full law" both motion docs cite — leaving it at 3 would have made the cited authority
contradict the enforcing lint) · two docstrings that restate it (`forge.py::cmd_batch`,
`test_forge_place_and_gates.py`) — docstrings only, zero forge behaviour change.

Untouched 3s (not this contract): thumbnail `text_overlay` ≤3 words, researcher's ≤3–4 sub-questions,
`test_breath.py`'s chained-word count, crowd's 2–3 hair silhouettes.

Live-file effect, measured: `lint_shots.py` on the current 248-shot `shots.json` now reports exactly
**3 cap violations** — the 3 base+3 quads the spec predicted. Per the spec these route to the audit
fix-list; NOT hot-patched here.

### 2.3 Edit 3 — seeded-everyman routing (3 files)

- **`visual-grammar.md` §2 tier bullet** rewritten from "Every human in frame is either NAMED CAST or
  CROWD — no third tier, no promotion path" to: "**Every human in frame is SEEDED or CROWD, decided by
  IDENTITY — and there is no promotion path: a figure is authored in its tier from its first frame.**"
  Three routes stated: NAMED CAST (locked identity, canonical, pinned costume) · **SEEDED EVERYMAN**
  (anonymous but story-bearing; claims no identity and mints no canonical; seeded off the shared `base`
  rig through the `expr-`/`action-` vocabulary the beat needs; **always dressed in the shot's own era
  and setting in prose** — the base template never renders as itself, style-bible §2c/§2d) · CROWD
  (declared, exemplar-seeded, **reserved for genuine MASSES**).
  The demote-to-crowd sentence is gone. In its place: "A story-bearing foreground individual must not be
  replaced with an empty object, **nor demoted to rear-zone crowd**, to avoid spending a figure …
  Crowd scale is never the fallback for ONE anonymous performer; the seeded everyman is." Cited to the
  audit's own number (19 of 26 idiom-puns). Both seeded forms spend a slot against the ≤2 cap.
- Two consequential consistency edits in the same file: the **scope law** now reads "two-step seeding
  applies to SEEDED figures on FRESH stage-base gens only — named cast and the seeded everyman alike,
  each getting its own step-1 card" (it previously said "named-cast … only" and closed with "no other
  shot shape exists"), and the **cap header** is now "**The foreground cap — at most 2 SEEDED figures
  per shot** (named cast or seeded everyman, in any mix; each spends one step-1 card)". Cap value
  unchanged at 2; crowd still doesn't count.
- **`visual-grammar.md` §1 figure bias** — one clause closing the loop the audit measured: "**Figure
  bias is satisfied by PERFORMANCE, not by population:** the body doing it stands where the beat is, on
  the seeded tier (§2) — a rear-zone crowd behind an unmanned prop does not stage the line."
- **`style-bible.md` §1 tier bullet** — "Two tiers of figure" → "Figures are SEEDED or CROWD … SEEDED
  splits on whether the identity is locked", with the everyman's clothing law stated as the resolution
  of the apparent conflict with "the base never appears in videos". Routes tier decisions to
  `visual-grammar.md §2`. §2/§2b/§2c/§2d and every LOCKED descriptor untouched.
- **`visual-prompt-writer/SKILL.md` rule 3 figures law** — "An anonymous person with an individual
  count, action, or face requirement is CAST, or the beat restages as mass action; people without a
  story-bearing identity are staged at crowd scale" → "**Crowd is for genuine MASSES.** An anonymous
  individual who BEARS the beat — performs the gag, reacts, decides — is staged as a **seeded everyman**
  …, not demoted to the rear zone; a person with a locked identity is CAST; only people with no
  story-bearing part are staged at crowd scale."
- **§2e:** no edit possible or needed — it does not exist (§1.2). Reported, not invented.
- **Engine gate stated once, in the grammar, dated and marked for deletion** (see §4 weakness 1). It is
  precision about a live bind, not a competing rule: the everyman route is doctrine, the forge fix is
  owed.

## 3. TEST RESULTS (verbatim tails)

Baseline BEFORE any edit (both suites):

```
$ python -m pytest .claude/skills/visual-prompt-writer/scripts/ .claude/skills/image-generation/scripts/ -q
........................................................................ [ 95%]
....................                                                     [100%]
452 passed in 7.33s
```

AFTER all edits (both suites; `test_forge_style_tile.py` is inside this run and also run alone below):

```
$ python -m pytest .claude/skills/visual-prompt-writer/scripts/ .claude/skills/image-generation/scripts/ -q
........................................................................ [ 79%]
........................................................................ [ 95%]
....................                                                     [100%]
452 passed in 5.18s

$ python -m pytest .claude/skills/image-generation/scripts/test_forge_style_tile.py -q
..............                                                           [100%]
14 passed in 0.24s
```

The plain-assert files carry their own `Run: py -3 …` header and were also executed directly
(they also run under pytest at import, so a broken assert would surface as a collection error):

```
$ python .claude/skills/visual-prompt-writer/scripts/test_stage_check.py
PASS test_stage_check
```

Behaviour probe on the changed cap (the pin is not the only evidence):

```
base+2 deltas -> HARD: []
base+3 deltas -> HARD: ["[t] stage 'g': 3 delta frames (>2) - cap the chain at 2, then re-base or hard-cut."]
```

Tally: **452 passed, 0 failed, 0 skipped** — same count as baseline (no test added, none removed; the
three `test_stage_check` fixtures were re-pinned in place). No test failure revealed an unanticipated
coupling; nothing was forced green.

## 4. WEAKNESSES (first, and honestly)

1. **BLOCKER — the seeded-everyman route is doctrine the engine cannot execute.** `forge.py::shot_cast`
   excludes `base` (`if n in chars and n != "base"`), and a primitive with no preceding cast name is
   silently discarded. Verified empirically against the real registry (§1.3): a prompt naming
   `` `base` ``, `` `expr-worried` `` and `` `action-slump` `` resolves to `[]` — no STEP-1 card, no
   seed, no warning — and the shot then measures `cast_free`, so forge derives the §5 style tile as if
   the frame held no people. Everything else is already in place (all `expr-*`/`action-*`/`pose-*`
   assets carry `character: base` + `seed_frame: base.png`; `characters.base` has a canonical;
   `figure_frame_name("base", …)` composes). **The whole gap is four tokens.** Not fixed here: forge.py
   was read-scope in my brief, it is a generation-spend engine, and `decisions.md` set the precedent
   that forge defects get their own scoped task with tests (the fail-silent place-plate fix). Blast
   radius measured before recommending it: **zero** — no `shots.json` in the repo backticks `base`, and
   lint has no cast-count check to disturb. Owed: the one-token change + a test pinning
   `shot_cast` → `[("base", ["action-slump", "expr-worried"])]` and a batch test asserting the
   `fig-base--…` STEP-1 card is minted and `cast_free` is False. **Until it lands, the everyman route is
   worse than absent — it fails silently and pays for an off-rig frame.** That is why the grammar
   carries one dated italic engine-gate line telling authors to use named cast or restage meanwhile;
   delete that line with the fix.
2. **`figures.anon_foreground`'s refusal text is now incomplete on both engines.** `forge.py` (~L660)
   and `lint_shots.py` (~L1254) both say the remedy is "name the figure in the video's cast (seeded) or
   stage the people at crowd scale" — two routes where there are now three. `lint_shots.py`'s docstring
   deliberately pins the two messages as identical ("so lint never hands the author a second, different
   fix"), so this is one paired edit across both engines plus `test_new_guards.py`, not a lint-only
   touch. Left alone; it belongs with weakness 1 in the same forge task.
3. **The §2d canary risk is unchanged and unmeasured.** §2d still says "identical simplified face …
   without exception" and offers exactly three mouths (neutral / smile / downturn). Restored crowd
   emotion has to survive that hardening. The spec's L07 re-mint is the only evidence that will settle
   it; I added nothing to pre-empt it, per the non-goals.
4. **The everyman's rig is unproven in pixels.** The STEP-1 card payload
   (`figure_card_payload`) renders "the character alone, fully resolved" from `base.png` — i.e. bald,
   cream, brown hoodie — and the scene prompt is then expected to overwrite the costume from prose under
   §2c. That inheritance is doctrinally sound but has never been rendered for `base` specifically, and
   the wells-fargo reviews record what unseeded anonymous figures did (lanky drift, blank faces). First
   everyman gens should be treated as a probe, not production.
5. **`universal.md` is cross-channel and I moved its number.** The ≤2 cap was ruled for The Second
   Take's boredom problem, but `lint_shots.py` is channel-agnostic, so the mechanism is universal
   whatever the docs say. Leaving §13a-ii at ≤3 would have made the authority both motion docs cite
   contradict the lint that enforces it. Flagging it as a deliberate, reversible call, not an oversight.
6. **Three live violations created by design.** The current `shots.json` now HARD-fails lint on 3
   stages. That is the intended routing to the audit fix-list, but any run that lints that file before
   the audit applies will see a red gate.
7. **No generation evidence anywhere in this report.** Everything here is doctrine, lint and static
   probes. Whether restored crowd prose actually changes a face, and whether an everyman holds the rig,
   are both pixel questions this window did not and could not answer.
