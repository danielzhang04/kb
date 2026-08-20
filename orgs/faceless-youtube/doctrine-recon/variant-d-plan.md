# Variant D Implementation Plan
> For agentic workers: execute task-by-task; each task ends with tests + a review gate. Steps use `- [ ]`.
**Goal:** Implement and trial Variant D so its four criterion changes can be judged blind beside va/vb/vc without quotas or hidden targets. **Architecture:** Change each rule at its existing canonical home, keep every speaker and test synchronized, validate an officially scoped A1 fragment, generate parent-first, and extend the existing comparison board. **Spec:** `orgs/faceless-youtube/doctrine-recon/variant-d-spec.md`, rev 4.

## Verdict trace

| Verdict | Resolving step(s) |
| --- | --- |
| F1 | Task 1 steps 1–2, 20, 25 |
| F2 | Task 1 steps 13–15 |
| F3 | Task 1 steps 8 and 19; Task 2 steps 2–6 |
| F4 | Task 2 step 14 |
| F5 | Task 3 steps 9–11; Task 4 steps 2 and 6 |
| F6 | Task 1 steps 3 and 5; Task 2 steps 2–6 |
| F7 | Task 1 steps 12 and 25 |
| F8 | Task 1 steps 21–23 |
| F9 | Task 1 steps 16–17 |
| F10 | Task 1 steps 1–25 (replacement protocol and byte-exact OLD → NEW blocks) |
| F11 | Task 2 step 15 |
| F12 | Task 1 steps 21–23 |
| Forgotten speakers | Task 1 steps 1, 3, 8, 12, 19, and 25 |
| Metadata-only safeguards | Task 2 steps 5–15; Task 3 steps 9–11; Task 4 steps 2 and 6 |

## Global Constraints

- Change existing logic and criteria in place; do not bolt on a parallel implementation.
- Add no doctrine section except the sanctioned `## 2d. CROWD-RIG clause` move in `style-bible.md`, with the suffix section renumbered.
- Delete superseded wording in the same patch; leave no dead text and no "formerly" notes.
- Keep every speaker of a rule consistent, keep files slim, and preserve the schema's canonical ≤3-delta cap.
- Add no quotas, bans, count gates, author-visible distribution targets, or palette recurrence gate.
- Do not grow prompts: review every D prompt against vb shot by shot and replace lower-value prose with drawable light/material field facts, acting-participant facts, or crowd geometry; keep the `Palette basis:` sentence in review-only `notes`.
- Preserve cast promotion and seeding, crowd-rig appearance and Poyais proportion, exemplar seed, style tile, empty `global_prompt_suffix`, Forge seed mechanics, and P3 gates.
- Fragment validation is an invocation-only scope: `lint_shots.py <shots.json> [--write] [--fragment]`; never write fragment metadata into `shots.json`, and under the flag change only the two long-form sizing checks to use the covered script span at the header pace.
- Keep render register, crowd exemplar remint, style-tile A/B, and any three-person seeding promise out of scope.
- Treat metrics and distributions as reviewer evidence only; the blind reviewer applies §3.1–3.4 per shot before reporting them.
- Run scripts for their output only; do not load L3 scripts as text.
- Make no Git mutation while executing this plan-writing task; implementation commits remain task-local and never target `main`.
- For every textual replacement below, copy the fenced `OLD` block exactly (including backticks, indentation, and line wraps) into standard input and run `py -3 -c "from pathlib import Path; import sys; old=sys.stdin.read(); assert old in Path(sys.argv[1]).read_text(encoding='utf-8')"` with the step's literal file path as the sole argument. Expected pre-edit output is empty with exit 0; a failed assertion stops the step. After patching, assert the OLD bytes are absent and NEW bytes present. New-file steps assert the literal destination does not exist. Named verification commands are additional gates, never substitutes for byte assertions.
- In this plan, `V` means `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh`.
- Coverage index: §3.1 → Task 1 steps 6–20; §3.2 → Task 1 steps 5–6, 10, 21–24; §3.3 → Task 1 steps 3–4, 8, 16–17; §3.4 → Task 1 steps 1–4, 19–20; §3.5 → Task 2 steps 14–15; §4 items 1–5 → Task 1 steps 1–27, Task 1 steps 13–15 plus Task 2 steps 9–13, Task 2 steps 1–16, Task 3 steps 1–13, and Task 4 steps 1–10 respectively.

### Task 1 — Doctrine build and fragment-lint infrastructure

**Files:**

- Modify `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/SKILL.md:125-164,224-238`.
- Modify `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/references/shots-schema.md:20-30,131-149,170,179,301-302,345-350,366,370-395`.
- Modify `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/references/critics.md:29-56`.
- Create `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/references/delta-materiality-calibration.json`.
- Modify `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts/lint_shots.py:24-37,121-215,249-253,653-746,1223-1379`.
- Test `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts/test_shots_v2.py`, `test_new_guards.py`, `test_stage_check.py`, `test_lettering_fidelity.py`, and `test_doctrine_reset_guards.py`.
- Modify `orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md:89-103,180-220` and `visual-grammar.md:112-147`.
- Modify `orgs/faceless-youtube/knowledge/research/niche-playbooks/universal.md:1351-1364`.
- Modify `orgs/faceless-youtube/.claude/skills/motion-planner/references/animation-rules.md:12-24,35-42`.
- Modify `orgs/faceless-youtube/.claude/skills/motion-planner/SKILL.md:20-24`; read and preserve the compatible critic rule in `references/critics.md:27-29`.
- Modify `orgs/faceless-youtube/.claude/skills/render-builder/references/shots-motion-schema.md:7-11,27-33`.
- Modify `orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md:181-183,196-200,223-251`.
- Create `orgs/faceless-youtube/.claude/skills/image-generation/scripts/palette_metrics.py` as the single owned HSV implementation.
- Modify `orgs/faceless-youtube/.claude/skills/image-generation/scripts/build_review_artifact.py:1-10,214-271,296-411`.
- Modify `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-audit/vd_palette_metrics.py:9-99` to delete its HSV implementation and normally import the owned `image-generation/scripts/palette_metrics.py` implementation.
- Test `orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_figures.py`, `test_forge_place_and_gates.py:511-516`, `test_forge_style_tile.py:239-245`, `test_build_review_artifact.py`, and `test_pass1_gate_doc_consistency.py`.
- Do not modify `orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py`; its live loader and `figures_expansion` path already work once the blockquote is moved.

**Interfaces:**

- Task 2 relies on the normal lint CLI accepting `--fragment`, writing no scope metadata to JSON, clipping the long-form script stream at the end of the last matched anchor, sizing against that covered span at the header pace, and preserving `--write`'s existing all-HARD gate.
- Task 2 relies on the concrete review-only form `Palette basis: cobalt field — high-skylight daylight crosses walnut shelves and a brass rail.` in every stage base's `notes`, while drawable light/material facts replace lower-value words in that base's provider-visible `still_prompt`; storing the basis only in `notes` fails the gate.
- Task 3 relies on Forge appending the canonical crowd block from the bible whenever `figures.crowd` is true and continuing to refuse a crowd request without an approved crowd-exemplar seed.
- Task 3 relies on authoring deciding stage membership and generation deciding parent routing and integrative regeneration; motion planning alone decides discrete layer realization.
- Task 4 relies on review-artifact cards exposing `still_prompt`, effective stage id, inherited base palette basis, manifest reason, warm/cool share, and 15°–45° orange plus 165°–240° cool complementary-pair share as separate advisory fields.
- Steps 1–25 are the complete old→new matrix grouped in owner-file order; every changed row names its exact replacement or deletion and the asserting test, while compatible grep hits are explicitly marked `KEEP`.

1. - [ ] **Move the canonical CROWD-RIG bytes without changing Forge.** In `visual-grammar.md`, delete the heading `## 2d. CROWD-RIG clause (verbatim — write INTO a crowd scene's prompt)` and move this exact blockquote, byte for byte, beneath a new `## 2d. CROWD-RIG clause` heading immediately after the existing bible `## 2c. RIG-HOLD descriptor` block:

   ```md
   > The background / crowd figures are on the CROWD RIG: round cream-family heads, DOT EYES, one simple
   > consistent mouth (neutral / smile / downturn only), NO noses, NO ears, NO teeth, the **same squat
   > head-to-body proportion as the crowd exemplar seed** — a large round head on a short compact body, NOT
   > taller/lanky — in varied era-appropriate clothing. Keep every crowd figure on this same simplified rig —
   > do not give them individual detailed faces.
   ```

   Replace the RIG-HOLD/suffix block exactly; this also closes the forgotten `style-bible.md:96-97` speaker by pointing to §2d instead of restating crowd-face details.

   OLD:

   ```md
   > Every FOREGROUND / named / seeded cartoon figure in this image keeps the shared FAMILY RIG exactly as
   > the reference(s): SAME round near-circle head (only slightly taller than wide, NOT an egg/oval), SAME
   > eye style/size/position, NO nose, NO ears, SAME classic cartoon hands — exactly THREE fingers plus ONE
   > thumb (four digits total, Mickey / Simpsons style, NEVER four fingers, NEVER five digits), SAME even
   > medium-thick dark warm brown-black (#241a12) outline, SAME clean FLAT cel render. Anonymous background /
   > crowd figures instead follow the §2d CROWD-RIG clause when the prompt states it (simplified: dot eyes,
   > one simple mouth) — do NOT force this full rig onto them. Hold ONLY this form — costume, pose,
   > expression, head tone, build, and framing are set by the generation delta, not here.

   ## 2d. Canonical dispatch suffix
   ```

   NEW:

   ```md
   > Every FOREGROUND / named / seeded cartoon figure in this image keeps the shared FAMILY RIG exactly as
   > the reference(s): SAME round near-circle head (only slightly taller than wide, NOT an egg/oval), SAME
   > eye style/size/position, NO nose, NO ears, SAME classic cartoon hands — exactly THREE fingers plus ONE
   > thumb (four digits total, Mickey / Simpsons style, NEVER four fingers, NEVER five digits), SAME even
   > medium-thick dark warm brown-black (#241a12) outline, SAME clean FLAT cel render. Anonymous background /
   > crowd figures instead follow the §2d CROWD-RIG clause that Forge appends when `figures.crowd` is true —
   > do NOT force this full rig onto them. Hold ONLY this form — costume, pose, expression, head tone, build,
   > and framing are set by the generation delta, not here.

   ## 2d. CROWD-RIG clause

   > The background / crowd figures are on the CROWD RIG: round cream-family heads, DOT EYES, one simple
   > consistent mouth (neutral / smile / downturn only), NO noses, NO ears, NO teeth, the **same squat
   > head-to-body proportion as the crowd exemplar seed** — a large round head on a short compact body, NOT
   > taller/lanky — in varied era-appropriate clothing. Keep every crowd figure on this same simplified rig —
   > do not give them individual detailed faces.

   ## 2e. Canonical dispatch suffix
   ```

   The pre-edit assertion targets the whole OLD block above. Delete the original grammar heading plus blockquote in the same patch. `forge.py::blockquote_after` then makes `Kit.desc_crowdrig` non-empty; keep `forge.py:188` unchanged. Command: run `py -3 -m pytest test_forge_figures.py test_forge_style_tile.py -q` from the image-generation scripts directory. Expected: both moved-byte and suffix-heading tests pass.

2. - [ ] **Replace the stale crowd-authorship explanation in `visual-grammar.md` in place.** Delete lines 120–145 beginning `The crowd rig differs from the full rig ONLY in the FACE` and ending `Every depicted crowd figure must satisfy both conditions`, including `§2d is authored by VPW`, `it is not auto-appended`, `The §2d words above stay in the still_prompt`, `supersedes`, and `prompt-authored (§2d) AND exemplar-seeded`. Replace them with this compact text before the occupancy paragraph:

   ```md
   **Anonymous crowd execution.** The crowd rig differs from the full rig only in the face; its squat
   head-to-body proportion matches the approved crowd exemplar. VPW declares `figures.crowd: true` and
   authors only the crowd's scene geometry, action, and era-specific dress. Forge appends the canonical
   style-bible §2d block and seeds `refs/base/crowd-exemplar.png`; named foreground cast still receive the
   full §2c rig. Review every depicted crowd figure against that exemplar.
   ```

   Do not change `_CONTROL_LEAK` or make `CROWD RIG:` a HARD. Replace the old test with an authored-input absence test that loads every `still_prompt`/`gen_prompt` in the test fixtures and asserts that the moved blockquote and `CROWD RIG:` occur nowhere; this is fixture coverage, not production lexical lint. The Forge assembly-byte test in step 20 proves the same bytes return only at assembly. Command: run `py -3 -m pytest test_lettering_fidelity.py test_forge_figures.py -q`. Expected: the authored-fixture absence test and live assembly-byte test both pass, with no new `control_leak_check` pattern.

