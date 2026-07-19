---
id: card-parse-illegal-transition
capability: card-parse
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  mode: transition
  from_state: done
  to_state: working
  owner: worker-desktop
expected:
  ok: false
  error_contains: illegal transition
---

# Canary: an illegal state transition is refused

`done` is terminal. Walking a card back from `done` to `working` must raise
`ValidationError` ("illegal transition"). Guards the queue state machine
(`cards.LEGAL`) against out-of-order moves.
