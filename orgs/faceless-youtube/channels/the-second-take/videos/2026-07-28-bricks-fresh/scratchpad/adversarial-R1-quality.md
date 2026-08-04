# Adversarial review R1 — code-quality lens (doctrine-reset wave + end-state sweep)

Reviewer: R1 (adversarial, read-only except this file).
Surface: `git diff 7f38d18..HEAD` on `claude/bricks-doctrine-reset`, PLUS (scope widened by Daniel)
the END STATE of every file that governs prompting and image generation:
`forge.py`, `lint_shots.py`, `build_review_artifact.py`, `stamp_review.py`, `crop_battery.py`,
`finalize_thumbnail.py`, both SKILL.mds, `shots-schema.md`, both `critics.md`, `animation-rules.md`,
`motion-planner/SKILL.md`, `visual-grammar.md`, `style-bible.md`, `example-shots.md`, `dna.md`.

Laws applied (Daniel's, exactly): **1** no duplicate functionality · **2** no special helper where core
logic rolls it in · **3** no contradictions · **4** files slim, no dead info · **5** one clear refusal
per law · **6** change core logic, don't bolt on.

Tags: **[wave]** = introduced or owned by this wave · **[legacy]** = pre-existing debt now visible.

**Verdict: FIX-THEN-PROCEED.** 4 BLOCKING · 14 MAJOR · 13 MINOR.

---

## BLOCKING

### B1 [wave] The channel's `global_prompt_suffix` still carries the deleted style voice — and no doctrine-compliant replacement can pass the new lint
`visual-kit/visual-grammar.md:12-16` · `lint_shots.py:1324` · `test_doctrine_reset_guards.py:102-114`
· laws 3, 4

`visual-grammar.md` is the authority for the suffix: `shots-schema.md:133` and `VPW SKILL.md:202` both
say `global_prompt_suffix` is **copied verbatim** from that header, and `visual-grammar.md:18` says the
suffix "carries texture, line weight, and art style — and it is the ONLY place they are stated." Its
blockquote still reads:

> ... flat colours with **gentle soft cel shading**, rounded friendly shapes ...

That is the exact phrase this wave deleted from `style-bible.md` §2b and the exact phrase
`lint_shots.py::_SUFFIX_SOFT` now HARD-fails. The wave rewrote §2b and built the lint but never swept
the one file VPW copies the string from — `visual-grammar.md` is absent from the spec's "named change
targets" and from Task C's file list (plan:143-146). The live `shots.json` already carries the bad
string verbatim (checked in the main checkout).

Failure scenario: the fresh VPW authoring pass obeys its own SKILL (copy verbatim) → the first
`lint_shots.py` run HARD-fails `[suffix] global_prompt_suffix: soft/gradient-permissive wording
'gentle'` + `'soft'`. The author's only escape is to disobey the copy-verbatim rule.

And there is currently **no legal suffix**: the spec (design §1 Style) says "VPW
`global_prompt_suffix` **inherits the recipe**", but C-1's recipe contains "no **feathered** or
**blended** transitions" and `_SUFFIX_SOFT` matches `feather(ed)`/`blend(ed)` with no negation
awareness. The wave's own test enshrines the trap **and contradicts itself doing it**:

```
def test_c2a_the_c1_recipe_itself_is_silent():
    """... a suffix authored correctly must never trip its own one-voice guard."""
    ...
    assert len(hard) == 2 and all("feather" in h or "blend" in h for h in hard), hard
```

The test is named "…is_silent", its docstring says it must never trip the guard, and it asserts TWO
hard violations. `shots-schema.md:136` implies the intended resolution (the suffix carries the
positive half only, never the negation clause) but no file states it, and the spec says the opposite.

Fix (all three): (a) rewrite `visual-grammar.md:14-16` to the C-1 **positive** recipe, no
soft/gradient wording and no negation clause; (b) add one sentence there and in `shots-schema.md`
§`global_prompt_suffix`: "the suffix carries the recipe's POSITIVE half only — C-1's negations live in
the bible descriptor, not here"; (c) rename the test to what it actually asserts
(`test_c2a_the_c1_negation_clause_is_not_a_legal_suffix`) and fix its docstring.

### B2 [wave] C-11's provenance ledger is derived but nothing ever writes it to `scenes/manifest.json`
`forge.py:1393-1401`, `forge.py:1871-1874`, `image-generation/SKILL.md:224-225` · laws 3, 4

`cmd_batch` derives `parent_depth`/`lineage` per emitted item and `cmd_manifest` validates them *when
present*. But the SKILL's manifest record contract — the only instruction the generating agent
follows — is still `{shot_id, file, technique, seeds, flagged, review_status, parked_reasons,
retry_cause, notes}` (SKILL.md:224). Neither counter appears anywhere in `image-generation/SKILL.md`
(grep: zero hits).

Failure scenario: no manifest entry ever carries the counters, so `_scene_provenance`'s
`_hops(entry.get("lineage"))` reads 0 on every run and `lineage` never climbs past 1. The contract's
stated purpose — "a drifting chain is visible in the manifest instead of being re-derived by eye"
(forge.py:1536) — is unreachable. C-11 is half-wired: the code is right, the pipeline that feeds it
was never told.

Fix: add `parent_depth` + `lineage` to SKILL.md:224's record shape with one clause — "copied from the
`batch` spec item, never re-derived."

### B3 [wave] The C-6 figure-reuse gate has no documented procedure — `image-generation/SKILL.md` never mentions `_staging/review.json`
`image-generation/SKILL.md` (whole file), `forge.py:1152-1178`, `forge.py:1329-1331` · laws 3, 4

`cmd_batch` now HARD-refuses reuse of any staged `fig-*` lacking an all-pass, sha-matching record in
`<kit>/_staging/review.json`. `stamp_review.py --figures` is the only writer and documents its input
shape well (stamp_review.py:32-69). But the SKILL the operator actually runs from has ZERO mentions of
`review.json`, the figure record, the reuse gate, or `--figures`; SKILL.md:151 still describes batch as
simply "reuses an existing step-1 figure frame before generating one", which is now false, and the
"Stamp the gate" paragraph (SKILL.md:327-336) describes only the scene path.

Failure scenario: the run hits the refusal, re-mints (the refusal prints a command), hits it again next
fifth, and never learns that the *review record* is the thing to produce. Every STEP-1 regenerates on
every batch — the gate degrades into a permanent no-reuse tax instead of the review loop it was
designed as, and the reuse-before-regenerate law is silently inverted.

Fix: one paragraph in the SKILL's review/stamp section — the store, its writer invocation
(`py -3 stamp_review.py --figures <verdicts.json> <kit>/_staging`), and that REUSE requires an all-pass
record whose `canonical_sha256` matches the frame on disk.

### B4 [wave] `figure_remint_command` is a second, degraded STEP-1 minter that duplicates `_retry_step1` — and claims parity it does not have
`forge.py:1142-1149` vs `forge.py:1684-1719` · laws 1, 2, 6, 3

Its docstring says "The one line that re-mints one STEP-1 frame **on the builder's own recipe**". It is
not the builder's recipe. It emits a bare CLI `gen --seed a,b,c --delta "<figure card>"`, and the CLI
path (`main()`, forge.py:1992-1993) can only build `seed_roles` as
`[_seed_role(path, "reference") for path in seed_paths]`. So every re-minted STEP-1 is generated with
SEED ROLES prose reading *"The FIRST image is the `<stem>` supporting reference"* instead of the
builder's *"`<char>`'s character canonical — identity, head tone, hair and the pinned costume come from
this image only"* / *"copy only eye/brow/mouth shape; ignore identity, head tone and hairline"*.

The role prose is not decoration — `seed_roles_text` exists because untruthful/absent role prose was
the B4 root cause (forge.py:988-1021). Meanwhile `_retry_step1` already mints exactly the right thing
(canonical + expression + pose roles, `figure_card_payload`, `placement_delta`) through
`batch --retry` with `kind: "step1"`.

Failure scenario: every C-6 refusal in the run points the operator at the degraded path; the re-mint
is reviewed, passes, is reused, and the whole run's STEP-1 figures are seeded by prompts the builder
would never have written. Silent divergence, by construction, on the exact axis the wave was fixing.

Fix: make the refusal print the `batch --retry` step1 overlay recipe (the mechanism that already
exists), or teach the `gen` CLI a `--seed-roles` passthrough. Do not keep two STEP-1 minters.

---

## MAJOR

### M1 [wave] A second sentence splitter, five hundred lines from the first
`lint_shots.py:1522` (`_SENTENCE_SPLIT = r"(?<=[.;!?])\s+"`) vs `lint_shots.py:884`
(`_SENTENCE = r"(?<=[.;])\s+"`) · law 1

The wave added `_SENTENCE_SPLIT` while `_SENTENCE` already existed in the same file, with a different
terminator class. Drift scenario: someone teaches `_SENTENCE` about `!`/`?` (or about abbreviations)
and `seat_support_check`'s sentence scoping silently keeps the old behaviour — C-7's "in the SAME
SENTENCE" requirement then means one thing for negation lists and another for seated supports.
Fix: one constant (`(?<=[.;!?])\s+`), used by both; re-run `test_new_guards.py`'s negation cases.

### M2 [wave] The owner-cue regex copied from lint dropped lint's load-bearing possessive guard
`build_review_artifact.py:121` vs `lint_shots.py:499-500` · law 1

The copy is `r"['\"‘“]([A-Za-z][A-Za-z '&/-]{3,})['\"’”]"`. Lint's `_QUOTED` carries a
`(?<![A-Za-z])` lookbehind whose comment says exactly why: without it "a customer's name
marker-written across the top and a small 'NEW ACCOUNT' tab" parses `'s name … and a small '` as one
quoted value — *"That is the exact frame whose invented name rendered as the garbled `YOU NAME`."* The
copy also drops the 60-char ceiling. The file's own comment says "copied here, not imported" but
copied it inexactly.
Drift scenario: a possessive in a `still_prompt` makes `owner_branding_declared` true, so C-12 emits a
place-owner verdict row on a shot with no owner cue at all, while lint's `place_owner_check` (using the
guarded regex) sees no literal and stays silent — the two halves of the same law disagree per shot.
Fix: copy the regex verbatim including the lookbehind and the `{1,60}` bound, or import the two names
from lint the way `lint_motion_plan.py` already imports from `lint_shots.py`.

