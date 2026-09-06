# Platform operations audit — DRAFT

**Baseline and limits.** Read-only audit of `39197cf5d9322f21d859d6f7a98d3a5b57cc42ea`, equal to `origin/main` with no tracked local diff. No VM, systemd state, Tailnet, SSH, credentials, deploy, or production queue was accessed. VM-state assertions below come solely from the supplied outage handoff plus source evidence.

## Verdict

**BLOCK a VM release and any claim of working desktop scheduler failover.** Current main contains a confirmed control-plane hydrate crash loop, and its documented Windows fallback cannot reach the only production schedule authority. Whether that scheduled task is installed or active on a live desktop was not observed; treat it as an unsupported/retirement candidate until a human establishes a supported capability requirement. Preserve the existing single-writer, durable-outbox architecture; fix the hydrate defect before adding more automation.

## Implemented process topology

```text
Windows Task Scheduler
  -> scripts/desktop_dispatch.ps1
  -> scripts/dispatch.py --tier desktop
  -> /run/kb-dashboard/schedules.sock [VM-local Unix socket; unavailable on desktop]

Linux VM systemd
  kb-dashboard.service (writer lease, control-plane state, ops checkout)
    -> schedule authority + Unix socket, peer-UID restricted
    -> claim -> queue-card -> dispatch-ledger replay phases
    -> outbox-only coordination publication
  kb-shell-broker.socket -> kb-shell-broker.service -> PTY workers
  kb-node-proxy.service -> kb-whois.socket/service -> dashboard loopback

Desktop promotion
  -> validate VM outbox bundle/manifest/parent chain/signature
  -> replay only on ops -> return bundle -> VM readiness/receipt apply
```

The daemon owns schedule state. `ScheduleService` uses store transactions; the Unix socket admits the dispatcher UID; `dispatch.py` advances `claimed -> card-saved -> ledger-appended`. That is a sound single-authority shape, but there is no usable cross-machine authority failover.

## Findings

### CRITICAL — valid concurrent-run state crash-loops dashboard hydration

**Location:** `dashboard/server/control/store.ts:1695-1715`; fatal entry path `dashboard/server/index.ts:749-752`; restart policy `deploy/systemd/kb-dashboard.service:50-51`.

**Trigger / impact:** Two runs each hold an unresolved artifact-producing rework request for the same logical stage (for example `build`) but with different base commits. Hydration searches all requests only by the recurring logical stage ID, so the second run can bind the first run's request. The base-commit check throws at line 1715, `start()` reaches `process.exit(1)`, and `Restart=on-failure` repeats it. The service cannot provide schedule authority, queue bridge, health, or recovery API.

**Evidence / guards / coverage:** The supplied `origin/ops:handoffs/2026-09-06-dashboard-outage-recovery.md` records this exact SHA and line-1715 error. The predicate at 1695-1701 lacks `request.subject === attempt.subject` and `request.runRef === attempt.runRef`; adjacent joins use run identity. Reviewed fix `e8bf8d35` adds those guards and two-run restart regression tests. Current `store.test.ts:4096-4108` tests only one-run tampering, while `4061-4075` proves only a one-run restart.

**Remedy:** Merge #173 (`e8bf8d35`) before recovery and follow the handoff recovery order. Retain the fail-closed validator, but make rejection observable through a controlled degraded state rather than only a systemd crash loop. Add the two-concurrent-runs load test to every release canary.

### HIGH — Windows desktop dispatcher cannot dispatch schedules or fail over

**Location:** `scripts/desktop_dispatch.ps1:10,23-40`, `scripts/dispatch.py:1214-1243`, `scripts/schedule_store.py:15,27-46`.

