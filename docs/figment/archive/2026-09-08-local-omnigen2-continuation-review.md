# Local OmniGen2 delayed continuation review

The original two-image OmniGen2 experiment has not been admitted: available physical RAM remained below its 12 GiB floor. This continuation waits for the existing floors, prepares fresh evidence, and delegates one execution to the already reviewed controller. It never promotes image quality from a successful runtime receipt.

## Scope

- Fixed continuation and activation paths, root process identity, and source hashes.
- A single 14-hour readiness window, at most 840 samples, and three consecutive passing samples. Up to three preparations are allowed only when resources fall before admission; generation gets one attempt.
- Full model and code verification, then three fresh resource samples before admission. The original runtime, admission, resource observer, helper and engine remain unchanged.
- Existing keep-awake lease heartbeats while waiting and executing. The existing engine alone owns the image-generation process and teardown.
- Exact complete runtime receipt, two fixed seeds with 768-square outputs, verified teardown, separate raw/canonical receipt hashes, and a final state awaiting visual review.

## Review history

The initial Fable implementation passed 31 tests but was not accepted. Root found incorrect owner identity, readiness deadline resets, missing heartbeats below the RAM floor and during generation, weak receipt verification, and unbounded reads. A Codex worker selected as `gpt-5.6-terra` repaired those defects; root independently ran its 36 focused tests, all passing in 0.32 seconds.

A fresh Codex reviewer selected as `gpt-6-astra` returned **REQUEST_CHANGES** on source hash `7071fd51d342d9bf6d542edbfbc9eb9eaa5c68acf945031164b534921ca5e483`. Four findings were accepted: activation/source revocation was not checked during generation; global keep-awake health did not establish the root lease existed; the heartbeat worker's 21-second join did not cover up to 40 seconds of subprocess waits; and the sanitized environment could not resolve the watchdog's bare `powershell.exe` invocation.

The actual local adapter probe confirmed the last issue: executable resolution failed with the original restricted environment and succeeded with a fixed PowerShell-directory `PATH`. Its normal heartbeat/status probe succeeded and verified root PID 16580 with creation time 134333121437400244. This was a local lease probe, not activation or generation. Evidence is in MAIN `_private/figment-continuation-adapter-probe-20260908-v1/result.json`; the independent findings and root adjudication are retained in MAIN `_private/figment-continuation-codex-review-20260908-v1.json`.

## Current disposition

Accepted locally after two repair reviews. The second review found that cancellation could hide explicitly unproven PowerShell cleanup. The final repair preserves that failure on both commands, including kill errors, and adds a stubborn-child worker-close regression. The independent reviewer returned **READY** for source `55ea5af4bfc49d6111e11a322f57a523fd730709f10f481649a65718759aa2b0`; earlier REQUEST_CHANGES verdicts remain recorded. Root's final isolated suite passed **40 tests in 0.32 seconds**. Default CLI printed its static plan without creating any continuation, activation, admission or runtime root.

The final actual adapter probe matches that source hash and confirms the root identity, exact live pid-only lease, healthy supervisor and unchanged keep-awake source hashes. Available RAM was 7,022,694,400 bytes, still below the 12 GiB floor; GPU memory was 7,939 MiB free. No admission or GPU run occurred during these checks. Evidence: MAIN `_private/figment-continuation-adapter-probe-20260908-v2/result.json` and `figment-continuation-codex-review-20260908-v3.json`.

The execution heartbeat performs the full guard outside the one-second resource callback. It also validates the lease synchronously after admission verification and before the controller starts, and checks the guard again before accepting the receipt. Missing or mismatched leases and command errors fail closed. A valid own lease with briefly unarmed global state gets a 90-second recovery window during execution. Cancellation prevents an unnecessary second child launch, and the worker has a conservative 31-second join bound; unresolved owned-child cleanup remains a failure.

Timing limits are cooperative: filesystem/native calls and process scheduling can delay checks. The shared keep-awake supervisor reaches its existing cap at approximately 20:45 Eastern; the existing heartbeat watchdog can respawn it using the fixed executable-search path. This does not prove uninterrupted sleep prevention across that handover. The wrapper does not alter the global scripts, replace the baseline, acquire another lease or kill the shared supervisor.

Root may now create the concrete source-bound activation and launch the one-shot continuation under the user's existing authorization. Actual launch status belongs in the canonical handoff and private launch/result receipts. The earlier C2 and C3 STOP decisions remain in force. No provider export, model/precision change, resource-floor reduction or image-quality promotion is included.
