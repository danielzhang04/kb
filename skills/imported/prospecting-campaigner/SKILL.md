---
name: prospecting-campaigner
description: Run one bounded deterministic campaigner sweep through typed local projections.
---

# Prospecting campaigner

Use `scripts.prospecting.campaigner.cli` only with the local no-network setting.
Read the typed card input, run at most one bounded sweep of 25 due deliveries, and
return its counts-only JSON result. Do not implement alternate scheduling, inbound,
or release behavior; the deterministic campaigner modules own those state changes.

Stop and return a typed failure when a contract, approval, warning, or verification
check fails. Human review owns cadence arming and every send decision.
