# One readiness-query timeout allowance

The Sep8 continuation stopped before admission: five readiness samples, zero executions and `ResourceError: gpu query timed out`, after 551.846 seconds. Its last healthy heartbeat was23:48:14 UTC, failed sample23:54:10, and final result23:54:15. PID54848 is absent. The original image admission and runtime roots were never created. Its journal, activation and launch receipts remain intact under their Sep8 paths.

A fresh Sep9 local probe successfully queried the GPU and verified the existing root lease and new shared supervisor41316. Available RAM remained below the unchanged12 GiB floor. The records show a long scheduling gap but do not establish its cause; this was a readiness telemetry failure, not an image-model or admitted runtime failure.

The replacement uses fresh fixed continuation and activation paths ending `20260909-v1`. Only the read-only waiting phase may tolerate one exact `ResourceError("gpu query timed out")`. It records the raw error and a separate tolerance event, resets readiness, heartbeats, and sleeps normally. Admission still requires three fresh complete healthy samples plus the original full evidence preparation and post-hash resource checks. The `resource_timeout_count` field counts consumed tolerance, at most1; fatal errors are separately recorded.

A second timeout, any other sampler error, and any preparation timeout remain terminal. The original runtime observer is unchanged. All resource floors, source pins, model/precision/flags, the14-hour readiness window,840-sample cap, maximum three resource-related preparation attempts and one generation attempt remain unchanged. No stale telemetry contributes to readiness. The existing root lease is reused; no global power-script change or shared-process termination is included.

Codex implementation selected `gpt-5.6-terra`; independent review selected `gpt-6-astra` and returned **READY**. Root independently read the diff and ran **44 focused tests, passing in0.27 seconds**. Accepted source SHA256: `338feab692bccb123f7c32fcf23c5d79293173aadba191dc93e99241344d0b21`. Review evidence: MAIN `_private/figment-continuation-codex-review-20260909-v1.json`; actual recovery probe: `_private/figment-after-wait-failure-probe-20260909-v1/result.json`.

This accepts a versioned readiness retry after a recovered telemetry error. It does not accept any image quality, reopen C2/C3 STOP decisions, or authorize provider export. Actual activation and process status are recorded separately in the current canonical handoff and private launch/result receipts.
