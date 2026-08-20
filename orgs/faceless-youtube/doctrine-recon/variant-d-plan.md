# Variant D Implementation Plan
> For agentic workers: execute task-by-task; each task ends with tests + a review gate. Steps use `- [ ]`.
**Goal:** Implement and trial Variant D so its four criterion changes alter the L01–L12 image payloads and can be judged blind beside va/vb/vc without quotas or hidden targets. **Architecture:** Change each rule at its existing canonical home, keep every speaker and test synchronized, validate an officially scoped A1 fragment, generate parent-first, and extend the existing comparison board. **Spec:** `orgs/faceless-youtube/doctrine-recon/variant-d-spec.md`, rev 3.

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
- Modify `orgs/faceless-youtube/.claude/skills/image-generation/scripts/build_review_artifact.py:1-10,214-271,296-411`.
- Modify `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-audit/vd_palette_metrics.py:20-99` only to expose the agreed 165°–240° cool-pair metric to the importer without duplicating its HSV implementation.
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

   In the preceding RIG-HOLD block, replace `crowd figures instead follow the §2d CROWD-RIG clause when the prompt states it` with `crowd figures instead follow the §2d CROWD-RIG clause that Forge appends when figures.crowd is true`. Rename old `## 2d. Canonical dispatch suffix` to `## 2e. Canonical dispatch suffix`; retain the empty `global_prompt_suffix` text byte-for-byte. `forge.py::blockquote_after` matches any `## ` line containing the supplied header substring, seeks the first following blockquote, joins its `>` lines, and stops at the first blank after capture, so the new heading makes `Kit.desc_crowdrig` non-empty. The distinct lookup substrings `LOCKED STYLE descriptor`, `STYLE-ONLY descriptor`, and `RIG-HOLD descriptor` remain byte-identical and cannot collide with `CROWD-RIG clause`. KEEP `forge.py:188` comment `# §2d, expanded from figures` and its loader call because the section number and ownership remain correct. Test: `test_forge_figures.py::test_live_kit_expands_the_bible_crowd_clause`; suffix-heading assertion: `test_forge_style_tile.py::test_style_descriptor_and_empty_suffix_lock_are_loaded_from_the_bible`.

2. - [ ] **Replace the stale crowd-authorship explanation in `visual-grammar.md` in place.** Delete lines 120–145 beginning `The crowd rig differs from the full rig ONLY in the FACE` and ending `Every depicted crowd figure must satisfy both conditions`, including `§2d is authored by VPW`, `it is not auto-appended`, `The §2d words above stay in the still_prompt`, `supersedes`, and `prompt-authored (§2d) AND exemplar-seeded`. Replace them with this compact text before the occupancy paragraph:

   ```md
   **Anonymous crowd execution.** The crowd rig differs from the full rig only in the face; its squat
   head-to-body proportion matches the approved crowd exemplar. VPW declares `figures.crowd: true` and
   authors only the crowd's scene geometry, action, and era-specific dress. Forge appends the canonical
   style-bible §2d block and seeds `refs/base/crowd-exemplar.png`; named foreground cast still receive the
   full §2c rig. Review every depicted crowd figure against that exemplar.
   ```

   Test: change `test_lettering_fidelity.py::test_rig_vocabulary_attached_to_figures_is_clean` into `test_crowd_rig_boilerplate_is_forge_owned`, pass a `still_prompt` containing `CROWD RIG:` to `control_leak_check`, and assert one HARD; `test_live_kit_expands_the_bible_crowd_clause` proves the bytes return at assembly rather than authoring.

3. - [ ] **Replace the single story-bearer sentence with the positive occupancy and crowd criterion.** Replace exact old text `**Story bearer.** Every story-bearing individual is seeded named cast. Only a genuine rearward mass beat uses the simplified crowd rig.` with:

   ```md
   **Occupancy follows the acting subject.** Decide occupancy from who is acting in this beat: no human
   when mechanism, quantity, place, object, or absence is the subject; one seeded performer for one
   person's decision, action, or reaction; a seeded pair when an exchange, relationship, or shared labour
   makes the sentence true; the simplified crowd rig only when the subject is the mass. Three ordinary
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
   dominant field derived from its light source and dominant material, plus at most two supporting
   colours; complements are valid when those facts create them; a palette turn changes the dominant
   field, not the names of the same pair. Colour with no physical or story cause is not written. Only
   the character's own colours are fixed:
   ```

   No hue family is banned and no recurrence/count target is added. Test: the bible assertions in `test_doctrine_reset_guards.py::test_variant_d_doctrine_owners_are_consistent`, `test_build_review_artifact.py::test_palette_card_uses_165_to_240_cool_pair_without_gating`, and the doctrine echo sweep in step 25.

6. - [ ] **Rewrite the VPW decision order and stage timing at the existing Step 3 home.** Replace ``run **Step 2.5** on its VO line (classify → cast → stage the tableau → state the facts), then write the `still_prompt` `` with ``decide the subject → acting participants → occupancy → shot class → cast → tableau → drawable facts, then write the `still_prompt` ``. In the Shorts paragraph, replace `(classify → cast → tableau → facts → intent note)` with `(decide subject → acting participants → occupancy → shot class → cast → tableau → drawable facts → intent note)`. Replace `Keep every planned stage and its whole chain inside one partition` with:

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

   Replace both Step 3 and Step 7 copies of `confirm a progressive in-shot reveal` with `confirm a story-needed held state change or a non-empty hold_reason`. Test: the VPW assertions in `test_doctrine_reset_guards.py::test_variant_d_doctrine_owners_are_consistent`.

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

8. - [ ] **Align the earlier schema speaker and execution fields.** In `shots-schema.md:131-149`, replace `This is the still-era realization of §13a-i's progressive reveal` with `Authoring chooses a stage only by the canonical hold-camera criterion below`; replace the paired author-facing sentences `DELTA-CHAIN when the change is INTEGRATIVE` and `LAYER when the change is DISCRETE and seedable` with `Author stage intent once; image-generation realizes an integrative change as parent-seeded regeneration and motion-planner realizes a discrete seedable change as a layer.` Preserve same-location re-base, intent-only, ≤3, timing, and per-member `vo_ref`. At line 170 append `An ordinary non-contact pair is two cast records on a fresh base.` At line 179 replace `Interactions are just kind: interaction` with `Physical-contact pairs use an existing kind: interaction route; if none fits, emit needed_assets and stop at the existing human approval/veto gate. Do not promise a three-person seed path.` Test: existing interaction HARD tests plus the doctrine equality test in step 21.

