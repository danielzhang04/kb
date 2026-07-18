---
id: 6a5bfcbe-f2ebf4ac
project: kb-ops
action: implement:dashboard-managed-workflows-waves-b-d
target: dashboard/ and docs/plans/2026-07-18-dashboard-*.md
risk-tier: T2
owner: codex-worker
claim-token: e381966ea5b2a95b
state: inbox
approval: null
workflow: null
depends-on: []
variant-group: null
role: work
session-id: null
runtime: claude
model: claude-sonnet-5
---

Continue codex/dashboard-operational-surfaces from d1bf5d3.
  Ultimate product goal:
  Build a local operations console where the operator can describe a complex project
  in a Claude-managed conversation; review and approve an immutable compiled plan;
  start governed automatic execution with one action; reconnect to and inspect the
  Manager, workers, sessions, tools, commands, files, artifacts, and diffs; steer
  Attempt/ManagedSession/event projections, logical Manager head, and synthetic two-
  stage acceptance.
  2. Wave C: normalized public operational events, durable background ownership and
  cursor replay, Runs cockpit, safe checkpoint steering, and revision-bound Human
  Requests shared by Runs and Human Inbox.
  3. Wave D: executable governance and project-contract policy, fixed server-owned
  Claude/Codex profiles, isolated per-run worktrees, bounded concurrency, skills/
  capability resolution, accounting, canonical result integration, dependent
  release, manager recovery, and inventory/dry-run/quarantine/restore retention
  workflow.

  Preserve canonical queue cards as coordination truth. App-local state remains a
  projection outside git. Do not expose hidden reasoning, raw tool payloads,
  provider capabilities, credentials, arbitrary CLI flags, environment, permission
  bypasses, or browser-controlled execution capabilities. Do not activate the
  Use tests-first vertical slices, full verification and adversarial review at each
  wave boundary. Preserve existing functionality without redundant parallel paths.
  Update HANDOFF.md at completion. Do not deploy; deployment requires a separate T3
  WebAuthn-approved action.