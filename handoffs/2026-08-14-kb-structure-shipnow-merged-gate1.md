# kb-structure ship-now MERGED — Gate-1 ceremony handoff — 2026-08-14

**Topic:** The Phase I ship-now set (20 tasks) is MERGED to main (PR #118, plus Atlas #120
same window) and the main release run is GREEN with an attested artifact. What remains is
Daniel's Gate-1 ceremony, three standing rulings, and the deferred sub-plan (Tasks
9/21/23-25) blocked on the workflow-platform merge. Supersedes (consumed, deleted this
commit): handoffs/2026-08-13-kb-structure-phase1-execution.md.

### What WORKED (with evidence)

- **All 20 ship-now tasks built + adversarially reviewed + merged** — main @ 986990f9;
  `git rev-list origin/main..claude/boss-2026-08-11c` == 0; PRs #118/#120 state MERGED.
  This session closed T15 (6288789), T16 (8bf904df), T17 (2bf3d1af), T18 (29e5f4a7),
  CP2 (30a05949), T19 (1399e259), T20 (2d48d1c2), T22 (84b414a5), CI proof chain
  (a2b5ecd6..71b2809a).
- **CP2 closed PROCEED** — 10/10 gating cross-task seam defects fixed, every one verified by
  the reviewer's own probes; closure statement in the worktree review file.
- **Release workflow PROVEN green** — run on main tip 986990f9: all 12 steps success,
  artifact kb-platform-986990f9... (26MB) uploaded. Proof loop fixed 3 latent main defects
  (runner git identity; .githooks/pre-commit +x bit; PTY resolver PATH-separator modeling).
- **VM acceptance banked** — T13 boundary tests 20/20 native on the VM; release determinism
  digest-identical same-path (5995bb90..) and cross-path after the gyp fix.
- **Review pipeline** — codex builds → opus/sonnet adversarial probes → same-reviewer delta
  → boss-shell verify → PowerShell commit; model-grepped every grade. 18 plan defects caught
  pre-ship, zero shipped.

### What Did NOT Work (and why)

- **Full dashboard vitest on Linux** — no baseline exists (activation/composer/
  resolver-posix/reconciliation classes all fail on ubuntu). Ruled plan defect #18: the
  release workflow carries pytest+typecheck+build+release-guard+artifact only; Linux suite
  greening banked for the Task-24/Gate-2 window. Do NOT re-add `npm test` to the workflow.
- **`A && B && nohup C &` over ssh** backgrounds the whole chain (raced an empty script);
  `systemd-run --wait` dies with the ssh client. Use detached `systemd-run --unit` + polling.
- **codex dispatch auth check** wedged once under two-terminal contention ("login status
  timed out 15s") — clean retry succeeded; don't work around, just retry.
- **`cmd | tail -N`** swallows exit codes in acceptance scripts (produced a fake
  "DETERMINISTIC" from two empty digests once) — pipefail + explicit captures + MISSING
  guards, always.

### What Has NOT Been Tried Yet

- **Gate-1 ceremony (Daniel, in order; full checklist in PR #118 body):** 1) mint
  KB_RELEASE_SIGNING_KEY (ed25519, desktop-only) + set KB_VM_HOST; 2) VM bootstrap
  (deploy/bootstrap_vm.py with ops bundle + public key) + deploy the 986990f9 artifact
  (scripts/deploy_platform_release.py); 3) DASHBOARD_RP_ORIGIN systemd drop-in (PROV-1: NO
  script sets it; until set, all authed reads 403); 4) sudo NOPASSWD provisioning (T12 M3);
  5) restic install + credential-manager config; 6) live backup/restore drill; 7) evidence
  collect → Daniel approval signature → finalize → verify (scripts/gates/phase1_gate1.py);
  8) decide the stale `node serviceEntry.ts` process running on the VM as user kb since
  Aug 07 outside systemd (stop vs adopt).
- **Daniel's standing rulings:** orgs/ served wholesale by the KB browser (dotfile/env
  exposure to authed callers); unsigned ledgers/+traces/ promotion incl. the T3 spend audit
  trail; CP2 S14 minor.
- **Deferred sub-plan (Tasks 9, 21, 23, 24, 25)** — blocked until workflow-platform merges
  to main at/after 804acec. Then: plan's merge-checkpoint ancestry commands, re-read merged
  contracts, write specs against real signatures, adversarial plan re-review, execute.
  Task-21 spec must cover bridge-claim admission incl. paid-action in-flight; Task-24 window
  owes the Linux vitest baseline decision.

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| origin/main @ 986990f9 | DONE | ship-now merged; release run green; artifact 26MB |
| worktree C:/Users/danie/kb-worktrees/boss-2026-08-11c | KEEP (exception) | holds the gitignored SDD ledger `.superpowers/sdd/2026-08-11-kb-structure-phase1/` (progress.md = richest arc record, all review files) — needed by deferred sub-plan + gate support; local branch still checked out there (remote deleted on merge); `.task3-pytest/` is ACL-locked, blocks worktree remove without elevation; `memory/codex-worker.md` untracked stray needs routing |
| PR #118 | MERGED | body = the authoritative scope/review/ceremony record |
| PR #120 | MERGED | atlas wake debounce; running copy already carried the fix |
| dashboards prod pin | STALE | c1fc83d predates schemas/; prod-pin advance is an activation step post-merge (CP1 G3 note) |

### Exact Next Step

Daniel runs Gate-1 ceremony item 1 (signing key mint — command already given in-terminal);
each subsequent item is walked one at a time by the boss. If resuming cold with Daniel
absent: nothing is autonomously actionable except deferred-sub-plan PREP once
workflow-platform merges — check `git merge-base --is-ancestor 804acec origin/main`.

### Load list

- This file.
- PR #118 body (`gh pr view 118`) — scope, review record, ceremony checklist, rulings.
- Worktree SDD ledger: `kb-worktrees/boss-2026-08-11c/.superpowers/sdd/2026-08-11-kb-structure-phase1/progress.md` (bottom third: CP2 → CI proof).
- `docs/superpowers/plans/2026-08-11-kb-structure-phase1.md` §merge-checkpoint + §DEFERRED (on main now).
- `memory/claude-boss.md` 2026-08-14 section (ops).
