# OmniGen2 runtime primitives review — 2026-09-08

Root accepts the shared pair-engine extensions and read-only Windows resource observer for controller integration. This is not admission of a GPU run or evidence of image quality. The fixed planner and [runtime design](2026-09-08-local-omnigen2-runtime-design.md) define the separate reference-conditioned experiment; the previous C2 and C3 studies remain stopped.

## Implemented and verified

The pair engine now accepts closed additional Comfy launch flags, reference staging and output-decoding callbacks, a resource observer, and tighter readiness/row deadlines. The default command and receipt keys remain unchanged. Discovery retains owned identities when readiness fails. The engine alone performs process teardown; the observer only reports samples and failures.

Checks immediately before launch and dispatch prevent starting work after a known deadline. Late observer errors, stderr reader failures, final stderr hashing errors, and evidence changes cannot become successful receipts. Pipe closure follows the reader's completion. Filesystem failure can still prevent writing a receipt; an unavailable filesystem is not something the implementation can guarantee around.

The observer retains at most 6,100 samples with actual timestamps, durations, gaps, extrema and first breach. It fails on invalid critical telemetry, missing samples, sampler/thread errors, or capacity exhaustion. The engine accepts at most 8 MiB of finite JSON observer evidence. The 1-second cadence and runtime deadlines are cooperative; blocking APIs can delay a sample or reaction. Page-read telemetry is explicitly unavailable in this implementation and is not fabricated as zero.

Root verification:

- 96 engine/resource tests passed in 1.35 seconds after repairs, including the full 6,100-sample bound and late failure paths.
- The five train planner/runtime/engine suites exercised 83 cases. The first run had 79 passes and four failures because the older mocked stream lacked `close()`. Adding that real stream interface to the fixture made the focused 18-case matched-runtime suite pass in 0.57 seconds. Production pipe closure was retained.
- A real read-only self-process probe succeeded in 0.076 seconds: positive private commit, 10 MiB GPU use and 7,939 MiB free. It launched no inference process. Its available RAM was below the launch floor, so it was not a run admission.

Accepted source SHA-256:

- `train/local_lora_pair_engine.py`: `26e1745885c6bea9d0e934c00953dcc3d5869fde1e56f3ee6a87b5e10c6819a9`.
- `expand/local_omnigen2_resources.py`: `5036d75702d1f943a1757306bbd61f022949b4fcdac4d039acc198d1bd21c6e9`.
- Immutable `expand/local_comfy_input.py`: `2997ba3185aabfb146b13f38d18c854615a7190064d30f14037570398bea7bac`.

The two existing controllers' engine literals were updated to the accepted source. Historical receipt hashes and artifacts were not rewritten or rerun.

## Independent reviews and root decisions

Actual Fable 5.1 authored and repaired the components. Actual Opus 5 reviewed complete initial source/test packets and the affected final execution/resource code. Root accepted concrete fixes for dispatch timing, late errors, bounded evidence and deterministic stream closure. Opus's final verdict remained REQUEST CHANGES; root rejected its claimed blocking stderr gap after inspecting `journal_lora_application`, which calls `Pumper.finish()` to join and reject reader errors/truncation before final hashing. The existing late-journal failure tests exercise that path. Adding a second join or changing historical receipt keys would not repair a missing guard because that guard already exists.

Root also rejected three unsupported suggestions from the resource review: broader process access rights, relaxed parent identity equality, and benign saturation that would stop monitoring without failing the run. The immutable helper returns the supplied parent alongside the handle-derived creation time; exact identity equality remains appropriate. A live self-process probe verified that the minimal query permission works. Modern Windows permits the limited query right for this API; the older operating-system requirement is different. [GetProcessMemoryInfo](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getprocessmemoryinfo)

Private usage is process commit rather than working set. System commit headroom uses the difference between commit-limit and committed page counts, multiplied by page size. [Process memory counters](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex), [system performance information](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information)

The initial isolated GPU query failed with NVML Unknown Error. Controlled probes showed that adding `PROGRAMFILES` alone to `SYSTEMROOT` and `WINDIR` restored it; adding `PATH` did not. Fourteen other individual variable additions did not restore it. The final allowlist adds only the empirically necessary variable. No environment values or credential stores were recorded.

Private evidence is retained under the owned `figment-claude-*` review roots and `figment-omnigen-resource-*` / `figment-nvml-*` probe roots named in the canonical handoff. CLI list-price telemetry is separate from verified provider spending. A Windows argv-length failure was resolved by feeding bounded review packets through stdin; the subsequent actual Opus reviews completed.

Remaining work: independent admission/controller review, fake complete/failure integration tests, fresh code/model/input verification and resource preflight, then one fixed two-image run. No production promotion or deployment is implied.
