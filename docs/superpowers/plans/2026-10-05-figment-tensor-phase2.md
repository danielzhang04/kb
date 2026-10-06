# Figment phase 2: module-10 dataset, module-11 training/tester, trait calibration

Status: offline implementation verified on 2026-10-05 on branch `codex/figment-phase2-20261005`. The original task instructions below record the planning baseline. Code paths are relative to the implementation worktree. Live execution and trait calibration are not complete.

Verification: 2,412 distinct tests passed across the pod suite (375), anchor suite (17), driver suite (139), and remaining pipeline/train/expand coverage (1,881); 31 checks were skipped for unavailable local receipts or legacy admission assets. The first complete remaining-suite run reported 20 failures, 1,861 passes and 31 skips; explicit pre-promotion fixtures, updated tensor-default expectations and one real trigger-normalization correction resolved all failures. The final affected eight-file rerun passed 386 tests. Counts exclude duplicate focused runs and new phase-3/4/5 tests.

Independent implementation/security review resolved passport-source binding, train-first projection and unsupported diagnostic dispatch findings. Subsequent test-isolation diffs and the narrow tensor `trigger=None` correction were independently reviewed; clean trigger derivation remains unchanged. Diff hygiene and generated-skill consistency checks passed. No pod or model was launched for this offline implementation.

Limits: the 95-row historical calibration inventory contains none of the five new trait vectors or labels; traits remain display-only and no thresholds were fitted or activated. Gated Klein model preflight, real body inputs, caption execution, training/tester eye gates and live runtime quality remain outstanding. Offline fixture receipts do not satisfy those gates.


## Outcome and boundaries

Build a dry-run chain from the selected creator-003 passport p01 to exactly 30 dataset jobs, untriggered captions, a 3000-step training configuration and a 12-checkpoint tester. Show age holds and five identity-trait axes without hiding any output. Calibration proposes thresholds; Daniel decides whether to adopt them. Keep creator-001/002 clean behavior and existing evidence intact.

No pods, model downloads, credential reads, billing changes, posting, git mutations or governance edits in this phase. Preserve the existing dirty governance/budget.yaml. Use synthetic or already-generated clothed images in tests. Parent will assign a bounded implementation task on a separate codex work branch; this planning worker starts no code. Existing approved phase-2 design permits its offline configuration/graph work without repeated confirmation. Contract T2 identity-scoring and external-model promotion limits still apply: stay within concretely approved spec scope; new models or scope changes need a specific ruling. Spend-controller ledger/guard/lease/teardown remain untouched and threshold activation requires Daniel to decide. Missing media does not block independent offline building. The operator's passport-choice delegation does not waive later eye gates. Automated scores never constitute a human visual ruling.

Source of truth: docs/superpowers/specs/2026-09-29-figment-tensor-parity-design.md sections 4.2, 4.3, 6-10; orgs/figment/{contract.md,MANDATE.md,pipeline/GUARDRAILS.md}. STATE.md still says the passport has not run; the parent reports p01 registration now applied with delegated provenance. Verify its receipts in task 1. The parent also reports billing reconciliation MATCH (ledger $0.8775/provider $0.8875); this planning worker did not independently execute it. GOAL.md is absent in this worktree. Spec states the current $75 arc; older contract/mandate budget wording is stale and must be reconciled separately before live execution, without weakening guards.

## Findings that shape implementation

- train/tensor-pins.yaml maps tensor only to anchor today. Its existing dataset/workflow names are legacy clean implementations, not module-10 parity.
- figment_train.py build_plan still calls _generalized_prompts, _generalized_dataset_workflow and _copy_support_files for every post-passport profile. Those feed legacy look prefixes and repair tails.
- training_config.DEFAULT_TRAINING steps defaults to 2000. trigger is used both in language and as an artifact/path stem. Removing it globally would break checkpoint discovery. Use creator id (creator-003) for the tensor job/artifact stem per spec 4.3; make textual trigger behavior explicitly absent. Preserve clean trigger-derived naming.
- build_training_set._collect_cells_qwen3vl prepends the trigger and class. Changing just the trainer JSON would leave triggered captions.
- apply_rulings(dataset) currently calls _live_qwen3vl_job_runner for qwen3vl captions. A local curation command must not unexpectedly rent a pod during dry-run work.
- Passport age holds, four-group board and age-ruling logging already exist. Extend them to tensor downstream stages rather than introducing another gate writer or approval system.
- vlm_judge currently has no five-axis schema; PROMPT_VERSION is v1. Cache/version behavior must change with the new schema.
- Package assets are present. Module-10 graph SHA256: 06a2fa9f2f572f1281d85ae38b790a6c1806f05affb714d2b4995d7374751b04 (70 nodes). Module-11 tester: 864819c10d910cae6190d781eaaca9eccd8d29507c4a09416bf9dcbb56a4f8a6 (111 nodes). Module-10 node 723 is bypassed; live text is supplied via links, not stale saved text widgets.

