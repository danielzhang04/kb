# Build worker B — lint + schema + critics (bricks doctrine reset, 2026-08-04)

Worktree `kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`. Sole ownership:
`.claude/skills/visual-prompt-writer/scripts/lint_shots.py` + its `test_*.py` files,
`.claude/skills/visual-prompt-writer/references/shots-schema.md`,
`.claude/skills/visual-prompt-writer/references/critics.md`. No other file touched; `forge.py`,
`SKILL.md`, `style-bible.md` were read at HEAD for context only.

## Files changed

| File | Diff |
|---|---|
| `.claude/skills/visual-prompt-writer/scripts/lint_shots.py` | +531/-8 — 16 new check functions + 2 new module constants sections, wired into `main()` |
| `.claude/skills/visual-prompt-writer/scripts/test_new_guards.py` | +12/-4 — updated the one pre-existing test whose contract changed (place_anchor base→non-delta) |
| `.claude/skills/visual-prompt-writer/scripts/test_doctrine_reset_guards.py` | new, 58 tests — calibration suite for every 2026-08-04 guard |
| `.claude/skills/visual-prompt-writer/references/shots-schema.md` | +80/-8 — `place`, `hard_cut`, `owner_ambiguity` fields; 8 new law paragraphs |
| `.claude/skills/visual-prompt-writer/references/critics.md` | +25/-1 — 3 new forced questions (6-8), "FIVE"→"EIGHT" |

## Test results

```
cd orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts
python -m pytest -q
```
**194 passed** (136 pre-existing + 58 new in `test_doctrine_reset_guards.py`), 0 failed.

Also ran the render-builder suite (`lint_shots.py` imports `match_shots_to_tokens`/`word_timings_for`
from its `render.py`, the one dependency lint touches outside its own skill):
```
cd orgs/faceless-youtube/.claude/skills/render-builder/scripts
python -m pytest -q
```
**191 passed**, 0 failed — untouched, confirms the import boundary wasn't disturbed.

One pre-existing test needed updating for the changed contract (not a regression, the C-5 widening
itself): `test_g8_anchor_is_base_only` → renamed `test_g8_anchor_is_not_valid_on_a_delta` (message
text changed from "only valid on a stage `base`" to "not valid on a stage `delta`"), plus a new
`test_g8_anchor_is_legal_on_a_standalone_shot_with_no_stage_role` proving the widening.

## New checks — name, severity, exact message

All HARD checks are presence/omission only, per the design's core correction (spec §1: "HARD =
presence/omission; critic = judgment"). Messages below are the literal f-string templates (values in
`{}` are interpolated per-shot).

### C-2 — style one-voice
- **`render_technique_check`** (HARD, prompts + suffix + thumbnail + first_frame). Exact banned list,
  case-insensitive: `gradient`, `gloss`/`glossy`, `specular`, `bloom`, `depth-of-field`/`depth of
  field`, `blurred background`/`blurred behind`, `soft focus`, `photoreal*`, `subsurface`, `rim
  light`. Scene-light nouns (warm/amber/glow/lit/lamp) never match.
  > `[{label}] {pid}.{field}: banned render-technique term {term!r} — the C-1 unified recipe is flat
  > fills + at most one hard-edged single-step shadow, no soft/blended rendering. A scene-light NOUN
  > (warm, amber, glow, lit, lamp) is never this — only the render-TECHNIQUE word is banned.`
- **`suffix_one_voice_check`** (HARD, `global_prompt_suffix` only). Calls `render_technique_check` on
  the suffix (shares the same list, cannot disagree) plus an extra soft/gradient-permissive word list
  (`gentle`, `blend(ed/ing)`, `feather(ed/ing)`, bare `soft` excluding `soft focus` to avoid a double
  report of the same span).
  > `[suffix] global_prompt_suffix: soft/gradient-permissive wording {word!r} contradicts the C-1
  > one-voice recipe (flat fills, one hard-edged shadow, no feathered or blended transitions) —
  > style-bible.md's own text deleted this wording; the suffix must not reintroduce it.`

