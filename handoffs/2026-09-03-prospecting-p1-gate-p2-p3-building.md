# Handoff — prospecting project: P1 at human gate; P2/P3 building; P4-P6 planned (2026-09-03)

Scope: boss session `claude/boss-2026-09-02` (session 01E1xjyBzKPkstdG9G8R8FEj), codex-only workers.

## State
- Spec r3: `docs/superpowers/specs/2026-09-02-prospecting-design.md` (boss branch). Plans v2: P1, P2, P3; v1: P4 (patch in flight), P5 (patch in flight), P6 (review in flight). All on `claude/boss-2026-09-02`.
- P1 BUILT + phase-reviewed + verified; host gate recorded 114/114 (`orgs/prospecting/gate-results/P1.json`), branch `claude/prospecting-p1` @ cc85675e in `C:/Users/danie/kb-worktrees/prospecting-p1`. Multi-phase gate runner: `gate --phase Pn` loads `gate_manifest_p{n}.json`; `--record`, `--verify-recorded`, `--strict-allowlist` (phase close only; union of manifests).
- **HUMAN GATE (Daniel): P1** — run `scratchpad/prospecting/p1-gate-demo.ps1` (Datasette on empty store at 127.0.0.1:8765; branch pre-commit hook blocks a planted email — run via the script; the worktree still dispatches main's hook until merge). Reply "P1 pass".
- P2 (list-builder) `claude/prospecting-p2` @ 57e550c9 (+): tasks 0-5 committed; T6 fix, T7 review, T8 (LinkedIn assisted lane, Playwright 1.49.1 preinstalled) in flight; T9-T11 next.
- P3 (personalizer) `claude/prospecting-p3` @ 33840086 (+ merges): tasks 1-9 committed (skill `skills/curated/prospecting-personalizer`, 8 draft eval cards); T10 (P3 gate) in flight.
- Per-task loop: build → read-only review → fix → boss runs suite on host → commit. Briefs in session scratchpad `prospecting/briefs*/`; launcher `run-task2.ps1 -Phase pN -Task N -Kind build|review|fix`; generator `gen_task_briefs.py`; manifest regen `regen_manifest.py`.

## Rulings made (do not reopen)
Own sequencer, rent data (Hunter/Snov + PDL spot + Apify class-C; Apollo excluded); desktop=executor, VM=orchestrator over Tailscale SSH; PII never in git/cards/VM; gate results are committed artifacts; per-phase manifests; parametrize ids never carry PII-like literals; cadences human-authored on main (agents deliver text only); approval tier ≥1 only via kb WebAuthn primitive.

## Hazards learned
Codex sandbox lies about host env (py3.12/no Datasette) → verify on host; harness kills long shells → Start-Process + Monitor (re-arm past 60 min); stagger launches ≥20 s (auth probe crash); codex backend 404 outage ~30 min on 2026-09-03 (health probe = minimal `codex exec`); worktrees inherit main's hooksPath; sandbox leaves ACL-locked tmp dirs (info/exclude); git hook stdout→stderr.

## Load on resume
this file; `memory/claude-boss.md` (2026-09-03 section); spec; plans P1-P6; `orgs/prospecting/STATE.md` (draft, p1 worktree); scratchpad `prospecting/briefs*`, `*.out` logs.
