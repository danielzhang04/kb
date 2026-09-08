# Local one-source quality-runner plan — 2026-09-08

## Purpose and boundary

This design is implemented as a later, explicitly admitted local quality
diagnostic described in [the one-source experiment](2026-09-08-one-source-quality-experiment.md).
Its executor still requires a fresh root parent admission and `--execute` before
it can start a GPU process. It does not generate samples, accept a checkpoint,
export an artifact, or promote a LoRA.

The admitted V2 fit probe is useful execution evidence: it completed ten steps
in 79.234 seconds, exited zero, recorded verified teardown, and wrote one
170,540,916-byte checkpoint with SHA-256
`032123a1bc31b8e6dab3c8d00f961189ff3e0ddda2d051bd587a5de879afd135`.
That establishes only that this bounded local stack ran once. It says nothing
about resemblance, realism, suitability, or quality.

The proposed quality route is a distinct 100-step, one-source experiment. It
must have a new frozen plan and a fresh root parent admission. Its outputs remain
non-promotable evidence for the review procedure; no training output becomes a
new source, independent view, dataset row, or accepted LoRA.

## Fixed branch shape

The first branch uses exactly the frozen original `creator-001/anchors/g01.jpg`
and the current 331-byte caption from the existing plan. It preserves one
observation, one repeat subdirectory, batch size one, the RealVisXL pin,
U-Net-only rank-32/alpha-16 LoRA, AdamW8bit, learning rate `1e-4`, bfloat16,
SDPA, gradient checkpointing, offline cache settings, and no sample prompts.
Only a new quality TOML changes the declared training horizon to 100 steps and
the declared checkpoint schedule below.

The concise-caption branch is a separately frozen plan with the same image
bytes, source record, model, recipe, scheduler horizon, seeds, and evaluation
instructions. It changes only `g01.txt` and its caption hash. It is evaluated
at the predeclared 50-step artifact; it is not a second view. A crop branch,
if later admitted, is another plan and must retain its explicit relationship to
the same original observation. Caption and crop are never changed together in
the first comparison.

## Checkpoint policy

The prior 20/50/100 checkpoint wording conflicts with the pinned trainer's
verified stepwise behavior. `library/checkpoint_io.py` defines
`STEP_FILE_NAME = "{}-step{:08d}"`, and `get_step_ckpt_name` uses it.
`train_network.py` saves every `save_every_n_steps` multiple before the
`global_step >= max_train_steps` break, including step 100, then unconditionally
writes the final output. It cannot select arbitrary individual steps. There is
no verified selective-step option in this pinned source, and this plan does not
patch the trainer or add a callback.

Source basis: pinned `sd-scripts/library/checkpoint_io.py` lines 52 and 65
define the step filename and builder; pinned `sd-scripts/train_network.py`
lines 1669–1681 perform periodic saves before the break near line 1755; lines
1851–1859 write the final checkpoint afterward.

Use `save_every_n_steps = 10`, `max_train_steps = 100`, no state saves, and an
exact eleven-artifact allowlist:

| Step | Expected filename | Use |
| --- | --- | --- |
| 10 | `<output_name>-step00000010.safetensors` | periodic retained evidence |
| 20 | `<output_name>-step00000020.safetensors` | evaluated checkpoint |
| 30 | `<output_name>-step00000030.safetensors` | periodic retained evidence |
| 40 | `<output_name>-step00000040.safetensors` | periodic retained evidence |
| 50 | `<output_name>-step00000050.safetensors` | caption-comparison checkpoint |
| 60 | `<output_name>-step00000060.safetensors` | periodic retained evidence |
| 70 | `<output_name>-step00000070.safetensors` | periodic retained evidence |
| 80 | `<output_name>-step00000080.safetensors` | periodic retained evidence |
| 90 | `<output_name>-step00000090.safetensors` | periodic retained evidence |
| 100 | `<output_name>-step00000100.safetensors` | periodic retained evidence |
| 100 | `<output_name>.safetensors` | final checkpoint used by the 100-step review |

The final name follows the pinned trainer's `get_last_ckpt_name` path; the ten
periodic names follow `get_step_ckpt_name`. An implementation must verify all
eleven exact names against the pinned source before admitting a run, then
require metadata `ss_steps` 10, 20, ..., 100 for periodic files and 100 for the
final file. It must reject missing, extra, linked, malformed, oversized, or
mismatched-step files. Evaluators inspect the original predeclared 20-step,
50-step, and final-100 checkpoints only. Retaining the other periodic files is
the bounded cost of the verified upstream scheduler, not extra comparisons or
quality claims.

The practical default output name should be one safe branch-specific component,
for example `figmentlocalg01quality-current-100`. Each of the eleven files has
a 256 MiB ceiling and the run has a 3 GiB aggregate ceiling. The V2 checkpoint
size makes roughly 1.876 GB decimal (about 1.747 GiB) for eleven files a
practical local budget; these are guards, not expected-size or quality estimates.