3. - [ ] **Replace the single story-bearer sentence with the positive occupancy and crowd criterion.** Replace exact old text `**Story bearer.** Every story-bearing individual is seeded named cast. Only a genuine rearward mass beat uses the simplified crowd rig.` with:

   ```md
   **Occupancy follows who acts in the sentence.** The performer whose decision, action or reaction makes
   it true is seeded cast; a pair is seeded when an exchange, relationship or shared labour is what the
   sentence shows; a beat whose subject is a thing, a quantity, a place or an absence carries no performer;
   a beat whose subject is the mass uses the simplified crowd rig. Three ordinary
   pair tableaux are a clerk and customer exchanging a box, two workers at one bench, and a manager with
   an auditor over one ledger. Figures stay small, mid/rear, in a structured world. a crowd is written in
   the primary scene clause as a bounded group held beyond something the scene already has — a pane, rails,
   a doorway, a pavement, a far bank — with the near zone empty, so the geometry sets its count and scale.
   ```

   This is the single positive crowd criterion: add no negative co-planar ban, body-count/height threshold, lexical boundary-noun gate, or separate crowd when/when-not section. Test: the occupancy assertions in `test_doctrine_reset_guards.py::test_variant_d_doctrine_owners_are_consistent` prove the paragraph exists in grammar, `Story bearer.` is absent, and no duplicate normative wording exists in VPW/IG.
   KEEP `visual-grammar.md:59-66`'s expression-delta example as one valid state-change example; it does not define stage eligibility. The same doctrine-owner test asserts it remains present and is subordinate to the schema pointer.

4. - [ ] **Integrate occupancy into canonical question 3 without deleting any of the six questions.** In `style-bible.md`, make this exact question-3-only OLD → NEW replacement.

   OLD:

   ```md
   > 3. **Casting.** Is every story-named or story-referenced figure cast from the registry — including
   >    inside diegetic media (a brochure figure, a portrait, a poster who IS a named character)? Does
   >    every role read at a glance (a king reads as a king)? Is any named figure in the wrong
   >    canonical outfit without the shot authoring the change?
   ```

   NEW:

   ```md
   > 3. **Casting.** Who acts in this sentence — would removing every visible person hide that causal
   >    subject? Is every story-named or story-referenced figure cast from the registry — including
   >    inside diegetic media (a brochure figure, a portrait, a poster who IS a named character)? Does
   >    every role read at a glance (a king reads as a king)? Is any named figure in the wrong canonical
   >    outfit without the shot authoring the change? Where a crowd is depicted, is its narrated subject
   >    genuinely the mass, and does the scene geometry hold it beyond something with the near zone empty?
   ```

   Leave question 5 `Staging interest` byte-identical and keep exactly six numbered questions; add no seventh question. `critics.md:47-50` remains the sole pointer and receives no duplicated question text. Test: the bible assertions in `test_doctrine_reset_guards.py::test_variant_d_doctrine_owners_are_consistent` prove `1..6`, the registry/role/outfit clauses, the new causal-subject/crowd clauses, and the unchanged `Staging interest` text.

5. - [ ] **Replace the bible's free-palette wording with per-stage commitment.** Replace exact old text:

   ```md
   **Locked to the character; NOT locked globally.** Scene/background/prop palettes move freely per video
   (a warzone is grey, a bank is teal, a park is green). Only the character's own colours are fixed:
   ```

   with:

   ```md
   **Character colours are locked; every stage's world palette is committed.** Each stage commits a
   dominant field derived from its light source and dominant material; its supporting colours come from
   the same facts; complements are valid when those facts create them; a palette turn changes the dominant
   field, not the names of the same pair. Colour with no physical or story cause is not written. Only
   the character's own colours are fixed:
   ```

   No hue family is banned and no recurrence/count target is added. Test: the bible assertions in `test_doctrine_reset_guards.py::test_variant_d_doctrine_owners_are_consistent`, `test_build_review_artifact.py::test_palette_card_uses_165_to_240_cool_pair_without_gating`, and the doctrine echo sweep in step 25.

6. - [ ] **Rewrite the VPW decision order and stage timing at the existing Step 3 home.** Make three exact, byte-asserted multiline replacements.

   OLD:

   ```md
   - **Expand each `[B-ROLL]` cue** into a full shot: run **Step 2.5** on its VO line (classify → cast →
     stage the tableau → state the facts), then write the `still_prompt`. Set
   ```

   NEW:

   ```md
   - **Expand each `[B-ROLL]` cue** into a full shot: decide subject → acting participants → occupancy →
     shot class → cast tokens → tableau → drawable facts, then write the `still_prompt`. Set
   ```

   OLD:

   ```md
   short shot too** (classify → cast → tableau → facts → intent note) — shorts are the densest,
   ```

   NEW:

   ```md
   short shot too** (subject → acting participants → occupancy → shot class → cast tokens → tableau →
   drawable facts → intent note) — shorts are the densest,
   ```

   Replace this complete physical line:

   ```md
   **Partitioning machinery.** Author disjoint contiguous act partitions. Keep every planned stage and its whole chain inside one partition, never split across two; a coordinator merges partitions in narration order, then runs one whole-file lint and one independent critic pass.
   ```

   with:

   ```md
   **Partitioning and stage decision.** Lock only contiguous act partitions plus cast and place
   boundaries before authoring; do not predeclare a closed stage list. Author the shots first, then apply
   the schema's hold-camera criterion to consecutive beats. Keep each resulting stage wholly inside one
   partition. For every resulting stage, record `field + basis` in the plan lock, put a `Palette basis:`
   sentence in the base shot's existing `notes`, and replace lower-value base-prompt words with the
   drawable light/material facts that realize that field. A standalone shot is its own stage; a same-place
   re-base starts a distinct stage. The coordinator merges partitions in narration order, then runs one
   official lint and one independent critic pass.
   ```

   Replace the exact line-wrapped Step 3 and Step 7 sentences containing `confirm a progressive in-shot reveal` with the same sentences containing `confirm a story-needed held state change or a non-empty hold_reason`; assert each full physical block first. Command: run the VPW doctrine-owner test. Expected: decision order, post-authoring stages, provider-visible palette facts, and both held-state speakers pass.

7. - [ ] **Replace the canonical chain paragraph in `shots-schema.md:370-395`.** Preserve line 366 exactly. Replace the old paragraph beginning `Stage the run — held evolving stages` with:

   ```md
   - **Stage the run after the shots exist — hold only what can honestly hold.** Chain consecutive beats
     when the camera/set and primary subject can hold and the next beat makes exactly ONE visually
     distinct, story-needed state change. Give the run one `stage` id, mark the first shot
     `stage_role: "base"`, mark later members `"delta"`, and put that one change in the delta's
     `changed_elements`. Hard-cut when vantage, setting, primary subject, or register must change. A shop
     counter may hold while one newly unpacked PC appears on the next narrated beat; a hero-object hard
     drive followed by a relational computer–drive diagram changes the visual argument and is a hard cut.
     Reveal and enumeration are examples, not eligibility rules. Each change anchors to its own verbatim
     `vo_ref`; two narrated changes require two shots, never one bundled delta. Cap a chain at ≤3 deltas,
     then re-base or hard-cut. Deltas run 1.5–3s; bases/holds run 4–12s. Author only the stage and change
     intent: downstream realization decides whether an integrative change regenerates from the parent or
     a discrete, seedable change becomes a layer. Every member remains a full shot with its own `vo_ref`;
     a shot without a shared stage is a standalone hard cut.
   ```

   Test: update `test_stage_check.py` comments to say `camera/set/primary subject can hold`, retain the existing base + 3 pass/base + 4 fail assertions, and put the schema assertions in `test_doctrine_reset_guards.py::test_variant_d_doctrine_owners_are_consistent`.

8. - [ ] **Align every pair/cast speaker to Forge's prompt-token transport.** Keep the chain paragraph replacement, then make these four byte-asserted OLD → NEW replacements in one consistency patch.

   `shots-schema.md:170` OLD is the complete single physical line beginning:

   ```md
   - **`cast` + `pose_ref`/`expression_ref` — the figure's pose/expression come from SEEDED library assets, not the `still_prompt`.** VPW records each prominent figure's registry pose/expression (INTENT); `image-generation` seeds them **directly into the one scene generation** — the character canonical + expression frame + pose frame (+ any interaction template) all seed a single run (no separate pre-merge pass; Pass 1b retired). **The `still_prompt` therefore describes the scene + the figure's placement/action ONLY — never its hand/finger mechanics, body-pose mechanics, or facial expression** (those are the `pose_ref`/`expression_ref` assets' job; authoring them in prose too is the double-authoring trap). `pose_ref`/`expression_ref` are each optional (pose-only / expr-only / both / neither). `cast` is how image-gen enumerates a shot's figures — it replaces prose figure-parsing. Seed doctrine: `style-bible.md §5`. A `cast` entry may name an individual character OR a **recurring identifiable group** (a band/troupe whose canonical is a group frame — typically no `pose_ref`/`expression_ref`); image-gen locks it once and seeds it into each appearance. An anonymous crowd stays prose in the `still_prompt`, never cast.
   ```

   NEW:

   ```md
   - **Backticked prompt tokens are executable cast transport; `cast` is descriptive metadata.** Forge
     derives seeded characters from character tokens in `still_prompt`, in token order. An ordinary pair
     names two approved backticked character tokens in that prompt. A contact pair names the left character,
     then the right character, then one registered backticked interaction token (`handoff`, `handshake`, or
     `fistbump`); `shot_cast` binds the primitive in that order. The optional legacy `cast` array may describe
     the same intent for review, but Forge never reads it and it cannot make an un-tokened figure render.
     Unresolved character or interaction tokens emit `needed_assets` and stop at the existing human gate.
   ```

   `shots-schema.md:179` OLD:

   ```md
   - **`needed_assets` — surface-then-gate.** When a shot needs a pose/expression/interaction the registry lacks, VPW adds an entry (`kind` + `slug` + **`wants`** = what to draw + `why`) and **HARD-STOPS** (does not proceed to generation). The human approves+generates on the base, or vetoes → VPW restages that beat onto EXISTING assets only. **Interactions are just `kind: interaction`** — same path, no special-casing; the `wants` description is what makes the request actionable.
   ```

   NEW:

   ```md
   - **`needed_assets` — surface-then-gate.** When a shot needs a character or interaction token the
     registry lacks, VPW records `kind` + `slug` + `wants` + `why` and **HARD-STOPS**. The human approves
     and registers it, or vetoes and VPW restages onto existing assets. A contact pair must name two
     approved backticked characters followed by one approved backticked `handoff`, `handshake`, or
     `fistbump` token in `still_prompt`; descriptive `cast` metadata cannot satisfy this transport.
   ```

   `visual-grammar.md:100-110` OLD:

   ```md
   5. **Stage the tableau + act it — by SELECTING library assets, not describing them.** Mirror step 4's
      casting: for each prominent figure, choose its **`pose_ref`** (the held body pose/gesture that carries the
      action's meaning) and/or **`expression_ref`** (the face for this beat/register) **from the registry
      vocabulary**, and record them on the shot's `cast` entry. These are SEEDED by `image-generation` (style-bible §5
      one-run multi-seed) — so the pose/hands and the expression are the assets' job, **not** the `still_prompt`'s.
      Scene-first ordering: the shot's meaning/scene drives which pose/expression fits, never the reverse.
      `pose_ref`/`expression_ref` are each optional (a plain standing figure needs neither). A two-figure
      interaction (a clasp) uses an **interaction** asset — the same kind of `pose_ref`, just one that shows two
      figures — referenced by BOTH figures' `cast` entries. **The shot's `cast` ORDER binds the slots: the first
      entry is the left figure, the second is the right** (image-gen seeds two identities into the template by
      that order). If the registry lacks the interaction, surface it (below) as `kind: interaction`, no special path.
   ```

   NEW:

   ```md
   5. **Stage the tableau + act it through executable prompt tokens.** Forge derives seeded cast from
      backticked character tokens in `still_prompt`; the optional `cast` array is descriptive review metadata
      and is never engine-read. Name an ordinary pair left-to-right as two approved character tokens. For
      physical contact, name the left character, then the right character, then one approved interaction token
      (`handoff`, `handshake`, or `fistbump`); that is the binding order consumed by `shot_cast`. If any token
      is unavailable, emit `needed_assets` and stop at the existing human gate.
   ```

   In `test_shots_v2.py`, replace this exact OLD docstring block:

   ```py
   v2 drops the v1 authoring/review metadata (`from_cue`, `beat`, `narration_type`,
   `cast`, `props`, `needed_assets`, `house_style`, `shot_counts`,
   `timing_status`). None of it was ever engine-read, so the rule that matters is:
   ```

   with:

   ```py
   v2 drops the v1 authoring/review metadata (`from_cue`, `beat`, `narration_type`,
   `cast`, `props`, `needed_assets`, `house_style`, `shot_counts`,
   `timing_status`). Forge derives seeded cast from backticked `still_prompt` tokens;
   the legacy `cast` array is descriptive metadata only. The compatibility rule is:
   ```

   In `image-generation/SKILL.md:215-221`, replace:

   OLD:

   ```md
   **Figure index — the shot's `cast` names its figures.** Before generating shot `S`, read its `cast`: for
   each figure, **seed its frames** — canonical + `pose_ref`/`expression_ref` (a `cast` entry with neither ref
   → the plain canonical). Seed via technique (a) only if an on-disk frame already IS that shot full-frame,
   else as a placed figure via (b)/(d); never fresh-draw a figure that has a canonical — the seeded canonical
   is what holds identity + the library hand across shots. (`cast` is authoritative; the library manifest maps
   each character to its canonical, the registry maps each `pose_ref`/`expression_ref` tag to its frame.
   Environments/props aren't figures — they're composed per shot from the `still_prompt`.)
   ```

   NEW:

   ```md
   **Figure index — Forge derives cast from backticked prompt tokens.** `shot_cast` consumes `still_prompt`
   tokens left-to-right: each approved character token adds that seeded canonical, and a following registered
   pose/expression/interaction token attaches to the latest character. An ordinary pair names two character
   tokens; a contact pair orders left character → right character → `handoff`/`handshake`/`fistbump`. The
   optional legacy `cast` array is descriptive metadata only and is never engine-read. Never fresh-draw a
   figure with a canonical; unresolved tokens stop at the existing asset gate.
   ```

   Pre-edit assertions target each entire OLD block. Command: run `py -3 -m pytest test_shots_v2.py test_new_guards.py test_pass1_gate_doc_consistency.py -q`. Expected: pair-order coverage proves both character canonicals plus the interaction seed; no speaker claims `cast` drives Forge.

