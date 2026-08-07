# kb Cloud Migration — Implementation Plan

> **For agentic workers:** Every build wave is dispatched to a codex worker via
> `scripts/codex_dispatch.py` (dispatch-codex skill), model verified per-card from
> the dispatch footer. The boss session governs: writes briefs, grades output,
> commits. Workers NEVER commit. Spec: `docs/superpowers/specs/2026-08-06-cloud-migration-design.md`.

**Goal:** All kb compute on one Hetzner CCX33 (Ubuntu 24.04) under systemd, reached via
SSH `-L` over Tailscale at `http://localhost:5317`; desktop runs only Tailscale + tunnel.

**Architecture:** Linux-only port (git handles the transition — local prod stays pinned
at pre-port SHA until cutover; zero `if (win32)` branches survive). PTY retired. Branch:
`claude/cloud-migration`, worktree `C:/Users/danie/kb-worktrees/boss-cloud-migration`.

## Global constraints (from spec — binding on every wave)

- No API keys ever; `claude -p` never `--bare`; credentials human-only; no agent spend.
- Node pinned **24.18.0** / npm **11.16.0** (`dashboard/package.json` engines, exact).
- Python: Ubuntu 24.04 ships 3.12; all `scripts/*.py` must run on 3.12 (local dev is 3.13).
- Strip-only TS; tsc baseline exactly 7 errors; vitest full-suite green per wave.
- State roots on Linux: `~/.local/state/kb-dashboard`, `~/.local/state/kb-codex-dispatch` (XDG).

---

## Wave 0 — Provision + auth (DANIEL'S RUNBOOK — no agent work except the verify script)

**Gate: pilot spend approval (Daniel ruled 2026-08-06: test before monthly commitment).**
Hetzner bills hourly capped at monthly, so a ~2-week pilot ≈ $15–25 total, cancel anytime.
Pilot box: **shared-CPU CPX line, Ashburn** (same region as the durable target so measured
latency is real; pick the ~16 GB or ~32 GB CPX tier at order time). The durable **CCX33
(~$167/mo)** decision moves AFTER the pilot, justified by a week of measured load
(RAM high-water, CPU steal, run wall-times). Rest of the runbook is identical for the pilot.

1. Hetzner Cloud console → order the pilot box (CPX tier, location **Ashburn (ash)**, image
   **Ubuntu 24.04**; backups optional for a pilot). Add your SSH public key at order time.
2. As root on the VM:
   ```bash
   adduser kb && usermod -aG sudo kb
   apt update && apt install -y git python3 python3-venv python3-pip ffmpeg build-essential curl dbus-user-session gnome-keyring
   loginctl enable-linger kb
   curl -fsSL https://tailscale.com/install.sh | sh && tailscale up   # auth link opens on your desktop browser
   ```
3. As `kb` — node exactly 24.18.0 via fnm:
   ```bash
   curl -fsSL https://fnm.vercel.app/install | bash && exec $SHELL
   fnm install 24.18.0 && fnm default 24.18.0 && npm i -g npm@11.16.0
   npm i -g @anthropic-ai/claude-code @openai/codex
   ```
4. Auth (hands-on, never in repo):
   ```bash
   claude setup-token        # 1-year subscription OAuth token; paste flow via desktop browser
   install -m 600 /dev/null ~/.config/kb/env && echo 'CLAUDE_CODE_OAUTH_TOKEN=<token>' >> ~/.config/kb/env
   codex login --device-auth # enter code in desktop browser; requires device-auth enabled in ChatGPT security settings
   ```
5. Desktop (PowerShell, as a startup task):
   ```powershell
   ssh.exe -N -L localhost:5317:127.0.0.1:5317 kb@<tailscale-machine-name>
   ```
6. **Reboot the VM. Then the exit test** (script from step 7): `claude -p 'ok'` and
   `codex exec 'say ok'` succeed with no interactive login; `codex login status` shows
   ChatGPT account with file-backed `~/.codex/auth.json` mode 600; `env | grep -E
   'ANTHROPIC|OPENAI'` empty; `python3 -c 'import http.server'`-served placeholder on
   :5317 reachable from the desktop browser at `http://localhost:5317`.
   - **Ruling 2026-08-06 (Daniel, live during Wave 0):** headless gnome-keyring failed
     the viability test (login collection cannot be created without a login session);
     the spec's fallback — protected `auth.json` — is ACCEPTED. `vm_verify.sh` encodes
     the file-backed check.
7. Codex worker deliverable (only agent work this wave): `scripts/vm_verify.sh` encoding
   the exit test as one idempotent script with PASS/FAIL lines per check.

**Exit:** all four spec exit-conditions evidenced by `vm_verify.sh` output post-reboot.

## Wave 1a — codex_dispatch POSIX port (parallel with 1b; dispatchable NOW)

**Files:** `scripts/codex_dispatch.py` (+ its test pattern if present, else `scripts/tests/test_codex_dispatch_posix.py`).