9. - [ ] **Remove the remaining schema claims that VPW should carry generated rig prose, without adding fragment metadata.** Replace lines 300–302 ending `figures on the CROWD RIG (round cream heads, DOT EYES, NO noses/ears/teeth) is legal and common` with `Concrete depicted-body facts are legal, but canonical rig blocks are Forge-owned and never copied into still_prompt.` Replace line 350's `real progressive reveal` with `story-needed held state change`. Leave the top-level JSON example and field-list prose unchanged: rev 3 declares fragment scope only through the lint CLI, so `fragment_scope`, `start_anchor`, and `end_anchor_exclusive` must not appear in the schema, an example, or a generated `shots.json`. Test: step 15 asserts the vb input remains byte-semantically free of fragment metadata before and after `--fragment --write`.

10. - [ ] **Make the critic symmetric and point it at calibration evidence.** Replace exact line `> Apply the canonical six shot questions in the channel style-bible.md review-criteria section and the canonical plan-level chain/disclosure contract in references/shots-schema.md.` with the following block, whose first sentence preserves that pointer and six-question ownership:

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

12. - [ ] **Align lint chain wording without expanding lexical authority.** In `lint_piece`, replace `progressive reveal or non-empty hold_reason` with `story-needed held state change or non-empty hold_reason`. In `stage_check` replace `a chain exists only for a progressive reveal` with `stage membership is authored by the schema's hold-camera criterion; lint enforces structure only`. In `delta_feasibility_check`, preserve `_NON_MATERIAL_DELTA` bytes exactly and replace `author a genuine progressive reveal or hard cut` with `author one visually distinct, story-needed state change or hard-cut`. In `interaction_cast_check`, replace `when the contact begins a genuine progressive reveal, stage the fresh two-figure shot as its BASE` with `when contact begins a story-needed held state change, stage the fresh two-figure shot as its BASE`. KEEP the `figures.crowd` type check's `it gates the section 2d CROWD-RIG clause` and the derivation comment `derives the crowd rig from figures.crowd`; both remain accurate. Keep lexical matches HARD only for their existing obvious no-op vocabulary; materiality remains the critic's decision. Test: update `test_new_guards.py` existing material/no-op pair and fixture non-oracle assertion; do not blacklist any of the 26 ids or phrases.

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

   After `hard, soft = [], []`, add `if fragment and not lf_shots: hard.append("[long-form] --fragment requires at least one long_form.shots record.")`. Change only the long-form call to `lint_piece(..., new_plan=strict_schema, fragment=fragment)`; leave every Shorts call on its existing signature/default and leave thumbnail checks untouched. No field is read from or written to JSON. Test: step 15's empty-list and short/thumbnail-isolation cases.

14. - [ ] **Size and tile the long-form covered span inside `lint_piece`, leaving every other rule unchanged.** Change the signature to `def lint_piece(label, shots, md_path, hard, soft, word_timings=None, new_plan=True, fragment=False):`. Before the sizing block, compute `md_matches = match_shots_to_tokens(shots, md_toks) if md_toks else []`, initialize `covered_vo = vo` and `covered_words = None`, and under `fragment` require both a parseable script and a matched last anchor. Find that match's token index by its returned character offset, set `covered_end_i = last_i + len(md_matches[-1]["needle"])`, set `covered_end = md_toks[covered_end_i][1] if covered_end_i < len(md_toks) else len(vo)`, and use this exact branch:

   ```py
   if fragment and not md_toks:
       hard.append(f"[{label}] --fragment requires a parseable script.md to compute covered words.")
   elif fragment and shots:
       last = md_matches[-1]
       if not last["needle"] or last["start"] is None:
           hard.append(f"[{label}] --fragment cannot resolve the last shot anchor in script.md.")
       else:
           last_i = next(i for i, tok in enumerate(md_toks) if tok[1] == last["start"])
           covered_end_i = last_i + len(last["needle"])
           covered_end = md_toks[covered_end_i][1] if covered_end_i < len(md_toks) else len(vo)
           covered_vo = vo[:covered_end].rstrip()
           covered_toks = [tok for tok in md_toks if tok[1] < covered_end]
           covered_words = len(covered_toks)
           soft.append(f"fragment scope: covered {covered_words}/{len(md_toks)} script words")
   ```

   In the `if vo_words:` sizing block, when `fragment` is true and `covered_words is not None`, require `wpm` from `header_pace(md_path)` and compute `runtime_s = covered_words / wpm * 60.0` and `rate = f"{covered_words} covered script words / {wpm:.0f}wpm, per the header"`; if the header has no pace, append `[{label}] --fragment requires a positive header WPM.` as a HARD and skip the two sizing comparisons because no valid partial runtime exists. When `fragment` is false, retain the whole-file WPM/stated-runtime/fallback branches byte-for-byte. Run the existing duration and cadence comparisons against the covered `runtime_s` when it exists; do not defer either sizing rule. Reuse the already-computed `md_matches`, and for derivation call `tile(shots, md_matches, len(covered_vo), covered_vo)` under the flag so the last included shot ends at the last anchor rather than EOF; the normal `tile(..., len(vo), vo)` path stays unchanged. `--write` remains the sole writer and still skips on any HARD.

