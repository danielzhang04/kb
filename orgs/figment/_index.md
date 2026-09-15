# figment — index

Disclosed AI creator personas: one reference image → identity expansion → persona LoRA → register
lock → images and video with passes → research-driven content → post and measure → optimise.
Several creators from one dashboard, two content tiers from one identity.

- [MANDATE](MANDATE.md) — the operator's standing end goal. Every spec, plan and brief derives from it.
  Human/boss-edited only.
- [Pipeline README](pipeline/README.md) — the pipeline's own map: the eight-stage chain (`anchor,
  dataset, smoke, train, tester, gen, detail, video`), the one resumable driver
  (`figment_train.py pipeline`, plus the manual `plan|run|grade|gate|apply-rulings|train-first`
  chain it wraps), the gate, pins, spend guards, live-proven runs, open defects, and how to iterate.
- [RUNBOOK](RUNBOOK.md) — the operator command sequence for `pipeline`: prerequisites, the two entry
  paths, every gate with its exact `apply-rulings` command, `--style-lora` A/B, the deliverable, and
  budget/recovery rules.
- [GUARDRAILS](pipeline/GUARDRAILS.md) — hard lines that hold regardless of permission mode. Binds on
  top of the mandate.
- [STATE](STATE.md) — current state (agents keep this current)
- [contract](contract.md) — autonomy policy for this project
- [HEARTBEAT](HEARTBEAT.md) — recurring research and measurement cadences
- [figment-creator workflow](workflows/figment-creator.md) — the agent-role/cadence view of the same
  eight stages, for the agents that support a run rather than the CLI itself.

## Layout

```
personas/<creator>/   persona.yaml + training.yaml (machine source of truth) · identity-spec.md
                      · anchors/ · batches/ · calibration/
pipeline/             figment_train.py (the eight-stage driver: anchor · dataset · smoke · train
                      · tester · gen · detail · video) · pod/ · expand/ · train/ · video/ · content/
                      · calibrate/, plus identity_gate.py / vlm_judge.py / qa_stamp.py / blind_pool.py
                      / build_grading_board.py
runs/<creator>/       gitignored run roots `pipeline --out` writes into (this repo, per-run)
research/             r1–r25 reports, claim-checked; 10sorlabs-package/ bulk is gitignored
```

Image, video and package bulk is gitignored; `batch.json`, `scores.json`, `run.json`, manifests,
`plan.json`, `stage.json`, and review rulings are tracked (or, under `runs/`, gitignored except the
run root's own README — see `pipeline/README.md` "Run roots live inside the repository").

## Reading order for a fresh session

1. `MANDATE.md`, then `pipeline/GUARDRAILS.md`.
2. `pipeline/README.md` (the pipeline's own map: eight stages, the one resumable command, the gate,
   spend guards), then `RUNBOOK.md` (the actual command sequence).
3. `STATE.md` (where the arc actually is), then `contract.md`.
4. For creator-001 specifically: `personas/creator-001/identity-spec.md` and `pipeline/look-spec-v2.md` §0.
5. For anything touching a pod: `pipeline/pod/README.md`.

## Standing rules that catch people out

- Rented compute prohibits adult content: everything unclothed is generated and trained on operator
  hardware, by the operator. Agents build that path with clothed data.
- Every pod is terminated **and verified absent** on every exit path; every live run carries `--max-usd`.
- $50 hard cap on the creator-001 arc; zero spend on any platform, ever.
- `pipeline/qa_stamp.py` is the only writer of `review_status`. `parked` is always a legal answer.