9. - [ ] **Remove the remaining schema claims that VPW should carry generated rig prose, without adding fragment metadata.** Replace lines 300–302 ending `figures on the CROWD RIG (round cream heads, DOT EYES, NO noses/ears/teeth) is legal and common` with `Concrete depicted-body facts are legal, but canonical rig blocks are Forge-owned and never copied into still_prompt.` Replace line 350's `real progressive reveal` with `story-needed held state change`. Leave the top-level JSON example and field-list prose unchanged: rev 4 declares fragment scope only through the lint CLI, so `fragment_scope`, `start_anchor`, and `end_anchor_exclusive` must not appear in the schema, an example, or a generated `shots.json`. Test: step 15 asserts the vb input remains byte-semantically free of fragment metadata before and after `--fragment --write`.

10. - [ ] **Make the critic symmetric and point it at calibration evidence.** Assert and replace this exact physical OLD line, including live backticks:

   ```md
   > Apply the canonical six shot questions in the channel `style-bible.md` review-criteria section and the canonical plan-level chain/disclosure contract in `references/shots-schema.md`.
   ```

   NEW:

   ```md
   > Apply the canonical six shot questions in the channel `style-bible.md` review-criteria section and
   > the canonical plan-level chain/disclosure contract in `references/shots-schema.md`. For every
   > adjacent beat, ask both directions: could camera, set, and primary subject honestly hold
   > (a missed hold), and does every authored delta visibly advance a story-needed state (a forced hold or
   > no-op)? Hard-cut when vantage, setting, primary subject, or register must change. Report findings, not
   > hold totals. Calibrate forced-hold/no-op judgment against
   > `references/delta-materiality-calibration.json`: 26 human-labelled fresh cases used to learn the
   > distinction, never as a lexical checklist, lint oracle, or target count.
   > At plan level, flag a dominant palette axis repeated across distinct stages when the bases give no
   > physical/story basis; holds are exempt, complements remain legal, and palette codes are not policed.
   ```

   Test: the critic assertions in `test_doctrine_reset_guards.py::test_variant_d_doctrine_owners_are_consistent`.

11. - [ ] **Create the critic calibration fixture from the pinned historical source, not current branch data.** Add `references/delta-materiality-calibration.json` with top-level keys `source_commit`, `source_path`, `decision_owner`, and `cases`. Set the first three values exactly to `f1c3b1aa`, `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`, and `fresh-eyes critic (semantic judgment; lint remains lexical)`. Populate `cases` in this exact id order: `L02,L15,L37,L51,L70,L72,L76,L103,L110,L111,L119,L123,L136,L144,L146,L162,L169,L175,L184,L186,L206,L209,L218,L229,L242,L243`. For each case copy only `id`, `stage`, `stage_role`, `vo_ref`, `changed_elements`, and `still_prompt` verbatim from `git show f1c3b1aa:orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`; do not copy the audit's paraphrase. Use `git show` to print the source, select those ids in memory, assign the exact envelope to a `payload` object, and add deterministic `json.dumps(payload, ensure_ascii=False, indent=2)` output with `apply_patch`. Test: load the fixture, assert the six exact keys per case, 26 unique ids in the order above, source commit/path bytes, and that current `_NON_MATERIAL_DELTA` is not asserted to classify them.

12. - [ ] **Align every lint held-state speaker without expanding lexical authority.** For each live multiline Python/f-string block, use its exact physical wraps as OLD and assert it before replacement. Replace: `progressive reveal or non-empty hold_reason` → `story-needed held state change or non-empty hold_reason`; `a chain exists only for a progressive reveal` → `stage membership is authored by the schema's hold-camera criterion; lint enforces structure only`; `author a genuine progressive reveal or hard cut` → `author one visually distinct, story-needed state change or hard-cut`; the split lines `when the contact begins a genuine progressive reveal, stage the` / `fresh two-figure shot as its BASE.` → `when contact begins a story-needed held state change, stage the` / `fresh two-figure shot as its BASE.`; and the forgotten SOFT block:

   OLD:

   ```py
   soft.append(f"[{label}] {sh['id']}: covers ~{wc} words on one anchor "
               f"(>~8s VO) — ensure a progressive within-shot reveal, or densify (add a cut).")
   ```

   NEW:

   ```py
   soft.append(f"[{label}] {sh['id']}: covers ~{wc} words on one anchor "
               f"(>~8s VO) — ensure a story-needed held state change or non-empty "
               f"hold_reason, or densify (add a cut).")
   ```

   Preserve `_NON_MATERIAL_DELTA` and the accurate §2d metadata comments. Command: run material/no-op, long-span, interaction, and fixture non-oracle tests. Expected: all pass and none of the 26 calibration ids/phrases becomes a lint oracle.

13. - [ ] **Add `--fragment` to `main` and pass it only to long-form lint.** In the module docstring replace `python lint_shots.py <path-to/shots.json> [--write]` with `python lint_shots.py <path-to/shots.json> [--write] [--fragment]` and add `--fragment sizes long-form against the covered script prefix; it never writes scope metadata.` Replace the current help/argv block at `lint_shots.py:1228-1233` with:

   ```py
   if not argv or argv[0] in ("-h", "--help"):
       print("usage: python lint_shots.py <path-to/shots.json> [--write] [--fragment]")
       return 2
   path = argv[0]
   flags = set(argv[1:])
   unknown = flags - {"--write", "--fragment"}
   if unknown:
       print(f"HARD: unknown option(s): {', '.join(sorted(unknown))}")
       return 2
   do_write = "--write" in flags
   fragment = "--fragment" in flags
   data = json.loads(Path(path).read_text(encoding="utf-8"))
   ```

   Add `fragment=fragment` after `new_plan=strict_schema` in the exact two-line long-form call; leave Shorts on the signature's `fragment=False` default and thumbnails untouched. Do not append the empty-list HARD in `main`: `lint_piece` owns every fragment precondition before its current no-stream SOFT return. No field is read from or written to JSON. Pre-edit assertion: assert the exact help/argv OLD block and exact long-form call before patching. Command: `py -3 -m pytest test_shots_v2.py -k fragment -q`. Expected: all eight fragment cases in step 15 pass.

14. - [ ] **Validate fragment scope before the no-stream return, then size/tile only valid scope.** Replace the exact `lint_piece` prefix from its signature through the current no-stream return with the block below. This is one byte-asserted multiline replacement; it distinguishes empty long form, absent script, empty/unparseable script, and later unmatched anchors before any sizing/tiling work.

   OLD:

   ```py
   def lint_piece(label, shots, md_path, hard, soft, word_timings=None, new_plan=True):
       """Validate one piece against the REAL VO stream. S3: the HARD check runs against the
       voiceover.manifest word_timings when present (the exact stream + matcher render times
       against); script.md is a soft cross-check AND the source of the derived vo_text spans.
       Returns id2text (for --write) or None."""
       md_exists = Path(md_path).exists()
       vo, md_toks = (None, None)
       if md_exists:
           vo, md_toks = build_vo_stream(md_path)

       if word_timings:
           vtoks = [(_NORM(w), k) for k, (w, _t) in enumerate(word_timings)]
           vtoks = [(w, k) for w, k in vtoks if w]
           hard_matches = match_shots_to_tokens(shots, vtoks)
           hard_stream = "the voiceover word-stream"
           vo_words = len(vtoks)
       elif md_toks:
           hard_matches = match_shots_to_tokens(shots, md_toks)
           hard_stream = "script.md"
           vo_words = len(md_toks)
       else:
           soft.append(f"[{label}] no VO stream (no manifest timings, no parseable {md_path}) — skipped.")
           return None
   ```

   NEW:

   ```py
   def lint_piece(label, shots, md_path, hard, soft, word_timings=None, new_plan=True,
                  fragment=False):
       """Validate one piece against the REAL VO stream. S3: the HARD check runs against the
       voiceover.manifest word_timings when present (the exact stream + matcher render times
       against); script.md is a soft cross-check AND the source of the derived vo_text spans.
       Returns id2text (for --write) or None."""
       md_exists = Path(md_path).exists()
       vo, md_toks = (None, None)
       if md_exists:
           vo, md_toks = build_vo_stream(md_path)

       if fragment and not shots:
           hard.append(f"[{label}] --fragment requires at least one long_form.shots record.")
           return None
       if fragment and not md_exists:
           hard.append(f"[{label}] --fragment requires script.md; file is absent: {md_path}.")
           return None
       if fragment and not md_toks:
           hard.append(f"[{label}] --fragment requires a non-empty parseable script.md.")
           return None

       if word_timings:
           vtoks = [(_NORM(w), k) for k, (w, _t) in enumerate(word_timings)]
           vtoks = [(w, k) for w, k in vtoks if w]
           hard_matches = match_shots_to_tokens(shots, vtoks)
           hard_stream = "the voiceover word-stream"
           vo_words = len(vtoks)
       elif md_toks:
           hard_matches = match_shots_to_tokens(shots, md_toks)
           hard_stream = "script.md"
           vo_words = len(md_toks)
       else:
           soft.append(f"[{label}] no VO stream (no manifest timings, no parseable {md_path}) — skipped.")
           return None
   ```

   After the normal anchor loop, replace the sizing/tiling region from `if vo_words:` through the live `id2text = tile(shots, md_matches, len(vo), vo)` line as one exact multiline OLD → NEW block copied from the live file. The NEW block must implement this code shape:

   ```py
   md_matches = match_shots_to_tokens(shots, md_toks)
   covered_vo, covered_words = vo, None
   runtime_s, rate = None, None
   if fragment:
       last = md_matches[-1]
       if not last["needle"] or last["start"] is None:
           hard.append(f"[{label}] --fragment cannot resolve the last shot anchor in script.md.")
           return None
       last_i = next(i for i, tok in enumerate(md_toks) if tok[1] == last["start"])
       covered_end_i = last_i + len(last["needle"])
       covered_end = md_toks[covered_end_i][1] if covered_end_i < len(md_toks) else len(vo)
       covered_vo = vo[:covered_end].rstrip()
       covered_words = sum(tok[1] < covered_end for tok in md_toks)
       header_wpm = header_pace(md_path)[0]
       wpm = header_wpm or DEFAULT_WPM
       runtime_s = covered_words / wpm * 60.0
       fallback = "the fallback — the header states no rate" if header_wpm is None else "per the header"
       rate = f"{covered_words} covered script words / {wpm:.0f}wpm, {fallback}"
       soft.append(f"fragment scope: covered {covered_words}/{len(md_toks)} script words")
   ```

   The NEW block then executes the existing two sizing comparisons only under `if runtime_s is not None:`; the whole-file `wpm` → stated-runtime → `DEFAULT_WPM` branch remains byte-identical under `if not fragment:`. It calls `tile(shots, md_matches, len(covered_vo), covered_vo)` only after all matches are valid. Thus `covered_words=None` is never divided or formatted, invalid scope cannot size/tile, header-without-WPM uses `DEFAULT_WPM`, and `--write` still skips on any HARD. Command: run the eight tests in step 15. Expected: invalid cases return 1 without traceback or `WROTE`; valid vb prints `covered 293/1628` and returns 0.