15. - [ ] **Add six focused rev-3 fragment tests to `test_shots_v2.py`.** Add imports `subprocess` and `copy`, then add these exact helpers before the cases:

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

   def _run_vb_fragment(tmp_path, monkeypatch, *flags, data=None):
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
       (tmp_path / "script.md").write_text(_git_text("script.md"), encoding="utf-8")
       path = tmp_path / "shots.json"
       path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
       return lint_shots.main([str(path), *flags]), path
   ```

   The six collected cases and exact expectations are:

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

16. - [ ] **Add only non-crowd occupancy diagnostics through the existing `soft` list.** Add `occupancy_diagnostics(label, shots, id2text, chars, soft)` and call it after `lf_text` is available. A figure count is the union of legacy `cast[].character` and current inline backticked names resolved by `video_chars`; exclude `figures.crowd: true` records from these diagnostics because crowd subject and geometry belong wholly to canonical critic question 3. Emit only: one row per maximal zero-human/non-crowd run with ids, summed `duration_s`, joined `vo_ref`, and clipped derived `vo_text`; and one row per one- or two-cast shot with cast slugs, `assets=ready` or `assets=missing:comma-separated-slugs`, and `base=standalone|fresh-stage-base|delta`. These are heads-up rows only and contain no run-length, occupancy-share, or pair quota. Add no crowd diagnostic, lexical boundary-noun/spatial-relation detector, prose inspection, size threshold, or HARD: actual bounding/recession/empty-near-zone judgment lives only in question 3.

17. - [ ] **Test the two non-crowd diagnostic row shapes without testing a target distribution.** In `test_new_guards.py`, add `test_zero_human_run_reports_ids_duration_and_vo` and `test_one_and_two_cast_rows_report_assets_and_base`; call `occupancy_diagnostics` directly, assert `hard` is not an argument, assert the exact identifying fields occur in `soft`, and pass a `figures.crowd: true` record to prove it emits no crowd row. Do not add `test_crowd_row_reports_vo_class_and_neighbours`, `test_crowd_prompt_has_boundary_words`, minimum cast shares, maximum zero-run lengths, or human-count thresholds.

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

19. - [ ] **Align image-generation's stage and crowd speakers.** Replace IG lines 181–183 `the §2d words stay in still_prompt` with `Forge appends bible §2d from figures.crowd; the exemplar seed pins proportion and face.` Replace lines 196–200 `Ignore every motion/beat field — stage/stage_role/changed_elements` with `Read stage/stage_role/changed_elements for parent routing and one-change validation, never to re-decide whether VPW may author the stage; ignore beat and retired motion keys.` In technique (e), prepend `VPW has already admitted the stage by the hold-camera criterion`; retain integrative parent regeneration, discrete layer routing, same-location base, and ≤3. In existing `test_figure_staging_doctrine_has_one_channel_home`, replace `assert "story-bearing" in GRAMMAR` with `assert "Occupancy follows the acting subject" in GRAMMAR` and retain `assert "story-bearing" not in IG`; extend existing `test_vpw_points_to_schema_instead_of_repeating_transport_law` with authoring/realization ownership assertions across schema, IG, animation rules, motion-planner SKILL, and motion schema. These are extensions, not new collected tests.

20. - [ ] **Extend the live Forge tests rather than Forge code.** Add to `test_forge_figures.py`:

   ```py
   def test_live_kit_expands_the_bible_crowd_clause():
       bible = (KIT / "style-bible.md").read_text(encoding="utf-8")
       expected = forge.blockquote_after(bible, "CROWD-RIG clause")
       kit = forge.Kit(str(KIT), dry=True)
       prompt = kit.prompt_for(mode="environment", delta="A bounded queue behind glass.",
                               figures={"crowd": True})
       assert expected
       assert kit.desc_crowdrig == expected
       assert expected in prompt
       assert prompt.endswith("A bounded queue behind glass.")
   ```

   Extend existing `test_the_crowd_exemplar_is_refused_without_a_record` with `assert "figures.crowd" in err` and `assert "crowd-exemplar" in err`; do not create a duplicate refusal test. Update the hard-coded suffix heading in `test_forge_style_tile.py` from `## 2d. Canonical dispatch suffix` to `## 2e. Canonical dispatch suffix`. Add assertions that `desc_identity`, `desc_style`, and `desc_righold` equal their pre-move blockquotes, so heading matching cannot steal another descriptor.

21. - [ ] **Extend the review artifact's cards and keep palette rationale distinct from failure notes.** Add `PALETTE_NOTE_PREFIX = "Palette basis:"`, `stage_key(shot) = shot.stage or shot.id`, and `palette_basis_by_stage(S)` that accepts a basis only from a base/standalone shot's `notes` line beginning exactly with that prefix; map it to every card sharing the effective stage. In `collect`, replace the card payload with the old keys plus exact new keys `still_prompt=s.get("still_prompt") or ""`, `stage=stage_key(s)`, `palette_basis=basis.get(stage_key(s), "")`, and `palette=palette_metrics(path, video)`. Keep `reason=manifest.notes` unchanged and render `palette_basis` in its own labelled row, never concatenated with `reason`.

22. - [ ] **Reuse the measured palette implementation for advisory card metrics.** In `vd_palette_metrics.py`, add `COOL_PAIR = (165.0, 240.0)` and return `cool_pair_chroma` plus `complementary_pair_chroma = orange_chroma + cool_pair_chroma` from existing `metrics()` using existing `rgb_to_hsv` and `in_band`; do not alter the current report's other fields. In `build_review_artifact.py`, derive `Path(video) / "scratchpad" / "taste-audit" / "vd_palette_metrics.py"`, import it with `importlib.util.spec_from_file_location`, call its `metrics(Path(path))`, and keep only `warm`, `cool`, `orange_chroma`, `cool_pair_chroma`, and `complementary_pair_chroma` for the card. This import is appropriate for the Variant D video because it reuses the already-calibrated HSV/SAT implementation and avoids a second detector. If the module is absent for another video, render each metric as `unavailable — no palette metrics module` and continue; the D test fixture must contain the module and yield numeric values. Render available values as percentages labelled `advisory — reviewer judges cause, never a gate`.

23. - [ ] **Test review-card transport and advisory metrics.** Add four collected tests to `test_build_review_artifact.py`: `test_stage_members_inherit_only_prefixed_base_palette_basis`, `test_standalone_uses_its_own_stage_and_basis`, `test_collect_keeps_manifest_reason_separate_from_prompt_stage_and_basis`, and `test_palette_card_uses_165_to_240_cool_pair_without_gating`. Build tiny 16:9 red/orange/cyan fixtures with Pillow, assert the returned field names and percentages, and assert no `flagged`/`review_status` value changes when the pair share is high. Update `test_board_embeds_images_at_ordinary_scale` card fixture with the four new card keys and assert the HTML contains the prompt, stage, basis, and `advisory` label.

24. - [ ] **Wire the scene board into the canonical IG review gate.** After IG line 251, add this exact sentence:

   ```md
   Before fresh-eyes rulings, set `$VIDEO_DIR` to the current video folder and run `py -3 .claude/skills/image-generation/scripts/build_review_artifact.py --video $VIDEO_DIR --out "$VIDEO_DIR/assets/_review/scene-board.html"`; review each card's `still_prompt`, effective stage, inherited `Palette basis:` metadata, and advisory warm/cool and complementary-pair shares, judging whether light/material/story cause supports recurrence rather than targeting any hue or share.
   ```

   Keep the existing one-pass review, one re-authored retry, honest park, and stamp behavior unchanged. Extend existing `test_generation_procedure_keeps_verified_asset_gate` to assert the scene-board command and advisory language; do not add a collected test.

