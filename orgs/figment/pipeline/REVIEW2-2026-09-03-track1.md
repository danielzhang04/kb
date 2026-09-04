# T1-R2 — delta re-review of the Track-1 fixes

Reviewed the requested fix commits `1dc406e9` and `794668c0` on branch
`claude/figment`. The working-tree HEAD was actually `39098d39`, one state-only commit after
`794668c0`; no Track-1 implementation changed in that extra commit. `origin/claude/figment`
is `794668c0`, so the local branch is one commit ahead and `merge-tree` produced no conflict
markers.

This pass used the code-review and security-review checklists. No live pod, authenticated API,
secret, commit, or paid action was used. The only implementation-data edits are the expressly
permitted immutable `revision` and `sha256` fields in the smoke and three shard manifests. This
file is the only other output.

## Verdict

| Stage | LIVE-SAFE now? | Conditions / reason |
| --- | --- | --- |
| dependency smoke | **YES, conditional** | Technically bounded to one L40S placement and `$1.41`; the manifest, targeted tests, static checks, and dry-run pass. This review is not spend authorization: a T2 card must name the manifest, one cell, `$1.41`, 65 minutes, current `$6.654787 / $50` arc state, and receive human approval. Recheck the local ledgers immediately before create. Treat any dependency/model/class/job/output/termination failure as a stop, with no automatic or manual retry under the same approval. This is a probe of the still-time-varying InsightFace dependency, not evidence that it is reproducibly pinned. |
| shard-01 | **NO now** | It becomes conditionally eligible only **after smoke passes** all three documented gates: every `node-deps-*` step (especially FaceAnalysis) is `rc=0`, every declared model SHA check passes and required `/object_info` class is present, and the real job produces one verified image. Before shard approval, either declare/hash the runtime `buffalo_l` pack and lock the relevant Python dependency, or make its time-varying nature an explicit human T2 risk acceptance. Then issue a separate T2 card, recheck the ledger/daily/arc budgets, and keep one placement. |
| training | **NO** | Findings 5, 9, 13, and 14 remain: its manifest model and two HF pre-warm snapshots are unpinned; descriptive-caption equivalence is not implemented or approved; the exact image/ai-toolkit/Torch environment is unproved; and the Krea raw state-dict compatibility is unproved. It also depends on a human-curated dataset after the shards. |
| tester | **NO** | It depends on a successful training run and all three Krea model entries still resolve mutable `main` without digests. The 12-checkpoint local upload bridge itself is fixed. |
| generation | **NO** | It depends on a selected tester winner and all four model entries still resolve mutable `main` without digests. Current manifests are pickle-free, but the harness still lacks a general `.pt`/`.pth` model rejection. |

The complete Track-1 branch is **not merge-ready**: the full pipeline suite has two calibration
failures, and the later paid stages retain the blockers above. The smoke can nevertheless be
used as the deliberately small dependency probe under its separate human approval and hard
ceilings.

## Closure of the requested 18 findings

Counts: **10 yes, 6 partial, 2 no**.

