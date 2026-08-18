---
id: 6a83ed0f-ace3e6c9
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\fix-git-identity
risk-tier: T1
owner: codex-worker
claim-token: d00a8634408473cf
state: done
approval: null
workflow: 01a01353-d692-7ee2-aa75-3307ea7260a8
depends-on: []
variant-group: null
role: work
session-id: 6a83ec7b-67c266eb
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task: add boot-time ops git-identity assertion (reviewer MINOR). NO git write commands.

Work ONLY in `C:/Users/danie/kb-worktrees/fix-git-identity` (your cwd), on top of the existing
uncommitted diff. Files: deploy/validate_vm_runtime.py + tests/test_validate_vm_runtime.py, plus
use --replace-all in the two new bootstrap_vm.py git config calls (robust idiom per review).

1. In validate_vm_runtime.py's static phase: assert `git -C /var/lib/kb/ops config --get user.email`
   returns a non-empty value (and user.name likewise), RuntimeError naming the missing key
   otherwise — matching the module's existing subprocess/check idioms and timeout discipline.
   A VM without identity must fail validation at boot instead of entering the 60s crash loop.
2. bootstrap_vm.py: switch the two new `git config` calls to `git config --replace-all`.
3. Tests: validator passes with identity present, fails with empty/missing (both keys); bootstrap
   tests updated for --replace-all. Existing suites stay green.
4. Run `py -3 -m pytest tests/test_bootstrap_vm.py tests/test_validate_vm_runtime.py -q
   --basetemp=./.pytest-local-tmp`; numbers; confirm the new validator tests fail pre-change.

Terse report.

## Result

Implemented.

- Static validation now requires non-empty `user.email` and `user.name`, raising a key-naming `RuntimeError` on missing/empty values.
- Bootstrap identity calls use `git config --replace-all`.
- Added/updated focused tests.

Pre-change validator tests: 5 failed (expected).  
Final command: `85 passed in 1.66s`.  
`git diff --check` passed. No git write commands run.