25. - [ ] **Run the exact §2d/authorship, echo, and encoding sweeps before the test gate.** The sweep explicitly includes `orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md:182` (delete `the §2d words stay in the still_prompt`) and `orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_style_tile.py:243` (replace the hard-coded `## 2d. Canonical dispatch suffix` with `## 2e. Canonical dispatch suffix`). Then require zero matches for every deleted phrase in the brief's grep list with:

   ```powershell
   rg -n -i -e 'a chain exists only for a progressive reveal' -e 'progressive reveal or non-empty hold_reason' -e 'author a genuine progressive reveal or hard cut' -e 'genuine progressive delta' -e 'confirm a progressive in-shot reveal' -e 'give any long shot a progressive reveal' -e 'a shot exceeds ~8s ONLY with a progressive' -e 'Stage the run — held evolving stages' -e 'This is the still-era realization' -e 'DELTA-CHAIN when the change is INTEGRATIVE' -e 'Interactions are just.*kind: interaction' -e 'figures on the CROWD RIG' -e '≤2[- ]delta' -e 'base \+ ≤2' -e 'base \+ 2 deltas' -e 'Continuity, cheapest first' -e 'Precondition — the two-test boundary' -e 'bounded by the two-test boundary' -e 'ARROWS, routes, and PROGRESSIVE REVEALS are MOTION' -e 'The boundary this spec serves' -e 'Classify each shot.*two-test boundary' -e 'write INTO a crowd scene.s prompt' -e 'crowd figures instead follow the §2d CROWD-RIG clause when the prompt states it' -e '§2d is authored by VPW' -e 'it is not auto-appended' -e 'prompt-authored \(§2d\)' -e '§2d words.*stay in.*still_prompt' -e '^\*\*Story bearer\.\*\*' -e 'Only a genuine rearward mass beat' -e 'Locked to the character; NOT locked globally' -e 'palettes move freely per video' -e 'classify → cast → stage the tableau → state the facts' -e 'classify → cast → tableau → facts → intent note' -e 'Keep every planned stage and its whole chain inside one partition' -e 'Ignore every motion/beat field' -e 'assert "story-bearing" in GRAMMAR' -e '## 2d\. Canonical dispatch suffix' orgs/faceless-youtube/.claude/skills orgs/faceless-youtube/knowledge/research/niche-playbooks/universal.md orgs/faceless-youtube/channels/the-second-take/visual-kit
   rg -n 'CROWD-RIG clause|CROWD RIG:|DOT EYES|§2d|integrative' orgs/faceless-youtube/.claude/skills orgs/faceless-youtube/channels/the-second-take/visual-kit
   $VdEncodingRoots = @('orgs/faceless-youtube/.claude/skills/visual-prompt-writer','orgs/faceless-youtube/.claude/skills/image-generation','orgs/faceless-youtube/.claude/skills/motion-planner','orgs/faceless-youtube/.claude/skills/render-builder','orgs/faceless-youtube/channels/the-second-take/visual-kit','orgs/faceless-youtube/knowledge/research/niche-playbooks/universal.md')
   $VdBadCodepoints = @([char]0x00C2,[char]0x00C3,[char]0x00E2,[char]0xFFFD)
   Get-ChildItem -LiteralPath $VdEncodingRoots -File -Recurse | Select-String -SimpleMatch -Pattern $VdBadCodepoints
   ```

   The second command is an ownership audit, not a zero-match assertion: the CROWD-RIG bytes may occur only in bible §2d and tests; `§2d` may point only to the crowd clause; `integrative` may remain only in downstream realization language. The mojibake command must return no rows in touched files.

26. - [ ] **Run both test suites and repository checks.** From `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts`, run `py -3 -m pytest`; baseline is 101 and ten new collected tests make the expected result `111 passed`: one combined doctrine-owner test, one fixture test, six fragment tests, and two non-crowd diagnostic tests. From `orgs/faceless-youtube/.claude/skills/image-generation/scripts`, run `py -3 -m pytest`; baseline is 166, one new Forge test plus four review-artifact tests make `171 passed` (the seedless refusal is an extension, not a new case). Total expected is 282. Then run `git diff --check`; set `$VdTouchedPaths = git diff --name-only -- orgs/faceless-youtube`, read each existing path with `[IO.File]::ReadAllText((Resolve-Path $VdTouchedPath), [Text.Encoding]::UTF8)`, and throw if any contains U+FFFD. The explicit path list comes from the diff and no filename is inferred.

27. - [ ] **Review and commit the doctrine phase only after the gate passes.** Inspect `git diff --stat` and `git diff --` for every Task 1 file; confirm no new doctrine heading except bible §2d, no deleted test, no fixture outside the pinned 26 cases, and no unrelated dirty file staged. Stage explicit Task 1 paths and commit with `feat(fyt): implement variant D doctrine and fragment lint`. Never use `git add -A`, `git commit -a`, or push to `main`.

**Acceptance:**

- Every old→new row above is applied at the named owner; all stale copies are deleted in the same patch.
- `Kit.prompt_for(mode="environment", delta="A bounded queue behind glass.", figures={"crowd": True})` contains the exact moved bible blockquote, while the existing seedless-crowd request still refuses.
- The vb 45-shot file produces its existing two sizing HARDs without `--fragment`, but produces zero sizing HARDs with the flag, prints `fragment scope: covered 293/1628 script words`, writes 45 clipped `vo_text` spans on a clean `--write`, and writes no fragment metadata; a sparse 20-shot version retaining L45 still trips duration coverage against the same covered span.
- The canonical chain cap is ≤3 everywhere; lint remains structural/lexical and the critic owns semantic materiality.
- Canonical question 3 includes occupancy/crowd judgment while preserving registry, role, and outfit checks; question 5 and the six-question count remain intact.
- Crowd geometry is the spec's single positive sentence and canonical question-3 judgment; lint emits no crowd diagnostic, lexical rule, ban, size threshold, or count gate.
- Palette light/material facts reach base `still_prompt`; prefixed base `notes` reach every same-stage review card separately from manifest failure reasons; metrics remain advisory.
- Test totals are exactly 111 VPW + 171 IG = 282, both green; echo sweep, mojibake sweep, and `git diff --check` are clean.

**Review gate:**

The adversarial reviewer checks rev-1 F1–F12 plus rev-2 N1–N4 and rev-3 F2: exact `--fragment` argv parsing, covered-span sizing/clipping, no JSON metadata or deferred sizing rows, unchanged Shorts/thumbnail/non-sizing rules, six-question preservation, no crowd ban or lexical geometry detector, palette facts reaching provider-visible prose, prefixed basis propagation, shot-level no-growth enforcement downstream, one ≤3 authority, exact moved bytes, non-oracle calibration, and zero stale author-authorship/suffix-heading copies.

### Task 2 — Author VPW A1 under Variant D, lint the fragment, and run the critic

**Files:**

