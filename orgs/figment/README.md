# figment — AI persona influencer pipeline

Disclosed AI creator personas (disclosure copy is Daniel's, carried as a persona field).
One reference image → identity expansion → persona LoRA → generation with detail passes →
video with detail passes → research-driven content → post and measure → optimise. Two
north stars: (1) non-AI look — consistency, anti-gloss, human cadence/variation; (2)
growth → engagement → link clicks → revenue. Full standing goal: `MANDATE.md`.

Phase now: the eight-stage CLI chain is built and gated end to end through `detail`/`video`
(F1–F7, `git log --oneline 701abe22..HEAD`); no accepted checkpoint yet for creator-001 at
the current train profile, so `gen`/`detail`/`video`/the deliverable have not run live.
Current state: `STATE.md`. Constraints: per-run spend guards (`--max-usd`, the plan-time
budget preflight, the arc/daily caps); Daniel holds all account credentials/tokens
(pipeline sees them only as provisioned env, never in the repo); lift-first — build
nothing a maintained repo/SaaS/MCP already does; keep files lean.

## Layout

```
personas/<id>/   persona.yaml + training.yaml (machine source of truth) · identity-spec.md
                 · anchors/*.jpg · batches/ · calibration/
pipeline/        figment_train.py (the eight-stage driver) · pod/ (harness) · expand/
                 (dataset-stage machinery, CLI-orphan on the live train-first path)
                 · train/ · video/ · content/ · calibrate/, plus identity_gate.py /
                 vlm_judge.py / qa_stamp.py / blind_pool.py / build_grading_board.py
runs/<id>/       gitignored per-run output `pipeline --out` writes into this repo
research/        r1–r25 reports, claim-checked; 10sorlabs-package/ bulk is gitignored
content/         taxonomy, templates, briefs (stage 7 — content strategy)
```

## Persona (schema sketch)

`persona.yaml` (machine source of truth, validated by `pipeline/persona.py`): identity
(name, age 23–27, origin), `identity.look` (register lock — makeup, skin, body, lighting,
wardrobe families), reference anchors, safety axes. `training.yaml`: trigger, base arch,
steps, save cadence, caption mode, pod class/price ceiling, skin LoRA, DOP flags. World
continuity (recurring sets, wardrobe), voice, and funnel fields land on the persona as the
later mandate stages (voice, Fanvue automation) come online — see `MANDATE.md`.

## Pipeline stages

`anchor → dataset → smoke → train → tester → gen → detail → video`, driven by
`figment_train.py pipeline` (one resumable command; the manual `plan|run|grade|gate|
apply-rulings|train-first` chain it wraps is still available stage-by-stage). Six of the
eight are gradeable (`anchor`, `dataset`, `tester`, `gen`, `detail`, `video`): a full-
resolution operator eye-gate plus a written seven-axis ruling at each. See
`pipeline/README.md` for the stage map and `RUNBOOK.md` for the operator command sequence.
Stages 7–9 (content strategy, post & measure, optimise) are `content/` + future work —
see `MANDATE.md` items 7–9 and `STATE.md`'s "Blocked" section for what gates them.

## Waves and gates (historical framing, superseded by the stage gates above)

The original W0–W5 wave plan (research → bake-off → persona bible → asset base/LoRA →
first batch → pack-post → strategy report) is superseded by the per-stage gates the CLI
now enforces directly (`pipeline/README.md` "The gate"): every gradeable stage carries its
own eye-gate and seven-axis ruling in place of a wave-level gate. The wave framing's
standing rules still hold: every unit of spend-controlling, identity-scoring, or posting
code gets an adversarial review by a separate agent plus tests before it runs live; no
birth years, no school framing, stated age 23–27 (Persona Inspiration Board v4 §12).
