# kb-ops — STATE
_Updated: 2026-09-11 17:50_

## Now
VM dashboard (`kb-dashboard.service`) was STOPPED (failed, 6 restarts) since 2026-09-06 19:04:55Z
— every boot on release 39197cf5 died at hydrate (`invalid control-plane creator attempt
generation provenance`, store.ts:1715: a validator join not keyed by run). Fix is PR #173
(`claude/provenance-fix`, opus root-caused + reviewed MERGEABLE) — **confirmed still OPEN,
unmerged** as of this file's writing (2026-09-11, `gh pr view 173`). Recovery has NOT been run.
Repo `orgs/kb-ops/STATE.md` itself is stale (last touched 2026-07-16, "nothing yet") — this file
distills the ops handoffs/memory instead, which are current.

## Current gate
Daniel must merge PR #173; then the boss runs the scripted recovery (`morning-rebuild.ps1` ->
`recover-deploy.ps1`) and interrupts stale run `run-971d5ba4` before Gate 4b can resume.

## Next
1. Daniel: apply the proposed CLAUDE.md/BOSS.md diff (Navigation reads GOAL.md; findings -> STATE.md ## Findings;
   grades cite the model-audit row) - text in memory/claude-boss.md 2026-09-11 section / PR #182 body.
2. Reshape orgs/atlas/STATE.md to the project-frame shape (scripts/project_frame_lint.py fails on it today).
1. Daniel merges PR #173.
2. Boss: `morning-rebuild.ps1` (guard e8bf8d35) -> `recover-deploy.ps1 -SigningKey <path>`
   (daemon-down path: no API lock, parks `current`, reset-failed, pre-installs validator).
3. Verify hydrate clean (`journalctl -u kb-dashboard`), then `POST .../manager/stop` to interrupt
   run 971d5ba4.
4. Preflight (routing hash, admission 404-or-drain) -> decide on Gate 4b run 5.
5. Phase B once recovery lands: post-deploy canary, drain automation, wire guards (P15d), P21/P23,
   retire 15 stale `wf-*` cards, P11 work-product route, P14 ruling, webauthn re-pin, P18 n8n
   comparative analysis.

## Blocked
Gate 4b run 5 and all Phase B work blocked on Daniel merging #173 (his merge authority; no
branch-tip deploys).

## Findings
- PR ledger #157-#173 (2026-09-03 to 09-06) shipped 17 PRs fixing the broker/launch/drain chain
  one real-VM defect at a time (attempt-key format, PTY fd hygiene, codex ELF pin, UMask, outbox
  durability, tool cap, T3 passkey channel, run-detail wire drift x3, replay-pane retry, queue-
  bridge untracked cards, model-routing drift, codex `--cd`/stdin fixes, ledger budget window,
  broker UMask, hydrate cross-run join).
- Gate 4a (claude launch, `acceptance-run`) PASSED per 2026-09-06 memory note (not independently
  re-verified in this pass).
- A release changing a frozen unit contract must pre-install its resident validator BEFORE
  activation, or the old validator refuses it — deploy script step A3 now does this.
- PowerShell mangles quoted remote ssh commands (use `cmd /c "ssh host bash -s < file"`); Git Bash
  mangles `/mnt/c` and `$(`; `git worktree remove` follows a node_modules junction (delete it
  first); WSL idles between commands (harmless); opus can 529 mid-agent (resume, verify by diff).
- Contradiction: repo `orgs/kb-ops/STATE.md` says "nothing yet, 2026-07-16" while ops handoffs and
  personal memory describe an active, far-advanced Gate-4 arc through 2026-09-06 — the STATE.md
  in the main checkout was never updated; this file follows the handoffs/memory as the true state.

## Infra
- VM release at outage: 39197cf5 (broker 610230c7); forensic snapshot
  `/root/forensics-20260906T190455Z/` on the VM.
- Recovery scripts (boss scratchpad, session 4dd42e67): `morning-rebuild.ps1`,
  `recover-deploy.ps1`, `deploy-pty-fix.ps1`, `drain-step1/2.ps1`, `passkey-enrol.ps1`.
- Stale run to interrupt: `run-971d5ba4-16e5-4010-895f-33e69122984a` (slug gate4b-20260906,
  attempt 713a22a2 / session 77047d3c, stale-live).
- PR #173: https://github.com/danielzhang04/kb/pull/173 (base main, head claude/provenance-fix).