15. - [ ] **Add eight focused rev-4 fragment tests to `test_shots_v2.py`.** Add imports `subprocess` and `copy`, then add the exact helpers below after the existing imports; pre-assert the live import block before replacement.

   ```py
   VB_COMMIT = "17becaaf"
   VB_ROOT = "orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh"

   def _git_text(path):
       return subprocess.check_output(
           ["git", "show", f"{VB_COMMIT}:{VB_ROOT}/{path}"],
           text=True,
           encoding="utf-8",
       )

   def _vb_data():
       return json.loads(_git_text("shots.json"))

   def _run_vb_fragment(tmp_path, monkeypatch, *flags, data=None, script_text=None,
                        omit_script=False):
       tmp_path.mkdir(parents=True, exist_ok=True)
       payload = copy.deepcopy(data if data is not None else _vb_data())
       repo = Path(subprocess.check_output(
           ["git", "rev-parse", "--show-toplevel"], text=True, encoding="utf-8"
       ).strip())
       real_vdir = repo / VB_ROOT
       chars = lint_shots.video_chars(payload, real_vdir)
       interactions = lint_shots.video_interactions(payload, real_vdir)
       tokens = lint_shots.video_token_catalog(payload, real_vdir)
       canonical_suffix = lint_shots.channel_suffix(real_vdir)
       monkeypatch.setattr(lint_shots, "video_chars", lambda *_: chars)
       monkeypatch.setattr(lint_shots, "video_interactions", lambda *_: interactions)
       monkeypatch.setattr(lint_shots, "video_token_catalog", lambda *_: tokens)
       monkeypatch.setattr(lint_shots, "channel_suffix", lambda *_: canonical_suffix)
       if not omit_script:
           source = _git_text("script.md") if script_text is None else script_text
           (tmp_path / "script.md").write_text(source, encoding="utf-8")
       path = tmp_path / "shots.json"
       path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
       return lint_shots.main([str(path), *flags]), path
   ```

   Keep the six cases below, and add these two exact control-flow cases (the absent-script helper deletes `script.md` after `_run_vb_fragment` setup through a helper flag; the no-WPM helper removes only the header WPM text):

   ```py
   def test_fragment_absent_script_is_hard_and_skips_sizing_tiling_and_write(tmp_path, monkeypatch, capsys):
       rc, _ = _run_vb_fragment(tmp_path, monkeypatch, "--write", "--fragment", omit_script=True)
       out = capsys.readouterr().out
       assert rc == 1
       assert "--fragment requires script.md; file is absent" in out
       assert "Sum of duration_s" not in out and "shots for a ~" not in out
       assert "WROTE derived vo_text" not in out

   def test_fragment_header_without_wpm_uses_default_wpm(tmp_path, monkeypatch, capsys):
       script = _git_text("script.md").replace("1,632 words ÷ 175 wpm", "1,632 words")
       rc, _ = _run_vb_fragment(tmp_path, monkeypatch, "--fragment", script_text=script)
       out = capsys.readouterr().out
       assert rc == 1
       assert f"{lint_shots.DEFAULT_WPM:.0f}wpm, the fallback — the header states no rate" in out
       assert "requires a positive header WPM" not in out
   ```

   The eight collected cases and exact expectations are:

   ```py
   def test_vb_45_without_fragment_has_exactly_two_sizing_hards(tmp_path, monkeypatch, capsys):
       rc, _ = _run_vb_fragment(tmp_path, monkeypatch)
       out = capsys.readouterr().out
       assert rc == 1
       assert "HARD violations (2)" in out
       assert "Sum of duration_s 97s < 85%" in out
       assert "45 shots for a ~558s runtime" in out

   def test_vb_45_fragment_sizes_to_covered_span_and_writes(tmp_path, monkeypatch, capsys):
       rc, path = _run_vb_fragment(tmp_path, monkeypatch, "--write", "--fragment")
       out = capsys.readouterr().out
       written = json.loads(path.read_text(encoding="utf-8"))
       assert rc == 0
       assert "fragment scope: covered 293/1628 script words" in out
       assert "HARD violations: none" in out
       assert "DEFERRED fragment_scope" not in out
       assert written["long_form"]["shots"][-1]["vo_text"] == "out the door."
       assert "fragment_scope" not in written

   def test_20_shot_fragment_still_fails_duration_for_same_covered_span(tmp_path, monkeypatch, capsys):
       baseline = _vb_data()
       sparse = baseline["long_form"]["shots"][:19] + baseline["long_form"]["shots"][-1:]
       data = copy.deepcopy(baseline)
       data["long_form"]["shots"] = sparse
       rc, _ = _run_vb_fragment(tmp_path, monkeypatch, "--fragment", data=data)
       out = capsys.readouterr().out
       assert rc == 1
       assert "fragment scope: covered 293/1628 script words" in out
       assert "Sum of duration_s" in out and "85%" in out

   def test_fragment_requires_long_form_shots(tmp_path, monkeypatch, capsys):
       data = _vb_data()
       data["long_form"]["shots"] = []
       rc, _ = _run_vb_fragment(tmp_path, monkeypatch, "--fragment", data=data)
       assert rc == 1
       assert "--fragment requires at least one long_form.shots record" in capsys.readouterr().out

   def test_fragment_unmatched_last_anchor_is_hard_and_blocks_write(tmp_path, monkeypatch, capsys):
       baseline = _vb_data()
       baseline["long_form"]["shots"][-1]["vo_ref"] = "not present in the script"
       rc, path = _run_vb_fragment(tmp_path, monkeypatch, "--write", "--fragment", data=baseline)
       assert rc == 1
       assert "--fragment cannot resolve the last shot anchor" in capsys.readouterr().out
       assert "vo_text" not in path.read_text(encoding="utf-8")

   def test_fragment_flag_does_not_change_short_or_thumbnail_checks(tmp_path, monkeypatch, capsys):
       data = _vb_data()
       bad_literal = "a sign reading 'one two three four five'"
       short_shot = copy.deepcopy(data["long_form"]["shots"][0])
       short_shot.update(id="S01", still_prompt=bad_literal)
       data["shorts"] = [{"file": "shorts/short-01.md", "shots": [short_shot]}]
       data["thumbnail"]["primary"]["gen_prompt"] = bad_literal
       _run_vb_fragment(tmp_path / "plain", monkeypatch, data=data)
       plain = capsys.readouterr().out
       _run_vb_fragment(tmp_path / "fragment", monkeypatch, "--fragment", data=data)
       scoped = capsys.readouterr().out
       relevant = lambda out: [line.strip() for line in out.splitlines()
                               if "[short:" in line or "[thumbnail]" in line]
       assert relevant(plain)
       assert relevant(scoped) == relevant(plain)
   ```

   The sparse 20-shot case deliberately retains L45 as the final anchor so it tests fewer authored durations against the same 293-word covered span. These tests also prove every non-sizing rule still runs and that no JSON metadata is created.

16. - [ ] **Add descriptive occupancy diagnostics, including the rev-4 crowd metadata row.** Add `occupancy_diagnostics(label, shots, id2text, chars, soft)` and call it after `lf_text` is available. Executable figure names come from backticked `still_prompt` tokens resolved by `video_chars`; legacy `cast` may be reported separately as descriptive metadata but cannot increase executable count. Emit: (a) each maximal zero-human/non-crowd run with ids, duration, VO refs, and clipped derived VO; (b) each one/two-character shot with executable slugs, asset readiness, and base role; and (c) every structured `figures.crowd: true` shot with its id, derived VO, previous id, and next id. The crowd row reads only metadata and neighbours—never prompt prose—and remains SOFT. Exact added code:

   ```py
   if (sh.get("figures") or {}).get("crowd") is True:
       prev_id = shots[index - 1].get("id") if index else None
       next_id = shots[index + 1].get("id") if index + 1 < len(shots) else None
       soft.append(
           f"[{label}] occupancy crowd: id={sid}; vo={id2text.get(sid, '')!r}; "
           f"prev={prev_id or 'START'}; next={next_id or 'END'}"
       )
   ```

   Pre-assert the complete live call-site block before inserting the call. Command: call the diagnostic on a three-shot fixture whose middle record has `figures.crowd:true`. Expected: one crowd row with middle VO and both neighbour ids; no HARD, prose inspection, size threshold, or target count.

17. - [ ] **Test all three diagnostic row shapes without a distribution target.** Add `test_zero_human_run_reports_ids_duration_and_vo`, `test_one_and_two_prompt_token_rows_report_assets_and_base`, and `test_crowd_row_reports_vo_and_neighbours_from_metadata`. Call `occupancy_diagnostics` directly, assert `hard` is not an argument, and assert exact identifying fields in `soft`. The crowd case uses a prompt with no spatial words so the test proves metadata-only behavior. Command: `py -3 -m pytest test_new_guards.py -k occupancy -q`. Expected: three tests pass; no test checks minimum cast share, maximum zero-run length, crowd wording, size, or count.

18. - [ ] **Align every downstream delta-cap and realization speaker.** Apply these exact replacements, preserving surrounding mechanics:

   - `universal.md:1351-1364`: change `a shot exceeds ~8s ONLY with a progressive within-shot reveal` to `a shot exceeds ~8s only with a story-needed held state change or explicit legibility/gravity reason`; change `give any long shot a progressive reveal` to `give any long shot a story-needed held state change or explicit legibility/gravity reason`; change `base + ≤2 delta frames` to `base + ≤3 delta frames`; replace `Continuity, cheapest first` with `After shots exist, author a stage only when camera/set/primary subject hold and each next beat has one story-needed state change; realization uses a seeded delta-chain for integrative change and a seeded layer for discrete change.`
   - `animation-rules.md:12-24`: replace `Precondition — the two-test boundary` with `Realization boundary — authoring has already decided the stage under shots-schema`; retain integrative→parent regen and discrete+seedable→layer; change the pointer text from `≤2-delta cap` to `≤3-delta cap`.
   - `animation-rules.md:35-42`: replace `ARROWS, routes, and PROGRESSIVE REVEALS are MOTION — NEVER baked` with `Arrows and routes are motion layers. A progressive reveal is not automatically a layer: an integrative state change remains a parent-seeded baked delta; a discrete seedable reveal becomes a sequenced layer anchored to its VO word.`
   - `animation-rules.md:113-124`: replace `bounded by the two-test boundary` with `bounded by the authored-stage realization boundary`; KEEP `a DISCRETE addition onto the base reuses it as a cutout layer`, `an INTEGRATIVE change must reuse it as a held delta-chain and stays baked`, and the `Stays baked` integrative example because they already state the correct downstream realization split.
   - `motion-planner/SKILL.md:20-24`: replace `Classify each shot by the two-test boundary` with `Read the stage intent already authored under shots-schema, then classify its realization only`; retain the exact DISCRETE→layer, INTEGRATIVE→delta-chain, and passthrough outcomes, and append `The planner does not admit, reject, split, or join stages.`
   - `motion-planner/references/critics.md:27-29`: KEEP `Do not demand layers for ordinary held tableaux, integrative changes, or to hit a coverage quota`; it is already compatible and is covered by the downstream ownership test.
   - `shots-motion-schema.md:7-11`: change `The boundary this spec serves` to `Realization boundary after VPW has authored stage intent` and `≤2-delta` to `≤3-delta`.
   - `shots-motion-schema.md:27-33`: retain `delta-chain` pass-through and Hybrid behavior, but add `This file never decides whether the stage should have been authored.`
   - `test_stage_check.py` and `test_forge_place_and_gates.py:88-90,291-300`: replace the `base + 2 deltas` and `genuine progressive delta` comments with `authoring decides the stage under the hold-camera test; realization decides layer versus regeneration; the canonical cap is base + 3 deltas.` No assertion is weakened.

19. - [ ] **Align image-generation's stage, crowd, and cast speakers.** Assert each exact OLD block before replacement.

   OLD:

   ```md
   only defective-seed exceptions are an **authored delta-chain parent** (technique (e)) and a **human-ordered
   framing hold**, and BOTH take a **before/after crop-battery diff on EVERY figure** in the frame, not just
   the targeted one. **Crowd-bearing gens also seed the crowd exemplar** (`refs/base/crowd-exemplar.png`,
   bible §2d) as the crowd's proportion/face anchor — the §2d words stay in the `still_prompt`, but the
   exemplar seed is what pins the crowd rig.
   ```

   NEW keeps the first three lines byte-identical and replaces the final two with:

   ```md
   bible §2d) as the crowd's proportion/face anchor. Forge appends bible §2d from `figures.crowd`; the
   exemplar seed pins the crowd rig's proportion and face.
   ```

   OLD:

   ```md
   **Scope of a shot:** generate **stills** only for shots whose `source` is `ai-gen` or the generated half
   of `hybrid`. `source: chart|screencap|stock|archival` belong to other pipelines — skip them and record
   `skipped: source=<x>` in the manifest. **Ignore every motion/beat field** — `stage`/
   `stage_role`/`changed_elements`, and any retired motion keys an old file still carries — motion is the
   Remotion engine's business; you read only the visual fields. `synthetic` is consumed by metadata, not
   ```

   NEW:

   ```md
   **Scope of a shot:** generate **stills** only for shots whose `source` is `ai-gen` or the generated half
   of `hybrid`. `source: chart|screencap|stock|archival` belong to other pipelines — skip them and record
   `skipped: source=<x>` in the manifest. Read `stage`/`stage_role`/`changed_elements` for parent routing
   and one-change validation, never to re-decide whether VPW may author the stage; ignore `beat` and any
   retired motion keys. `synthetic` is consumed by metadata, not
   ```

   Replace the figure-index block with step 8's exact OLD → NEW pair. In technique (e), pre-assert its complete physical table row and insert `VPW has already admitted the stage by the hold-camera criterion;` before the realization rule. In the doctrine-owner test, replace exact line `assert "story-bearing" in GRAMMAR` with `assert "Occupancy follows who acts in the sentence" in GRAMMAR`; retain the negative IG assertion and add cross-file prompt-token/descriptive-metadata assertions. Command: run doctrine and pass-1 consistency tests. Expected: all speakers agree on prompt-token cast, Forge-owned crowd bytes, and authoring-versus-realization ownership.

