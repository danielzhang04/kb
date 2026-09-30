# figment — operator runbook

The single operator document for the `pipeline` command. Start at
`orgs/figment/pipeline/README.md` for the pipeline's own map (stages, the gate, pins,
spend guards); this file is the command sequence an operator actually runs, checked
against `figment_train.py --help` and each subcommand's own `--help` on 2026-09-15.

## Prerequisites

- **Python 3.13**, the same executable every command below uses:
  `C:/Users/danie/AppData/Local/Programs/Python/Python313/python.exe` (invoked as `py -3`
  below for brevity — substitute the real path if `py -3` does not resolve to it on your
  machine).
- **No environment variable is required for a live run.** The pod harness reads
  `HF_TOKEN` as a RunPod Secret reference only (never a local env var the harness would
  have to hold); the ledger directory resolves on its own (see "Budget rules" below).
- **Anchors already exist for creator-001**: `orgs/figment/personas/creator-001/{persona.yaml,
  training.yaml}` + `anchors/*.jpg` (the reference set of record, g01/g02/g07). A new
  creator needs the same three things under `orgs/figment/personas/<id>/` — no code change
  (`pipeline/README.md` "How to iterate").
- **`verify_pins`** HEADs every model pin in `tensor-pins.yaml` (plus the video model-pins
  document) live against Hugging Face and fails closed on any digest/revision mismatch.
  It runs automatically as a `plan`/`train-first`/`pipeline` preflight — pass
  `--skip-pin-verify` only offline/in tests, never on a real run. To check pins by hand
  first:

  ```powershell
  py -3 orgs/figment/pipeline/train/verify_pins.py
  ```

## The run root

`pipeline --out` defaults to `orgs/figment/runs/<creator>/<YYYYMMDD-HHMMSS>/` — an in-repo
directory (gitignored except its own README) — and this default should almost always be
left alone: the `video` stage requires its run root to sit inside the repository
(`_video_authority_root`; `gen` and `detail` plans are unaffected by this and may still be
built in a scratch directory, but then a `pipeline` run rooted there stops with
`stopped:video-out-of-tree` once it reaches `video`, after writing everything it honestly
can — the stills/detail deliverable). Pass `--out` yourself only to override this, and only
somewhere under the repo if you want `video` to complete.

## Entry path 1 — fresh `--out`, full chain

Walks anchor → dataset → smoke → train → tester → gen → detail → video in one resumable
command, halting at every gate:

```powershell
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001
```

