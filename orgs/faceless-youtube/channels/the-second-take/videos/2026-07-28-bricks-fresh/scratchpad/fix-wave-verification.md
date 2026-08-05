# Fix-wave closure verification — bricks doctrine reset

Verifier: independent closure pass, read-only except this file. Worktree
`kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`.
Surface: `git diff c5db488..HEAD` (commits b55fe0a F1, 5b1a9b7 F2, dc61405 F3, 5693318 F4 + boss glue).

Method: every verdict below was read from the **landed file at the cited location**, not from the fix
reports. Fix-report claims were used only to build the claim column.

**VERDICT: CLOSED-CLEAN on blocking. 5/5 BLOCKING CLOSED · 21/21 MAJOR CLOSED (2 with residual notes,
recorded as PARTIAL) · no REGRESSED finding.** Suites: 162 / 218 / 17, all green.

Two MAJOR carry residuals that are new-seam observations rather than reopenings of the original
finding: **R1-M1** (the duplicate sentence splitter was never removed — explicitly disclaimed by F3)
and **R1-M6** (crop-battery retirement is now one ruling in three of four files; `motion-planner/SKILL.md:80`
still asserts a hand-crop QC gate). **R1-M8** is likewise still open. These are the only carry-overs.

---

## 1. BLOCKING (5 unique themes)

### R1-B1 + R2-B1 — the suffix still carried the deleted style voice · claimed by b55fe0a (F1) + 5b1a9b7 (F2)
**CLOSED.** The wave did not patch the string — it changed the architecture, which is the stronger close.

- `visual-kit/visual-grammar.md:12-19`: the blockquote is now **`> hand-lettered marker capitals for any
  in-world text`** and the prose reads "The suffix carries ONLY the lettering register … Texture, line
  weight, and art style are stated ONCE, in `style-bible.md` §2b (the single style source), and reach
  every request through `forge.py`'s descriptor, never through this suffix."
- `shots-schema.md:14`: the field comment now reads "copied VERBATIM from visual-grammar.md's header —
  the LETTERING clause only; the style recipe lives in style-bible.md §2b and is never restated here".
  The copy-verbatim law and the lint law no longer conflict — there is now a legal authoring move.
- `lint_shots.py:1388-1424` `suffix_one_voice_check`: **three** refusals, one per way of breaking it —
  banned render-technique term (shared list with `render_technique_check`, so they cannot disagree),
  `_SUFFIX_SOFT` (gentle/soft/blend/feather), and the new `_SUFFIX_STYLE_VOCAB` refusing the recipe's
  own terms *even when verbatim-correct*. The refusal states the reason as architecture: "the recipe has
  one home … restating any of it here — even the correct C-1 wording — is a second copy that drifts."
- B1's fix (c): the self-contradicting test is renamed and re-docstringed —
  `test_c2a_even_the_correct_c1_recipe_is_not_a_legal_suffix` (test_doctrine_reset_guards.py:128), with
  `test_c2a_the_new_lettering_only_suffix_is_silent` (:110) as the positive case.
- Residual by design: the live `shots.json` still carries the old suffix and will hard-fail lint until
  the fresh VPW authoring pass runs. That is the intended gate, not a defect.

### R1-B2 — C-11 provenance derived but never written to the manifest · claimed by dc61405 (F3)
**CLOSED.** `image-generation/SKILL.md:228-236` now specifies the record shape as
`{… retry_cause: null, parent_depth, lineage, notes}` with the clause the finding asked for —
"**COPIED from the `batch` spec item, never re-derived by eye**" — plus the emit invocation
`manifest --kind scenes --batch <entries.json> --from-batch <the spec batch wrote>`.
The transport is real, not just documented: `forge.py:1906` `PROVENANCE_COUNTERS`, `:1910`
`batch_provenance()` reading the spec back, `:1926-1961` `cmd_manifest(..., from_batch=)` copying both
counters per entry (spec `name` == entry `shot_id`), refusing a non-hop counter and refusing
`--from-batch` on a non-scenes kind (`:1951`); CLI flag wired at `:2069`/`:2121`. `lineage` can now
climb past 1.