| # | closed? | current file:line evidence | what is still wrong |
| --- | --- | --- | --- |
| 1 | **yes** | `pod/runpod_run.py:1781-1807` resolves the ledger and refuses live create without a `figment-*.tsv` baseline; `pod/runpod_run.py:3080-3114` logs and checks that ledger before create; tests are at `pod/tests/test_runpod_run.py:3153-3202`. The three local ledger blob hashes exactly equal the corresponding files on `origin/ops`. | Nothing for this brief, provided the exact CLI below passes the explicit local ledger directory. Omitting it can still select the ops worktree by default, so the explicit argument remains important. |
| 2 | **yes** | `pod/runpod_run.py:78,171-193` defines the America/New_York day; `pod/runpod_run.py:3085-3107,3212-3218,3279-3282,3596-3601` captures it once and reuses it for provisional and settled rows. Boundary/settlement tests are `pod/tests/test_runpod_run.py:3204-3251`; duplicate-pod coverage is `:3289-3303`. | Nothing found. The reconciled rows have no duplicate pod IDs and total `$6.654787`; Sep 3 is `$4.682165`. |
| 3 | **partial** | The hard cap is authoritative in `MANDATE.md:150-156`, `contract.md:17-24,57`, the harness default is `pod/runpod_run.py:73`, and the latest state records `$50` at `STATE.md:135-142`. | `STATE.md:88` still contains the obsolete `$52.85` cap. It is superseded by the later update and cannot widen the contract, but the durable state remains internally contradictory. |
| 4 | **yes** | The body prompt was rewritten at `expand/templates/tensor-dataset-prompts.yaml:33` and in the baked graph at `expand/workflows/tensor_dataset_v2_api.json:57`. The 4a/4b guard and full 4c union are exercised at `expand/tests/test_tensor_dataset.py:41-58,310-331,442-446`. | Nothing found. The independent whole-word grep covered `young`, `youthful`, `girl`, `girlish`, `small`, `little`, `cute`, `innocent`, `fresh-faced`, plus bare age numerals; it returned no shipped-prompt match. |
| 5 | **partial** | The harness validates optional revisions/digests at `pod/runpod_run.py:1450-1466`, builds revisioned URLs and verifies SHA-256 at `:2283-2331`, with tests at `pod/tests/test_runpod_run.py:1551-1620`. This pass populated all 8 entries in smoke (`expand/runs/creator-001-tensor-smoke.yaml:29-84`) and all 8 entries in each shard (for example shard-01 `:23-30`). | The schema still defaults an omitted revision to `main` and permits no digest (`pod/runpod_run.py:1451,1461-1463`). Training has 1/1 unpinned model (`train/runs/creator-001-tensor-train.yaml:23-28`), tester 3/3 (`...tester.yaml:22-37`), and generation 4/4 (`...gen.yaml:22-42`). The training bootstrap also makes unpinned `snapshot_download` calls at `train/runs/start-training-aitoolkit.sh.template:51-58`. |
| 6 | **yes** | Every custom node must have a 40-hex commit at `pod/runpod_run.py:1469-1480`; bootstrap fetches, detached-checks out, verifies `HEAD`, and logs it at `:2336-2355`. Across smoke, all shards, tester, and generation, 22/22 entries pass the 40-hex check. Representative manifest pins are smoke `:86-111`, shard-01 `:32-37`, tester `:39-43`, and generation `:44-48`. | The `_pin_enforcement` prose in the smoke and shard manifests is stale (for example shard-01 `:4`): it still claims the pins are recorded but not enforced. That is documentation drift, not executable behavior. |
| 7 | **yes** | Harness default is one at `pod/runpod_run.py:42,1443-1447`; smoke/shard-01 declare one at their `:12`/`:8`; train/tester/gen declare one at their `:9`. The regression test is `pod/tests/test_runpod_run.py:3254-3255`. | Nothing found. A second paid placement requires a different manifest/approval or a new invocation. |
| 8 | **partial** | The one-real-job smoke is defined at `expand/runs/creator-001-tensor-smoke.yaml:2,10-27,129-150`; its required green signals are documented at `expand/TENSOR-REPLICATION.md:100-124`. | No live dependency closure exists yet. At pinned `cubiq/ComfyUI_FaceAnalysis@884665...`, `requirements.txt:1-4` leaves `dlib`, `onnxruntime`, and `insightface` unversioned, while `faceanalysis.py:103-106` instantiates `FaceAnalysis(name="buffalo_l")`; the pack remains outside the manifest and without a recorded digest. The smoke can discover current compatibility, but dry-run cannot prove it and a pass is time-local unless this dependency is pinned. |
| 9 | **partial** | `train/build_training_set.py:1-47,102-180` now gathers an operator-approved list, re-encodes images, creates same-basename captions, records image digests, verifies pairs, and writes `_dataset.ready` last; its tests include `train/tests/test_build_training_set.py:48-103,204-244`. The train manifest uploads the products at `train/runs/creator-001-tensor-train.yaml:43-83`. | Module-11-equivalent Qwen3-VL captioning remains deliberately unimplemented and fails closed (`train/build_training_set.py:22-27,132-139`). `provided` mode trusts human-supplied text without proving descriptive-caption equivalence, and no explicit approval of that offline equivalent was found. |
| 10 | **yes** | Training declares 12 artifacts at `train/runs/creator-001-tensor-train.yaml:93-165`; the start script verifies all 11 cadence files plus exact step-3000 final, copies all 12, then writes the marker at `train/runs/start-training-aitoolkit.sh.template:138-176`. | Nothing found. Publication fails before `_training.complete` on a missing or empty checkpoint. |
| 11 | **yes** | The runtime formula is `pod/runpod_run.py:1493-1505,1562-1586`; first marker and download share one deadline at `:3379-3420`. The near-exhausted-deadline regression is `pod/tests/test_runpod_run.py:3258-3286`. | Nothing found. |
| 12 | **yes** | Tester uploads the harness-downloaded safetensors at `train/runs/creator-001-tensor-tester.yaml:165-178`; training documentation describes local transport and no network volume at `train/TENSOR-TRAINING.md:140-148`. | Nothing found. The placeholder network-volume ID is gone. |
| 13 | **no** | Training still uses the exact image at `train/runs/creator-001-tensor-train.yaml:13`, sets `reinstall_torch: "0"` at `:75`, and installs the upstream requirements without a lock at `train/runs/start-training-aitoolkit.sh.template:43-49`. `train/TENSOR-TRAINING.md:179-181` still calls the combination untested. | There is still no exact-image install/`torch.cuda`/trainer-import probe, resolved package lock, or guard proving that requirements do not replace Torch. |
| 14 | **no** | The raw repackage remains `Comfy-Org/Krea-2/diffusion_models/krea2_raw_bf16.safetensors` at `train/runs/creator-001-tensor-train.yaml:23-28`; `train/TENSOR-TRAINING.md:182-184` still says key compatibility has not been checked. | No safetensors-header/state-dict key and required-shape comparison against the ai-toolkit-expected source was added. |
| 15 | **yes** | Train/tester/gen all use `$1.30/h` at their manifest `:7`; their maximums are 280/105/165 minutes at `:8`. Dataset shards use `$1.30/h` at shard `:6`; the replication cost basis is `expand/TENSOR-REPLICATION.md:90-98`. | Nothing found in the declared rates. READY price recheck remains required at runtime. |
| 16 | **partial** | Current Track-1 manifests contain no `.pt` or `.pth`; generation uses RealPLKSR safetensors at `train/runs/creator-001-tensor-gen.yaml:38-42,155-172`, and the scoped test is `train/tests/test_tensor_track.py:297-327`. FaceDetailer/SAM removal is documented at `train/TENSOR-TRAINING.md:152-161`. | `pod/runpod_run.py` has no general model-extension rejection, so another manifest can still send `.pt`/`.pth` to a pod. The prior finding's requested fail-closed schema protection was not implemented; only the present Track-1 manifests are guarded by their test. |
| 17 | **partial** | Generation now has two diagnostic outputs and declares `expected_images: 2` for every job (`train/runs/creator-001-tensor-gen.yaml:278-486`); the safe reason for omitting FaceDetailer's third output is `train/TENSOR-TRAINING.md:152-156`. Tester still has twelve sequential one-image jobs (`...tester.yaml:180-327`). | The tester was not restored to one 12-output graph. Its documented reason still says dry-run returns exactly one image per job (`train/TENSOR-TRAINING.md:149-151`), even though the same document acknowledges current multi-image support at `:152-154`. That is not the requested current non-simulator rationale. |
| 18 | **yes** | `pod/runpod_run.py:1508-1559` accepts only `HF_TOKEN -> secret-name`, payload construction is at `:1981-1985`, and bootstrap unsets it before node code at `:2293-2335`. Negative tests are `pod/tests/test_runpod_run.py:94-131`. | Nothing found in the supported path. This review did not access a secret value. |

