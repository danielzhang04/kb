# Keep-Awake Supervisor Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the keep-awake supervisor survive the lease-file write race that killed it overnight (2026-08-12 01:29), and self-heal if it ever dies again.

**Architecture:** Three independent layers in `scripts/KeepAwake/KeepAwake.psm1` + `scripts/keep_awake.ps1`: (F1) kernel-atomic `MoveFileExW` replace in `Write-JsonFileAtomic`, (F2) try/catch + consecutive-failure cap around the supervisor pass, (F3) heartbeat-path watchdog that respawns a dead supervisor. Spec: `docs/specs/2026-08-12-keepawake-supervisor-hardening.md` (read it first).

**Tech Stack:** PowerShell 5.1, Pester (match the existing style in `scripts/KeepAwake/KeepAwake.Tests.ps1` — read that file's conventions before writing any test), P/Invoke via `Add-Type`.

## Global Constraints

- Work ONLY in the worktree `C:/Users/danie/kb-worktrees/keepawake-hardening`, branch `claude/keepawake-hardening`. Never push to `main`.
- Files in scope: `scripts/KeepAwake/KeepAwake.psm1`, `scripts/KeepAwake/KeepAwake.Tests.ps1`, `scripts/keep_awake.ps1`. Nothing else.
- All 76 existing Pester tests must stay green after every task. Run:
  `powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Pester -Path scripts/KeepAwake/KeepAwake.Tests.ps1 -Output Detailed"` (adjust `-Output` if the installed Pester is v3/v4 — discover by running the suite once before changing anything).
- Tests must NEVER touch the real lease store or real power settings: always set `$env:KB_KEEPAWAKE_ROOT` to a temp dir and inject a fake `PowerProvider` (existing tests show the pattern — copy it).
- A REAL supervisor is running on this machine right now. Tests must not interact with it (Task 2 adds mutex isolation for exactly this reason; do not write loop tests before that isolation exists).
- Module runs under `Set-StrictMode -Version Latest` — dot-access to absent hashtable keys THROWS; use indexer access (existing comments explain).
- Comments follow the module's house style: explain constraints/why, never narrate what the next line does.

---

### Task 1: F1 — kernel-atomic replace in Write-JsonFileAtomic

**Files:**
- Modify: `scripts/KeepAwake/KeepAwake.psm1` (function `Write-JsonFileAtomic`, ~line 53; `Add-Type` block ~line 622)
- Test: `scripts/KeepAwake/KeepAwake.Tests.ps1`

**Interfaces:**
- Consumes: existing `Write-JsonFileAtomic -Path <string> -Data <obj>`.
- Produces: same signature, same "reader always sees fully-old or fully-new JSON" contract, but replace step is `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)` with 3-attempt retry; throws a descriptive error only after all attempts fail. Later tasks rely on the throw (F2 catches it in the supervisor; the Heartbeat CLI already catches and exits 0).

- [ ] **Step 1: Run the existing suite once, unchanged** — record pass count and Pester version. Expected: 76 pass.

- [ ] **Step 2: Write the failing tests**

Add to the Tests file (adapt Describe/Context naming to the file's existing conventions):

```powershell
Describe 'Write-JsonFileAtomic concurrency' {
    BeforeEach {
        $script:root = Join-Path $env:TEMP ("ka-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root | Out-Null
        $env:KB_KEEPAWAKE_ROOT = $script:root
    }
    AfterEach {
        Remove-Item $script:root -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'survives two concurrent writers hammering the same path' {
        $target = Join-Path $script:root 'contended.lease'
        $modPath = (Resolve-Path "$PSScriptRoot\KeepAwake.psm1").Path
        $writer = {
            param($ModPath, $Target, $Tag)
            Import-Module $ModPath -Force
            for ($i = 0; $i -lt 200; $i++) {
                Write-JsonFileAtomic -Path $Target -Data @{ tag = $Tag; i = $i }
            }
        }
        $j1 = Start-Job -ScriptBlock $writer -ArgumentList $modPath, $target, 'a'
        $j2 = Start-Job -ScriptBlock $writer -ArgumentList $modPath, $target, 'b'
        $out = Receive-Job -Job $j1, $j2 -Wait -AutoRemoveJob -ErrorAction Stop
        # The old Move-Item -Force implementation throws
        # "Cannot create a file when that file already exists" here.
        (Get-Content $target -Raw | ConvertFrom-Json).tag | Should -BeIn @('a', 'b')
    }

    It 'file content is never torn mid-write' {
        $target = Join-Path $script:root 'contended.lease'
        Write-JsonFileAtomic -Path $target -Data @{ tag = 'seed'; i = 0 }
        $modPath = (Resolve-Path "$PSScriptRoot\KeepAwake.psm1").Path
        $writerJob = Start-Job -ScriptBlock {
            param($ModPath, $Target)
            Import-Module $ModPath -Force
            for ($i = 0; $i -lt 300; $i++) { Write-JsonFileAtomic -Path $Target -Data @{ tag = 'w'; i = $i } }
        } -ArgumentList $modPath, $target
        for ($r = 0; $r -lt 300; $r++) {
            $raw = $null
            try { $raw = [System.IO.File]::ReadAllText($target) } catch { continue } # reader may race the replace instant; only content matters
            if ($raw) { { $raw | ConvertFrom-Json | Out-Null } | Should -Not -Throw }
        }
        Receive-Job -Job $writerJob -Wait -AutoRemoveJob -ErrorAction Stop
    }
}
```

Note on the first test: with the OLD implementation the collision is probabilistic per run but 400 racing writes reproduce it reliably (it fired 358 times in ~3 weeks of light production traffic; back-to-back tight loops collide within a few hundred iterations). If it happens to pass on a given run, that's a flake of the OLD code, not the new — run it twice to observe at least one failure before implementing.

- [ ] **Step 3: Run the new tests, verify at least one fails against the old implementation** with `Cannot create a file when that file already exists`.

- [ ] **Step 4: Implement**

In the `Add-Type` block region (~line 622), add a second native signature. Keep the existing `KbPower.Native` untouched (its `-ErrorAction SilentlyContinue` means a partial prior load must not hide the new member — a separate type is safer):

```powershell
Add-Type -Namespace KbPower -Name FileNative -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool MoveFileExW(string lpExistingFileName, string lpNewFileName, uint dwFlags);
'@ -ErrorAction SilentlyContinue
$script:MOVEFILE_REPLACE_EXISTING = [uint32]0x1
```

Replace the `Move-Item -Force` line inside `Write-JsonFileAtomic` with (preserve the existing header comment, updating its reasoning: delete-then-create was the race):

```powershell
$Data | ConvertTo-Json -Compress -Depth 5 | Set-Content -Path $tmp -Encoding utf8
$lastWin32 = 0
for ($attempt = 1; $attempt -le 3; $attempt++) {
    if ([KbPower.FileNative]::MoveFileExW($tmp, $Path, $script:MOVEFILE_REPLACE_EXISTING)) { return }
    $lastWin32 = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Start-Sleep -Milliseconds (15 + (Get-Random -Maximum 26))
}
throw "Write-JsonFileAtomic: MoveFileExW failed for '$Path' after 3 attempts (win32=$lastWin32)"
```

(The `finally` block's temp-file cleanup stays exactly as is.)

- [ ] **Step 5: Run the full suite** — new tests pass, all pre-existing tests pass.

- [ ] **Step 6: Commit** — `fix(keepawake): atomic MoveFileExW replace ends lease-file write race`

---

### Task 2: F2 — exception-proof supervisor loop (with test-isolated mutex)

**Files:**
- Modify: `scripts/KeepAwake/KeepAwake.psm1` (`Start-KeepAwakeSupervisor`, ~line 737)
- Test: `scripts/KeepAwake/KeepAwake.Tests.ps1`

**Interfaces:**
- Consumes: `Invoke-SupervisorPass` (unchanged).
- Produces: `Set-SupervisorPassInvoker([scriptblock])` test seam (same style as `Set-PowerProvider`); `Get-KeepAwakeMutexName` returning `'Global\kb-keepawake-supervisor'` in production and a root-suffixed name when `$env:KB_KEEPAWAKE_ROOT` is set; `Start-KeepAwakeSupervisor` exit code **2** = persistent pass failure (0 = no-live-leases, 3 = MaxHours cap, unchanged). Task 3 relies on none of these; the live-fire in Task 4 relies on honest crash logging (`supervisor-pass-ERROR`, `supervisor-FAILING-persistently`).

- [ ] **Step 1: Write the failing tests**

```powershell
Describe 'Start-KeepAwakeSupervisor pass-failure resilience' {
    # BeforeEach/AfterEach: temp KB_KEEPAWAKE_ROOT + fake PowerProvider,
    # copied from the existing supervisor tests' setup pattern.

    It 'derives an isolated mutex name under KB_KEEPAWAKE_ROOT' {
        Get-KeepAwakeMutexName | Should -Not -Be 'Global\kb-keepawake-supervisor'
    }

    It 'survives transient pass failures and exits 0 when leases drain' {
        $script:calls = 0
        Set-SupervisorPassInvoker {
            param($Now, $IdleTimeoutMinutes, $CpuThreshold)
            $script:calls++
            if ($script:calls -le 3) { throw 'injected transient failure' }
            return @{ LiveCount = 0; Pruned = @(); Armed = $false; ImmediatePruned = @() }
        }
        Start-KeepAwakeSupervisor -PollSeconds 0 | Should -Be 0
        $script:calls | Should -Be 4
    }

    It 'exits 2 after 10 consecutive pass failures' {
        $script:calls = 0
        Set-SupervisorPassInvoker { $script:calls++; throw 'injected persistent failure' }
        Start-KeepAwakeSupervisor -PollSeconds 0 | Should -Be 2
        $script:calls | Should -Be 10
    }

    It 'a success resets the consecutive-failure counter' {
        $script:calls = 0
        Set-SupervisorPassInvoker {
            $script:calls++
            # 9 failures, one success (live lease so the loop continues), 9 more failures, then drain:
            if ($script:calls -eq 10) { return @{ LiveCount = 1; Pruned = @(); Armed = $true; ImmediatePruned = @() } }
            if ($script:calls -eq 20) { return @{ LiveCount = 0; Pruned = @(); Armed = $false; ImmediatePruned = @() } }
            throw 'injected'
        }
        Start-KeepAwakeSupervisor -PollSeconds 0 | Should -Be 0
        $script:calls | Should -Be 20
    }
}
```

(Also assert via the log file that `supervisor-pass-ERROR` and `supervisor-FAILING-persistently` lines were written — the log lands in `$env:KB_KEEPAWAKE_ROOT\keepawake.log`.)

The `LiveCount = 0` returns also exercise `Test-SupervisorShouldContinueAfterEmptyPass`; with an empty temp lease dir it reports 0 live and the loop exits — no stub needed.

- [ ] **Step 2: Run new tests, verify they fail** (`Get-KeepAwakeMutexName`/`Set-SupervisorPassInvoker` not defined; loop dies on first injected throw).

- [ ] **Step 3: Implement**

Mutex isolation (place near `Get-KeepAwakeRoot`; export it):

```powershell
# Production keeps the historical fixed name. Under KB_KEEPAWAKE_ROOT (tests,
# parallel sandboxes) the name is suffixed with a hash of the root so a test
# supervisor can never collide with -- or be shadowed by -- the real one.
function Get-KeepAwakeMutexName {
    if (-not $env:KB_KEEPAWAKE_ROOT) { return 'Global\kb-keepawake-supervisor' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = [System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($env:KB_KEEPAWAKE_ROOT))).Replace('-', '').Substring(0, 16)
    return "Global\kb-keepawake-supervisor-$hash"
}
```

Pass-invoker seam (same style as `$script:PowerProvider`; export the setter):

```powershell
$script:SupervisorPassInvoker = {
    param($Now, $IdleTimeoutMinutes, $CpuThreshold)
    Invoke-SupervisorPass -Now $Now -IdleTimeoutMinutes $IdleTimeoutMinutes -CpuThreshold $CpuThreshold
}
function Set-SupervisorPassInvoker { param([Parameter(Mandatory)][scriptblock]$Invoker) $script:SupervisorPassInvoker = $Invoker }
```

In `Start-KeepAwakeSupervisor`: use `Get-KeepAwakeMutexName` for the mutex; rework the loop body:

```powershell
$consecutiveFailures = 0
while ($true) {
    if ((Get-Date) -ge $deadline) {
        Write-KeepAwakeLog "supervisor-CAP-REACHED after ${MaxHours}h -- force-disarming"
        $exit = 3
        break
    }
    try {
        $pass = & $script:SupervisorPassInvoker ([datetimeoffset]::Now) $IdleTimeoutMinutes $CpuThreshold
        $consecutiveFailures = 0
    } catch {
        # One racy/failed pass must never tear the supervisor down (the 2026-08-12
        # overnight outage was exactly this: a single lease-file write collision
        # escaped the loop, and the finally block disarmed with four live leases).
        $consecutiveFailures++
        Write-KeepAwakeLog ("supervisor-pass-ERROR consecutive=$consecutiveFailures :: $_")
        if ($consecutiveFailures -ge 10) {
            Write-KeepAwakeLog 'supervisor-FAILING-persistently 10 consecutive pass errors -- disarming and exiting'
            $exit = 2
            break
        }
        Start-Sleep -Seconds $PollSeconds
        continue
    }
    if ($pass.LiveCount -eq 0) {
        if (Test-SupervisorShouldContinueAfterEmptyPass) {
            Write-KeepAwakeLog 'supervisor-shutdown-race-AVOIDED lease appeared during final check -- resuming instead of exiting'
            continue
        }
        Write-KeepAwakeLog 'supervisor-exit reason=no-live-leases'
        break
    }
    Start-Sleep -Seconds $PollSeconds
}
```

(The surrounding mutex/pidfile/finally scaffolding is unchanged. Export both new functions in `Export-ModuleMember`.)

- [ ] **Step 4: Run the full suite** — all green.

- [ ] **Step 5: Commit** — `fix(keepawake): supervisor survives pass exceptions; exit 2 on persistent failure`

---

### Task 3: F3 — heartbeat watchdog respawns a dead supervisor

**Files:**
- Modify: `scripts/KeepAwake/KeepAwake.psm1` (new function + export)
- Modify: `scripts/keep_awake.ps1` (Heartbeat branch, ~line 98)
- Test: `scripts/KeepAwake/KeepAwake.Tests.ps1`

**Interfaces:**
- Consumes: `Get-KeepAwakeRoot`, `Get-KeepAwakeLeases`, `Test-ProcessAlive`.
- Produces: `Test-SupervisorRespawnNeeded` (module, exported) — returns `$true` iff at least one lease file exists AND no live supervisor is recorded. The CLI Heartbeat branch calls it and, when true, calls the existing `Start-DetachedSupervisor`.

- [ ] **Step 1: Write the failing tests**

```powershell
Describe 'Test-SupervisorRespawnNeeded' {
    # BeforeEach/AfterEach: temp KB_KEEPAWAKE_ROOT as in Task 1.

    It 'false when no leases exist, regardless of supervisor state' {
        Test-SupervisorRespawnNeeded | Should -BeFalse
    }

    It 'true when a lease exists and no pid file exists' {
        New-KeepAwakeLease -Label 't' -ProcessId $PID | Out-Null
        Test-SupervisorRespawnNeeded | Should -BeTrue
    }

    It 'true when a lease exists and the recorded pid is dead' {
        New-KeepAwakeLease -Label 't' -ProcessId $PID | Out-Null
        $dead = Start-Process powershell -ArgumentList '-NoProfile','-Command','exit' -PassThru -WindowStyle Hidden
        $dead.WaitForExit()
        Set-Content (Join-Path (Get-KeepAwakeRoot) 'supervisor.pid') -Value $dead.Id -Encoding utf8
        Test-SupervisorRespawnNeeded | Should -BeTrue
    }

    It 'false when a lease exists and the recorded pid is alive' {
        New-KeepAwakeLease -Label 't' -ProcessId $PID | Out-Null
        Set-Content (Join-Path (Get-KeepAwakeRoot) 'supervisor.pid') -Value $PID -Encoding utf8
        Test-SupervisorRespawnNeeded | Should -BeFalse
    }

    It 'true when the pid file is unreadable garbage' {
        New-KeepAwakeLease -Label 't' -ProcessId $PID | Out-Null
        Set-Content (Join-Path (Get-KeepAwakeRoot) 'supervisor.pid') -Value 'not-a-pid' -Encoding utf8
        Test-SupervisorRespawnNeeded | Should -BeTrue
    }
}
```

- [ ] **Step 2: Run new tests, verify they fail** (function not defined).

- [ ] **Step 3: Implement module function**

```powershell
# The overnight failure mode this closes: the supervisor dies (crash, kill,
# anything), and until the next SessionStart nothing respawns it -- Heartbeat
# was a pure lease write. Heartbeat fires on every tool call of every session,
# so it is the one signal guaranteed to still be firing overnight while work
# runs. Duplicate spawns are safe: the named mutex arbitrates, losers exit.
function Test-SupervisorRespawnNeeded {
    $leases = @(Get-KeepAwakeLeases)
    if ($leases.Count -eq 0) { return $false }
    $pidFile = Join-Path (Get-KeepAwakeRoot) 'supervisor.pid'
    if (-not (Test-Path $pidFile)) { return $true }
    try {
        $sp = [int](Get-Content $pidFile -Raw -ErrorAction Stop).Trim()
    } catch { return $true }
    if ($sp -le 0) { return $true }
    return (-not (Test-ProcessAlive -ProcessId $sp))
}
```

Add to `Export-ModuleMember`.

- [ ] **Step 4: Wire the CLI Heartbeat branch** (`scripts/keep_awake.ps1`):

```powershell
'Heartbeat' {
    if (-not $Label) { throw '-Label is required with -Heartbeat (or pass -FromStdin)' }
    Update-KeepAwakeLeaseHeartbeat -Label $Label | Out-Null
    # Watchdog: Heartbeat is the only hook guaranteed to keep firing overnight,
    # so it carries the respawn duty for a supervisor that died mid-run
    # (2026-08-12 outage). Start-DetachedSupervisor is idempotent via the mutex.
    if (Test-SupervisorRespawnNeeded) {
        Start-DetachedSupervisor
        Write-KeepAwakeLog ("supervisor-respawned-by-heartbeat label=$Label")
    }
}
```

(Keep the existing silent-no-op comment for the expired-lease case.)

- [ ] **Step 5: Run the full suite** — all green.

- [ ] **Step 6: Commit** — `feat(keepawake): heartbeat watchdog respawns dead supervisor`

---

### Task 4: Full-suite gate + live-fire verification + PR

**Files:** none new — verification and delivery only.

- [ ] **Step 1: Full suite, clean run count reported** (old 76 + new; zero failures, zero skips).

- [ ] **Step 2: Live-fire on the real machine** (real lease store, NO `KB_KEEPAWAKE_ROOT`):

```powershell
# 1. Snapshot: real supervisor pid from %LOCALAPPDATA%\kb-keepawake\supervisor.pid, armed state via -Status.
# 2. Kill it: Stop-Process -Id <pid> -Force   (this simulates last night's crash; machine disarms are NOT triggered by a hard kill -- armed.json remains)
# 3. Trigger one heartbeat through the NEW CLI in this worktree:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/keep_awake.ps1 -Heartbeat -Label live-fire-test
#    (First create the lease: -Acquire -Label live-fire-test -ProcessId <a real long-lived pid, e.g. this shell's $PID>.)
# 4. Verify within ~5s: new supervisor.pid, alive, keepawake.log shows supervisor-respawned-by-heartbeat then supervisor-start.
# 5. Verify re-arm: -Status shows armed True within one poll (60s).
# 6. Clean up: -Release -Label live-fire-test. Real sessions' leases keep the supervisor alive after cleanup.
```

Record every command + output in the task report. If step 4 or 5 fails, STOP and report — do not improvise fixes on the live store.

- [ ] **Step 3: Commit any test-only tweaks, push branch, open PR** to `main` titled `fix(keepawake): survive lease-write race + self-heal dead supervisor` with the incident timeline in the body. Do NOT merge.
