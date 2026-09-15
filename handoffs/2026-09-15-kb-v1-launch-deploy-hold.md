# kb v1 launch — merged; prod deploy ON HOLD behind two rehearsal-found blockers — 2026-09-15 (boss handoff, ~15:30 ET)

**Topic:** Continuation of the overnight v1 launch. PR #173 and PR #185 are MERGED (origin/main bce8a7a3); the release for bce8a7a3 is built. The prod deploy is deliberately on hold: a rehearsal of the post-deploy sequence against a copy of PROD's real control-plane document reproduced the 09-06 outage class (a stop call poisons the document) and the drain would wedge on an allowlist gap. Both are fixed in hotfix PR #188 (`claude/v1-hotfix-1` @ 90690e27, CI + Linux gate pending at handoff); the next terminal finishes its gates and review, re-rehearses the whole prod sequence on prod's data, and only then hands Daniel the deploy command.

## Read this first
- Rehearsal tooling and how to use it: scratchpad `rehearsal/README.md` (session 7a86f89a scratchpad = `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-kb\7a86f89a-1cd3-40e1-bf9d-fc3f4abab93c\scratchpad`). Copy anything you need out of it early; scratchpads are per session.
- Read-only prod access for every terminal: `ssh -o BatchMode=yes kb-reader <cmd>` (allow rule already in `kb/.claude/settings.local.json`; VM enforces a restricted login shell — Tailscale SSH ignores authorized_keys options, so the shell is the boundary). Allowed: cat/ls/stat/head/tail/find under state/ops/releases/kb units, `tar -czf - <paths>`, journalctl -u kb-*, systemctl is-active/show kb-*, git -C /var/lib/kb/ops read verbs (git refuses "dubious ownership" there — read .git/HEAD and packed-refs with cat). Everything else is refused (exit 126). Root ssh and the deploy stay Daniel-run.

## Blockers found (both reproduced on the rehearsal with prod's document, not on prod)
- **B1 — stopping the stale run poisons the store.** Prod doc rev 475 boots fine on the new release (hydrate OK, health 200, run-971d5ba4 served, idle 6 min clean). `POST /api/control/runs/run-971d5ba4-16e5-4010-895f-33e69122984a/manager/stop` → 409 `automatic-stop-reconciliation-required: invalid control-plane iteration loop state`, but the document was still WRITTEN (rev 475→482) in a shape the validator rejects: every control read 500, self-advertise beat fails, restart crash-loops on hydrate. Poisoned doc: scratchpad `debug-loop/control-plane.POISONED-rev482.json`; original: `prod-snapshot/prod-state.tgz` (control-plane.json, canonical-integration.json, chains, accounting, attempt-io, pty, outbox). ROOT CAUSE (opus, `debug-loop/report.md`): `validateIterationDurability` store.ts:1578-1583 required a `rework-queued` loop's turn-owner attempt to be exactly `queued`; `cancelRun` / boot crash-normalization move it to stopped/interrupted and `commit()` never validates, so the stop persisted an unloadable doc. FIX in #188 (90690e27): whitelist widened to stopped/interrupted/failed; test loads the real prod document (fixtures `dashboard/server/control/__fixtures__/dv3/control-plane.prod-*.json`). OPERATOR PATH unpatched: `POST /api/control/runs/run-971d5ba4-.../archive` is safe (writes only the run record; `interrupted -> archived` legal; zero open human requests); NEVER `manager/stop` it before #188 is deployed. Poisoned-doc recovery: stop daemon, save the file, restore `/root/pre-fix-<ts>/control-plane.json` (root:root 0600), restart, verify /readyz + GET runs + no beat failures. The `[pty-registry] PTY session document is invalid` line is rehearsal-only (partial restore); prod's pty doc validates (v3, rev 498).
- **B2 — the drain would wedge.** Prod outbox holds 8 unreceipted bundles = ONE chain from `51e9159ecce04d8ea741eae5e3ae52621b17498b` to the VM ops HEAD `fe3e2570`; 6 touch `queue/**` (Daniel signs with kb-ops-approver). `deploy/apply_ops_reconciliation.py`'s `RECONCILED` allowlist (line 66) lacks `orgs/[^/]+/GOAL\.md` (added by #182), so the reconciliation would push + receipt, then abort before clearing the spool. FIXED in #188 (7633d688): `^orgs/[^/]+/GOAL\.md$` added to COORDINATION/RECONCILED (apply_ops_reconciliation.py) and COORDINATION/INSTRUCTION (promote_vm_outbox.py); 4 tests, red on revert; pytest 96/96. Drain scripts for THIS chain: scratchpad `drain-v2/` (README, drain-step1-v2.ps1, drain-step2-v2.ps1, ops-refresh.ps1). A successful drain also resets the VM ops checkout to the current origin/ops tip, which brings `orgs/kb-ops/workflows/v1-acceptance-demo.md` (16ec3e84) to the VM.

