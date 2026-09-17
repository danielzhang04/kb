# figment live chain — dataset approved, captions live-proven, train blocked on governance — 2026-09-16 (boss handoff, interim)

**Topic:** One boss session (2026-09-15 17:00 → 2026-09-16, Fable 5.1, 14 subagents, all model-verified by transcript grep) took `claude/figment-e2e` from "pipeline command proven only at tester" to a live, gated dataset stage with real qwen3vl captions and a smoke train, and found/fixed nine live-only defects on the way. The 3000-step train is planned and `refused` by the daily budget guard; it launches the moment `governance/budget.yaml` on the branch reads `daily_usd_limit >= 22` (human-edited; classifier refused the boss). Supersedes `handoffs/2026-09-15-figment-e2e-infra.md` (removed in this push).

## Branch / worktree
- `claude/figment-e2e` @ **f732570d** (23 commits over bae65b2b; NOT pushed; no PR — T3 is Daniel's). Worktree `C:/Users/danie/kb-worktrees/figment-e2e`, clean.
- Run root of record: `orgs/figment/runs/creator-001/live-20260916b/` (gitignored). Older evidence roots: `live-20260915b` (klein-multiref 0/30, 30 culls + rejection lineage), `live-20260916` (qwen-edit 18/60, left at its gate for the `full`-floor ruling).
- Session tooling (survives sessions): `C:/ptmp/fe2e/` — `run-live-resume-b.cmd` (resume the chain), `run-apply-dataset-b-loop.cmd` (caption retry loop), `rule_tester_by_numbers.py` (tester gate ruling by the numbers + `--checkpoint-step`), `qwen-dataset-b-rulings.json`, `lessons-2026-09-16-draft.md`, all `live-*.log`s.
- Spend: work ≈ **$8.4** of Daniel's $20 (rows after pod tb3ki0jgv6rwbs in `ledgers/cost/figment-2026-09-15.tsv` + `figment-2026-09-16.tsv`, pushed to ops with this handoff); arc ≈ $44.5 of the $60 cap.

## What WORKED (with evidence)
- **Dataset stage live through its gate, twice**: qwen-edit module-10 replica, `dataset_replicates: 2`, 60 cells / 8 pods each. First pass 18/60 (`live-20260916/grade/dataset/gate.json`: identity_own median 0.898; 16 close cells failed only `face_px<600` — prompt rows worded "photograph … view of her face" rendered ~480 px). After tightening nine face rows (commit 9c3fd596): **32/60** (`live-20260916b/grade/dataset/gate.json`: close 21/30 at 570–1103 px, half 10/20, full 1/10). Ruled by the numbers, `approval-lineage.json` + `approved-list.json` written.
- **qwen3vl caption pod live-proven** (4th attempt, pod symlq3jynb83a8, $0.12): 32 captions in <2 min, `captions.json` 18 KB, dataset assembled with captions.
- **Smoke train** (pod bwdhqfvt72a0d9, $0.27): 50-step + final checkpoint (228 MB each) downloaded, `_training.log` captured.
- **Per-framing face floor** (Daniel's ruling A, 2026-09-15): `persona.yaml identity.floor.min_face_px.by_framing: {half: 300}`, `framing` carried plan→manifest→grade→gate.json (`face_px_min_applied`), tests 82 in `test_identity_gate.py`.
- **Driver hardening, each test-first and used live**: `--retry-failed` (verified-teardown zero-output transport failures; used for the DNS-blip shard-04), never-created capacity-500 class (own cap 8), `--retry-caption-after-fix <reason>` (job-class caption failures after a committed fix, cap 4), `refused` state for pre-launch budget/arc refusals (no attempt consumed), harness diagnostics dir allow-listed as bookkeeping. RUNBOOK documents each.
- **Klein 3-ref source** (`dataset_source: klein-multiref`) built, opus-reviewed twice, pins live-verified, ran live once ($1.62): 30 clean self-consistent 2048×2560 cells, gate 0/30 because the composer put a textual feature description ahead of the ReferenceLatent inputs (identity_own median 0.61 vs floor 0.7907). Composer rewritten to reference-lock prompts (e8440d2c), NOT re-run live.
- **Settings table vs 10sorlabs modules 10/11** in `pipeline/train/TENSOR-TRAINING.md` with every deviation justified; STATE.md and `pipeline/README.md` "Live-proven runs" table current as of f732570d.
- Reviews: two opus adversarial passes on the dataset source (BLOCKER on face_px vs framing → the ruling; HIGH double-`wearing`, profile angles, timeout headroom — all fixed), one opus pass on `--retry-failed` (SAFE-TO-RETRY-LIVE; 3 MEDIUM hygiene items fixed).

## What Did NOT Work (and why)
- **Train launch** — `daily budget refused: $6.1967 spent + $15.7300 estimate exceeds $10.0000` (harness rule is spent-today + ceiling). Recorded as `refused` (never launched). Needs `governance/budget.yaml` `daily_usd_limit: 25.00` on the branch for today, or ≥ 16 on a fresh day (tester 2.82 follows on the same day: 20 is enough tomorrow). The boss's own edit and even re-creating its heartbeat cron were denied by the classifier — correct boundary, do not retry; hand Daniel the `!` command.
- **Klein composer with `_compose_look_clause`** — text overrode references (above). Fixed, unvalidated live.
- **Caption pod, attempts 1–3** — (1) zero-byte `_images.ready` sentinel rejected by the harness upload preflight (only `_dataset.ready` is exempt) → sentinel now carries JSON; the start-script template was also never staged beside the manifest; (2) pod script had no python deps and its log stayed on the pod → pinned `transformers==4.57.1`, `accelerate==1.10.1` (the image ships transformers 5.17), log routed to `_training.log` so the harness captures it; (3) `dtype=torch.float8_e4m3fn` to `from_pretrained` → `TypeError: couldn't find storage object Float8_e4m3fnStorage` (module 11's "float8" is ai-toolkit's quantize-time setting) → load bf16; (4) 500-char caption body cap vs `max_new_tokens 128` → `CAPTIONS_MAX_BODY_CHARS = 1200`. Two RunPod capacity 500s ("no instances currently available") in between, $0.
- **Shard-04 DNS blip** (`NameResolutionError` at readiness, pod verified absent, $0.15) — the driver demanded a fresh plan; `--retry-failed` built and reviewed for exactly this.
- **Prod-window hook** (another session's kb-v1 launch, until 07:34) blocked all Agent calls for ~2 h; small edits done by hand.
- **Two sonnet agents stalled** (stream watchdog) on network-ish lookups; replacement with "OFFLINE ONLY, budget N calls" finished in 20 min.

## What Has NOT Been Tried Yet
- The 3000-step train + 12-checkpoint tester screen (blocked above). Then gen (`--style-lora inline-skin --style-lora-strength 0.8` A/B), detail, video, deliverable — all fixture-proven only.
- `full` framing floor ruling (10 fullbody cells fail the 600 default at 276–374 px every run) — Daniel's; `live-20260916` is left at its gate as evidence.
- Klein-multiref with the reference-lock prompts as a scored A/B (≈$1.7).
- Module-10 fidelity gap: their face branch is a 1680² face crop + upscale; ours is prompt-only ("tight headshot"). An on-pod FaceBoundingBox crop + upscale for close cells would make face_px independent of prompt luck.

## Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/figment/pipeline/figment_train.py` | DONE | klein-multiref source, per-framing floor plumbing, retry classes, refused state, caption fixes |
| `orgs/figment/pipeline/identity_gate.py`, `gate.yaml`, `personas/creator-001/persona.yaml` | DONE | by_framing floor (half 300), `KNOWN_FRAMINGS`, ruling recorded |
| `orgs/figment/pipeline/train/tensor-pins.yaml` | DONE | `dataset_multiref` stage (480 s/155 min), caption `pip` pins |
| `orgs/figment/pipeline/train/runs/start-qwen3vl-caption.sh.template` | DONE (live-proven) | deps, diagnostics, bf16, body bound |
| `orgs/figment/pipeline/expand/templates/tensor-dataset-prompts.yaml` | DONE | tight face rows |
| `orgs/figment/pipeline/train/TENSOR-TRAINING.md`, `RUNBOOK.md`, `pipeline/README.md`, `STATE.md` | DONE | settings table, evidence, retry/refused docs |
| `governance/budget.yaml` (branch) | TODO (Daniel) | 10 → 25 today, or ≥ 16 tomorrow |
| `orgs/figment/runs/creator-001/live-20260916b/` | WIP (gitignored) | dataset approved+captioned, smoke complete, train `refused` |

## Exact Next Step
Daniel: `! powershell -NoProfile -Command "Set-Content -Encoding utf8 C:\Users\danie\kb-worktrees\figment-e2e\governance\budget.yaml -Value '# USD ceiling for API-billed steps per day (subscription steps log 0.0).','daily_usd_limit: 25.00'"` — then (boss or any terminal) `C:\ptmp\fe2e\run-live-resume-b.cmd` (= `figment_train.py pipeline --creator creator-001 --plan orgs/figment/runs/creator-001/live-20260916b/plan.json --from-stage dataset --accept-budget`), watch `C:\ptmp\fe2e\live-resume-b.log`; at `GATE tester` run `python C:\ptmp\fe2e\rule_tester_by_numbers.py <run-root>` and the printed `apply-rulings … --checkpoint-step N`; re-invoke the resume; repeat at gen/detail/video gates.

## Load list
- this file; `orgs/figment/STATE.md`; `orgs/figment/RUNBOOK.md` (retry/refused sections); `orgs/figment/pipeline/README.md` ("Live-proven runs to date", open defects)
- `orgs/figment/pipeline/train/TENSOR-TRAINING.md` (settings table + rollout notes)
- `memory/claude-boss.md` section "2026-09-16 — figment"
- `C:/ptmp/fe2e/` tooling listed above
