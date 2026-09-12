# Legacy fixture reconciliation

Five older mechanics tests now isolate the editorial-readiness prerequisite they were
never built to exercise. The patches are local to those tests: send/draft idempotency,
mailbox warning, ten-touch fake cadence, scheduler caps and unregistered Gmail send.
No production readiness guard or broad fixture was weakened. The unchanged actual-chain
integration still proves that an unready revision cannot queue a send.

The runtime signature contract includes the existing optional clock parameter on
attach_campaigner. Two draft evaluation cards point to the current tests that actually
exercise their stated behavior: no disk changes during dry run, and twenty stable drafts.
These are draft references only; recorded manifests and gate records were not blessed.

Root reviewed the exact Claude repairs82/87 and contract change33. Final focused group:
9 tests passed in16.89s, including current runtime signatures, draft target inventory,
all repaired mechanics and the unchanged real readiness integration. Prior static import
boundary checks are included in the selected/native320-test acceptance.

The former caveat about stale recorded P1/P6 gate and inventory evidence is historical.
Current P1/P6 status is recorded in
`docs/superpowers/reviews/2026-09-11-prospecting-final-verification.md`: the P1 inventory
declares 122 tests and an actual gate pass of 122 with a genuine independent inspector
score of 95, and gate record 67218ba5 is now verified with `--verify-recorded`
matched:true. The P6 inventory of 904 tests validates and matches its source hashes; no
generated P6 gate record exists and no agent has blessed the recorded evaluation
manifests. Passing these mechanics checks still claims nothing about those gates; it only
points at the current verification record and its stated limits, including the gate run
without `--strict-allowlist`.
