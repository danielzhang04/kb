---
id: 6a7eabdc-4ef9208d
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-2026-08-11c
risk-tier: T1
owner: codex-worker
claim-token: 6eb57b2cb24c2ea3
state: done
approval: null
workflow: 019ffecb-f0bd-7421-88c7-ae7353b9750a
depends-on: []
variant-group: null
role: work
session-id: 6a7eaafc-ffc71662
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Implementer dispatch — Plan Task 19: Gate-1 evidence package collector/finalizer/verifier

Fresh implementer for one task of the KB Structure Phase I plan (scripts/gates/phase1_gate1.py:
closed canonical JSON evidence envelopes + Markdown index; VM collects UNSIGNED (no key on the
VM, ever); trusted desktop signs envelopes, approval, and the final inventory digest; verify
CLI re-checks everything; collector never modifies Tailscale config). Work ONLY inside
`C:/Users/danie/kb-worktrees/boss-2026-08-11c`.

READ THIS FIRST — requirements, exact code/tests verbatim:
`.superpowers/sdd/2026-08-11-kb-structure-phase1/task-19-brief.md`

Landed context:
- Tree at 30a05949 (CP2 closed). Signature machinery precedents you MUST match: T17's
  signature-before-parse ordering + anchored ssh-keygen output parsing (plan defect #14
  ruling — scripts/promote_vm_outbox.py is the reference implementation); T13's canonical
  closed-JSON writer (ensure_ascii byte-compatible; scripts/backup_tier0.py). Reuse shapes,
  don't reinvent; a contradiction between the brief's snippets and those precedents → STOP,
  NEEDS_CONTEXT (16 plan defects so far).
- /readyz is loopback header-less (CP2 G8): the collector's probes must send
  production-shaped requests (the CP2 systemic rule: test with the bytes the production
  caller sends, under the env the production unit sets). Your tests must too.
- Session for authenticated probes arrives ONLY via the named process-env key
  (KB_GATE_SESSION) — never argv, never a file, never logged; treat as ambient credential
  (use, never print/persist).
- Task 20 will consume EvidencePayload and port your closed checks to TypeScript — the
  schema you ship is a cross-task contract; keep it exactly the brief's.
- Live VM/tailnet/Daniel-approval checklist items are OUT of scope (banked for the gate
  ceremony). Implement + test with injected runners/fixtures only.

Process (TDD, brief's order): red-first narrow `python -m pytest tests/test_phase1_gate1.py
-q` (TEMP/TMP redirected to a fresh OS-temp child); smallest green; py_compile; then the
root suite ONCE (expect CP2-classified state: Atlas ModuleNotFoundError class + 1 deselect,
WinError-1314 skips, nothing new). No commit/add/stash. Never touch .env/_private/.

Report: write `.superpowers/sdd/2026-08-11-kb-structure-phase1/task-19-report.md` (APPEND if
exists): red→green with exact counts, schema-conformance note vs the brief's interfaces,
signature-ordering conformance note vs T17, the banked live-VM command list for the gate
window, self-review. Final message: STATUS + one-line summary.

## Result

STATUS: NEEDS_CONTEXT

Task 19 stopped because its verifier snippets contradict the binding T17 signature-before-parse rules; details are in [task-19-report.md](C:/Users/danie/kb-worktrees/boss-2026-08-11c/.superpowers/sdd/2026-08-11-kb-structure-phase1/task-19-report.md).
