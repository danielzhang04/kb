# Verdict: RE-RUN

B3 and B5 remain unaddressed; B4 and B6 are incomplete. The edits also introduced several non-compiling or producer/consumer-breaking interfaces. Do not commit the [Phase I plan](C:/Users/danie/kb-worktrees/boss-2026-08-11c/docs/superpowers/plans/2026-08-11-kb-structure-phase1.md:1).

| Finding | Verdict | Plan lines | Note |
|---|---|---:|---|
| B1 | ADDRESSED | 1056–1068, 1353, 1444–1554, 1582–1602 | Root-owned staging, FD copying, closed signed attestation, baked public verifier key, and no VM private/signing key match the cheapest fix. |
| B2 | ADDRESSED | 2229–2246, 2347–2444, 2486–2507 | Closed manifest, stem=id=commit, exact ref, trusted-head parent chain, safe modes, topology, quarantine, and desktop approval are present. Outer multi-item code remains incomplete; see new breakage. |
| B3 | NOT-ADDRESSED | 2668–2684, 3011, 3199, 3370, 3684–3754 | Some reports are emitted, but not every REQUIRED key has a signed producer. Task 25 verifies no signatures; `verify_inventory` accepts extras/duplicates; final digest is unsigned. |
| B4 | PARTIALLY-ADDRESSED | 1709–1828 | Quiescence, service stop, fsck, invariants, isolated boot, and canary are specified. Export omits the test’s lock action, and Task 24 does not implement the consumed restore canary. |
| B5 | NOT-ADDRESSED | 3530–3669 | Interfaces/tests mention receipts and recovery, but implementation still reconstructs `sourceTurnId === card.id`, emits report v1, lacks supervisor/claim code, and uses an environment bearer. Real bridge synthesis is incompatible. |
| B6 | PARTIALLY-ADDRESSED | 1218–1345, 3017–3368 | Required states, queue cancellation, drains, readiness queue count, and cgroup check appear. They are not wired to the real `ExecutionLatch.lock()`, and bridge/route interfaces are incomplete. |
| M1 | ADDRESSED | 1922–2018, 2424–2444 | Rejects symlinks/junctions across path components and modes 120000/160000 during promotion. |
| M2 | ADDRESSED | 1426–1439, 1625–1662 | Uses `systemctl show`/`cat`, rejects drop-ins, and checks effective identity, command, environment, KillMode, cgroup, and filesystem policy. |
| M3 | PARTIALLY-ADDRESSED | 2711–2738, 2817–2832, 2874 | Port is corrected to HTTPS 443, but code accepts any HTTPS hostname on 443 rather than the exact normalized Serve endpoint. |
| M4 | ADDRESSED | 321–364, 493–508, 678–769 | Closed AJV schema validates required fields, types, state, action, risk tier, and unknown fields before startup. |
| M5 | ADDRESSED | 779–791, 901–1039 | `baseRef: ops` must equal activation HEAD; remote and credential identity are honestly labeled recorded-not-enforced until Phase II. |
| M6 | ADDRESSED | 2229, 2444–2465 | Promotion uses fresh clones and does not mutate/reset the operator checkout. |
| M7 | ADDRESSED | 2398–2401, 2408–2429, 2602–2648 | Parent-chain ordering replaces timestamp ordering; malformed/noncanonical time fails closed. |
| m1 | ADDRESSED | 112–268 | Reconciliation tests use the shared Windows/Linux Python resolver at every named call site. |
| m2 | ADDRESSED | 2917–3011 | Evidence binds Node/Python realpaths and versions through the raw-output digest. |
| m3 | NOT-ADDRESSED | 3530, 3555–3556, 3658–3667 | Choice/interface say FD/stdin, but code and command still use `KB_CANARY_SESSION` and `sudo --preserve-env`; no residual-risk ruling is recorded. |

## New breakage

CRITICAL