### The prior file contains three additional findings

Although the brief and current `STATE.md` say 18 findings, the actual prior review table contains
**21** (`REVIEW-2026-09-03-track1.md:16,37-59`). For completeness:

| # | closed? | evidence / residual |
| --- | --- | --- |
| 19 | **no** | `train/render_aitoolkit_config.py:79-98` still omits the previously named `linear_alpha`, weight decay, caption extension, repeats, TE quantization/qtype, layer offloading, and loss/content invariants. |
| 20 | **no** | `pod/runpod_run.py:3224-3229` still sets `placement_needs_close` only after `lease.__enter__()` returns, preserving the narrow interrupt window. |
| 21 | **partial** | Artifact count, transport, rates, and most stage facts are updated, but `train/TENSOR-TRAINING.md:149-151` retains the obsolete one-image dry-run claim and `:175-178` still calls the now-reconciled ledgers unresolved. The manifest `_pin_enforcement` notes are also stale. |

## Smoke live boundary, independently re-derived

Manifest evidence: one L40S at `$1.30/h`, 65 minutes, one placement
(`expand/runs/creator-001-tensor-smoke.yaml:10-16`), readiness 2700 seconds and job 600
seconds (`:26-27`), and one job (`:129-150`). The harness formula is
`pod/runpod_run.py:1562-1586`.