20. - [ ] **Extend the live Forge tests rather than Forge code.** Add to `test_forge_figures.py`:

   ```py
   def test_live_kit_expands_the_bible_crowd_clause():
       bible = (KIT / "style-bible.md").read_text(encoding="utf-8")
       expected = forge.blockquote_after(bible, "CROWD-RIG clause")
       kit = forge.Kit(str(KIT), dry=True)
       prompt = kit.prompt_for(mode="environment", delta="",
                               figures={"crowd": True})
       assert expected
       assert kit.desc_crowdrig == expected
       assert expected in prompt
       assert prompt.endswith(expected)
   ```

   Extend existing `test_the_crowd_exemplar_is_refused_without_a_record` with `assert "figures.crowd" in err` and `assert "crowd-exemplar" in err`; do not create a duplicate refusal test. Update the hard-coded suffix heading in `test_forge_style_tile.py` from `## 2d. Canonical dispatch suffix` to `## 2e. Canonical dispatch suffix`. Add assertions that `desc_identity`, `desc_style`, and `desc_righold` equal their pre-move blockquotes, so heading matching cannot steal another descriptor.

21. - [ ] **Extend every review-card shape and render optional fields safely.** Add `PALETTE_NOTE_PREFIX`, `stage_key`, and `palette_basis_by_stage`; scene cards add `still_prompt`, effective `stage`, inherited `palette_basis`, and `palette=palette_metrics(path)`, while `reason` remains manifest notes. Pending-asset cards add explicit defaults for those four keys. In `build`, replace direct indexing of every new field with `.get` plus a concrete default so `--staging --assets` cannot crash even on an older caller fixture. The exact pending-card OLD block is lines 262–270 as printed in the source; NEW appends:

   ```py
   still_prompt="", stage=stem, palette_basis="", palette={},
   ```

   The render NEW uses `c.get("still_prompt", "")`, `c.get("stage", c.get("sid", ""))`, `c.get("palette_basis", "")`, and `c.get("palette") or {}`. Pre-assert the full scene-card, pending-card, and render-format OLD blocks before patching. Command: the test invokes `main()` with its temporary video, output, staging directory, and PNG through `--staging --assets`. Expected: exit 0, an HTML card with defaults, and no `KeyError`.

22. - [ ] **Move the HSV metric into the image-generation-owned module and import it normally from both callers.** Create `scripts/palette_metrics.py` by moving the exact live constants and functions `SAT_MIN`, `HUE_BIN_DEGREES`, `ORANGE`, `rgb_to_hsv`, `in_band`, `grid_coverage`, and `metrics` out of `vd_palette_metrics.py`; add `COOL_PAIR = (165.0, 240.0)` and return `cool_pair_chroma` plus `complementary_pair_chroma = orange_chroma + cool_pair_chroma`. The shared function always returns numeric metrics; there is no dynamic import and no `unavailable` fallback.

   In `build_review_artifact.py` import OLD:

   ```py
   sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
   import forge          # same skill, same dir: the C-6 reuse gate is imported, never re-implemented
   ```

   NEW:

   ```py
   sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
   import forge          # same skill, same dir: the C-6 reuse gate is imported, never re-implemented
   from palette_metrics import metrics as palette_metrics
   ```

   In `vd_palette_metrics.py`, byte-assert and replace the imports/constants/functions block from `import numpy as np` through the closing `metrics` return with:

   ```py
   import sys
   import numpy as np

   SKILL_SCRIPTS = VIDEO.parents[3] / ".claude" / "skills" / "image-generation" / "scripts"
   sys.path.insert(0, str(SKILL_SCRIPTS))
   from palette_metrics import metrics
   ```

   Place this block after `VIDEO` is assigned (move the `VIDEO` assignment above it); retain the report-only aggregation functions. Creation precondition: assert `palette_metrics.py` does not exist. Command: run its unit test plus `py -3 V/scratchpad/taste-audit/vd_palette_metrics.py`. Expected: numeric warm/cool/orange/cool-pair/complementary fields from both callers; no `importlib`, video-specific lookup, or `unavailable` string in the shared skill.

23. - [ ] **Test both metric callers and both card shapes.** Add the existing four scene-card tests plus `test_palette_metrics_owned_module_is_used_by_report_and_board` and `test_staging_assets_card_uses_safe_defaults`. Build tiny 16:9 red/orange/cyan fixtures; assert numeric fields and that high pair share changes no flag/status. Invoke the scratch report and the board collector so both normal imports execute. Update the ordinary card fixture and render it. Command: `py -3 -m pytest test_palette_metrics.py test_build_review_artifact.py -q`. Expected: all six new cases pass; HTML contains prompt/stage/basis/advisory rows for scenes and renders a pending asset with defaults.

24. - [ ] **Wire the scene board into the canonical IG review gate.** After IG line 251, add this exact sentence:

   ```md
   Before fresh-eyes rulings, set `$VIDEO_DIR` to the current video folder and run `py -3 .claude/skills/image-generation/scripts/build_review_artifact.py --video $VIDEO_DIR --out "$VIDEO_DIR/assets/_review/scene-board.html"`; review each card's `still_prompt`, effective stage, inherited `Palette basis:` metadata, and advisory warm/cool and complementary-pair shares, judging whether light/material/story cause supports recurrence rather than targeting any hue or share.
   ```

   Keep the existing one-pass review, one re-authored retry, honest park, and stamp behavior unchanged. Extend existing `test_generation_procedure_keeps_verified_asset_gate` to assert the scene-board command and advisory language; do not add a collected test.

25. - [ ] **Run the exact §2d/authorship, echo, and encoding sweeps before the test gate.** The sweep explicitly includes `orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md:182` (delete `the §2d words stay in the still_prompt`) and `orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_style_tile.py:243` (replace the hard-coded `## 2d. Canonical dispatch suffix` with `## 2e. Canonical dispatch suffix`). Then require zero matches for every deleted phrase in the brief's grep list with:

   ```powershell
   rg -n -i -e 'ensure a progressive within-shot reveal' -e 'a chain exists only for a progressive reveal' -e 'progressive reveal or non-empty hold_reason' -e 'author a genuine progressive reveal or hard cut' -e 'genuine progressive delta' -e 'confirm a progressive in-shot reveal' -e 'give any long shot a progressive reveal' -e 'a shot exceeds ~8s ONLY with a progressive' -e 'Stage the run — held evolving stages' -e 'This is the still-era realization' -e 'DELTA-CHAIN when the change is INTEGRATIVE' -e 'Interactions are just.*kind: interaction' -e 'figures on the CROWD RIG' -e '≤2[- ]delta' -e 'base \+ ≤2' -e 'base \+ 2 deltas' -e 'Continuity, cheapest first' -e 'Precondition — the two-test boundary' -e 'bounded by the two-test boundary' -e 'ARROWS, routes, and PROGRESSIVE REVEALS are MOTION' -e 'The boundary this spec serves' -e 'Classify each shot.*two-test boundary' -e 'write INTO a crowd scene.s prompt' -e 'crowd figures instead follow the §2d CROWD-RIG clause when the prompt states it' -e 'simplified: dot eyes' -e 'one simple mouth\) — do NOT force' -e '§2d is authored by VPW' -e 'it is not auto-appended' -e 'prompt-authored \(§2d\)' -e '§2d words.*stay in.*still_prompt' -e '^\*\*Story bearer\.\*\*' -e 'Only a genuine rearward mass beat' -e 'Locked to the character; NOT locked globally' -e 'palettes move freely per video' -e 'at most two supporting' -e 'no human when mechanism' -e 'classify → cast → stage the tableau → state the facts' -e 'classify → cast → tableau → facts → intent note' -e 'Keep every planned stage and its whole chain inside one partition' -e 'Ignore every motion/beat field' -e 'cast is authoritative' -e 'cast ORDER binds' -e 'assert "story-bearing" in GRAMMAR' -e '## 2d\. Canonical dispatch suffix' orgs/faceless-youtube/.claude/skills orgs/faceless-youtube/knowledge/research/niche-playbooks/universal.md orgs/faceless-youtube/channels/the-second-take/visual-kit
   rg -n 'CROWD-RIG clause|CROWD RIG:|DOT EYES|§2d|integrative' orgs/faceless-youtube/.claude/skills orgs/faceless-youtube/channels/the-second-take/visual-kit
   $VdEncodingRoots = @('orgs/faceless-youtube/.claude/skills/visual-prompt-writer','orgs/faceless-youtube/.claude/skills/image-generation','orgs/faceless-youtube/.claude/skills/motion-planner','orgs/faceless-youtube/.claude/skills/render-builder','orgs/faceless-youtube/channels/the-second-take/visual-kit','orgs/faceless-youtube/knowledge/research/niche-playbooks/universal.md')
   $VdBadCodepoints = @([char]0x00C2,[char]0x00C3,[char]0x00E2,[char]0xFFFD)
   Get-ChildItem -LiteralPath $VdEncodingRoots -File -Recurse | Select-String -SimpleMatch -Pattern $VdBadCodepoints
   ```

   The second command is an ownership audit, not a zero-match assertion: the CROWD-RIG bytes may occur only in bible §2d and tests; `§2d` may point only to the crowd clause; `integrative` may remain only in downstream realization language. The mojibake command must return no rows in touched files.

26. - [ ] **Run both test suites and repository checks.** From the VPW scripts directory run `py -3 -m pytest`; baseline 101 plus one doctrine-owner, one fixture, eight fragment, and three occupancy-diagnostic cases yields expected `114 passed`. From image-generation scripts run `py -3 -m pytest`; baseline 166 plus one Forge assembly, four scene-card, one shared-metric/two-caller, and one staging-default case yields expected `173 passed`. Total expected is 287. Then run `git diff --check`; read every touched existing path explicitly as UTF-8 and reject U+FFFD. Expected: both suites green, `287 passed` total, clean diff check, no bad codepoint.

27. - [ ] **Review and commit the doctrine phase only after the gate passes.** Inspect `git diff --stat` and `git diff --` for every Task 1 file; confirm no new doctrine heading except bible §2d, no deleted test, no fixture outside the pinned 26 cases, and no unrelated dirty file staged. Stage explicit Task 1 paths and commit with `feat(fyt): implement variant D doctrine and fragment lint`. Never use `git add -A`, `git commit -a`, or push to `main`.

**Acceptance:**

- Every old→new row above is applied at the named owner; all stale copies are deleted in the same patch.
- `Kit.prompt_for(mode="environment", delta="", figures={"crowd": True})` ends with the exact moved bible blockquote, authored fixtures contain none of those bytes, and the existing seedless-crowd request still refuses.
- The vb 45-shot file produces its existing two sizing HARDs without `--fragment`, but produces zero sizing HARDs with the flag, prints `fragment scope: covered 293/1628 script words`, writes 45 clipped `vo_text` spans on a clean `--write`, and writes no fragment metadata; a sparse 20-shot version retaining L45 still trips duration coverage against the same covered span.
- The canonical chain cap is ≤3 everywhere; lint remains structural/lexical and the critic owns semantic materiality.
- Canonical question 3 includes occupancy/crowd judgment while preserving registry, role, and outfit checks; question 5 and the six-question count remain intact.
- Crowd geometry is the spec's single positive sentence and canonical question-3 judgment; lint emits the metadata-only crowd VO+neighbours row but no prose detector, ban, size threshold, or count gate.
- Palette light/material facts reach base `still_prompt`; prefixed base `notes` reach every same-stage review card separately from manifest failure reasons; metrics remain advisory.
- Test totals are exactly 114 VPW + 173 IG = 287, both green; echo sweep, mojibake sweep, and `git diff --check` are clean.

**Review gate:**

The adversarial reviewer checks F1–F12 against rev 4: exact fragment control flow, covered-span sizing/clipping, no JSON metadata or deferred sizing, unchanged Shorts/thumbnail/non-sizing rules, six-question preservation, metadata-only crowd diagnostics, no crowd ban or lexical geometry detector, provider-visible palette facts, owned metrics, safe pending cards, prompt-token pairs, shot-level no-growth, honest missing D provenance, one ≤3 authority, exact moved bytes, non-oracle calibration, and zero stale speakers.

### Task 2 — Author VPW A1 under Variant D, lint the fragment, and run the critic

**Files:**

- Create `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/vpw-var/plan-vd.md`.
- Create `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/vpw-var/fragment-A1-vd.json`.
- Modify `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json` in place as the production-shaped, officially scoped A1 file.
- Create `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/vpw-var/critic-vd-A1.md` for the independent findings and author's disposition.
- Read, do not modify, `scratchpad/vpw-var/plan.md`, `scratchpad/vpw-var/fragment-A1.json`, `scratchpad/taste-audit/vd-occupancy-forensics.md`, `script.md`, `visual-kit/registry/registry.json`, and Task 1's calibration fixture.

