# Overnight keep-awake — design

**Date:** 2026-07-20
**Author:** claude (session with Daniel)
**Status:** approved for implementation
**Branch:** `claude/overnight-keep-awake`

## Problem

An interactive Claude Code session running overnight in a VS Code terminal died when the
laptop screen was closed. The session reported `API Error: Stream idle timeout - no chunks
received`, showed ~9 hours of wall-clock "cogitating", and resumed the moment the lid opened.

### Evidence

`powercfg /a` — this machine supports **only Modern Standby (S0 Low Power Idle)**. No S3.
Modern Standby behaves very differently from classic sleep: the OS keeps the session
notionally alive but aggressively powers down hardware, including the NIC.

Kernel-Power event log for the night in question:

```
3:36:51 AM   506  entering Modern Standby
3:51:51 AM   507  exiting Modern Standby
3:51:56 AM    42  The system is entering sleep        <-- lid close
3:51:58 AM   107  resumed from sleep
   ... 7h 54m of total silence ...
11:45:58 AM  506/507  standby cycle resumes           <-- screen opened
```

The mechanism that actually killed the HTTP stream, logged earlier the same night:

```
1:17:48 AM  172  Connectivity in standby: Disconnected, Reason: Adaptive Connected Standby
1:22:23 AM  172  Connectivity in standby: Disconnected, Reason: Policy Setting
```

Causal chain: lid close → S0 standby → Windows tears down Wi-Fi by policy → the streaming
HTTPS response from the API stops delivering chunks → Claude Code's stream idle timeout
fires. The process stayed resident, so wall-clock kept counting; on resume the NIC returned
and the request retried.

### Contributing configuration

- Active scheme: Balanced. `STANDBYIDLE` = 1200s AC / 1800s DC.
- The lid-action key was absent from the active scheme, so it inherited the default
  **1 = Sleep**. Closing the lid commands sleep directly.
- **No keep-awake mechanism has ever existed in this repo.** A search for
  `SetThreadExecutionState`, `powercfg`, `caffeine`, keep-awake, and modern-standby across
  all `.md`/`.ps1`/`.py` files returned zero matches. The prior assumption that overnight
  runs were protected was false.

## Goals

1. Agent work running on this machine survives a closed lid on AC power.
2. Coverage is not Claude-specific. Any worker — a Claude session, `codex exec` under
   `scripts/agent_runner.ps1`, the dashboard daemon — can hold the machine awake.
3. Coverage includes subagents and Workflow-spawned agents, not just main-loop tool calls.
4. When no work is running, the laptop behaves exactly as it does today.
5. No single failure can leave the machine permanently unable to sleep.

## Non-goals

- **Battery (DC) is out of scope.** DC power settings stay untouched, so on battery the
  machine still sleeps normally. A runaway lease must not be able to flatten the battery in
  a closed bag. Consequence, accepted explicitly: work running on battery overnight will
  still die.
- Not fixing Claude Code's stream-retry behavior. Out of our control.
- Not adding a preamble gate (proposed as "Layer 3", deferred by Daniel).

## Architecture

One script, `scripts/keep_awake.ps1`, plus a lease store and hook wiring. Nothing is
installed into Task Scheduler; no service is registered.

### Components