```text
minimum runtime = (readiness + jobs × job timeout + teardown) / 60
                = (2700 + 1 × 600 + 300) / 60
                = 60 minutes
manifest/CLI cap = 65 minutes (5 minutes above the minimum)

preflight estimate = hourly price × max_minutes / 60
                   = 1.30 × 65 / 60
                   = $1.408333...
--max-usd         = $1.41
```

The harness functions, run read-only against
`C:/Users/danie/kb-worktrees/figment/ledgers/cost`, returned:

| Boundary | before | after one maximum smoke | cap | remaining |
| --- | ---: | ---: | ---: | ---: |
| America/New_York day 2026-09-03 | `$4.682165` | `$6.090498` | `$10.000000` | `$3.909502` |
| creator-001 arc | `$6.654787` | `$8.063120` | `$50.000000` | `$41.936880` |

The brief's rounded `$4.68` daily and `$6.65` arc figures therefore reconcile. All three local
ledger blobs equal `origin/ops`, and there are no duplicate pod IDs. One placement means the
approved maximum liability is one `$1.408333` estimate, not a multiple of it.

The post-pin dry-run exited 0. It recorded `ledger_day: 2026-09-03` even though `started_utc`
was `2026-09-04T03:22:46Z`, used one placement, verified one output, and ended with
`termination_verified: true`. Its dry-run ledger correctly lived under the temporary output,
not the live ledger.

## Model and node pins

Before this pass, all eight model entries in each of the smoke and three shard manifests omitted
both fields and therefore resolved mutable `main`. I fetched each immutable Hugging Face tree
at `/api/models/<repo>/tree/<revision>?recursive=true&expand=true`, required
`lastCommit.id == revision`, and required `lfs.oid == sha256`. All 8 unique files verified; the
same data is now present in all four manifests (32/32 model entries).

| repo / file | revision added | SHA-256 added |
| --- | --- | --- |
| `Comfy-Org/Qwen-Image-Edit_ComfyUI` / `split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors` | `4c7c4ea236326cbae56d403d22a03c6cd86ad9a0` | `c9fdc158e46d3b61ef75f21ae866ca2fe808bf4a53643120d1c1e87c19280a4e` |
| `Comfy-Org/Qwen-Image_ComfyUI` / `split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors` | `25608066f9bf5cdc28020836ce9549587053f346` | `cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4` |
| `Comfy-Org/Qwen-Image_ComfyUI` / `split_files/vae/qwen_image_vae.safetensors` | `dfe60a0d63f0b946628080f070978594983b8b6e` | `a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f` |
| `lightx2v/Qwen-Image-Edit-2511-Lightning` / `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` | `fd3a43ffb5bc98c7d09b2238e5b09a63284a16f8` | `22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f` |
| `Comfy-Org/flux2-klein-4B` / `split_files/diffusion_models/flux-2-klein-4b.safetensors` | `adabe6c3c8bdcc9cb1f27b25729b70924961c223` | `ec3d4e733a771f61c052fb4856c48b336c55eaf2c65487c2a1faeb9bbda7a343` |
| `Comfy-Org/flux2-klein-4B` / `split_files/text_encoders/qwen_3_4b.safetensors` | `8556e4d870cda7c53c7942b190bfeea5be9bd411` | `6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a` |
| `Comfy-Org/flux2-klein-4B` / `split_files/vae/flux2-vae.safetensors` | `a9e4ca87c16db4c4e1a16406a9ddb300ab0ae246` | `868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3` |
| `Phips/4xNomosWebPhoto_RealPLKSR` / `4xNomosWebPhoto_RealPLKSR.safetensors` | `ee1791235ab82e639bf6fde5581a2440771a14c0` | `9be0228f98156a100d6636d99b373ed2785b999723f9adc4cca504329ab157f2` |

