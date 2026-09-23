# figment live chain — every stage live-proven; first passing gen stills; analysis + next angles — 2026-09-23 (boss handoff, arc close)

**Topic:** Close of the arc opened 2026-09-15. The eight-stage `pipeline` has now run live at every stage on creator-001 with real rulings at every gate. The 3000-step / qwen3vl-caption / module-11 train produced the first checkpoint ladder to clear the tester gate (step 2000 accepted), and — after removing the gen refine pass — the first three gen stills ever to clear the full gate. The remaining gap versus the pipelines we imitate is now measured, not guessed. Supersedes `handoffs/2026-09-21-figment-live-chain.md` (removed in this push). Daniel's standing instruction: stop here, analyse, decide the next angle.

## Branch / worktree / spend
- `claude/figment-e2e` @ **c3d0dec6** + the docs commit that follows it (≈41 commits over bae65b2b; NOT pushed; no PR — T3 is Daniel's; "one branch, one merge"). Worktree `C:/Users/danie/kb-worktrees/figment-e2e`. `governance/budget.yaml` on the branch carries Daniel's uncommitted edit `daily_usd_limit: 20.00` (BOM-free; leave it to him).
- Run roots (all gitignored, all with gate.json + rulings + lineage): `live-20260916b` (dataset 32/60, captions, smoke, train, tester 2/12 → step 2000; `downstream/gen` 0/12), `ab-20260922-trigger-scene-2` (0/12), `run1-20260923-close-norefine` (**3/12 PASS**, approval lineage), `detail1-20260923` (1/6), `video1-20260923` (0/11 no-face; `video/assembled/candidate.mp4`, `video/reel/reel.mp4`). Older: `live-20260915b` (klein 0/30), `live-20260916` (18/60, left at gate).
- Spend for this work ≈ **$19.13** (rows after pod tb3ki0jgv6rwbs in `ledgers/cost/figment-2026-09-{15,16,17,21,22,23}.tsv`, pushed to ops with this handoff; the 09-17 train row is the settled $2.90); arc total ≈ $54.3 of $60. Every pod: teardown verified.
- Tooling (survives sessions): `C:/ptmp/fe2e/` — launchers that hold a keep-awake lease on the harness pid (`run-live-resume-b.ps1`, `run-ab-gen.ps1`, `run-r1-gen.ps1`, `run-d1-detail*.ps1`, `run-v1-video-loop.ps1`), `rule_tester_by_numbers.py`, all rulings JSONs, `keeps-run1/` (the three kept stills), thumbnails, logs.

## What WORKED (with evidence)
- **Tester 2/12 on the 3000-step train** (`live-20260916b/grade/tester/gate.json`): step 2000 identity 0.895 / judge 88, final 0.900 / 74; `accepted-checkpoint.json`, `training.yaml` `chosen_checkpoint_step: 2000` (ee6ce232). Opus evidence review: CLAIMS-SUPPORTED.
- **Run 1 gen 3/12 PASS** (`run1-20260923-close-norefine/grade/gen/gate.json`): `--gen-prompt-style look-clause-close --gen-refine-denoise 0 --gen-detailer-denoise 0.20`; judge same_person median 72, FaceNet 0.88, faces 548–719 px. Independent read of the three keeps vs g01: 78/85/82, consistent as one woman, natural matte skin, no artifacts.
- **Detail 1/6** (`detail1-20260923`): the denoise-0.15 pass on gen-01 scored 78; 0.27 variants drifted (55–62, skin 18–28). First live detail run.
- **Video mechanically live** (`video1-20260923`): Wan 2.2 TI2V 5B, 81 frames, candidate.mp4 + reel.mp4 + frame extraction + gate execution, $0.18.
- **Harness hardening, live-proven** (b2087175 → 30ab4eba, two opus reviews): sliced dual-clock deadlines, `KeepAwake` for the pod's life, pod-side dead-man (pod-keyed validated epoch), socket-level upload unblock, `ReadinessTimeout` → learned bad host (c3d0dec6). Root cause of the 09-21 $4.58 burn proven by the Windows power log (Modern Standby 19:53→20:05, resume 00:01) — the prior session's lease died with its process.
- **Driver**: `--retry-failed` (+ never-created class, + `ReadinessTimeout`), `--retry-caption-after-fix`, `--retry-after-fix`, `refused` state, `--replan-downstream`, gen-time flags (`--gen-prompt-style`, `--gen-refine-denoise`, `--gen-detailer-denoise`), gen authority revalidation via `training_input_projection` (609ba00e — also fixed the pre-existing `--style-lora` A/B bug).

## What Did NOT Work (and why)
- **Gen with the default graph** (refine 0.35 + detailer 0.15): 0/12 — 9 fail the 600 px floor at "waist up" framing, the rest judge 45–68. Same checkpoint scores 88 on the single-pass tester: every extra denoise pass redraws her toward the base prior.
- **Trigger-scene prompts (no look clause)**: 0/12, judge 30–60, age +4–10 y — the look clause HELPS; 10sorlabs' "prompt and LoRA must agree" holds. Keep it, add framing to it.
- **Training-set ancestry**: the approved dataset cells already carry the edit model's signature (fuller lips, sharper arched brows, prominent cheekbones, smoothed skin) — the LoRA learned it faithfully. This is the ceiling on "exact to g01" until the dataset source changes.
- **Video**: portrait still → 1280×704 landscape TI2V; camera tilts (motion instruction ignored); reel crop 1080×1920; MTCNN finds no face at ~25–30% frame height → 0/11 with every metric "unavailable".
- **Ops hazard**: another session's ops sync overwrote `figment-2026-09-17.tsv` in the ops coordination checkout (settled train row lost, later restored by Daniel). Never sync that checkout while figment pods are live.
- **Host**: local DNS drops (3 incidents) and Modern Standby; the harness now tolerates both, but a static resolver on the adapter is still Daniel's call.

## What Has NOT Been Tried Yet (recommended next angles, in order)
1. **Gen defaults** = look-clause-close prompts, refine off, detailer 0.15–0.20 (run 1's recipe) — make it the persona default and re-run gen to get ≥6 keeps; add gen-side tight framing for the 4 near-miss face_px cells.
2. **Dataset source without edit-model bias**: klein reference-lock set (composer fixed in e8440d2c, unvalidated live, ≈$1.7) or module 10's on-pod face-crop + upscale; add a dataset judge axis for lip/brow/cheekbone drift vs g01 so the training set is gated on the traits that drift.
3. **Video**: portrait resolution profile (704×1280) for reels; honour the motion instruction (or a static-camera template); gate frames on the upscaled/reel derivative with a smaller min-face; re-run on the run-1 keeps.
4. **Rulings owed**: `full` framing floor; whether judge 70.2 (0.9× anchor self-similarity) is the product bar or "usable creator" sits at 65–70.
5. Test isolation: 24 driver tests read the LIVE ledger and fail when the arc nears its cap — point them at a fixture ledger.

## Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/figment/pipeline/figment_train.py` | DONE | dataset sources, retries/refused/replan, gen-time flags, authority revalidation |
| `orgs/figment/pipeline/pod/runpod_run.py` | DONE (opus ×3) | suspend-proof deadlines, KeepAwake, dead-man, socket unblock, ReadinessTimeout host learning |
| `orgs/figment/pipeline/train/runs/start-qwen3vl-caption.sh.template` | DONE (live-proven) | deps, diagnostics, bf16, body bound |
| `orgs/figment/pipeline/expand/templates/{tensor-dataset-prompts,gen-prompts}.yaml` | DONE | tight face rows; `scenes_close` |
| `orgs/figment/personas/creator-001/{persona,training}.yaml` | DONE | by_framing half 300; qwen-edit ×2; qwen3vl; chosen checkpoint 2000 |
| `orgs/figment/{STATE.md,RUNBOOK.md,pipeline/README.md,pipeline/train/TENSOR-TRAINING.md}` | DONE | evidence tables, flags, analysis |
| `governance/budget.yaml` (branch, uncommitted) | Daniel | 20.00, BOM-free |

## Exact Next Step
Daniel reads STATE.md "Next" and picks the angle. If (1): `plan --creator creator-001 --stage gen --gen-prompt-style look-clause-close --gen-refine-denoise 0 --gen-detailer-denoise 0.15 --out orgs/figment/runs/creator-001/<stamp>` → launch with a lease-holding launcher (copy `C:/ptmp/fe2e/run-r1-gen.ps1`) → `grade --stage gen` → rule by the numbers. Before any merge: one branch, one PR, Daniel reviews.

## Load list
- this file; `orgs/figment/STATE.md`; `orgs/figment/pipeline/README.md` ("Live-proven runs to date", open defects); `orgs/figment/RUNBOOK.md` (retry/refused/replan/A-B sections)
- `orgs/figment/pipeline/train/TENSOR-TRAINING.md` (settings table + live evidence rows)
- `memory/claude-boss.md` sections "2026-09-16 — figment" and "2026-09-23 — figment"
- `C:/ptmp/fe2e/` tooling; `orgs/figment/runs/creator-001/run1-20260923-close-norefine/grade/gen/board.html` (the three passing stills)