- Create `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/vpw-var/plan-vd.md`.
- Create `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/vpw-var/fragment-A1-vd.json`.
- Modify `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json` in place as the production-shaped, officially scoped A1 file.
- Create `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/vpw-var/critic-vd-A1.md` for the independent findings and author's disposition.
- Read, do not modify, `scratchpad/vpw-var/plan.md`, `scratchpad/vpw-var/fragment-A1.json`, `scratchpad/taste-audit/vd-occupancy-forensics.md`, `script.md`, `visual-kit/registry/registry.json`, and Task 1's calibration fixture.

**Interfaces:**

- Task 3 consumes `V/shots.json`, not the fragment scratch copy; its L01–L12 records, `vo_text`, stages, `Palette basis:` base notes, cast/interaction routes, and crowd declarations are authoritative.
- Task 3 may proceed only after `--fragment` reports `fragment scope: covered 293/1628 script words` and zero HARD, the independent critic has completed one covered-span findings cycle, the author has disposed every finding, and the final covered-span lint is again zero HARD.
- Task 4 compares D by the L01–L12 order and reads D's prompt/stage metadata from branch `claude/bricks-variant-vd`.

1. - [ ] **Create `plan-vd.md` with the inherited partition and boundary lock before authoring.** Copy the seven vb partition rows exactly: A1 opening through `Terry Johnson was out the door.` with 45 shots/~98s and cast `pc-boxy,rival-pc,drive-maker,miniscribe-rep,ibm-suit,terry-johnson,line-worker`; A2 Wiles arrival through invented-count setup/~50; A3 blank numbers through clean audit/~48; A4 inventory fraud through audit pass/~58; A5 layoffs through restatement/~42; A6 lawsuit through settlement/~35; A7 conviction through HR payoff/~32. Preserve these exact boundaries: A1 does not reveal MiniScribe before its company-name line, bricks before the title-giveaway line, or collapse before `Now rewind`; no stage/place chain crosses an act; Wiles/banker start fresh bases in A2; courtroom remains inside A6; HR personification enters only on its narrated reveal. Record that vb declares no A1 `place` ids or `place_anchor`, so D carries the same no-cross-act place boundary rather than inventing a place catalog.

2. - [ ] **Record the actor-first and palette input table in `plan-vd.md` before writing prompts.** Use these entries as judgments to make, not occupancy or stage targets; `none` means the mechanism/object/place/absence is the acting subject, and palette rows are per-shot candidates that are consolidated only after stages are decided:

   | ID | Acting participant/subject | Candidate dominant field + physical/story basis |
   | --- | --- | --- |
   | L01 | none; era room + mystery carton | indigo field; night-window and TV light over walnut den |
   | L02 | one seeded arcade player; onlooker optional only if critic finds the exchange load-bearing | cobalt field; mall skylight on terrazzo with peach arcade spill |
   | L03 | none; trophy carton | teal field; office-window light across brass plinth and filing bays |
   | L04 | `pc-boxy`; reaction to carton | cool teal field; aisle skylight on pale shelving and cable |
   | L05 | none; calendar/computer time fact | cream-teal field; shop daylight on oak counter and green wall panels |
   | L06 | none; new-machine scale | cream-teal field; roof-truss daylight over teal exhibition bench |
   | L07 | seeded `shop-clerk` + `shop-customer`; craze as an exchange | cobalt field; high skylight over walnut shelving and brass rail |
   | L08 | same clerk/customer pair; purchase handoff | cobalt field; held skylight and walnut shelf with newly exposed backing |
   | L09 | crowd; aggregate demand is the mass | cobalt field; held retail skylight over walnut shelves and brass boundary |
   | L10 | none; product analogy | blue field; open-door daylight over display ramp and shelves |
   | L11 | none; hard-drive hero object | green field; high workshop windows on brass tools and walnut bench |
   | L12 | none; computer–drive relationship | green-cream field; workshop window light across cutaway table and copper conduit |
   | L13 | none; stored memory | indigo field; unlit computer and closed envelope on walnut desk |
   | L14 | none; three stored categories | sage field; diffuse shelf light across open casing and physical drawers |
   | L15 | none; universal dependency mechanism | pale green field; showroom daylight across PC row and central drive |
   | L16 | `pc-boxy` + `rival-pc`; rivalry | blue field; retail daylight on opposing shelf rows and brass rail |
   | L17 | same personified pair; market pressure object | blue field; held retail daylight with one new brass bell |
   | L18 | same personified pair; hidden beneficiary | blue field; held aisle light with one modest drive below bell |
   | L19 | `drive-maker`; supplier earning | ochre field; supply-hall sunlight on timber counter and brass pan |
   | L20 | `drive-maker`; gold-rush comparison | ochre field; held horizon light on timber stalls and pick-shaped holder |
   | L21 | none; product as prospector's find | ochre field; open-land light across brass pan and ordinary pebbles |
   | L22 | none; suspicious scale of cartons | kraft field; warehouse skylight on clay seams and charcoal racks |
   | L23 | `pc-boxy`; suspense reaction | cool charcoal field; aisle-end light around carton and pallet slats |
   | L24 | none; closed carton packing tableau | kraft field; high-rack skylight on clay seams and steel-blue wall |
   | L25 | none; first brick reveal | kraft field; held skylight on open carton and clay brick |
   | L26 | none; repeated brick proof | kraft field; held skylight across opened pallet face and clay bricks |
   | L27 | none; aftermath corridor invitation | cool blue field; distant assembly glow beyond kraft carton flap |
   | L28 | `miniscribe-rep`; company introduction | teal field; high factory windows on conveyor steel and cream floor |
   | L29 | none; Colorado origin plan | pale green field; drafting-table light on wood relief and brass tool |
   | L30 | `terry-johnson`; founder action | teal field; factory-window light across assembly bench and casing |
   | L31 | none; boom as contained heat | teal-amber field; furnace glow inside tall steel frame and empty floor |
   | L32 | `ibm-suit` + `miniscribe-rep`; supply agreement | teal field; cool factory windows on shared conveyor and crate edge |
   | L33 | same pair; production rise | teal field; held window light with one new tower of boxed drives |
   | L34 | `miniscribe-rep`; scale reaction | cream-teal field; atrium light on brass balance and drive boxes |
   | L35 | `miniscribe-rep`; peak pressure | teal field; bright factory light under oversized drive-box canopy |
   | L36 | none; giant-customer scale | pale blue field; loading-yard daylight on pallet, docks, and tower silhouette |
   | L37 | `miniscribe-rep`; boast under weight | teal-brass field; factory light on money weight, drive, and cartons |
   | L38 | none; inflation comparison | cream-blue field; high windows on balance beam and brass stacks |
   | L39 | `miniscribe-rep`; qualifier reaction | cool blue field; rear-bay light around hollow money weight and open floor |
   | L40 | none; full outbound operation | slate field; paper-white loading doors under blue roof trusses |
   | L41 | none; operational collapse/absence | slate field; held door light exposing the emptied rack positions |
   | L42 | none; company cliff metaphor | slate field; pale sky over charcoal drop and paper-cut factory block |
   | L43 | `line-worker`; layoff consequence | winter blue field; exit light through cold locker corridor and pink notice |
   | L44 | `terry-johnson`; departure | slate field; open-door light across silent benches and abandoned casing |
   | L45 | none; founder absence | paper-white/slate field; cold high-window light on empty bench and open exit |