## Task list

### [ ] 1. Freeze baseline and verify passport input

Instructions/files: inspect the current worktree status and existing task list; capture hashes for creator-001/002 persona/training files and governance/budget.yaml. Confirm creator-003/anchors/passport.png exists and matches p01, identity.references[0], identity history, approval lineage and the original image hash. Inspect persona.py validation and figment_train.py _copy_anchors and apply_rulings. Do not re-register an already registered choice.

Testing: run from the worktree root: `python -m pytest orgs/figment/pipeline/tests/test_tensor_passport.py orgs/figment/pipeline/tests/test_tensor_parity.py orgs/figment/pipeline/tests/test_training_config.py orgs/figment/pipeline/tests/test_lineage_freshness.py -q`. Other abbreviated test paths below are relative to orgs/figment/pipeline/. Missing package or dependency is a reported failure, not a skip disguised as success. Confirm repeated registration is idempotent or refused without partial files; mutated source image/approval must fail.

Independent review: separate session checks p01 identity binding and baseline receipts against source artifacts.

Exit: baseline pass/fail recorded; registered passport verified or explicitly listed as an input dependency. Tests may use temporary fixture personas while registration finishes.

### [ ] 2. Define tensor phase-2 configuration and input contract

Instructions/files: extend pipeline/training_config.py validate_training and pipeline/lineage.py TRAIN_TIME_KEYS/input projections; inspect pipeline/persona.py body_target and figment_train.py _resolve_body_reference. Add minimal validated metadata for the faceless body reference and confirmed body-description text. Bind image hash, description approval and tester prompt approval into plan provenance. Tensor requires 3000 steps, save_every 250, replicates 1, qwen-edit dataset, DOP off and no textual trigger; unsupported overrides fail before writing artifacts. Preserve clean defaults and clean artifact names. Tensor uses persona id as its job/artifact stem (creator-003, not creator003krea2), as spec 4.3 requires. Introduce one profile-aware artifact-stem resolver and trace _checkpoint_name, checkpoint imports, upload folders, training runtime paths, acceptance and config rematerialization through it. Avoid converting trigger to an empty path component. Require body input only for dataset stages and tester prompt only for tester stages; shared training/persona validation must not demand unrelated stage inputs. Use an explicit profile-aware caption/prompt policy rather than scattered string removals.

Testing: table-driven tensor/clean cases; reject tensor DOP=true, steps=2000, replicate=2, klein-multiref and stage-required unapproved/missing body or tester prompt. Verify passport/config validation needs neither, dataset-only planning needs no tester prompt, and imported tester planning needs no body reference. Reject invalid, missing or changed image/hash/ruling; mutation of approved text invalidates downstream authority. Verify clean fixture projections and output names remain unchanged. Fixture body references are marked synthetic, never production-ready.

Independent review: reviewer traces every newly accepted field through validation, provenance and its consumer; checks no ignored override can appear accepted.

Exit: one validated contract covers every phase-2 input; fixture-only dry runs can proceed while actual body/prompt decisions wait.

### [ ] 3. Build module-10 graph and independent parity checker

Instructions/files: add expand/workflows/tensor_dataset_m10_api.json; extend tensor_parity.py with check_dataset and verified package loading. Resolve module-10 Set/Get nodes and primitives, prompt-list fan-out and bypasses using graph edges. Do not copy stale, shadowed clothing-removal widget strings or out-of-scope model branches. Apply only ledger R1 to the base stack: module-04 Qwen-edit/Lightning components into bfs_head_v5 0.6 and shift 3.1. Restore face crop, body/face conditioning order, RES4LYF samplers, detail boosts, zit upscaler and klein-9B refine at package settings. Preserve lumina2 until the separately approved live smoke supplies contrary evidence. Read installer as data, never execute it. Keep licensed prompt bulk in the existing ignored package; derived code may refer to it by verified digest.

