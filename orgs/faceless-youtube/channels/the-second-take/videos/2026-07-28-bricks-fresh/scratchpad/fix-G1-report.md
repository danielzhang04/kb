# Fix worker G1 — doctrine/generator half of the fresh-fifth fix list

Worktree `C:/Users/danie/kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`.
Nothing committed, nothing generated, no provider call, $0. The main checkout was read only for the
locked `visual-kit` (forge needs a resolvable `Kit.root`) and the archived file.

## Suite totals

| suite | before | after |
| --- | --- | --- |
| visual-prompt-writer | 222 | **253** (+31) |
| image-generation | 162 | **181** (+19) |
| motion-planner | 17 | **17** |

New test files: `visual-prompt-writer/scripts/test_round2_guards.py` (29),
`image-generation/scripts/test_forge_interaction_and_lettering.py` (19). Five existing
`test_doctrine_reset_guards.py` place-law fixtures encoded the OLD recurrence rule and were rewritten
to the new one, plus two new fixtures asserting the new definition directly (item G).

## Calibration — every new/changed check on the fresh 41 and on the archive

`archive` = `assets/_archive-pre-reset/shots.pre-reset.json` (214 shots, quarantined, read-only from
the MAIN checkout).

| item | check · severity | fresh 41 | archive 214 |
| --- | --- | --- | --- |
| A | `interaction_cast_check` HARD | 0 (L29 is correct authoring; the defect was forge's routing) | 0 (the archive never used an interaction slug) |
| B | `delta_entrance_check` HARD | **1** — L41, the shot that refused the whole batch | 7 (L56, L98, L117, L137, L154, L181, L184 — all genuine entrances-in-delta) |
| C | `lettering_route_check` HARD | 0 — correct: no `assets` block exists pre-Pass-1; forge derives the route (14/14 verified) | **22** — Pass-1 blocks that tag cast/pose/expression and drop the LOCKED §5 exemplar |
| D | `payload_last_check` HARD | **9** (L04 L21 L26 L31 L34 L35 L36 L37 + none) — matches the adversarial B4 census exactly | 18 |
| E | `real_cadence_check` HEADS-UP | **11 of 40** — L01 1.45s floor · L03 4.00s · L26 4.36s · L31 4.96s ceiling · 7 over band. Byte-identical to the report's B5 table | 78 of 213 (36%) |
| F | `carried_literal_check` backtick fix | removes the `MINISCRIBE`/`` `miniscribe-rep` `` collision; 0 new/0 lost HARDs on either file | unchanged |
| G | `place_groups` recurrence | both places still qualify (`brick-warehouse` 2 runs, `miniscribe-plant` 4 runs) — no fresh-file regression | unchanged (no `place` machinery) |

Whole-file lint on the fresh 41 after the round: **11 HARD** (2 partial-coverage artifacts + 1 B + 8 D
… reported as 9 D lines, of which L26 is the plate) and **12 heads-up** (11 cadence + the pre-existing
L41 long-span). Whole-file `forge.py batch` dry-run: completes the walk with **one** remaining
refusal, L41's entrance — which is G2's re-authoring item, and now also a lint HARD so the next author
never reaches it.

## Per item

### A — interaction-slug routing (forge.py) · TDD, red proved against the pre-change forge
- `_split_primitives` no longer treats `interaction` as a pose. New `_interaction_primitives()`
  collects them SCENE-level across the whole cast recipe.
- `cmd_batch` emits an `interaction` seed role between the figure cards and the place;
  `_SEED_ROLES`, `seed_role_violations` (truthful: kind `interaction`, `character is None`) and
  `seed_roles_text` all carry it. Role prose: "two blank mannequins holding the contact geometry for
  BOTH figures … give it to neither figure's identity, costume or expression."
- New `interaction_violations()` — one refusal per way of breaking the law: solo shot · STEP-1 card ·
  delta beat · named-but-unseeded.
- `figure_card_payload(pose)` is now pose-aware: a pose-free card (the norm for an interaction shot's
  two figures) is told to stand neutral instead of pointing at a pose reference the request lacks.
- Surplus-primitive note no longer reports the template as a dropped primitive.

RED (main checkout's forge, same fixture): `fig-terry-johnson--handshake--expr-delighted` seeding
`[terry-johnson, expr-delighted, handshake]`, consumed by `L29: [fig-ibm-suit--expr-deadpan,
fig-terry-johnson--handshake--expr-delighted]`.
GREEN: two pose-free solo cards + `L29: [fig-ibm-suit--expr-deadpan, fig-terry-johnson--expr-delighted,
handshake, L26]` — 4 seeds, exactly at `SEED_CAP`.

Docs: `visual-grammar.md §2` gains the **2 cast + interaction, fresh** cast-cap row and the law;
`shots-schema.md` gains the interaction-template law; VPW SKILL step 2.3 gains the one-line rule.

### B — delta character-entrance guard
`delta_entrance_check` (HARD) + `delta_parent_of()`, which restates forge's own seeding key ONCE
(`place or stage or id`, parent = the previous shot carrying it — not the previous line, and not "any
earlier shot in the place"). Degrades silently with no cast vocabulary.
Doc sentences: `visual-grammar.md §1` chain logic, `shots-schema.md` (new "Delta character-entrance
law" bullet), VPW SKILL step 2.5.

### C — lettering-exemplar guard
Two halves, at the layers that can each own theirs:
- **forge (the guarantee, DERIVED, no refusal):** `cmd_batch` now derives non-figure seeds from
  PROMPT CONTENT unioned with Pass 1's `assets` tags — the same content-first move `depicts_figures`
  already makes for the rig hold. A prompt carrying a quoted literal (`text_bearing()`) gets
  `lettering-marker-italic` appended; a backticked registry `prop`/`environment` slug is routed even
  with no `assets` block. `assets_omitted` still suppresses. Fresh file: **0/14 → 14/14** text frames
  seeded, and L10's `prop-drive` now resolves instead of shipping as a bare control token.
- **lint (the post-Pass-1 assertion, HARD):** `lettering_route_check` fires when an `assets` block
  EXISTS on a text-bearing shot and omits the exemplar (or omits it via `assets_omitted`). Correctly
  silent on a freshly authored file — `assets` is image-gen-owned and does not exist yet, which is
  exactly the window forge's derivation covers. Not dead info: 22 live hits on the archive.

**Deviation from the brief, stated plainly.** The brief put the guard on lint alone ("a shot whose
prompt carries a quoted literal must declare the lettering asset in `assets`"). A HARD lint on an
image-generation-owned field would fail every VPW file at Step 7, before Pass 1 has written that field
— it would make the lint unrunnable at the moment it is supposed to run. So the LOCKED law is enforced
where it is guaranteeable (forge, derivation) and lint keeps the half it can decide. This matches
DC2's own wording in the adversarial report ("a LOCKED style law must not depend on an author
remembering an `assets` block").

### D — payload-last check
`payload_last_check`, **HARD**. "Final clause" = the prompt's last sentence; a shot passes if ANY of
its payload literals sits there. Two exemptions, both load-bearing and together giving zero false
positives on both files:
- deltas (their final clause is the one change plus the sanctioned closing formula — both files do
  this correctly, 100%);
- a place's owner literal on a NON-plate shot (that is L-1 carry, not this shot's payload; demanding
  it in the payload slot is the same rule-manufactures-content failure the F1 collision produced).
HARD rather than soft is justified by measurement: the same script span of the archive was **7/7**
payload-last, so it is a discipline authors demonstrably hit. `critics.md` question 3 gains a FORCED
ROW for the half lint cannot see (a payload that is not a literal).

### E — real-cadence check
`real_cadence_check`, **HEADS-UP** (per the brief's severity ruling; the adversarial DC7 asked for
HARD). Runs inside `lint_piece` off the same word-timing stream and matcher the HARD anchor check just
used, so it cannot disagree with render. Skips the final shot (no next anchor — its span is the VO
tail, already covered by `LONG_SPAN_WORDS`) and is silent with no manifest.

### F — carry-scan backtick fix
`blank_backticked()` blanks backticked spans to spaces of EQUAL LENGTH (offset-preserving, because the
check reports by index into that same string) before `carried_literal_check` scans. Regression test is
the exact collision (`MINISCRIBE` inside `` `miniscribe-rep` ``), paired with a test proving a genuine
lowercase downgrade still fails.

### G — recurring-set definition
`place_groups` now qualifies a place when its shots form **≥2 non-contiguous runs** (a REVISIT) or its
plate declares `place_owner`. The author's reading, per the brief. Wording aligned in
`shots-schema.md`, VPW SKILL step 3a, and the `place_plate_check` refusal message.

**Divergence flagged for the boss:** this is the OPPOSITE of the adversarial report's DC6/F4, which
argued "any diegetic set drawn by ≥2 shots is a place". Under the brief's rule the 1983 shop (L04–L09,
one unbroken visit) stays a stage and F4's named consequence stands: L08 and L09 still leave the chain
and re-invent the room from text with `seeds=0` / `seeds=[crowd-exemplar]`. That is a REAL unfixed
hole, but it is an authoring defect (L08/L09 should stay in the L04 chain or carry `place_anchor`), not
a definition defect — and it is now G2's, not lint's, because no rule change can both spare
single-visit sets a plate and force them one.

### H / I / J — doctrine text
- **H (`owner_ambiguity`)**: `shots-schema.md` place-owner law + VPW SKILL step 3a — ambiguity is the
  HONEST default where the script establishes no visible branding; reaching for `place_owner` to look
  decisive invents signage, which is fabrication. Kills the "weak option" reading.
- **I (figure bias, Daniel's ruling)**: `visual-grammar.md §1` gains a **Figure bias** bullet —
  concrete presence is the DEFAULT on beats about people; a symbolic/prop-only frame must EARN its
  absence and say so in `notes`; a figureless run past ~10s is a self-audit flag, never a lint failure.
  Mirrored into VPW SKILL step 2.2, step 3c's self-audit (name every >~10s figureless run and what
  earned it), and `critics.md` plan-level (report the longest figureless run in seconds, flagged or
  not).
- **J (plate/reveal seam)**: `visual-grammar.md §2` character-reveal bullet states the resolution — the
  plate is the place's first CAST-FREE frame, the reveal its first CAST-BEARING frame, disclosure order
  decides which comes first, and a naming line carrying both is authored as TWO CUTS. Worked example
  (MiniScribe plant, plate then reveal inside one sentence) in VPW SKILL step 3a.
- **DC8 leftovers**: the suffix one-voice line ("the suffix states the lettering register so your
  prompt never has to") in `visual-grammar.md`'s header block; the place-exempt class trade (F5) in
  `shots-schema.md`'s exempt-classes bullet.

## Not done / stopped on

- **L41 itself is still un-generatable.** Correct: the brief scoped me to the doctrine half. The forge
  refusal is right behavior, and it now has an authoring-side twin (`delta_entrance_check`), so the
  re-author is G2's with a stated legal path.
- **`SEED_CAP` arithmetic (report C6) untouched.** Adding the derived lettering seed raises the seed
  count on text-bearing shots; on the fresh 41 the max is now 3 and the cap never fires. Acts 2–4's
  4-seed shapes (2 cast + crowd + place) will hit 5 the first time one of them draws text, firing the
  crowd-displacement rule on the most complex shots in the video, unrehearsed. Worth a deliberate
  exercise before act 3, as the report says.
- **`Kit.root` in this worktree.** forge resolves repo-relative seeds off an env marker that exists
  only in the primary checkout, so `--kit <worktree kit>` cannot resolve any seed here. Verification
  used `--kit <main checkout kit>` (read-only), the same way the adversarial reviewer did. Pre-existing,
  not introduced by this round.
