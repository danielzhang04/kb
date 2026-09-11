# figment — STATE
_Updated: 2026-09-07 23:20_

## Now
Overnight build delivered a slim single-command gated pipeline + creator-002 acceptance (964
tests, HEAD abc91610, pushed, branch `claude/figment`). Train-first LoRA trained ($2.57, pod
fn938tol6mgbtp, 1250 steps, 5 checkpoints) but its first tester run rendered the BASE model
(missing trigger word) — fixed (abc91610: trigger+class now prefixed on every tester/gen/detail
prompt) but NOT yet re-tested. A local DNS outage orphaned pod hvtovmusbx6a1t from 08:37 to
23:16; worst-case cost ~$16 (unverified against RunPod billing).

## Current gate
Tester rerun on `orgs/figment/runs/c001-tf4/plan.json` (~$0.30) with the trigger-word fix —
held by the boss session to execute, then Daniel's checkpoint eye-gate (behind the automated
identity_gate + vlm_judge gate, per the gate-before-eyes ruling).

## Next
1. Run tester on `orgs/figment/runs/c001-tf4/plan.json` -> `grade --stage tester` -> judge table.
2. Pick checkpoint by the numbers -> `apply-rulings --stage tester`.
3. `plan --stage gen` (+ `--detail-images`) -> run -> gate -> board for Daniel.
4. Land harness hardening (terminate backoff >=15 min, POD-STILL-RUNNING sentinel + ledger row,
   readiness clock paused during local outage, `sweep` subcommand) — was in flight, not landed.
5. Verify the hvtovmusbx6a1t orphan charge against actual RunPod billing.

## Blocked
Path-B PuLID diagnostic (`expand/bakeoff/m3diag_manifest.yaml`, $3.70, research-only) — launch
blocked by the session permission classifier; Daniel must launch by hand (command in
`m3diag_README`).

## Findings
- Edit-model identity-transfer path (Qwen-Image-Edit variants, 6 runs, ~$8 total) is EXHAUSTED:
  judge same_person 55-78 with "waxy over-smoothed skin, painted-on blush" on nearly every cell.
- Skin LoRA (`qwen-edit-skin`) HURTS facenet identity and does not raise judged skin realism —
  do not use on Qwen 2511.
- `identity_gate.py` (facenet) alone does not separate Daniel's actual verdicts — glossy/older
  cells score facenet ~0.92, indistinguishable from anchors' own 0.89-0.93 pairwise cosine. The
  `vlm_judge.py` headless Claude-vision judge does separate them.
- Ledger-vs-narrative reconciliation gap still open: `ledgers/cost/figment-2026-09-06.tsv` sums
  $2.822 vs STATE's narrated $0.61 that day; 2026-09-07 ledger carries an unnarrated $5.85 row.
- Background bash tasks get reaped by the harness on this host — long jobs need PowerShell
  `Start-Process` (detached), not backgrounded bash.
- Headless judge CLI under bypassPermissions caused a host-overload incident (`find /` storm +
  137 stale bash, 99% CPU) — fixed by using default permission mode + Read-only tools +
  absolute paths (memory: `headless-judge-host-overload`).

## Infra
- Branch `claude/figment`, HEAD abc91610 (pushed).
- Train-first checkpoints: `orgs/figment/runs/c001-tf/.../creator-001-tensor-train-first/`
  (gitignored, 5 checkpoints).
- Tester rerun plan staged: `orgs/figment/runs/c001-tf4/plan.json`.
- Cost ledgers: `ledgers/cost/figment-2026-09-0{3,4,6,7}.tsv`; arc cap $50, daily budget $10.
- Gate config: `orgs/figment/pipeline/gate.yaml`; calibration docs under
  `orgs/figment/personas/creator-001/calibration/`.
