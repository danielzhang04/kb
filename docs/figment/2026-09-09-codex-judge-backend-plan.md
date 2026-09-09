# Codex vision judge backend plan — 2026-09-09

## Scope and current boundary

This design covers a new standalone, diagnostic-only Codex backend. It does not modify `vlm_judge.py`, `identity_gate.py`, `gate.yaml`, persona configuration, active plans, or the running train harness.

The current stage-2 judge is Claude-specific: `vlm_judge._default_runner()` invokes `claude -p`. Its numeric thresholds and per-image scores are Sonnet-derived. Available human evidence is coarse batch-level operator commentary, not per-image labels, so it cannot calibrate or validate Codex thresholds.

## First increment

`pipeline/codex_judge_backend.py` accepts explicit, bounded prompt text and prompt version; ordered reference images and one candidate image; a requested model; a timeout; an executable; and a fresh work root. It stages byte-bound, decodable image copies beneath that root, calls one `codex exec`, validates the exact seven-field diagnostic payload, then removes the work root. It has no cache implementation, retries, cancellation input, calibration, gate decision, or integration with the current judge.

The payload requires six numeric fields: `same_person`, `apparent_age_reference`, `apparent_age_candidate`, `skin_realism`, `gloss`, and `artifacts`; the age fields range from 0 to 120 and the other four range from 0 to 100. `notes` is bounded text. Non-finite values and booleans fail validation. Any local validation failure, nonzero exit, missing or malformed result, stream overflow, timeout, or cleanup failure returns `unavailable`; no result is a pass.

The native executable is explicit `codex.exe`, never a `.cmd` or PowerShell wrapper. The argv uses `exec`, `--ephemeral`, `--ignore-user-config`, `--sandbox read-only`, `--skip-git-repo-check`, `-c model_reasoning_effort="low"`, `--model`, repeated `--image`, `--output-schema`, and `--output-last-message`. The current installed CLI help reports those flags. It does not collect a CLI version, usage, or cost. `responding_model` remains null with `responding_model_status: "unreported"` unless a future trusted response format supplies it.

The record binds protocol, requested model, schema hash, prompt version/hash, ordered original image hashes, and attached-image count into a future cache key. It does not read or write a cache.

## Process and filesystem constraints

Every lexical ancestor of every image, executable, and work root is checked for a reparse point before use. The work root must be new and exclusive. On Windows, the runner starts a supervisor blocked on stdin, assigns that supervisor to a private Job Object with `KILL_ON_JOB_CLOSE`, then releases its launch packet. Setup failure closes stdin and terminates the supervisor. Timeout, stream overflow, and wrapper exit all close the job; an assignment failure falls back to terminating the supervisor tree. Tests cover schema errors, native argv/stdin, request type and timeout validation, cache-key binding, output overflow after a quick exit, a non-reading child timeout, assignment failure cleanup, wrapper-exit child cleanup, and work-root cleanup.

`--ignore-user-config` and the read-only sandbox reduce avoidable local instruction/config influence, but read-only capability may still expose broad host reads. Image text can be prompt injection. This diagnostic module must not be used automatically on untrusted images until a separate integration-time capability review narrows that boundary.

## Integration and calibration remain separate

A later integration must use an explicit image/backend protocol, preserve the active stage ordering and fail-closed semantics, and receive independent review after the active train. Before Codex can affect any automatic gate, record compatibility and calibration work in a backend/model/schema-specific namespace, without overwriting Sonnet results or `gate.yaml`. The companion [calibration inventory](2026-09-09-codex-judge-calibration-inventory.md) identifies fixed evidence candidates but does not establish a positive reference trio or transferable numeric thresholds.
