---
schema-version: 1
id: 6a99bffb-653e1bee
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p1
risk-tier: T1
owner: codex-worker
claim-token: 898cd92c69a0b996
state: done
approval: null
workflow: 01a06894-1970-7b50-ae5f-943384cec7f3
depends-on: []
variant-group: null
role: work
session-id: 6a99bf7a-59a0436b
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 16bec2a5a819b7baff88944623604e630e26edff
---

## Work order

You are a codex BUILDER in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p1`
(branch `claude/prospecting-p1`). Run `python scripts/preamble.py` once (expect PREAMBLE OK; if no
output within 60 s, retry once, then proceed and note it). NEVER commit, never touch git refs, never
pip install, never run repo-wide grep, never read memory/, queue/, ledgers/, orgs/faceless-youtube/,
dashboard/. Use `--basetemp .pytest-tmp-reg -p no:cacheprovider`. Stop at 30 minutes. First edit by command 4.

\# Fix brief — executor adapter registry (boss ruling; unblocks P2/P4 without editing P1 files)
Later phases (P2 vendor lookups, P4 Gmail) must attach adapters to the P1 executor WITHOUT modifying
`executor.py`. READ: `scripts/prospecting/executor.py` (full), `scripts/prospecting/tests/test_executor_surface.py`. Nothing else.
1. Add `Executor.register_adapter(operation: str, adapter: Callable[[ExecRequest], tuple[str, str]])`:
   `operation` must be one of the executor's declared capabilities (`exec_request:<op>` list); registering an
   unknown operation raises; registering twice raises unless `replace=True`. `_act` dispatches to the registered
   adapter; with none registered the operation is rejected with `("rejected", "no_adapter")` (today's behavior).
   The registry is per-Executor-instance (never module-global) and is NOT reachable from agent-facing
   surfaces (capability enumeration test unchanged: zero raw operations).
2. Adapters run inside the executor's existing validate → hooks → act → audit chain; the send-approval
   consumption (CAS at act time) stays in the executor, before the adapter is invoked, and the commit-only-on-
   `succeeded` rule is preserved.
3. Tests: register + dispatch; unknown op rejected; double registration rejected; no adapter → `no_adapter`;
   adapter exception → `("rejected", "adapter_error")` with rollback; enumeration still reports zero raw ops.
Run `py -3 -m pytest scripts/prospecting/tests/test_executor_surface.py scripts/prospecting/tests/test_contracts.py -q --basetemp .pytest-tmp-reg -p no:cacheprovider`;
all pass. Report files changed, counts, summary, and the exact registration API in 5 lines for P2/P4 builders.

## Result

Implemented adapter registry.

- Changed 2 files: 83 insertions, 15 deletions.
- Added per-instance registration, transactional dispatch, no-adapter rejection, and adapter-error rollback.
- Added coverage for registration, unknown/duplicate operations, no adapter, exceptions/rollback, and preserved capability surface.
- Verified: `34 passed` with the requested pytest command.

```python
def register_adapter(self, operation: str, adapter: Adapter, *, replace: bool = False) -> None
executor.register_adapter("vendor_lookup", vendor_adapter)
executor.register_adapter("gmail_draft", gmail_draft_adapter)
executor.register_adapter("gmail_send", gmail_send_adapter)
\# adapter: Callable[[ExecRequest], tuple[str, str]]; absent adapter → ("rejected", "no_adapter")
```
