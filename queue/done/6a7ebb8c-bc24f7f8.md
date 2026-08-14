---
id: 6a7ebb8c-bc24f7f8
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-2026-08-11c
risk-tier: T1
owner: codex-worker
claim-token: cee61d0406702c23
state: done
approval: null
workflow: 019fff02-515f-76c2-891d-37f7ae255f21
depends-on: []
variant-group: null
role: work
session-id: 6a7eb8e7-4b90ea03
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Fix dispatch — Task 19 review findings (G1-G4 gating; M1, M2-ruled, M3, m1-m4)

Fresh fixer for the reviewed-but-uncommitted Task 19 work (scripts/gates/phase1_gate1.py md5
dd343a3026c383140d46957661250d04, tests md5 c6263e246778b975d2534bb04fc6041c — verify these
FIRST; a mismatch means the tree moved, STOP and report). Work ONLY inside
`C:/Users/danie/kb-worktrees/boss-2026-08-11c`.

AUTHORITY: the line-exact FIX SPECS in
`.superpowers/sdd/2026-08-11-kb-structure-phase1/task-19-review.md`. Context: task-19-brief.md,
task-19-dispatch.md + -r2.md (rulings binding), task-19-report.md.

Apply exactly:
- G1: `confined` per the review's spec — derived from real confinement evidence, never from
  comparing two copies of the same URL.
- G2: serve-status parsing survives Serve-unconfigured / TCP-only / Services-without-Web
  shapes with a clean serveTailnetOnly=False (or fail-closed False), never a KeyError abort;
  cover all three shapes red-first.
- G3: verify_inventory asserts the EXPECTED finalized file set (UNSIGNED_GATE1_FILES ∪
  control files ∪ signatures — per spec), not just disk-consistency.
- G4: verify inspects the DECISION (envelope passed + gate1.json decision.passed per spec);
  a signed FAIL package exits nonzero with a named reason; success prints a one-line
  affirmative summary.
- M1: finalize signing subprocess gets the 30s timeout + stdin=DEVNULL shape.
- M2 (BOSS RULING, plan defect #17 — the evidential raw-bytes principle is the plan's own):
  add acl-authorized.txt, acl-denied.txt, readyz.json to UNSIGNED_GATE1_FILES and the
  collector's raw write_package map so aclAuthorized/aclDenied/executionLocked are
  re-derivable from retained bytes. Schemas unchanged (Task-20 contract untouched); the
  inventory simply carries three more rows.
- M3: the redirect test exercises the SHIPPED opener (not a reimplementation).
- m1: the no-redirect opener also ignores ambient proxy env.
- m2: late collector failure leaves a retry-safe package dir per spec.
- m3: route_inventory_covered refuses an empty test run.
- m4: desktop non-regular-entry guard per spec.

PROCESS DISCIPLINE (binding, new): when your report is written you are DONE — no further
edits of any kind after the report lands (a prior worker's post-report self-edits landed
under a live review; good content, wrong sequence — bake improvements in BEFORE reporting).

Rules: red-first per finding where a spec adds/changes tests; TEMP/TMP redirected;
`python -m pytest tests/test_phase1_gate1.py -q` narrow; py_compile; no commit/add/stash;
never touch .env/_private/; no real tailscale/network.

Report: APPEND "## Fix round" to task-19-report.md — per-finding conformance, red→green
exact counts, final md5 of both files. Final message: STATUS + one-line summary.

## Result

STATUS: IMPLEMENTED

Fixed G1–G4, M1–M3, and m1–m4; focused suite passes 39/39 and the required fix-round report is appended.