Testing: expand tests/test_tensor_parity.py and add tests/test_tensor_dataset_phase2.py. Independently compare effective nodes, widget types/values, topology, model mapping and effective prompts against the verified source. Mutation tests must catch swapped face/body slots, wrong sampler/denoise/LoRA strength, an added repair tail, omitted ReferenceLatent, stale widget text used instead of linked text, extra model and altered package digest. Ensure changing both the implementation and a copied expected graph cannot silently redefine parity: expectations derive from source plus explicit ledger entries.

Independent review: separate reviewer inspects effective package graph, export and exemptions; every exception needs a specific ledger row and explanation.

Exit: graph parity passes; every listed mutation fails; no restricted branch or explicit prompt is materialized.

### [ ] 4. Integrate tensor dataset planning and pins

Instructions/files: extend train/tensor-pins.yaml profiles.tensor with dataset_tensor, train/smoke/tester/caption groups as appropriate; use exact installer file/hash evidence and existing pin verification. Add profile-specific helpers beside _dataset_jobs/_dataset_manifests and wire build_plan/_copy_support_files through them. Reuse sharding/manifest infrastructure but produce 15 face plus 15 body jobs, each once; no legacy fullbody repair workflow. Copy only the passport and explicitly approved body reference; face node 836 and body node 837 must have distinct, verified bindings. Run check_dataset before plan writes. Keep clean functions behavior unchanged. Unknown pin evidence stays unresolved rather than fabricated; offline checks use local metadata, no download.

Testing: exact 30 unique jobs, 15/15 branch split, expected final refined output, complete substitutions and no look/skin-prefix leakage. Detect duplicate output names, missing branch, extra replication, wrong upload mapping, basename collision, missing/changed pin, broad pickle acknowledgement and unlisted node. Verify unsupported later tensor stages fail clearly. Re-run expand/tests/test_tensor_dataset.py plus train/tests/test_verify_pins.py and clean planner regression tests. Mock network calls to raise during all dry-run tests.

Independent review: reviewer checks rendered manifests and uploads against graph/pins, and confirms no clean profile mutation or spending path.

Exit: a fixture-backed module-10 plan and harness --dry-run validation are green; missing real body input is visible and does not masquerade as a launch-ready plan.

### [ ] 5. Extend tensor review to all dataset cells

Instructions/files: extend identity_gate.py run_two_stage_gate/passport_verdict (factor a reusable tensor grouping helper if necessary), figment_train.py build_grade, board rendering, _normalize_rulings, age logging and apply_rulings. Keep identity_gate.write_gate_document and qa_stamp as their existing sole writers. All 30 outputs reach passed/age/unscorable/failed groups, with the passport beside them, scores and reasons, and accurate kept/culled totals. Preserve the first two priorities from passport_verdict: absent measurable face -> unscorable first; otherwise missing/nonfinite/below-floor age -> age. Extend its current other-metric behavior to meet the spec: other missing metrics -> unscorable (currently those can return failed), other failed metrics -> failed, else passed. Retain all applicable reason flags even when one group wins. Rear/no-face plus missing-age must remain visible as unscorable with age-unavailable information; no grouping waives mandatory human visual review. Require an explicit operator age release/cull whenever age is unavailable or below floor, including cells displayed as unscorable; keep grouping distinct from the complete set of required rulings. Generalize existing explicit age release/cull handling; pending required rulings prevent closure.

Testing: age below 20 from either estimator, missing/nonfinite age, absent face plus simultaneously missing age (assert group priority and retained reason flags), failed identity, unavailable judge and mixed batches. Every image appears exactly once even on failure. Pending age ruling blocks apply; cull excludes training input; stale image/score/approval hashes fail. Repeat apply must not duplicate age-log entries. No automated path writes review_status or silently treats an automated pass as a keep. Render board fixture and inspect at least one example in each group.

Independent review: identity-scoring change receives adversarial review in a separate session; check bypasses and coverage, not only happy paths.

Exit: fixture dataset board and closure are correct; clean historical behavior remains covered; no production dataset ruled by the planner.

### [ ] 6. Add five display-only traits and calibration proposal