**Interfaces:**

- Task 3 consumes `V/shots.json`, not the fragment scratch copy; its L01–L12 records, `vo_text`, stages, `Palette basis:` base notes, backticked character/interaction token routes, and crowd declarations are authoritative; `cast` remains descriptive metadata.
- Task 3 may proceed only after `--fragment` reports `fragment scope: covered 293/1628 script words` and zero HARD, the independent critic has completed one covered-span findings cycle, the author has disposed every finding, and the final covered-span lint is again zero HARD.
- Task 4 compares D by the L01–L12 order and reads D's prompt/stage metadata from branch `claude/bricks-variant-vd`.

1. - [ ] **Create `plan-vd.md` with the inherited partition and boundary lock before authoring.** Copy the seven vb partition rows exactly: A1 opening through `Terry Johnson was out the door.` with 45 shots/~98s and cast `pc-boxy,rival-pc,drive-maker,miniscribe-rep,ibm-suit,terry-johnson,line-worker`; A2 Wiles arrival through invented-count setup/~50; A3 blank numbers through clean audit/~48; A4 inventory fraud through audit pass/~58; A5 layoffs through restatement/~42; A6 lawsuit through settlement/~35; A7 conviction through HR payoff/~32. Preserve these exact boundaries: A1 does not reveal MiniScribe before its company-name line, bricks before the title-giveaway line, or collapse before `Now rewind`; no stage/place chain crosses an act; Wiles/banker start fresh bases in A2; courtroom remains inside A6; HR personification enters only on its narrated reveal. Record that vb declares no A1 `place` ids or `place_anchor`, so D carries the same no-cross-act place boundary rather than inventing a place catalog.

2. - [ ] **Load evidence, then record shot judgments only after applying the criteria.** Give the executor `vd-occupancy-forensics.md` §2, `vd-palette-forensics.md` §§1–2, `vd-chain-forensics.md`, `vd-chain-forensics-adv.md`, `vd-crowd-density.md`, vb's L01–L45 records, `script.md`, and the rev-4 §3.1–3.4 criteria. Do not copy any proposed occupancy, pair, crowd, field, or stage outcome into `plan-vd.md` before judgment. After reading each VO beat and its evidence, append one row `id | causal subject | acting participant(s) | occupancy ruling + reason | candidate field + depicted basis`; after all shots exist, append the separate stage decision rows required by step 8. Pre-edit command asserts step 1's file exists and contains the inherited partition lock but none of the four old preselected row phrases. Expected: 45 post-application rows and no copied `L02 | one`, `L07 | seeded`, `L08 | same clerk`, or `L09 | crowd` outcome.

3. - [ ] **Resolve only identities selected by the completed shot judgments.** After step 2, search `registry.json` and the video library for each selected acting participant. If a selected participant lacks a seeded character token, add one exact `needed_assets` record with `kind:"character"`, a descriptive slug/wants, and the judged shot/causal-subject reason, then stop at the existing human gate. If vetoed, reapply the occupancy criterion and restage the beat; do not substitute an unrelated identity. OLD → NEW is the affected shot's complete JSON object, byte-asserted immediately before patching. Command: parse `plan-vd.md` and `needed_assets`; expected output lists only evidence-derived unresolved selections, with no automatic `arcade-player`, `shop-clerk`, or `shop-customer` request.

4. - [ ] **Encode every judged pair through Forge's exact token route.** For each shot ruled a pair, write two approved backticked character tokens in left-to-right order in `still_prompt`. If physical contact makes the beat true, immediately follow them with one registered backticked interaction token chosen from `handoff`, `handshake`, or `fistbump`; if none fits, emit `needed_assets` and stop. A non-contact pair names only the two character tokens. The optional `cast` array may mirror the ruling for review but never counts as execution proof. OLD → NEW is each affected shot's full JSON object. Command: call `forge.shot_cast(registry, still_prompt)` for each selected pair. Expected: exactly two cast canonicals in order and, for contact, the selected interaction appears in `_interaction_primitives`; no three-person promise.

5. - [ ] **Author all 45 A1 shots from the recorded post-criterion judgments.** Run the decision order independently on each VO beat. Reuse load-bearing vb facts, but only rewrite a composition when its recorded subject, participant, occupancy, stage, field/basis, or crowd-geometry ruling requires it. Every base/standalone `still_prompt` contains the drawable light/material facts for its chosen field; the `Palette basis:` note alone is metadata-only and cannot satisfy this step. Every selected pair uses step 4's backticked tokens. OLD → NEW is each changed shot's full JSON object; unchanged shots are copied byte-for-byte and later ruled in step 15. Preserve suffix, style tile, exemplar, ids/order, verbatim anchors, and the one-change floor. Command: JSON-parse both artifacts and run the pair/crowd token audit; expected: 45 ordered records and no selected participant represented only by `cast` metadata.

6. - [ ] **Apply crowd geometry only to shots judged mass-subject after evidence review.** For every such shot, author the crowd in the primary scene clause as a bounded group held beyond something the scene already has, with the near zone empty; set `figures: {"crowd": true}` and omit CROWD-RIG boilerplate. Re-judge every vb crowd declaration rather than inheriting or reversing it by id. OLD → NEW is each affected shot's full JSON object. Command: print every `figures.crowd` id with its VO and neighbouring ids; expected: each row has a recorded mass-subject reason and critic-readable geometry, with no count, height, boundary-word, or crowd-total gate.

7. - [ ] **Decide stages only after the 45 individual shots exist.** Walk adjacent shots and apply the two questions: can camera/set/primary subject hold, and does the next beat make exactly one visually distinct, story-needed state change? Treat vb L05→L06 and L08→L09 plus vc's L09→L10 class as candidates the critic must pass, not required chains. Re-evaluate vb's existing `retail-shelf`, `pc-rivalry`, `drive-seller`, `brick-carton`, `miniscribe-rise`, and `order-collapse` runs on the same criterion; split any forced hold and add any missed hold. Preserve the explicit L11 hero-object → L12 relational diagram hard cut.

8. - [ ] **Finish the plan lock with actual stage field+basis rows after stage decisions.** For each resulting shared `stage` and every standalone id, write exactly one row: `effective stage id | member ids | dominant field | Palette basis: field — depicted light source + dominant material/story fact`. Copy the exact prefixed sentence into the base/standalone shot's `notes`; copy its drawable light/material facts into that base's `still_prompt`. Do not put the prefix on deltas, do not create a palette schema field, and do not leave candidate rows for stages that were rejected.

9. - [ ] **Materialize both A1 artifacts without encoding scope in JSON.** Write the 45 authored records to `fragment-A1-vd.json` under its sole top-level `shots` array. Update the existing production-shaped `V/shots.json` in place, preserving its schema/channel/video/aspect/thumbnail/short scaffolding, setting its 45 long-form shots to those exact records, and keeping `global_prompt_suffix: ""`. Do not add `fragment_scope`, start/end anchors, or any other partial-file metadata: the implementation-time CLI flag declares the scope. Parse both with `py -3 -m json.tool`; assert ids are exactly `L01` through `L45` once each, the scratch fragment records equal `shots.json.long_form.shots` before derived `vo_text` is written, and `rg -n 'fragment_scope|start_anchor|end_anchor_exclusive' V/shots.json` returns no rows.

10. - [ ] **Run the official fragment lint with derivation.** From repo root run:

   ```powershell
   py -3 orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts/lint_shots.py orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json --write --fragment
   ```

   Expected: exit 0; `fragment scope: covered 293/1628 script words`; `HARD violations: none`; no `DEFERRED fragment_scope` row; `WROTE derived vo_text (45 shots). JSON valid.`; plus descriptive zero-human, one/two-character, and every-`figures.crowd` VO+neighbours row with no promotion effect. Both sizing checks run against ~100s (`293 covered script words / 175wpm, per the header`), and every other HARD keeps its existing meaning. Any HARD is a real defect and must be repaired before critic dispatch.

11. - [ ] **Dispatch one genuinely independent critic with this exact brief and no authoring context.** Give it only `V/shots.json`, `V/script.md`, `visual-grammar.md`, `registry.json`, `style-bible.md`, `shots-schema.md`, `critics.md`, and `references/delta-materiality-calibration.json`:

   ```text
   You are the fresh-eyes shot critic. Read the supplied laws and calibration fixture, then judge the
    lint-passed A1 fragment's covered span shot by shot. Return findings only; never rewrite a prompt. Apply the canonical
   six bible questions and the schema chain/disclosure contract. For every adjacent beat ask both: could
   camera, set, and primary subject honestly hold (missed hold), and does every delta visibly advance one
   story-needed state (forced hold/no-op)? Use the 26 fixture cases only to calibrate semantic judgment;
   do not match phrases or target a hold count. Judge occupancy from the causal subject, including whether
   removing every visible person would hide that subject and whether a crowd's subject is genuinely the
   mass. For each crowd, judge the actual primary geometry: bounded, rearward, non-dominant, with an empty
   near zone; do not award a pass for boundary words alone. For every distinct stage, judge whether its
   dominant field is grounded in the stated light/material/story basis; complements are legal and holds
   are exempt from recurrence findings. Flag unexplained positive authored prompt growth against vb when
   it adds words instead of replacing lower-value facts. Output a ranked list: shot id or seam, canonical
   question/criterion, one-sentence defect quoting the authored text, and one-line fix direction. End with
   ship-with-edits / restage-these-N / sound. Report no totals or desired distributions.
   ```

   Save the findings verbatim under `## Independent findings` in `critic-vd-A1.md`.

12. - [ ] **Run the one permitted author repair pass.** Re-derive every flagged shot through the full decision order; touch only flagged records plus mechanically forced chain neighbours. For each finding, record `accepted + change` or `rejected + reason` under `## Author disposition`; never patch by appending a prohibition. If the critic finds a missing asset route, emit `needed_assets` and stop at the human gate. This is the single critic→author cycle; do not run a second critic unless more than one third of the 45 shots changed, matching the existing critic charter.

13. - [ ] **Re-run the official lint after repair.** Use the exact `--write --fragment` command from step 10. Require the same zero-HARD/`covered 293/1628`/45-written result with no deferred row; re-open L45 and confirm its derived `vo_text` is exactly `out the door.` and does not absorb `By 1985 the company was in real trouble`. Re-run `py -3 -m json.tool`, assert no stale hand-authored `vo_text` remains in `fragment-A1-vd.json`, and assert the production JSON still contains no fragment metadata.

14. - [ ] **Build the dispositive per-shot no-growth diff against vb.** Read vb with `git show claude/bricks-variant-vb:orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`; for every L01–L45 row record `id | vb authored words | vd authored words | authored delta | exact lower-value text removed | exact replacement fact | assembled-provider delta | verdict`. Count authored words with `len(still_prompt.split())`. `PASS` requires `vd authored words <= vb authored words` for the same id, without exception; every positive authored delta is `REJECT—reauthor` and the shot must be shortened before any generation. Compute assembled-provider words separately through dry `Kit.prompt_for`; Forge-appended §2d growth never excuses authored growth. Command: run the table builder and `py -3 -c` assert all 45 authored deltas are `<= 0`. Expected: 45 PASS rows, zero positive authored deltas, assembled deltas in a separate column, and no aggregate/median gate.

15. - [ ] **Rule every L01–L12 provider payload before generation.** In `plan-vd.md`, record final seam decisions, each base's exact drawable light/material substring, each selected occupancy plus executable asset route, and each crowd's primary bounding geometry. Then add one ruling per id in one of two literal forms: `changed — by which lever: changed provider-visible bytes` or `intentionally unchanged — criterion-based reason`. Delete the all-set byte gate; an unchanged row is never counted as evidence that a lever moved pixels. Command: compare normalized dry-assembled payloads shot by shot against vb and assert all 12 ids have exactly one ruling. Expected: 12 complete rulings; each changed row names stage routing, light/material prose, backticked pair/interaction, crowd geometry, or Forge-appended §2d, and each unchanged row explains why no criterion required payload change.

16. - [ ] **Commit the authored fragment only after review.** Run `git diff --check`, the Task 1 VPW suite (`114 passed`), and the official lint once more. Stage only `plan-vd.md`, `fragment-A1-vd.json`, `critic-vd-A1.md`, and `V/shots.json`; commit `feat(fyt): author variant D A1 visual plan`. Do not stage generated frames, unrelated untracked files, or coordination paths.

**Acceptance:**

- `V/shots.json` contains L01–L45 and no fragment metadata; the `--fragment` invocation prints `covered 293/1628`, runs both sizing checks against that span, produces zero HARD, and writes fresh clipped `vo_text`.
- The independent critic completes one normal cycle; every finding is accepted and repaired or rejected with a concrete reason; every final chain passes both missed-hold and forced-hold judgment.
- Every resulting base/standalone carries one prefixed `Palette basis:` note and provider-visible light/material facts; same-stage cards can inherit the basis unambiguously.
- Every pair uses two approved backticked character tokens; contact follows them with registered `handoff`, `handshake`, or `fistbump`, or stops at `needed_assets`; `cast` metadata alone never passes and no trio is promised.
- Every crowd is selected because the mass acts and is judged from actual bounded/rearward/empty-near-zone geometry, not a lexical match.
- The 45-row vb diff is complete; every authored word delta is non-positive, and assembled-provider crowd-rig growth is reported separately.
- Every L01–L12 payload has a changed-by-lever or intentionally-unchanged-with-reason ruling; unchanged rows are not evidence of a pixel lever.

