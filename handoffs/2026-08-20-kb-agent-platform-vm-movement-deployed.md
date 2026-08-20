# agent-platform + vm-movement Phase 1 — MERGED and DEPLOYED handoff — 2026-08-20

**Topic:** One boss session reconciled the two overnight arcs (agent-platform #139, vm-movement
Phase 1), landed both on `main`, and activated the combined release on the VM. Consumes and
replaces `2026-08-20-kb-agent-platform-merge-ready.md` and `2026-08-20-kb-vm-movement-phase1-built.md`
(deleted in this push). Next step is Daniel's testing pass on the live VM.

## Context
Daniel's goal: all parts of both plans, rebased cleanly, committed, merged, deployed to the VM;
then testing. Both branches forked from `439fc90d`; only 4 files overlapped (`server/index.ts`,
`index.test.ts`, `http/surface.ts`, `surface.test.ts`), one trivial import conflict. Order chosen:
#139 as-is first, Phase 1 rebased linearly on top.

## Done (evidence)
- **#139 merged** by Daniel → `d7e36441`. Before that, a whole-PR dedup pass ran (codex-sol,
  sonnet equivalence review 12/12): 3 JSONL parsers → `hook_io.parseJsonLines`, 3 repo-root
  resolvers → `planeA.resolveRepoRoot`, recurrence parse/compile only in `scheduleWords`,
  `EvalCard(canary.Canary)`, two rosters on `useReadPanel`, ~60 unused exports + dead CSS; skill
  mirrors were missing `agent-builder` (pre-commit failed on every checkout); five repo-root
  `MORNING-REPORT*`/`LAUNCH-PROMPT` artifacts dropped. Daniel merged before these were pushed, so
  they rode in #140.
- **main went RED on ubuntu** after #139 (4 Linux-only pytest failures: unsorted `os.scandir` in
  `agent_maintainer`, `py -3` hard-coded in brain tests, `test_vm_compat_docs` needing
  `dashboard/node_modules` before `npm ci`). Fixed in #140 (`ffb7bfee` + review fix `90708d66`:
  per-directory entry ceiling that parks, tests pin the delivered bound; opus-reviewed).
- **PR #140 merged** → `64fb3d02`: 2 cleanup + 11 vm-movement docs + 7 Phase-1 task commits
  (content-identical to `codex/vm-movement-p1`) + Linux CI fix + `KB_VM_RUNTIME=1` exact-value
  check + `.gitattributes` LF pin for the generated schema modules. Gates: Windows pytest 1487,
  typecheck/build/slow-builder green, serial vitest 3652 pass (14 failing files = main's 13
  passkey-era client files + 1 load flake 23/23 alone), Linux native-clone oracle 1484/2 env.
  CI run 32417189554 **SUCCESS**.
- **VM pre-flight**: resident `/usr/local/lib/kb` now carries main's `activate_release.py`,
  `control_plane_schema.py`, `validate_vm_runtime.py` (backups `/root/kb-resident-backup-*`);
  v2 probe `V2_OK`; execution locked → `quiescent:true`; snapshots `/root/kb-state-v1-pre-64fb3d02.tgz`
  (== desk `C:/Users/danie/kb-backups/release-64fb3d02/pre-deploy-state-v1.tgz`, sha `a04d5675…`)
  and `/root/kb-tier0-pre-64fb3d02.tar` (1.2 GB).
- **Activated 64fb3d02** (Daniel ran `deploy_platform_release.py` with the desk key): `current →
  64fb3d02`, `previous → 439fc90d`, service active, `control-plane.json` **version 2** (schema
  check OK), `dashboard.lock` lease present, `/readyz ok`. Browser (tailnet, no sign-in): Home +
  Agent Platform with all 12 panels, 0 console errors. API: agents, schedules, autonomy-ladder,
  loop-status, health, model-audit 200; `/api/trace` 404 (localTranscripts-gated, by design).
- **Deploy-handoff items**: (1) exact-value validator — in #140; (3) python deps on VM
  `/usr/bin/python3` **3.14.4**: PyYAML, numpy 2.5.2, torch 2.13.0+cpu (CPU index),
  sentence-transformers 6.0.0 (`--ignore-installed click` over the debian package); (4) Brain
  model at `/var/lib/kb/state/brain/model` (one-time `HF_HOME` under the state root — kb-dashboard
  has no home dir) + index built (54 files / 1667 chunks); `/api/brain/search` returns ranked
  results from the desk. (2, partial) GitHub `ops` mirrors `agents/` + workflows from main
  (`sync_daemon_dirs.py --sync`, `0550fae0`). (5) evals skipped by design. (6) no env keys added.
- Desk: main checkout on `codex/boss-2026-08-20` at `64fb3d02`; `sync_skills --check` green;
  branches `codex/vm-movement-p1-rebased`, `claude/agent-platform-w1`, `ap-cleanup-tmp` deleted;
  WSL `~/kb-ci` removed.

## Remaining (ordered)
1. **Daniel's testing pass** on https://kb.tail82dd4f.ts.net (the stated next step).
2. **VM ops-checkout refresh** — `/var/lib/kb/ops` remote is `disabled://desktop-promotion-only`;
   only the signed `scripts/promote_vm_outbox.py` / `apply_ops_reconciliation.py` ceremony updates
   it, so it still lacks `skills/curated/agent-builder` and the newest `agents/` defs. Daniel-gated.
   Card filed.
3. `export_tier0.py` expects the service to "restart locked"; tailnet mode re-arms at boot, so the
   export errors AFTER writing a valid archive. Card filed.
4. main's 13 passkey-era vitest files (54 tests) — CI never runs vitest. Card filed.
5. VM durability benchmark (`KB_VM_DURABILITY_BENCHMARK=1`, `store.durability.vm.test.ts`) — the
   release tree is pruned of dev deps; needs a dev checkout on the VM or a Linux box.
6. Post-merge ceremony still owed: U7/U9 hook arming, gate-3 maintainer first supervised fire.
7. Elevated delete of ACL-locked residue: `kb-worktrees/agent-platform-w1`,
   `kb-worktrees/vm-p1-rebased`, `kb-clones/agent-platform-w2` (worktree entries already pruned).
8. Remote branch `codex/vm-movement-p1` is content-merged via cherry-pick but rev-list≠0 — delete
   only on Daniel's say-so. `codex/boss-2026-08-19` still holds 78 unmerged bricks/research commits.
9. Then: **Phase-2 plan** (engine fence + boot rehydrator) against the merged tree.

## Rollback (if testing finds a blocker)
`ssh root@100.89.73.118 sudo python3 /usr/local/lib/kb/activate_release.py rollback`, then
`systemctl stop kb-dashboard`, restore `/root/kb-state-v1-pre-64fb3d02.tgz` over `/var/lib/kb/state`
(`tar -C / -xzf …`), `chown -R kb-dashboard:kb-dashboard /var/lib/kb/state`, start.

## Load list
- `docs/specs/2026-08-20-desk-vm-movement-design.md` §8 (Phase-2 scope), `docs/plans/2026-08-20-vm-movement-phase1-plan.md`
- PR #140 body + gate comment; `.github/workflows/kb-platform-release.yml`
- `docs/proposals/brain-query-runtime.md`, `docs/proposals/maintainer-cadence-entry.md`
- `memory/codex-boss.md` (2026-08-20 lessons)