- Replace `taskkill /PID <pid> /T /F` with POSIX process-group kill: spawn workers with
  `start_new_session=True`; kill via `os.killpg(os.getpgid(pid), SIGTERM)` → grace →
  `SIGKILL`. Keep Windows branch working until cutover? **No — Linux-only per spec**, but
  this script still RUNS on Windows until cutover: this is the ONE file where a platform
  branch is permitted during transition (`os.name == 'nt'` keeps today's taskkill path;
  the branch is deleted in Wave 4). List it in the wave report.
- Replace `tasklist`-based liveness with PID + process-start-time comparison (fixes the
  documented Linux bug: dead PIDs currently read as alive, blocking orphan sweep).
- State root: `%LOCALAPPDATA%\kb-codex-dispatch` → resolver honoring
  `KB_CODEX_DISPATCH_STATE` env, defaulting to XDG `~/.local/state/kb-codex-dispatch`
  on POSIX, current LOCALAPPDATA path on Windows.
- Timeout kill must reap the whole group (fixes: Linux fallback killed only direct child).
- Confirm 3.12 compatibility (no 3.13-only syntax) across `scripts/*.py` touched.

**Exit:** unit tests for group-kill, liveness (dead-PID case), state-root resolution —
green on Windows locally; wave report lists the single permitted platform branch.

## Wave 1b — interpreter + path resolvers in TS (parallel with 1a)

**Files:** `broker/preambleGate.ts:33`, the six dashboard runtime `py -3` spawn sites
(grep `py -3` / `['py','-3']` across `dashboard/` — enumerate in report), plus one new
shared `dashboard/server/platform/python.ts` (resolver: `KB_PYTHON` env → default
`python3` on POSIX, `py -3` on win32 — the win32 default dies at cutover but costs one
line) and `dashboard/server/platform/stateDir.ts` (XDG resolver replacing
`%LOCALAPPDATA%\kb-dashboard`).

- One resolver, imported everywhere — no scattered per-file fixes (spec P1/P7).
- Update HEARTBEAT/skill instruction text that hardcodes `py -3` (enumerate hits).

**Exit:** vitest green (new resolver tests + full suite), tsc baseline 7, report
enumerates every converted spawn site and every doc-text hit.

## Wave 1c — systemd substrate (after 1b lands; VM not required to author)

**Files:** new `deploy/systemd/` (user units: `kb-dashboard.service`, tunnel docs),
`dashboard/pm2.config.cjs` retired → unit files; `dashboard/server/runner/trigger.ts:48`
schtasks → direct spawn under the user manager with PID+start-time liveness;
`dashboard/ALWAYS-ON.md` rewritten for systemd.
P5 sweep: enumerate every caller of `agent_runner.ps1` / `desktop_dispatch.ps1` /
`desktop_poll.ps1` / sentinel / keep-awake FIRST; retire uncalled scripts, port only the
called subset. keep-awake + `pty_host_launch.cmd` deleted.

**Exit:** unit files lint (`systemd-analyze verify` deferred to VM; syntax-checked),
trigger.ts tests green, report = enumeration table (caller → retire/port decision).

## Wave 1d — PTY retirement (after 1b/1c land; conflicts with their wiring)

**Files:** delete `dashboard/server/pty/`, its routes registration, UI entry points
(terminal tab/affordance), `route.test.ts`; tombstone note in
`dashboard/docs/design-brief.md` (interaction model = RunDetail graph + AgentWorkPanel
+ gates, per 2026-08-06 ruling).

**Exit:** vitest + tsc green with the subsystem gone; grep proves zero dangling imports;
UI builds with no terminal affordance.

## Wave 1-final — Linux acceptance (requires Wave 0 VM)

Clone branch on VM, `npm ci` (engines enforce 24.18.0), full vitest ON LINUX, systemd
units started, spec Phase-1 exit run: daemon on 5317, bridge tick claims+dispatches a
test card, one codex worker completes a governed attempt, journald clean over 3 ticks.
Codex worker runs ON THE VM via SSH from a dispatched brief only if dispatch itself is
proven; else this wave is boss-driven over SSH with evidence pasted.

## Wave 3 — State migration + cutover (Daniel schedules the quiescent window)

Runbook authored by codex worker from spec Phase-3 order (drain → push-all → copy
control-plane.json/ledgers/threads.json/composer+SECRET → recreate worktrees → acceptance
run). Boss executes it live with Daniel. Exit = spec success-condition run evidenced +
zero unpushed refs.

## Wave 4 — Decommission

Runbook: stop/remove local pm2 + schtasks + sentinel; delete Wave-1a's Windows branch in
codex_dispatch.py; 2-week inert rollback window; 48h clean-audit exit per spec.

## Atlas (separate plan)

Written AFTER Wave 3 cutover, opening with the read-only `atlas/` sweep the spec mandates.

---

## Self-review notes

- Spec coverage: P1→1b, P2/P3/P5→1c, P4→1a, P6→1d, P7→1b; Phase 0/3/4 → Waves 0/3/4. ✔
- The single permitted transitional platform branch (1a) and the one-line win32 default
  (1b) are each named, justified, and scheduled for deletion in Wave 4. ✔
- No task references undefined names; resolver module names fixed here and reused in 1c/1d briefs. ✔