All 22 `custom_nodes` entries across smoke, the three shards, tester, and generation carry a
40-hex `git_ref` or `installer_pin` (six unique URL/SHA spellings, because RES4LYF appears both
with and without `.git`). Two requested remote commit checks were made against GitHub's
unauthenticated commit API, and each returned the exact requested SHA:

- `https://api.github.com/repos/ClownsharkBatwing/RES4LYF/commits/e716cd1cb2c5cff90131bf4914b75b75a0489d48`
- `https://api.github.com/repos/kijai/ComfyUI-KJNodes/commits/8692bc8ef8beaaeee80fd52ba80477dc9e61547b`

## Verification results

| Check | Result |
| --- | --- |
| Required preamble | `PREAMBLE OK` |
| Requested commit inspection | `git show --stat` and full diffs read for `1dc406e9` (16 files, `1006+ / 238-`) and `794668c0` (3 files, `556+ / 80-`) |
| Targeted pod + expand + train tests | **396 passed in 15.94s** |
| Full `orgs/figment/pipeline` suite | **475 passed, 2 failed in 16.38s** |
| Full-suite failures | `calibrate/tests/test_grid_run.py::test_two_fixed_seeds_and_manifest_passes_harness_dry_run` and `::test_grid01_is_40_single_axis_cells_with_probe_configuration` |
| Failure cause | `calibrate/grid_run.py:307-309` validates generated 10/40-job grids through `require_manifest`; `pod/runpod_run.py:1577-1585` multiplies each job by the full job timeout, yielding 175/625-minute minimums against declared 25/40-minute caps. `git blame` attributes that multiplication to pre-review commit `fda03ba2`, not either fix commit, but it still blocks branch-wide green. |
| Required pytest temp root | `PYTEST_DEBUG_TEMPROOT=C:/Users/danie/AppData/Local/Temp/kbfp-r2` for both test runs |
| Removal-branch grep | no match in the shipped tensor workflow/template/smoke/shards for `qwen-rapid-aio`, `CheckpointLoaderSimple`, `bfs_head_v5`, `qwen2512_`, `zit_upscaler`, `sam_vit_b`, `remove the clothes`, or `fully naked` |
| Section 4 checks | 4a/4b test vocabulary plus every 4c token and bare age numeral covered; no match in shipped prompt surfaces |
| No-pickle grep | no `.pt`/`.pth` match in any `expand/runs` or `train/runs` manifest |
| Smoke/shard model pins | 32/32 entries valid; 8/8 unique HF revision/LFS-digest pairs remotely verified |
| Track-1 custom-node pins | 22/22 entries are 40 hex; 2/2 requested GitHub commits remotely verified |
| Smoke dry-run | exit 0; estimate `$1.4083`; one placement; one verified file; termination verified |
| Patch hygiene | `git diff --check` clean before this report; only four permitted manifest content diffs plus this report |
| Merge simulation | local branch one state-only commit ahead of `origin/claude/figment`; no conflict markers |

## Exact smoke CLI

This command is for the human-approved live invocation **after** the T2 card records the
conditions above. It was not run by this review.

```powershell
py -3 orgs/figment/pipeline/pod/runpod_run.py run --manifest orgs/figment/pipeline/expand/runs/creator-001-tensor-smoke.yaml --out orgs/figment/pipeline/expand/runs/out/creator-001-tensor-smoke --max-usd 1.41 --max-minutes 65 --ledger-dir C:/Users/danie/kb-worktrees/figment/ledgers/cost --arc-cap-usd 50.00 --arc-ledger-glob 'figment-*.tsv'
```

The corresponding review dry-run used the same manifest, `$1.41`, 65 minutes, and `$50` cap,
with `--dry-run` and a temporary output under the required pytest temp root. It intentionally did
not point at the live ledger, because dry-run writes a zero-dollar provisional row.