### C-3 — place
- **`place_key_check`** (HARD, shape). `place` must be non-empty lower-case kebab-case.
  > `[{label}] {pid}: `place` {place!r} must be a non-empty lower-case kebab-case set id (e.g.
  > 'miniscribe-boardroom') - distinct from `stage`.`
- **`place_shot_class_exempt_check`** (HARD). The 5 placeless `shot_class` values
  (`symbolic-stand-in-object`, `number-glued-to-object`, `map-plan-view`, `physicalized-imbalance`,
  `register-shift-infographic` — see "shot_class exemption mapping" below) never declare `place`.
  > `[{label}] {id}: shot_class {sc!r} declares `place` {place!r} - this class is exempt (C-3): it
  > depicts a floating object/abstraction, never a diegetic set.`
- **`place_context_exempt_check`** (HARD). Thumbnail objects and a short's `first_frame` never declare
  `place`.
  > `[{label}] {pid}: declares `place` {place!r} - thumbnail/first_frame never do (C-3); they run
  > seedless under the hardened descriptor unconditionally.`
- **`place_inventory_check`** (HARD). Every declared `place`'s non-generic tokens (≥4 chars, dropping
  structural set-nouns like room/office/yard/desk/…) must anchor to `script_vocab`. Silent when
  `script_vocab` is empty (no discriminator) or every token is generic (nothing to anchor).
  > `[{label}] {pid}: place {place!r} has no token the script itself uses ({toks!r} not found in
  > script.md) - an invented place is the same class of error as an invented lettering literal;
  > anchor it to the script's own wording or fold the shot into an existing declared place.`
- **`place_owner_check`** (HARD). Within a `place` group, any alphabetic trackable literal (L-1's own
  vocabulary) quoted on ANY shot must also appear on the group's first-file-order shot (the C-4 plate
  proxy — see ambiguity note below), unless `owner_ambiguity: true` is declared anywhere in the group.
  > `[{label}] place {place!r}: owner cue(s) {missing!r} quoted elsewhere in the place but absent from
  > its place-first shot {plate_id!r} - author the cue on the plate, or declare `owner_ambiguity: true`
  > if the ambiguity is intentional.`
- **`bool_field_check`** (HARD, shape; called for both `hard_cut` and `owner_ambiguity`).
  > `[{label}] {pid}: `{field}` is {value!r}, expected true or false.`

### C-5 — same-place mirror + widened `place_anchor` legality
- **`place_anchor_check`** (existing, MODIFIED). Base-only → non-delta. New message:
  > `[{label}] {pid}: `place_anchor` is not valid on a stage `delta` (a delta continues its own base's
  > held scene via the chain parent; `place_anchor` is a different seed, for a base or standalone
  > shot).`
- **`place_anchor_same_place_check`** (HARD, new). Resolves the anchor's filename stem to a shot `id`
  in the same file, compares `place` fields.
  > `[{label}] {id}: `place_anchor` {anchor!r} seeds from {stem!r} (place {src_place!r}) into a shot
  > declared place {dst_place!r} - cross-place image seeding is the probe-refuted style-anchor failure
  > (decisions.md 2026-08-04); a plate may only seed shots in its own place.`

  **Wording-alignment flag for the boss (I cannot see worker A's source, this is from reading
  `build-A-report.md` + a targeted grep of `forge.py` at HEAD, both read-only):** forge's actual
  refusal (`forge.py` ~line 1305-1310) reads:
  `"{name}: `place_anchor` {anchor} is not a frame of this shot's place `{declared_place or 'none'}` —
  a plate may only seed shots in its own place; cross-place image seeding is the probe-refuted
  style-anchor failure under another name."`
  Both messages share the load-bearing clauses "a plate may only seed shots in its own place" and
  "cross-place image seeding is the probe-refuted style-anchor failure" (both quote the spec's own
  §1-Place sentence verbatim, which is why they converged unprompted) but differ in shape: forge names
  the anchor + this shot's place; mine additionally names the SOURCE shot id and its place. Forge's
  delta-refusal message ("a delta inherits the in-chain parent frame it is a delta OF") also differs
  in wording from mine ("a delta continues its own base's held scene via the chain parent") for the
  same condition. Recommend the boss pick one wording per condition and I'll match lint's copy in a
  follow-up if asked — I did not edit forge.py or attempt to guess its exact string in advance.

