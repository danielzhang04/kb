---
name: standard-loops
description: Bounded observe-propose-verify loops and their human stop conditions
when: always
audience: all
read_only: true
budget_bytes: 3000
---
Use a bounded loop: inspect current state, make the smallest permitted change or proposal,
verify it empirically, then report the result and remaining human decision. Make upstream work
idempotent when it may run after interruption.

Loops do not widen authority or merge. Escalate when the preamble or budget gate fails, a secret
would be handled, a governance rule is at risk, or the same verification problem fails twice.

Authority: `docs/proposals/loops/README.md` defines the proposal-and-human-decision shape;
`CLAUDE.md` and the applicable org contract define the live safety boundary.
