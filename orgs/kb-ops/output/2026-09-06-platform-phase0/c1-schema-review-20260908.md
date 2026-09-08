# DRAFT — C1 attempt-operation schema review, 2026-09-08

Reviewer: `codex-worker` (independent; did not author the implementation)

Technical verdict: **READY**

This review covers only the uncommitted C1 schema and boot-migration changes on
`codex/kb-vm-overhaul-resume-20260907` at committed base
`2b323531008419b3d87dfbbb312bc8cdc381c041`:

- `dashboard/server/pty/contracts.ts` and test
- `dashboard/server/pty/sessionPersistence.ts` and test
- `dashboard/server/pty/sessionMigration.ts` and test
- `dashboard/server/pty/sessionRecord.test.ts` (`sessionRecord.ts` was read as unchanged context)
- `dashboard/server/control/attemptSessionAdapter.ts` and test
- `dashboard/server/control/attemptVertical.integration.test.ts`
- `dashboard/server/http/surface.test.ts` (`surface.ts` was read as unchanged boot-path context)

The C1 implementation has no remaining correctness or security findings. Current
v3 persistence requires `messageClaim` and validates its exact three-key shape,
bounded control-free claim reference, and two SHA-256 fingerprints. The compatibility
decoder accepts only exact pre-C1 v3/v2 attempt rows at the boot migration
boundary, normalizes them to `messageClaim: null`, and then runs the strict
current validator. Malformed, partial, extra-key, and mixed-shape rows fail
closed without changing the source. Ordinary persistence remains strict-current.

The unchanged session registry uses structured clones on reads and CAS writes,
so the nested claim survives without sharing mutable caller state. Existing
record transitions clone/carry the field, terminal retention keeps the complete
row, and all current C1 record literals were updated. The real production
persistence constructor is reached through the awaited `onReady` migration hook;
the new surface regression proves an old v3 row is migrated before the registry
read and emits no registry warning.

Security review mapped the only new trust boundary as the known state-root JSON
file into the strict decoder and atomic migration publisher. No browser-supplied
path, command, network destination, credential, authorization expansion, or new
public DTO is introduced. Backup, fsync, validation, rename, restore, and bounded
error-report behavior remain intact.

Two low-severity review comments were corrected before this verdict. A replayed
current v3 document now reports `.v3.bak` before older v2/v1 backups, and a
conflicting pre-existing v3 backup is named accurately while both source and
backup remain byte-identical. Regression tests cover both cases.

Independent verification:

- `python scripts/preamble.py` — PASS (`PREAMBLE OK`)
- Initial seven-file focused gate — 7 files, 229 tests passed
- Final seven-file focused gate after the one added backup-conflict regression —
  7 files, 230 tests passed
- `npm.cmd run typecheck` — PASS (`tsc --noEmit`)
- `git diff --check` over the 11 C1 files — PASS
- Branch divergence from its configured origin at review close — `0 0`

The PowerShell `npx` shim was blocked by the host execution policy, and the first
`.cmd` test attempt was blocked by sandbox denial of Vite's temporary config
write under the linked `node_modules`. Running the same focused command outside
that sandbox completed green; neither was a product-test failure.

Excluded from this verdict: the work-order documentation diff, D1 ledger design
files, C1 claim delivery/ownership/adoption behavior, B activation and route
wiring, D canonical/ledger integration, Slice 1A acceptance, merge, deployment,
and overall Phase 0 acceptance. There is no formal inspector grade. Actual model
and cost telemetry were unavailable.