### C-7 — seat/support
- **`seat_support_check`** (HARD + SOFT). Keyed on the registry `sit` pose primitive bound by backtick
  order to the most-recently-named character (mirrors `forge.py shot_cast`), never the English verb.
  Requires a support noun (`chair|stool|bench|seat|crate|step|ledge|desk edge|sill`) AND a contact
  word/preposition within 30 chars of it, in the shot's OWN sentence containing the `` `sit` `` token.
  - HARD (missing support or missing contact):
    > `[{label}] {pid}: `{char}` carries the seated pose primitive `sit` but its sentence names no
    > {missing} - a body seated on nothing (L89's unambiguous floating sit). Name the support and how
    > `{char}` contacts it in the same sentence.`
  - SOFT (structurally passes; framing is not lint-decidable):
    > `[{label}] {pid}: `{char}` carries `sit` with support {support!r} authored - confirm the render's
    > FRAMING actually shows the support (not lint-decidable; forced review row).`
  Silently no-ops when `video_chars()` resolves an empty cast set (no registry/manifest wired) — never
  a false positive against an unresolved vocabulary.

### C-8 — two-cast presence, action-chain, semantic-cast
- **`two_cast_presence_check`** (HARD, presence only). A shot naming ≥2 registry characters must state
  a plane clause, an eye-line clause, and a relative-head-scale clause (`dominant` legally resolves
  scale via posture/framing).
  > `[{label}] {pid}: 2+-named-cast shot ({names}) states no {missing list} clause - presence only
  > (C-8); whether the stated clauses cohere into the right topology is the critic's call.`
- **`action_chain_check`** (HARD, presence only). A shot whose prose matches this project's own "the
  same X" continuity idiom but carries no `stage` and no `hard_cut: true`.
  > `[{label}] {id}: still_prompt calls back to a held scene/prop ({excerpt!r}...) but declares no
  > `stage`/`stage_role` chain and no `hard_cut: true` - an action continuing across shots needs one or
  > the other (the L89-L91 drift: a box-tampering sequence that ran as three independent seedless
  > roots).`
- **`semantic_cast_check`** (HARD, narrow per M11). Fires only when a shot's OWN `vo_text` names a
  generic plural role AND a named cast member's slug fragment (≥3 chars) appears nowhere in that
  shot's vo_text or its immediate ±1 neighbours. Needs `id2text` (vo_text tiling); silently skipped
  wherever anchors did not tile clean.
  > `[{label}] {id}: vo_text names a generic plural role ({role!r}) while the shot casts {names}, whose
  > name appears nowhere in this VO span or its neighbours - the L100 defect (bulk generic->named
  > conversion casting a specific lead the narration never names here). Either the VO's own words
  > justify the named lead nearby, or recast the shot to the generic role.`

## Schema fields added (`shots-schema.md`)

- **`place`** (optional string, kebab-case) — recurring diegetic SET identity, distinct from `stage`.
  Conditional plate law, place-inventory law, exemption list documented inline.
- **`hard_cut`** (optional bool) — this shot's action deliberately does not continue the previous
  shot's, for the action-chain law's escape.
- **`owner_ambiguity`** (optional bool) — this place's ownership is intentionally left unmarked, for
  the place-owner law's escape (also narrows the supplied-text law's resolution-3 "omit" escape — see
  §4 note added to shots-schema.md).
