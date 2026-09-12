# regrounding hook test fixture — NOT read by any hook at runtime

Stand-in file for tests/test_regrounding_hook.py's `KB_GOAL_STATE_PATH` override tests. Replaces
the deleted dead U7 GOAL-STATE plan (formerly under `docs/plans/`, 2026-09-11 token-discipline
cleanup, Task 6) — content is arbitrary; only the heading shape (`## North star`, `##
Invariants`) matters, since that is what `scripts/hooks/regrounding_hook.js`'s
`WANTED_SECTIONS`/`extractSection` reads.

## North star
Fixture north-star text for tests only.

## Invariants
Fixture invariants text for tests only.