**Lease store** at `%LOCALAPPDATA%\kb-keepawake\`:

- `leases\<label>.lease` — JSON, e.g.
  `{"pid": 12345, "label": "claude-abc123", "mode": "idle-expiry",
    "acquired": "2026-07-20T03:36:51+09:00", "heartbeat": "2026-07-20T03:44:02+09:00",
    "cpu_sample": 184.75}`
- `armed.json` — the **original** powercfg values captured before arming, so restore is
  exact rather than an assumed return to Balanced defaults, e.g.
  `{"armed_at": "2026-07-20T03:36:51+09:00", "scheme": "381b4222-…",
    "original": {"lidaction_ac": 1, "standbyidle_ac": 1200, "hibernateidle_ac": 900}}`
- `keepawake.log` — append-only. Timestamp format `yyyy-MM-ddTHH:mm:sszzz`, matching the
  `Write-RunnerLog` style already used by `scripts/agent_runner.ps1` and
  `scripts/desktop_dispatch.ps1`.

**Script modes:**

| Mode | Purpose |
|---|---|
| `-Acquire -Label X [-Mode pid-only\|idle-expiry]` | Register a lease; spawn supervisor if none is running |
| `-Heartbeat -Label X` | Refresh a lease's heartbeat timestamp |
| `-Release -Label X` | Drop a lease |
| `-Status` | Report leases, armed state, supervisor liveness |
| `-Repair` | Force-restore powercfg from `armed.json` and exit |
| `-Supervise` | Internal; the supervisor loop |

**Supervisor.** Spawned on demand by the first `-Acquire`, detached. It is the single owner
of both the awake-hold and the powercfg change:

- Holds `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` for its lifetime.
- Arms powercfg on first live lease, restores on last.
- Polls every 60s.

**Supervisor singleton.** Exactly one supervisor may exist, or two could race on arming and
restoring and leave the scheme half-written. Enforced by a **named system mutex**
(`Global\kb-keepawake-supervisor`), not by a PID file — a PID file alone is racy, since two
`-Acquire` calls can both observe "no supervisor" before either spawns. A `supervisor.pid`
file is still written alongside it for `-Status` reporting and human debugging, but the
mutex is the authority. A supervisor that fails to take the mutex exits immediately and
silently; that is the normal, expected outcome of a concurrent-spawn race.

**Re-acquire is idempotent.** `-Acquire` with an existing label updates that lease's `pid`,
`heartbeat`, and `cpu_sample` in place rather than creating a duplicate or failing. This
matters because `SessionStart` fires on resume as well as on fresh start, so the same label
can legitimately be acquired more than once.

### Why a supervisor rather than per-worker holders

`ES_SYSTEM_REQUIRED` is already OS-refcounted — the system stays awake while any process
holds it — so the awake-hold needs no coordination of its own. But the lid/standby powercfg
change is **global machine state**. Exactly one process must own arming and disarming it, or
two workers racing produce a half-restored power scheme.

## Liveness detection

This is the core of the design and the part that took the most iteration.

### Why hooks alone are insufficient

Research against the official Claude Code hooks documentation established:

- There are **no periodic, interval, or heartbeat hooks**. Every hook is lifecycle-triggered.
- **`SessionEnd` is not guaranteed on abnormal termination** — process kill, crash, or
  machine sleep. That is exactly our failure scenario.
- Hook behavior for **Workflow-tool-spawned agents is undocumented**.
- The documentation is internally ambiguous about whether background subagents produce
  parent-visible `PreToolUse`/`PostToolUse` events. `SubagentStart`/`SubagentStop` do exist
  and do fire.

A hook-driven heartbeat would therefore work for ordinary tool loops and silently fail
during a Workflow run — dropping the lease mid-run, reproducing the exact bug being fixed.

### Why CPU alone is insufficient

Process-tree CPU is a good positive signal for tool execution, subagents, Workflow fan-outs,
and spawned `codex exec` children. But a session blocked on a long model API call is
network-waiting and burns almost no CPU. CPU alone would read that as idle.

### Resolution: union of positive signals

A lease is considered **active** if *either* signal has fired within the idle window. The
idle timeout expires a lease only when **neither** has fired.

1. **Process-tree CPU delta.** Each poll, sum `TotalProcessorTime` across the lease's PID and
   its descendants; compare against the stored `cpu_sample`. A delta above the activity
   threshold refreshes the heartbeat.
2. **Hook events.** `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
   `SubagentStart`, `SubagentStop` all call `-Heartbeat`. These are treated as positive
   evidence only — never depended on for correctness.

Both signals are advisory-positive; neither is load-bearing alone. This is deliberate:
each covers the other's blind spot.

### Lease modes

- **`idle-expiry`** (default; interactive Claude sessions). Subject to the idle timeout, so
  an abandoned VS Code terminal releases on its own.
- **`pid-only`** (bounded worker processes, e.g. `agent_runner.ps1`). No idle expiry — PID
  liveness is the correct and sufficient signal for a process that exits when its work is
  done. Avoids a false idle-expiry on a long, quiet `codex exec`.

## Power configuration (Layer 1)

Armed only while at least one lease is live. AC values only.

| Setting | Armed value | Restored to |
|---|---|---|
| `SUB_BUTTONS` / lid action (`5ca83367-…`) | `0` (Do nothing) | saved original |
| `SUB_SLEEP` / `STANDBYIDLE` | `0` (Never) | saved original |
| `SUB_SLEEP` / `HIBERNATEIDLE` | `0` (Never) | saved original |

Applied with `powercfg /setacvalueindex …` followed by `powercfg /setactive SCHEME_CURRENT`.

