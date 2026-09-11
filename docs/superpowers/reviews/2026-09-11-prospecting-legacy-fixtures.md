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

Stale recorded P1/P6 gate and inventory evidence remains a separate known limitation.
Passing these mechanics checks does not claim those recorded gates are current.
