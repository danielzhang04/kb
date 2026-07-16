# Invariant re-audit — Codex Phase B (Human Gate 5.9)

**Date:** 2026-07-16 · **Decision:** PR path (Daniel) · Recorded by boss session
**Invariant (ordering-law 4):** no agent environment holds a `Contents: write` / REST-API /
PR-write GitHub token — git-transport only.

## Result: PASS (by construction)

Phase B introduced **no new credential and no ruleset change**. The gate-5.9 decision replaced
the plan's literal "scoped ops-push deploy-key grant" with the PR path: `agent_runner.ps1` pushes
its per-run `codex/<agent>-<ts>` branch over the existing Phase-A deploy key; the PR into `ops`
is opened/merged by a human or the cloud leg. Therefore:

- The `codex-worker` env still holds exactly what the 5.8 audit verified: SSH deploy key only,
  no REST/PR-write token, no `gh`, no API-key env vars
  (see [2026-07-16-codex-phase-a-invariant-audit.md](2026-07-16-codex-phase-a-invariant-audit.md)).
- The `protect-ops-main-from-workers` ruleset still blocks the deploy key from direct
  `ops`/`main` pushes (deploy keys are not on the bypass list).
- The runner gained a branch-push step only — it opens no PRs and merges nothing
  (no capability to do either exists in its env).

Registration of `codex-worker` in `governance/agent-rules.md` (item 7) is Daniel's commit on
`main` per docs/proposals/2026-07-16-codex-worker-registration.md; its task types start
queues-for-me until the grade ledger promotes them.

Referenced by the Wave-5 exit.
