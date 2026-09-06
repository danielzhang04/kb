# Review — 2026-09-06-figment-track2-faithful-pipeline.md

**Verdict: APPROVE WITH FIXES**

Line numbers refer to the plan unless marked `[code]`. Counts: 4 HIGH, 3 MED, 2 LOW.
Line-number citations for existing code (STAGES:48, build_plan:614-693, _dataset_jobs:261,
_dataset_manifests:283, _tester_manifest:499, build_grade:1024, apply_rulings:1112, parser
choices:1225-1240) were checked against the file and are accurate — the plan was written
against the real tree, which is why the bugs below are real interface gaps, not drift.

## HIGH

**H1 — Training cost/ceiling table uses the wrong (uncached) throughput; "Expected" cost
and the arc total are ~2x too high.**
Plan lines 46, 630, 666, 939 derive `~$4.92`/3000 steps and "Expected arc ≈ $12.50 …
above the brief's ≈$6–7" from `3000 × 3.85 s/step`. `3.85 s/step` is smoke #4's 100-step,
uncached-embeddings measurement (`TENSOR-TRAINING.md:217`, `STATE.md:169`). The full
2000-step run that actually happened (`STATE.md:190-191`) took **99 min wall for $1.80**
at **1.3–2.5 s/step once latents/text embeddings were cached** — the regime every real
training job runs in after the first few steps. Recomputing at the midpoint (~2.2 s/step,
consistent with (99 min − ~25 min bootstrap) / 2000 steps): 3000 steps ≈ 111 min training +
~25 min bootstrap ≈ 136 min ≈ **$2.50–3.00**, not $4.92. The `job_timeout_seconds: 13500`
/ `max_minutes: 323` ceiling (line 666) is fine to keep generous (it's a safety bound, and
its 3.85 s/step basis matches the old worst-case measurement), but the **"Expected" column
and the arc-total narrative must not reuse the ceiling's pessimistic rate as the realistic
estimate**. This also undercuts Risk #5's "above the brief's ≈$6–7 … the only real lever is
2000 steps" framing (line 939) — at the corrected rate the arc lands close to the brief's
own number and the 2000-vs-3000-step tradeoff may not need to be raised with the operator
at all.
**Fix:** In the spend table (line 46) and Task C1 Step 3 (line 666), change the train row's
`Expected` to `~$2.70` (recompute from measured cached throughput, not smoke #4's figure),
recompute `Expected arc` accordingly (~$10.30), and rewrite Risk #5 to state the corrected
arc vs. the brief before presenting any step-count tradeoff to the operator.

**H2 — `run --stage all` will silently re-run the already-gated anchor stage live, with no
STOP, mid-way through Phase C.**
GATE 1 (Task A4) plans and runs the anchor stage in `C:/tmp/c001-anchor` (line 344). GATE 2
(Task B4) plans a **separate** `--stage all` plan at `C:/tmp/c001-t2` (line 600) — because
`STAGES` now includes `"anchor"` first, this plan's `plan["stages"]` also contains an anchor
sub-plan, and Task B4 Step 2 (line 608) runs only `--stage dataset` against it, so that
plan's own `stage.json` never marks `"anchor"` complete. Task C2 Step 4 (line 727) then runs
`figment_train.py run --stage all --plan C:/tmp/c001-t2/plan.json`, described as "resumes at
smoke, then train, then tester." Per `run_planned_stage` `[code figment_train.py:871-875]`,
the loop only skips a stage already in `state["completed_stages"]`; for `stage == "all"` an
incomplete stage is **not** rejected (line 873's raise fires only when `stage != "all"`) —
it falls through and actually executes. Since `"anchor"` was never completed under
`c001-t2`'s own state, this command will launch the 18 anchor pod jobs live a second time
(~$3.60), unattended, with no operator gate — directly contradicting line 7 ("Each stage
ends at an operator gate that STOPS the chain") and the GATE 1 doctrine (line 19).
**Fix:** Either (a) have GATE 2 build its `--stage all` plan with an already-populated
`state["completed_stages"] = ["anchor"]` seeded from the GATE-1 plan (requires a new
`build_plan`/`run_planned_stage` hook to import prior stage completion across plans), or
(b) simplest: never plan `"anchor"` as part of a `--stage all` invocation once
`identity.history` is non-empty — add a check in `build_plan`/`run_planned_stage` that skips
generating/running the anchor sub-stage when the persona already carries a promoted anchor,
and require Task C2 Step 4 to state explicitly why re-running anchor is impossible, not just
assert the intended behavior in prose.

**H3 — GATE 4's grading command is broken as written: `build_grade` never learns the `"gen"`
stage.**
Task D3 Step 2 (line 881) runs `figment_train.py grade --creator creator-001 --stage gen
--plan …`. Task D2 (line 792, Step 5, line 855) only says to add `"gen"` to `STAGES` and to
"both parser `--stage` choice tuples" — it never lists `build_grade` among the functions
Task D2 touches, and no other task does either. `build_grade`'s own internal check
`[code figment_train.py:1026]` is `if stage not in ("dataset", "tester"): raise
FigmentTrainError(...)`, which Task A3 (line 316) widens only to
`("anchor", "dataset", "tester")`. As written, `grade --stage gen` raises
`FigmentTrainError` even if the CLI parser is updated to accept `"gen"` as a choice —
GATE 4 cannot run.
**Fix:** Add `build_grade`'s (and, for symmetry/future use, `apply_rulings`'s) stage tuple to
Task D2's file list and Step 5 text explicitly: `if stage not in ("anchor", "dataset",
"tester", "gen"): raise …` in both functions, and add a test asserting
`build_grade("creator-002", "gen", …)` succeeds.

**H4 — `ComfyUI-Impact-Subpack` is already pinned and bootstrapped for the `dataset` stage,
unused and unaudited, contradicting the plan's own "never add it" rule.**
`train/tensor-pins.yaml:66` lists `ComfyUI-Impact-Subpack` (`installer_pin
50c7b71a6a224734cc9b21963c6d1926816a97f1`) as a custom node the `dataset` stage's bootstrap
installs. Checking `expand/workflows/tensor_dataset_v2_api.json`'s actual node
`class_type`s: **no node from Impact-Subpack appears anywhere in the graph** — only
`ImpactImageBatchToImageList` (base Impact-Pack) is used. Per r22 §5 and the plan's own
Risk #1 (line 935: "the bootstrap `pip install`s each node's `requirements.txt`… an
`ultralytics` line would be pulled silently"), an installed-but-unused Impact-Subpack pin is
exactly the live violation the plan is trying to prevent for the new `gen` stage (D1, line
753: "**Never add Impact-Subpack**") — it is simply already present one stage over, in a
file (`tensor-pins.yaml`) that Task B1 also modifies. Neither Task B1 nor Task D1 audits or
removes it.
**Fix:** Add a step to Task B1 or D1: grep the live `tensor_dataset_v2_api.json` (and the
new full-body workflow) for any Impact-Subpack class_type; if none is found (confirmed
above), delete the `ComfyUI-Impact-Subpack` entry from `pins.dataset.custom_nodes` in the
same commit that adds D23/D24, and record the removal as a new D-note referencing this
finding.

## MEDIUM

**M1 — `build_plan`'s dispatch chain ends in a catch-all `else` that Task D2 doesn't
explicitly restructure; `"gen"` risks being silently routed through the tester builder.**
`build_plan` `[code figment_train.py:649-664]` is `if current == "dataset": … elif
current == "smoke": … elif current == "train": … else: manifests =
[_tester_manifest(...)]`. Task A2 explicitly inserted its new branch "before the dataset
branch" (line 270) precisely because this chain has no room for a new stage without
surgery. Task D2 (Step 5, line 855) says `_gen_manifest` "mirrors `_tester_manifest`" but
never states that the trailing `else` must become `elif current == "tester": … else: #
gen …` — an implementer who adds `_gen_manifest` without restructuring the chain gets a
**wrong, mislabeled manifest** (silently built by the tester path) for `stage="gen"`
instead of a loud error, which is worse than the `KeyError` Step 2 (line 835) expects.
**Fix:** Add to Task D2 Step 5: "Convert the trailing `else` into `elif current ==
'tester': manifests = [...]; else: manifests = [_gen_manifest(...)]`," and extend the
Step 2 failing-test note to also assert `stage="gen"` does not silently reuse tester's
manifest shape.

**M2 — The `artifacts`/`jobs` merge in `runpod_run.py` is underspecified for the plan's own
"most safety-critical loop."** Task B2 Step 3 (line 473) describes extracting the jobs loop
and the artifacts loop (both closing over `watchdog`, `result`, `per_job_timeout`,
`failed_marker`, `images_manifest`) into "two local functions" in one sentence, with no test
pinning the one real hazard Risk #8 (line 942) names: the artifact marker deadline must not
start its clock until *after* the jobs loop returns.
**Fix:** Add a test asserting `artifact_marker_deadline` is computed strictly after the last
job's `download_job_outputs` call, not at function entry.

**M3 — `training.caption_mode` stays dead after this plan, with two divergent vocabularies
left unreconciled.** `training_config.py:32`'s `ALLOWED_CAPTION_MODES =
{"provided","auto","single_word"}` and `build_training_set.py`'s own `CAPTION_MODES`
(`"class"`, `"qwen3vl"`, …) name the same concept differently.
`personas/creator-001/training.yaml` already declares `"caption_mode": "provided"`, but
`apply_rulings` `[code figment_train.py:1190]` hardcodes `caption_mode="class"` regardless —
the persona field is dead. Task B2 Step 6 (line 503) fixes the call to `"provided"` (good)
but never notes the persona field remains unread, nor reconciles the vocabularies.
**Fix:** Either wire the call to read `training["caption_mode"]`, or add a line in Task B2
flagging the field as vestigial pending a follow-up.

## LOW

**L1 — `_anchor_manifests`'s edit-arm substitution of node `832.images` is a no-op.** Task
A2 Step 5 (line 261) substitutes node `832`'s `images` to `["791", 0]`, which is already
that node's default in `tensor_dataset_v2_api.json` (confirmed by inspection). Harmless;
drop it or note it's a defensive no-op.

**L2 — Passport prompt contradiction (task item g) is correctly resolved, not carried.**
Not a defect: Task A1 Step 4 / D20 (lines 131, 155) drops "zero film grain" and "smooth
realistic skin" from the camera clause, citing `r15b-generation:106-115`. Well-grounded in
r21 Q2 (2511's "plastic skin" as a chronic complaint) and r20's ranked divergence #2. No fix
needed.

## Top three fixes
1. Recompute the training cost/ceiling table (H1) from the measured 1.3–2.5 s/step cached
   rate, not smoke #4's uncached 3.85 s/step, before presenting any budget tradeoff.
2. Close the anchor-stage double-run hole (H2): either seed prior stage completion across
   plans or make `build_plan`/`run_planned_stage` skip anchor once `identity.history` is
   populated.
3. Add `"gen"` to `build_grade`'s (and `apply_rulings`'s) internal stage tuple (H3) so
   GATE 4 can actually run, and fix `build_plan`'s trailing `else` (M1) so `stage="gen"`
   can't silently fall through to the tester builder.
