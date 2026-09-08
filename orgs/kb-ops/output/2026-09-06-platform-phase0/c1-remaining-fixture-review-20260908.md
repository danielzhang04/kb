# DRAFT — C1 remaining fixture review, 2026-09-08

Status: **DRAFT; bounded fixture correction accepted after independent root
review.** This change does not alter production code or accept the Linux broker
gate.

Root independently reviewed both four-line fixture diffs and reran the native
tool-policy suite: **2/2 PASS**, one file, 787 ms. The root's pre-fix probe was
1 pass / 1 failure. Existing receipt, policy, broker and PTY assertions were not
weakened. The broader working-tree typecheck remains blocked by the separately
paused A1 fixture; final reviewed-archive Linux/type gates remain required.

Two direct `createAttemptSessionAdapter` test callers still omitted the now
required durable message-claim store. The adapter correctly fails closed before
host creation when that store is absent, which made the tool-policy wire time
out and would prevent the real Linux broker fixture from reaching its existing
PTY assertions.

The repair constructs `createAgentSessionChainStore(stateRoot)` in each
fixture and passes it as `messageClaims` to the adapter. Both fixtures already
own a unique temporary `stateRoot` and remove it during cleanup, so the claim
document shares the test lifetime without adding a helper, global state, or a
second persistence location. The tool-policy test continues to prove the real
proposal-policy-to-broker-recipe mapping. The Linux test continues to be the
required real broker/PTY proof; a Windows compile or tool-policy result does
not substitute for that final archive gate.

Owned files in this repair are only:

- `dashboard/server/control/toolPolicyWire.test.ts`;
- `dashboard/server/pty/realBroker.integration.test.ts`;
- this DRAFT review record.

No adapter, claim-store, PTY, activation, execution, grant, or route production
file is changed.

## Verification

From `dashboard`, the authorized native focused command passed **2 tests in 1
file**:

```
npm.cmd test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism server/control/toolPolicyWire.test.ts
```

The subsequent `npm.cmd run typecheck` did not reach a clean repository result.
It reported fourteen errors, all in concurrently owned
`server/control/execution.test.ts` at lines 3588 and 4230–4309; neither repaired
fixture appears in the diagnostic set. Those unrelated errors are not treated
as a pass, and this fixture repair did not edit them. The real broker test was
not run on Windows; its required proof remains the final reviewed Linux archive
gate.