**Review gate:**

The adversarial reviewer receives only the final files and checks spec §4.3/§5: inherited partition/cast/place boundaries, actor-first decisions for all 45 beats, stages decided after shots, candidate holds treated as candidates, verified pair routes, positive crowd geometry, provider-visible drawable light/material facts plus separately labelled review-only basis metadata, covered-span fragment lint, one independent critic cycle, and a dispositive per-shot no-growth diff with no hidden target distribution.

### Task 3 — Generate and fresh-eyes review L01–L12

**Files:**

- Create `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/vpw-var/genlog-vd.md`.
- Create `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/vpw-var/spec-vd-wave1.json`, `spec-vd-L01.json` through `spec-vd-L12.json` only for deferred deltas, and `spec-vd-retry-L01.json` through `spec-vd-retry-L12.json` only when the corresponding shot receives its single retry.
- Modify only L01–L12 entries in `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/manifest.json` and `assets/_review/merged.json`; preserve unrelated entries byte-semantically.
- Create `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/variant-frames/vd/L01.png` through `L12.png` plus `manifest.json`.
- Queue one coordination row for `ledgers/cost/claude-boss-2026-08-20.tsv` on `ops`; never write the ledger from the work-product branch.

**Interfaces:**

- Task 4 reads exactly `scratchpad/variant-frames/vd/{L01..L12}.png` and its manifest; copied files preserve the reviewed scene bytes and honest `verified|parked` state.
- Parent-seeded deltas may be built and generated only after their immediate parent frame has a current all-pass review record; a parked parent blocks the child and is recorded as an honest park.
- Cost accounting uses the conservative vb convention for authorization and also records the current provider-table comparator; neither rate is silently substituted for the other.

1. - [ ] **Pass the pre-spend human gate.** Present the locked L01–L12 slate, Task 2's covered-span zero-HARD/critic evidence, and its dispositive payload table with no remaining `REJECT—reauthor` row; report authored and assembled-provider deltas separately. Also present expected base call count, one-retry rule, and the 24-call/$3.216 conservative ceiling inside the already authorized $5 wave cap. Do not invoke live `forge.py gen` until the human explicitly approves this spend step; a dry run remains $0 and may be used to validate configuration first.

2. - [ ] **Initialize `genlog-vd.md` before the first call.** Header fields: date `2026-08-20`; branch `claude/bricks-variant-vd`; video; model requested `gemini-3-pro-image`; model responding recorded per call; image size `1K`; aspect `16:9`; conservative rate `$0.134/call`; provider-table comparator `$0.039/call`; base allowance `12`; retry allowance `12`; maximum calls `24`; conservative ceiling `$3.216` (report `$3.22` rounded); provider comparator ceiling `$0.936`; wave cap `$5`; upstream lint/critic verdict; and a call table with columns `call | shot | base/retry/parent-regen | spec | seed roles | requested model | responding model | $0.134 cost | $0.039 comparator | output | fresh-eyes verdict | retry cause/park reason`.

3. - [ ] **Set explicit PowerShell paths and derive the first wave from final stage metadata.** From repo root run:

   ```powershell
   $VdVideo = 'orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh'
   $VdKit = 'orgs/faceless-youtube/channels/the-second-take/visual-kit'
   $VdStaging = "$VdKit/_staging"
   $VdForge = 'orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py'
   $VdShots = Get-Content -Raw -Encoding UTF8 "$VdVideo/shots.json" | ConvertFrom-Json
   $VdFirstWaveIds = (($VdShots.long_form.shots | Where-Object { $_.id -in @('L01','L02','L03','L04','L05','L06','L07','L08','L09','L10','L11','L12') -and $_.stage_role -ne 'delta' } | ForEach-Object { $_.id }) -join ',')
   py -3 $VdForge batch --kit $VdKit --batch "$VdVideo/shots.json" --video $VdVideo --shots $VdFirstWaveIds --aspect 16:9 --out "$VdVideo/scratchpad/vpw-var/spec-vd-wave1.json"
   py -3 $VdForge gen --dry-run --kit $VdKit --batch "$VdVideo/scratchpad/vpw-var/spec-vd-wave1.json" --video $VdVideo --aspect 16:9 --image-size 1K --force
   ```

   Inspect dry-run output for exact shot ids, seed roles, parent absence on bases/standalones, appended crowd clause only on `figures.crowd`, provider-visible drawable light/material facts from each base `still_prompt`, and no stale output skip. Confirm the review-only `Palette basis:` sentence is absent from the assembled provider prompt but present on every same-stage review card in its own labelled row, apart from manifest `reason`. Expected: no seeding-law violation, no API call, and every first-wave request says 16:9/1K.

4. - [ ] **Generate the non-delta first wave with vb's call shape.** Run exactly:

   ```powershell
   py -3 $VdForge gen --kit $VdKit --batch "$VdVideo/scratchpad/vpw-var/spec-vd-wave1.json" --video $VdVideo --aspect 16:9 --image-size 1K --force
   ```

   Append one genlog row per actual provider call immediately, including failures and responding-model mismatch. Never re-issue an ambiguous timed-out call until output/staging state proves it did not complete. Stop if the preamble budget gate fails, requested/responding model differs, or cumulative conservative cost would exceed $5.

5. - [ ] **Review the first wave with a fresh reader using this exact template.** The generator does not grade its own frames. For every generated id, the fresh reviewer returns:

   ```text
   ID | fidelity: clean|defect | style: clean|defect | rig: clean|defect | worst: clean|LOW|MED|HIGH
   Scene/causality: does the frame depict the authored subject and every load-bearing fact?
   Chain: if base/standalone, is it a valid visual parent; if delta, is the one state change visible?
   Palette: do the rendered field and recurrence follow the stated light/material/story basis?
   Occupancy: does the visible person/pair/mass match the causal subject without dominating the world?
   Crowd when applicable: is the mass actually bounded, rearward, non-dominant, with an empty near zone,
   and does every figure hold the approved rig? Do not pass on prompt words alone.
   Lettering/identity/pose/expression/style: rule each applicable bible row explicitly.
   Why: one evidence sentence naming what is visible; never infer a clean fact from the prompt.
   Retry direction: only when defective, name the causal depiction strategy to replace; do not write prompt text.
   ```

   Save rulings in `assets/_review/merged.json` shape `{id,f,s,r,worst,why}` for L01–L12 only; preserve all other entries.

6. - [ ] **Promote clean parents before building any delta.** Set `$VdParentId` to one clean first-wave parent and run the vb review-store path before copying it:

   ```powershell
   $VdParentBoard = "$VdVideo/assets/_review/parent-$VdParentId.html"
   $VdParentVerdicts = "$VdVideo/assets/_review/figure-verdicts-vd-$VdParentId.json"
   py -3 orgs/faceless-youtube/.claude/skills/image-generation/scripts/build_review_artifact.py --video $VdVideo --out $VdParentBoard --staging $VdStaging --assets "$VdStaging/$VdParentId.png" --figures-out $VdParentVerdicts
   ```

   The independent reviewer fills that skeleton with `fidelity/style/rig: pass`; any failure routes to step 8, not promotion. Merge a clean skeleton with `py -3 orgs/faceless-youtube/.claude/skills/image-generation/scripts/stamp_review.py $VdVideo --figures $VdParentVerdicts`, require the output to name the reviewed staging digest, then `Copy-Item -LiteralPath "$VdStaging/$VdParentId.png" -Destination "$VdVideo/assets/scenes/$VdParentId.png" -Force`. Update only that id's scene-manifest provenance from its generated spec and run `py -3 orgs/faceless-youtube/.claude/skills/image-generation/scripts/stamp_review.py $VdVideo`; require a current all-pass record. Repeat per clean parent. Do not promote a defective frame merely to unblock its child.

7. - [ ] **Generate deltas serially, parent before child.** Re-read final L01–L12 order, select only the next ungenerated `stage_role: delta`, verify its immediately preceding in-stage parent is `verified`, then run this block once:

   ```powershell
   $VdDeltaId = $VdShots.long_form.shots | Where-Object { $_.id -in @('L01','L02','L03','L04','L05','L06','L07','L08','L09','L10','L11','L12') -and $_.stage_role -eq 'delta' -and -not (Test-Path -LiteralPath "$VdVideo/scratchpad/vpw-var/spec-vd-$($_.id).json") } | Select-Object -First 1 -ExpandProperty id
   if (-not $VdDeltaId) { throw 'No ungenerated L01-L12 delta remains.' }
   $VdSpec = "$VdVideo/scratchpad/vpw-var/spec-vd-$VdDeltaId.json"
   py -3 $VdForge batch --kit $VdKit --batch "$VdVideo/shots.json" --video $VdVideo --shots $VdDeltaId --aspect 16:9 --out $VdSpec
   py -3 $VdForge gen --dry-run --kit $VdKit --batch $VdSpec --video $VdVideo --aspect 16:9 --image-size 1K --force
   py -3 $VdForge gen --kit $VdKit --batch $VdSpec --video $VdVideo --aspect 16:9 --image-size 1K --force
   ```

   Fresh-eyes review, stamp, and promote that result before repeating this step for the next delta; record the resolved parent digest and `changed_elements` in each genlog row.

8. - [ ] **Apply exactly one re-authored retry to each failing shot.** Diagnose the defect's causal prompt/composition mechanism; replace that mechanism in `shots.json` rather than appending `NO/never/not` patches or removing load-bearing facts. Before the live retry, recompute the same-id authored word comparison and require the retried `still_prompt` still has no more words than vb; any positive delta is re-authored again without spending a call. Set `$VdRetryId` to the failing L01–L12 id, author its one-shot versioned overlay at `$VdVideo/scratchpad/vpw-var/retry-vd-$VdRetryId.json`, then run:

   ```powershell
   $VdRetryOverlay = "$VdVideo/scratchpad/vpw-var/retry-vd-$VdRetryId.json"
   $VdRetrySpec = "$VdVideo/scratchpad/vpw-var/spec-vd-retry-$VdRetryId.json"
   py -3 $VdForge batch --kit $VdKit --batch "$VdVideo/shots.json" --video $VdVideo --shots $VdRetryId --retry $VdRetryOverlay --aspect 16:9 --out $VdRetrySpec
   py -3 $VdForge gen --dry-run --kit $VdKit --batch $VdRetrySpec --video $VdVideo --aspect 16:9 --image-size 1K --force
   py -3 $VdForge gen --kit $VdKit --batch $VdRetrySpec --video $VdVideo --aspect 16:9 --image-size 1K --force
   ```

   A parent re-generation consumes that shot's single retry and every descendant waits for its new verified digest. Count every live call against the 24-call ceiling.

9. - [ ] **Park failed and uncalled descendants honestly.** After one failed retry, store the observed defect as `review_status: parked` plus concrete `parked_reasons`. If that shot is a required parent, create a D trial-manifest row for each blocked descendant with `review_status:"parked"`, `parked_reasons:["parent LNN not verified"]`, `file:null`, and no call provenance; do not copy or count it as called. OLD → NEW is the full affected manifest row, asserted before patching. Command: reconcile the twelve ids against genlog call rows. Expected: every id is either called or parked with a reason, and every uncalled child has no output file/digest/provenance.

10. - [ ] **Close the review and manifest record.** Run `py -3 orgs/faceless-youtube/.claude/skills/image-generation/scripts/build_review_artifact.py --video $VdVideo --out "$VdVideo/assets/_review/scene-board.html" --shots L01 L02 L03 L04 L05 L06 L07 L08 L09 L10 L11 L12`, have the fresh reviewer rule every applicable row and advisory palette card, merge final rulings, and run `py -3 orgs/faceless-youtube/.claude/skills/image-generation/scripts/stamp_review.py $VdVideo`. Expected summary reflects reality, not a target; only clean frames are `verified`. Append to genlog: calls by base/retry/parent-regen, verified ids, parked ids/reasons, unused allowance, actual conservative total `calls × 0.134`, actual provider comparator `calls × 0.039`, and whether the $5 wave cap remained intact.