**Trigger / impact:** If the task is installed, its wrapper first hard-codes `C:\Users\danie\kb`, runs `git checkout ops`, then `git pull --rebase origin ops` without checking either exit code before later work. That contradicts the isolated-worktree rule and can act on/rebase the wrong shared branch. It then calls `dispatch.py --tier desktop`; production `main()` ignores the tier after parsing and unconditionally uses `_LiveScheduleStoreClient`, whose `snapshot/claim/advance` targets `/run/kb-dashboard/schedules.sock`. This is a VM-local Unix path, with no desktop remote adapter. On a missing socket the Python client fails closed, then PowerShell logs `dispatch-fail` and returns its nonzero exit. Thus the artifact is neither a safe shared-checkout runner nor a demonstrated failover scheduler.

**Evidence / guards / coverage:** The schedule server is Linux-only (`dashboard/server/schedules/socketRoutes.ts:77-82`). The old `dispatch.run()` can partition desktop HEARTBEAT cadences, but production CLI test `tests/test_dispatch.py:1091-1106` explicitly asserts CLI must not read them. `tests/test_schedule_store.py:89-95,262-275` treats non-Linux socket use as unavailable. No test runs `desktop_dispatch.ps1` against the production main path, validates checkout/pull failure handling, or exercises a desktop/VM partition.

**Remedy:** decide explicitly:

- If VM remains schedule-authoritative, remove “fallback” from the desktop contract and have it only execute/reconcile already claimed work; alert on a missed VM dispatcher.
- If desktop must schedule during VM loss, implement a single authenticated, lease/CAS-fenced remote or replicated authority. Do not resurrect independent HEARTBEAT parsing on both machines: it creates split brain.

### MEDIUM — health reports node-proxy and host-map healthy without probing either

**Location:** `dashboard/server/health/routes.ts:45-50`; relevant deployed controls `deploy/validate_vm_runtime.py:735-780` and `deploy/bootstrap_vm.py:215-236`.

**Trigger / impact:** A failed node proxy, WhoIs socket, or bad/missing host-node map after boot still yields static `{ reachable: true }` and `{ valid: true }`. `/api/health` omits the failure, producing a false-green view during partial deployment or runtime degradation.

**Evidence / guards / coverage:** The route comment says no real W4 probe is wired. Runtime validation strongly checks the unit trio and socket modes, but its result is not a runtime health reader. `dashboard/server/health/routes.test.ts` covers authentication, ETags, schedule-owner error and generic unavailable isolation; it has no broken proxy/map injection test.

**Remedy:** wire bounded, read-only node-proxy and map checks; return an `unavailable` integrity row on error while retaining session authentication. Test absent socket, refused proxy, malformed/stale map, and healthy state.

## Strong designs to preserve

- Schedule UID admission, expected-version CAS, idempotency, and replay phases in `scripts/dispatch.py:1107-1154` protect against card/ledger partial failures.
- `deploy/activate_release.py` has the right release shape: signature/allow-list extraction, exclusive lock, static validation before switch, atomic current/previous links, readiness wait, and rollback. Preserve the outage handoff's resident-validator-before-activation rule.
- `dashboard/server/write/outbox.ts:85-158`, `scripts/promote_vm_outbox.py`, and `deploy/apply_ops_reconciliation.py` correctly defend a desktop/VM trust boundary through validated single-parent bundles, fsync/rename, exact tree replay, receipts, and readiness.
- PTY confinement is strong: separate users, group-writable umask on producer and broker, socket activation, no broker TCP listener, pinned paths, bounded browser backpressure (`dashboard/server/pty/route.ts:298-319`), and persisted terminal state. Keep distinct Unix process-group and Windows `taskkill /T /F` exit tests (`scripts/codex_dispatch.py:205-233`).

## Simplification plan

1. Collapse the two scheduler stories behind one contract. Legacy `dispatch.run()` is test-only while current CLI uses daemon state. Either remove the unreachable fallback promise or build a real cross-machine authority adapter.
2. Make validator, deployment service, health reader, and recovery scripts one versioned release contract. Keep resident helpers, but publish one machine-readable compatibility manifest consumed by build, activation preflight, and health.
3. Do not add another reconciliation system. Use the existing outbox for bounded metrics: oldest ready-bundle age, chain depth, receipt-prefix length, last successful promotion, and control-document validation result.

