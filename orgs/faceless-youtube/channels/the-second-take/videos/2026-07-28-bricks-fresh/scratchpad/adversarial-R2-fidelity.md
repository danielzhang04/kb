# Adversarial review R2 — goal fidelity & contradiction lens (2026-08-04)

Reviewer: R2 (read-only; this file is the only write). Surface: branch diff `7f38d18..HEAD` on
`claude/bricks-doctrine-reset` (worktree `kb-worktrees/boss-bricks-reset`) for checks A/B/D, plus —
per Daniel's mid-review scope widening — the **end state** of every prompting/image-gen governing
file for checks C/E. Authorities, in order: the reset **spec**, the **plan's C-1…C-12**, the
adversarial review **§5/§6** (binding annex), then the build reports (claims, verified against code).

**Verdict: FIX-THEN-PROCEED.** 2 BLOCKING · 7 MAJOR · 12 MINOR.
The wave's direction is right and the hard parts landed (place model, same-place law, provenance,
expression-delta, machine-emitted rows, one-voice descriptor). What is not yet true is the claim that
*style is one voice* — the suffix source document was never edited — and the claim that the new lints
*cannot false-positive on legitimate prose*: measured on the archived 214-shot file, one HARD check
fires 28 times and at least 5 of those are ordinary intra-frame English.

**Method note.** I ran the landed lint over the ARCHIVED `shots.json` (the §3 calibration artifact
Daniel is owed) and over the channel's own `example-shots.md` exemplars. Fire counts and quoted
examples below are measured, not argued. Full suite: **336 tests green** (142 image-generation,
194 visual-prompt-writer) — reproduced.

---

## Findings

Tags: `[wave]` = introduced/left by this wave · `[legacy]` = pre-existing debt the wave makes visible.

### BLOCKING

#### R2-B1 `[wave]` — The one voice was never fixed at its source: `global_prompt_suffix` still says "gentle soft cel shading"
**File:** `channels/the-second-take/visual-kit/visual-grammar.md:14-16`
**Violates:** spec §1 Style ("VPW `global_prompt_suffix` **inherits the recipe**"); C-1; C-2; Daniel's
goal function ("style is TEXT-ONLY with ONE voice … no fourth voice anywhere"); audit mechanism 1.

The channel's suffix blockquote — declared by `shots-schema.md` as "**copied verbatim** from
`visual-grammar.md`'s header — never re-derived per video — and appended to every `still_prompt`,
`first_frame`, and thumbnail `gen_prompt`" — is untouched by this wave and still reads:

> clean flat cel-shaded cartoon style, an even medium-thick dark warm brown-black #241a12 outline on
> everything, flat colours **with gentle soft cel shading**, rounded friendly shapes, no realistic
> detail, hand-lettered marker capitals for any in-world text

That is the exact phrase C-1 deleted from `style-bible.md` §2b, sitting in the ONE string appended to
every prompt in the video — i.e. the fourth voice survives, and it is the loudest one (per-prompt,
trailing position). Two consequences, both measured:

1. Running the landed lint over the archived `shots.json` produces two HARD suffix failures:
   `[suffix] global_prompt_suffix: soft/gradient-permissive wording 'gentle' …` and `… 'soft' …`.
2. The doc law and the lint law now directly contradict: an author who obeys `shots-schema.md`
   ("copied verbatim … never re-derived") hard-fails `suffix_one_voice_check`; an author who passes
   lint has silently re-derived the channel's fixed data. There is no legal authoring move.

**Fix:** rewrite the `visual-grammar.md` suffix blockquote from C-1's terms in the same wave — e.g.
"clean flat cel-shaded cartoon style, an even medium-thick dark warm brown-black #241a12 outline on
everything, flat colour fills — one flat base colour per surface plus at most ONE hard-edged
single-step shadow shape, no feathered or blended transitions, uniform highlight-free surfaces —
rounded friendly shapes, no realistic detail, hand-lettered marker capitals for any in-world text" —
then re-run `suffix_one_voice_check` over it as the acceptance check. Also add the suffix's own
assembled bytes to the §4 probe pin, since it is the string the engine actually sees last.

