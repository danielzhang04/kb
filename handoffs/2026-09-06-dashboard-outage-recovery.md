# Handoff 2026-09-06 — VM dashboard DOWN (hydrate refusal crash loop); fix is PR #173, recovery scripted

## Load on resume
1. This file.
2. `handoffs/2026-09-02-dashboard-gate4-live-launch-plan.md` (the whole Gate-4 arc, sections dated 09-03..09-05).
3. `memory/claude-boss.md` (tail: 2026-09-04/05/06 laws).
4. Boss scratchpad (session 4dd42e67): `morning-rebuild.ps1`, `recover-deploy.ps1`, `deploy-pty-fix.ps1`, `drain-step1/2.ps1`, `w7q-gate4b-report.md` (run 4), `passkey-enrol.ps1`.
5. `docs/runbooks/2026-09-03-vm-agent-launch-preflight.md` (deploy ceremony d/d1, drain e, catalog e2, passkey h).

## STATE (2026-09-06 ~20:30Z)
- **kb-dashboard.service on the VM is STOPPED (failed, 6 restarts) since 19:04:55Z.** Every boot on release 39197cf5 dies at hydrate: `invalid control-plane creator attempt generation provenance` (store.ts:1715). The state document is NOT corrupt; the validator's pending-request join lacked subject/runRef and compared run 4's rework attempt against run 3's still-open request. Forensic snapshot: VM `/root/forensics-20260906T190455Z/`. No orphaned worker processes; broker fine (UMask 0002 on both units).
- **Fix = PR #173** (`claude/provenance-fix` @ e8bf8d35; opus root cause W72 + review W73 MERGEABLE; verified the live snapshot loads with the guard; plus the failure handler can no longer kill the process). NOT merged at handoff.
- Live release 39197cf5 (broker 610230c7). Deployed today before the outage: #171 (ledger budgets + rolling window, activation via `changed`, git safe.directory), #172 (broker UMask + iteration prompt rule). Gate 4b run 4 (`run-971d5ba4`, slug gate4b-20260906) got the furthest ever: concurrent producers, loops activated, checker turns dispatched, then the outage. Its attempt `713a22a2`/session `77047d3c` are stale-live (child dead); the run must be interrupted after recovery.

## RECOVERY (in order; Daniel merges, boss runs the scripts)
1. Merge PR #173.
2. `morning-rebuild.ps1` (guard e8bf8d35) -> release sha + broker digest written into `deploy-pty-fix.ps1`.
3. `recover-deploy.ps1 -SigningKey "$HOME\.ssh\kb-release-signing"` (NOT deploy-pty-fix.ps1: the daemon is down so there is no API lock). It: backs up `/var/lib/kb/state/control` to `/root/pre-fix-<ts>`, `systemctl reset-failed`, parks `/opt/kb-releases/current` so `activate_release.py` takes its is-active branch, pre-installs the release's validator, signs/uploads/activates, verifies VERSION + active + no `assertHydrated` throw, refreshes resident validator/reconciler, verifies broker digest, health. If activation unlinks `current`: `ln -sfn <sha> /opt/kb-releases/current` and start the unit.
4. Verify hydrate: `journalctl -u kb-dashboard -n 40` clean; `GET /api/control/runs/run-971d5ba4-16e5-4010-895f-33e69122984a` serves. Then `POST .../manager/stop` (idempotencyKey + expectedRunVersion + expectedManagerGeneration from the run) to interrupt it.
5. Preflight with main's routing hash (`git show origin/main:governance/model-routing.yaml | sha256sum`), admission 404 (drain if 503: chain base = oldest ready bundle's parent; Daniel signs if any `queue/` paths).
6. Decide on Gate 4b run 5 (slug gate4b-20260907): expected to reach exec resume, accept/pass, both park shapes.

## After recovery (Phase B, Daniel's stated goal: a working, iterable, consistent platform)
Post-deploy canary (one leg per runtime/role, run by the deploy script, fails the deploy); drain automation (P7 plan merged as doc, needs build); wire guards for every client decoder (P15d); P21 malformed-outcome re-ask; P23 process-level rejection handler policy; retire 15 stale wf-* cards; P11 work-product route; P14 ruling; governance/webauthn-credentials.yaml re-pin (values in the 09-03 handoff section); P18 n8n comparative analysis.

## Lessons of the day (also in memory/claude-boss.md)
- A validator that runs over the whole document must key every join by run; a writer that validates per run hides that until two runs coexist.
- A failure-surfacing path that re-loads the store can turn a refusal into process death; guard it (done) and decide the process-level policy (P23).
- A release that changes a frozen unit contract must pre-install its resident validator before activation (deploy step A3 now does; recover-deploy too).
- Probing the resident validator by hand needs the unit's env (systemd-run -p User= -E HOME=), or it fails on DBUS/HOME.
