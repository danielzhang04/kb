# Handoff — the PTY vertical is alive on the VM (2026-09-02)

## Load on resume
- `dashboard/server/pty/fdPinnedPaths.ts` — the launch validator; the heart of this arc
- `dashboard/server/control/workflowProfiles.ts` — the shared profile leaf (new)
- `dashboard/server/auth/routes.ts` + `dashboard/src/lib/browserSessionClient.ts` — the cookie fix
- `deploy/systemd/kb-shell-broker.socket` + `.service` — the two systemd fixes
- PR https://github.com/danielzhang04/kb/pull/149 (branch `claude/linux-pty-capability-probe`)
- scratchpad `gate3-preflight.sh` — read-only VM launch-condition checker, now correct

## State: deployed and proven
Release `c952c098d57f0301d8b90678945f04c0791ac29b` is live on the VM; broker payload
`60ea542c5337f0c9b90818588b35d64b88f154a219a8dfb1d99d16834e151562` matches that release's own
MANIFEST. Both units active. `gate3-preflight` CLEAN. Both CLIs installed and authenticated as
`kb-shell` (`claude` 2.1.257, `codex` 0.152.0).

A real shell session ran on the VM and returned output — the first ever:
```
create(shell, worktrees) -> state=live
whoami; pwd; echo KB-PROOF-42
kb-shell
/var/lib/kb-shell/worktrees
KB-PROOF-42
```

## What was wrong (seven defects, five found only by running it)
1. `APPROVED_MODELS` was stale fiction — one id overlapped the real registry. Enumeration DELETED,
   replaced by a runtime-prefix check. Do not restore it; the reasoning is in `c713327e`.
2. Broker tool-policy table knew only `standard`, which nothing sends. Now one shared leaf module.
3. Codex `toolPolicyId` fell back to `worker:codex:<model>` — colons fail decode and kill the socket.
4. Codex sandbox was hardcoded `workspace-write` for every profile, and absent entirely on resume.
   Now derived from the profile's tools, on Linux AND Windows.
5. `InaccessiblePaths=/var/lib/kb-activation` — nothing creates it, so every broker spawn died at
   `226/NAMESPACE`. Now `-` prefixed in the unit text ONLY (never in the `inaccessiblePaths` array,
   which feeds `deniedRoots` in code).
6. Socket-unit `User=`/`Group=` do NOT own `RuntimeDirectory`; `/run/kb-shell` came up root-owned and
   `kb-dashboard` could not traverse to the socket. Fixed with a privileged `ExecStartPre` pair.
7. The frontend never called `POST /api/auth/browser-session`, the only mint path in tailnet mode, so
   no browser ever held the cookie `/api/pty` requires. And a refused ref returned 401 with no
   `Set-Cookie`, which `HttpOnly` made unrecoverable — any daemon restart bricked that browser.

## Next
- **Phase 4 / Gate 4 — the real remaining test.** `claude` and `codex` launches are UNPROVEN live.
  The terminal path only ever creates shells (`manual launch recipe is unavailable`), so they need
  an agent run through the control plane: drain, acceptance-run, then `fyt-checker`. This is what
  exercises defects 1-4.
- Daniel had not yet confirmed a browser terminal at handoff time; everything under it is proven.

## Open, non-blocking
- `rootId: 'repo'` can never pass validation — `/var/lib/kb/ops` is `kb-dashboard`-owned (it must be),
  while the validator's non-home branch demands root ownership. Fix or remove the option.
- `/usr/local/lib/kb/` holds bootstrap copies (`validate_vm_runtime.py`, `activate_release.py`, ...)
  that release activation never refreshes. The stale validator rejected this branch's own unit change
  and took the dashboard down for ~1 min mid-deploy. Needs a real sync path.
- No `--settings` read-scope blob on Linux (systemd confines instead); carrying validated scopes is a
  protocol v2 change, deliberately deferred.
- `kb-node-proxy.service` still failing (stub `main()`, not load-bearing).

## Deploy recipe that works (do not improvise this)
1. Broker archive must be built on Linux — WSL clone `~/kb-v3`, `npm run build:pty-broker`.
2. Release must also be PACKED on Linux (`build_platform_release.py` hard-refuses a Windows host).
3. Order is FORCED: `install_pty_broker.py` takes only `--digest` and reads from
   `/opt/kb-releases/current`, so the release activates FIRST, broker second. The gap is `pty:false`.
4. Run `deploy_platform_release.py` from Git Bash, NOT PowerShell — it shells `scp`, and Windows
   OpenSSH's scp reads `C:\...` as a host named `C`. Git Bash's does not.
5. Activation needs `quiescent:true` — lock via `POST /api/control/execution/lock` over the TAILNET
   URL (localhost gets `untrusted-peer`). Execution re-arms itself on restart under tailnet mode.
6. **A dashboard restart is a required final step**: PTY capability is probed once per process and
   never re-probed, so a broker installed after activation is invisible until the daemon restarts.