3. - [ ] **Resolve the three missing human identities before authoring any dependent shot.** Search `registry.json` and the video library first; current evidence has no `arcade-player`, `shop-clerk`, or `shop-customer`. Add these entries to the existing top-level `needed_assets` array: `{kind:"character", slug:"arcade-player", wants:"small 1980s arcade player in period casual clothing", why:"L02 causal era action"}`, `{kind:"character", slug:"shop-clerk", wants:"small 1983 computer-shop clerk in plain period retail clothing", why:"L07-L08 purchase exchange"}`, and `{kind:"character", slug:"shop-customer", wants:"small 1983 customer in plain period clothing", why:"L07-L08 purchase exchange"}`; then stop at the existing human gate. If approved, materialize/register through the existing asset path and remove the resolved entries; if vetoed, restage those beats, remove the obsolete requests, and repeat the actor-first judgment. Do not substitute an unrelated named identity or promise a third independently seeded human.

4. - [ ] **Name the exact pair execution routes.** L07 is a fresh base with two cast records ordered left=`shop-clerk`, right=`shop-customer` and the existing `handoff` interaction asset on both records; L08 may continue only if the final stage decision and seed-cap plan remain renderable, otherwise re-base it with the same two identities and `handoff`. L02 uses one `arcade-player` cast record by default; a non-contact onlooker may be added only as a second approved cast record on a fresh base, with no interaction template. Existing personified pairs L16–L18 and L32–L33 use their existing canonicals; no contact interaction is invented.

5. - [ ] **Author all 45 A1 shots from the actor/palette table, preserving vb's partition, disclosure, cast, and source boundaries.** Run the new decision order independently on each VO beat. Reuse facts that remain load-bearing, but do not mechanically edit vb prompts: rewrite every affected composition from its subject, acting participants, occupancy, tableau, and drawable facts. Every base/standalone `still_prompt` must contain the light/material facts that realize its chosen field; put no palette rationale only in metadata. Preserve `global_prompt_suffix: ""`, cast promotion/seeding, style tile, crowd exemplar, shot ids/order, verbatim `vo_ref`, and the one-change floor.

6. - [ ] **Apply crowd geometry only where the mass is the narrated subject.** For L09, author the crowd in the primary clause inside a named physical container such as `behind the brass queue rail, beneath the high skylight, with the full foreground aisle empty`; set `figures: {"crowd": true}` and omit all CROWD-RIG descriptor prose. Re-judge L02 and L15 rather than carrying vb's crowd declarations: L02 is an era action and L15 is a dependency mechanism under the table above. Do not force a crowd count, figure-height percentage, or number of crowd shots.

7. - [ ] **Decide stages only after the 45 individual shots exist.** Walk adjacent shots and apply the two questions: can camera/set/primary subject hold, and does the next beat make exactly one visually distinct, story-needed state change? Treat vb L05→L06 and L08→L09 plus vc's L09→L10 class as candidates the critic must pass, not required chains. Re-evaluate vb's existing `retail-shelf`, `pc-rivalry`, `drive-seller`, `brick-carton`, `miniscribe-rise`, and `order-collapse` runs on the same criterion; split any forced hold and add any missed hold. Preserve the explicit L11 hero-object → L12 relational diagram hard cut.

8. - [ ] **Finish the plan lock with actual stage field+basis rows after stage decisions.** For each resulting shared `stage` and every standalone id, write exactly one row: `effective stage id | member ids | dominant field | Palette basis: field — depicted light source + dominant material/story fact`. Copy the exact prefixed sentence into the base/standalone shot's `notes`; copy its drawable light/material facts into that base's `still_prompt`. Do not put the prefix on deltas, do not create a palette schema field, and do not leave candidate rows for stages that were rejected.

9. - [ ] **Materialize both A1 artifacts without encoding scope in JSON.** Write the 45 authored records to `fragment-A1-vd.json` under its sole top-level `shots` array. Update the existing production-shaped `V/shots.json` in place, preserving its schema/channel/video/aspect/thumbnail/short scaffolding, setting its 45 long-form shots to those exact records, and keeping `global_prompt_suffix: ""`. Do not add `fragment_scope`, start/end anchors, or any other partial-file metadata: the implementation-time CLI flag declares the scope. Parse both with `py -3 -m json.tool`; assert ids are exactly `L01` through `L45` once each, the scratch fragment records equal `shots.json.long_form.shots` before derived `vo_text` is written, and `rg -n 'fragment_scope|start_anchor|end_anchor_exclusive' V/shots.json` returns no rows.

10. - [ ] **Run the official fragment lint with derivation.** From repo root run:

   ```powershell
   py -3 orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts/lint_shots.py orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json --write --fragment
   ```

   Expected: exit 0; `fragment scope: covered 293/1628 script words`; `HARD violations: none`; no `DEFERRED fragment_scope` row; `WROTE derived vo_text (45 shots). JSON valid.`; plus descriptive zero-human and one/two-cast rows with no promotion effect and no crowd diagnostic. Both sizing checks run against ~100s (`293 covered script words / 175wpm, per the header`), and every other HARD keeps its existing meaning. Any HARD is a real defect and must be repaired before critic dispatch.

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

14. - [ ] **Build the dispositive per-shot payload diff against vb in `plan-vd.md`.** Read vb with `git show claude/bricks-variant-vb:orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`; for every id L01–L45 add one row with columns `id | vb authored words | vd authored words | delta | exact lower-value text removed | exact field/basis/participant/geometry fact replacing it | assembled-provider delta | verdict`. Count authored words with `len(still_prompt.split())`; compute provider words by calling dry `Kit.prompt_for` for each branch-equivalent payload so moved crowd rig bytes are reported separately. The verdict is `PASS` only when the authored delta is non-positive, or when a positive delta names in that same row both the exact lower-value words removed and the necessary replacement fact. Any other positive row is `REJECT—reauthor`: re-author that shot and rebuild its row before generation. Report assembled-provider deltas in their own column and never use them to excuse authored growth; crowd shots are expected to gain Forge-appended §2d bytes there. Do not calculate or gate on an aggregate or median.

