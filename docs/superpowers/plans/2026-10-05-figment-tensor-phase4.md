# Figment phase 4: offline module-08 driven video

2026-10-05. Draft for independent review by the parent. Planning only; no implementation, model, network, paid call, or production ruling performed by this worker. Baseline inspected: `C:/Users/danie/kb/_private/codex-worktrees/figment-phase2-20261005`, including phase-2 corrective work. Phase-3 edit work is in progress; resolve its final accepted-edit API before implementing this plan.

## Outcome and authority

Implement the tensor `video` stage as module 08's driven-motion graph, using one operator-supplied MP4 and the accepted module-07 head swap of that exact clip's frame 0. Preserve the clean Wan 2.2 image-to-video path and its recorded evidence. Work is offline under approved spec sections 4.6, 8, 9, and phase 4. No live execution is authorized. Keep all spend, lease, cancellation, teardown, ledger, credential, and publish guards intact. Harness transport changes require independent code/security review before any live run.

Use synthetic clothed/adult fixtures for source media, edit outputs, and receipts. A fixture plan is explicitly non-launchable and non-promotable; it proves structure, not model output or a human eye gate. Do not ask for a real clip until a production plan needs it. No implicit scene-photo intake, stills recipe work, interpolation, audio, or publishing is part of this phase.

## Source evidence read

All source paths below are under `orgs/figment/research/10sorlabs-package/08_motion_control/`. Keep the licensed bulk ignored; use hash-verified source data for derived graph tests, never execute the BAT installers.

| Source | SHA256 |
|---|---|
| `10sorlabs_motion_control.json` | `1241dbe6572fdd4d77350a4bb748f9bf704eebe7a47e4af6e247f9fad8a2fc2a` |
| `motion_control_models.bat` | `3e423bc32ec0db0c3303d3e9cb975623e759c2564eada97213dba87831c0e9dc` |
| `extract_first_frame.bat` | `cadac3273fdf54f6a0df2a21d9fdf3f421bc5e3716c100e353e0f1ac1770fe12` |
| `transcript.txt` | `2b8aab0cab495d1443dabd40311d00ebbab5928f4fa4bb4348b23c35fb902d37` |

Concrete graph contract:

- UNET 37: `wan2.1_14B_SCAIL_2_fp8_scaled.safetensors`; LoRA 96: `Wan21_I2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors`, strength 1; sampling 48: shift 5.
- Encoder 38: `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, type `wan`; VAE 39: `wan_2.1_vae.safetensors`; vision loader 57: `clip_vision_h.safetensors`; checkpoint loader 110: `sam3.1_multiplex_fp16.safetensors`.
- Drive 113 `VHS_LoadVideo`: force_rate 16, cap 81, skip 0, select_every_nth 1, custom dimensions 0, format `None`. Start image 58 goes through 102 (0.5 MP, nearest-exact), 103 (multiple 32, nearest-exact), and 104 `GetImageSize`. Follow its effective width/height edges into 101; saved 512x896 widgets are shadowed, not fixed dimensions.
- SAM trackers 112/116: threshold 0.5, max_objects 0, detect_interval 1; conditioners 109/115 say `human`. Node 107 sorts masks by `area`, empty object_indices, replacement false. Node 101 `WanSCAILToVideo`: length 81, batch 1, pose strength 1, pose start/end 0/1, offset 0, previous_frame_count 5, replacement false; previous_frames unconnected.
- Sampler 3: seed 123 fixed, steps 6, cfg 1, euler/simple, denoise 1. Decode 8 feeds output 49 `VHS_VideoCombine`: 16 fps, video/h264-mp4, yuv420p, crf 19, loop 0, pingpong false, save_output true, save_metadata true, trim_to_audio false; audio unconnected.
- Positive 6 is a replaceable simple character/clothing/action prompt, approved as text and hash-bound to the plan; no trigger/look-sentence prefix. Negative 7 remains the exact source string, decoded as UTF-8. UI previews 117/118 and notes 123/124 can be excluded with explicit parity reasons.

Source details that prevent naive export: VHS widget values are dictionaries containing `videopreview` UI state; resize nodes have `COMFY_DYNAMICCOMBO_V3` inputs. Existing `tensor_parity._widget_values` assumes list widgets. Extend narrowly for named source types rather than silently flattening every dictionary. Dynamic-combo API representation must be verified against the chosen local runtime source, not guessed from editor JSON.

## Existing code constraints

Paths below are relative to `orgs/figment/pipeline/`.

- `pod/runpod_run.py`: `UPLOAD_EXTENSIONS` excludes MP4. `ComfyClient.upload_file` posts multipart to `/upload/image`; simply adding an extension does not prove server acceptance. `wait_outputs` enumerates only history `images`; `view_params` allows image suffixes only. `DryRunComfyClient` always manufactures PNG descriptors. `download_output` streams to `.partial`, but has no explicit byte ceiling for this larger output class. `download_job_outputs` and `require_manifest` count `expected_images`.
- `video/video_manifest.py:build_manifest` only supports current Wan 2.2 diagnostic/review candidates; it accepts an approved gen still or extraction receipt, not a driving clip plus accepted edit. Its `_motion` composes the existing clean prompt. Preserve these paths.
- `video/frame_extract.py:extract_frames` already hashes source before/after, uses bounded local FFmpeg/ffprobe, and extracts exact decoded first/middle/last frames. Reuse its source receipt/frame-0 authority and containment helpers. Existing limits are 2 GiB source, 30 seconds, 720 decoded frames, and 16,777,216 pixels. Do not widen them casually.
- `video/frame_assemble.py` and `video/video_review.py` require exactly 81 harness PNG files, fixed clean candidate dimensions, and embedded PNG prompt-graph metadata. A directly downloaded VHS MP4 cannot truthfully satisfy that receipt format. Avoid fabricating an 81-PNG harness receipt from locally decoded frames.
- `figment_train.py:_plan_video_manifest`, `_validate_video_source_inputs`, `_build_video_evidence`, `_video_grading_images` currently require approved gen provenance and assume PNG output/assembly. Tensor dispatch must be profile-specific here, while shared approval/QA writers remain authoritative.

## Implementation sequence

### 1. Freeze phase-3 interface and media authority

Targets: `video/video_manifest.py`, `figment_train.py`, phase-3 accepted-edit validator in its final owning module, and relevant `lineage.py` projections if needed.

Define one tensor video input record: creator and passport binding; clip path/size/SHA; extraction receipt path/SHA; exact extracted index-0 PNG path/size/SHA; accepted edit plan/image and current approval lineage; accepted edited PNG path/size/SHA; short positive prompt text/SHA/attribution; fixture status. Use existing snapshot/containment machinery rather than ad hoc path joining.

The accepted edit must be a module-07 start-frame head swap, with scene input equal to this clip's extracted frame 0 and identity input bound to this creator's passport or currently accepted same-creator still. Reject a generic accepted touch-up, a different clip, a middle frame, another creator, a stale/revoked approval, or a declaration with no evidence. The operator's one-person/simple-motion media ruling is an intake fact; automated metadata probing cannot certify it. A real person's reference face never becomes identity authority.

Revalidate every source receipt, selected input, approval, and staged copy before plan completion, each launch, review preparation, and acceptance. Editing source and staged bytes together must not redefine the stored baseline. Reject basename collisions case-insensitively, symlinks/reparse escapes, URL inputs, traversal, missing/empty/oversized media, and changed files during copy/extraction. Preserve clean callers.

Tests: synthetic clips with distinguishable frame 0/middle; valid same-clip chain; wrong frame/clip/creator/edit-kind; cull or pending edit; mutated clip/receipt/start-frame/passport/approval; both copies changed; root escapes and Windows basename collisions. Failure must occur before a network/tool/model call.

### 2. Export graph and establish dependency inventory

Targets: new `video/tensor_video_m08_api.json`; `tensor_parity.py:check_video` and source loader; `train/tensor-pins.yaml` profile/group `video_tensor`; `train/verify_pins.py` only if a narrowly necessary validation extension is discovered.

Walk effective source edges from output 49. Preserve model, mask, pose, reference, vision, resize and sampler branches exactly. Resolve linked dimensions instead of saved literals. Exclude only documented UI fields. Tests independently compare every effective edge/widget against verified source, not against a second copied export. Extend model-name extraction to `ckpt_name`, required by node 110. Validate every expected model and custom node exactly once, including destination directory mapping.

The module-08 installer lists six model URLs but contains **no model SHA256 or immutable revisions**. It clones SAM3 and VideoHelperSuite without commit pins. VHS node metadata gives two different revisions: output49 `a7ce59e381934733bfae03b1be029756d6ce936d`; loader113 `2984ec4c4b93292421888f38db74a5e8802a8ff8`. These are source hints, not one verified working dependency set. Some SAM/SCAIL nodes are marked comfy-core at0.19.3/0.25.0; the installer says WanSCAILToVideo is core; transcript's manager-installed dependency is unnamed. Do not infer an extra repository or silently upgrade the shared ComfyUI runtime.

Reuse already pinned exact files only where URL/file/hash evidence actually matches (the clean video inventory includes the UMT5 filename; verify its full record). For remaining dependencies write an unresolved inventory; fail production planning/preflight explicitly. Offline tests may inject clearly labelled synthetic pin records into temporary fixtures, never commit invented hashes or mark unresolved production pins verified. Real public metadata/license verification is a later separately scoped read-only step, not performed by this plan worker.

Mutation tests: dropped mask branch; swapped drive/reference trackers; missing vision input; hardcoded512x896; changed resize mode/rounding, seed/steps/cfg/shift, fps mismatch, cap/length mismatch, replacement enabled, changed model/LoRA strength, altered negative, injected look prefix, missing/extra pin, source digest change, unsupported custom node, and stale preview text leaking into export.

### 3. Add bounded MP4 transport without relaxing image jobs

Targets: `pod/runpod_run.py:expand_manifest_uploads`, upload clients, `require_manifest`, `ComfyClient.wait_outputs`, `view_params`, `download_output`, `download_job_outputs`, `DryRunComfyClient`, and their `run_harness` call sites; `pod/tests/test_runpod_run.py` plus a focused video-transport test file if clearer.

Add an explicit closed output contract for video jobs: one output node49, one MP4, declared expected count1. Retain default image-job behavior and `expected_images` semantics; do not call one MP4 "81 images". Filter history by the declared output node/type, excluding preview PNGs and VHS metadata sidecars. The actual VHS history key/descriptor shape must be established from locally available source or an attributed recorded fixture; likely `gifs` is not evidence by itself. Reject duplicate, missing, wrong-node, wrong-type, unsafe-path and extra declared outputs.

Extend MP4 upload through the same bounded upload machinery only after verifying the selected server route accepts arbitrary MP4 bytes. Preserve chunked-upload assembly and hard whole-transfer deadlines. Add `.mp4` narrowly; never expand model formats or the pickle hatch. If existing `/upload/image` cannot handle it, implement the smallest verified upload route adaptation with fake-client tests; do not invent a remote shell copy.

For downloads, preserve output-only path validation, traversal rejection, deterministic local names, `.partial` cleanup, cancellation/watchdog limits, and verified teardown. Add finite video byte and total-transfer bounds and enforce them while streaming, including absent/incorrect Content-Length. Record downloaded MP4 bytes/SHA and the submitted effective graph digest with the job receipt. Bind the movie to its prompt_id/output node/manifest job; reject a prior run's movie.

Do not use `artifacts[]` merely to fetch a dynamically named movie: that path currently switches execution to training-style marker handling. Choose the existing Comfy history output path for node49. Dry-run output must explicitly be simulated; an MP4 suffix on PNG bytes is not valid transport proof. Use a small prebuilt synthetic MP4 fixture or distinguish manifest dry-run from local fake-transport verification.

Tests: fake history/upload/view clients, byte caps, multipart/chunked receipt mapping, malformed responses, no-content-length, interrupted streams/partial cleanup, timeout/cancellation, extra preview image, wrong suffix and path. Assert no real network/subprocess pod launch. Run existing image and artifact transport tests unchanged. Leave cost/ledger/lease/teardown logic untouched except necessary shared output parameters, and independently audit all changed harness call sites.

### 4. Compile tensor video plans and ingest direct movies

Targets: `video/video_manifest.py` (profile-specific builder in the existing owner); `figment_train.py` CLI/`build_plan`/`_plan_video_manifest`/`_validate_video_source_inputs`/`_build_video_evidence`/`_video_grading_images`/`verify_run_record`; `video/frame_assemble.py` and `video/frame_extract.py` for a narrow direct-movie evidence path.

Plan exactly one 81-frame/16-fps generation with seed 123; stage clip and accepted edit beneath its manifest root and bind their actual remote names into nodes 113 and 58. Avoid existing `_motion` look-prefix composition. Keep six steps and source aspect-driven dimensions. Any cheaper smoke schedule is a separately labelled later phase-6 manifest, not a hidden parity exception. No fixed landscape fallback or silent padding of an inadequate driving clip; record and reject insufficient usable frames according to verified VHS resampling behavior.

Give direct-MP4 evidence a versioned discriminator/receipt shape. Ingest/hash/probe the downloaded movie without re-encoding it; check codec/pixel format/fps/frame count/dimensions against source-derived expected bounds. Reuse bounded extraction to produce review samples at decoded indices 0, 8, ..., 80 plus first/middle/last views where existing review needs them, bound to the MP4 SHA. Keep these explicitly local decoded samples, never harness-native PNGs. Preserve original video for playback. A reel derivative is optional and separately identified; it cannot replace the native output or force another resize/crop to satisfy old clean assumptions.

Extend `_build_video_evidence` resume checks to revalidate existing receipts instead of trusting file existence. Partial failures leave resumable, non-approved evidence. No local plan, curation, ingestion, or review function launches a pod.

### 5. Preserve the video eye gate and execution provenance

Targets: `video/video_review.py:_rebuild_candidate`, `_subject`, `prepare_review`, accepted-video validation; `video/video_delivery_review.py` and `video/video_delivery_ruling_assertion.py` only at schema-dispatch points if needed; `figment_train.py` video grading/ruling adapters.

Introduce a narrowly versioned tensor candidate subject, retaining existing clean candidate reconstruction. Rebuild against current accepted-edit/clip authority. Existing clean review verifies embedded PNG prompt graphs; MP4 ingest must not silently bypass that requirement. Verify the movie's embedded/sidecar workflow metadata if VHS provides it, and bind it to the submitted graph digest/receipt. Where metadata shape is unavailable offline, mark execution provenance unresolved and refuse promotable video evidence until a separately approved runtime smoke supplies the exact schema. Do not present receipt-only mock evidence as proof of model execution.

Retain mandatory visual adult/clothing/identity review on sampled frames, sequence and playback rulings, explicit age releases/culls, passport display, and current-source revalidation. A score or fixture cannot accept a movie. Use existing review/QA authority writers; do not add a second weaker acceptance path. Once a valid real subject exists, repeated attributed acceptance should retain existing idempotence/conflict behavior.

### 6. Integrate, review, and record status accurately

Tests: new `tests/test_tensor_video_phase4.py`; extend `tests/test_tensor_parity.py`, `video/tests/test_video_manifest.py`, `test_frame_extract.py`, `test_frame_assemble.py`, `test_video_review.py`, `test_video_rulings.py`, and delivery tests when their discriminator changes. Use installed FFmpeg only, no tool download. Pure synthetic media and fake transport; fake models are never invoked. Run focused suites first and relevant clean video/harness regressions after corrections; no concurrent tests sharing repository scratch. Use native Python3.13 and explicit installed Git Bash where shell tests require it (avoid accidental WSL bash selection).

One fixture chain must prove: clip intake -> exact frame0 -> synthetic accepted-edit authority -> tensor plan/parity -> fake upload/history/MP4 download -> native-movie receipt -> decoded review samples -> prepared unreviewed board -> explicit fixture rulings that remain non-production evidence. Mutate each authority boundary between steps. Demonstrate missing production pins, media, or runtime provenance fail clearly without a call that could spend.

Independent review occurs before acceptance: one reviewer traces graph/source/type parity and dependency evidence, another session traces clip/frame0/edit/passport authority plus transport/path/budget containment. An author cannot grade their own changes. Update `pipeline/README.md`, `RUNBOOK.md`, and the existing phase task list only for demonstrated behavior; parent owns coordination writes. No commits/merges/publishing implied by this plan.

## Exit criteria and explicitly pending work

Offline implementation exit: source-derived parity and mutation tests pass; valid synthetic MP4 roundtrip and harness dry-run are distinguished and demonstrated; source-to-edit-to-video freshness holds at plan/launch/review; all relevant clean regressions pass; independent findings are resolved. Unresolved pins/runtime metadata remain explicit blockers, not successful production dry-runs. Report exact tested counts and artifact paths.

Before production/live phase6: actual operator clip and its current frame0 head-swap approval; verified immutable model/node/runtime pins and licences; confirmed DynamicCombo encoding, SAM3/SCAIL availability, VHS upload/history/metadata behavior, aspect rounding, short/VFR clip handling, L40S memory/dependency behavior and measured runtime budget. The saved graph suggests compatibility but does not prove these. Each runtime smoke needs its concrete T2 card, estimate, max-usd/max-minutes, current arc total, and operator approval. The final video still needs its own eye gate. None is authorized by completing this offline plan.


## Independent plan review ? accepted 2026-10-05

File-only review by figment_phase2_review: ACCEPTABLE for authorized offline implementation. All four listed source hashes independently match. Checked resize DynamicCombo inputs, linked dimensions, VHS dictionary widgets and output codec/fps/metadata settings against the actual graph. Existing harness image count/download behavior and video_review PNG graph-proof requirements support the planned explicit video-output contract and versioned direct-MP4 provenance. The plan correctly separates mechanically buildable authority, graph normalization, bounded fake transport and synthetic review from unresolved immutable pins, runtime node schemas, upload/history and execution-metadata evidence. Production preflight and promotion must refuse unresolved evidence; no invented hashes or mock model-execution proof. No implementation tests, network or model calls were performed for this review.

## Offline implementation evidence — 2026-10-05

Implemented source-parity graph/pins, bounded output contracts and MP4 transport, exact decoded frame-zero/edit lineage, native movie metadata/81-frame evidence, and existing video review/ruling integration. Independent graph and transport reviews passed; core review includes the final admission guard. Root rendered and inspected the retained synthetic board (native movie controls, fixture label, anchor, eleven samples and all review groups).

Verification: combined video/edit regression 215 passed in826.13s; final affected checks5 passed in180.14s; transport52 focused passed. Parity191 combined and69 video-focused passed earlier (overlapping counts, not additive). Three legacy shell cases passed with Git Bash after WSL environment failures. One older regression fixture initialized local scorers; its output recorded tiny-image detection failures/advisory values. That fixture now stubs scoring and its real CLI rerun passed; the initial215 run is not claimed model-free. No live pod or paid run was executed.

Evidence lives in the local session directory `C:/Users/danie/kb/_private/figment-session-20261005/`: phase4-test-evidence.txt, phase4-core-final.log, phase4-final-guard.log, graph/transport/core review receipts, phase4-core-hashes.json, phase4-visual-qa.txt and phase4-fixture/proof.json. Synthetic receipts and solid-colour movie prove mechanics, not generated quality or production acceptance.

Remaining implementation: phase6 must add a versioned runtime-admission adapter binding an approved nonfixture smoke, exact runtime/pins/node schema/effective graph/native metadata and verified termination. Current code derives runtime_admitted=false and refuses both live launch and nonfixture acceptance/delivery; editing a receipt cannot grant admission. Real media, model access/licences, installed GPU runtime and quality validation remain separate prerequisites. Conservative CFR16 input admission remains until broader resampling is proven.