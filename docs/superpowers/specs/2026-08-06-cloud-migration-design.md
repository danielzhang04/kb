# kb Cloud Migration — Design Spec

**Date:** 2026-08-06
**Status:** Approved shape (Daniel, 2026-08-06); this document is the precise contract.
**Companion spec:** `2026-08-06-atlas-remote-audio-design.md` (Phase 2 of the arc; sequenced after this spec's cutover).

## Goal

Move the entire kb workload — dashboard daemon, queue bridge, codex/Claude worker
fleet, coordination state — off Daniel's Windows desktop onto ONE persistent Linux
cloud VM, reached from the desktop browser over a Tailscale-carried SSH tunnel so
the browser origin remains `http://localhost:<port>` and every existing WebAuthn
passkey keeps working unchanged. After cutover the desktop runs nothing
workload-bearing: only Tailscale and one SSH tunnel process.

**Success condition:** a full governed workflow run (card → queue bridge → multi-stage
run → live graph → human gate answered → completion) executes end-to-end with every
process on the VM, viewed from the desktop browser at `http://localhost:5317`, with
zero kb processes running locally except the tunnel.

## Non-goals

- Public web app / domain hosting. Deferred to its own security milestone
  (RP-ID rebind, read-auth layer, TLS/proxy). Nothing in this migration may
  foreclose it, but nothing is built for it.
- PTY interactive terminals. **Retired, not ported** (Daniel's ruling 2026-08-06).
  The Win32 named-pipe/SID transport (`dashboard/server/pty/hostClient.ts` — rejects
  non-Windows by design) is removed along with its launch plumbing. The governed-run
  interaction model (RunDetail graph + `AgentWorkPanel` stream + gate responses)
  is the sole interaction surface.
- Atlas audio. Atlas's brain moves in the companion spec; no audio work here.
- Multi-VM / HA. One VM is one fault domain; accepted. Backups priced separately.

## Decisions already made (do not re-litigate in planning)

| Decision | Ruling | Why |
|---|---|---|
| Reach posture | Tailscale private overlay; public web app deferred | Passkeys carry over; zero public surface |
| Origin preservation | SSH local forward, NOT `tailscale serve`/Funnel | `ssh -N -L localhost:5317:127.0.0.1:5317 <vm>` keeps `Origin: http://localhost:5317`; serve/Funnel rewrite origin to `*.ts.net` and silently break every passkey |
| PTY | Retire | Largest port; already superseded by W1–W7 streamed panel |
| Claude auth | Human-minted 1-year subscription OAuth token via `claude setup-token`, exported as `CLAUDE_CODE_OAUTH_TOKEN` in the systemd unit env (never in repo, never in fleet-agent env per CLAUDE.md) | Documented CI/script path; not an API key; survives headless |
| Codex auth | `codex login --device-auth`; keep strict keyring (`.codex/config.toml` forces ChatGPT + keyring) | Doctrine forbids plaintext `auth.json`; requires persistent user D-Bus Secret Service (see Phase 0 exit) |
| Provider/size | Hetzner CCX33, US-East (Ashburn): 8 dedicated vCPU / 32 GB / 240 GB, ~$167/mo incl. IPv4 | Dedicated CPU for 16-worker bursts; CCX43 (~$330/mo) is the escalation if RAM/CPU pressure is measured |
| Supervisor | systemd (user units), replacing pm2-windows-startup + schtasks | Native Linux; journald logs |

## Hard constraints (binding on every build wave)

1. **No API keys, ever.** `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` never set in any
   fleet environment (CLAUDE.md preamble gate). Claude subscription token and codex
   keyring are the only auth. `ANTHROPIC_API_KEY` also takes PRECEDENCE over
   subscription OAuth if set — a stray export silently converts the fleet to paid
   API billing; the preamble gate must keep running on Linux.
2. **Credential handling is human-only.** Minting `setup-token`, running
   `device-auth`, provisioning `DASHBOARD_SESSION_SECRET` — Daniel does these at
   the keyboard. Workers never see, print, or persist secrets. Briefs for auth
   phases contain COMMANDS FOR DANIEL, not agent actions.
3. **No real-money spend by agents.** VM ordering is Daniel's explicit gate
   (Phase 0). Nothing is provisioned, resized, or ordered by a worker.
4. **`claude -p` stays non-bare.** `--bare` ignores subscription credentials and
   `CLAUDE_CODE_OAUTH_TOKEN`; the worker adapters must not add it.
5. **Quota honesty.** 16 workers share one subscription; ~10 parallel agents burn
   allowance ~10× faster. The attempt-budget and daily-budget guards
   (`governance/budget.yaml`) port as-is and stay load-bearing.
6. **Migration is quiescent.** No state copies while the local daemon or any
   dispatch is live. Drain first (see Phase 3 order).

## Phases

### Phase 0 — Provision + auth (Daniel's $ gate; hands-on-keyboard)

Deliverable: authed, reboot-proven substrate. Mostly a runbook Daniel executes;
a codex worker writes the runbook + verification script, nothing more.

Steps (runbook content, precise):
1. Daniel authorizes spend (~$167/mo) and orders CCX33 Ashburn, Ubuntu 24.04 LTS.
2. Base setup: non-root user `kb`, unattended-upgrades, `python3` + `git` + `node`
   (version pinned to match `dashboard/package.json` engines), `ffmpeg`.
3. Tailscale up on VM + desktop already has it; SSH over Tailscale verified.
4. Persistent user D-Bus Secret Service for the `kb` user: `gnome-keyring-daemon`
   (or equivalent) unlocked at boot via PAM/systemd user session with lingering
   (`loginctl enable-linger kb`). This is the codex-keyring precondition.
5. Daniel on VM: `claude setup-token` → token into the systemd env file
   (mode 0600, owned `kb`, outside any repo); `codex login --device-auth` →
   code entered in desktop browser.
6. Desktop: `ssh.exe -N -L localhost:5317:127.0.0.1:5317 kb@<tailscale-name>`
   wrapped as a small always-on task; browser check.

**Exit condition (all four, evidenced):**
- `claude -p 'ok'` and `codex exec 'say ok'` both succeed on the VM **after a full
  reboot** with no interactive login (proves token persistence + Secret Service
  unlock + linger).
- `codex login status` reports the ChatGPT account, keyring-backed.
- Desktop browser at `http://localhost:5317` reaches a placeholder page served
  from the VM through the tunnel; origin verified `localhost:5317`.
- `env | grep -E 'ANTHROPIC|OPENAI'` empty in the service environment.

### Phase 1 — Port the fleet to Linux

Deliverable: daemon + queue bridge + one codex worker green under systemd on the VM.
All build work: codex workers on verified models, TDD, one card per unit.

Precise porting inventory (from the 2026-08-06 feasibility memo; each item names
its unit of work):

| # | Windows-ism | Location | Linux replacement |
|---|---|---|---|
| P1 | `py -3` invocations | `broker/preambleGate.ts:33` + six dashboard runtime paths (write gates, workflow launch, stop-floor, PTY verification, queue bridge spawns) | Resolve interpreter once (config/env `KB_PYTHON`, default `python3`); update active HEARTBEAT/skill instruction text that says `py -3` |
| P2 | pm2 config hardcodes | `dashboard/pm2.config.cjs:60` — `C:\Users\danie\kb-worktrees\dashboard-ops`, `%LOCALAPPDATA%\kb-dashboard`, schtasks task name | systemd user units (`kb-dashboard.service`, `kb-dashboard-ops` path vars); state root `~/.local/state/kb-dashboard` |
| P3 | schtasks runner trigger + liveness | `dashboard/server/runner/trigger.ts:48` | systemd-run / direct spawn under the user manager; liveness via PID + start-time |
| P4 | `taskkill /T /F` + `tasklist` | `scripts/codex_dispatch.py:133` | POSIX process-group kill (`os.killpg`); liveness via PID + start-time (the current Linux fallback kills only the direct child and treats dead PIDs as alive — both are real bugs to fix, with tests); state root `%LOCALAPPDATA%\kb-codex-dispatch` → `~/.local/state/kb-codex-dispatch` |
| P5 | PowerShell services | `agent_runner.ps1`, `desktop_dispatch.ps1`, `desktop_poll.ps1`, sentinel watchdog, `pty_host_launch.cmd`, keep-awake | **Default: RETIRE.** Port only scripts a live code path still invokes after P2/P3 (the wave enumerates callers first, then ports that subset as systemd units/POSIX sh). keep-awake DELETED (cloud VM never sleeps); `pty_host_launch.cmd` deleted with PTY retirement |
| P6 | PTY subsystem | `dashboard/server/pty/` (hostClient.ts named pipes/SID/`C:\ProgramData`), its routes + UI entry points | RETIRE: remove routes + launch plumbing + UI affordance; keep git history; a tombstone note in `dashboard/docs/design-brief.md` |
| P7 | Path separators / `%LOCALAPPDATA%` | grep sweep across `dashboard/` + `scripts/` | `path.join` + XDG state dirs; one shared resolver, not scattered fixes |

Norms: change core logic in place, **Linux-only — zero `if (win32)` branches
survive any wave.** The transition is handled by git, not runtime checks: local
prod stays pinned at its pre-port SHA (dashboard-prod worktree is already
SHA-pinned by doctrine) and keeps running old code until Phase 3 cutover, so
ported code never needs to run on Windows. Strip-only TS; tsc baseline exactly 7;
full vitest suite green on a Linux run before exit.

**Exit condition:** on the VM, under systemd: daemon serves 5317, queue bridge
tick claims and dispatches a test card through `dispatchClaimedCard`, one codex
worker completes a trivial governed attempt, `npx vitest run` full-suite green,
journald shows no spawn errors across 3 consecutive bridge ticks.

### Phase 2 — Atlas split

Separate spec: `2026-08-06-atlas-remote-audio-design.md`. Sequenced AFTER Phase 3
cutover (Atlas brain joins a live VM, not a half-migrated one).

### Phase 3 — State migration + cutover (quiescent window; Daniel schedules)

Order is load-bearing:
1. **Drain:** finish/park all runs; wait out or stop all codex dispatches (drain
   `%LOCALAPPDATA%\kb-codex-dispatch\pending\`); stop local pm2 daemon; STOP file
   check clean.
2. **Push everything:** every local branch pushed; dirty/untracked work captured
   per checkout (the main checkout is materially dirty — bricks arc files — and
   worktrees `dashboard-ops` + `kb-worktrees/*` each need individual sweep).
   Worktree `.git/worktrees` metadata is host-pinned: NEVER copied; worktrees are
   recreated fresh on Linux.
3. **Copy state (daemon stopped on both ends):** `control-plane.json` (active
   run/session records normalize to `interrupted` on restart — expected, not a
   bug); `ledgers/`; codex dispatch logs + `threads.json` (post-drain);
   `composer/workspaces.json` ONLY together with the same
   `DASHBOARD_SESSION_SECRET` (stored provider session IDs are encrypted under it;
   Daniel provisions the secret by hand).
4. **Recreate on VM:** fresh clone; `dashboard-ops` worktree permanently on `ops`
   (same doctrine as BOSS.md); control-plane managed worktrees are derived state —
   let the reconciler rebuild them.
5. **Acceptance:** the success-condition run (top of spec) executed and evidenced:
   run id, graph screenshot-equivalent (RunDetail states), gate answered from the
   desktop browser, ledger row written on ops.

**Exit condition:** acceptance run green + `git fetch` on both machines shows no
unpushed refs anywhere local.

### Phase 4 — Decommission local

- Stop + remove local pm2 apps, schtasks entries, sentinel/keep-awake tasks.
- Local checkout remains as a dev clone only (nothing auto-starts).
- Desktop residue allowed: Tailscale, the SSH tunnel task, browser.
- Rollback window: local install left intact but inert for 2 weeks before any
  deletion; rollback = stop VM units, restart local pm2 (state re-copied back the
  same quiescent way).

**Exit condition:** desktop process audit shows zero kb workload processes;
dashboard reachable only through the tunnel; 48h of VM cron/cadence activity with
no local process spawns.

## Known risks & mitigations

| Risk | Mitigation |
|---|---|
| Codex keyring fails after reboot on headless Linux (D-Bus/Secret Service) | Phase 0 exit explicitly reboot-tests it. Fallback REQUIRES a new Daniel ruling: protected `auth.json` (`cli_auth_credentials_store="file"`, 0600) is a doctrine exception he must approve — do not silently downgrade |
| Codex token refresh races under 16 parallel `codex exec` (refresh ~8 days, after 401s) | Serialize an auth health-check before releasing a worker burst (small pre-flight in `codex_dispatch.py`); pilot through one refresh boundary before calling Phase 1 done |
| Claude token expiry/revocation (1-year token; renewal is an event) | Alert on auth failure in the adapter (existing failure path → wake-me card); calendar note at mint time |
| ToS ambiguity: always-on 16-worker personal-plan fleet not separately guaranteed | Daniel decides whether to seek written confirmation from Anthropic; budget guards cap burn meanwhile |
| One VM = one fault domain | Hetzner snapshots/backups priced + enabled at Phase 0; `control-plane.json` + ledgers are on ops branch anyway |
| Quota burn ~10× under parallel agents | Existing attempt-budget (3/day) + `governance/budget.yaml` daily guard stay enforced; no cap changes in this arc |

## Open items for Daniel (as they arise, one at a time)

1. Phase 0 spend approval (~$167/mo + snapshot pricing) — gates everything.
2. Ubuntu 24.04 assumed; object now if you want Debian.
3. Whether to seek written Anthropic confirmation for the fleet pattern.
4. Cutover window scheduling (Phase 3).
