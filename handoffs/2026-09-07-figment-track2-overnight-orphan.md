# figment Track-2 — overnight build; train-first LoRA untested (trigger fix landed); orphan-pod incident — 2026-09-07

**Topic:** Overnight autonomous run (operator: "keep working, don't stop at perceived gates, slim working pipeline").
Delivered a gated, single-command pipeline with a second-persona acceptance suite; trained a train-first LoRA; the
tester was invalid (missing trigger word, fixed) and two reruns died on a local network outage that also orphaned a
pod for up to 15 h. Handoff written at 23:20 after the network returned.

### What WORKED (with evidence)
- **One command, one plan schema** — `figment_train.py plan|train-first|run|grade|gate|apply-rulings` drive every
  stage from persona.yaml + training.yaml + tensor-pins.yaml; hand-written manifests retired (d6a97b13); train-first
  emits the same plan.json (`variant: train-first`, ea5eb424); `run --stage tester` executed live on it (idb1hskq79h4l3).
- **Gate before eyes** — `identity_gate.py` (facenet floor) + `vlm_judge.py` (headless `claude -p`, default-mode
  Read-only, absolute paths, never caches failures) + `identity_gate.py run` over any image set; opus-reviewed and
  folded (fb1f20ae): apply-rulings fail-closed, workers single-sourced, model-pin allow-list.
- **creator-002 acceptance** — on-disk fixture + suite (0a01936d) runs every command with no pod; it found two real
  defects (dataset prompts not persona-derived; float ceiling mismatch) — both fixed (09faa490). 8/8.
- **Slim docs** — `orgs/figment/pipeline/README.md` is the entry point (fd207d53); static workflows persona-free.
- **DOP-aware budgets** (1f426a24) after the live 1250-step DOP run (fn938tol6mgbtp, 141 min, $2.57, 5 checkpoints).
- **Bake-off m1 judged** — edit-model path exhausted (`expand/bakeoff/m1-RESULTS.md`).
- **Suite** — 964 passed (08:15 detached run).

### What Did NOT Work (and why)
- **Tester #1 rendered the base model** — tester prompt had no trigger word; LoRA trained with `creator001krea2` in
  every caption. Fixed abc91610 (every tester/gen/detail prompt opens "<trigger> woman,").
- **Tester #2/#3 died on a LOCAL DNS outage** (rest.runpod.io unresolvable); harness gave up terminating after ~30 s →
  `POD STILL RUNNING`. #2 hand-terminated at 08:30; #3 (hvtovmusbx6a1t) only at 23:16 — worst case ≈ $16 orphan
  charge; `pod-orphan-estimate` rows added to `ledgers/cost/figment-2026-09-07.tsv`. VERIFY in RunPod billing.
- **Harness hardening agent died on the same outage** (resumed 23:17, not landed at handoff).
- **Background bash tasks get reaped** by the harness on this host; run long jobs via `Start-Process` (detached).
- **Path-B PuLID diagnostic** launch blocked by the session classifier (manifest `expand/bakeoff/m3diag_manifest.yaml`).

### What Has NOT Been Tried Yet
- Tester with the trigger word: `figment_train.py run --creator creator-001 --stage tester --plan orgs/figment/runs/c001-tf4/plan.json`
  (~$0.30) → `grade --stage tester` → judge table → pick checkpoint → `apply-rulings --stage tester` → `plan --stage gen`
  (+ `--detail-images`) → run → gate → board.
- Land the harness hardening (terminate backoff, sentinel, paused readiness clock, `sweep`).
- Path-B diagnostic (operator launch).

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/figment/pipeline/figment_train.py` | DONE | unified plan, budgets, trigger composer, fail-closed rulings |
| `orgs/figment/pipeline/identity_gate.py`, `vlm_judge.py`, `gate.yaml` | DONE | reviewed + folded |
| `orgs/figment/pipeline/pod/runpod_run.py` | WIP | pickle allow-list + Decimal ceilings landed; terminate backoff/sweep NOT landed |
| `orgs/figment/personas/creator-002/` + `tests/test_creator002_acceptance.py` | DONE | 8/8 |
| `orgs/figment/runs/c001-tf/…/creator-001-tensor-train-first/` (gitignored) | DONE | 5 checkpoints |
| `orgs/figment/runs/c001-tf4/plan.json` (gitignored) | READY | tester rerun plan with outputs staged |
| `ledgers/cost/figment-2026-09-07.tsv` | DONE | includes orphan estimates |

### Exact Next Step
1. Check RunPod billing for pod hvtovmusbx6a1t (08:37→23:16) and correct the `pod-orphan-estimate` row.
2. Land the harness hardening (agent resumed), commit, then rerun the tester on `c001-tf4`.

### Load list
- `orgs/figment/pipeline/README.md`, `orgs/figment/STATE.md` (23:20 section)
- `orgs/figment/pipeline/expand/bakeoff/m1-RESULTS.md`, `orgs/figment/pipeline/REVIEW-2026-09-07-gate-judge-budgets.md`
- memory: gate-before-eyes, pipeline-not-influencer, headless-judge-host-overload
