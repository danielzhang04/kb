# Bind planned runs to the selected cost ledger

The Figment CLI previously embedded its source checkout's `ledgers/cost` in every
planned harness command. A read-only comparison on September 9 found $19.397146
in that Studio checkout versus $38.248267 in the reconciled OPS proposal ledger.
A future run using the former could undercount the existing $50 experiment cap.

`plan` and `train-first` now accept `--ledger-dir`. Both resolve the selection once
through the existing harness resolver: explicit argument, `KB_LEDGER_DIR`, existing
managed OPS directory, then repository fallback. The absolute result is saved in
`plan.json` and every harness argv. Execution reconstructs the expected command
from that frozen value, validates the recorded command before launching, and uses
the same ledger for receipt reconciliation. Changing the environment after planning
does not switch that plan's ledger.

The harness's accounting, cap enforcement, lease and teardown code are unchanged.
Existing plans are not migrated. Use a fresh plan with the explicit canonical ledger
in the [operator runbook](2026-09-09-operator-runbook.md); do not hand-edit or replay a
historical plan tied to a stale ledger. The current managed OPS fallback has no
Figment baseline, so the unchanged live harness refuses it rather than assuming zero.

## Verification

- A new regression gives the reconciled ledger $49 and the stale environment ledger
  $1. Both planning entry points bind the explicit reconciled path; the real harness
  refuses a $2 estimate against it, while the stale ledger would allow the estimate.
- Existing train-first execution and repeated-stage lineage tests now use the public
  ledger parameter instead of patching the old module constant.
- Author's three focused cases passed in 2.11 seconds; independent review reran them
  successfully in 1.88 seconds and returned READY after checking all planner and
  execution call sites, CLI help, compatibility and unchanged harness boundaries.
- Root's full two-module regression passed **73 tests in 167.86 seconds**. CLI help,
  compilation and diff checks also passed. These checks use local fixtures and do not
  create a pod, upload a reference, fabricate an approval or spend money.
- The final train-first-to-generation and approved-generation-to-video integration
  checks both passed after the ledger change: **2 tests in 34.20 seconds**. The
  unchanged harness SHA-256 remains
  `1171547dc9b8abfb9251e08ae53effc50c4dbe60359bdc40a720bae7dbe23f48`.

The separate Qwen launch remains blocked by automatic approval review pending the
exact payload/account answer. Fixing local plan accounting does not clear that block.