## Exact next steps (in order)
1. PR #188 is open with both fixes. Check its CI acceptance run and the Linux gate log `/home/danie/kb-gate-90690e27.log` (started at handoff from PowerShell).
2. Remaining gates on #188: `npx tsc --noEmit`, the touched vitest files + `server/control/store.test.ts`, `python -m pytest -q tests/test_apply_ops_reconciliation*.py tests/test_promote_vm_outbox*.py`; Linux five-command gate alone (`rehearsal/linux-gate.sh refs/heads/claude/v1-hotfix-1 /home/danie/kb-gate-<sha>.log`, from PowerShell, nothing else running). Opus read-only review of the hotfix diff. Push, `gh pr create` (Why/What/Evidence), CI acceptance must pass.
3. Rehearse the FULL prod sequence on the rehearsal host with prod's document: `rehearsal-build.sh refs/heads/claude/v1-hotfix-1` → park daemon-down → `kb-deploy.ps1` (rehearsal args, see README) → load prod state (`rehearsal/load-prod-state.sh` via `ssh root@localhost bash -s`, tgz already at /root/prod-state.tgz) → boot → stop the stale run (or the operator path the debugger prescribes) → reads still 200 → restart → hydrate OK. Also dry-run what of the drain can run locally (promote_vm_outbox.py against a spool copy: `ssh kb-reader tar -czf - /var/lib/kb/state/outbox` is already in prod-state.tgz).
4. Daniel: merge the hotfix PR. Boss: `morning-rebuild-v1.ps1` after updating its guard sha list to include the hotfix head; it prints the deploy command.
5. Daniel: `kb-deploy.ps1 -SigningKey <key> -Sha <main> -BrokerDigest 610230c7c9b72931e8a82b7aa685945e384ec6eb18f94fcd64a21912ce57ec55` (deploy scripts reviewed by opus, P1-P3 folded; rehearsed 7× incl. exact heads).
6. Post-deploy, Daniel-run with boss watching (via kb-reader + the tailnet URL): drain-step1-v2 → sign approval → drain-step2-v2 (admission 404 after) → stop/park run-971d5ba4 per the fixed path → canary: V1 Acceptance Demo, topic `tailnet-trust`, approve gate with Daniel's passkey, download brief.json; then a scheduled parameter-less workflow with the browser closed.

## What WORKED (with evidence)
- Merges: #173 (4f52286b), #185 (bce8a7a3); dry-run merge tree == PR head tree; CI acceptance green on 359aa810.
- Release bce8a7a3 built (`morning-rebuild-v1.ps1`), broker digest 610230c7… (unchanged from prod); digest-file == digest-manifest.
- kb-reader read-only identity live and verified (hostname OK, `echo` refused 126, writes impossible).
- Rehearsal: new release boots on prod's document; idle 6 min all reads 200.
- Release-workflow red since 09-11 diagnosed: shallow checkout vs `tests/test_cleanup_no_dangling_refs.py`; fix PR #187 (fetch-depth 0) open.
- Draft PR #186 (desktop units 1-2) reviewed, D1/D2/D4 folded (c4fa6bd8).

## What Did NOT Work (and why)
- `manager/stop` on run-971d5ba4 with the merged release → B1 (above). Do not run it on prod.
- `apply_ops_reconciliation.py` allowlist → B2 (above). Do not sign/drain before the hotfix is deployed and the resident reconciler refreshed (vm-step-c3.sh does it at deploy).
- Re-deploying a sha whose `/opt/kb-releases/<sha>` exists → activate_release refuses (kb-deploy.ps1 now checks up front).
- kb-reader via sshd forced command → ignored by Tailscale SSH ("account not available" with nologin). Login-shell pin is the working design.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| origin/main bce8a7a3 | DONE | #173 + #185 merged; release built in scratchpad `release/` |
| PR #187 `claude/release-ci-fetch-depth` | OPEN | one-line CI fix; merge any time |
| PR #186 `claude/v1-desktop-u12` @ c4fa6bd8 | DRAFT | units 1-2; D5 = unit 8 |
| PR #188 `claude/v1-hotfix-1` @ 90690e27 | OPEN | B1 + B2 + tests; CI + Linux gate + opus review pending |
| scratchpad `kb-deploy.ps1`, `morning-rebuild-v1.ps1`, `vm-step-*.sh` | DONE | opus-reviewed, P1-P3 folded; prod defaults |
| scratchpad `drain-v2/` | DONE | chain 51e9159e→fe3e2570, scripts, README; blocked on B2 |
| scratchpad `kb-reader/` | DONE | reader_shell.sh, setup script, README |
| scratchpad `rehearsal/` | DONE | README + all tooling; host `kb-rehearsal` LIVE on 359aa810 with prod's doc rev 475 loaded, passkey.conf, stub claude |
| `handoffs/2026-09-15-kb-v1-launch-ready.md` (ops) | SUPERSEDED by this file | git rm in the same push |

### Exact Next Step
Finish #188: CI green, Linux gate log green, opus read-only review of the two commits, then step 3 (re-rehearse deploy -> archive/stop -> drain on prod's document) and hand Daniel the merge.

### Load list
- this file; scratchpad `rehearsal/README.md`, `drain-v2/README.md`, `debug-loop/report.md`, `kb-reader/README.md`
- PR #185 body + evidence comments (what shipped and how it was proven)
- `memory/claude-boss.md` sections 2026-09-15 (two entries)
- `docs/runbooks/2026-09-03-vm-agent-launch-preflight.md` §d (deploy) and §e (drain)