### M3 [wave] The C-12 place-owner row is inverted — it fires where the cue exists and stays silent on the plate that is missing it
`build_review_artifact.py:124-131, 161` · laws 3, 6

`applicable_invariants` emits the row when `shot.get("place") and owner_branding_declared(shot)`, and
`owner_branding_declared` reads **that shot's own** prompt. The row's question is *"Owner cue visible
on the plate, or the ambiguity is the intended read"*.
Failure scenario: the plate (first no-cast shot) that forgot the cue has no quoted literal and no
`owner_ambiguity` → **no row**. A later branded shot that already quotes `MINISCRIBE` → row. The human
is asked about the plate on every shot except the plate, and Daniel's failure #6 (ownership invisible
on the establishing frame) is exactly the case the filter suppresses. Lint's own `place_owner_check`
gets this right by grouping per `place`.
Fix: compute the filter per PLACE GROUP (any shot in the place declares a cue or `owner_ambiguity` →
emit the row on that place's place-first shot), mirroring `place_owner_check`.

### M4 [legacy, in a wave-rewritten file] The review artifact still consumes the deleted `verified` boolean
`build_review_artifact.py:232, 418-420` · law 4

`verified=man.get("verified") or {}` then `unstamped = [c for c in cards if not c["verified"]]`.
`stamp_review.py:21` states outright: "It never writes the legacy `verified: {scene, rig}` boolean
shape." Nothing in the pipeline writes `verified` any more; the three-state stamp writes
`review_status`.
Failure scenario: the board always prints "note: N image(s) have no manifest stamp yet" with N = every
card, including a fully `verified` batch — a false honesty signal on the review surface, in the wave
whose whole point is honest review. The wave edited `collect()` and left the dead consumer in it.
Fix: read `review_status`, and report the count of entries that are not `verified` (or drop the line).

### M5 [wave] Lint's "plate" is the first shot in file order; forge's plate is the first shot with no seeds
`lint_shots.py:1449-1482` (esp. 1474 `plate = grp[0]`) vs `forge.py:1384` (`plate = not seeds`) ·
law 3

`place_owner_check`'s own docstring says it mirrors "C-4's derived plate: **the first emitted no-cast
shot** of the place", but the code takes `grp[0]` — the first shot declaring that `place` in file
order, cast or not, and including shots forge never emits (`source` outside `ai-gen|hybrid` is skipped
before `place_first` is set, forge.py:1243-1247).
Drift scenario: a place whose first file-order shot has named cast (or is `source: stock`) → lint
demands the owner cue on a shot that is not the plate and may not be generated at all, while forge's
real plate is a later shot; the author moves the cue to satisfy lint and the establishing frame still
ships unbranded.
Fix: pick the group's first shot with no backticked registry character and a generated `source`, or
state in the docstring that this is a file-order approximation and why it is safe.

### M6 [legacy] `crop_battery.py`'s orphan status is incoherent — three files, three different rulings
`crop_battery.py:2-7` · `build_review_artifact.py:19-20` · `image-generation/SKILL.md:108`,
`motion-planner/SKILL.md:79` · laws 3, 4

- `build_review_artifact.py:19`: "`crop_battery.py` **stays orphaned** (2026-08-03 ratified)".
- `image-generation/SKILL.md:108`: the defective-seed exceptions "**BOTH require a before/after crop
  diff on EVERY figure**" — i.e. `crop_battery --diff`, mandatory.
- `motion-planner/SKILL.md:79`: cutouts are "human-QC-gated on the **hand crop**".
- `crop_battery.py:5`: "a rig verdict **without a crop path is inadmissible**" — a review law that the
  review re-scope repealed.

An agent reading `scripts/` finds a mandatory-evidence law the SKILL's review section contradicts on
the same day's doctrine.
Fix: one ruling. Either delete the script and strike SKILL.md:108/motion-planner:79's crop language, or
keep it strictly as the *seed-exception regression tool* and rewrite its docstring so it stops
asserting the repealed "inadmissible without a crop" review law. Do not leave three answers.

### M7 [wave — doc sweep miss] "a held set carries by seeding the prior frame, never a plate" contradicts the place/plate seed law in the same file
`image-generation/SKILL.md:31` vs `image-generation/SKILL.md:106` · law 3

Line 31 (Pass-1/Pass-2 split, pre-reset text) still says a held set "carries by seeding the prior
frame, **never a plate**". Line 106 (the wave's own seed-law row) says "Every OTHER in-place shot seeds
its own place's **first approved frame**", and `forge.py`'s `place_first` map makes the plate exactly
that seed.
Failure scenario: a Pass-2 operator reading the mode-selection section top-down learns the opposite of
the seeding law it will then be refused by. Line 31 is also the sentence that produced L89-L91.
Fix: rewrite line 31 to "a held set carries by seeding its place's first approved frame (the derived
plate) or its in-chain parent."