- `place_anchor`'s legality widened base → non-delta; same-place law documented.
- New law paragraphs in §2: place, place-owner, action-chain, seat/support, two-cast presence,
  semantic-cast, one-voice + banned render-technique terms (attached to the existing
  `global_prompt_suffix` bullet).

## `critics.md` — 3 new forced questions

Charter now says "answer EIGHT questions" (was FIVE — the file's own pre-existing 5 plus my 3):
- **Q6 — Two-cast plane/scale coherence** (cites audit-drift §D/§E1, the real L66 finding).
- **Q7 — Action-chain cause→effect readability** (cites audit-drift §E4, the real L89-L91 finding).
- **Q8 — Semantic-cast justification** (cites vpw-log.md Phase B3's bulk `anon_foreground`→named-cast
  conversion pass + audit-drift §E7, the real L100/L101 finding).

Each explicitly states what LINT already proved (presence) vs. what the critic alone can judge
(coherence), per the design's HARD/critic split.

## Calibration duty — real-prose evidence, no invented straw cases

`test_doctrine_reset_guards.py`'s fixtures are lifted verbatim (or near-verbatim, trimmed for fixture
size) from the ARCHIVED `channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json` the
adversarial review measured — read for calibration test data only, never as an authoring source (the
process-law ban on reading the archived file during fresh authoring is a Task-C/run-brief matter, not
a test-fixture matter). Confirmed no false positives on:
- **M8's class** — real `warm amber light` / `warm lamp amber` prose (L25/L79) stays silent under
  `render_technique_check`.
- **M9's class** — the four cited object-"sits" sentences (L25 brick, L35 desk, L89 cabinet, L06
  computer) all stay silent under `seat_support_check` (no backticked `` `sit` `` primitive bound to
  any character — the English verb is structurally invisible to the check).
- **M10's class** — L66/L68 (real, uncorrected drift prose) correctly fire `two_cast_presence_check`
  (missing plane/eye-line — the audit's own §D diagnosis); the audit's own prescribed FIX prose (same
  plane, aligned eye line, matching head scale) passes clean.
- **M11's class** — L100 (real defect: VO says "managers", shot casts `brick-foreman`+`qt-wiles`, no
  trace nearby) fires `semantic_cast_check`; a constructed "The managers, especially Wiles, decided…"
  case (the exact justified-lead shape M11 describes) stays silent.
- **Action-chain** — L89/L90 (real, no stage/hard_cut) fire; L67 (real, `stage` declared, same idiom)
  stays silent; L93 (real, fresh scene, no callback) stays silent.

## Ambiguities resolved (my own judgment calls, flagged for the boss to override if wrong)

1. **"symbolic/abstract/object-insert shot_class values"** (C-3 exemption) — the design names three
   categories but the closed 14-value enum has no literal "abstract" or "object-insert" tag. Mapped via
   `visual-grammar.md §1`'s own narration→class table: `symbolic-stand-in-object` (symbolic),
   `map-plan-view` + `physicalized-imbalance` + `register-shift-infographic` (abstract — a map, a
   comparison, an infographic all depict a graphic/abstraction, not a set), `number-glued-to-object`
   (object-insert — "a number glued to its referent object" floats free of any set). Left OUT:
   `diegetic-device` (period TV/radio/newspaper — grounded IN a set) and `idiom-pun` (a visual pun CAN
   be staged in a place; the grammar doesn't say it floats). If the boss's read of the design differs,
   `_PLACELESS_SHOT_CLASSES` in `lint_shots.py` is the single frozenset to edit.
2. **"the shot's figures/cast binding" for C-7** — the shots.json v2 contract has no structured cast
   array (removed by design, see the file's own `schema_check`/`shot_class_check` docstrings); "cast
   binding" is realized as backtick-ORDER binding (a `` `sit` `` token binds to the most-recently-named
   character), exactly mirroring `forge.py shot_cast`'s own algorithm, not re-inventing a new one.
3. **Where the "named figure" vocabulary comes from** — neither lint nor forge's `shot_cast` alone
   covers a video's own cast (`registry.json` deliberately never promotes a video's leads — the
   registry promotion rule, kept). Added `video_chars()`, mirroring `forge.py merge_vocabulary`
   exactly: channel `registry.json` PROMOTED characters ∪ this video's own
   `assets/library/manifest.json` `kind: identity`/`character` entries. Best-effort or absent →
   `seat_support_check`/`two_cast_presence_check`/`semantic_cast_check` degrade silent (never a false
   positive against an unresolved vocabulary), documented inline the same way `script_vocab`'s "NO
   SCRIPT, NO CHECK" reasoning already is.
