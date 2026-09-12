# Transient development VM recovery acceptance

Source: `dev_vm.py`, its lifecycle tests and `orgs/prospecting/dev-vm.md`.
Verified Claude workers produced the proposals: Opus for lifecycle repair/review,
Sonnet for the narrow expired-receipt transition. Root reviewed and applied exact
allowlisted proposals after checking their input hashes. Final independent Opus
source review returned PASS. Workers did not execute tests.

Collection now requires the entire local output tree to match the current response,
including files omitted by that response. Cleanup cannot infer absent units from an
absent directory. The lease verifies worker state, cgroup and owned marker before
removing its exact tree, clears the failed worker state and lets its timer unload.
A disconnected terminal can finalize a `started` receipt only after remote proof
that the directory and all three units are absent. This path cannot stop or delete
a still-present, uncollected job.

Verification performed by root:

- Final focused suite: 45 passed and 40 subtests passed in 2.09 seconds.
- New initial regression cases against accepted old source `163a853b`: 10 failed,
  31 passed and 19 subtests passed. The failures demonstrate the original stale
  collection and incomplete-cleanup defects.
- Live synthetic timeout, with a 10-second runtime and 60-second collection window:
  timeout recorded, failure evidence collected, lease reclaimed the exact directory,
  worker service and both lease units became not-found/inactive/dead. Public cleanup
  returned already-absent and saved a cleaned receipt.
- Second live timeout intentionally missed collection. The untouched started receipt
  recovered through public cleanup after lease expiry. Independent SSH inspection
  again verified the exact directory and three units absent.

Both live cases used source-only synthetic inputs and no model call. Their desktop
receipts retain resource identities and failure metadata. These observations establish
the tested lifecycle on the existing VM, not persistence across reboot or universal
absence of OS/provider traces.

The existing diagnostic collection size cap can refuse oversized stdout/stderr.
Those bytes are not silently truncated or accepted; the lease and expired-receipt
recovery remain available. Proposal execution, source application and publication
remain separate decisions. The current Claude proposal orchestration is a separate
bounded source-only workflow; this review does not claim new Claude-mode support in
the production VM runner.
