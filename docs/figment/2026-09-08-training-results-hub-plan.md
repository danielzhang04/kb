# Training results in the Figment hub

Extend the existing authenticated `localTraining` projection with a historical
**Completed local runs** section. The first implementation shows only the
completed ten-step availability probe and current-caption 100-step fit. C2
matched pairs remain a later integration after their receipt is finalized.

“Completed” means the recorded process, teardown, and artifact bindings
succeeded. It does not mean quality, realism, reference resemblance, apparent
age, clothing, checkpoint acceptance, or production eligibility. Display
**Quality not evaluated by these records**. Costs and native billing are not
reported.

## Fixed evidence groups

Add an optional setting beside `FigmentLocalTrainingEvidenceRoots` in
`dashboard/server/figment/localTraining.ts`:

```ts
interface FigmentLocalTrainingResultRoots {
  tenStep: { run: string; plan: string; admissionParent: string };
  currentQuality: { run: string; plan: string; admissionParent: string; cpu: string };
}
```

All fields are configured server-side directory roots, matching the existing
`openRoot/readJson(root, child)` controls. The reader opens fixed children only:
`run/receipt.json`, the plan's fixed JSON name, `cpu/receipt.json`, and the
closed actual admission children
`admissionParent/figment-local-lora-fit-admission-20260908-v2.json` for ten
steps and
`admissionParent/figment-local-quality-current-fit-admission-20260908-v1.json`
for current quality. It does not accept file paths, scan, or fall back to a
sibling. Existing regular-file, reparse/ancestor refusal, 256 KiB, stable-read,
and depth controls apply. A missing or unsafe group is unavailable.

## Actual receipt checks

For the ten-step group, require the actual
`figment/local-single-observation-fit-probe@1` receipt: complete, exit zero,
`failure: null`, `log_truncated: false`, non-promotable, and verified
teardown. Recompute the plan frozen hash; require it to match receipt
`plan_sha256`, require the separate frozen admission to bind that plan, and
require `receipt.admission_id === admission.admission_id`.
Project 79.234 seconds, 10 steps, one checkpoint, 170,540,916 bytes, and
checkpoint SHA-256 `032123a1bc31b8e6dab3c8d00f961189ff3e0ddda2d051bd587a5de879afd135`.
Never project its source path, logs, PIDs, admission ID, or launcher hash.

For the current group, require actual
`figment/local-quality-fit@1`: complete, exit zero, null failure,
non-truncated logs, non-promotable, and verified teardown. Read the fixed
quality plan, fit admission, and CPU receipt too. Recompute the plan frozen
hash and require receipt `plan_sha256`, `inputs.plan_sha256`, and
`inputs.plan_file_sha256` to bind it and its raw bytes. Require the admission
frozen hash, plan hash, and CPU receipt raw SHA to bind the plan and CPU
receipt. Require `receipt.admission_id === admission.admission_id`; do not
invent a direct receipt-to-admission hash binding.

Before using the CPU raw hash, require its actual
`figment/local-quality-cpu-preflight-launch@1` completion, process exit zero,
verified teardown, top-level `branch: "current"`, and
`inputs.plan_file_sha256`/`inputs.plan_canonical_sha256` bindings. Its nested
`figment/local-quality-cpu-preflight@1` result must bind the same plan, be
non-promotable, and be CPU-only: CUDA mask `-1`, unavailable CUDA, zero devices,
and no initialization. A matching raw hash alone is insufficient.

Require the closed current recipe: 100 steps, interval 10, no samples/exports
or state saves, and eleven exact checkpoint records. Project 217.629 seconds,
11 artifacts, and allowlist only step 20
`fc3222248dd317270f975f34828f5376751114584d443eebeae0112deb3e473f`,
step 50 `bda6b6f2180028b2fa3777315405772aab8868a552fc7f332ef150fd88317de2`,
and final 100 `f3e2fbdc04ff923a3feaf0873ddb8624701067ac53d8877daddb651ed2b3736c`.
Each is 170,540,948 bytes. Do not read or expose checkpoint files.

## UI and validation

Show:

- **10-step local availability probe — Completed** · 1 checkpoint · 79.234 s
- **Current-caption 100-step local fit — Completed** · 11 checkpoints · 217.629 s

Then: “These records show completed local runs and artifact bindings. Quality
has not been evaluated here.” Keep warnings, process detail, receipt internals,
private paths, captions, logs, commands, and costs out of product copy.

Extend `localTraining.test.ts` with valid synthetic groups, plan/admission/CPU
binding failures, malformed eleven-checkpoint schedules, unsafe roots, and
projection redaction. Extend route/index composition and workspace tests for
historical copy, absence compatibility, malformed result refusal, and no new
request or button. Run those focused Vitest files and dashboard typecheck.