4. **Place-owner check's "plate shot" proxy** — at AUTHORING/lint time, before `forge.py cmd_batch`'s
   walk actually derives which shot is the plate, lint approximates it as the first shot of the `place`
   group in FILE order (shots already run in enforced narration order). Documented explicitly in the
   docstring as an approximation of C-4's derivation, not a re-implementation of it.
5. **Action-chain's "same props" signal** — rather than attempt NLP noun-overlap between consecutive
   shots (high false-positive risk, and no worked example given), keyed on this project's own authored
   continuity idiom ("the same wax-sealed box", "the same populated boardroom" — both real, existing
   prose) appearing WITHOUT a `stage`/`hard_cut` escape. This is the literal textual tell of the L89-91
   defect itself, not a general "shots resemble each other" heuristic — narrower than a full
   noun-overlap detector, but zero measured false positives against the archived file's legitimate
   delta prose (which always pairs the idiom with a declared `stage`).
6. **`_SUFFIX_SOFT` bare "soft"** — the plan/spec's C-1 recipe explicitly deletes "gentle **soft** cel
   shading"; I added bare `soft` (excluding `soft focus`, already the C-2 banned phrase, via negative
   lookahead) to the suffix-only extra list rather than to the prompt-wide `render_technique_check`
   list, since a prompt-wide ban on ordinary "soft" would refire across ordinary scene prose the C-2
   pinned list deliberately does not include.
7. **"Narrow the lettering escape per the spec"** (Task-B dispatch line, no direct spec citation found
   under that literal phrase) — read as: shots-schema.md §4's supplied-text law resolution 3 ("Blank or
   omit only the unsupported glyph field…") is a blanket escape that, applied to an owner-branded
   surface, would let an author silently skip the place-owner law by blanking the sign. Narrowed in the
   docs (not lint-enforced separately — it's the SAME omission `place_owner_check` already catches,
   since a blanked owner surface never quotes the literal): omitting it is legal only paired with
   `owner_ambiguity: true`. If the boss finds a different "lettering escape" referent in the design docs
   I missed, this is a one-paragraph doc fix, not a lint-logic change.

## Not done / out of scope, and why

- **No forge.py, SKILL.md, or style-bible.md edits** — explicitly out of my file ownership; read at
  HEAD only, per the dispatch.
- **No lint enforcement of C-4's plate derivation itself** (which shot IS the plate) — that's forge's
  runtime derivation over the whole-file walk (worker A); lint validates AUTHORING contracts around it
  (place shape, exemptions, inventory, owner cue, same-place anchor legality) per my dispatch's explicit
  scope ("lint validates authoring matches" C-4 semantics, does not reimplement them).
- **No new critic questions beyond 6-8** — the dispatch named exactly three judgment halves
  (plane/scale coherence, action cause→effect, semantic-cast justification); did not add a fourth for
  place-owner or place-inventory judgment since both of those are fully HARD-decidable (script_vocab
  presence, literal presence) with no coherence residue left for a critic to judge.
- **Full visual-prompt-writer test suite + render-builder-adjacent suite both run and green** (194 +
  191 passed) — no other skill's tests touch `lint_shots.py` by import, confirmed by grep.
