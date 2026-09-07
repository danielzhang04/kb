# Bake-off m1 — results (2026-09-07, pod jm67txnsqfj662, $1.99 + $0.23 timeout attempt)

Method: Qwen-Image-Edit-2511, Lightning LoRA removed, 26 steps, 1448×2176, 6 fixed cells × 3 arms.
Scoring: stage 1 = facenet own-anchor cosine (floor 0.7907); stage 2 = claude-vision judge vs g01/g02/g07
(anchors self-score 78–88 same_person; Track-1 dataset median 78; strangers ≤ 68).

| arm | recipe | facenet median | judge same_person median | age Δ | skin realism | gloss | artifacts |
|---|---|---|---|---|---|---|---|
| A | 3 refs + `qwen-edit-skin` LoRA @1.0 | 0.746 | 61 | 0 | 34 | 45 | 29 |
| B | 3 refs, no LoRA | **0.897** | 59 | 0 | 45 | 40 | 20 |
| C | g01 only, no LoRA | 0.688 | 58.5 | 0 | 41.5 | 43.5 | 18.5 |

Per-cell judge notes converge on one phrase: "waxy over-smoothed skin, painted-on blush, similar styling but face
shape/jaw drifts". Best single cells: a-03 (85), b-02 (78), c-04 (76) — none reach the anchors' band.

## Verdict
- Removing Lightning did NOT fix identity or skin; on the judge it is *worse* than the Track-1 Lightning dataset
  (median 59–61 vs 78). Age drift is gone (Δ 0) — the only win.
- The skin LoRA lowers facenet identity (A vs B) and does not raise judged skin realism. Do not use on 2511.
- Multi-reference conditioning is the only lever that moves facenet (B ≫ C) but not the judge.
- **The edit-model reference-to-variation path is exhausted for creator-001's identity.** Every Qwen/klein variant
  (six runs, ~$8 total) lands at judge 55–78 with waxy skin. Remaining routes: train-first LoRA on anchors +
  curated cells with DOP (running), the Path-B adapter diagnostic (blocked: needs operator launch), and
  post-hoc face repair on LoRA output (gen/detail stage).

Raw: `orgs/figment/runs/c001-t2/bakeoff/m1/{gate/gate.json,judge/judge.json}` (gitignored run dir).