#### R2-B2 `[wave]` — `action_chain_check` is a false-positive machine, contradicts the place model, and collides with C-8's own two-cast law
**File:** `.claude/skills/visual-prompt-writer/scripts/lint_shots.py:1564` (`_SAME_CALLBACK`), `:1685`
(`action_chain_check`)
**Violates:** Daniel's goal function ("calibrated lints that CANNOT false-positive on legitimate
prose"); C-8 as written ("**consecutive shots whose `vo_text` continues an action on the same
props**"); review §6 C3 ("a lint that cries wolf gets routed around"); the C-4/C-5 place model.

The landed check keys on the regex `\bthe\s+same\s+[a-z]` in **`still_prompt`** — not on `vo_text`,
not on consecutiveness, not on props — and hard-fails any match unless the shot declares `stage` or
`hard_cut: true`. Measured over the archived file: **28 HARD fires / 214 shots**. At least five are
unambiguous false positives on legitimate prose, because "the same X" in this project is routinely an
**intra-frame** comparison, not a cross-shot callback:

| id | class | quoted prose | why it is legitimate |
|---|---|---|---|
| L39 | staged-interaction | "the two of them at **the same eye-line** across a counter's width" | this is *the eye-line clause C-8 itself demands* |
| L83 | ironic-counterpoint | "holds one open ledger page up beside a warehouse shelf at **the same height**, side by side" | one frame, two objects compared |
| L24 | map-plan-view | "drawn small but plainly **the same pallet** three times" | repetition inside one plan view |
| L204 | symbolic-stand-in-object | "**The same** steel-grey suit jacket `qt-wiles` wore through his rise hangs alone on a hook" | a `place`-exempt symbolic insert; a `stage` chain or a `hard_cut` declaration is meaningless here |
| L142 | physicalized-imbalance | "**The same** warehouse bay from a wider stance" | under the NEW doctrine this is a `place` continuation seeded off the plate — exactly the authoring the wave wants |

Three structural problems, not just calibration:
- **It ignores `place` entirely.** The whole point of C-4/C-5 is that continuity now runs on
  place→plate seeding, not only on `stage`. A shot that correctly declares `place` and says "the same
  boardroom" hard-fails and can only be silenced by writing `hard_cut: true` — which the schema
  defines as "this shot's action deliberately does NOT continue the previous shot's", i.e. the author
  is pushed to **declare a falsehood** to pass lint.
- **It collides with the sibling C-8 check.** Writing the required eye-line clause in the most natural
  English ("at the same eye-line") trips this check (L39 fires on both checks simultaneously).
- **It fires on `place`-exempt shot classes** (L24 map-plan-view, L204 symbolic-stand-in-object), which
  by C-3 cannot declare a place and have no continuity chain to declare.

**Fix (any one, cheapest first):** (a) exempt shots that declare `place` **or** whose `shot_class` is
in `_PLACELESS_SHOT_CLASSES`, and restrict the regex to a leading-position callback
(`^(?:the|The)\s+same\b`) so intra-sentence comparisons ("at the same height/eye-line") never match;
or (b) implement C-8 as pinned — key on consecutive shots' `vo_text` continuing an action, with the
still_prompt idiom as corroboration only. Either way, re-run the archived-file calibration and put the
new fire count in the §3 gate artifact: today's 28 is not a calibrated number.

---

### MAJOR

#### R2-M1 `[wave]` — C-4's conditional plate law is implemented nowhere: no side enforces "a qualifying place must have a plate"
**Files:** `.claude/skills/image-generation/scripts/forge.py:1384` (`plate = not seeds`);
`lint_shots.py` (no check)
**Violates:** C-4 ("Plate-qualifying places: ≥2 shots share the `place`, or the place carries owner
branding"); spec §1 Place ("Conditional plate law (M4)"); plan Task B ("lint validates authoring
matches" C-4).

Forge derives `plate` as "this slate ended up with zero seeds" — a *consequence*, not the contract's
*rule*. Nothing anywhere asks whether a place that hosts ≥2 shots actually has a no-cast place-first
frame. Worker A's report names this as deliberately punted to lint/VPW ("whether a plate had to be
authored for a place is lint's/VPW's call"); worker B's report names it as deliberately punted to
forge ("that's forge's runtime derivation … lint validates AUTHORING contracts around it"). Both
punted; nobody landed it. Net effect: a recurring place whose first shot carries named cast gets no
plate, and every later shot in that place seeds a **cast-bearing rendered scene** as its place frame —
the content-bleed path the doctrine limits to plates by design.

**Fix:** add one lint check — group shots by `place`; for a group of ≥2 (or any group where
`place_owner_check` finds a trackable literal), require the first shot in file order to declare no
backticked registry cast; fail HARD with the C-4 wording otherwise. That is the check that makes
"place is pixels-only per video" true rather than aspirational.

#### R2-M2 `[wave]` — `place_owner_check` picks the wrong shot as the plate (contradicting its own docstring)
**File:** `lint_shots.py:1449-1478`, esp. `:1474` `plate = grp[0]`
**Violates:** C-4 (plate = first emitted shot of the place **declaring zero named cast**); internal
consistency (the docstring at `:1455` claims exactly the cast-filtered definition the code does not
implement).

`grp[0]` is the first shot of the place in file order regardless of cast. When a place's first shot
carries cast (common — a place is often entered with a character), forge's derived plate is a
different shot, so lint demands the owner literal on a frame that is not the plate and reports a HARD
failure the author cannot fix without breaking C-4. **Fix:** compute the group's plate with the same
predicate as R2-M1's new check (first no-cast shot; fall back to `grp[0]` only when the place has none,
and say so in the message).

