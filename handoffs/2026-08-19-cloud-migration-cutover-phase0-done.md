# cloud-migration cutover handoff — 2026-08-19

**Topic:** Desktop→VM cutover arc replanned against current reality (the 08-06 Wave-3 runbook was
stale). Phase 0 (tailnet-trust always-on auth) is BUILT + boss-verified + **PR #130 open,
MERGEABLE/CLEAN**. Phases 1–8 planned in the boss tasklist and encoded in a new cutover spec +
runbook on `claude/cloud-migration`. Cutover has NOT started; no state moved; VM untouched except
read-only inspection.

## The one-paragraph situation
The Hetzner VM (`kb@100.89.73.118`, tailnet, keyless Tailscale SSH) already runs the **certified
immutable platform** from the kb-structure Gate-1 arc — system unit `kb-dashboard` on `127.0.0.1:4317`,
fronted by `tailscale serve` at `https://kb.tail82dd4f.ts.net`, releases in `/opt/kb-releases`
(current→`0554dc81`), state in `/var/lib/kb`, restic backups, Daniel's passkey enrolled. The OLD
cloud-migration Wave-1 stack (user unit on :5317, `~/kb` clone, `~/kb-mirror.git`) is the DEAD stack —
decommission it in Wave 4, do not revive it. Cutover = migrate the desktop control plane onto the
platform, NOT onto the old 5317 model. Daniel's directive this session: kill passkey+arming entirely,
make the VM **always-on** with ambient security → that is Phase 0, now built.

## What WORKED (with evidence)
- **Tailnet-trust mode built** — branch `claude/tailnet-trust` @ 13 commits, **0 behind main,
  clean-merge, PR #130 MERGEABLE/CLEAN**. `DASHBOARD_AUTH_MODE=tailnet`: serve-proxied requests are
  the operator (no session/unlock), armed at boot, queue bridge starts on daemon start; WebAuthn/latch
  retained as the win32-desktop default (one seam at `resolveSession`). Confirmed: tsc 0, pytest deploy
  85, targeted vitest 589/589 (24 files), full server suite 2315 pass (2 pre-existing real-git flakes,
  identical at base `71c0449d`).
