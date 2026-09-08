# Local training evidence in the Figment hub — 2026-09-08

## Decision

Add a read-only **Training readiness** tab to the authenticated Figment hub. It records a historical local preparation snapshot from four configured receipts. It does not assess current eligibility, admit GPU work, launch a trainer, review a dataset, or judge output quality.

| Section | Display |
| --- | --- |
| Local preparation | **Recorded local preparation** — the CPU parser and local-only tokenizers completed for one frozen observation. |
| GPU training | **Not reported by these receipts.** |
| Quality review | **Not reported by these receipts.** |

The plan's `gpu_fit_probe_allowed: false` is a historical boundary in that CPU plan. It intentionally coexists with a possible future separate admission; it must not be rendered as a current “not admitted” verdict. The receipts do not prove that no GPU or quality evidence exists elsewhere.

One original `g01` observation, one repeat, and generated derivatives are provenance facts, not an eligibility decision. Derivatives are not independent observations. The receipts do not establish whether `g02`/`g07` were or were not held out later. A one-observation quality study can be valid for its own protocol; this display adds no 20-row requirement.

## Fixed evidence boundary

Add `dashboard/server/figment/localTraining.ts`. At composition, `BuildAppOptions` receives an optional fixed server setting:

```ts
interface FigmentLocalTrainingEvidenceRoots {
  cpuPreflight: string;
  tokenizerLaunch: string;
  plan: string;
  tokenizerLoad: string;
}
```

When no option or related environment variables are present, return `{ status: 'not-configured' }`. If any configured root is missing or unsafe, return `{ status: 'unavailable', reason: 'evidence-unavailable' }`. The browser never selects a directory, receipt, creator, or hash. The reader opens exactly these known children, with no scan or sibling fallback:

```text
cpuPreflight/receipt.json
tokenizerLaunch/receipt.json
plan/local-single-observation-plan.json
tokenizerLoad/local-tokenizer-load.json
```

Reuse the existing fixed-root reader posture: reject symbolic links, junctions, and reparse ancestors; require a regular file below the resolved configured root; cap JSON at 256 KiB; use a stable before/after size check; and cap nesting. The API stays `GET /api/figment` inside the existing authenticated, origin- and rate-limited read scope. No new route or asset endpoint is needed.

Project only concise metadata. Do not return absolute private paths, raw JSON, logs, stdout/stderr hashes, process IDs, captions, source/model/venv paths, commands, or tokenizer-copy inventories. The UI shows no receipt digests or code internals.

## Receipt checks

The reader must verify these exact relationships before it returns a recorded snapshot.

1. The frozen plan is `figment/local-single-observation-lora-plan@1`; recompute `frozen_sha256`. Require `creator-001`, `not_promotable: true`, one original and independent observation, the canonical-original-pixels source kind, 10 steps, zero samples/exports, and the plan's four execution booleans. Preserve only source label `anchors/g01.jpg`, observation/repeat counts, target resolution, and effective bucket.
2. The CPU wrapper is `figment/local-cpu-preflight-launch@1`, has `status: "complete"`, `process.exit_code: 0`, and `teardown.verified_stopped: true`. Its actual fields `inputs.plan_canonical_sha256` and `inputs.plan_file_sha256` must match the plan's recomputed canonical and raw-byte hashes. Its nested `figment/local-single-observation-cpu-preflight@1` result must show the one/one/one counts, `cuda_visible_devices: "-1"`, unavailable/uninitialized zero-device CUDA, and NVML checking. The current receipt example is target 768 × 768 with effective bucket 896 × 512.
3. The tokenizer wrapper is `figment/local-tokenizer-load-launch@1`, complete, exit-zero, and teardown-verified. Its actual `tokenizer_load_receipt_raw_sha256` must match the bounded inner receipt bytes; `tokenizer_load_receipt_frozen_sha256` must match the inner recomputed frozen hash.
4. The inner record is `figment/local-tokenizer-load@1`, non-promotable and non-approving, with local-only loading under the same no-CUDA posture. Require exactly the two recorded `CLIPTokenizer` IDs, their known pad IDs, and the fixed `caption_token_count: 19`. The number 19 describes the availability probe, not the training caption.

The CPU wrapper is bound to this frozen plan. The tokenizer wrapper is bound to its inner receipt. Neither cross-binding claims current persona/source revalidation, memory fit, a GPU run, a checkpoint, or quality.

## Changes

- `dashboard/server/figment/localTraining.ts`: bounded receipt reader and closed `LocalTrainingProjection` type: `not-configured`, `unavailable`, or historical `recorded` preparation metadata.
- `dashboard/server/figment/routes.ts`: add the member to `FigmentProjection`, pass the fixed option into `buildFigmentProjection()` and `registerFigmentRead()`.
- `dashboard/server/index.ts`: add `figmentLocalTrainingEvidence`; compose it from the explicit option or the four fixed `DASHBOARD_FIGMENT_LOCAL_*_ROOT` environment variables. Partial environment configuration is unavailable, never a default private read.
- `dashboard/src/figment/FigmentWorkspace.tsx`: normalize a missing `localTraining` member to `not-configured` for backward compatibility with older `figment/hub@1` responses; reject malformed supplied data. Add the tab with no buttons and no extra fetch.

The short UI copy is:

- “Historical local preparation evidence. It does not state current training eligibility.”
- “Recorded local preparation” with one original/one repeat, target/bucket, and local tokenizer summary.
- “The recorded 19-token result is an availability probe, not a training-caption count.”
- “GPU training — Not reported by these receipts.”
- “Quality review — Not reported by these receipts.”

## Validation

Add synthetic four-root tests that prove the successful historical projection returns only allowlisted metadata, the plan/CPU and wrapper/inner hash bindings fail closed, unsafe/missing roots are unavailable, and unconfigured is distinct. Extend the route test for the default member, composition test for fixed roots passing through the authenticated read route, and workspace tests for recorded copy, no extra request/buttons, backward-compatible absence, and malformed rejection.

Run focused Vitest files, `npm run typecheck`, and the dashboard suite. This plan is based on studio commit `1056eb92bdad814b1c216ba677a9b9c83058511c`; no GPU, pod, network, credential, browser, or provider work is in scope. The native requested model and actual billing are not present in these receipts and remain unprojected.
