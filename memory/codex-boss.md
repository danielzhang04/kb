# Codex boss memory

## 2026-08-19 — Match the workspace root to the target project

- When a requested implementation lives outside the active writable workspace, locate and inspect it read-only, then restart the coding session from the target project's common parent before editing. This keeps sibling source and portal directories available, avoids a chain of per-command escalations, and makes branch/test/deploy operations coherent.
- When adding applied material to a research library, first map the existing information architecture. A distinct practice track can preserve the difference between explanatory reference content and a goal-directed learning/build plan better than appending another chapter or duplicating an existing reading path.

## 2026-08-20 — desk⇄VM Phase-1 overnight (boss session; spec→plan→7-task build)

- WORKED: per-task loop = codex builds (focused gates only) → boss re-runs tests outside sandbox → model-verified adversarial review (opus on trust surfaces: store surgery/lease/attestation; sonnet on mechanical) → prescribed-fix dispatch → reviewer re-verify → boss commits. Caught 5 BLOCKERs that tests+typecheck could not see (wire-contract lifecycle leak, host-store migration from tests, resident-VM import kill, stale-registry pin, unexecuted POSIX adapter). Review-then-commit is non-negotiable for deploy-path code.
- WORKED: WSL leg for POSIX-only code — tar-copy source (exclude node_modules) into a Linux-native dir + npm ci there (Windows node_modules lack linux native bindings; rolldown fails on /mnt/c), pip --user --break-system-packages for pytest. First execution of an adapter is a review gate, not an afterthought.
- FAILED: full-suite runs INSIDE codex workers — the dispatch shell got killed twice mid-`npm test`; orphaned codex children keep working (watch pending marker pid + JSONL mtime; a >4-min-quiet log can just be a silent long test run — check process liveness, not only mtime). Rule: workers never run broad suites.
- FAILED: trusting sandbox-reported test failures on native-I/O files — NtCreateFile interception makes authorizedFailedRunReconciliation fail 20/23 in-sandbox vs 23/23 outside; pytest needs --basetemp inside the worktree. Boss re-runs are the arbiter.
- LEARNED: grep-based plan completion checks cannot catch pass-through serialization drift after a type rename — reviewer's type-first enumeration of payload-carrying types is the check that works.
- LEARNED: review fixes can orphan plan interfaces (deleted "dead" exports that a later task consumes) and plan test inputs go stale against review-hardened contracts. Standing rulings that kept the night moving: adapt INPUTS to contracts (never weaken contracts), recreate plan-mandated interfaces as thin wrappers, record every ruling as a plan-header amendment so gates stay honest.
- LEARNED: parallel vitest on this box under load = waitFor-timeout flake in src/ UI files; the server suite is exactly clean serially (163 files/2500 tests). Characterize baselines serially before believing any red.