#### R2-M3 `[wave]` — Daniel's failure #6 (invisible office ownership) is closed on neither the lint nor the review side
**Files:** `lint_shots.py:1449` (`place_owner_check` returns early when no literal exists anywhere in
the place); `build_review_artifact.py:124,161` (`owner_branding_declared` / `applicable_invariants`)
**Violates:** spec §1 ("institution-owned interiors author one visible owner cue on the plate or record
intentional ambiguity"); C-12 ("place-owner only on branded interiors"); audit failure #6.

Both mechanisms are conditioned on the cue **already being authored**:
- lint: "nothing branded declared anywhere in this place — not this check's job" ⇒ a place where the
  author simply forgot the owner cue passes silently.
- review: `applicable_invariants` emits the `place-owner` row only when `shot.get("place") and
  owner_branding_declared(shot)`, and `owner_branding_declared` is true only if a quoted literal is
  present **or** `owner_ambiguity` is declared. The failure state (no cue, no ambiguity flag) emits
  **no row**, so the human is never asked the one question that would catch it.

The predicate suppresses exactly the case it exists to catch. **Fix:** emit the `place-owner` review
row on every shot that declares a `place` (the row is one line of eye cost, and "is ownership legible
or intentionally absent?" is precisely a human judgement); optionally add a critic question for
"institution-owned interior with no owner decision recorded", since C-8/C-3 give lint no way to know an
interior is institution-owned.

#### R2-M4 `[wave]` — The C-6 record loop has no closing step: the run hard-stops on the first reuse of a figure it minted itself
**Files:** `forge.py:1152` (`figure_reuse_refusal`), `forge.py` `cmd_batch` reuse branch;
`stamp_review.py` `--figures` path; `.claude/skills/image-generation/SKILL.md` (no mention)
**Violates:** spec §1 Forge gates (the gate is specified with a writer, but nothing produces the
writer's input); plan Task D; Daniel's goal (root-cause fixes that the operator can actually run).

`cmd_batch` refuses any staged `fig-*` reuse without an all-pass, sha-matching record. Records are
written only by `stamp_review.py --figures <input.json>`, whose input is described as "produced
upstream (by whatever tool runs that review)" — **no such tool exists**, `build_review_artifact.py`
emits no figure verdicts, and `image-generation/SKILL.md` never mentions `review.json`, `--figures`,
or the remint command (grep: zero hits). Consequence for the actual run: fifth 1 mints ~50 STEP-1s
fine (zero records, nothing reused). From fifth 2 onward every batch that re-uses a previously minted
figure raises `SystemExit`, and the printed remedy (re-mint) regenerates the same recordless file —
the loop does not terminate without a human hand-authoring JSON that no doc describes.

**Fix:** document the closing step in `image-generation/SKILL.md`'s review section — who writes the
figure-verdicts file, in what shape, and at which gate (it is the same fresh-eyes pass that already
rules on the STEP-1 board) — and, ideally, have `build_review_artifact.py` (or a tiny sibling) emit the
figure-verdict skeleton keyed by `fig-*` id + `canonical_sha256` so the human only fills verdicts.

#### R2-M5 `[wave]` — `semantic_cast_check`'s documented exemption does not work for the commonest form (plural role vs singular slug)
**File:** `lint_shots.py:1708-1731`
**Violates:** C-8/M11 narrowness ("fail only when … a declared named character appears nowhere in that
VO span ±1"); the check's own docstring ("A shot where the VO itself names the role … stays silent").

The justification test searches the ±1 VO window for each hyphen token of the slug with word
boundaries: `\bbanker\b` against a VO that says "**bankers**" does not match. Measured: 10 fires, of
which at least 6 are the plural-role/singular-slug case the docstring promises to leave alone — L45
('bankers' vs `hq-banker`), L76/L182 ('accountants' vs `auditor-rep`), L150 ('auditors' vs
`auditor-rep`), L80, L191. The genuine target (L100 'managers' vs `brick-foreman`+`qt-wiles`) fires
correctly, so the check works; it just also fires where its own text says it will not.
**Fix:** match on a stem (`re.search(tok + r"[a-z]{0,3}\b", window)`) or singularize the plural role
before comparison, and re-report fire counts in the calibration artifact.

#### R2-M6 `[wave]` — The channel's depiction bar (`example-shots.md`) now hard-fails two of the new HARD lints
**File:** `channels/the-second-take/example-shots.md:25` (entry 2), `:32` (entry 3)
**Violates:** cross-file consistency (VPW SKILL Step 1 tells the author to match this file's bar);
C-7; C-8. Verified by executing the landed checks against the exemplar strings.

- Entry 3: "`macgregor` (`sit`, `expr-deadpan`) sits alone **at one small desk**" ⇒
  `seat_support_check` HARD fail — "desk" is not in the closed support list (`desk **edge**` is).
  The channel's canonical seated exemplar is illegal under the new law.
- Entry 2: two named cast with "a full stride of open sand separates them, hands never meeting" ⇒
  `two_cast_presence_check` HARD fail (no plane, no eye line, no relative head scale).
- Additionally, no exemplar in the file demonstrates `place`, and entry 6's rationale still teaches
  stage-only continuity ("three claims … share one stage").

A fresh VPW reads this file as the bar and will reproduce prose the lint rejects. **Fix:** update the
two exemplar strings in place (add "on a chair at one small desk", add a plane/eye-line/scale clause to
entry 2) and add one short place-declaring exemplar showing plate + in-place shot.

#### R2-M7 `[wave]` — C-10's expression state is keyed on `place`, so the gate leaks across stage chains inside one place
**File:** `forge.py:1228, 1280-1283` (`held_expression[(place, c)]`)
**Violates:** C-10 (a delta's expression is judged against **its chain**); `shots-schema.md`'s own place
model ("A place can host many stage chains — the boardroom's fear beat, firing beat, and planning beat
are three `stage`s inside one `place`").

Because `place` is now the map key, expression state carried by chain A persists into chain B in the
same place. The dangerous direction is the **false negative**: if chain B's base does not name a
character but a later delta introduces him with the same expression chain A left on record, `changed`
is falsy and the gate never fires — precisely the L75 mechanism (an expression changed by prose alone)
slipping through the gate built to stop it. The mirror case (false positive) merely demands an extra
primitive. **Fix:** key held expressions on the chain, not the place —
`(place, shot.get("stage") or place, c)` — or reset the entry at every `stage_role: "base"`.

---

### MINOR

1. `[wave]` **C-7's binding text in the plan is stale, not the code.** Plan C-7 says the seated
   primitive binds "via the shot's `figures` cast list"; `figures` holds only the crowd tier. The
   implementation binds by backtick order mirroring `forge.shot_cast` (`lint_shots.py:1607`), which
   matches spec §1 ("registry binding, never the English verb") and is correct. Fix the plan text so a
   later reader does not "restore" the wrong binding.
2. `[wave]` **C-9's "crowd is background tier" precondition is not implemented**
   (`forge.py:1370-1378` tests only cap + place role + crowd role). It is vacuous under the two-tier law
   (worker A's report says so), but the SKILL's worked example and the contract both state it — say
   "crowd IS the background tier" in the SKILL sentence so the condition cannot be re-litigated.
3. `[wave]` **C-12 "flat-cel hazards on all" narrowed to `source == "ai-gen"`**
   (`build_review_artifact.py:166`). Defensible (stock/chart frames carry no gen style risk) but it is
   a deviation from the pinned wording; state it in the contract or widen it.
4. `[wave]` **The machine-emitted rows are display-only.** They render as `<li>` text with no fill-in
   affordance and no linkage to `merged.json`'s `f`/`s`/`r`/`dsg` axes that `stamp_review.py` consumes,
   so the reviewer still transcribes verdicts elsewhere. The contract shape is correctly untouched
   (§6.5 respected); the cost saving is smaller than the spec claims.
5. `[wave]` **Two different definitions of "seated shot" and "named figure in shot".** Lint reads
   backticks in `still_prompt`; the review artifact reads `assets/library/manifest.json` `kind`
   (`build_review_artifact.py:79-118`). They can disagree (a shot lint flags for C-7 may emit no
   support row, and vice versa). Note the divergence in one of the two docstrings, or derive both from
   the same signal.
6. `[wave]` **The motion-planner "plate" vs place-"plate" disambiguation was never written.** Spec
   §Regression carve-outs required it explicitly ("different 'plate', same word — say so explicitly").
   Grep across both SKILLs + `shots-schema.md`: zero hits. `motion-planner/references/animation-rules.md:18`
   and `references/critics.md:21` still say "the video's own plate carries the style anchor duty itself
   now" — true for layered plates, but a reader arriving from the new place law will misread it as the
   place plate. Add one sentence to `image-generation/SKILL.md` §Layered shots and to `shots-schema.md`'s
   `place` bullet.
7. `[wave]` **§2e/BASE-RIG machinery removal exceeded the plan's named dead code.** `_BASE_RIG_ANCHOR`,
   `_rig_tail`, `_has_binding`, `_FIG_BINDING`, `desc_baserig` and `figures_expansion`'s `stage_role`
   parameter were deleted (`forge.py:218-262`, `:310`, `:348`). Behaviour-safe (the bible has no §2e
   section, so the anchor read empty), and it serves review §6.2 — but the plan's global constraints
   list "BASE-RIG clause" as a LOAD-BEARING anchor, so the removal contradicts the plan's own text.
   Reconcile the plan/constraint list.
8. `[wave]` **`place_shot_class_exempt_check` keys on key presence** (`"place" in sh`,
   `lint_shots.py:1399`), so an explicit `"place": null` fires. Harmless but noisy; test `sh.get("place")`.
9. `[wave]` **Lint message grammar:** "names no **a** support object …" / "names no **a** contact
   phrase …" (`lint_shots.py:1652`). One-word fix; these strings are what the author reads 12+ times.
10. `[wave]` **C-1's replacement drops two anchors from §2b** — "Draw in the SAME art style as the
    reference image" and "a clean FLAT cel-shaded CARTOON look". The replacement is verbatim-correct per
    the contract, so this is not a deviation; but §2b is the descriptor used for `new_character` and
    scene gens, and the reference-binding sentence was doing work. Flag it for the §4 style probe
    (it is exactly what a one-plate + one-STEP-1 + three-frame probe would expose).
11. `[wave]` **Per-video literal in skill docs:** `miniscribe-boardroom` appears as the `place` example
    in `shots-schema.md:20` and `visual-prompt-writer/SKILL.md`. Authorized by C-3's own wording, and
    it is prose not code, so it does not breach §6.14's intent — but it is this video's company name in
    a shared skill. Consider `<company>-boardroom`.
12. `[legacy]` **Six channel probe scripts still carry "gentle soft cel shading"** —
    `visual-kit/scripts/gen_angle_test.py:50`, `gen_cast_test.py:46`, `gen_locked.py:54`,
    `gen_proof.py:44`, `gen_scene_test.py:48`, `gen_style_iter.py:57`. None is in the render path (they
    are one-off style-probe harnesses), so no live prompt inherits them — but they are a second voice
    living in the channel kit and would mislead the next style probe author. Sweep or mark superseded.

---

## A. Contract fidelity — C-1 … C-12

| # | Landed at | Verdict |
|---|---|---|
| C-1 unified recipe | `style-bible.md` §2b:43-46 | **EXACT** — byte-verbatim against the pinned blockquote; anchors (`STYLE-ONLY descriptor`) unchanged; §2c/§4/§5 swept clean of soft/gradient wording (grep: only "soft near-circle"/"soft light-grey background", neither shading-permissive). Reinforcement in `forge.py:283-291` (assembled onto §2b at `:310`) uses the recipe's own terms + the C-2 NO-list — one voice, verified. **But see R2-B1: the suffix, the third surface named by the spec, was never edited.** |
| C-2 banned terms | `lint_shots.py:1303-1315`, `render_technique_check:1329` | **EXACT** — all ten terms, case-insensitive, prompts + suffix + thumbnail + shorts; scene-light nouns deliberately absent. Calibration: 4 true-positive fires on the archived file (L02/L10/L18 "glossy", L89 "blurred behind"), zero false positives observed. Best-calibrated check in the wave. |
| C-3 `place` key | `shots-schema.md:20,56-70`; `lint_shots.py:1387-1421` | **MATCHES** — kebab-case shape check, five place-less shot classes, `first_frame`/thumbnail exemptions, inventory check against `script_vocab`. Exempt-class list is identical in lint and schema. |
| C-4 plate derivation | `forge.py:1384` | **PARTIAL** — `plate` is derived (not authored), `--plate-candidates` and `root_scene` are gone (grep: zero hits repo-wide), zero-seed legality keys on the derived plate (`forge.py:665-682`), one map keyed place>stage>id (`:1251`). **The qualifying-place half is unimplemented on both sides — R2-M1.** |
| C-5 same-place law | `forge.py:1253-1265` + `_anchor_place:1181`; `lint_shots.py:1479` mirror; both refusal texts quote decisions.md 2026-08-04 | **MATCHES** — base-only restriction removed both sides, delta refused both sides, wording aligned between forge and lint. |
| C-6 figure record | store read `forge.py:1129-1176`; writer `stamp_review.py --figures` | **MATCHES on shape** (`canonical_sha256`/`expression_sha256`/`verdicts`/`reviewer`/`date`, single-writer preserved, refusal prints the one-line remint, nothing grandfathered). **Operationally open — R2-M4.** |
| C-7 seat/support | `lint_shots.py:1607-1655` | **MATCHES spec** (registry primitive, never the verb; closed noun list verbatim; contact phrase same-sentence; framing = soft + review row). Plan's parenthetical is wrong, not the code (MINOR 1). Calibration: 12 fires, 1 soft — all on genuinely support-less seated prose. **But the channel exemplar fails it — R2-M6.** |
| C-8 presence checks | `lint_shots.py:1657` (two-cast), `:1685` (action chain), `:1708` (semantic cast); `hard_cut`/`owner_ambiguity` added to schema + `bool_field_check` | **two-cast: MATCHES** (22 fires, all true presence gaps). **action-chain: DEVIATES — R2-B2.** **semantic-cast: narrow as pinned but mis-calibrated — R2-M5.** |
| C-9 cap displacement | `forge.py:1370-1378` | **MATCHES** minus the vacuous background-tier clause (MINOR 2); displacement recorded in `why` and honoured through `assets_omitted`; over-cap after displacement still raises the restage error (`:567`). Worked example landed in VPW SKILL. |
| C-10 expression delta | `forge.py:1280-1283` (walk-derived), `:636-647` (gate inside the existing delta path) | **MATCHES** — implemented as an extension of `delta_primitives`/`seeding_law_violations`, not a parallel check; carve-outs present (`surgical_reseed` for `defect: seed|mechanism` at `:586`, `no_hands` via the earlier branch, thumbnails outside `batch`). **Chain-vs-place keying leak — R2-M7.** |
| C-11 provenance | `forge.py:1530-1560`, manifest validation `:1870-1874` | **MATCHES** — `parent_depth`/`lineage` as specified, parked-parent refusal distinct in wording from the retry-path verified-parent check, `refuse_parked=False` only on the retry rebuild (review §5.4's "one refusal per condition"). |
| C-12 review rows | `build_review_artifact.py:136-170` | **MATCHES** the pre-filter list and the named-figure-only, ordinary-scale comparison (`crop_battery.py` untouched/orphaned). Deviations: flat-cel row narrowed to ai-gen (MINOR 3), place-owner filter inverted (R2-M3), rows display-only (MINOR 4). |

## B. Changes-to-NOT-make sweep (review §6 + §5 carve-outs)

Method: `git diff 7f38d18..HEAD` over all code/doc paths, grepped per item. Every hit below is in the
**scratchpad review annex text**, never in code.

| §6 item | Evidence | Verdict |
|---|---|---|
| 1 No image style anchors | no new seed source; `HARDENED_SCENE_STYLE` remains text; SKILL row rewritten to "No OTHER image style anchor exists" | UNTOUCHED |
| 2 Two-tier cast law | `anon_foreground` still a KNOWN key refused BY NAME (`forge.py:229-232, 556-559`); `FIGURES_KEYS` unchanged; no third tier added | UNTOUCHED (strengthened) |
| 3 Seed integrity + staging locks | `seed_sha256`/`SeedIntegrityError`/`verify_request_seed_digests`/`_reserve_staging_output` appear only in the annex diff lines | UNTOUCHED |
| 4 Builder-owned slates | `seed_role_violations` untouched; C-9 displacement routes through `assets_omitted`, not a hand-authored slate | UNTOUCHED |
| 5 Three-state honest stamp | `stamp_review.py` scene path additive-only; no `verified: true` writer added; forge only ever reads `review.json` | UNTOUCHED |
| 6 `--preview-parked` / Gate-3 | zero code hits | UNTOUCHED |
| 7 One-retry law / `RETRY_OVERLAY_SCHEMA@2` | retry path changed in exactly one line (`plate=not seeds` replacing `out.pop("plate")`, `forge.py:1677`), schema and authority untouched; `defect: seed|mechanism` carve-out added, not removed | UNTOUCHED |
| 8 Cutout/magenta + render handoff | zero code hits | UNTOUCHED |
| 9 Voiceover/`vo_ref`/word-timing | zero code hits (only VPW SKILL prose citing `vo_ref` as the re-author unit) | UNTOUCHED |
| 10 Registry promotion rule | `Kit.use_video` untouched; both new consumers explicitly read `assets/library/manifest.json` and say why (`lint_shots.py:1577-1600`, `build_review_artifact.py:15-19, 79-99`) | UNTOUCHED (honoured) |
| 11 Scale anchors / forced perspective / foreground-props recipe | zero hits for "forced perspective", "scale anchor", "foreground-props" anywhere in the diff | UNTOUCHED |
| 12 Ratified review loosening | ordinary viewing scale kept, single fresh-eyes pass kept, no crop battery (orphan preserved); the re-scope is logged as a reversal in `decisions.md` **and explicitly marked "Daniel's explicit re-authorization at the doctrine gate is still required"** | HONOURED |
| 13 No video-wide palette lock | no palette rule added; `HARDENED_SCENE_STYLE` still says "Commit the authored scene palette" (per-scene) | UNTOUCHED |
| 14 No per-video literal in skills | no cast/company constant in code; `miniscribe-boardroom` appears only as doc prose (MINOR 11) | SUBSTANTIALLY HONOURED |
| 15 `assets/library/manifest.json` stays live | not only kept — it became the review artifact's and lint's per-video cast source | HONOURED |
| 16 script/research/vo/refs untouched | no diff under those paths | UNTOUCHED |

§5 carve-outs: thumbnail (outside `batch`; C-6 gate is in `cmd_batch` only; `place_context_exempt_check`
bars `place` on thumbnails) ✔ · shorts `first_frame` (no mandatory-place law exists; `place` barred, not
required) ✔ · motion plates/cutouts (no code touched; **the required disambiguation sentence is missing**
— MINOR 6) ✔/⚠ · retry overlays `defect: seed|mechanism` (explicit `surgical_reseed` exemption + test) ✔ ·
`no_hands` (no expression primitive ⇒ `changed` falsy; test present) ✔ · render/compliance contracts ✔.

## C. Cross-file contradiction sweep (end state)

Contradictions found (all itemised above): **R2-B1** (`visual-grammar.md` suffix ↔ `style-bible.md` §2b ↔
`suffix_one_voice_check` ↔ `shots-schema.md`'s "copied verbatim" law — a four-way disagreement);
**R2-B2** (`action_chain_check` ↔ the place model ↔ `hard_cut`'s schema definition ↔ C-8's own two-cast
eye-line clause); **R2-M2** (`place_owner_check` code ↔ its own docstring ↔ C-4); **R2-M6**
(`example-shots.md` exemplars ↔ C-7/C-8); MINOR 5 (two "seated"/"named" definitions); MINOR 6
(motion-planner "plate" ↔ place "plate"); MINOR 7 (plan's load-bearing-anchor list ↔ the landed removal).

Verified **consistent** (no finding): bible §2b ↔ `HARDENED_SCENE_STYLE` (same terms, no second voice) ·
C-2 term list ↔ lint regex ↔ `shots-schema.md`'s published list ↔ forge's NO-list · exempt shot-class
list ↔ `visual-grammar.md` §1 class table ↔ schema ↔ lint · `place_anchor` legality (schema ↔ lint ↔
forge, all "non-delta") · same-place refusal wording (forge ↔ lint ↔ `decisions.md`) · slice law
(image-gen SKILL "count set by the run's gate cadence, boundary on a stage boundary, held stage never
splits" ↔ spec M12) · seed-cap displacement (VPW SKILL worked example ↔ forge behaviour ↔
`visual-grammar.md`'s slot table) · two-tier law (grammar §2 "no third tier" ↔ forge refusal ↔ SKILL,
after the integration sweep) · both `decisions.md` reversals ↔ spec §Keep/revert · middle-path spec
SUPERSEDED banner ↔ §6.1. Motion-planner SKILL/animation-rules/critics reference no removed concept
(zero hits for `anon_foreground`, `root_scene`, §2e, style cards).

## D. Worker-claim audit

- **A (forge, opus).** Every claimed change verified present: place-first map (`:1251`), same-place law
  (`:1253`), cap displacement (`:1370`), C-6 consumer (`:1128-1176`), C-10 (`:1280`, `:634`), C-11
  (`:1483`), `root_scene`/`--plate-candidates` deleted (grep: zero hits), descriptor single voice
  (`:283`). Its four "ambiguities resolved" are all real and correctly reported — including the C-4
  qualifying-place punt, which is the honest disclosure of R2-M1. Claimed 143 tests; actual 142 (the
  integration commit's own count) — no discrepancy of substance.
- **B (lint/schema/critics).** All 16 claimed checks present and wired into `main()` for long-form,
  shorts, and thumbnail. Claimed "194 green" — reproduced exactly. Its "not done" list correctly names
  the C-4 plate-derivation gap (other half of R2-M1).
- **C (docs).** C-1 verbatim in §2b ✔; anchors unchanged ✔; §2c/§4/§5 clean ✔; both SKILL.md laws
  landed ✔; SUPERSEDED banner ✔; two `decisions.md` reversals ✔ (both with Evidence + Alternatives, and
  the review one explicitly marked pending Daniel's re-authorization). Its flagged pre-existing §2e
  inconsistency was genuinely real and was closed by the integration pass. **Claim not verified: none.**
  Gap not claimed either way: C ownership included `image-generation/SKILL.md`, and that file still has
  no operator-facing text for the C-6 record store (R2-M4).
- **D (review machinery).** C-12 filter + comparison strip + `--figures` writer all present; scene
  stamping path byte-unchanged (additive functions + one dispatch line). Claimed 43 tests; actual 42 —
  explained by the integration pass folding one duplicated owner-branding test, and the integration
  report says so. Its documented `owner_branding`/`place_owner` fields were fictional and the
  integration pass corrected them to lint's real signal — correctly reported.
- **Integration.** All three claimed seams verified closed in the end state (SKILL §2e sweep, owner
  signal single-sourced, canonical cross-place sentence).

## E. Goal-regression hunt

No reverted behaviour is reintroduced anywhere in the diff or the end state: no style card / swatch /
value-register / rendered-scene style anchor (the only rendered seed is the same-place plate, and
cross-place use is refused in both engines); no bulk-substitution affordance (`--plate-candidates`
deleted; the VPW SKILL now bans bulk vocabulary substitution in text); no scale scaffold, forced
perspective, or foreground-props recipe (zero hits); no video-wide palette lock; `anon_foreground` stays
abolished. The one live style regression is not a reintroduction but an omission: **R2-B1**, the
untouched suffix, which is the single string that reaches the engine on all 214 prompts.

---

## What I would fix before the doctrine gate

1. R2-B1 — rewrite the `visual-grammar.md` suffix from C-1 (one edit; unblocks all authoring).
2. R2-B2 — exempt `place`/place-less classes and anchor the callback regex; re-run the calibration.
3. R2-M1 + R2-M2 — one lint check defines the plate; `place_owner_check` uses it.
4. R2-M3 — emit the place-owner review row on every `place` shot.
5. R2-M4 — document who writes `review.json` and when (SKILL), or the run stalls at fifth 2.
6. R2-M5, R2-M6, R2-M7 — stem the role match, fix the two exemplars, key held expressions on the chain.

Re-run afterwards and put the numbers in Daniel's §3 gate artifact: the calibration table he is owed is
**per-check fire counts over the archived `shots.json`**, and today's honest table is
`suffix 2 · render-technique 4 · seat/support 12 (+1 soft) · two-cast 22 · action-chain 28 · semantic-cast 10`
— with 28 and 10 not yet calibrated.
