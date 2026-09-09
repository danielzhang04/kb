# Held-out LoRA/control compiler — 2026-09-09

## Status

Prepared and unexecuted. This is a bounded research diagnostic, not a checkpoint selection,
approval, production claim, or pod launch. Independent review is pending. Root compiled the
private V1 preparation and completed its native harness dry run at 23:33:36 UTC from the earlier
compiler snapshot `e1f02279…`; its receipt is
`C:/Users/danie/kb/_private/figment-builtin-heldout-control-20260909-v1/dry-run/run.json`.
The dry run used its isolated dry-run ledger, returned exit 0 for ten synthetic jobs, and made no
provider request or paid run. That V1 record is retained as preparation evidence only and is
superseded by the later raw-path validation repair. A fresh V2 output is required after final
review; V1 must not be replayed or launched.

The completed tester used one prompt and seed `1595`. Its independent visual review culled all
five checkpoints for canonical `g01` identity and about-21 presentation, while root's notes
identified the final checkpoint only as a possible research comparison candidate. The existing
`held-out-diagnostic` command could freeze an unscored candidate/control JSON, but nothing
consumed that protocol into a current checkpoint-bound harness manifest. This compiler closes
only that preparation gap.

## Protocol and contrast

The protocol fixes the current final checkpoint, canonical `anchors/g01.jpg`, the current
persona/reference hashes, one tester prompt, and five seeds: `1595`, `481516234`, `90210`,
`314159`, and `271828`. It creates ten cells: final-LoRA and no-LoRA control for each seed.
The contrast asks whether the final LoRA changes identity response from the base model under the
same prompt and noise. It does not test a new pose or prompt-profile factor, and it cannot make
an identity or age conclusion by itself.

Candidate cells retain node 4 (`LoraLoader`) with model and CLIP strengths `1.0`. Control cells
set both strengths to `0.0` and rewire node 5's CLIP input to node 2 and node 8's model input to
node 1, leaving node 4 unreachable from the output. Each job is applied to a fresh workflow.

## Existing CLI sequence

Both output paths below must be fresh. The commands are shown for review only and have not run.

```powershell
$py = 'C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe'
$cli = 'C:/Users/danie/kb/_private/codex-worktrees/figment-research-review-20260909/orgs/figment/pipeline/figment_train.py'
$root = 'C:/Users/danie/kb/_private/figment-builtin-heldout-control-20260909-v1'
$candidate = 'C:/Users/danie/kb/_private/figment-builtin-train-first-20260909-v2/train/runs/out/creator-001-tensor-train-first/creator001krea2.safetensors'
$ledger = 'C:/Users/danie/kb/_private/codex-worktrees/figment-analysis-ops-2026-09-07/ledgers/cost'

& $py -I -B $cli held-out-diagnostic --creator creator-001 `
  --candidate-checkpoint $candidate --canonical-anchor anchors/g01.jpg `
  --out "$root/protocol.json"

& $py -I -B $cli compile-held-out-diagnostic --creator creator-001 `
  --protocol "$root/protocol.json" --candidate-checkpoint $candidate `
  --out "$root/compiled" --ledger-dir $ledger
```

`compile-held-out-diagnostic` writes a native harness manifest and
`figment/held-out-diagnostic-preparation@1`, whose record binds the protocol, candidate,
manifest, source hashes, derived minimum runtime, and exact harness argv. It stages exactly one
candidate checkpoint under its fresh root. It rejects a changed protocol, candidate, canonical
reference set, prompt, current tester pins, training configuration, source file, symlink input,
or existing output directory. It rechecks those inputs before manifest publication.

The native harness computes a 113-minute minimum for the ten jobs. The existing tester cap is
115 minutes and its `manifest_ceiling` is `$2.50`; these are preparation values, not an admitted
spend or actual cost. No run, external judge, model download, or approval is part of compilation.

## Verification and limit

Python 3.13 compilation and the focused held-out test selection passed: 9 tests in 1.43 seconds.
The tests exercise candidate/control graph isolation, one staged checkpoint, native harness
`--dry-run`, malformed protocol, mismatched checkpoint, stale anchor, pre-existing output, and a
checkpoint change after snapshot. The independent code review is pending. This compiler does not
produce a receipt, images, scoring, ruling, selected checkpoint, or promotion.