### M8 [legacy] `figures_check`'s unknown-key message is false, and `anon_foreground` gets two different refusals
`lint_shots.py:1187-1191` vs `forge.py:232, 243-256, 556-559` · laws 3, 5

Lint says: *"`figures` has unknown key(s) ['anon_foreground']. The field is closed: ['crowd']
(shots-schema.md). **forge.py ignores anything else**, so a misspelled key drops the rig clause
silently."* forge does not ignore it: `_FIG_KEYS` keeps `anon_foreground` as a KNOWN key precisely so
the seeding law can refuse it BY NAME with the restaging instruction (forge.py:229-231, 556-559), and
an actually-unknown key raises a different SystemExit.
So one authoring act yields two refusals with two different remedies (lint: "unknown key, the field is
closed"; forge: "the tier is abolished — name the figure in the cast or stage at crowd scale"), and
lint's version tells the author nothing about what to do.
Fix: make lint's `anon_foreground` branch emit forge's own sentence, and correct the "forge.py ignores
anything else" clause (it hard-errors).

### M9 [legacy] Motion doctrine still assigns the plate a "style anchor duty" the reset abolished — in two files, same sentence
`motion-planner/references/animation-rules.md:19-21` and
`motion-planner/references/critics.md:20-21` · laws 3, 1

Both say "the video's own plate carries the **style anchor** duty/now — no separate cross-video
`refs/env/` anchor exists (fix 2)". The 2026-08-04 ruling is the opposite: image seeds are
**continuity only**, and "No OTHER image style anchor exists: hardened descriptor text was the probe
winner over a rendered-scene anchor" (`image-generation/SKILL.md:106`).
Failure scenario: motion-planner and its critic keep authorizing a seed *for style*, which is the
probe-refuted mechanism the wave exists to remove — and the identical sentence living in two files
means a fix applied to one leaves the other asserting the repealed law.
Fix: replace both with "seed every cutout from its character/prop canonical or the plate it lands on,
for CONTINUITY; style comes from the hardened descriptor, never from a seed" — and state it once,
citing it from the critic.

### M10 [wave] "plate" now means two different things inside one SKILL, undisambiguated
`image-generation/SKILL.md:106` (place plate, a seeding identity) vs `:234-236` (motion plate, the
scene minus a moved element) · law 3

The spec explicitly carved out the layered-shot "plate" as untouched, but nothing in the landed docs
says the two are different objects; `forge.py` now also emits `plate: true` on batch items while
`shots.motion.json` carries `background.plate` file paths.
Failure scenario: an operator materializing "the plate" for a layered shot in an established place has
two defensible readings; one of them re-mints a place frame that should have been seeded.
Fix: one clause at SKILL.md:234 — "**plate** here is the layered-shot plate (`plates/<id>.png`),
distinct from a **place plate** (§Seed law), which is a shot, not a subtraction."

### M11 [wave] "Is this shot seated?" is implemented twice, from two different sources — and the comment points at a constant that isn't there
`build_review_artifact.py:76, 92-103, 113-115` vs `lint_shots.py:1527, 1607-1654` · laws 1, 4

Lint decides seated-ness from the **prompt** (a backticked `sit` token bound to the most recently named
character). The review artifact decides it from the **library manifest** (`kind in (pose, action)` whose
`name`/`tag` matches `/\bsit\b|\bseat/`). Two signals, two files, one law (C-7). Drift scenario: Pass-1
tags and prose disagree for one shot → lint HARD-fails a floating sit that gets no review row, or a
review row appears for a shot lint never checked.
Additionally, the comment at build_review_artifact.py:114-115 says "same cross-skill precedent as
`SEATED_PRIMITIVE` **below**" — there is no `SEATED_PRIMITIVE` in this file, below or above (the
constant is `_SEATED_RE`, defined *above* at line 76). Dead cross-reference to lint's constant.
Fix: derive the review filter from the same signal lint uses (the prompt's backticked primitive), and
correct the comment.

### M12 [wave] The anchor→source-shot name binding is written twice
`forge.py:1191-1193` (`_anchor_place`) and `forge.py:1565-1566` (`_repaired_parent_matches`) · law 1

Both do `re.fullmatch(re.escape(<shot name>) + r"[-.].+", stem)`. `_anchor_place`'s docstring
acknowledges it ("the same binding `_repaired_parent_matches` uses on the retry path") but factors
nothing.
Drift scenario: the repair-frame naming convention gains a second form (e.g. `<id>_fix`); one call site
learns it, the other does not — and the one that doesn't is the **same-place law**, which then resolves
a repaired frame to `place=None` and silently permits a cross-place seed.
Fix: one `_derived_from(stem, base)` helper used by both (3 lines).

### M13 [wave] The flat-cel verdict row is skipped on `hybrid` shots and on shots that omit `source`
`build_review_artifact.py:166` vs C-12 ("flat-cel hazards **on all**") and
`image-generation/SKILL.md:129` · law 3

`if shot.get("source") == "ai-gen"`. forge generates for `ai-gen` **or** `hybrid`
(`forge.py:1243-1244`) and treats a missing `source` as `ai-gen` (`shot.get("source", "ai-gen")`).
Failure scenario: a generated hybrid frame — or any shot whose author omitted `source` — reaches the
board with no style row at all, in the one wave whose headline defect is style drift.
Fix: `if shot.get("source", "ai-gen") in ("ai-gen", "hybrid")`, matching forge's own predicate.

### M14 [wave] The sanctioned mirrors are only half in sync
`forge.py:1253-1263` vs `lint_shots.py:1485-1508` (cross-place law) and `forge.py:1254-1256` vs
`lint_shots.py:1166-1169` (`place_anchor` delta legality) · laws 1, 5

**Cross-place law: IN SYNC.** Both end with the identical sentence — "cross-place image seeding is the
probe-refuted style-anchor failure (decisions.md 2026-08-04); a plate may only seed shots in its own
place." Good.

**`place_anchor` legality: OUT OF SYNC, two ways.**
- Wording: forge — "a delta inherits the in-chain parent frame it is a delta OF"; lint — "a delta
  continues its own base's held scene via the chain parent; `place_anchor` is a different seed, for a
  base or standalone shot." Same law, two sentences; an author who fixes the shot lint described can
  still read forge's message as a different rule.
- Behaviour: forge normalizes (`str(shot.get("stage_role","")).lower() == "delta"`), lint compares
  exactly (`sh.get("stage_role") == "delta"`). A shot with `"stage_role": "Delta"` passes lint and is
  hard-refused by forge at batch time — the mirror's whole purpose (catch it at $0 in lint) fails.
Fix: one law sentence, copied verbatim into both; and make lint case-normalize the same way forge does.

---

## MINOR

- **m1 [legacy]** `forge.py:997-1017` — every `seed_roles_text` detail string contains the mojibake
  `â€”` (cp1252-encoded em dash, introduced in 703b5dc) and is sent to the provider verbatim in the
  SEED ROLES prose of every seeded gen. Law 4. Fix: replace with ` - ` (ASCII) as the rest of the file
  does, or a real em dash written UTF-8.
- **m2 [legacy]** `finalize_thumbnail.py:4-5` — says the candidates come from "`metadata.json`'s
  `thumbnail` concept". The concept lives in `shots.json`'s `thumbnail` block
  (`shots-schema.md:34-36`, `image-generation/SKILL.md:228`). Law 3.
- **m3 [legacy]** `forge.py:243` and `forge.py:1954-1955` — the malformed-`figures` error message and
  the `--figures` CLI help both advertise `{"anon_foreground": ["the clerk"], "crowd": true}` as the
  example shape, i.e. teach the abolished tier as the model. Law 4. Fix: `{"crowd": true}`.
- **m4 [wave]** `lint_shots.py:1354` — `suffix_one_voice_check` reuses `render_technique_check` with
  pid == field, so the message reads `[suffix] global_prompt_suffix.global_prompt_suffix:`. Law 5
  (cosmetic). Fix: pass `("suffix", "global_prompt_suffix", …)`.
- **m5 [wave]** `lint_shots.py:1329-1344` — `render_technique_check` is the only prompt-scanning check
  with no `suffix` parameter, so it does not `strip_suffix`. Every sibling does. If a prompt ever
  carries the suffix inline (the case `strip_suffix` exists for), one banned suffix term is reported
  once per shot **plus** once by `suffix_one_voice_check`. Laws 1, 5.
- **m6 [wave]** `lint_shots.py:1695` vs `:1703` — `action_chain_check` reads only `sh.get("stage")` but
  its message says the shot "declares no `stage`/`stage_role` chain"; C-8 names both. Law 3.
- **m7 [wave]** `lint_shots.py:1529` vs `:1646-1647` — the closed support-noun list is retyped as a
  literal inside the refusal string instead of interpolating `_SUPPORT_NOUN`. Law 1 (drift trap: widen
  the regex, and the message still names the old list).
- **m8 [legacy]** `example-shots.md` — the depiction BAR that VPW is told to match (SKILL Step 1/3b)
  contradicts two live laws: (a) every in-image literal is authored **unquoted** (`lettered 8,000,000
  ACRES` :25, `stamped 350 PAGES` :46, `a peeling POYAIS GOVERNMENT sign` :32) while `shots-schema.md`
  §4 requires the value quoted verbatim and L-1 requires re-quoting; (b) §1 stages "a dense cluster of
  … anonymous figures on the `crowd-exemplar` rig … **in the lower third**", which is the co-planar
  foreground gathering `visual-grammar.md:128-130` forbids. Law 3.
- **m9 [legacy]** `build_review_artifact.py:46-48` — `shot_index` reads only `long_form.shots`, so
  shorts' frames and thumbnails never receive C-12 verdict rows even though they are generated and
  reviewed. Law 3 vs C-12's "one row per (shot × applicable invariant)".
- **m10 [legacy]** `visual-kit/scripts/gen_angle_test.py:50` and `gen_cast_test.py:46` still hard-code
  "gentle soft cel shading" into their prompts — a third style voice living in runnable channel
  scripts. Law 3/4. Fix: delete the scripts or point them at the bible descriptor.
- **m11 [legacy]** `visual-prompt-writer/references/critics.md:54` asks the critic "Does every
  backticked name exist in `registry.json`? … Is crowd-rig text left in the prompt?" while `:97-98`
  says "The mechanical caps … are `lint_shots.py`'s job; do not re-flag them" — and `rig_clause_check`
  already HARD-fails the crowd-rig text. Law 1/3.
- **m12 [legacy]** `image-generation/SKILL.md:219` — "Seed `[current frame + base-rig exemplar]`" names
  an asset that does not exist (`refs/base/` has `base.png` and `crowd-exemplar.png`; the §2e BASE-RIG
  clause was deleted). Law 4.
- **m13 [legacy]** `image-generation/SKILL.md:47` ("Environments, **plates**, one-off props and
  anonymous crowds get NO slot") vs `:68` ("**Prop / group / plate:** `--mode environment`/`style` …"
  as a Pass-1 build step). Law 3.

---

## Sanctioned-mirror sync check (explicit)

| Mirror | Status |
| --- | --- |
| Cross-place law (`forge.py:1259-1263` ↔ `lint_shots.py:1504-1508`) | **IN SYNC** — law sentence identical, verbatim, including the `decisions.md 2026-08-04` citation. |
| `place_anchor` legality (`forge.py:1254-1256` ↔ `lint_shots.py:1166-1169`) | **OUT OF SYNC** — different law sentences and different `stage_role` comparisons (see M14). |
| C-7 seat/support (`lint_shots.py:1607` ↔ `build_review_artifact.py:92`) | **OUT OF SYNC** and not a sanctioned pair — two different detection signals (see M11). |
| C-6 store shape (`forge.py:1129-1178` ↔ `stamp_review.py:196-231`) | **IN SYNC** — same five fields, same normalization, single writer preserved. |

## What is clean

- `stamp_review.py` — the C-6 extension is genuinely additive: separate CLI form, separate store,
  scene path byte-stable (`_atomic_write_json` was already the writer), input shape documented in the
  docstring exactly as the plan required. No duplication, no contradiction found.
- `finalize_thumbnail.py` — tight, single-purpose, no dead paths (one stale docstring line, m2).
- `forge.py`'s place model itself — `place = declared_place or stage or name` is ONE map keyed
  correctly (C-4), the plate marker is derived from `not seeds` rather than an authored flag, and cap
  displacement is recorded through the existing `assets_omitted` channel rather than a parallel one.
  This is core-logic change, not a bolt-on; the C-10 expression gate likewise lives inside the existing
  delta path.
- `shots-schema.md` — the new `place` / `place_anchor` / `hard_cut` / `owner_ambiguity` semantics are
  stated once, consistently, and match the code.
- `dna.md` — carries no second style voice; correctly delegates to the bible and grammar.