15. - [ ] **Prove the four pixel levers are materially present before generation.** In `plan-vd.md`, record: final candidate-seam decisions with critic reasons; the exact prompt substring carrying each stage base's drawable light/material basis; every selected one/two/crowd occupancy and its asset route; and every crowd's primary bounding geometry plus empty near zone. Compare L01–L12 payload bytes to vb and fail the gate if they are identical after whitespace normalization.

16. - [ ] **Commit the authored fragment only after review.** Run `git diff --check`, the Task 1 VPW suite (`111 passed`), and the official lint once more. Stage only `plan-vd.md`, `fragment-A1-vd.json`, `critic-vd-A1.md`, and `V/shots.json`; commit `feat(fyt): author variant D A1 visual plan`. Do not stage generated frames, unrelated untracked files, or coordination paths.

**Acceptance:**

- `V/shots.json` contains L01–L45 and no fragment metadata; the `--fragment` invocation prints `covered 293/1628`, runs both sizing checks against that span, produces zero HARD, and writes fresh clipped `vo_text`.
- The independent critic completes one normal cycle; every finding is accepted and repaired or rejected with a concrete reason; every final chain passes both missed-hold and forced-hold judgment.
- Every resulting base/standalone carries one prefixed `Palette basis:` note and provider-visible light/material facts; same-stage cards can inherit the basis unambiguously.
- Every pair uses approved identities and a fresh-base route; contact uses registered `handoff` or stops at `needed_assets`; no trio is promised.
- Every crowd is selected because the mass acts and is judged from actual bounded/rearward/empty-near-zone geometry, not a lexical match.
- The 45-row vb diff is complete; unexplained positive authored growth is rejected shot by shot, and assembled-provider crowd-rig growth is reported separately.
- L01–L12 payloads differ materially from vb through one or more validated stage, palette, occupancy, or crowd-geometry levers before any image call.

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

8. - [ ] **Apply exactly one re-authored retry to each failing shot.** Diagnose the defect's causal prompt/composition mechanism; replace that mechanism in `shots.json` rather than appending `NO/never/not` patches or removing load-bearing facts. Set `$VdRetryId` to the failing L01–L12 id, author its one-shot versioned overlay at `$VdVideo/scratchpad/vpw-var/retry-vd-$VdRetryId.json`, then run:

   ```powershell
   $VdRetryOverlay = "$VdVideo/scratchpad/vpw-var/retry-vd-$VdRetryId.json"
   $VdRetrySpec = "$VdVideo/scratchpad/vpw-var/spec-vd-retry-$VdRetryId.json"
   py -3 $VdForge batch --kit $VdKit --batch "$VdVideo/shots.json" --video $VdVideo --shots $VdRetryId --retry $VdRetryOverlay --aspect 16:9 --out $VdRetrySpec
   py -3 $VdForge gen --dry-run --kit $VdKit --batch $VdRetrySpec --video $VdVideo --aspect 16:9 --image-size 1K --force
   py -3 $VdForge gen --kit $VdKit --batch $VdRetrySpec --video $VdVideo --aspect 16:9 --image-size 1K --force
   ```

   A parent re-generation consumes that shot's single retry and every descendant waits for its new verified digest. Count every live call against the 24-call ceiling.

9. - [ ] **Park honestly after the retry.** If the re-authored retry still has any fidelity/style/rig defect, keep the better attempt, set its merged ruling to the observed defect, run the stamp writer, and require `review_status: parked` plus concrete `parked_reasons`; do not switch techniques, take a third call, or stamp it verified. If a parked shot is a required parent, park each blocked descendant with `parent LNN not verified`, replacing `LNN` with that manifest's exact parent id, without spending its base call; report it as attempted only if an actual generation call occurred.

10. - [ ] **Close the review and manifest record.** Run `py -3 orgs/faceless-youtube/.claude/skills/image-generation/scripts/build_review_artifact.py --video $VdVideo --out "$VdVideo/assets/_review/scene-board.html" --shots L01 L02 L03 L04 L05 L06 L07 L08 L09 L10 L11 L12`, have the fresh reviewer rule every applicable row and advisory palette card, merge final rulings, and run `py -3 orgs/faceless-youtube/.claude/skills/image-generation/scripts/stamp_review.py $VdVideo`. Expected summary reflects reality, not a target; only clean frames are `verified`. Append to genlog: calls by base/retry/parent-regen, verified ids, parked ids/reasons, unused allowance, actual conservative total `calls × 0.134`, actual provider comparator `calls × 0.039`, and whether the $5 wave cap remained intact.

11. - [ ] **Copy reviewed bytes into the dedicated D comparison folder.** Resolve `$VdFrameRoot = (Resolve-Path "$VdVideo/scratchpad/variant-frames").Path`, set `$VdFrameDir = Join-Path $VdFrameRoot 'vd'`, require `[IO.Path]::GetFullPath($VdFrameDir).StartsWith($VdFrameRoot + [IO.Path]::DirectorySeparatorChar)`, and create it with `New-Item -ItemType Directory -Force -Path $VdFrameDir`. For each `$VdFrameId` in `L01` through `L12`, copy an existing reviewed source with `Copy-Item -LiteralPath "$VdVideo/assets/scenes/$VdFrameId.png" -Destination "$VdFrameDir/$VdFrameId.png" -Force`. Create `vd/manifest.json` containing only L01–L12 entries and top-level `variant:"D"`, `branch:"claude/bricks-variant-vd"`, `requested_model`, `responding_model`, `calls`, `rate_conservative:0.134`, `rate_provider_table:0.039`, `cost_usd` at the conservative rate, and `provider_table_cost_usd`; preserve every honest parked state. Verify each copied SHA-256 equals its source with `Get-FileHash -Algorithm SHA256`.

12. - [ ] **Send the exact cost row to the ops writer.** The existing 08-20 ledger has five tab-separated fields with no header: narrative description; requested model; responding model; short task label; USD. Derive `$VdCalls` from actual genlog call rows, `$VdVerified` and `$VdParked` from the twelve manifest states, and `$VdLedgerDescription = 'Variant D doctrine trial: {0} calls, {1}/12 verified, {2}/12 parked; 12 base allowance + at most one retry each; conservative $0.134/call, provider-table $0.039/call; genlog scratchpad/vpw-var/genlog-vd.md on claude/bricks-variant-vd.' -f $VdCalls,$VdVerified,$VdParked`. Supply that description, `gemini-3-pro-image`, the observed responding id, `bricks variant D trial 12 shots`, and `[decimal]$VdCalls * 0.134` as the five fields (examples: 12→1.608; 24→3.216). The boss/ops writer must `git pull --rebase origin ops` immediately before the write, append on `ops`, commit/push immediately, and report the pushed row; the work branch never edits `ledgers/`.