## Evidence and preflight contract

The quality plan is a new schema/version rather than a mutable extension of
the ten-step plan. It freezes:

- branch id and safe output name;
- source logical path, JPEG bytes/hash/dimensions, and observation count one;
- exact caption text, bytes, and hash;
- staged `g01.jpg`, `g01.txt`, and quality TOML hashes and byte counts;
- full recipe fields including 100 steps, save interval 10, state saves off,
  sampling off, and the eleven artifact names;
- pinned model, trainer script hash, sd-scripts commit, venv path, planner,
  parser, ownership-helper, tokenizer-preflight, and quality-runner hashes;
- tokenizer prepared/load receipt hashes, inventory hash, and ten copied assets;
- 20-minute wall clock, GPU 0, offline settings, artifact and log limits, and
  `not_promotable: true`.

The existing completed CPU receipt is reusable only for an unchanged frozen
source, caption, staged recipe, parser, planner, and current code hashes. A
quality TOML changes the recipe, and a concise caption changes the caption and
staged text. Either change requires a new CPU parser receipt for that exact
quality plan under the `CUDA_VISIBLE_DEVICES=-1` and NVML check contract. The
CPU parser needs a narrowly generalized plan-layout validator that still proves
one JPEG, one caption, one repeat directory, and the quality TOML hash; it must
not reinterpret the ten-step receipt as authorization for a changed plan.

The later root parent admission binds the raw CPU receipt, canonical plan hash,
each current helper hash, completed tokenizer evidence, the exact checkpoint
policy, and a fresh admission id. A stable exclusive admission-id marker in the
fixed private root again prevents reuse with a different output directory.

## Minimal implementation map

`local_fit_runtime.py` holds the reviewed, non-policy runtime: fixed-root and
reparse checks, bounded reads and stream hashes, exact private staging, pipe
capture, owned-process tracking through the accepted `local_comfy_input.py`
helper, log/output monitoring, and safetensors header validation. Its required
`RunPolicy` names every runtime limit, marker namespace, and permitted artifact;
it has no implicit ten-step policy. `local_single_observation_fit.py` supplies
its unchanged one-checkpoint policy, while `local_quality_fit.py` supplies the
closed eleven-artifact quality policy.

Keep two separate policy validators:

| Component | Ten-step probe policy | Quality policy |
| --- | --- | --- |
| plan/admission schema | existing fixed `max_train_steps: 10` | new frozen 100-step schema |
| output allowlist | one final checkpoint | eleven declared checkpoints and exact metadata steps |
| CPU receipt | current plan only | fresh receipt for each changed caption/recipe branch |
| evaluation | none in trainer | post-run review only, separately authorized |

The extraction preserves the ten-step validator and its one-checkpoint policy;
its focused regression suite covers the imported lifecycle. The quality runner
never widens a ten-step admission, accepts its checkpoint, or uses its dispatch
marker namespace.

## Runtime containment

The later runner retains the successful V2 process shape: direct `Popen` with
`-X utf8 -B -m sdxl_train_network`, fixed `cwd` at pinned sd-scripts, no shell,
minimal inherited Windows variables, run-owned HOME/AppData/temp/Hugging Face/
Torch/Inductor paths, offline flags, and `CUDA_VISIBLE_DEVICES=0`. It uses the
retained wrapper handle and the accepted Windows identity/descendant helper;
unverified cleanup fails the run and never kills a foreign PID.

The 20-minute deadline includes model load, cache creation, all 100 steps, and
eleven saves. Streams and all writer-created log/TensorBoard files share a
256 KiB, 24-entry bound; the output tree is checked while live against the
eleven-name allowlist, 256 MiB per file, and 3 GiB total. Timeout, logging
overflow, nonzero exit, identity ambiguity, missing checkpoint, metadata
mismatch, or unverified teardown produces a failure receipt and preserves
bounded evidence. There is no automatic retry.

`local_quality_fit.py` admits only a fixed-private quality plan, the raw and
canonical plan hashes in a complete quality CPU-launch receipt, the frozen CPU
parser/planner/helper/ownership hashes, and a root admission that also pins the
fixed private CPU-launcher source hash. It validates the CPU result's caption,
768 target resolution, 896-by-512 effective bucket, and CPU-only CUDA state.
It then copies the frozen JPEG, caption, TOML, and ten tokenizer assets into a
private run tree; after the slow current source/template/model revalidation it
rehashes those run-owned files before `Popen`. A stable exclusive marker under
`figment-local-quality-fit-dispatches` prevents an admission id from being
reused with a different fresh output. The final receipt records only digest
bindings for the plan, CPU receipt, tokenizer evidence, recipe, launcher, and
current helper sources, never private input paths.

No sampler or exporter belongs to the trainer invocation. Any paired base/LoRA
rendering and human review described by the experiment is a later separately
authorized evaluation action, recorded with the selected declared checkpoint,
not an effect of a successful training receipt.