- Task 25 still calls the deleted checksum deployment interface at line 3760. Task 12 requires `ARCHIVE ATTESTATION --signing-key PATH --host HOST` at line 1370.
- Task 21 calls Task 22’s limiter before Task 22 exists, so Task 21 cannot compile green in plan order: lines 3178–3193 versus 3203–3368.
- Task 21 changes nonexistent `ActivatedExecution.lock()` at line 3042. The real owner is synchronous [`ExecutionLatch.lock()`](C:/Users/danie/kb-worktrees/boss-2026-08-11c/dashboard/server/control/activation.ts:588), and the real lock route is omitted from Task 21’s Files block.
- A bridge receipt cannot be durably written before execution using Task 24’s files. Real [`executeApprovedLaunch`](C:/Users/danie/kb-worktrees/boss-2026-08-11c/dashboard/server/control/launch.ts:296) starts `runAutomatic()` before returning `runRef`; the bridge receives it afterward.
- `LinuxCanaryReport` is version 2 at line 3551, but `decideCanary` returns version 1 without receipt/claim digests at lines 3621–3627. Task 24’s commit command also omits most files named in its Files block.
- Gate 2 consumes `/var/lib/kb/backup-reports` and `runtime.json` at line 3762, but no task produces them. Tasks 20–22 emit separate `KEY.json` files; Task 13 writes desktop-temp reports.

IMPORTANT

- `BackupReport` requires fields with no concrete persisted producer; `restore_drill`, `safe_extract`, invariant helpers, and `make_report` are not implemented in code at lines 1724–1828.
- Promotion calls undefined `order_from_parent` at line 2534 and derives its starting parent from lexically ordered `manifests[0]`. The shown loop promotes an undefined singular `manifest` and tests only one item.
- Task 12’s test calls `activate_from_upload(upload, paths, io)` at line 1409, while implementation accepts only two arguments at line 1511.
- `bridge.stopped` is consumed at line 3197 without a produced getter/interface. `runTick()` also does not preserve the existing public `tick(): Promise<QueueBridgeTickResult>` contract.
- Core security behavior is prose-only: receipt/recovery supervisor, Gate 2 signature verification, promotion helpers, restore drill, evidence CLI/parser, and async latch/route wiring.
- Failing-test-first coverage is incomplete for evidence signatures/extras/duplicates, exact Serve hostname binding, final-file symlinks, release staging ownership, and valid/mismatched instruction signatures.

MINOR

- Task 21 preserves same-key registration-wins semantics, but drops the real registry’s delete-before-cancel behavior at lines 3131–3132.
- `InstructionApproval.chainDigest` hashes only instruction manifests although its endpoints describe the full chain, lines 2497–2501.

## Integrity statements

- Scope integrity: **FAIL** for the explicit no-VM-credential ruling. Lines 16, 35, 1595–1599, and 1684 install a persistent HMAC authentication secret; lines 2677/2882 and 3667 put session bearers in VM process environments.
- Phase integrity: **PASS**. No Phase II/III physical split, staging repository, GitHub App, direct VM publication, multi-root execution, or media exile was added.
- Trust anchors: **PASS for external authority**. Signing/private keys remain desktop-side; the VM receives only public verification material, and GitHub/backup credentials remain absent.
- Checkpoint integrity: **PASS** at lines 892–899. It requires the actual workflow-platform merge-base to be on `origin/main` and at or after `804acec`; ancestry alone is insufficient.
- Cutover wording: **FAIL at line 22**, which incorrectly says Gate 1 establishes the execution plane; the authority spec assigns that to Gate 2.
- Earlier fixes: register overwrite semantics, tailnet derivation, `createPtyHost`, and the Git reentrancy test survived. Global Constraints survived textually but not intact: the new HMAC-secret exception weakens the credential constraint.
- Format: no forbidden placeholder phrases, but the concrete-code and complete failing-test-first requirements fail.

Checkpoint: [rereview-checkpoint.md](C:/Users/danie/AppData/Local/Temp/claude/C--Users-danie-kb/11fdfac9-c43f-46cc-bda2-977339b37234/scratchpad/rereview-work/rereview-checkpoint.md:1).