**Verified:** these writes succeed **unelevated** (tested 2026-07-20, both exited 0).
Note that `powercfg /requests` *does* require elevation, so `-Status` reports lease and
armed state but cannot enumerate live OS power requests unless run elevated.

Display timeout is intentionally left alone — the screen may go dark, that is fine and
saves power.

## Failure modes and recovery

The governing invariant: **no single failure leaves the machine permanently unable to sleep.**

| Failure | Behavior |
|---|---|
| Worker crashes | PID dead → supervisor prunes the lease. No leak. |
| `SessionEnd` never fires | Same as above; PID-liveness is the real release path. `SessionEnd` is a best-effort optimization only. |
| Worker hangs alive but idle | Idle timeout expires the lease despite a live PID (`idle-expiry` mode). |
| Supervisor crashes | OS auto-releases the awake-hold on process death. `armed.json` persists; the next `-Acquire` adopts it, or `-Repair` restores immediately. |
| Machine hard-crashes / power loss | `armed.json` survives reboot. First `-Acquire` adopts and eventually restores; `-Status` flags the stale armed state. |
| powercfg write fails mid-arm | Supervisor logs loudly and exits rather than half-arming; `armed.json` is written *before* the first mutation so partial state is always recoverable. |
| Everything goes wrong | Absolute cap: supervisor force-disarms and exits after `MaxHours`. |

## Configuration defaults

| Setting | Default | Rationale |
|---|---|---|
| Idle timeout | 15 min | Comfortably bridges a long model call or a quiet Workflow stage |
| Absolute cap | 16 h | Longer than any legitimate overnight run; a true backstop |
| Supervisor poll | 60 s | Cheap; bounds worst-case disarm lag to one minute |
| CPU activity threshold | 2 s CPU per 60 s poll | ~3% of one core — above idle-process noise, below any real work |

## Hook wiring

Hooks go in the **global** `~/.claude/settings.json`, referencing the kb script by absolute
path. Rationale: this is machine-level power management, not repo-specific behavior, and
Daniel may run agent work outside `kb`. No `hooks` key exists there today, and the project
has no `.claude/settings.json` at all, so this is additive.

| Event | Action |
|---|---|
| `SessionStart` | `-Acquire -Label claude-<session_id> -Mode idle-expiry` |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop` | `-Heartbeat -Label claude-<session_id>` |
| `SessionEnd` | `-Release -Label claude-<session_id>` (best-effort) |

Heartbeat hooks must be cheap and non-blocking — they fire on every tool call. Implemented
as a single timestamp write, and configured `async: true` so they never gate the agent loop.

`scripts/agent_runner.ps1` calls `-Acquire -Mode pid-only` after its preamble gate and
`-Release` at run end.

## Testing

**Unit (Pester), pure logic — no power mutation:**

- Lease pruning: dead PID pruned; live PID retained.
- Idle expiry: heartbeat older than timeout expires in `idle-expiry`, retained in `pid-only`.
- CPU delta: a delta above threshold refreshes the heartbeat; below does not.
- Refcount: arming happens once on 0→1 leases; restore once on 1→0; no-op at 2→1.
- `armed.json` round-trip: saved values restore exactly, including absent-key cases.
- Adoption: a stale `armed.json` with no live supervisor is adopted, not overwritten.
- Re-acquire idempotency: acquiring an existing label updates it in place; lease count stays 1.
- Supervisor singleton: a second supervisor that cannot take the mutex exits without
  touching powercfg or the lease store.

Power mutation is behind a single injectable seam so unit tests exercise the state machine
without touching real machine config.

**Integration (manual, requires acknowledging real power changes):**

1. `-Acquire`, then verify via `powercfg /query` that lid/standby reflect armed values.
2. `-Status` shows the lease and armed state.
3. `-Release`, then verify original values restored exactly.
4. Kill the supervisor mid-hold; confirm `-Repair` restores.

**End-to-end:** the real acceptance test is an overnight run with the lid closed. Cannot be
automated; Daniel validates.

## Risks

- **Thermal.** Sustained load with the lid shut restricts airflow. Mitigated by AC-only
  scope and the 16h cap, but it is a real physical consequence Daniel accepted.
- **Security.** While armed, lid close no longer sleeps the machine, so it stops acting as a
  de-facto lock. Screen lock policy is unchanged and independent, but the practical posture
  differs. Scope-limited by arming only while work runs.
- **Undocumented hook behavior.** If Workflow agents emit no hook events, the CPU signal
  carries those runs alone. This is why the union design exists; it degrades rather than fails.
