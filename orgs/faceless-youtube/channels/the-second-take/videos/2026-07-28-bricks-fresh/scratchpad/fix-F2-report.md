# Fix worker F2 — lint semantics (2026-08-04)

Worktree `kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`. Edits only, no
commit. Files touched (sole ownership, nothing outside it):

- `.claude/skills/visual-prompt-writer/scripts/lint_shots.py`
- `.claude/skills/visual-prompt-writer/scripts/test_doctrine_reset_guards.py`
- `.claude/skills/visual-prompt-writer/references/shots-schema.md`
- `.claude/skills/visual-prompt-writer/references/critics.md`

**Suite: 218 passed** (`py -3 -m pytest -q` in `visual-prompt-writer/scripts`), baseline 194 → +24
net. No test lost silently: 185 of the 194 passed untouched; the other 9 were the tests whose laws
changed (1 suffix, 4 place-owner, 4 action-chain) and each was rewritten or replaced below.
`motion-planner`'s 17 tests (the only external importer of `lint_shots`) still green.

---

## 1. Owner forced choice — closes Daniel's failure #6 (was R2-M3 / R1-M3 lint side)

**Change.** `place_owner_check` rewritten from an inference ("if somebody quoted a proper-noun-shaped
literal anywhere in the place, require it on the plate") to a forced choice. The old check returned
early when nothing was quoted anywhere — i.e. it was silent on exactly the failure it existed to
catch, because a forgotten owner cue leaves no literal to find. Silence can no longer satisfy it.

**Law:** every place's plate declares **exactly one** of `place_owner: "<LITERAL>"` or
`owner_ambiguity: true`; neither = HARD, both = HARD; neither field is legal on any other shot of the
place; a declared `place_owner` must be quoted verbatim in the plate's own `still_prompt`.

Reuse, not a second mechanism: because the literal has to be QUOTED in the prompt, every existing
lettering law already applies to it unchanged — `word_cap_check` (1–4 words / 25 glyphs),
`literal_count_check` (3 per prompt), `long_literal_word_check` (script-vocab sourcing), and L-1
carry. `place_owner` is registered with `carried_literal_check`: the plate's owner literal is
established for the whole PLACE, across stage runs (4 lines inside the existing run walk — no
parallel carry mechanism), so a later in-place shot that downgrades the sign to lowercase prose is
the CHECKIG defect and reports as one.

**Check name:** `place_owner_check` (same name, new law). Exact messages (5 branches, one per
condition):

- `[<label>] place '<p>': plate '<id>' declares BOTH \`place_owner\` '<lit>' and \`owner_ambiguity: true\`. Exactly one: either the owner is legible on the establishing frame, or its absence is the intended read. Drop whichever is not the shot you authored.`
- `[<label>] place '<p>': plate '<id>' declares neither \`place_owner\` nor \`owner_ambiguity: true\`. Every place records an ownership decision on its plate - author a visible owner cue (a plaque/nameplate/door-glass literal, quoted in this shot's still_prompt, and name it here as \`place_owner\`), or declare \`owner_ambiguity: true\` if unmarked ownership is the intended read. Ownership invisible on the establishing frame with no decision recorded is audit failure #6.`
- `[<label>] place '<p>': plate '<id>' \`place_owner\` is <v!r>, expected the owner literal as a non-empty string (e.g. "MINISCRIBE").`
- `[<label>] place '<p>': plate '<id>' declares \`place_owner\` '<lit>' but its still_prompt never quotes that literal ([...] quoted instead). The owner cue is a DRAWN cue: quote it verbatim on the plate the way any other in-image literal is authored, or declare \`owner_ambiguity: true\` instead.`
- `[<label>] <id>: declares \`<field>\` but is not the plate of place '<p>' ('<plate id>' is). The ownership decision is recorded once, on the place's first shot; a later shot re-quoting the cue is ordinary L-1 carry, not a second declaration.`

**Schema:** `place_owner` added to the JSON block (next to `hard_cut` / `owner_ambiguity`, both
re-described as plate-only and mutually exclusive) and the place-owner law bullet rewritten to the
forced choice + the "it is an ordinary authored literal" reuse clause.

**Calibration (archived `shots.json`, git 7f38d18, 214 shots): 0 fires** — the archived file predates
`place` and declares none, so no place law can fire on it. Covered instead by 9 planted/near-miss
tests including the L-1 carry across two stage runs.

## 2. Plate law, one definition (C-4 — closes R2-M1, R2-M2, R1-M5)

**Change.** New module-level helper `place_groups(shots)` is now the ONLY place a plate is defined,
and both place laws consume it. **The plate of a place is the first-in-file shot declaring that
place** — cast or no cast, one rule, decidable from the authored file alone. The old
`plate = grp[0]` with a docstring claiming a cast-filtered definition (R2-M2's self-contradiction) is
gone; so is the ambiguity about which side owns C-4 (R2-M1: both A and B punted it).

New check `place_plate_check(label, shots, chars, hard)` lands the missing half: for a QUALIFYING
place (≥2 shots declare it, **or** its plate declares `place_owner`) the plate must declare **zero
named cast** and **no `stage_role: delta`**. Non-qualifying places (single-use, unbranded) are
exempt — that shot is its own place-first frame and runs seedless, exactly as C-4 legalizes.

The docstring states the definition and names forge's mechanical mirror: forge marks the slate that
ended up with zero seeds (`plate = not seeds`), so the two coincide only when the AUTHORING is right,
and asserting that coincidence at $0 is precisely what this check does. Lint never re-derives forge's
marker; forge never re-checks the authoring. With no cast vocabulary resolvable (`chars` empty) the
cast half degrades silently, the same precedent `seat_support_check` / `two_cast_presence_check` use;
the delta half still applies. `stage_role` is compared `.lower()`-normalized like forge.

**Messages:**

- `[<label>] place '<p>': its plate '<id>' (the first shot declaring this place, and this place qualifies for the plate law - N shot(s), place_owner declared|absent) names cast \`x\`, \`y\`. A plate declares ZERO named cast (C-4): every other shot in the place seeds it, so cast on the plate bleeds into all of them. Author a cast-free establishing frame first, or move this shot after one.`
- `[<label>] place '<p>': its plate '<id>' is a stage \`delta\`. A plate is the place's root frame - it cannot itself inherit a chain parent (C-4). Make the place's first shot a base/standalone shot.`

**Schema:** the conditional-plate-law sentence rewritten to state the single definition, the
qualifying test, the zero-cast/no-delta requirement, and forge's mechanical mirror.

**Calibration: 0 fires** on the archived file (no `place` declared anywhere). 6 tests, including the
`place_groups` definition test and the single-use exemption.

## 3. Action-chain re-key (R2-B2)

**Change.** `_SAME_CALLBACK` and the whole `still_prompt` "the same X" heuristic are DELETED.
`action_chain_check(label, shots, id2text, hard)` now fires only when all four hold:

1. two shots **adjacent in file** declare the **same `place`**, and
2. both shots' `vo_text` name a **shared concrete prop noun**, and
3. the later shot declares **no `stage` and no `stage_role`** at all, and
4. the later shot does not declare `hard_cut: true`.

Condition 3 is "declares no chain", not "declares a different chain" — a shot that opens its own
stage has made a positive continuity statement, and whether that chain READS is critics.md Q7. That
choice is deliberate and is what keeps the author from ever having to declare `hard_cut: true`
(schema: "this shot's action deliberately does NOT continue the previous shot's") about an action
that does continue — the "declare a falsehood" trap R2-B2 identified. `place` being load-bearing is
what makes the place-exempt shot classes structurally unable to fire: C-3 bars them from declaring
`place` at all.

`vo_text` comes from `id2text` (the tiling lint derives this run) with a fallback to a stored
`vo_text`, so it works both before and after `--write`.

**Generic-noun exclusion (`_PROP_EXCLUDE` + `prop_nouns`), documented in the source.** Lint has no
POS tagger, so "concrete prop noun" is approximated by subtraction: drop apostrophe tokens
(contractions), drop `-ed`/`-ing`/`-ly` morphology, drop the closed exclusion set (function words,
pronouns, quantifiers, time/measure words, and GENERIC category nouns — `people`, `money`, `level`,
`thing`, `way`, `number`…), singularize what survives, require ≥3 chars. The known limitation is
under-firing (`briefing`, `men`), which is the safe direction.

**Message:**
`[<label>] <id>: its VO continues the previous shot '<prev id>' on the same prop(s) ['box'] in the same place '<p>', but it declares no \`stage\`/\`stage_role\` chain and no \`hard_cut: true\` - an action continuing across shots needs one or the other (the L88-L91 drift: a box-tampering sequence that ran as independent seedless roots). Chain it to the shot it continues, or declare \`hard_cut: true\` if the action genuinely does not continue.`

**Calibration over the archived `shots.json` (the number Daniel is owed):**

| run | fires | ids |
|---|---|---|
| archived file as-is (no `place` anywhere) | **0** | — |
| upper bound: every shot forced into ONE shared place | **1** | **L89** (shared prop `box`, prev `L88`) |

The old check fired **28** on the same file with ≥5 measured false positives. The upper-bound run is
the honest stress test — with the place condition maximally satisfied, the only fire in 214 shots is
the true positive the check exists for (L88's VO "…locked in the accountants' own boxes" → L89's "so
they popped the boxes open…", L88 held a stage, L89 declared nothing). Every other adjacent unchained
pair shares only stopwords, verb morphology, contractions, or category nouns. The five real
near-misses (L114/L115 "level", L124/L125 "counted", L150/L151 "wasn't", L154/L155 "people",
L200/L201 "in/of/the") are pinned as a regression test.

**Tests (9, replacing 4):** the archived L88→L89 plant fires; "at the same eye-line" + "the same
pallet three times" in `still_prompt` **cannot** fire (the check never reads prompts); place-exempt
classes never fire; shared stage silent; any declared chain silent; `hard_cut` silent; different
place silent; adjacent-in-one-place with no shared prop silent; plus
`test_action_chain_calibration_over_the_archived_file` pinning the five near-misses and the one true
positive. Wiring is covered end-to-end by `test_e2e_an_unchained_same_place_continuation_fails`,
which also proves the derived-`vo_text` path on a file that was never `--write`-n.

## 4. Semantic-cast plural/slug fix (R2-M5)

**Change.** The justification window is now compared as a set of **singularized** tokens against
**singularized** slug fragments (`_singular`, shared with the action chain — one helper, both sides
of every word-identity test in the file), replacing the exact-token `\b<tok>\b` search.
`_IRREGULAR_ROLE = {"foremen": "foreman"}` folds the only irregular the check's own closed role list
can produce. Limitation documented in the source: naive trailing-s/es stripping, no lemmatizer.

**Calibration over the archived file (with the real `video_chars` cast vocabulary): 10 → 8 fires.**
Dropped: **L45** ('bankers' vs `hq-banker`) and **L150** ('auditors' vs `auditor-rep`) — exactly the
plural-role/singular-slug class the docstring promised to leave alone. Remaining 8 (L66, L76, L80,
L82, L88, L100, L182, L191) are all a DIFFERENT word on each side ('accountants' vs `auditor-rep`,
'managers' vs `brick-foreman`/`qt-wiles`, 'executives' vs `hq-banker`), i.e. the check's genuine
target class, not a singularization miss. R2-M5 filed L76/L182 under the plural/singular case; on the
evidence they are not — no stem or singularizer maps "accountants" to "auditor".

3 new tests (plural role justifies singular slug for both `hq-banker` and `auditor-rep`; irregular
`foremen` justifies `brick-foreman`; the L100 defect survives the fix).

## 5. Mirror sync, lint side (R1-M14)

- `place_anchor_check` now compares `str(sh.get("stage_role") or "").lower() == "delta"`, matching
  forge's own normalization. A `"stage_role": "Delta"` can no longer pass lint at $0 and then be
  hard-refused by forge at batch time — the mirror's whole purpose.
- The `place_anchor` delta-legality **law sentence is left byte-unchanged** and is now declared
  canonical in the docstring, following the precedent seam 3 set in `build-integration-report.md`
  (lint's message shape was picked as canonical there; each side keeps only its own context prefix).
  `build-integration-report.md` records no canonical form for THIS message — it records the two
  divergent forms and explicitly leaves them out of seam 3's scope — so rather than invent a third
  wording I kept lint's and marked it canonical.

  **F3 must copy this into forge verbatim (byte-identical, everything between the parens):**

  > a delta continues its own base's held scene via the chain parent; `place_anchor` is a different
  > seed, for a base or standalone shot

  Lint's full string: ``[<label>] <id>: `place_anchor` is not valid on a stage `delta` (a delta
  continues its own base's held scene via the chain parent; `place_anchor` is a different seed, for a
  base or standalone shot).`` — forge keeps its own prefix, replaces its "a delta inherits the
  in-chain parent frame it is a delta OF" wording with the sentence above.

## 6. One-voice check + the self-tripping test (R1-B1, lint side)

**Change.** `suffix_one_voice_check` gains a third refusal: `_SUFFIX_STYLE_VOCAB`, the style
RECIPE's own vocabulary (cel shading, flat colour(s)/colour fills, hard-edged, single-step, shadow
shape, highlight-free, outline, line weight, shading, palette, texture, painterly, matte, art
style, cartoon style, rounded friendly shapes, no realistic detail, any `#rrggbb`). The architecture
the check now enforces: **the suffix carries no style vocabulary at all — it is the lettering clause
and nothing else**; the recipe has one home (`style-bible.md` §2b, assembled onto every gen by
forge), and a suffix that also carries it is a second COPY of a living document, which becomes a
second VOICE the moment either side is edited. The spans `_SUFFIX_SOFT` owns
(gentle/soft/blend/feather) are deliberately absent from the new list, so one word never reports
twice; `soft focus` still reports once, via C-2 only.

**Message:**
`[suffix] global_prompt_suffix: style-recipe wording '<term>' - the suffix states LETTERING ONLY ('hand-lettered marker capitals for any in-world text'). The flat-cel recipe has one home, style-bible.md section 2b, which forge assembles onto every generation; restating any of it here - even the correct C-1 wording - is a second copy that drifts the moment the bible is edited. Delete the clause.`

**F1's new suffix passes.** `test_c2a_the_new_lettering_only_suffix_is_silent` asserts
`"hand-lettered marker capitals for any in-world text"` produces zero HARD — this is the acceptance
check for the `visual-grammar.md` rewrite. The module's shared `SUFFIX` fixture was changed to that
exact string, so every suffix-consuming test in the file now runs against the post-reset suffix.

**The old suffix still hard-fails.** `test_c2a_the_old_style_bearing_suffix_hard_fails` pins
`visual-grammar.md`'s pre-reset blockquote verbatim as `OLD_SUFFIX` and asserts both classes report.

**The self-tripping test is gone.** `test_c2a_the_c1_recipe_itself_is_silent` (named "…is_silent",
docstring "must never trip its own guard", body asserting 2 hard violations) is deleted and replaced
by `test_c2a_even_the_correct_c1_recipe_is_not_a_legal_suffix`, which asserts the new architecture:
the C-1 recipe is correct text in the WRONG file — it hard-fails HERE while being the required
wording THERE — plus a no-double-report assertion.

**Calibration over the archived file's suffix: 10 fires** (2 soft/gradient — `gentle`, `soft`;
8 style-recipe — `cel-shaded`, `cartoon style`, `#241a12`, `outline`, `flat colours`, `cel shading`,
`rounded friendly shapes`, `no realistic detail`). Was 2.

**Schema:** the `global_prompt_suffix` line in the JSON block and the one-voice-law bullet both
rewritten to "lettering clause only, three refusals"; the old "texture / line weight / art style
only" description — which was the doc-side half of R1-B1's four-way contradiction — is gone.

---

## Other files updated (mine)

- `references/critics.md` question 7's premise sentence now states what lint actually proves
  (adjacent, one place, shared prop in VO, no chain declared, never reads `still_prompt`) so the
  critic is not told to skip what lint no longer covers. No question added — the forced choice makes
  ownership a lint fact now, and the charter warns against growing the question list.

## Handover / out of my scope

1. **`visual-prompt-writer/SKILL.md:129-135` now contradicts the landed laws** (not my file, not
   F1's or F3's per the briefs — needs an owner). It still says the plate is "the first emitted shot
   of that place carrying no named cast" (the two-definition problem R2-M2/R1-M5 flagged; the landed
   definition is first-in-file, with the zero-cast requirement enforced as a LAW on qualifying
   places), and it still states the owner law as conditional ("An institution-owned interior authors
   ONE visible owner cue on the plate, or records `owner_ambiguity: true`") with no mention of
   `place_owner` or the forced choice.
2. **F3 owes forge the byte-identical `place_anchor` delta sentence** in §5 above.
3. **F1's suffix** must be exactly `hand-lettered marker capitals for any in-world text` (or another
   lettering-only string) — anything carrying recipe vocabulary now hard-fails, by design.

## Nothing stopped on

All six contracts implemented as stated. Two judgment calls are flagged rather than hidden: the
"declares no chain at all" reading of action-chain condition 3 (§3), and keeping lint's existing
`place_anchor` law sentence as canonical rather than inventing a merged third form (§5).