Instructions/files: extend vlm_judge.py _build_prompt, _coerce_judge_payload, _cache_key, judge_image, calibrate and _render_calibration_md for lips, brows, skin_pattern, hair and jaw on 0-100 match-to-passport scales. Version the schema/prompt and ensure old cached rows cannot count as complete new scores. Expose traits on the existing board and report. Do not silently enable thresholds in gate.yaml. Build a manifest of actual creator-001 ruled dataset/gen images, labels, image/reference hashes and source ruling paths; use creator-001's own reference for retrospective calibration, not creator-003's face. Keep duplicate images together and reserve held-out evidence where feasible. Report insufficient labels and overlap explicitly. Local subscription scoring of already-generated clothed images is allowed by the spec, but this planning run executes none; fixture tests remain offline.

Testing: 0/100 boundaries; reject bool, strings, NaN, infinity, negative and >100 values; distinguish unavailable axes from perfect/zero scores. Legacy cache invalidation; reference swap changes key. Identical existing verdicts with arbitrary trait values while thresholds are unset. Calibration respects recorded human labels, does not relabel examples from model predictions, excludes duplicates across fit/validation, and reports inseparable/insufficient data rather than inventing a threshold.

Independent review: reviewer audits provenance and whether lip/brow drift separates from accepted images. Daniel gets proposed cutoffs with errors/coverage and decides activation; automated proposal cannot activate itself.

Exit: all axes display with explicit availability; reproducible calibration report or precise missing-label inventory exists; thresholds remain pending until an actual ruling.

### [ ] 7. Make caption and training behavior conform without hidden execution

Instructions/files: update train/build_training_set.py _collect_cells_qwen3vl/build_training_set, train/render_aitoolkit_config.py check_module_11/apply_dop_trigger_word, train/ai-toolkit-krea2.yaml.template and figment_train.py _render_training_config, _caption_manifest, plan_qwen3vl_caption, apply_rulings and training-config rematerialization call sites. Retain clean trigger behavior. Tensor caption text is the raw caption body with no identity-look or trigger prefix; tensor job/checkpoint paths consistently use the persona-id stem from task 2; clean names remain unchanged. Include every _checkpoint_name/import/acceptance/rematerialization path in this migration and never rename prior clean evidence. Render raw Krea2 training, DOP false, 3000 steps, 250 save interval, keep 15, cached text embeddings and disabled sampling. Keep smoke's explicit shorter schedule separate from full training parity. Record toolkit defaults/video-derived unknowns honestly rather than claiming source proof.

Crucial execution instruction: local dataset ruling/curation and caption planning must be separable from live Qwen caption execution. Reuse the existing caption plan/run mechanism; add an explicit boundary so a dry-run/curation command never reaches _live_qwen3vl_job_runner. Preserve approved images and resumable receipts on caption failure; no fabricated class captions as a successful tensor substitute.

Testing: train/tests/test_build_training_set.py and test_render_aitoolkit_config.py, tests/test_training_config.py and focused planner/ruling tests. Assert exact trigger-free captions with clean prefix regression; empty/incomplete/duplicate caption responses fail; supplied captions are not overwritten; tensor DOP and textual trigger injections fail. Monkeypatch live runner/pod creation to raise and prove local dataset apply/plan never calls it. Test interrupted/resumed caption execution with fixtures and changed dataset hashes. Assert 11 intermediates 250..2750 plus final 3000, and raw-vs-turbo training model rejection. Test POSIX path validation and the creator-003 tensor artifact stem versus unchanged creator001krea2 clean stem.

Independent review: separate reviewer follows the full apply-rulings -> caption -> assembled dataset -> rendered training chain and enumerates any possible live side effect.

Exit: fixture approved dataset becomes a verifiable caption plan and training configuration without spend; training is blocked until complete real captions and current approvals exist.

### [ ] 8. Build module-11 tester parity and checkpoint eye gate

Instructions/files: add train/workflows/tensor_tester_m11_api.json; extend tensor_parity.py check_tester; extend figment_train.py _tester_prompt/_tester_workflow/_tester_manifest and existing checkpoint upload/receipt validation. Source one approved corrected scene prompt, with no trigger or look-prefix synthesis, for all 12 checkpoints. Use 1448x2176, seed 1595, four steps, cfg 1, res_2s/beta, LoRA 1.0/1.0 and zeroed negative. Existing clean and non-persona _tester_base_workflow callers retain behavior. The approved prompt is a plain artifact dependency; phase-5 photo-to-prompt implementation is not pulled forward.

