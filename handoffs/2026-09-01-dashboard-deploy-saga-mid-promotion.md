# dashboard-v3 deploy saga handoff — 2026-09-01

**Topic:** Deploying merged dashboard-v3 to the VM: six boot blockers root-caused and fixed (#143–#146), VM now LIVE on release `c17807a5`; session closes MID-PROMOTION with three exact commands left, then CLI provisioning and the acceptance walk.

### What WORKED (with evidence)
- **dashboard-v3 merged to main** — #142 (195 commits) + deploy fixes #143 (broker foreign prebuilds), #144 (pack `dashboard/shared`; boot `DASHBOARD_REPO_ROOT`; dev-seed degrade), #145 (`bootstrap_vm.py upgrade` — VM converged by Daniel: node-proxy uid 987, re-rendered unit incl. `RuntimeDirectory` + `DASHBOARD_DESKTOP_HELPER_ORIGIN=https://msi.tail82dd4f.ts.net`, broker/whois units), #146 (boot outbox publication threading + daemon self-advertisement). All rev-list-verified merged.
- **VM deploy SUCCEEDED** — `/opt/kb-releases/current → c17807a5`, dashboard `active`, serving `https://kb.tail82dd4f.ts.net`, tailnet re-armed, fresh v4 store, self-advertisement row `('vm', N)` beating every 30 s. Broker payload installed (`/opt/kb-shell-broker/releases/0132c738…`); `kb-shell-broker.socket`, `kb-whois.socket`, `kb-node-proxy.service` all `active` after reset-failed+start.
- **Outbox promotion pushed** — 11 bundles cherry-picked onto GitHub ops, head `9ed7a5f2` (verified via fetch+log). Daniel ssh-signed the instruction approval (4 `queue/paused/*` deletions) as `kb-ops-approver`/`kb-ops-instructions`; signer file `C:\Users\danie\kb-backups\kb-ops-approver.allowed-signers` (reusable).
- **VM-faithful WSL rehearsal** — packed release booted in 4 s under tailnet env + outbox + `disabled://` origin + tracked markers (fixture `~/vmops` in WSL); spooled marker removals, advertised `vm`. This rehearsal caught blockers the plain smoke masked.
- **Boss has read-only ssh** — `ssh -o BatchMode=yes root@100.89.73.118` works for diagnostics (journalctl, systemctl status, file reads). VM writes remain Daniel's.

### What Did NOT Work (and why)
- **Five successive VM boot crashes** (each auto-reverted cleanly): (1) `ERR_MODULE_NOT_FOUND shared/ptyProtocol.ts` — `dashboard/shared` absent from `RELEASE_ROOTS`; (2) would-be: boot path ignored `DASHBOARD_REPO_ROOT` → migration evidence read from release tree (no `ledgers/`); (3) would-be: eager dev-seed read ENOENT on ops-layout root; (4) `AuthModeError: DASHBOARD_NODE_PROXY_UID required` — P6 host contract never provisioned (fixed by #145 upgrade tool); (5) `git: 'remote-disabled' is not a git command` — boot marker publisher defaulted to 'direct' publication and pulled the deliberately-disabled ops origin (fixed in #146; class sweep fixed 4 more sites incl. the human-request sweeper).
- **v2→v4 state migration fails closed on real data** — 10 old-era runs unprovable (`run-owner-migration-required`: 7 no evidence, 3 duplicate ambiguous candidates). RESOLVED by Daniel's decision A: state retired to `/root/control-plane-v2-retired-*.json`, fresh v4 seeded. NOTE: a failed rollback mid-saga left old release + v4 state = `unsupported control-plane version 4` outage; recovery = restore v2 file + reset-failed + start.
- **Promotion runbook's `--trusted-ops-head origin/ops` assumption** — VM/GitHub ops histories drifted (chain base `dca3e5d9`, 529 behind); the arg must be the CHAIN BASE, not the current tip.
- **Final reconciliation leg refused twice** — `ops reconciliation requires quiescent runtime`; the daemon was up+armed both times. Lock FIRST (see next step).
- **`fs.access` CLI probe** — kb-dashboard cannot traverse kb-shell's 0700 home (deliberate); clis now derive from broker-reported pty launchers (#146 review round 2).

### What Has NOT Been Tried Yet
- The three remaining promotion commands (Exact Next Step).
- Gate 3: CLI provisioning — install BOTH `claude` and `codex` under `/var/lib/kb-shell/home/.local/bin` as user `kb-shell` + authenticate (subscription auth, Daniel-only). All-or-nothing: broker identity check requires launchers exactly `shell,claude,codex`; then pty capability lights up and all 18 agents become placeable (12 claude / 6 codex).
- Gate 4: flip chosen agents `runner-bound: true` in `agents/<id>.md`, walk the dashboard, run one agent for real.
- Host-node map (`/etc/kb-dashboard/host-nodes.json`, Daniel-authored) — only needed for DESKTOP node-route reporting; VM-local runs don't need it.
- Backlog: `routingOverride.ts` hand-rolled pull/push (request-time 500 on VM); Phase 6 (activation host-contract preflight + packed-tree boot-smoke gate — task #6 in session task list); run-identity candidate dedupe; untracked-marker publisher edge.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| main @ `c17807a5` | DONE | all deploy fixes merged; release artifacts `kb-backups/release-c17807a5/` (sha `213d5f67…`) |
| VM `/opt/kb-releases/current` | DONE | `c17807a5` live; `previous → 64fb3d02` |
| VM `/var/lib/kb/state/control/control-plane.json` | DONE | fresh v4; retired v2 + v4-fresh copies in VM `/root/` |
| VM `/var/lib/kb/ops` | WIP | still at old head; reconciliation to `9ed7a5f2` pending (needs quiescence) |
| GitHub `ops` | DONE | `9ed7a5f2` = 11 promoted bundles |
| `handoffs/2026-08-27-dashboard-v3-p7-ux-acceptance.md` | TODO | consumed by this session; lives on MAIN — delete in next main PR |
| WSL `~/vmops`, `~/kb-v3` | DONE | rehearsal fixture + build checkout (at c17807a5) |
| `kb-worktrees/dv3-gate` | DONE | gate checkout @ 2d5c192c, full node_modules — KEEP (only complete-deps checkout) |

### Exact Next Step
Finish the outbox reconciliation (Daniel, 3 commands): (1) `curl.exe -X POST https://kb.tail82dd4f.ts.net/api/control/execution/lock`, poll `curl.exe https://kb.tail82dd4f.ts.net/readyz` until `"quiescent":true`; (2) rerun the promotion command exactly as before (idempotent; recovers receipts, applies reconciliation): `python scripts\promote_vm_outbox.py --spool C:\Users\danie\kb-backups\outbox-snapshots --repo C:\Users\danie\kb --work-root C:\Users\danie\kb-backups\outbox-work --vm-host root@100.89.73.118 --trusted-ops-head dca3e5d95c10f4f211baa132c27f5333c967b151 --approval C:\Users\danie\kb-backups\outbox-snapshots\snapshot-eb55b5d686fecbdef6aa333b\instruction-approval.json --approval-signature C:\Users\danie\kb-backups\outbox-snapshots\snapshot-eb55b5d686fecbdef6aa333b\instruction-approval.json.sig --approval-allowed-signers C:\Users\danie\kb-backups\kb-ops-approver.allowed-signers`; (3) `ssh root@100.89.73.118 "systemctl restart kb-dashboard.service"` to re-arm. Acceptance: every `ready/` bundle has a matching receipt in `receipts/` on the VM (runbook §check), then proceed to Gate 3 (CLI install).

### Load list
- `memory/` personal: `dashboard-v3-arc.md` (DEPLOY SAGA section — full blocker chain + ceremony checklist)
- `docs/runbooks/2026-08-18-platform-cutover.md` (promotion + receipts acceptance check, ~line 915)
- `deploy/bootstrap_vm.py` (upgrade subcommand — the VM host-contract tool)
- This handoff
