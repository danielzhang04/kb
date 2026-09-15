# Codex judge backend independent review — 2026-09-09

## Verdict

**READY for the standalone, offline, diagnostic-only scope.** This verdict does not authorize a live Codex call, integrate Codex into `vlm_judge.py` or `identity_gate.py`, validate Sonnet thresholds for Codex, or permit a Codex result to pass a gate.

Reviewed exact files:

| File | SHA-256 |
|---|---|
| `orgs/figment/pipeline/codex_judge_backend.py` | `99467813473ecc99cad001fa5c7a798b9100cbd1a0a3b109a112ea63138ec49a` |
| `orgs/figment/pipeline/tests/test_codex_judge_backend.py` | `46ca7c1aba03c246ecab3619fc15ea54c0b5c0715874541ed66cba0634995b18` |
| `docs/figment/2026-09-09-codex-judge-backend-plan.md` | `c479846af06d2918f0a5241714ea8f273c1349a441f6ab77cf51d7b3825c80c3` |

## Repaired findings

The final module resolves the concrete blockers found during review:

- Win64 Job Object structures and Win32 function signatures are typed, avoiding truncated handles and hard-coded structure layout.
- A supervisor that fails Job Object creation or assignment is terminated and waited rather than remaining blocked on stdin.
- Timeout, stream overflow, and wrapper-exit paths close the owned Job Object and wait for the supervised process tree.
- Stream overflow is checked again after reader threads drain, covering fast process exit.
- The stdin writer is bounded, and a child that does not read stdin reaches the timeout cleanup path.
- Request field types are validated before provenance hashing or model-regex use; boolean and non-finite timeouts fail closed.
- Images are copied into a fresh private work root, verified against their original byte hashes, decoded before attachment, and protected by ancestor reparse checks.
- The seven-field payload rejects missing, extra, boolean, non-finite, and out-of-range values. The backend returns either a diagnostic payload or `unavailable`; it never returns a gate pass and implements no cache.
- The design note now matches the implemented cache, retry, cancellation, CLI-version, and metric boundaries.

## Verification

Root ran the exact final test file against a fresh private base temp: **12 passed in 7.00 seconds**.

My attempted test run did not execute any test body because the sandbox identity could not enumerate the default `C:/Users/danie/AppData/Local/Temp/pytest-of-danie` directory; pytest reported eight setup errors from that ACL boundary. I therefore do not count it as an independent pass or failure of the implementation. Static review verified the final hashes and a targeted `git diff --check` completed without errors.

## Boundary for the next increment

Training became terminal at 19:26:47 UTC with verified teardown, so the former active-source freeze no longer blocks a separately reviewed integration change. A live judge transport smoke remains separate evidence and should occur only after the invocation is narrowed with the documented Codex controls:

- `project_doc_max_bytes=0` so repository `AGENTS.md` content is not loaded;
- `features.shell_tool=false`;
- `web_search='disabled'`;
- a fresh runner-owned work root outside `MAIN`, preventing project-instruction discovery by ancestry;
- the explicit native vendor `codex.exe` path, because `shutil.which("codex.exe")` currently returns `None` on this host;
- the exact stdin rubric, output schema, and hash-pinned curated images from the companion calibration inventory.

The first successful transport smoke would establish invocation and schema behavior only. The human evidence remains too coarse to validate five-axis Codex thresholds, and g02/g07 remain unverified legacy references rather than positive identity truth.