- **CRITICAL security bug found AND fixed AND boss-verified** — dual opus adversarial review. An earlier
  peer-UID proof matched the `/proc/net/tcp` row on the port pair + "any loopback", letting an
  unprivileged local process bind `127.0.0.2:<tailscaled source port>` and borrow tailscaled's root row
  → uid 0 → full operator bypass. Fixed in `35c3c1b0` (full 4-tuple match against the real connection
  addresses, `peerUid.ts:175`). **Boss independently verified**: read the fix, ran the suite (50/50),
  confirmed the port-collision regression test `SECURITY: rejects the source-address spoof — attacker
  binds 127.0.0.2:<tailscaled port>` passes (this is the collision fixture, not the naive lone-row test
  that reviewer B's false-negative used).
- **Two cutover docs authored + committed + pushed** — `3642cd3b` on `claude/cloud-migration`:
  `docs/specs/2026-08-18-cutover-end-state.md` + `docs/runbooks/2026-08-18-platform-cutover.md`;
  old `docs/runbooks/2026-08-06-wave3-cutover.md` deleted (superseded). Two adversarial-review passes
  (13 BLOCKER/MAJOR + 6 MINOR) folded in, plus arming/session-chain verification results.
- **Two arming/resume unknowns closed (opus, boss-verified reasoning)** — unlock auto-starts NOTHING
  from the imported plane; the 7 queued attempts fire only when a human answers their run's last open
  request; `agent-session-chains` files reference only 2 already-terminal runs (safe to copy; never
  copy `*.mutex.sqlite`).

## What Did NOT Work (and why)
- **The 08-06 Wave-3 runbook is unrunnable as written** — §4 fresh-clone guard (`test ! -e ~/kb`) fails
  (VM already has `~/kb`); it clones from GitHub which the VM cannot reach (no creds by design);
  §3.5 would `sed`-overwrite already-correct env and provision a now-FORBIDDEN `DASHBOARD_SESSION_SECRET`
  (platform validator refuses boot with it); §5 tunnel + passkey is incompatible with the platform RP
  origin. → fully replaced by the 2026-08-18 platform runbook.
- **Straight merge of `claude/cloud-migration` into main is wrong** — `git merge-tree` shows **30
  conflicts** incl. an add/add on `deploy/systemd/kb-dashboard.service` where the branch side is the
  LEGACY user unit (would replace the certified platform unit), plus branch deletions of keep-awake +
  pm2.config.cjs that main still needs. → Phase 2 is RE-DERIVATION (cherry-pick 7 named port commits),
  not a merge.
- **The outbox ops write-back is NOT "already built, just unoperated"** — `promote_vm_outbox.py`
  hard-fails when `origin/ops` advanced past a bundle's parent (it has, by 108 commits) AND its
  receiptless-recovery path raises when remote commits exceed pending bundles. The stranded Gate-1
  bundle is unpromotable by the shipped tool. → Daniel RULED co-writers (Model B); the tool needs
  rebase-onto-head + empty-spool exit-0 + pull-only downward sync built as a window precondition.
- **Reviewer B (a14c9edc) called the CRITICAL "sound"** — false-negative; it only tested a lone
  `127.0.0.2` row (fails closed without the fix, proves nothing). Caught by cross-review vs reviewer A
  + boss's own code trace. Lesson: for security-critical surfaces, dual review + boss verification of
  the exploit, never a single pass.

## What Has NOT Been Tried Yet
- **Live VM verification of tailnet mode** — deliberately deferred to cutover acceptance (Phase 7 already
  asserts armed-at-boot, bridge-tick-within-60s, reboot-survival). A throwaway pre-merge deploy would
  re-provision the unit twice. The build worker DID empirically confirm on the live VM that
  `tailscale serve` injects `Tailscale-User-Login` and that serve connects as root uid 0 / daemon uid
  999 — the peer-UID proof's premise holds.
- **Pinning 3 runbook caveats to the shipped mode** — the runbook has 3 reconcile-later markers now
  resolvable: the pull-only sync flag name (check the tool's `--help` after Phase-2 build), the
  armed-at-boot env expression (`DASHBOARD_AUTH_MODE=tailnet` + required `DASHBOARD_TAILNET_OPERATOR`),
  and the bridge-tick log string (grep the shipped code). Do during Phase 3.

## Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `claude/tailnet-trust` (PR #130) | DONE | 13 commits, MERGEABLE/CLEAN, boss-verified. Merge = Daniel gate. Worktree `kb-worktrees/tailnet-trust`. |
| `docs/specs/2026-08-18-cutover-end-state.md` | DONE | on `claude/cloud-migration` @ `3642cd3b`, pushed. Note: still describes passkey end-state in places the editor updated to tailnet — re-read §4/§5 after PR#130 merges to confirm consistency. |
| `docs/runbooks/2026-08-18-platform-cutover.md` | DONE | on `claude/cloud-migration`, pushed. 3 reconcile-later caveats (see above). |
| `governance/model-routing.yaml` + `orgs/faceless-youtube/workflows/iteration-loop-demo.md` | TODO | workflow-platform P1 defects 1+2 (add `gpt-5.6-terra`; demo manager→claude) — land before/with P1 merge. |

## Exact Next Step
**Gate: Daniel merges PR #130** (tailnet-trust → main). It is self-contained, default behavior
unchanged (win32 desktop untouched), MERGEABLE/CLEAN. After merge, the next terminal picks up the boss
tasklist in order:
1. **Phase 1** — workflow-platform P1 merge (currently 25 ahead of main): resolve live-proof defect 3
   (`store.ts:5255` turn-owner throw — reconcile `run-23accef6` or re-run the demo on a real ops
   checkout to decide bug-vs-artifact), land defects 1+2, merge.
2. **Phase 2** — RE-DERIVE the Linux port onto post-tailnet-trust main: cherry-pick `506af813 fb9f501f
   0ccd0531 4fa62cc3 d18711f1 87bb6a98 9ee705a6` rebased onto main's `runtime/` doctrine; DROP the
   PTY-deletion / keep-awake-deletion / pm2-deletion / legacy-unit commits. Multi-day build; §0
   precondition of the window. ALSO build the promote_vm_outbox.py co-writer rework here (rebase-onto-
   head + empty-spool exit-0 + pull-only sync).
3. Then Phases 3–8 per the runbook (drain incl. atlas-worker + cadence freeze → push-sweep → state
   migration to `/var/lib/kb` → deploy post-merge release → acceptance over 443 always-on → close-out).

Cutover window is quiescent + Daniel-scheduled; do not start it unprompted.

## Decisions locked this session (do not relitigate)
- Cutover TARGET = the immutable platform (:4317/443), NOT the old :5317 stack.
- Auth = tailnet-trust always-on. `DASHBOARD_TAILNET_OPERATOR` REQUIRED/fail-closed, pinned
  `daniel.zhang.t1@gmail.com`. Break-glass recovery paths accept the tailnet operator.
- Ops write authority = **co-writers (Model B)**: desktop terminals keep pushing ops; promotion tool
  gains rebase + empty-spool no-op + pull-only sync.
- Port lands on main by RE-DERIVATION, not merge. tailnet-trust merges first (PR #130), port rebases on
  top.
- Rollback = platform `previous` symlink + restic tier-0 + 2-week inert desktop (`dashboard-prod`
  worktree on `claude/dashboard-prod-pin` is the rollback image — EXEMPT from all sweeps for the window).
- **URL / tailnet name LOCKED (Daniel, 2026-08-19) = `kb.command.ts.net`.** Rename the tailnet
  `tail82dd4f` → `command` (one-time admin-console rename, Daniel's action — account cred, not ours);
  machine hostname stays `kb`. "kb" everywhere else (repo, `/var/lib/kb`, `/opt/kb-releases`,
  `kb-dashboard` unit, `kb-ops-approver` key, org names) is internal codename and is UNCHANGED — the
  new word lives only at the address layer. No full rebrand. A custom apex domain stays OUT (would
  require public Funnel, breaks the tailnet-only trust boundary).
  - WIRING SURFACE (rename `kb.tail82dd4f.ts.net` → `kb.command.ts.net` before Phase 6 deploy /
    Phase 7 acceptance; fold into Phase 2 re-derivation + Phase 3 config — NOT a Phase-1 blocker):
    main ~32 refs across `dashboard/server/auth/mode.ts` (+ `mode.test.ts`, `tailnetOperator.test.ts`),
    `dashboard/server/http/surface.test.ts`, `dashboard/server/security/origin.test.ts`,
    `tests/test_validate_vm_runtime.py`, `tests/test_bootstrap_vm.py`,
    `docs/superpowers/specs/2026-08-18-tailnet-trust-mode-design.md`; cloud-migration branch 8 refs in
    `docs/runbooks/2026-08-18-platform-cutover.md` + `docs/specs/2026-08-18-cutover-end-state.md`.
    Plus the live VM: re-run `tailscale serve` under the new name so the TLS cert re-issues for
    `kb.command.ts.net`, and confirm `resolveDaemonPublicOrigin` (activation.ts) yields the new origin.
    Verify with `git grep -i tail82dd4f` == 0 across both branches after the sweep.

## Load list
- `handoffs/2026-08-19-cloud-migration-cutover-phase0-done.md` (this file)
- `docs/specs/2026-08-18-cutover-end-state.md` (on `claude/cloud-migration`)
- `docs/runbooks/2026-08-18-platform-cutover.md` (on `claude/cloud-migration`)
- `docs/superpowers/specs/2026-08-18-tailnet-trust-mode-design.md` (on `claude/tailnet-trust` / PR #130)
- `git show origin/ops:handoffs/2026-08-18-boss-plan-remaining.md` (sequencing authority: cutover = Step 5)
- `memory/claude-boss.md` (2026-08-19 lessons)
- Boss tasklist: 10 tasks (#10 Phase 0 done; #1–8 pending in phase order; #9 drain)
- PR #130 body (security-review record); PR bodies for workflow-platform (Phase 1)

## TONIGHT EXECUTION STATUS (2026-08-19 overnight, boss session f43d4736 autonomous)
Daniel authorized running Phases 1–2 through the night unattended; prep Phase 3; he reviews +
merges in the morning, then Phases 3–8 run WITH him. Governance = boss NEVER merges; all overnight
work terminates PR-ready. keep-awake ARMED (supervisor pid 32180 + pid-only lease `boss-overnight`
on pid 44508 — cannot idle-expire while this terminal stays open).

- **Phase 1 — DONE building.** PR #131 open (`claude/workflow-platform` tip `84ae392e`, 26 ahead of
  main). 3 live-proof defects resolved (d3 real launch-projection bug fixed at launch.ts:406 seed-only
  attempts, guard intact; d2 manager→claude; d1 already upstream). Opus adversarial review running
  (agent `afdd1db`) → verdict to be posted as PR comment; FIX-THEN-SHIP triggers a codex fix + reverify.
  MORNING GATE: Daniel merges #131.
- **Phase 2 — building (4 stages, codex-driven, adversarial review built in).** Recon finding: main has
  the systemd unit but NONE of the runtime port (platform/ resolvers, agent_runner.sh/.py, codex_dispatch
  POSIX ctrl, noReparse.posix all ABSENT); the "cherry-pick 7" shorthand understates it — 2 commits
  (75a9a00a systemd, 8ebc337f PTY) bundle VM-adds with desktop-deletes and must be hand-split.
  S0 port manifest running (codex-deep read-only, bg `bvqt7pbsh`, brief in scratchpad
  phase2-stage0-manifest-brief.md). Then boss-review manifest → S1 build (fresh worktree off main) →
  S1b outbox co-writer rework (promote_vm_outbox.py) → S2 independent adversarial review → PR-ready.
  Multi-day; may not finish overnight. MORNING GATE: Daniel merges.
- **Phase 3 — PREP only tonight** (execution needs Daniel's Tailscale console): URL wiring worklist
  (kb.tail82dd4f→kb.command), pin 3 runbook caveats, draft admin-console runbook. URL LOCKED =
  `kb.command.ts.net` (see Decisions-locked above).
- Resume: on any context refresh, re-read this section + the boss tasklist + the two scratchpad briefs;
  harvest completed workers via their ops `queue/done` cards. Next boss actions are event-driven
  (worker completion notifications): post P1 review verdict; review S0 manifest then dispatch S1.

## RESUME AFTER CRASH — 2026-08-19 ~13:30 (boss session restarted → new id 8ce359ff)
State is authoritative as of this section. keep-awake RE-ARMED (supervisor pid 34212, pid-only lease
`boss-overnight`; armed:True). If the boss session restarts again, resume from here.

- **Phase 1 = DONE.** PR #131 open (`claude/workflow-platform`), opus SHIP posted. Awaits Daniel merge.
- **Phase 3 prep = DONE** (ops card `queue/done/6a853136-818f74c2.md`). D1 URL wiring worklist (40 refs),
  D2 admin-console runbook, D3 caveats. Findings: URL rename is config-driven (set
  `DASHBOARD_TAILNET_HOST=kb.command.ts.net` in the unit + swap 40 refs); bridge-tick acceptance
  unprovable on main (no success log — needs a heartbeat log or different signal); pull-only flag =
  `--pull-only` (resolved by outbox build). Execution still needs Daniel's Tailscale console (morning).
- **Phase 2 = IN PROGRESS in two standalone CLONES** (NOT worktrees — see lesson):
  - Port: `C:/Users/danie/kb-clones/linux-port-rederive` (branch `claude/linux-port-rederive` off
    main 29463734, `dashboard/node_modules` junctioned, `PORT-MANIFEST.md` = scratch spec copy of ops
    card `6a853054-f347db70`). ~30% done in working tree (496a522e + 506af813 preambleGate +
    75a9a00a agent_runner.sh/.py). Re-dispatched: brief
    `scratchpad/phase2-stage1-build-brief.md` (has RESUMPTION STATE). Remaining: 75a9a00a dashboard
    seams + win32-gate, 8ebc337f childEnv, 4fa62cc3 noReparse.posix, fb9f501f browser+activation,
    d18711f1, docs. runnerTrigger stays FALSE on Linux (ruling #1).
  - Outbox: `C:/Users/danie/kb-clones/outbox-cowriter` (branch `claude/outbox-cowriter`).
    promote_vm_outbox.py has all 3 behaviors + `--pull-only`; tests being written. Brief
    `scratchpad/phase2-stage1b-outbox-brief.md`.
- **LESSON (cost 3 wasted dispatches):** codex sandbox makes `.git` READ-ONLY (both linked worktrees
  AND clones). Codex workers CANNOT `git commit`/`cherry-pick`/`add` — they edit the WORKING TREE
  only; the BOSS commits (exactly the dispatch-codex skill's model). Brief workers accordingly:
  "leave changes uncommitted; use `git show <sha>` (read) + `git apply` without --index or direct
  edits; boss commits." Linked worktrees ALSO fail because their `.git` metadata lives under the main
  repo's `.git/worktrees/<name>/` (outside the sandbox). Use standalone `git clone --local` +
  junction `dashboard/node_modules` for tsc/vitest.
- **HARVEST when a Phase-2 worker finishes:** boss reviews the clone's working-tree diff, runs win32
  suites, then (boss, unsandboxed) `git add`/`commit` in the clone, `git fetch <clone-path>
  <branch>:<branch>` into the main checkout, `git push origin <branch>`, open PR. Then dispatch S2
  independent adversarial review before calling it merge-ready.

## OVERNIGHT BUILD COMPLETE — 2026-08-19 (all 3 build phases → PR-ready, opus-reviewed, 0 merges)
- **PR #131** workflow-platform P1 (iteration loops) — opus SHIP.
- **PR #132** outbox co-writer rework (rebase-onto-head + `--pull-only` + empty-spool) — 49 tests, opus SHIP (ran real ssh-keygen gate; no bypass/no push/no fail-open/no injection).
- **PR #133** Linux control-plane port (re-derivation, 37 files) — opus SHIP (no win32 regression, credential filter intact, POSIX guard fails closed, no Linux publication path, desktop-survival confirmed); boss tsc re-verified (2 baseline jpeg-js only).
- **MORNING GATES for Daniel:** (1) merge #131, #132, #133; (2) ratify 3 open rulings (Linux worker-runner out-of-scope / runnerTrigger:false; codex-auth storage no-change; pty_host_launch non-issue); (3) then Phase 3 — his Tailscale console (rename tailnet→`command`, disable key-expiry, always-on ACL) + `DASHBOARD_TAILNET_HOST=kb.command.ts.net` + the 40-ref URL wiring folds onto the port branch pre-deploy.
- **Phase-3 findings to resolve:** bridge-tick acceptance criterion is unprovable on main (queue bridge emits no success log — add a heartbeat log or use a different liveness signal for Phase 7); `--pull-only` is the downward-sync flag (resolved).
- Merge order suggestion: #131 (independent) and #132 (independent) any order; #133 (port) independent of both. All three off current main, none conflict.