Testing: compare all 12 source branches after allowed fan-out collapse; reject changed seed/dimensions/prompt, duplicate/missing/misnamed checkpoint, wrong checkpoint hash and altered prompt approval. All branches must differ only by checkpoint/output identity. Verify choosing an intermediate checkpoint writes the matching acceptance and cannot auto-select final. Run tests/test_tester_base_workflow.py, test_import_checkpoints.py and tester portions of test_figment_train.py.

Independent review: reviewer inspects package-vs-export parity and traces selected image to checkpoint bytes, ensuring score rank does not replace operator choice.

Exit: complete 12-job fixture tester plan; stale or incomplete ladder fails before launch; checkpoint acceptance remains an eye gate.

### [ ] 9. Integrate, review and leave a concrete next gate

Instructions/files: update pipeline/README.md, RUNBOOK.md and train/TENSOR-TRAINING.md only for implemented behavior. Run one fixture chain across dataset plan -> simulated outputs -> grade -> rulings -> caption plan/fixture captions -> train config -> tester plan -> checkpoint selection. Update the existing terminal task list with actual statuses and evidence paths. Any coordination STATE/ledger writes are routed through the parent and repository ops workflow, not this planning file.

Testing: run pytest across pipeline/tests, pipeline/expand/tests/test_tensor_dataset.py, pipeline/train/tests/test_build_training_set.py, test_render_aitoolkit_config.py, test_verify_pins.py and affected train tests. Run pod harness --dry-run on every fixture-generated phase-2 manifest with network/pod calls prohibited. Recheck baseline hashes and git diff for unintended creator-001/002 or governance edits. Report exact counts and failures, not just 'tested'. Do not broaden into expensive local-training tests unrelated to this change.

Independent review: fresh reviewer receives spec, final diff, fixtures and test results, not the author's conclusions as evidence. Review must cover parity exceptions, authority freshness, local-vs-live boundary, missing-input handling and clean regressions. Fix findings and rerun affected checks. No self-grading or eval-manifest edits.

Exit: concrete reviewable diff, dry-run evidence, resolved review findings and a short dependency list. Continue offline phases 3-5 if already authorized; no phase-6 live execution or new spending authorization is inferred.

## Operator inputs, timed to the first dependent action

1. Body reference decision received: Daniel has none; proceed now with a synthetic test fixture and clearly marked fixture description. Do not treat fixture approval as production body approval. A real approved faceless, clothed body reference is required only before a production dataset plan, not for this build; there is no pending body-input question.
2. Corrected scene prompt approved for the tester: required before a production tester plan. It can be typed directly now; automated photo-to-prompt intake is phase 5.
3. Axis thresholds: ask only after calibration evidence is available; display-only axes do not block building other stages.
4. Gated klein-9B account terms and ambient token readiness: operator-only prerequisite before the approved live smoke, not offline implementation. Never ask for token contents or read credential stores.
5. Module-11 unspecified settings: show exact current pinned defaults and evidence gaps; choose whether to accept those defaults or revisit video evidence. Do not silently claim exact video parity.

## Brainstorm recommendation

Keep tensor as a faithful baseline first. The prior clean runs suggest less refinement and stricter lip/brow assessment might help, but changing the module-10 recipe while establishing parity would confound the experiment. Record those as later controlled variants. Use the fixed passport and one approved tester scene to compare checkpoints; defer broad aesthetic choices and public-character branding. Treat the body input as an independent fixture dependency so its absence cannot idle graph, validator, caption or tester development.

## Plan review revisions

Independent review requested stage-specific input gates, explicit persona-id artifact naming, runnable baseline test paths, and deterministic overlapping hold groups. All four incorporated. Code inspection confirms current passport_verdict checks no-face before age; the generalized policy preserves that priority and adds retained flags. Review is of this plan, not a claim that implementation tests have run.

Review outcome: independent reviewer accepted the revised implementation plan; no implementation verification is implied. Authorization-boundary note is included above.

Current operator assumption: no supplied body reference; use a synthetic test fixture throughout offline phase-2 implementation.
