# Outbox drain: resuming a receipted-but-unreconciled chain

Applies to `scripts/promote_vm_outbox.py` (desktop) and `deploy/apply_ops_reconciliation.py`
(VM). See those two modules' docstrings for the code-level version of this note.

## Symptom

You ran promotion mode and it printed `nothing to promote` and exited 0, but you know the last
run pushed bundles onto `origin/ops` and uploaded receipts to the VM. Nothing looks broken, but
the VM's ops checkout was never reset to the reconciled target.

## Why this happens

Promotion (`promote_pending`) and reconciliation (`create_return_bundle` +
`upload_and_apply_reconciliation`) are two separate legs of one drain, joined by receipts.
`apply_ops_reconciliation.py` installs every returned receipt onto the VM's spool durably
*before* it checks whether the reconciled range is safe to apply. If that later check fails --
most commonly "reconciled ref contains a non-coordination path", meaning `origin/ops` carried a
commit outside the reconciler's allowlist somewhere in the reconciled range -- the VM apply
exits non-zero, but the receipts it already wrote stay on disk. The VM's `ready/` directory and
the ops checkout are left exactly as they were: every chain item receipted, nothing archived to
`promoted/`, HEAD unmoved.

## What to do

Nothing manual. `promote_vm_outbox.py main()` auto-detects this state on its own: if every
bundle in the fetched snapshot already carries a promotion receipt and `ready/` is still
non-empty, it treats the spool as "receipted but unreconciled" and resumes straight into
`create_return_bundle` + `upload_and_apply_reconciliation` instead of re-promoting or exiting
early. Just re-run promotion mode the normal way.

If the underlying cause was a bad commit on `origin/ops` (an allowlist violation), fix or
revert that commit on `ops` first -- the resume re-derives its reconciliation target from the
current `origin/ops` tip, so once the offending commit is gone from the reconciled range, the
next resume run's `create_return_bundle` produces a clean target and the VM apply succeeds.

## Operator flag

`--reconcile-only` forces this same resume leg explicitly and fails closed (raises) if the spool
is not, in fact, fully receipted -- useful for confirming the state before re-running, or for
scripting the resume without relying on auto-detection.

## Safety

Nothing in the resume leg deletes or mutates `spool/receipts` on either side. A resume that
fails again (VM apply still refuses) leaves the spool byte-for-byte as it was, so the drain can
be retried as many times as needed once the root cause is fixed.
