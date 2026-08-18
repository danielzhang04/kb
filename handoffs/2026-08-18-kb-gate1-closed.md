# kb-structure Gate-1 CLOSED + windowsHide folded — 2026-08-18

**Topic:** Boss session executed handoff tasks 1-3: stranded windowsHide fix folded into
workflow-platform; kb-structure Gate-1 ceremony driven end-to-end to a SIGNED, VERIFIED evidence
package (five live platform defects found and fixed via PRs #123-#127 on the way); Phase 2
(workflow-platform live proof) and Phase 4 (closure sweep) remain.

### What WORKED (with evidence)

- **Gate-1 CLOSED** — package `gate1-20260818T044809Z`: `Decision: PASS`, finalize signed
  (evidence key `~/.ssh/kb_evidence_signing`, env `KB_EVIDENCE_SIGNING_KEY` set User-level),
  `verify` returned `{"passed":true,"verified":true}` binding release `0554dc81` + artifact
  `795c91d1...`. Signed package archived at `C:/Users/danie/kb-backups/gate1-evidence/`
  (unsigned original also on VM `/var/lib/kb/gates/phase1/`).
- **windowsHide fix folded** — `d324ae3a` on `claude/workflow-platform` (pushed; remote==local);
  cherry-pick clean, tsc baseline 7, targeted suites 167/167. Prod-pin handoff consumed.
- **Backup/restore drill GREEN** — backup snapshot `38530fcb` verified:true; restore drill in WSL
  (root, node24, restic 0.16.4) verified:true, RTO 16s, isolated locked boot on :14317. Desktop
  restic + Windows credential-manager config live (`kb-restic-tier0`, repo
  `C:\Users\danie\kb-backups\restic-tier0`).
- **Five live defects fixed, merged, deployed** (each codex-built + opus-adversarially-reviewed,
  every grade model-grepped `claude-opus-5`):
  #123 export_tier0 stopped-unit ControlGroup quiescence proof;
  #124 bootstrap seeds daemon-exact control-plane.json (atomic, drift-guarded);
  #125 SPA unauth boot crash → sign-in view (401-boot zero-fetch pin);
  #126 sanctioned DASHBOARD_WEBAUTHN_CREDENTIALS channel (shape-validated both check sites);
  #127 collector default-port Host mismatch vs origin guard.
  VM deployed at `0554dc81` era + manual helper refresh; VERSION verified each deploy.
- **VM auth live** — Daniel's passkey enrolled (browser console ceremony), credential provisioned
  in unit env with `transports:["internal"]`; login → authed reads 200; daemon survives login
  (git identity fix below).
- **Item-10 ruling executed** — stale Aug-7 pilot daemon (pid 48993, port 5317) STOPPED; only the
  certified systemd daemon (:4317, Serve-fronted) remains.

### What Did NOT Work (and why) — read before touching the VM

- **Every pre-04:45 token failed `bad-signature`** because THE DAEMON CRASHED ~60s AFTER EVERY
  LOGIN: login → audit git commit in /var/lib/kb/ops → `fatal: unable to auto-detect email
  address` (GIT_CONFIG_GLOBAL=/dev/null by design, repo-local identity NEVER provisioned) →
  uncaught → exit 1 → systemd restart → new random session secret. Fixed live:
  `git -C /var/lib/kb/ops config user.email kb-dashboard@agents.local` + user.name. CLASS FIX
  STILL OWED (bootstrap should provision identity; daemon should not die on audit-commit failure —
  needs a ruling).
- **Outbox `DirtyIndexError` on boot** — restarts interrupt staged-but-uncommitted audit writes;
  recovery refuses `MM ledgers/audit/dashboard-audit.ndjsonl` fail-closed → degraded mode → deploys
  refuse (not quiescent). Clear procedure: STOP service first, `sudo git -C /var/lib/kb/ops reset`,
  start (resetting while live races the daemon's re-staging). Root cause was the identity crash;
  may still recur on unclean stops.
- **Release deploys NEVER refresh /usr/local/lib/kb helpers** (bootstrap-installed:
  activate_release, validate_vm_runtime, export_tier0, apply_ops_reconciliation). Merged helper
  fixes reach the VM only via manual `sudo install -m 0555` (done twice this session) or full
  re-bootstrap. PLATFORM GAP for the Task-24 window.
- **codex --follow-up loses --cwd** (again) — killed a follow-up that would have written into the
  main checkout; fresh dispatch with --cwd every writing leg.
- **Codex workers cannot write any worktree git index** (lives under main repo .git → sandbox
  denies) and have NO shell network (VM/ssh work must run from the boss shell).
- **Playwright/automated browser cannot do WebAuthn** — platform authenticator hard-refuses in
  automation (instant NotAllowedError); passkey ceremonies must run in Daniel's own browser
  (console snippet + prompt()-dialog copy works; DevTools requires typing `allow pasting`).
- **prompt-coach note**: token copy-integrity red herrings burned ~5 rounds; the durable
  transport is `(Get-Clipboard -Raw).Trim() | ssh kb@kb "bash /var/tmp/gate1-run.sh"` (script
  still staged on VM; prints len/shape/probe-reason before collecting).

### What Has NOT Been Tried Yet (queued follow-up PRs — class fixes)

- bootstrap_vm.py provisions ops-checkout git identity (kills the crash class).
- Ruling needed: should an audit-commit failure crash the daemon (current) or degrade?
- auth/routes register/verify should return `transports` (currently dropped; caused the
  phone-only passkey dialog detour).
- Origin guard should normalize default ports in Host compare (makes #127's class impossible).
- Helper-refresh mechanism for /usr/local/lib/kb (deploy-time or versioned).
- Outbox recovery could self-heal a staged-only-uncommitted audit ledger (currently manual).

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| origin/main @ 0554dc81 | DONE | #123-#127 merged; release runs green each |
| claude/workflow-platform @ d324ae3a | READY | e08308bc + windowsHide fold; Phase 2 gate pending |
| VM kb | LIVE | release 0554dc81 active, quiescent, auth working, drill-proven |
| C:/Users/danie/kb-backups/gate1-evidence/ | DONE | signed package + approval + allowed-signers |
| C:/Users/danie/kb-backups/restic-tier0 | LIVE | tier-0 repo, snapshots 81a9a8a0+38530fcb |
| kb-worktrees/gate1-* (3 dirs) | SWEEP | git-deregistered; ACL-locked pytest tmp dirs need elevated delete |
| kb-worktrees/boss-workflow-platform | KEEP | until Phase 2 merge |
| kb-worktrees/boss-2026-08-11c | KEEP | SDD ledger exception |
| VM /var/tmp/gate1-run.sh | LEFT | collect runner; harmless, delete on next VM pass |
| scratchpad main-tip worktree + release artifacts | TEMP | session-local; worktree prune later |

### Exact Next Step

Phase 2: walk Daniel through the workflow-platform live-proof (recipe in
`handoffs/2026-08-14-dashboard-workflow-platform-p1-complete.md`, tip now `d324ae3a` — disclose
the windowsHide fold as the one post-review delta) → merge → then kb-structure deferred sub-plan
prep (Tasks 9/21/23-25) + the 3 standing rulings (orgs/ exposure, unsigned ledgers promotion,
CP2 S14) → Phase 4 sweep (advance dashboard-prod-pin to main, elevated worktree-dir cleanup,
delete VM runner script).

### Load list

- This file.
- `handoffs/2026-08-14-dashboard-workflow-platform-p1-complete.md` (Phase 2 recipe; KEPT).
- PR bodies #123-#127 (defect + review record).
- `memory/claude-boss.md` 2026-08-18 section.
- Plan `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` §DEFERRED (for sub-plan prep).
