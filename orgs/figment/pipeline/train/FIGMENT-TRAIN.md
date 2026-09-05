# Figment Train

`figment_train.py` turns one validated persona into the complete Track-1 dataset → smoke →
train → tester chain. Planning and grading are local; only `run` can call the pod harness.

```powershell
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage all --out C:/tmp/creator-001-plan
py -3 orgs/figment/pipeline/figment_train.py run --creator creator-001 --stage dataset --plan C:/tmp/creator-001-plan/plan.json
py -3 orgs/figment/pipeline/figment_train.py grade --creator creator-001 --stage dataset --plan C:/tmp/creator-001-plan/plan.json
# Fill grade/dataset/rulings.template.json, preserving every cell and all seven axes.
py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator creator-001 --stage dataset --plan C:/tmp/creator-001-plan/plan.json --rulings C:/tmp/creator-001-plan/grade/dataset/filled.json
py -3 orgs/figment/pipeline/figment_train.py run --creator creator-001 --stage all --plan C:/tmp/creator-001-plan/plan.json
```

`--stage` accepts `dataset`, `smoke`, `train`, `tester`, or `all`. A first `run --stage all`
stops after dataset for the mandatory full-resolution operator gate. After `apply-rulings`, the
same command resumes at smoke; `stage.json` prevents a completed live run from being repeated.

## Persona fields

The existing `persona.yaml` identity contract remains authoritative. The command reads:

- `id`; `identity.references`; and `body_target.exemplars` for creator naming and anchor choice.
- `training.trigger`: `null` or the derived `<id-without-hyphens><base_arch>` token.
- `training.base_arch`: currently `krea2`.
- `training.steps` / `save_every`: positive, divisible, and at least one intermediate plus final.
- `training.caption_mode`: `provided`, `auto`, or `single_word` (creator-001 uses `provided`).
- `training.pod_class` and `price_ceiling_usd_per_hour`; the selected class must fit the ceiling.

Defaults are tonight's module-11 port: 2000 steps, saves every 250, Krea-2, provided captions,
L40S, and $1.30/hour. Moving to 3000 later is a persona-data change, not a code change.

For the live-run quiet period, creator-001's requested block is in `training.yaml`. The successor
loader validates the base persona with `persona.py`, then attaches the sidecar block. Defining
training in both files fails closed. At the next quiet point, move the object unchanged into
`persona.yaml` and remove the sidecar.

## Stage contract

- `plan` writes three 10-job dataset shards, shared prompts/workflow, smoke and full ai-toolkit
  configs, smoke/train manifests, one tester job per checkpoint, copied launchers, anchors, and
  `plan.json`. Every manifest records its path, SHA-256, ceiling, argv, and printable CLI line.
- Model and custom-node pins come only from `tensor-pins.yaml`; the pod class supplies GPU, rate,
  time ceilings, disk, readiness, and job bounds.
- Intermediate artifacts are `<trigger>_<step:09d>.safetensors`; the final is the bare
  `<trigger>.safetensors`. The tester ladder is derived from the same step/save values.
- `run` verifies the planned manifest hash and exact bounded harness argv, executes each planned
  run once, and checks output count/bytes, termination, every placement ledger row, and the smoke
  log for missing/unexpected state-dict keys. Any defect writes a stopped `stage.json` and exits.
- `grade` links original-pixel anchors and cells without downsampling. `apply-rulings` requires
  keep/cull plus all seven axes, applies `qa_stamp.py` semantics, forbids a safety-failed keep,
  and feeds only approved copies to `build_training_set.py --images-from`.

Nothing remains creator-specific in code or manifests. A new creator supplies only a valid
persona, anchors, and training data; output names, trigger, prompts, ladder, uploads, and grading
paths are derived.

## Reproduction and migration

Creator-001's six operational manifest documents match the committed shards, smoke, train, and
tester after canonical JSON serialization. Documented generalisation-only deltas are stable
two-space JSON formatting, generated files living under `--out`, and copied launcher comments
having creator tokens rebound. Models, nodes, workflow, jobs, settings, ceilings, and artifacts
are unchanged.

After tonight's live chain is quiet and this command passes review, retire the scratchpad driver
and hand-written Track-1 manifests. Do not modify them while the current run is active.