## Operational acceptance and fault tests

| Fault / acceptance case | Required result |
| --- | --- |
| Two concurrent reworks with same stage ID, then restart | Each attempt joins its own run; store loads and routes bind. |
| Bad base commit in only run B | Precise rejection, alert, and a recoverable controlled mode. |
| Crash after claim, card save, or ledger append | One card digest and one ledger row after replay. |
| Windows task while VM socket is absent | Explicit authority-unavailable event; no false success or local competing claim. |
| Approved failover under network partition / lease handoff | Exactly one fenced leader can claim; partitioned former leader cannot write. |
| Outbox disk-full, rename interruption, or ready item older than 24h | No malformed ready item; reads survive; age/depth alert; exact parent-order resume. |
| Broker crash/worker survivor on Linux and Windows | One terminal record and no surviving process tree. |
| Node proxy, WhoIs, or map breaks after boot | Bounded health integrity error; other health sections remain live. |
| Validator/unit contract changes in a release | Resident validator preinstalled; failed readiness restores old `current`. |

Recurring controls should be a regulator with deterministic thresholds, retry cap two, immutable evidence, and human acceptance. It must not auto-merge, deploy, clear freeze, or accept its own result.

## Verification and coverage

Commands run locally:

```text
python scripts/preamble.py                         # PREAMBLE OK
git status/branch/rev-parse/diff checks            # HEAD = origin/main = 39197cf5; no tracked diff
git show origin/ops:handoffs/2026-09-06-dashboard-outage-recovery.md
git show/diff e8bf8d35                             # source and regression fix reviewed
python -B -c "ast.parse(...)"                      # AST-OK, 17 platform Python modules
git diff --check                                   # clean
```

My focused pytest invocation could not create its sandboxed Windows user temporary directory (`WinError 5`); redirecting to `C:\\tmp` was also denied. Its `98 passed, 153 setup errors` is therefore an environment result, not a product result. Parent-session isolated evidence reports `tests/test_preamble.py tests/test_schedule_store.py tests/test_queue_bridge_select.py tests/test_validate_vm_runtime.py`: **156 passed in 1.44s**. Parent-session TypeScript evidence reports 23/25 initial pass; the two failures were default test state writes, and passed 2/2 with isolated `DASHBOARD_STATE_ROOT`. No broad suite ran.

**Implementation read or line-traced:** `scripts/{preamble,ledger,dispatch,schedule_store,schedule_mirror,agent_runner.py,agent_runner.ps1,agent_runner.sh,codex_dispatch,desktop_dispatch.ps1,reconcile,promotion,promote_vm_outbox,build_platform_release,deploy_platform_release}`; `deploy/{activate_release,bootstrap_vm,validate_vm_runtime,install_pty_broker,apply_ops_reconciliation,control_plane_schema}`; all relevant `deploy/systemd` units; release workflow; and `dashboard/server` index, control store, schedules, health, write/outbox, reconciliation, release, and PTY runtime modules. Corresponding Python and TypeScript tests were inspected for covered and absent cases. Full auth/UI/workflow business logic and secret-bearing files were out of scope; no `.env`, SSH, or credential material was opened.

## Security review result

No additional concrete credential, authorization, injection, traversal, or remote-execution flaw was proved. Inspected boundaries were release signatures/resident validation, Unix peer-UID schedule admission, Tailnet node-proxy/WhoIs isolation, broker process boundaries, outbox manifest/bundle validation, and reconciliation-publisher bypass guards. The findings are availability/integrity defects.

**Security verdict:** REQUEST CHANGES for the CRITICAL hydrate and HIGH desktop-authority defects; retain existing fail-closed controls while fixing them.
