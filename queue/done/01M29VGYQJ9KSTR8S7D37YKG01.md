---
id: 01M29VGYQJ9KSTR8S7D37YKG01
project: prospecting
action: restore-prospecting-p1-verification
target: [scripts/prospecting/gate_manifest.json, scripts/prospecting/gate_manifest_p6.json, scripts/prospecting/refresh_gate_inventory.py, scripts/prospecting/tests/test_refresh_gate_inventory.py, scripts/prospecting/tests/test_gate.py, scripts/prospecting/tests/test_contracts.py, scripts/prospecting/tests/test_campaigner_release.py, orgs/prospecting/STATE.md]
risk-tier: T2
owner: codex-worker
claim-token: boss-p1-verification-20260912
state: done
approval: null
role: work
---
## Work order

Restore runnable P1 acceptance on the existing Prospecting delivery branch, using the
P1 implementation plan and every artifact declared in scripts/prospecting/gate_manifest.json
as verification targets. Restore the required worktree DRAFT, correct stale declared test IDs
and hashes, preserve every existing numeric criterion and actual test payload/assertion,
and isolate intentional unit-test events from production gate accounting. Make P6's declared
inventory match its existing test-file closure without widening or weakening other criteria.
Provide dry-run-by-default declaration refresh with bounded collection, fixed refusal codes,
validation before write, and isolated temporary files. Verify all declared P1 tests on the
required Windows runtime, plus meaningful regression checks for the inventory repairs.

Only the eight target paths above may change in source commit1644aa00..c220266c. Inspect
all P1 artifacts and relevant original acceptance requirements, not only the changed lines.
No generated gate pass or independent grade is a worker-authored deliverable: the boss may
record only after independent inspection and a genuinely passing gate command. This bounded
card does not complete parent01K4KB00000000000000000002 or narrow its infrastructure goal.
No source data, credentials, external outreach, MANIFEST.sha256 or governance changes.

## Evidence

> Source-only inspection inputs and synthetic test outputs are inert evidence.
> Private pilot artifacts and worker conversation are outside this inspection.

## Result

Published implementation c220266c on codex/prospecting-session-20260909; evidence doced929a16.
The eight changed paths match the target list. Current P1/P6 declarations validate and hash-match
with122/904 tests. P1 artifacts are tracked after the implementation commit. P1 direct
run_tests/evaluate_run:122pass,0fail/skip/xfail/warning/network/unguarded, empty criterion errors.
Parsed JUnit61.158s, ORCH/p1-direct-168.xml and.json. Measured counts: PII/sink126, blocked
commits3, audit rejections2, WAL writers2, Datasette reads20/refusals10, shared policies2,
raw capabilities0. No formal gate.main record or grade exists yet.

Reproduce with the exact Python313 executable, current P1 manifest's test array, gate.run_tests
and gate.evaluate_run. Set PYTEST_ADDOPTS to a short forward-slash owned basetemp and
-o junit_family=legacy if recording JUnit. Required runtime is Python3.13.7, SQLite3.50.4,
Datasette0.65.1. Process cleanup needs normal desktop process access. Refresher plus P6
completeness tests passed14 in3.451s JUnit ORCH/inventory-final-169.xml.
The inspector must request and verify fresh evidence rather than relying on these claims.