11. - [ ] **Copy only D-called bytes whose manifest provenance matches.** Resolve and validate `variant-frames/vd` as before. For each L01–L12 id, locate its D trial-manifest row and its genlog call row. Use the same canonical scene-manifest `notes` field vb populated from actual batch specs (`genlog.md:101-103`): for D it must record the D staging output path and SHA-256; `retry_cause` records retry provenance but is not by itself proof of a call. Copy only when (a) a D call row exists, (b) `notes` records that D staging path/digest, (c) the chosen reviewed source hashes to that digest, and (d) review status is `verified` or honestly `parked` after a call. Never copy merely because `assets/scenes/LNN.png` exists. An uncalled/blocked id stays absent from `variant-frames/vd` with `file:null` and its reason in `vd/manifest.json`.

   ```powershell
   if ($null -eq $VdEntry.file) { continue }
   $VdActual = (Get-FileHash -Algorithm SHA256 -LiteralPath $VdReviewedSource).Hash.ToLowerInvariant()
   if ($VdActual -ne $VdEntry.sha256) { throw "$VdFrameId D provenance digest mismatch" }
   Copy-Item -LiteralPath $VdReviewedSource -Destination "$VdFrameDir/$VdFrameId.png" -Force
   ```

   Create the D manifest with the existing top-level accounting fields plus per-shot `file`, `sha256`, `notes`, `retry_cause`, status, and reasons. Command: run a reconciliation script over manifest/genlog/files. Expected: every copied PNG has a D call and matching recorded digest; every uncalled id is missing with a reason; no stale prior-variant scene can pass.

12. - [ ] **Send the exact cost row to the ops writer.** The existing 08-20 ledger has five tab-separated fields with no header: narrative description; requested model; responding model; short task label; USD. Derive `$VdCalls` from actual genlog call rows, `$VdVerified` and `$VdParked` from the twelve manifest states, and `$VdLedgerDescription = 'Variant D doctrine trial: {0} calls, {1}/12 verified, {2}/12 parked; 12 base allowance + at most one retry each; conservative $0.134/call, provider-table $0.039/call; genlog scratchpad/vpw-var/genlog-vd.md on claude/bricks-variant-vd.' -f $VdCalls,$VdVerified,$VdParked`. Supply that description, `gemini-3-pro-image`, the observed responding id, `bricks variant D trial 12 shots`, and `[decimal]$VdCalls * 0.134` as the five fields (examples: 12→1.608; 24→3.216). The boss/ops writer must `git pull --rebase origin ops` immediately before the write, append on `ops`, commit/push immediately, and report the pushed row; the work branch never edits `ledgers/`.

13. - [ ] **Commit only work-product records.** Run `git diff --check`; inspect all L01–L12 manifest/ruling changes and ensure L13+ are unchanged. Stage explicit V work-product paths, excluding `ledgers/`, and commit `feat(fyt): generate variant D comparison frames`. Never stage credentials, live review-store changes outside the trial scope, or unrelated files.

**Acceptance:**

- Every L01–L12 shot is called or parked with a reason; uncalled parent-blocked children remain missing, no called shot exceeds one re-authored retry, and total live calls stay within 24/$3.216 conservative and the $5 wave cap.
- All generated scenes are 16:9, 1K, forced fresh, logged with requested/responding model and both rates; no ambiguous call is double-issued.
- Every delta was built only after its parent passed and was promoted; changed parent digests propagate before descendants run.
- Final manifest states are honest `verified|parked`; only D-called reviewed bytes with matching `notes` provenance and SHA-256 are copied, while uncalled parks have `file:null`.
- `genlog-vd.md` contains the complete call/retry/park/cost record and the exact cost row is pushed through the ops convention.

**Review gate:**

The adversarial reviewer checks spec §4.4/§6: human spend approval, exact Forge batch→gen call shape, parent-before-delta proof, fresh reviewer independence, one re-authored retry, no prompt accretion, honest called-or-parked closure, 24-call and $5 ceilings, dual-rate accounting, ledger field order, manifest isolation, byte-identical copies only for D-called rows, and absent files for uncalled parks.

### Task 4 — Build the four-variant board and conduct the blind review

**Files:**

- Modify `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/boards/build_variant_board.py:1,17-27,151-204,207-275`.
- Create `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-audit/variant-d-blind-review.md`.
- Regenerate `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/boards/variant-board.html` in place.
- Create `handoffs/2026-08-20-fyt-variant-d-trial.md` while Daniel's board decision is pending; delete it on pickup/completion per `handoffs/README.md`.
- Append the reusable lesson to `memory/claude-boss.md`; refresh `orgs/faceless-youtube/STATE.md` only if its current-state block would otherwise omit the pending Variant D human gate. Handoff, memory, and STATE are coordination writes and therefore go through `ops`, not the work branch.

**Interfaces:**

- The board continues to read branch-authored shot metadata with `git show` and local reviewed pixels/manifests from `scratchpad/variant-frames/va`, `vb`, `vc`, or `vd`; it does not check out another branch.
- The same `variant-board.html` path and existing published Artifact handle are reused; downstream links must not fork to a second board URL.
- Human taste remains the terminal decision. The blind review reports evidence/distributions and does not promote D or change doctrine automatically.

1. - [ ] **Add D to the existing variant registry with this exact dict entry.** Append after C:

   ```py
   "D": {"key": "vd", "branch": "claude/bricks-variant-vd", "description": "hold-camera chains + grounded stage palette + actor-first occupancy + bounded crowd geometry"},
   ```

   Keep A/B/C entries byte-identical. Change the module docstring from `A/B/C` to `A/B/C/D` and change `REVIEW` to `ROOT / "scratchpad" / "taste-audit" / "variant-d-blind-review.md"`.

2. - [ ] **Make the four-column layout preserve honest missing-D cards.** Apply the exact CSS/header OLD → NEW replacements for four columns, but do not claim 48 images. For the missing branch, assert and replace:

   OLD:

   ```py
   if path.is_file():
       uri = image_uri(path, quality, max_dimension)
       image = f'<img src="{uri}" alt="Variant {name}, {html.escape(shot_id)}" data-lightbox-index="{lightbox_index}">'
       lightbox_index += 1
       image_counts[name] += 1
   else:
       missing.append(f"{name}/{shot_id} image")
       image = '<div class="image-missing">frame missing</div>'
   parked = f'<p class="parked-reason">{html.escape(reason(entry))}</p>' if entry.get("review_status") == "parked" else ""
   ```

   NEW:

   ```py
   if path.is_file():
       uri = image_uri(path, quality, max_dimension)
       image = f'<img src="{uri}" alt="Variant {name}, {html.escape(shot_id)}" data-lightbox-index="{lightbox_index}">'
       lightbox_index += 1
       image_counts[name] += 1
   else:
       missing_reason = reason(entry) or "no called frame recorded"
       missing.append(f"{name}/{shot_id} image — {missing_reason}")
       image = f'<div class="image-missing">frame missing — {html.escape(missing_reason)}</div>'
   parked = f'<p class="parked-reason">{html.escape(reason(entry))}</p>' if entry.get("review_status") == "parked" else ""
   ```

   The builder already returns after writing and does not fail on `missing`; preserve that behavior. Command: run it with D/L08 parked, `file:null`, and no PNG. Expected: exit 0, D/L08 visibly says `frame missing — parent L07 not verified`, and A/B/C plus called D images still render.

3. - [ ] **Extend the decision section without preselecting D.** Add a fourth card with exact copy `Pick D` / `Use the hold-camera, grounded-palette, actor-first, bounded-crowd criterion set tested here; retain the existing engine, style tile, suffix, seeds, and render register.` Change the procedure to `reply with A, B, C, D, or an iteration note`. Replace the old first two restoration-only questions with `Which criterion set reads best shot by shot, and which individual D changes should survive even if D does not win overall?` and `Does any preferred D frame depend on a changed subject/composition rather than the criterion it is meant to test?`; preserve the remaining render-register, repair-source, symbolic-vocabulary, and reuse questions.

4. - [ ] **Give a fresh reviewer this exact blind brief with no Task 2 authoring conversation, no target counts, and no desired winner.** Inputs are every available local PNG (up to 48), all twelve manifest rows per variant including D's missing reasons, each branch's L01–L12 `shots.json` records via `git show`, spec §3.1–3.4, and the calibration fixture:

   ```text
   Review the A/B/C/D L01–L12 comparison fresh. Treat a missing D frame as missing evidence and report
   its manifest reason; never infer or substitute prior pixels. Do not infer intent from branch history, genlogs, or
   author commentary, and do not rewrite files or prompts. Apply Variant D's four criteria to every
   applicable D shot/seam: (1) camera/set/primary-subject hold plus one story-needed state change,
   judging both missed and forced holds; (2) one stage field grounded in visible light/material/story
   cause, with complements legal and recurrence questioned only across distinct stages; (3) occupancy
   chosen from the causal subject—none, one, pair, or mass—with no preferred distribution; (4) when a
   mass acts, actual primary geometry bounds and recedes it with an empty near zone, judged from pixels,
   not words. Also apply the canonical six image questions and record parks honestly. For each D row,
   report PASS/FAIL/NA and one visible reason for each applicable criterion. Then report, only after all
   shot judgments: observed chain members and missed/forced seams; dominant-field recurrence with stated
   cause; occupancy distribution in 0/1/2–3/4–6/7+ descriptive buckets; crowd-bounding outcomes; and the
   per-row A/B/C/D preference with reason. These are distributions, never targets or promotion gates.
   End with the weakest D frames first, what D improves or worsens versus each comparator, and a neutral
   human-decision menu. Do not declare a doctrine winner.
   ```

5. - [ ] **Write the complete blind review to the fixed path.** Use exactly five top-level sections so the existing board parser can embed 1–4: `## 1. Criterion rulings by D shot`, `## 2. Reported distributions after judgment`, `## 3. A/B/C/D row preferences`, `## 4. Weaknesses, comparative verdict, and human decision`, and `## 5. Method and evidence`. Section 1 contains one row per L01–L12 with separate chain/palette/occupancy/crowd cells and visible reasons; section 2 reports the four requested distributions without a desired count; section 3 has twelve row preferences; section 4 leads with weaknesses and presents options; section 5 names exact branch refs, manifests, frame paths, and the no-target rule.

6. - [ ] **Build and verify the four-column board locally.** Run:

   ```powershell
   py -3 orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/boards/build_variant_board.py
   ```

   Expected JSON: `output` ends in `scratchpad/boards/variant-board.html`; A/B/C each count 12; D's image count equals the number of D manifest rows with non-null `file` and matching PNG; `missing` lists only intentionally absent D ids with reasons; encoded board remains below 14 MiB. Inspect desktop/narrow views: four headers align, every present image opens in the lightbox, missing D cards remain visible with reasons, sections 1–4 render, and decision cards do not overlap.

7. - [ ] **Check review neutrality and criterion coverage before publishing.** Search the review for numeric imperatives (`at least`, `no more than`, `must equal`, `% target`, `minimum`, `maximum`) and remove any distribution target while retaining observed figures. Confirm all twelve D ids have a ruling, every authored D chain seam appears, every stage basis is checked against visible pixels, every crowd shot has a geometry ruling, and the review says `NA` rather than inventing a crowd finding on non-crowd frames.

8. - [ ] **Republish the existing Artifact in place.** Replace the content behind the already published A/B/C board handle with regenerated `variant-board.html`; do not create a second Artifact or new URL. Add this exact publication note to the handoff: `Republished the existing Bricks Variant Trial Artifact in place; D is now the fourth column, and the prior A/B/C URL remains canonical.` The actual URL is not stored in this clone; if the existing handle is unavailable in the publishing session, stop and request that handle instead of minting a new one.

9. - [ ] **Write the resumable human-gate handoff and durable lesson.** `handoffs/2026-08-20-fyt-variant-d-trial.md` records current branch/commit, unchanged Artifact URL, costs/calls/parks, weakest frames, blind-review path, and a Load list containing this plan, spec, final `shots.json`, `plan-vd.md`, `genlog-vd.md`, blind review, board builder, and D manifest. Append to `memory/claude-boss.md` only the reusable pattern: positive geometry belongs to critic judgment rather than lexical lint; palette rationale must reach provider-visible facts and separately labelled review metadata; fragment validators should clip the source span, size against its covered words, and keep scope out of eventual full-file JSON. Do not turn Daniel's still-pending taste choice into doctrine.

10. - [ ] **Complete the work-branch and ops records separately.** On `claude/bricks-variant-vd`, run `git diff --check`, stage only board builder/review/board work products, and commit `feat(fyt): add variant D blind comparison board`. For handoff/memory/STATE, use the coordination-write workflow on `ops`: pull/rebase immediately before each write, commit/push immediately after, and never mix those paths into the work-product commit. Report both commit ids and leave the human board decision open.

**Acceptance:**

- `VARIANTS` contains D; the board renders twelve rows across four columns, preserves visible missing-D cards/reasons for uncalled parks, renders every called D frame with matching provenance, and has no layout break.
- A fresh reviewer applies §3.1–3.4 and the six canonical image questions shot by shot before reporting chain, palette, occupancy, and crowd distributions; no distribution becomes a target or gate.
- The same Artifact handle/URL is republished in place; if that handle is unavailable, the task stops rather than publishing a duplicate.
- The handoff makes Daniel's decision resumable, memory captures only reusable process lessons, STATE is updated only if materially stale, and coordination writes land on `ops`.

**Review gate:**

The adversarial reviewer checks spec §4.5/§5: exact D registry data, twelve-row/four-column integrity with honest missing-D reasons, reviewer freshness, per-shot criterion evidence before distributions, no target language or automatic winner, transparent parks/costs, unchanged Artifact URL, complete Load list, least-general lesson routing, and strict work-branch/ops separation.