### R1-B3 + R2-M4 — C-6 figure-reuse gate had no documented procedure, run hard-stops at slice 2 · claimed by dc61405 (F3)
**CLOSED, loop-complete.** `image-generation/SKILL.md:290-318` now carries the whole procedure as a
numbered three-step loop (build board with `--staging` → fresh-eyes rules the figure cards → orchestrator
runs `stamp_review.py --figures`), names the store `<kit>/_staging/review.json`, gives the record shape,
and states the four refusal conditions. `:378-381` repeats the stamp step in the "Stamp the gate" section
with the consequence ("run it before the next batch generates, or every STEP-1 the next batch would
reuse is refused"). SKILL.md:150-152 also corrects the now-false "reuses an existing step-1 figure frame"
sentence to "**but only one carrying an all-pass, digest-current review record**".

The missing producer R2-M4 named is now built: `build_review_artifact.py` gained `--staging` (`:568`) and
`--figures-out` (`:571`), `pending_figures()` (`:293`) driven by `forge.figure_reuse_blocker` itself — so
the board's pending list and forge's gate **cannot disagree** — and `figure_verdict_skeleton()` (`:320`)
writing pre-keyed, `canonical_sha256`-computed, empty-verdict JSON. Single-writer law preserved:
`stamp_review.py:32-45` restates that the board writes only the skeleton and it remains the only writer.

### R1-B4 — `figure_remint_command` was a second, degraded STEP-1 minter · claimed by dc61405 (F3)
**CLOSED.** `forge.py:1175-1198` is now `figure_remint_instruction`, and it prints the **builder**
path, not a `gen --seed a,b,c` line: `1. delete the refused frame · 2. forge batch --shots <name> ·
3. forge gen --batch · 4. stamp_review.py --figures`. The docstring states the law that makes the
duplication illegal ("the `gen` CLI can only build `reference` roles … untruthful role prose is the B4
root cause `seed_roles_text` exists to remove. So the refusal points at the builder rather than
duplicating it … One minter, one truth"), and `figure_reuse_refusal:1200-1210` repeats it in the
operator-visible message. The prohibition is mirrored in doc at `image-generation/SKILL.md:316-318`
("**Never hand-mint a STEP-1 with `gen --seed a,b,c`**"). No second minter remains.

### R2-B2 — `action_chain_check` was a false-positive machine (28 fires / 214 shots) · claimed by 5b1a9b7 (F2)
**CLOSED.** `lint_shots.py:1908-1952` was re-keyed off `still_prompt` entirely. It now requires **all
four** conditions: adjacent-in-file, same `place`, a shared concrete prop noun in **both shots' `vo_text`**
(`prop_nouns`, singularized), the later shot declaring **no** `stage`/`stage_role` at all, and no
`hard_cut: true`. `_SAME_CALLBACK` is gone. Each of R2-B2's three structural complaints is answered in
code and stated in the docstring:
- place is now load-bearing (condition 1), so a `place`-declaring continuation is in scope for the right
  reason and the place-exempt `shot_class` values can never fire;
- L39-class intra-frame English ("at the same eye-line") can no longer match — the check never reads
  `still_prompt`, so the collision with the sibling two-cast law is structurally impossible;
- the author is never pushed into a false `hard_cut` — the docstring says so explicitly, and any declared
  chain silences it.
Doc side matches: `shots-schema.md:169-178` restates the four conditions verbatim and the "the test reads
the NARRATION, never `still_prompt` idioms" rationale; `visual-prompt-writer/references/critics.md` q.7
was rewritten to match the narrowed lint ("It stays silent the moment ANY chain is declared, and it never
reads `still_prompt`"). Tests `test_action_chain_*` (5 silence cases) pin it.

---

## 2. MAJOR

### R1-M1 — a second sentence splitter · unclaimed (F3 explicitly declined: "not fixed here, and not mine to fix")
**PARTIAL / effectively OPEN.** Both constants still stand with different terminator classes:
`lint_shots.py:884` `_SENTENCE = (?<=[.;])\s+` and `:1677` `_SENTENCE_SPLIT = (?<=[.;!?])\s+`. The drift
scenario the finding described is untouched: teach one about abbreviations or `!`/`?` and C-7's
"in the SAME SENTENCE" means one thing for negation lists and another for seated supports. Law 1
violation stands. **Only unaddressed MAJOR from R1.**

### R1-M2 — owner-cue regex copied from lint without lint's possessive guard · claimed by 5693318 (F4)
**CLOSED, by deletion rather than by re-copy.** `build_review_artifact.py:149-162` documents and deletes
the whole heuristic: `owner_branding_declared`, the `_QUOTED` copy and `_TRACKABLE_LITERAL` are gone.
The row now reads the lint-enforced `place_owner` **field** (`owner_literal_by_place`, `:163-177`), and
the only string matching left is `_quotes_literal` (`:183-192`), which searches for one **already-known**
value — the comment correctly notes that possessive ambiguity cannot apply when the needle is fixed.
No inexact copy remains, so the two halves of the law cannot diverge.

### R1-M3 + R2-M3 — the C-12 place-owner row was inverted; Daniel's failure #6 closed nowhere · claimed by 5b1a9b7 (F2) + 5693318 (F4)
**CLOSED.** Closed on the lint side rather than by emitting a row on every place shot — a stronger
architecture than the reviewers proposed, and it removes the silence case at the root:
- `lint_shots.py:1577-1637` `place_owner_check` is now a **forced choice**: every place's plate declares
  exactly one of `place_owner: "<LITERAL>"` or `owner_ambiguity: true`. Neither → HARD ("Ownership
  invisible on the establishing frame with no decision recorded is audit failure #6"). Both → HARD. Any
  non-plate shot declaring either → HARD. A declared literal must be quoted verbatim in the plate's own
  `still_prompt` (`:1620-1627`), so all existing lettering caps apply unchanged. Silence is no longer
  satisfiable — which is precisely the suppression R2-M3 identified.
- `build_review_artifact.py:220-248`: with the declaration now mandatory, the review row's job narrows
  to legibility, and it fires on the plate itself **or** on any later in-place shot that redraws (quotes)
  the literal. The old "fires on branded shots, silent on the plate" inversion is gone.
- L-1 carry wired: `carried_literal_check` (`lint_shots.py:969-976`) registers a place's `place_owner`
  for every shot of that PLACE across stage runs.

### R1-M4 — review artifact still consumed the deleted `verified` boolean · unclaimed in report headings, landed in 5693318
**CLOSED.** `build_review_artifact.py:379-382` replaces the read with `review_status=man.get("review_status")
or "unreviewed"` and keeps a comment recording why the old shape was a false honesty signal. `:587-590`
now computes `unstamped = [c["sid"] for c in cards if c["review_status"] != "verified"]` and prints
"N image(s) are not `verified` … (unreviewed or parked)". No `verified` consumer remains.

### R1-M5 + R2-M1 + R2-M2 — lint's plate ≠ forge's plate; C-4's conditional plate law implemented nowhere · claimed by 5b1a9b7 (F2)
**CLOSED (one residual seam noted below).** The wave resolved this by making the plate **one definition**
instead of reconciling two:
- `lint_shots.py:1508-1538` `place_groups` is THE definition — "the plate of a place is the FIRST-IN-FILE
  shot declaring that place" — and its docstring explains the relationship to forge's mechanical marker
  (`plate = not seeds`) rather than duplicating it: "asserting that coincidence on the authoring side, at
  $0, is exactly `place_plate_check`'s job. Lint never re-derives forge's marker and forge never re-checks
  the authoring." The docstring/code contradiction R2-M2 found is gone: code and docstring now agree.
- The missing C-4 half is implemented: `place_plate_check` (`:1541-1574`) HARD-fails a **qualifying** place
  (≥2 shots, or plate declares `place_owner` — `:1536`) whose plate names cast or is a `stage_role: delta`.
  This is the check R2-M1 said nobody landed.
- Doc side single-sourced: `shots-schema.md:60-70` and `visual-prompt-writer/SKILL.md:128-133` both state
  the first-in-file definition + the qualifying condition + the two plate requirements.

**Residual seam (recorded, not a reopening):** `forge.py:1292-1295` skips any shot whose `source` is
outside `ai-gen|hybrid` *before* setting `place_first`, but `place_groups`/`place_plate_check` do not
consider `source`. A place whose first-in-file shot is `source: stock|chart|screencap|archival` therefore
passes lint's plate law while forge's real plate is a later shot. Relatedly,
`image-generation/SKILL.md:108` still describes the plate as "the first **emitted** shot of a qualifying
place with no named cast" — forge's wording — while VPW/schema/lint say "first-in-file". Both wordings are
defensible on their own side, but no file states the source caveat. One sentence would close it.

### R1-M6 — `crop_battery.py`'s orphan status: three files, three rulings · claimed by dc61405 (F3)
**PARTIAL.** Three of the four sites now give one ruling — RETIRED:
- `crop_battery.py:2-10` rewritten: "RETIRED (2026-08-03 ruling). **No review procedure calls this script
  and no verdict depends on it.**" The repealed "a rig verdict without a crop path is inadmissible" law is
  explicitly struck and named as repealed.
- `image-generation/SKILL.md:110` — the mandatory before/after crop diff is replaced by "BOTH are re-ruled
  by the next fresh-eyes pass at ordinary viewing scale … **`crop_battery.py` is RETIRED**".
- `:128` and `:295` both re-point to the retirement.

**Remaining:** `motion-planner/SKILL.md:80` still says cutouts are "human-QC-gated on **the hand crop**" —
the fourth of the four sites the finding listed, untouched. It does not name `crop_battery.py`, so it is
weaker than the original contradiction, but it still asserts a crop-scale QC gate that the retirement
ruling says no verdict depends on.

### R1-M7 — "a held set carries by seeding the prior frame, never a plate" contradicted the seed law · claimed by b55fe0a (F1), landed in dc61405
**CLOSED.** `image-generation/SKILL.md:29-33` now reads: "**within a stage**, a held set carries by
seeding its delta's in-chain parent frame; **across a place**, continuity carries by seeding the place's
derived plate (§Seed law, below) — never a freshly re-authored plate." Both halves of the seeding law now
agree, and the Pass-1/Pass-2 sentence that produced L89-L91 is gone.

### R1-M8 — `figures_check`'s unknown-key message is false; `anon_foreground` gets two different refusals · unclaimed
**OPEN.** `lint_shots.py:1208-1212` is unchanged: it still reports `anon_foreground` as a generic unknown
key and still asserts "**forge.py ignores anything else**, so a misspelled key drops the rig clause
silently." forge does not ignore it — `forge.py:229-232` keeps it a KNOWN key precisely so `:557` can
refuse it BY NAME with the restaging instruction, and a genuinely unknown key raises a different
`SystemExit`. One authoring act still yields two refusals with two different remedies, and lint's version
still tells the author nothing about what to do. Law 3/5 violation stands.

### R1-M9 — motion doctrine assigned the plate a "style anchor duty" the reset abolished, in two files · claimed by b55fe0a (F1)
**CLOSED.** Both sites rewritten to the continuity-only law:
`motion-planner/references/animation-rules.md:18-21` — "seed every cutout from its character/prop
canonical, or from the plate it lands on, **for CONTINUITY**: the plate carries place/set continuity only
— it is not a style anchor … **Style comes from the hardened bible descriptor (`style-bible.md` §2b),
never from a seed**"; `references/critics.md:20-22` — "the video's own plate carries place/set continuity
only — style is text-only via the bible descriptor". Consistent with
`image-generation/SKILL.md:108` ("No OTHER image style anchor exists").

### R1-M10 + R2-MINOR-6 — "plate" meant two things inside one SKILL, undisambiguated · claimed by dc61405 (F3)
**CLOSED (one doc site short of complete).** Stated in both directions, in the two places an operator
actually reads:
- `image-generation/SKILL.md:108` (seed law) — "**\"Plate\" here is the PLACE plate — a whole shot, the
  place's first approved frame. The layered-shot plate (`plates/<id>.png`, §Layered shots) is a different
  object: a subtraction from one scene, not a place's establishing frame.**"
- `:246-249` (layered shots) — the mirror sentence, ending "Materializing 'the plate' for a layered shot
  in an established place means the subtraction, never a re-minted place frame." That closes exactly the
  ambiguous operator decision M10 described.
R2-MINOR-6 additionally asked for the sentence in `shots-schema.md`'s `place` bullet; it is not there.
Minor, since the schema bullet never mentions layered plates at all.

### R1-M11 + R2-MINOR-5 — "is this shot seated?" implemented twice from two sources; dead cross-reference · claimed by 5693318 (F4)
**CLOSED, with a drift guard.** `build_review_artifact.py:122-139` `seated_shots` now derives seatedness
from **the prompt's backticked primitive bound to a named character** — lint's own signal, on the same
prompts — instead of the library manifest's `kind`. The dangling comment is fixed by making it true:
`SEATED_PRIMITIVE = "sit"` now genuinely exists in this file (`:100`), matching lint's constant name.
Better than the finding asked for: `test_build_review_artifact.py:78-113` adds **drift canaries** that
read `lint_shots.py` as text and assert every copied definition is byte-identical, failing loudly if the
source line disappears. The two halves of C-7 can no longer disagree.

### R1-M12 — the anchor→source-shot name binding written twice · claimed by dc61405 (F3)
**CLOSED.** `forge.py:1213-1221` adds `_derived_from(stem, base)` with the rationale in its docstring
("ONE binding, used by both the same-place law (`_anchor_place`) and the retry path
(`_repaired_parent_matches`). Written twice, a second naming form taught to only one call site…").
Both call sites now use it: `:1235` (`_anchor_place`) and `:1627` (`_repaired_parent_matches`). No
duplicated `re.fullmatch(re.escape(...) + r"[-.].+")` remains.

### R1-M13 + R2-MINOR-3 — the flat-cel verdict row skipped `hybrid` and `source`-less shots · claimed by 5693318 (F4)
**CLOSED.** `build_review_artifact.py:211-217` introduces `GENERATED_SOURCES = ("ai-gen", "hybrid")` with
a comment deriving it from forge's own predicate, and `:252` is now
`if shot.get("source", "ai-gen") in GENERATED_SOURCES`. The doc deviation R2-MINOR-3 flagged is also
closed rather than merely tolerated: `image-generation/SKILL.md:290-292` restates C-12's wording as
"flat-cel hazards on **every shot whose pixels this pipeline generates or composites** (`source: ai-gen |
hybrid`, and an absent `source` is `ai-gen` — only pure library reuse is exempt)".

### R1-M14 — the sanctioned mirrors only half in sync (`place_anchor` legality) · claimed by 5b1a9b7 (F2, lint) + dc61405 (F3, forge)
**CLOSED, both ways.** Wording: the canonical law sentence — "a delta continues its own base's held scene
via the chain parent; `place_anchor` is a different seed, for a base or standalone shot" — is now
byte-identical at `lint_shots.py:1188-1190` and `forge.py:1310`, and `place_anchor_check`'s docstring
(`:1170-1177`) names it as the canonical sentence and records the precedent seam. Behaviour: lint now
case-normalizes exactly the way forge does — `str(sh.get("stage_role") or "").lower() == "delta"`
(`:1187`) — so `"Delta"` is caught at $0 instead of passing lint and being hard-refused at batch time.
The cross-place law mirror R1 already found IN SYNC is untouched.

### R2-M5 — `semantic_cast_check`'s exemption failed on plural-role vs singular-slug · claimed by 5b1a9b7 (F2)
**CLOSED.** `lint_shots.py:1762-1777` adds `_singular()`, and the justification test at `:1992-1995` now
compares **singularized forms on both sides** (`{_IRREGULAR_ROLE.get(w, _singular(w)) …}` over the VO
window vs `_singular(tok)` over each slug fragment). "the bankers" now justifies `hq-banker`. The
docstring records the measurement (6 shots it wrongly fired on) and honestly names the remaining
limitation (irregular plurals fold only for this check's own closed role list, via `_IRREGULAR_ROLE`),
so the doc no longer over-promises. `shots-schema.md:143-145` states the singularization law.

### R2-M6 — the channel's depiction bar hard-failed two of the new HARD lints · claimed by b55fe0a (F1)
**CLOSED.** `example-shots.md`:
- Entry 3 (seat/support): "sits alone **on a chair** at one small desk" — now names a closed-list support
  with a contact phrase, so `seat_support_check` passes.
- Entry 2 (two-cast): adds "**facing him at a matching eye-line and head scale, both on one plane**", plus
  a Why-line explaining that C-8 requires all three on every 2+-cast shot.
- New **Entry 9** demonstrates `place` + plate as a pair (plate = no-cast establishing shot; follow-up
  seeds it and spends its prompt only on what changed) — the exemplar R2-M6 said was missing entirely.
- Entry 8's rationale updated from stage-only continuity to "one stage **inside the video's own `place`**".
- The file's own preamble contradiction is fixed: "never replaced for style — an entry that turns out to
  violate a landed law is corrected in place, since a law-violating exemplar teaches the violation."

### R2-M7 — C-10's expression state keyed on `place`, leaking across stage chains · claimed by dc61405 (F3)
**CLOSED.** `forge.py:1278` is now `held_expression = {}  # (chain, character) -> …`, read/written at
`:1341-1344` on `(chain, c)`, **and** `:1325-1326` additionally clears every entry for a chain at its
base — belt and braces against both the false-negative (the L75 mechanism) and stale carry-over.

---

## 3. MINOR — disposition sweep (ids only, no deep verification)

**Closed incidentally:** R1 m6 (action-chain message now names both `stage`/`stage_role`, and the code
tests both) · R1 m12 (the phantom "base-rig exemplar" seed at SKILL.md:219 — the §2e machinery text was
swept; a single "base-rig exemplar" mention survives at `:222` in the de-nose/de-ear fix, see below) ·
R2 3 (flat-cel contract wording widened) · R2 5 (two "seated" definitions — closed with M11) · R2 6
(motion-plate disambiguation — closed in `image-generation/SKILL.md`, not in `shots-schema.md`).

**Still open:** R1 m1 (9 `â€”` mojibake occurrences remain in `forge.py`, still shipped to the provider in
SEED ROLES prose) · m2 (`finalize_thumbnail.py:4-5` still says the concept comes from `metadata.json`) ·
m3 (`forge.py:243` and `:2044` still advertise `{"anon_foreground": …}` as the example shape) · m4
(`[suffix] global_prompt_suffix.global_prompt_suffix:` doubled pid) · m5 (`render_technique_check` still
takes no `suffix`, so it never strips it — though the *double-report between the two suffix checks* is
fixed and pinned by `test_c2a_soft_focus_is_not_double_reported`) · m7 (the support-noun list is still
retyped as a literal inside the refusal string instead of interpolating `_SUPPORT_NOUN`) · m8
(`example-shots.md` unquoted in-image literals + the co-planar lower-third crowd — F1 explicitly flagged
this as out of its scope and not fixed) · m9 (`shot_index` still reads only `long_form.shots`) · m10 /
R2 12 (the channel probe scripts still carry "gentle soft cel shading") · m11
(`visual-prompt-writer/references/critics.md` still asks the critic to re-flag registry/crowd-rig items
its own §97-98 says are lint's job — q.7 was rewritten, this pair was not) · m12 residual
(`image-generation/SKILL.md:222` "base-rig exemplar") · m13 (SKILL `:49` "plates … get NO slot" vs `:70`
"Prop / group / **plate**" as a Pass-1 build step) · R2 1, 2, 7 (stale *plan* text — the plan file is
outside the fix diff) · R2 4 (rows still display-only) · R2 8 (`"place" in sh` key-presence at
`lint_shots.py:1464` / `:1476`) · R2 9 ("names no **a** support object", `lint_shots.py:1872`) · R2 10
(C-1's two dropped §2b anchors — flagged for the §4 style probe) · R2 11 (`miniscribe-boardroom` as the
doc example in `shots-schema.md` + VPW SKILL).

None of the open minors is load-bearing on a blocking or major closure.

---

## 4. New-contradiction sweep across the fix diffs (`git diff c5db488..HEAD`)

The four workers ran in parallel; I checked each named seam end-to-end for a sentence, message, field
name, or definition left disagreeing.

| Seam | Sites checked | Verdict |
| --- | --- | --- |
| **Suffix architecture** | `visual-grammar.md:12-19` ↔ `shots-schema.md:14` ↔ `shots-schema.md:150-160` ↔ `visual-prompt-writer/SKILL.md` ↔ `lint_shots.py:1388-1424` ↔ tests | **CONSISTENT.** All five say the same thing — lettering clause only, recipe lives in `style-bible.md` §2b, three refusals. No file still claims the suffix carries texture/line weight/art style (grep for the old sentence returns only the two rewritten lines). |
| **Plate definition** | `lint_shots.py:1508-1538` ↔ `shots-schema.md:60-70` ↔ `visual-prompt-writer/SKILL.md:128-133` ↔ `forge.py:1384` ↔ `image-generation/SKILL.md:108` | **CONSISTENT in law, one wording seam.** VPW/schema/lint all say "first-in-file shot declaring the place"; forge derives it mechanically and lint's docstring correctly frames itself as the $0 assertion of that coincidence. But `image-generation/SKILL.md:108` still phrases it as "the first **emitted** shot … with no named cast", and neither side states the `source`-skip caveat (`forge.py:1292-1295`) under which the two genuinely diverge. See R1-M5 residual. |
| **`place_owner` field** | `shots-schema.md:24-25, 165-178` ↔ `visual-prompt-writer/SKILL.md:133-137` ↔ `lint_shots.py:1577-1637` ↔ `lint_shots.py:969-976` (L-1 carry) ↔ `build_review_artifact.py:149-192, 242-248` | **CONSISTENT.** One field name, one forced-choice law, plate-only declaration, verbatim quoting required, place-wide L-1 carry — stated identically at every site, and the review artifact reads the field rather than re-inferring it. `owner_ambiguity` is described as mutually exclusive in both directions in the schema. |
| **Canonical `place_anchor` delta sentence** | `lint_shots.py:1188-1190` ↔ `forge.py:1310` | **BYTE-IDENTICAL**, and `place_anchor_check`'s docstring names it as canonical and records which side owns the message shape. Case-normalization now matches on both sides. |
| **C-6 procedure** | `image-generation/SKILL.md:290-318, 378-381` ↔ `build_review_artifact.py:23-35, 293-338, 568-602` ↔ `stamp_review.py:32-69` ↔ `forge.py:1145-1210` | **CONSISTENT.** Same store path, same record shape (`canonical_sha256`/`expression_sha256`/`verdicts`/`reviewer`/`date`), same four refusal conditions, same single-writer law, same step ordering. The board's pending list is computed by calling `forge.figure_reuse_blocker` directly, so the doc's claim that "the two can never disagree" is structurally true rather than aspirational. |
| **Crop-battery retirement** | `crop_battery.py:2-10` ↔ `image-generation/SKILL.md:110, 128, 295` ↔ `build_review_artifact.py` header ↔ `motion-planner/SKILL.md:80` | **ONE DISAGREEMENT REMAINS** — `motion-planner/SKILL.md:80`'s "human-QC-gated on the hand crop". See R1-M6. |
| **Seated signal / copied constants** | `build_review_artifact.py:78-139` ↔ `lint_shots.py:1836-1878` ↔ `test_build_review_artifact.py:78-113` | **CONSISTENT and machine-enforced** by the byte-identity drift canaries. |

**No REGRESSED finding.** Specifically checked for the four failure modes: no new duplication (M12 and
M11 removed duplication; the one copied block is canary-guarded and documented as copied-not-imported,
with the reason — no import path between the two skill packages); no special-casing (the C-4 plate law
landed as one predicate used by every place check, not a per-case escape); no new contradiction beyond
the two seams tabled above; no dead info introduced (the `verified` reader and the `owner_branding`
heuristic were both deleted rather than left as fallbacks).

---

## 5. Suites — run by me, in this worktree

| Suite | Command | Result |
| --- | --- | --- |
| image-generation | `py -3 -m pytest -q` in `orgs/faceless-youtube/.claude/skills/image-generation/scripts` | **162 passed** (expected 162) |
| visual-prompt-writer | `py -3 -m pytest -q` in `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts` | **218 passed** (expected 218) |
| motion-planner | `py -3 -m pytest -q` in `orgs/faceless-youtube/.claude/skills/motion-planner/scripts` | **17 passed** (suite exists: `test_lint_motion_plan.py`) |

Total **397 green, 0 failed, 0 skipped**. Note for the record: the scripts live under
`orgs/faceless-youtube/.claude/skills/…`, not the repo-root `.claude/skills/…` named in the brief.

---

## 6. What I would still fix before the doctrine gate

Nothing blocking. In cost order:

1. **R1-M8** (~3 lines) — give lint's `anon_foreground` branch forge's own refusal sentence and delete the
   false "forge.py ignores anything else" clause. It is the only surviving finding where the two engines
   hand the author two different remedies for one authoring act.
2. **R1-M1** (~2 lines) — one sentence constant, used by both call sites.
3. **R1-M6 residual** (1 sentence) — strike the hand-crop language from `motion-planner/SKILL.md:80`.
4. **R1-M5 residual** (1 sentence) — state the `source`-skip caveat where the plate definition lives, or
   have `place_plate_check` require the plate to be a generated shot.
5. The cosmetic minors that an author reads repeatedly: R2 9 (grammar), R1 m4 (doubled pid), R1 m1
   (mojibake shipped to the provider).
