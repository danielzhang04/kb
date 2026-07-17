# Proposal — register `codex-worker` in governance (Human Gate 5.9)

**Status:** proposal only. Daniel commits this on `main`; agents cannot write under `governance/`.

## Exact edit — `governance/agent-rules.md`

Append as item 7:

```
7. Registered non-Claude workers: `codex-worker` (Codex CLI, desktop tier, onboarded
   2026-07-16). Identity per rule 2 (`codex-worker` / `codex-worker@agents.local`). Git
   access: Phase-A SSH deploy key, git-transport only — work lands on `codex/*` branches;
   coordination writes reach `ops` ONLY via PR (the `protect-ops-main-from-workers`
   ruleset; gate-5.9 decision) opened/merged by a human or the cloud leg. All its task
   types start queues-for-me until the grade ledger promotes them. Gemini: deferred
   (see security-rules.md note).
```

## Why the PR path (gate-5.9 decision, Daniel, 2026-07-16)

The plan's literal "grant the scoped ops-push deploy-key path" predates the 5.8
`protect-ops-main-from-workers` ruleset, which deliberately blocks non-admin direct pushes to
`ops`/`main`. Adding the deploy key to the ruleset bypass would re-open the hole 5.8 closed
(a compromised worker rewriting queue/ledger state unattended). Instead, `codex-worker`'s
coordination writes ride the same PR fallback the cloud leg already uses: the runner pushes
its per-run `codex/<agent>-<ts>` branch; a human or the cloud leg opens/merges the PR into
`ops`. No new credential, no ruleset change, one consistent ops-write model for every
non-admin actor.