This is exactly `pipeline --creator creator-001 --out orgs/figment/runs/creator-001/<stamp>/`.
The very first thing it does is a plan-time **budget preflight**: it sums every run the
call is about to plan against the arc cap remaining and prints a table before writing
`plan.json`. `spent`/`remaining` are read live off the resolved ledger at plan time (M3:
`configured_ledger_dir`'s precedence — explicit `--ledger-dir` → `KB_LEDGER_DIR` → the OPS
worktree if present → this repo's own, normally-empty `ledgers/cost/` as a last resort) --
never a fixed figure quoted here. The shape of the table (`REFUSED` when planned + spent
would exceed the arc cap, `over_daily_limit` flagging any single run over
`governance/budget.yaml`'s daily cap) looks like this:

```text
BUDGET PREFLIGHT
  arc:   spent=$<live> + planned=$<sum of this plan's ceilings> vs cap=$<arc cap> (remaining=$<live>) -- REFUSED or clears
  daily: limit=$10.00 (today spent=$<live>, not summed against the plan -- each run is checked against the limit alone)
  stage      manifest                                                 ceiling_usd  over_daily_limit
  anchor     <manifest>                                                      4.90
  dataset    <manifest>                                                     10.47
  smoke      <manifest>                                                      2.28
  train      <manifest>                                                     15.73  YES
  tester     <manifest>                                                      2.82
```

If the table says `REFUSED`, either shrink the plan (fewer stages, a smaller ladder) or
re-run with `--accept-budget`, which records the acceptance and these exact numbers in
`plan.json`'s `budget_preflight` block:

```powershell
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001 --accept-budget
```

`--accept-budget` only clears the plan-time preflight above; it never overrides
`enforce_daily_budget`/`enforce_arc_cap` at launch time (`pod/runpod_run.py`) — those still
refuse a live `run` that would actually breach a cap, `--accept-budget` or not. A run whose
own ceiling is bigger than the daily limit (`train` always is at the current 3000-step/DOP
profile — see `pipeline/README.md` "Spend guards") is flagged `YES` in the `over_daily_limit`
column; that is informational, not a second blocker — `train` still needs its own calendar
day with no other Figment spend, checked at plan/run time.

## Entry path 2 — `--import-checkpoints <dir>`, an operator-trained ladder

MANDATE.md's tier constraint puts the explicit-tier LoRA on operator-controlled hardware,
outside any pod-planned `train` run. `--import-checkpoints` skips anchor/dataset/smoke/train
outright and plans `tester` as the primary plan's only stage, against a directory of loose
`*.safetensors` files instead:

```powershell
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001 `
  --out orgs/figment/runs/creator-001/<stamp> `
  --import-checkpoints <dir-of-*.safetensors> `
  [--import-training-config <training.yaml>]
```

`<dir>` must hold every `<trigger>[_<9-digit step>].safetensors` file matching the persona's
own derived checkpoint stem (the un-suffixed file is the final step, i.e.
`training.steps` of the config in `--import-training-config`, default the persona's own
current `training.yaml`); any other extension, symlink/reparse point, file under 1 MiB,
duplicate step, or an empty ladder refuses. From here the walk (tester → gen → detail →
video) and every gate below are identical to entry path 1.

## Resuming a run

`pipeline` stores no cursor of its own — it derives "what's next" from `stage.json`/
`run.json` receipts and `grade/<stage>/{gate,approval-lineage,rejection-lineage}.json`
already on disk, so re-invoking it is always safe:

```powershell
py -3 orgs/figment/pipeline/figment_train.py pipeline --creator creator-001 --plan <run-root>/plan.json
```

`--dry-run` previews the next action (which stage would plan, run, or grade) without
calling the harness or any local build/grade function. `--from-stage <stage>` resumes the
walk from a specific stage instead of the beginning, useful once earlier stages are already
settled.

## The gates, in order

Six of the eight stages are gradeable (`anchor`, `dataset`, `tester`, `gen`, `detail`,
`video`) — `smoke` and `train` are not; no per-cell ruling makes sense for either. At each
gradeable stage lacking a ruling, `pipeline` halts, prints exactly this, and exits 0 (this
is normal operation, not an error):

```text
GATE <stage>: operator review required.
  Board:            <run-root>/grade/<stage>/board.html
  Rulings template: <run-root>/grade/<stage>/rulings.template.json
  Fill every cell's seven axes plus decided_by/decided_at, then run:
    py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator creator-001 --stage <stage> --plan <run-root>/plan.json --rulings <path to your filled rulings>
  Re-invoke `pipeline --creator creator-001 --plan <run-root>/plan.json` afterward to resume without replanning or rerunning this stage.
GATE <stage>: awaiting ruling
```

The board is a full-resolution HTML page, one card per cell; the rulings template lists
every cell with the seven axes to fill in: `identity`, `realism`, `hands`, `lighting`
(quality) plus `adult_read`, `garment_integrity`, `real_person_resemblance` (safety),
each `keep`/`cull`, plus `decided_by` and `decided_at` (ISO-8601) once at the document
level. `apply-rulings` requires all of it — a metric that can't be computed FAILS, never
passes silently (`gate.yaml`'s own header).

**GATE tester** is the one gate with an extra argument: promoting a candidate requires the
explicitly kept, actually-produced checkpoint step:

```powershell
py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator creator-001 --stage tester `
  --plan <run-root>/plan.json --rulings <filled.json> --checkpoint-step 750
```

Omit `--checkpoint-step` only if every tester candidate was culled — that records the
rejection with no accepted checkpoint and stops the chain there; it does not manufacture a
keep. **Never default the chosen checkpoint to the final step** — the ladder exists
precisely so the tester's own ranking, not the step count, picks the checkpoint
(`train/TENSOR-TRAINING.md` "Step count: 3000, screened by the tester").

**GATE gen** and **GATE detail** ruling is ordinary keep/cull per cell — `detail` is always
graded against its own `gen` plan's kept stills, never an operator-supplied glob.

**GATE video** grades every 8th of the 81 native frames (1, 9, … 81 → 11 cells): the
`identity` axis on each sampled frame IS "the face holds here under motion." Ruling it
through the same seven-axis path lets the deliverable gain `deliverable/video/<candidate
id>.mp4` (the reel derivative).

## `--style-lora` A/B

`gen` accepts a style LoRA as a per-plan flag, not a persona fork (M3) — it overrides
`persona.training.style_lora` for one plan only, so the same persona can be planned both
ways for a prospective A/B:

```powershell
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage gen --out <plan-A>
py -3 orgs/figment/pipeline/figment_train.py plan --creator creator-001 --stage gen --out <plan-B> `
  --style-lora inline-skin --style-lora-strength 0.8
```

`--style-lora` names a `pins.style_loras` key from `tensor-pins.yaml` (e.g. `inline-skin`,
`gokay-realism`); `--style-lora-strength` (0 < x <= 1.5) defaults to
`persona.training.style_lora_strength` (0.8) when omitted. Compare the two gen plans' `gen`
gate tables (`skin_realism`/`gloss` should improve, `same_person` must not fall) before
choosing one for `detail`/`video` — the bake-off already found one style LoRA
(`qwen-edit-skin`) actively hurt identity, so this comparison is load-bearing, not a
formality. `pipeline`'s own automatic `gen` planning also accepts `--style-lora`/
`--style-lora-strength` when it plans `gen` for you (after tester is ruled).

## `--gen-prompt-style` A/B

`gen` also accepts `--gen-prompt-style {look-clause,trigger-scene,look-clause-close}` as
the same kind of per-plan flag, not a persona fork: the default `look-clause` reproduces
today's prompt (trigger + the full `identity.look` clause + scene) byte-for-byte,
`trigger-scene` drops every look feature word and reuses the tester's own proven
adult-framing/clothing/skin sentence plus a close-framed scene, and `look-clause-close`
keeps the full look clause but swaps in that same close-framed scene set — plan all
three and compare `same_person`/`face_px` in the gate table before choosing one, the
same way the `--style-lora` A/B above does. `gen` also accepts
`--gen-refine-denoise`/`--gen-detailer-denoise` (0.0–1.0, default 0.35/0.15) as the same
kind of per-plan override for the refine (node 15) and detailer (node 33) passes in
`_gen_workflow`; 0.0 removes that pass from the emitted workflow entirely rather than
just lowering its denoise. Live evidence (2026-09-22/23): the tester's single 4-step
pass scores judge `same_person` 88 on the accepted step-2000 checkpoint, while the same
checkpoint's full gen chain (upscale → refine → detail) scores 45–68 — these two flags
isolate how much of that gap is the post-processing rather than the prompt.

## The deliverable

Once `detail` is ruled, `pipeline` writes `<run-root>/deliverable/`:

- `stills/<image_id>.ext` — every kept `gen` still.
- `detail/<image_id>.ext` — every kept `detail` image.
- `manifest.json` — the `gen`/`detail` plan paths and hashes, the chosen checkpoint step
  and digest (and its `origin`: `"in-plan"` or `"imported"`), and per kept cell its gate row
  and ruling attribution (`decided_by`/`decided_at`/`why`/`gate_override`).

Once `video` is ruled the deliverable also gains `video/<candidate id>.mp4` (the reel
derivative) and a `video` block: the delivered file's sha256, the delivery profile, the
native↔derivative correspondence, the native movie's record, the extraction receipt, and
per graded frame its native-frame digest beside its gate row and ruling attribution.

The deliverable is idempotent: already bound to the current `detail` AND `video` approval
digests, it is left alone rather than rebuilt on every `pipeline` call.

## Budget rules

- **Arc cap: $75.00** (`DEFAULT_ARC_CAP_USD` in `pod/runpod_run.py`, operator ruling
  2026-09-29), counted from $0 over `ledgers/cost/figment-*.tsv` files dated on or after
  2026-09-29, checked before a live `run`.
- **Daily cap: $10.00** in this branch's governance (`governance/budget.yaml`
  `daily_usd_limit`) — raise it, or split stages across days, when a single stage's ceiling
  (train, at the current 3000-step/DOP profile: $15.73) exceeds it on its own.
- **Every pod carries its own `--max-usd`/`--max-minutes`** (`max_placement_attempts: 1` —
  no automatic retry on a live run); `train`'s ceiling is derived from `steps × per-step
  rate`, never a fixed quoted figure — read it off your own `plan.json`.
- **Pods self-terminate at `max_minutes + 10` even if the host sleeps** (2026-09-22): the
  host is kept awake and the ceiling is suspend-proof for as long as it's running, but the
  pod also carries its own independent dead-man switch as a backstop for a host that never
  comes back at all. RunPod injects a pod-scoped `RUNPOD_API_KEY` and preinstalls `runpodctl`
  by default, so its normal path (`runpodctl remove`/`stop pod`, then the newer `pod
  delete`/`pod stop` spelling) actually stops GPU billing; a bare `shutdown -h now` is only
  the last-resort fallback — see GUARDRAILS.md #6. Note: `runpodctl stop`/`remove` end GPU
  billing only — the network volume keeps billing until a real host-side delete or a
  `status` sweep catches it, so don't treat "GPU billing ended" as "done."
- **The qwen3vl caption pod ($1.95 ceiling, `caption` stage profile) is NOT in the
  plan-time preflight table.** `caption_mode: "qwen3vl"` only dispatches its pod later,
  from inside `apply-rulings --stage dataset` (`_live_qwen3vl_job_runner`) — `plan` never
  plans or budgets it up front the way it does anchor/dataset/train/tester/gen/detail.
  Hold $1.95 back mentally against the arc cap before running `apply-rulings --stage
  dataset` on a `caption_mode: "qwen3vl"` persona.
- **Teardown is verified, not assumed**, on every exit path — success, failure, or error —
  via the RunPod API. If a harness invocation fails outside the normal flow, confirm the
  true pod state by hand before retrying:

  ```powershell
  py -3 orgs/figment/pipeline/pod/runpod_run.py status
  py -3 orgs/figment/pipeline/pod/runpod_run.py terminate --pod-id <id>
  ```

## Resume/recovery: a run marked "running"

If a run's `stage.json` still reads `"running"` when you invoke `pipeline`/`run` on the same
plan, the error names the exact recovery path:

> planned run `<key>` is still marked running. If another `pipeline`/`run` invocation on
> this same plan is still active, this is expected — wait for it to exit, then re-run
> `pipeline` (or `run`) on this plan again; the run may already have succeeded there and
> this call will pick that up. If no other invocation is active, a prior one was likely
> interrupted before recording completion or failure: confirm the true pod state with
> `runpod_run.py status`/`probe` (and terminate it if still live) before retrying. Never
> launch a second pod for the same manifest, and never start a fresh plan over this one for
> that alone.

Never hand-edit `plan.json`, `stage.json`, receipts, manifests, grading records, or copied
media to work around this — the fix is always patience-and-retry or a verified-absent pod,
never a file edit.

**The one exception this rule already builds in:** the qwen3vl caption manifest
(`train/runs/<trigger>-tensor-caption.yaml`, written by `plan_qwen3vl_caption` inside
`apply-rulings --stage dataset`) regenerates itself on the next `apply-rulings` retry as
long as no `run.json` has been recorded for it yet — a caption pod that crashed before
launch, or never got dispatched at all, does not leave a permanent block behind. Once a
`run.json` for that manifest exists, it IS a recorded run and the ordinary refusal above
applies — the manifest will not be silently regenerated out from under a completed
receipt. **Second exception (2026-09-16, P5):** a `run.json` whose own eligibility
matches `--retry-failed`'s rule below — including a RunPod capacity 500 at pod-create
time, which never places a pod at all — also regenerates (the dead out dir renamed to
`.failed-N` first), bounded by the same retry limit; anything else with a recorded
`run.json` still refuses.

**Third exception, operator-invoked only (2026-09-16):** a JOB-class caption failure
(verified pod teardown, zero output, but the pod-side script itself failed — e.g.
`HarnessError: training failed marker appeared`) never auto-regenerates, so once
you've fixed the actual cause, rerun `apply-rulings --stage dataset` with
`--retry-caption-after-fix "<what you fixed>"` to admit it explicitly. The
regenerated manifest records the reason, the renamed prior out dir, the
caption-template sha256, and the current git HEAD, and this retry still counts as a
real retry, but against the flag's own wider cap (`MAX_RETRY_AFTER_FIX` = 4), not the
tighter `MAX_RUN_RETRIES` (2) every unflagged retry shares.

## Resume/recovery: `--retry-failed` for a verified transport/placement failure

A `failed` planned run normally requires a fresh, reviewed plan — see "never a file edit"
above. `pipeline`/`run --retry-failed` (2026-09-16, P4) is a narrow, second exception for
exactly one shape of failure: a pod that placed, ran briefly, then lost the transport
connection to the provider itself (a DNS blip, a dropped `ConnectionError`,
`MaxRetryError`, `ReadTimeout`, or a placement failure) before it ever produced a job or
uploaded an artifact — never a job or validation failure, which still needs a reviewed
plan.

`--retry-failed` re-launches a `failed` run ONLY when its own harness receipt
(`<out>/run.json`, not `stage.json`) shows ALL of:

- `termination_verified: true` for the receipt AND for every row in
  `run.json["placement_attempts"]` — the pod's teardown, including any earlier
  superseded placement, was itself confirmed;
- zero verified job outputs — no `run.json["jobs"]` entries with files, no artifact bytes,
  and no other file anywhere under its `out` dir beyond its own receipt/manifest/recovery
  bookkeeping (recursive — a nested stray file disqualifies it exactly like a top-level
  one);
- every `recovery-*.json` journal left in the out dir (`pod/recovery.py`) shows
  `state: "terminated"` and `absence_verified: true` — an `uncertain` or unterminated
  journal refuses the retry even if the receipt itself looks clean;
- an `error` string naming a transport/placement failure (substring match against
  `NameResolutionError`, `ConnectionError`, `MaxRetryError`, `ReadTimeout`, `placement`,
  `ReadinessTimeout` — a host that never started the container, live 2026-09-23);
  **or (2026-09-16, P5)** `termination_verified: false` with `pod_id: null`,
  `placement_attempts`/`jobs`/`artifacts` all empty, an `error` naming
  `CreateCallError`, and a fresh live scan finding no pod named in the out dir's own
  `recovery-*.json` journal(s) — a RunPod capacity 500 at create time never placed a
  pod at all, so there was never anything to terminate;
- fewer than 2 prior REAL retries already recorded for that exact manifest key
  (`state["runs"][key]["attempts"]`) — the 3rd real failure always requires a fresh
  plan; never-created capacity failures (above) don't count toward that 2, since
  nothing was spent — they're bounded separately, at 8.

When it retries, the prior attempt's `stage.json` record moves into that run's `attempts`
list (never deleted, and tagged with `out_renamed` naming where it went) and its `out` dir
is renamed to `<out>.failed-<n>` (also never deleted; the first free suffix is used on a
naming collision) AFTER `stage.json` durably records `status: "retrying"` for that run but
BEFORE the harness is invoked again, so the retry writes a clean `run.json`. If the process
is interrupted anywhere between that `retrying` write and the actual relaunch, the next
call — whether or not it passes `--retry-failed` — finds `status: "retrying"` and treats it
exactly like `failed`: `--retry-failed` is still required, and eligibility is re-verified
against the renamed prior attempt (finishing the rename first if it didn't complete) rather
than assuming the earlier check still holds. The exact same harness invocation, ceilings,
and budget/arc-cap checks apply — this is not a weaker run, only a permitted second launch
for the same manifest. Without `--retry-failed` (the default), behavior is unchanged:
`failed` always refuses, byte for byte.

`pipeline --dry-run --retry-failed` previews the one retry it would attempt (status
`dry-run:retry <key>`) without renaming anything or invoking the harness. If the failed
run is not eligible (any of the checks above fails), dry-run falls back to its ordinary
`dry-run:<stage>` preview — the live invocation is what raises the specific refusal
reason.

**Operator-invoked exception (2026-09-21): `--retry-after-fix "<what you fixed>"`.**
`pipeline`/`run` gain the same admission `apply-rulings --retry-caption-after-fix`
already gives the caption sub-job, extended to a planned stage run (dataset, gen,
detail, video, ... including a downstream plan `pipeline` planned itself) — a
JOB-class failure (verified pod teardown, zero output, but a pod-side error that
doesn't name a transport/placement failure, e.g. `HarnessError: ComfyUI job ...
failed`) never qualifies for `--retry-failed` on its own. `--retry-after-fix` admits it
once you've actually fixed the underlying cause: it works even without `--retry-failed`
set, is bounded by the wider `MAX_RETRY_AFTER_FIX` (4) real retries instead of the
tighter `MAX_RUN_RETRIES` (2) (never-created capacity failures still bound separately
at 8), and records `{"reason": ..., "git_head": ...}` on the retried attempt's own
`attempts` entry. Every other check above (verified termination, zero output, journal
verification, the retry-count caps) still applies unchanged — the flag only relaxes the
final error-class match. `pipeline --dry-run --retry-after-fix "<reason>"` previews the
retry it would admit as `dry-run:retry-after-fix <key>` (falling back to the ordinary
`dry-run:retry <key>`/`dry-run:<stage>` preview when the reason isn't what actually
admitted it); without the flag, behavior is byte-for-byte unchanged.

**Transient DNS outages no longer kill a live run (2026-09-21).** This host drops local DNS for ~10-30 s at a time, and three runs died because one polling GET's `ConnectionError`/`NameResolutionError` was treated as fatal and the pod was torn down mid-run. The polling GETs made while a pod is alive — the readiness pod-status poll, the ComfyUI history poll, and the post-create placement pod-status poll — now retry through such an outage for up to `TRANSIENT_NETWORK_TOLERANCE_SECONDS` (180 s) per outage with 2/4/8/15 s backoff, logging a `transient network failure ... retrying in Ns` WARNING each time; the window resets after any successful poll. Nothing else changed: the readiness/job deadlines, `max_minutes` and the watchdog are re-checked before every retry and are never extended, and when the window (or the deadline) closes the same error propagates to the same exit path, so termination is still attempted and VERIFIED exactly as before. Create, terminate, termination-verification, ledger, upload and download calls are deliberately NOT retried this way — uploads/downloads keep their own integrity rules and teardown keeps its own 5-attempt loop. Operationally: a run log with these WARNINGs and no teardown is the fix working; a run that still dies on a name-resolution error means the outage outlasted 180 s, and that failure remains `--retry-failed`-eligible exactly as described above.

## Resume/recovery: `--replan-downstream <stage> --reason "<...>"` for a dead downstream plan

`pipeline` always reuses whatever `downstream/gen`/`downstream/detail`/`downstream/video`
plan it finds (`_pipeline_downstream_root`) rather than planning a fresh one, so a template
fix (e.g. a manifest field a prior template got wrong) can never reach a downstream plan that
already exists on disk — and "never hand-edit `plan.json`" above still applies, so hand-fixing
it in place is not the way out. `pipeline --replan-downstream {gen,detail,video} --reason
"<what changed>"` (2026-09-21) is the one sanctioned alternative: it supersedes that plan and
plans the named stage fresh from current templates, but ONLY when the existing plan has no run
with recorded output, is not graded, and every run/attempt it ever named is either a verified-
teardown zero-output failure (the same shape `--retry-failed` requires, `error`-class match
skipped) or was never launched at all — a completed run, a graded stage, or an unverified
teardown refuses, naming the reason. On success it appends `{stage, superseded_dir, reason,
git_head, prior_plan_sha256, at_utc}` to the PRIMARY run root's own `stage.json` (a
`downstream_supersessions` list) BEFORE renaming the directory to `downstream/<stage>.
superseded-<N>` (first free `N`, refusing past 4) — crash-safe the same way a `--retry-failed`
relaunch is: if interrupted between the record and the rename, the next call (same flags)
finishes the rename rather than re-checking eligibility or writing a second record. `--dry-run`
with the flag only previews (`dry-run:replan-downstream <stage>`) and touches nothing; without
the flag, behavior is unchanged.

## A budget/arc-cap refusal before launch

A harness preflight refusal (daily budget, arc cap, or any other check the harness runs
before it ever calls RunPod's create API) exits non-zero without creating the run's `out`
dir at all — no `run.json`, no `recovery-*.json` journal, no pod, no spend. `run_planned_stage`
records this shape as `status: "refused"` (never `failed`), carrying `returncode` and a
`stderr_tail` (the harness's last "refused"/"REFUSED" line, or its last ~5 lines of stderr
when no such line exists) for audit; a legacy `{"status": "failed", "returncode": N}` record
whose out dir the same way never launched (predating this classification, e.g.
creator-001/live-20260916b's train stage) is reclassified as `refused` on read. Unlike a
`failed` run, a `refused` run needs no `--retry-failed` flag and no fresh plan: the very next
`pipeline`/`run` invocation on the same plan treats it exactly like "not yet run" and simply
launches again, folding the prior refusal(s) into a `refusals` list on whatever record comes
next (another refusal, a `failed`, or the eventual `complete`) so the history survives. That
list is bounded the same way never-created retries are: after `MAX_NEVER_CREATED_RETRIES` (8)
consecutive refusals for the same manifest key, the next call raises and demands operator
investigation rather than looping forever. `pipeline --dry-run` (with or without
`--retry-failed`) previews a `refused` run exactly like any other not-yet-run stage
(`dry-run:<stage>`) — it would simply run.

## Command-shape evidence

Every command above was checked against `figment_train.py --help`, `pipeline --help`,
`plan --help`, `run --help`, `grade --help`, `apply-rulings --help`,
`train/verify_pins.py --help`, and `video/video_manifest.py --help` on 2026-09-15.
