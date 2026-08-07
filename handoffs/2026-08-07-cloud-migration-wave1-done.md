# Handoff: cloud migration — Waves 0 + 1-final DONE on the pilot VM; next = Wave-3 cutover window

**Written:** 2026-08-07, boss session (Fable 5). Supersedes 2026-08-06-cloud-migration-wave0-gate.md
(picked up + completed this session).
**Branch:** `claude/cloud-migration`, pushed through **`9ee705a`**. Arc worktree
`C:/Users/danie/kb-worktrees/boss-cloud-migration` (KEEP until merge).

## The VM (live, billing hourly)
- Hetzner **CCX23** (4 dedicated vCPU / 16 GB / 160 GB), Ashburn, Ubuntu 24.04, name `kb`,
  public 87.99.133.246, tailnet `kb` = **100.89.73.118** (Daniel's tailnet, desktop `msi` joined).
  ~$0.14/hr ≈ $103/mo cap; pilot ≈ $50/2wk. CPX41 was mispriced ($141/mo) — CCX23 chosen (same
  dedicated line as durable CCX33 target, measurements transfer).
- Access: **Tailscale SSH enabled** (`tailscale set --ssh`) — keyless `ssh kb@100.89.73.118` and
  `ssh root@...` work from the desktop for boss/agent verification loops. Daniel's key `~/.ssh/kb_vm`
  also registered.
- User `kb` (sudo, linger on), node 24.18.0/npm 11.16.0 via fnm, python3 **3.14.4** (newer than the
  plan's 3.12 floor — suites pass), venv `~/.venvs/kb` (pyyaml+pytest, `KB_PYTHON` in env file).
- Auth: claude subscription — env token in `~/.config/kb/env` (600) AND **persistent CLI login in
  `~/.claude`** (required: `childEnv.ts` denies the token env to governed workers by design; Daniel
  ran the interactive /login). codex — ChatGPT **file-backed `~/.codex/auth.json` 600 per Daniel's
  2026-08-06 fallback ruling** (headless gnome-keyring cannot create its login collection; ruling
  recorded in the plan + vm_verify.sh encodes the file-backed check). All reboot-proven:
  `vm_verify.sh` all-PASS post-reboot.
- Repo: bare mirror `~/kb-mirror.git` (branches main/ops/claude/cloud-migration pushed from desktop
  over tailnet — no GitHub creds on VM); clone `~/kb` on cloud-migration; ops worktree
  `~/kb-dashboard-ops`. Git identity `kb-daemon@vm.local` (global, kb user) — revisit at cutover.
- Daemon: **systemd user unit `kb-dashboard` RUNNING on 127.0.0.1:5317** (deploy/systemd/), env
  file supplies DASHBOARD_REPO_ROOT=**~/kb-dashboard-ops** (= durable root; bridge scans + coordination
  writes need the ops checkout), SPA built. Currently **DISARMED** (no DASHBOARD_EXECUTION_ACTIVATED)
  — fail-closed until cutover. Journald: 0 error lines over 3h armed soak.
- Tunnel proven: `ssh -N -L localhost:5318:127.0.0.1:5317 kb@100.89.73.118` (local 5317 still held
  by legacy desktop node prod PID 21960 until decommission).

## What was proven (Wave 1-final acceptance)
- **Full vitest ON LINUX: green** (2427 tests, 13 skipped) after five real port defects were found
  and fixed this session (commits `10503c2..9ee705a`):
  1. `resolveWithin` path-escape guard missed win32-absolute forms on POSIX (browser.ts, shared guard).
  2. `buildActivatedExecution` bypassed ActivationDeps for attemptIo/paidActions → EACCES cascade
     (31 tests) on Linux test roots.
  3. Reconciliation tests + fixture spawned bare `python` → pythonInvocation() resolver everywhere.
  4. **noReparseFiles secure-file guard was win32-only on the POSIX hot path** → new
     `dashboard/server/platform/noReparseFiles.{ts,posix.ts,shared.ts}` — descriptor-rooted
     O_NOFOLLOW walk via /proc/self/fd, FIFO O_NONBLOCK guard, /proc-absent fail-closed probe,
     linux-only selector; opus adversarial review FIX-THEN-SHIP, all 4 MAJORs applied; win32
     byte-equivalent extraction. `cards.py save()` pins `newline="\n"` (canonical bytes were
     platform-dependent, masked by autocrlf=true).
  5. **claude worker attempts never finalized on Linux** — CLI 2.1.224 in stream-json input mode
     waits for stdin EOF after its terminal result; adapter now sends EOF on the parsed result
     event (claudeWorkerAdapter.ts; VM-probed: result at 3.5s, alive at 90s pre-fix).
- pytest scripts: 39 pass + 2 win-gated skips on Linux; 41 on Windows. tsc baseline exactly 7.
  Known load-flakes unchanged (reconciliation file is one — judge it ISOLATED, ~258s runtime).
- **Synthetic acceptance harness: ACCEPTANCE PASS 8/8 ON THE VM** — real governed chain end-to-end
  (mint → gate-on construction → dispatchClaimedCard → real `claude -p` (sonnet-5) → exact output on
  canonical integration lineage → `## Result` in queue/done → trigger reconciled → subscription
  ledger row), code-enforced throwaway isolation. Harness itself had a latent bug (state path not
  resolved via kbStateDir) — fixed `9ee705a`.

## Deferred BY ARCHITECTURE to the Wave-3 cutover window (not failures)
- Live queue-bridge tick: `surface.ts` starts the bridge only on a **passkey-sourced unlock**
  (`state.source === 'passkey'`) — env-override arming deliberately does not start autonomous queue
  pickup. Passkey creds (DASHBOARD_WEBAUTHN_CREDENTIALS + SECRET) migrate at cutover. VM inbox has
  ZERO claimable cards (six eng-fold cards are `state: blocked`; scanned) so re-arming is safe.
- One CODEX-runtime governed attempt (spec exit wording); codex exec itself is proven on the VM.
- W7 full-flow acceptance (video-run def card as ONE run) — runs on the VM, not local prod.

## Next step
Daniel schedules the quiescent cutover window → task #3: execute
`docs/runbooks/2026-08-06-wave3-cutover.md` (branch) live, + the deferred items above, + merge
`claude/cloud-migration` → main. Then Wave 4 decommission (kills the Wave-1a nt branch, frees local
5317, sweeps stale VS Code sessions), then the Atlas plan.

## Daniel rulings after the handoff was first written (2026-08-07 late, this session)
- **Quiescent = kb-only**: no other kb terminals mid-work (the bricks terminal in the main checkout
  is the live one), no codex dispatches in flight, daemon/cadences idle. Non-kb activity on the
  desktop is irrelevant. Bricks' uncommitted tree may SIT during the window — it just can't run.
- **Full-kb migration scope confirmed**: the entire kb (all projects incl. faceless-youtube) moves.
  Size is a non-issue (repo 258M already mirrored on the VM; 141G free). The three non-git state
  classes: (1) coordination/runtime state — already in the cutover runbook copy list; (2) gitignored
  machine-local scratch (fyt `visual-kit/_staging/`, `review.json`) — regenerable, DEFAULT LEAVE on
  the desktop; if bricks is mid-flight at cutover its terminal finishes or hands off first;
  (3) the fyt image-gen spend-capped provider key — credentials are human-only: when fyt generation
  first runs on the VM, Daniel places the key himself (same shape as Wave-0 auth steps). Not needed
  for cutover itself.
- Pilot watch-item: ffmpeg renders on 4 dedicated vCPU vs the desktop — pilot load measurements
  decide whether the durable box must be CCX33 (8 vCPU) for render-heavy weeks.

## Load list
1. This handoff.
2. `docs/superpowers/plans/2026-08-06-cloud-migration.md` (branch — Wave 0 section now carries the
   codex-fallback ruling).
3. `docs/runbooks/2026-08-06-wave3-cutover.md` (branch).
4. `memory/claude-boss.md` (2026-08-07 lessons: follow-up-loses-cwd near-miss, worker-sandbox
   limits, probe-first debugging wins).
5. Gotchas: judge reconciliation suite ISOLATED; vm_verify.sh needs the kb login shell env
   (fnm PATH + env file); harness spawns real workers — subscription spend only.
