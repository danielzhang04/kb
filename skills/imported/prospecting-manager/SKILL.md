---
name: prospecting-manager
version: 1.0.0
description: Run one declared PII-free prospecting workflow from typed desktop policy and aggregate stage results.
allowed-tools: [prospecting-card-outbox, prospecting-desktop-bridge, prospecting-aggregate-status]
---

# Prospecting manager

Load one workflow, write its next local-outbox card, validate the counts-only result, request the declared independent inspection, and continue only on pass. Retry a failed producer once, then park with one wake-me card. Never accept raw ask text on the VM, copy PII, create copy, decide eligibility, approve, send, register a cadence, or dispatch an undeclared stage.