13. - [ ] **Commit only work-product records.** Run `git diff --check`; inspect all L01–L12 manifest/ruling changes and ensure L13+ are unchanged. Stage explicit V work-product paths, excluding `ledgers/`, and commit `feat(fyt): generate variant D comparison frames`. Never stage credentials, live review-store changes outside the trial scope, or unrelated files.

**Acceptance:**

- Every L01–L12 shot has either one actual base call or an honest parent-block park; no shot exceeds one re-authored retry and total live calls do not exceed 24/$3.216 conservative or the $5 wave cap.
- All generated scenes are 16:9, 1K, forced fresh, logged with requested/responding model and both rates; no ambiguous call is double-issued.
- Every delta was built only after its parent passed and was promoted; changed parent digests propagate before descendants run.
- Final manifest states are honest `verified|parked`; parked reasons are visible, and only reviewed source bytes are copied to `variant-frames/vd` with matching SHA-256.
- `genlog-vd.md` contains the complete call/retry/park/cost record and the exact cost row is pushed through the ops convention.

**Review gate:**

The adversarial reviewer checks spec §4.4/§6: human spend approval, exact Forge batch→gen call shape, parent-before-delta proof, fresh reviewer independence, one re-authored retry, no prompt accretion, honest parks, 24-call and $5 ceilings, dual-rate accounting, ledger field order, manifest isolation, and byte-identical copy into `variant-frames/vd`.

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

2. - [ ] **Make the existing board layout accurately describe four variants.** Change `repeat(3,minmax(0,1fr))` to `repeat(4,minmax(0,1fr))` for `.variant-summary` and `.decision-cards`; increase the comparison table minimum width from `1050px` to `1360px` and the narrow-screen width from `900px` to `1160px`. Replace `tested three doctrine variants` with `tested four doctrine variants`, `all 36 frames` with `all 48 frames`, and append `<th>D &mdash; judgment-restoration trial</th>` to the grid header. Do not change row order, image compression, manifest-state badges, or missing-frame behavior.

3. - [ ] **Extend the decision section without preselecting D.** Add a fourth card with exact copy `Pick D` / `Use the hold-camera, grounded-palette, actor-first, bounded-crowd criterion set tested here; retain the existing engine, style tile, suffix, seeds, and render register.` Change the procedure to `reply with A, B, C, D, or an iteration note`. Replace the old first two restoration-only questions with `Which criterion set reads best shot by shot, and which individual D changes should survive even if D does not win overall?` and `Does any preferred D frame depend on a changed subject/composition rather than the criterion it is meant to test?`; preserve the remaining render-register, repair-source, symbolic-vocabulary, and reuse questions.

4. - [ ] **Give a fresh reviewer this exact blind brief with no Task 2 authoring conversation, no target counts, and no desired winner.** Inputs are the 48 local PNGs, each branch's L01–L12 `shots.json` records via `git show`, four manifests, spec §3.1–3.4, and the calibration fixture:

   ```text
   Review the A/B/C/D L01–L12 comparison fresh. Do not infer intent from branch history, genlogs, or
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

   Expected JSON: `output` ends in `scratchpad/boards/variant-board.html`; `image_counts` is exactly `{"A":12,"B":12,"C":12,"D":12}`; `missing` is `[]`; encoded board remains below 14 MiB. Open the HTML and inspect at desktop and narrow width: four headers align with every row, all 48 images open in the lightbox, arrow count/navigation reaches 48, parked badges/reasons remain visible, sections 1–4 render, and A/B/C/D decision cards fit without overlap.

7. - [ ] **Check review neutrality and criterion coverage before publishing.** Search the review for numeric imperatives (`at least`, `no more than`, `must equal`, `% target`, `minimum`, `maximum`) and remove any distribution target while retaining observed figures. Confirm all twelve D ids have a ruling, every authored D chain seam appears, every stage basis is checked against visible pixels, every crowd shot has a geometry ruling, and the review says `NA` rather than inventing a crowd finding on non-crowd frames.

8. - [ ] **Republish the existing Artifact in place.** Replace the content behind the already published A/B/C board handle with regenerated `variant-board.html`; do not create a second Artifact or new URL. Add this exact publication note to the handoff: `Republished the existing Bricks Variant Trial Artifact in place; D is now the fourth column, and the prior A/B/C URL remains canonical.` The actual URL is not stored in this clone; if the existing handle is unavailable in the publishing session, stop and request that handle instead of minting a new one.

9. - [ ] **Write the resumable human-gate handoff and durable lesson.** `handoffs/2026-08-20-fyt-variant-d-trial.md` records current branch/commit, unchanged Artifact URL, costs/calls/parks, weakest frames, blind-review path, and a Load list containing this plan, spec, final `shots.json`, `plan-vd.md`, `genlog-vd.md`, blind review, board builder, and D manifest. Append to `memory/claude-boss.md` only the reusable pattern: positive geometry belongs to critic judgment rather than lexical lint; palette rationale must reach provider-visible facts and separately labelled review metadata; fragment validators should clip the source span, size against its covered words, and keep scope out of eventual full-file JSON. Do not turn Daniel's still-pending taste choice into doctrine.

10. - [ ] **Complete the work-branch and ops records separately.** On `claude/bricks-variant-vd`, run `git diff --check`, stage only board builder/review/board work products, and commit `feat(fyt): add variant D blind comparison board`. For handoff/memory/STATE, use the coordination-write workflow on `ops`: pull/rebase immediately before each write, commit/push immediately after, and never mix those paths into the work-product commit. Report both commit ids and leave the human board decision open.

**Acceptance:**

- `VARIANTS` contains the exact D entry; the local board renders 12×4 frames, all manifests, four decision cards, and the complete new blind review with no missing assets or layout break.
- A fresh reviewer applies §3.1–3.4 and the six canonical image questions shot by shot before reporting chain, palette, occupancy, and crowd distributions; no distribution becomes a target or gate.
- The same Artifact handle/URL is republished in place; if that handle is unavailable, the task stops rather than publishing a duplicate.
- The handoff makes Daniel's decision resumable, memory captures only reusable process lessons, STATE is updated only if materially stale, and coordination writes land on `ops`.

**Review gate:**

The adversarial reviewer checks spec §4.5/§5: exact D registry data, 48-frame board integrity, reviewer freshness, per-shot criterion evidence before distributions, no target language or automatic winner, transparent parks/costs, unchanged Artifact URL, complete Load list, least-general lesson routing, and strict work-branch/ops separation.
