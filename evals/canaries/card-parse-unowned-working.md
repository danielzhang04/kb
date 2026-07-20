---
id: card-parse-unowned-working
capability: card-parse
judge: deterministic
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  mode: transition
  from_state: inbox
  to_state: working
expected:
  ok: false
  error_contains: unowned
---

# Canary: starting an unowned card is refused

Dispatchers assign owners; an agent may never self-claim. Transitioning an
ownerless card `inbox -> working` must raise `ValidationError` ("cannot start
working an unowned card"). Guards the single-dispatcher invariant.
