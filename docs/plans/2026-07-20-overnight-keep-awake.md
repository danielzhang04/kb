# Overnight Keep-Awake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop agent work on this machine from dying when the laptop lid closes, by holding a refcounted "lease" that keeps Windows awake only while work is actually running.

**Architecture:** A PowerShell module (`KeepAwake.psm1`) holds all logic behind two injectable seams — a filesystem root and a power provider — so the state machine is unit-testable without touching real machine config. A thin CLI (`keep_awake.ps1`) exposes Acquire/Heartbeat/Release/Status/Repair/Supervise. Exactly one supervisor process (enforced by a named mutex) owns both the `ES_SYSTEM_REQUIRED` awake-hold and the AC-only powercfg change, arming on the first live lease and restoring saved originals on the last.

**Tech Stack:** Windows PowerShell 5.1, Pester v5, Win32 `SetThreadExecutionState` via `Add-Type`, `powercfg.exe`, registry reads under `HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes`.

**Spec:** `docs/specs/2026-07-20-overnight-keep-awake-design.md` (commit `1b3d71e`)

## Global Constraints

- **AC power settings only.** Never write DC values. On battery the machine must still sleep.
- **Unelevated.** Every operation must succeed without admin. `powercfg /setacvalueindex` and `/setactive` are verified unelevated (tested 2026-07-20). `powercfg /requests` requires admin and must NOT be relied on.
- **No single failure may leave the machine permanently unable to sleep.** Every path that arms must have a path that restores.
- **Timestamp format:** `yyyy-MM-ddTHH:mm:sszzz`, matching `scripts/agent_runner.ps1`.
- **Lease store root:** `%LOCALAPPDATA%\kb-keepawake\`, overridable via `$env:KB_KEEPAWAKE_ROOT` (the filesystem test seam).
- **Defaults:** idle timeout 15 min; absolute cap 16 h; supervisor poll 60 s; CPU activity threshold 2.0 CPU-seconds per poll.
- **Power GUIDs:** lid action `5ca83367-6e45-459f-a27b-476b1d01c936` under `SUB_BUTTONS` (`4f971e89-eebd-4455-a8de-9e59040e7347`); `STANDBYIDLE` `29f6c1db-86da-48c5-9fdb-f2b67b1f44da` and `HIBERNATEIDLE` `9d7815a6-7ee4-497e-8888-515a05f02364` under `SUB_SLEEP` (`238c9fa8-0aad-41ed-83f4-97be242c8f20`).
- **Branch:** `claude/overnight-keep-awake`. Never push to `main` or `ops`.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/KeepAwake/KeepAwake.psm1` | All logic: lease CRUD, CPU probe, activity rules, power baseline/arm/restore, supervisor loop |
| `scripts/KeepAwake/KeepAwake.Tests.ps1` | Pester tests against the module, using both seams |
| `scripts/keep_awake.ps1` | Thin CLI dispatch; the only entry point hooks and runners call |
| `scripts/agent_runner.ps1` | Modified: acquire after preamble gate, release at run end |
| `~/.claude/settings.json` | Modified: `hooks` key wiring Claude session events to the CLI |

Module-plus-thin-CLI rather than one flat script: Pester can `Import-Module` the logic directly, and power mutations sit behind one swappable provider so tests never touch real machine config.

---

### Task 1: Module scaffold, paths, logging, lease CRUD

**Files:**
- Create: `scripts/KeepAwake/KeepAwake.psm1`
- Test: `scripts/KeepAwake/KeepAwake.Tests.ps1`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `Get-KeepAwakeRoot() -> string`, `Write-KeepAwakeLog([string]$Message) -> void`, `New-KeepAwakeLease([string]$Label, [string]$Mode, [int]$ProcessId, [double]$CpuSample) -> hashtable`, `Get-KeepAwakeLeases() -> hashtable[]`, `Remove-KeepAwakeLease([string]$Label) -> bool`, `Get-LeasePath([string]$Label) -> string`

- [ ] **Step 1: Confirm Pester v5 is available**

Run: `powershell -NoProfile -Command "Get-Module -ListAvailable Pester | Select-Object Name,Version"`
Expected: a Pester entry with Version 5.x. If only 3.4.0 (the Windows in-box version) is present, run `Install-Module Pester -Scope CurrentUser -Force -SkipPublisherCheck` and re-check.

- [ ] **Step 2: Write the failing test**

Create `scripts/KeepAwake/KeepAwake.Tests.ps1`:

```powershell
BeforeAll {
    $script:ModulePath = Join-Path $PSScriptRoot 'KeepAwake.psm1'
    Import-Module $script:ModulePath -Force
}

Describe 'lease store' {
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'honours the KB_KEEPAWAKE_ROOT override' {
        Get-KeepAwakeRoot | Should -Be $script:TestRoot
    }

    It 'creates a lease and reads it back' {
        New-KeepAwakeLease -Label 'claude-abc' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 1.5 | Out-Null
        $leases = @(Get-KeepAwakeLeases)
        $leases.Count | Should -Be 1
        $leases[0].label | Should -Be 'claude-abc'
        $leases[0].mode  | Should -Be 'idle-expiry'
        $leases[0].pid   | Should -Be $PID
    }

    It 'is idempotent on re-acquire: updates in place, does not duplicate' {
        New-KeepAwakeLease -Label 'claude-abc' -Mode 'idle-expiry' -ProcessId 1111 -CpuSample 1.0 | Out-Null
        New-KeepAwakeLease -Label 'claude-abc' -Mode 'idle-expiry' -ProcessId 2222 -CpuSample 9.0 | Out-Null
        $leases = @(Get-KeepAwakeLeases)
        $leases.Count | Should -Be 1
        $leases[0].pid | Should -Be 2222
    }

    It 'removes a lease' {
        New-KeepAwakeLease -Label 'claude-abc' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        Remove-KeepAwakeLease -Label 'claude-abc' | Should -BeTrue
        @(Get-KeepAwakeLeases).Count | Should -Be 0
    }

    It 'sanitises labels so they cannot escape the lease directory' {
        New-KeepAwakeLease -Label '../../evil' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        $leaseDir = Join-Path $script:TestRoot 'leases'
        @(Get-ChildItem $leaseDir -Filter *.lease).Count | Should -Be 1
        (Get-LeasePath -Label '../../evil') | Should -BeLike "$leaseDir*"
    }

    It 'ignores corrupt lease files rather than throwing' {
        New-KeepAwakeLease -Label 'good' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        Set-Content -Path (Join-Path $script:TestRoot 'leases\bad.lease') -Value '{not json' -Encoding utf8
        @(Get-KeepAwakeLeases).Count | Should -Be 1
    }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/KeepAwake/KeepAwake.Tests.ps1 -Output Detailed"`
Expected: FAIL — `Import-Module` cannot find `KeepAwake.psm1`.

- [ ] **Step 4: Write the minimal implementation**

Create `scripts/KeepAwake/KeepAwake.psm1`:

```powershell
# KeepAwake.psm1 -- lease-based keep-awake for overnight agent work.
# Design: docs/specs/2026-07-20-overnight-keep-awake-design.md
#
# Two seams keep this testable without touching real machine state:
#   1. $env:KB_KEEPAWAKE_ROOT overrides the lease-store location.
#   2. $script:PowerProvider (Task 3) wraps every powercfg/registry mutation.

Set-StrictMode -Version Latest

$script:TimeFormat = 'yyyy-MM-ddTHH:mm:sszzz'

function Get-KeepAwakeRoot {
    if ($env:KB_KEEPAWAKE_ROOT) { return $env:KB_KEEPAWAKE_ROOT }
    return (Join-Path $env:LOCALAPPDATA 'kb-keepawake')
}

function Get-LeaseDir {
    $d = Join-Path (Get-KeepAwakeRoot) 'leases'
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    return $d
}

function Write-KeepAwakeLog {
    param([Parameter(Mandatory)][string]$Message)
    $root = Get-KeepAwakeRoot
    if (-not (Test-Path $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
    $line = '{0}  {1}' -f (Get-Date -Format $script:TimeFormat), $Message
    Add-Content -Path (Join-Path $root 'keepawake.log') -Value $line -Encoding utf8
}

# A label becomes a filename, so it must never contain path separators or
# traversal sequences -- a hostile or careless label must not be able to write
# outside the lease directory.
function Get-SafeLabel {
    param([Parameter(Mandatory)][string]$Label)
    $safe = $Label -replace '[^A-Za-z0-9._-]', '_'
    if ([string]::IsNullOrWhiteSpace($safe)) { $safe = 'unnamed' }
    return $safe
}

function Get-LeasePath {
    param([Parameter(Mandatory)][string]$Label)
    return (Join-Path (Get-LeaseDir) ((Get-SafeLabel -Label $Label) + '.lease'))
}

function New-KeepAwakeLease {
    param(
        [Parameter(Mandatory)][string]$Label,
        [ValidateSet('idle-expiry', 'pid-only')][string]$Mode = 'idle-expiry',
        [Parameter(Mandatory)][int]$ProcessId,
        [double]$CpuSample = 0
    )
    $now = (Get-Date -Format $script:TimeFormat)
    $path = Get-LeasePath -Label $Label
    # Re-acquire is idempotent: SessionStart fires on resume as well as fresh
    # start, so the same label can legitimately arrive more than once. Preserve
    # the original acquisition time; refresh everything else.
    $acquired = $now
    if (Test-Path $path) {
        try {
            $existing = Get-Content $path -Raw | ConvertFrom-Json
            if ($existing.acquired) { $acquired = $existing.acquired }
        } catch { }
    }
    $lease = [ordered]@{
        pid        = $ProcessId
        label      = $Label
        mode       = $Mode
        acquired   = $acquired
        heartbeat  = $now
        cpu_sample = $CpuSample
    }
    $lease | ConvertTo-Json -Compress | Set-Content -Path $path -Encoding utf8
    Write-KeepAwakeLog ("lease-acquire label=$Label mode=$Mode pid=$ProcessId")
    return $lease
}

function Get-KeepAwakeLeases {
    $dir = Get-LeaseDir
    $out = @()
    foreach ($f in (Get-ChildItem -Path $dir -Filter '*.lease' -ErrorAction SilentlyContinue)) {
        try {
            # A corrupt lease must never take down the supervisor -- skip it and
            # keep going, otherwise one bad file disables sleep management entirely.
            $obj = Get-Content $f.FullName -Raw | ConvertFrom-Json
            $out += @{
                pid        = [int]$obj.pid
                label      = [string]$obj.label
                mode       = [string]$obj.mode
                acquired   = [string]$obj.acquired
                heartbeat  = [string]$obj.heartbeat
                cpu_sample = [double]$obj.cpu_sample
                path       = $f.FullName
            }
        } catch {
            Write-KeepAwakeLog ("lease-corrupt file=$($f.Name) -- skipped")
        }
    }
    return $out
}

function Remove-KeepAwakeLease {
    param([Parameter(Mandatory)][string]$Label)
    $path = Get-LeasePath -Label $Label
    if (Test-Path $path) {
        Remove-Item $path -Force
        Write-KeepAwakeLog ("lease-release label=$Label")
        return $true
    }
    return $false
}

Export-ModuleMember -Function Get-KeepAwakeRoot, Get-LeaseDir, Write-KeepAwakeLog,
    Get-SafeLabel, Get-LeasePath, New-KeepAwakeLease, Get-KeepAwakeLeases, Remove-KeepAwakeLease
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/KeepAwake/KeepAwake.Tests.ps1 -Output Detailed"`
Expected: PASS — 6 tests in the `lease store` block.

- [ ] **Step 6: Commit**

```bash
git add scripts/KeepAwake/KeepAwake.psm1 scripts/KeepAwake/KeepAwake.Tests.ps1
git commit -m "feat(power): lease store for keep-awake module"
```

---

### Task 2: CPU probe and lease activity rules

**Files:**
- Modify: `scripts/KeepAwake/KeepAwake.psm1`
- Test: `scripts/KeepAwake/KeepAwake.Tests.ps1`

**Interfaces:**
- Consumes: `New-KeepAwakeLease`, `Get-KeepAwakeLeases`, `Write-KeepAwakeLog` (Task 1)
- Produces: `Test-ProcessAlive([int]$ProcessId) -> bool`, `Get-ProcessTreeCpu([int]$ProcessId) -> double`, `Update-LeaseActivity([hashtable]$Lease, [double]$CpuNow, [datetimeoffset]$Now, [int]$IdleTimeoutMinutes, [double]$CpuThreshold) -> hashtable` returning `@{ Lease=<updated hashtable>; Active=<bool>; Reason=<string> }`

`Update-LeaseActivity` is the pure decision function — no I/O, so the whole activity policy is testable with plain values.

- [ ] **Step 1: Write the failing test**

Append to `scripts/KeepAwake/KeepAwake.Tests.ps1`:

```powershell
Describe 'lease activity rules' {
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
        $script:Now = [datetimeoffset]::Parse('2026-07-20T03:00:00+09:00')
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    function New-TestLease {
        param($Mode = 'idle-expiry', $HeartbeatAgoMinutes = 0, $CpuSample = 100.0)
        return @{
            pid        = $PID
            label      = 't'
            mode       = $Mode
            acquired   = $script:Now.ToString('yyyy-MM-ddTHH:mm:sszzz')
            heartbeat  = $script:Now.AddMinutes(-$HeartbeatAgoMinutes).ToString('yyyy-MM-ddTHH:mm:sszzz')
            cpu_sample = $CpuSample
        }
    }

    It 'keeps a lease active when the heartbeat is recent' {
        $r = Update-LeaseActivity -Lease (New-TestLease -HeartbeatAgoMinutes 2) -CpuNow 100.0 `
             -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Active | Should -BeTrue
    }

    It 'expires an idle-expiry lease when heartbeat is stale and CPU is flat' {
        $r = Update-LeaseActivity -Lease (New-TestLease -HeartbeatAgoMinutes 20) -CpuNow 100.0 `
             -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Active | Should -BeFalse
        $r.Reason | Should -Be 'idle-timeout'
    }

    It 'refreshes a stale heartbeat when CPU delta exceeds the threshold' {
        # This is the subagent/Workflow case: no hook events fired, but the
        # process tree is clearly burning CPU, so the lease must survive.
        $r = Update-LeaseActivity -Lease (New-TestLease -HeartbeatAgoMinutes 20 -CpuSample 100.0) `
             -CpuNow 105.0 -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Active | Should -BeTrue
        $r.Reason | Should -Be 'cpu-activity'
        $r.Lease.heartbeat | Should -Be $script:Now.ToString('yyyy-MM-ddTHH:mm:sszzz')
    }

    It 'does not refresh when CPU delta is below the threshold' {
        $r = Update-LeaseActivity -Lease (New-TestLease -HeartbeatAgoMinutes 20 -CpuSample 100.0) `
             -CpuNow 100.5 -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Active | Should -BeFalse
    }

    It 'never idle-expires a pid-only lease' {
        $r = Update-LeaseActivity -Lease (New-TestLease -Mode 'pid-only' -HeartbeatAgoMinutes 600) `
             -CpuNow 100.0 -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Active | Should -BeTrue
        $r.Reason | Should -Be 'pid-only'
    }

    It 'always stores the latest CPU sample' {
        $r = Update-LeaseActivity -Lease (New-TestLease -CpuSample 100.0) -CpuNow 123.5 `
             -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.Lease.cpu_sample | Should -Be 123.5
    }

    It 'reports this process as alive and a bogus pid as dead' {
        Test-ProcessAlive -ProcessId $PID | Should -BeTrue
        Test-ProcessAlive -ProcessId 999999 | Should -BeFalse
    }

    It 'returns a non-negative CPU total for this process tree' {
        (Get-ProcessTreeCpu -ProcessId $PID) | Should -BeGreaterOrEqual 0
    }

    It 'returns 0 CPU for a dead pid instead of throwing' {
        (Get-ProcessTreeCpu -ProcessId 999999) | Should -Be 0
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/KeepAwake/KeepAwake.Tests.ps1 -Output Detailed"`
Expected: FAIL — `Update-LeaseActivity` / `Test-ProcessAlive` / `Get-ProcessTreeCpu` not recognized.

- [ ] **Step 3: Write the implementation**

Insert into `scripts/KeepAwake/KeepAwake.psm1` before the `Export-ModuleMember` line:

```powershell
function Test-ProcessAlive {
    param([Parameter(Mandatory)][int]$ProcessId)
    try {
        $p = Get-Process -Id $ProcessId -ErrorAction Stop
        return (-not $p.HasExited)
    } catch { return $false }
}

# Sum CPU seconds across the process and every descendant. Descendants matter
# enormously here: subagents, Workflow fan-outs and `codex exec` children are
# where the real work happens, and the parent may be near-idle while they run.
function Get-ProcessTreeCpu {
    param([Parameter(Mandatory)][int]$ProcessId)
    if (-not (Test-ProcessAlive -ProcessId $ProcessId)) { return 0.0 }
    try {
        $all = Get-CimInstance Win32_Process -ErrorAction Stop |
               Select-Object ProcessId, ParentProcessId
    } catch {
        # Without the parent map we can still measure the root process alone.
        try { return [double](Get-Process -Id $ProcessId -ErrorAction Stop).CPU } catch { return 0.0 }
    }
    $childMap = @{}
    foreach ($p in $all) {
        $parent = [int]$p.ParentProcessId
        if (-not $childMap.ContainsKey($parent)) { $childMap[$parent] = @() }
        $childMap[$parent] += [int]$p.ProcessId
    }
    $total = 0.0
    $seen = @{}
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($ProcessId)
    while ($queue.Count -gt 0) {
        $current = [int]$queue.Dequeue()
        # PIDs are recycled and a malformed parent map could contain a cycle;
        # without this guard the walk could loop forever inside the supervisor.
        if ($seen.ContainsKey($current)) { continue }
        $seen[$current] = $true
        try {
            $proc = Get-Process -Id $current -ErrorAction Stop
            if ($null -ne $proc.CPU) { $total += [double]$proc.CPU }
        } catch { }
        if ($childMap.ContainsKey($current)) {
            foreach ($child in $childMap[$current]) { $queue.Enqueue($child) }
        }
    }
    return $total
}

# Pure decision function -- no I/O, so the entire activity policy is testable
# with plain values. Returns the updated lease plus the active verdict.
function Update-LeaseActivity {
    param(
        [Parameter(Mandatory)][hashtable]$Lease,
        [Parameter(Mandatory)][double]$CpuNow,
        [Parameter(Mandatory)][datetimeoffset]$Now,
        [int]$IdleTimeoutMinutes = 15,
        [double]$CpuThreshold = 2.0
    )
    $updated = @{}
    foreach ($k in $Lease.Keys) { $updated[$k] = $Lease[$k] }

    $reason = ''
    $cpuDelta = $CpuNow - [double]$Lease.cpu_sample
    # Union of positive signals: CPU activity refreshes the heartbeat exactly as
    # a hook event would. Neither signal is trusted alone (see spec).
    if ($cpuDelta -ge $CpuThreshold) {
        $updated.heartbeat = $Now.ToString($script:TimeFormat)
        $reason = 'cpu-activity'
    }
    $updated.cpu_sample = $CpuNow

    if ($Lease.mode -eq 'pid-only') {
        return @{ Lease = $updated; Active = $true; Reason = 'pid-only' }
    }

    $hb = [datetimeoffset]::Parse($updated.heartbeat)
    $active = ($Now - $hb).TotalMinutes -lt $IdleTimeoutMinutes
    if (-not $reason) { $reason = if ($active) { 'heartbeat-fresh' } else { 'idle-timeout' } }
    return @{ Lease = $updated; Active = $active; Reason = $reason }
}
```

Update the export list to:

```powershell
Export-ModuleMember -Function Get-KeepAwakeRoot, Get-LeaseDir, Write-KeepAwakeLog,
    Get-SafeLabel, Get-LeasePath, New-KeepAwakeLease, Get-KeepAwakeLeases, Remove-KeepAwakeLease,
    Test-ProcessAlive, Get-ProcessTreeCpu, Update-LeaseActivity
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/KeepAwake/KeepAwake.Tests.ps1 -Output Detailed"`
Expected: PASS — 15 tests total.

- [ ] **Step 5: Commit**

```bash
git add scripts/KeepAwake/KeepAwake.psm1 scripts/KeepAwake/KeepAwake.Tests.ps1
git commit -m "feat(power): CPU-tree probe and lease activity rules"
```

---

### Task 3: Power provider seam — baseline capture, arm, restore

**Files:**
- Modify: `scripts/KeepAwake/KeepAwake.psm1`
- Test: `scripts/KeepAwake/KeepAwake.Tests.ps1`

**Interfaces:**
- Consumes: `Write-KeepAwakeLog`, `Get-KeepAwakeRoot` (Task 1)
- Produces: `Set-PowerProvider([hashtable]$Provider) -> void`, `Get-PowerProvider() -> hashtable`, `Get-PowerBaseline() -> object`, `Save-PowerBaseline() -> object`, `Set-PowerArmed() -> bool`, `Restore-PowerBaseline() -> bool`, `Test-PowerArmed() -> bool`

Provider contract — a hashtable of three scriptblocks:
`GetAcValue = { param([string]$SubGuid,[string]$SettingGuid) return [nullable[int]] }`,
`SetAcValue = { param([string]$SubGuid,[string]$SettingGuid,[int]$Value) return [bool] }`,
`GetScheme  = { return [string] }`

- [ ] **Step 1: Write the failing test**

Append to `scripts/KeepAwake/KeepAwake.Tests.ps1`:

```powershell
Describe 'power arm and restore' {
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
        # Fake provider: an in-memory power scheme. No real machine state is touched.
        $script:FakeStore = @{
            '4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936' = 1
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da' = 1200
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364' = 900
        }
        Set-PowerProvider -Provider @{
            GetAcValue = { param($SubGuid, $SettingGuid) $script:FakeStore["$SubGuid|$SettingGuid"] }
            SetAcValue = { param($SubGuid, $SettingGuid, $Value) $script:FakeStore["$SubGuid|$SettingGuid"] = $Value; $true }
            GetScheme  = { '381b4222-f694-41f0-9685-ff5bb260df2e' }
        }
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'captures the current values as the baseline' {
        $b = Save-PowerBaseline
        $b.original.lidaction_ac     | Should -Be 1
        $b.original.standbyidle_ac   | Should -Be 1200
        $b.original.hibernateidle_ac | Should -Be 900
        Test-Path (Join-Path $script:TestRoot 'armed.json') | Should -BeTrue
    }

    It 'does not mutate anything while capturing the baseline' {
        # Ordering is load-bearing: if arming dies half-way, the baseline must
        # already be on disk or the original values are lost forever.
        Save-PowerBaseline | Out-Null
        $script:FakeStore['4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936'] |
            Should -Be 1
    }

    It 'arms all three settings to never/do-nothing' {
        Set-PowerArmed | Should -BeTrue
        $script:FakeStore['4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936'] | Should -Be 0
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 0
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364'] | Should -Be 0
    }

    It 'round-trips: restore puts every original value back exactly' {
        Set-PowerArmed | Out-Null
        Restore-PowerBaseline | Should -BeTrue
        $script:FakeStore['4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936'] | Should -Be 1
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 1200
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364'] | Should -Be 900
    }

    It 'clears armed.json after a successful restore' {
        Set-PowerArmed | Out-Null
        Test-PowerArmed | Should -BeTrue
        Restore-PowerBaseline | Out-Null
        Test-PowerArmed | Should -BeFalse
    }

    It 'adopts an existing armed.json instead of overwriting it' {
        # Supervisor-crash recovery: a second supervisor must restore the ORIGINAL
        # values, not capture the already-armed zeros as if they were the baseline.
        Set-PowerArmed | Out-Null
        Save-PowerBaseline | Out-Null
        (Get-PowerBaseline).original.standbyidle_ac | Should -Be 1200
    }

    It 'treats an absent original value as the documented default' {
        $script:FakeStore.Remove('4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936')
        (Save-PowerBaseline).original.lidaction_ac | Should -Be 1
    }

    It 'restore is a no-op when nothing was armed' {
        Restore-PowerBaseline | Should -BeFalse
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/KeepAwake/KeepAwake.Tests.ps1 -Output Detailed"`
Expected: FAIL — `Set-PowerProvider` not recognized.

- [ ] **Step 3: Write the implementation**

Insert into `scripts/KeepAwake/KeepAwake.psm1` before `Export-ModuleMember`:

```powershell
$script:SUB_BUTTONS   = '4f971e89-eebd-4455-a8de-9e59040e7347'
$script:LIDACTION     = '5ca83367-6e45-459f-a27b-476b1d01c936'
$script:SUB_SLEEP     = '238c9fa8-0aad-41ed-83f4-97be242c8f20'
$script:STANDBYIDLE   = '29f6c1db-86da-48c5-9fdb-f2b67b1f44da'
$script:HIBERNATEIDLE = '9d7815a6-7ee4-497e-8888-515a05f02364'

# Documented Windows defaults, used when a setting has no explicit value in the
# active scheme (an absent key means "inherit the default"). Restoring to the
# effective value is behaviourally exact even though the key materialises.
$script:PowerDefaults = @{ lidaction_ac = 1; standbyidle_ac = 1200; hibernateidle_ac = 900 }

function Get-DefaultPowerProvider {
    return @{
        GetScheme = {
            $line = (powercfg /getactivescheme)
            if ($line -match 'GUID:\s*([a-f0-9\-]+)') { return $Matches[1] }
            return ''
        }
        # Read from the registry rather than parsing `powercfg /query`: the lid
        # action is a HIDDEN setting and does not appear in query output at all
        # (verified 2026-07-20), so query-parsing would silently miss it.
        GetAcValue = {
            param([string]$SubGuid, [string]$SettingGuid)
            $scheme = & (Get-PowerProvider).GetScheme
            $key = "HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes\$scheme\$SubGuid\$SettingGuid"
            if (-not (Test-Path $key)) { return $null }
            try { return [int](Get-ItemProperty -Path $key -Name ACSettingIndex -ErrorAction Stop).ACSettingIndex }
            catch { return $null }
        }
        SetAcValue = {
            param([string]$SubGuid, [string]$SettingGuid, [int]$Value)
            powercfg /setacvalueindex SCHEME_CURRENT $SubGuid $SettingGuid $Value | Out-Null
            if ($LASTEXITCODE -ne 0) { return $false }
            powercfg /setactive SCHEME_CURRENT | Out-Null
            return ($LASTEXITCODE -eq 0)
        }
    }
}

$script:PowerProvider = Get-DefaultPowerProvider

function Set-PowerProvider { param([Parameter(Mandatory)][hashtable]$Provider) $script:PowerProvider = $Provider }
function Get-PowerProvider { return $script:PowerProvider }

function Get-ArmedPath { return (Join-Path (Get-KeepAwakeRoot) 'armed.json') }
function Test-PowerArmed { return (Test-Path (Get-ArmedPath)) }

function Get-PowerBaseline {
    $p = Get-ArmedPath
    if (-not (Test-Path $p)) { return $null }
    try { return (Get-Content $p -Raw | ConvertFrom-Json) } catch { return $null }
}

function Save-PowerBaseline {
    # Adopt rather than overwrite. If armed.json already exists, the machine is
    # already armed and its stored values are the ONLY record of the originals --
    # re-capturing now would record the armed zeros as the baseline and make the
    # real settings unrecoverable.
    $existing = Get-PowerBaseline
    if ($null -ne $existing) {
        Write-KeepAwakeLog 'baseline-adopt existing armed.json found'
        return $existing
    }
    $prov = Get-PowerProvider
    $read = {
        param([string]$Sub, [string]$Setting, [string]$Name)
        $v = & $prov.GetAcValue $Sub $Setting
        if ($null -eq $v) { return $script:PowerDefaults[$Name] }
        return [int]$v
    }
    $baseline = [ordered]@{
        armed_at = (Get-Date -Format $script:TimeFormat)
        scheme   = (& $prov.GetScheme)
        original = [ordered]@{
            lidaction_ac     = (& $read $script:SUB_BUTTONS $script:LIDACTION 'lidaction_ac')
            standbyidle_ac   = (& $read $script:SUB_SLEEP $script:STANDBYIDLE 'standbyidle_ac')
            hibernateidle_ac = (& $read $script:SUB_SLEEP $script:HIBERNATEIDLE 'hibernateidle_ac')
        }
    }
    $root = Get-KeepAwakeRoot
    if (-not (Test-Path $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
    $baseline | ConvertTo-Json -Depth 5 | Set-Content -Path (Get-ArmedPath) -Encoding utf8
    Write-KeepAwakeLog ("baseline-saved lid=$($baseline.original.lidaction_ac) standby=$($baseline.original.standbyidle_ac) hibernate=$($baseline.original.hibernateidle_ac)")
    return $baseline
}

function Set-PowerArmed {
    # Baseline FIRST, mutation second. If this dies half-way the originals are
    # already durable on disk and -Repair can put them back.
    Save-PowerBaseline | Out-Null
    $prov = Get-PowerProvider
    # Evaluate all three writes unconditionally rather than chaining them with
    # PowerShell's short-circuiting -and: if an earlier write fails, the later
    # ones must still be attempted, because those are what actually gate sleep.
    # Silently skipping them on a partial failure would leave the machine armed
    # and unable to sleep with no attempt made to fix it.
    $r1 = & $prov.SetAcValue $script:SUB_BUTTONS $script:LIDACTION 0
    $r2 = & $prov.SetAcValue $script:SUB_SLEEP $script:STANDBYIDLE 0
    $r3 = & $prov.SetAcValue $script:SUB_SLEEP $script:HIBERNATEIDLE 0
    $ok = $r1 -and $r2 -and $r3
    if ($ok) { Write-KeepAwakeLog 'power-armed lid=0 standby=0 hibernate=0 (AC only)' }
    else     { Write-KeepAwakeLog 'power-arm-FAILED one or more powercfg writes returned non-zero' }
    return $ok
}

function Restore-PowerBaseline {
    $b = Get-PowerBaseline
    if ($null -eq $b) { return $false }
    $prov = Get-PowerProvider
    # Evaluate all three writes unconditionally rather than chaining them with
    # PowerShell's short-circuiting -and: if restoring the lid setting fails,
    # STANDBYIDLE and HIBERNATEIDLE must still be attempted. Those two are what
    # actually gate sleep, so short-circuiting past them on an earlier failure
    # would silently strand the machine at "never sleep" -- exactly the outcome
    # the global constraint forbids.
    $r1 = & $prov.SetAcValue $script:SUB_BUTTONS $script:LIDACTION ([int]$b.original.lidaction_ac)
    $r2 = & $prov.SetAcValue $script:SUB_SLEEP $script:STANDBYIDLE ([int]$b.original.standbyidle_ac)
    $r3 = & $prov.SetAcValue $script:SUB_SLEEP $script:HIBERNATEIDLE ([int]$b.original.hibernateidle_ac)
    $ok = $r1 -and $r2 -and $r3
    if ($ok) {
        Remove-Item (Get-ArmedPath) -Force -ErrorAction SilentlyContinue
        Write-KeepAwakeLog 'power-restored originals reapplied; armed.json cleared'
    } else {
        # Deliberately keep armed.json so a later -Repair can retry. Clearing it
        # on failure would strand the machine armed with no record of the originals.
        Write-KeepAwakeLog 'power-restore-FAILED armed.json retained for -Repair'
    }
    return $ok
}
```

Update the export list to add: `Set-PowerProvider, Get-PowerProvider, Get-PowerBaseline, Save-PowerBaseline, Set-PowerArmed, Restore-PowerBaseline, Test-PowerArmed`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/KeepAwake/KeepAwake.Tests.ps1 -Output Detailed"`
Expected: PASS — 23 tests total.

- [ ] **Step 5: Verify the real provider reads this machine correctly (read-only)**

Run:
```
powershell -NoProfile -Command "Import-Module ./scripts/KeepAwake/KeepAwake.psm1 -Force; $p = Get-PowerProvider; 'scheme=' + (& $p.GetScheme); 'lid=' + (& $p.GetAcValue '4f971e89-eebd-4455-a8de-9e59040e7347' '5ca83367-6e45-459f-a27b-476b1d01c936'); 'standby=' + (& $p.GetAcValue '238c9fa8-0aad-41ed-83f4-97be242c8f20' '29f6c1db-86da-48c5-9fdb-f2b67b1f44da')"
```
Expected: a real scheme GUID, `lid=1`, `standby=1200`. If `standby` comes back empty, the registry layout for `SUB_SLEEP` differs on this box — stop and re-derive it from `powercfg /query SCHEME_CURRENT SUB_SLEEP` before continuing. This step mutates nothing.

- [ ] **Step 6: Commit**

```bash
git add scripts/KeepAwake/KeepAwake.psm1 scripts/KeepAwake/KeepAwake.Tests.ps1
git commit -m "feat(power): baseline capture, arm and exact restore behind a provider seam"
```

---

### Task 4: Supervisor loop with mutex singleton and absolute cap

**Files:**
- Modify: `scripts/KeepAwake/KeepAwake.psm1`
- Test: `scripts/KeepAwake/KeepAwake.Tests.ps1`

**Interfaces:**
- Consumes: everything from Tasks 1-3
- Produces: `Invoke-SupervisorPass([datetimeoffset]$Now, [int]$IdleTimeoutMinutes, [double]$CpuThreshold) -> hashtable` returning `@{ LiveCount=<int>; Pruned=<string[]>; Armed=<bool> }`; `Start-KeepAwakeSupervisor([int]$PollSeconds, [int]$MaxHours, [int]$IdleTimeoutMinutes, [double]$CpuThreshold) -> int`; `Set-ExecutionStateHold() -> bool`; `Clear-ExecutionStateHold() -> bool`

`Invoke-SupervisorPass` is one iteration, extracted so refcount transitions are testable without running a loop or sleeping.

- [ ] **Step 1: Write the failing test**

Append to `scripts/KeepAwake/KeepAwake.Tests.ps1`:

```powershell
Describe 'supervisor pass' {
    BeforeEach {
        $script:TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("ka-" + [guid]::NewGuid())
        $env:KB_KEEPAWAKE_ROOT = $script:TestRoot
        $script:Now = [datetimeoffset]::Parse('2026-07-20T03:00:00+09:00')
        $script:FakeStore = @{
            '4f971e89-eebd-4455-a8de-9e59040e7347|5ca83367-6e45-459f-a27b-476b1d01c936' = 1
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da' = 1200
            '238c9fa8-0aad-41ed-83f4-97be242c8f20|9d7815a6-7ee4-497e-8888-515a05f02364' = 900
        }
        Set-PowerProvider -Provider @{
            GetAcValue = { param($SubGuid, $SettingGuid) $script:FakeStore["$SubGuid|$SettingGuid"] }
            SetAcValue = { param($SubGuid, $SettingGuid, $Value) $script:FakeStore["$SubGuid|$SettingGuid"] = $Value; $true }
            GetScheme  = { '381b4222-f694-41f0-9685-ff5bb260df2e' }
        }
    }
    AfterEach {
        Remove-Item $env:KB_KEEPAWAKE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\KB_KEEPAWAKE_ROOT -ErrorAction SilentlyContinue
    }

    It 'arms on the 0 -> 1 lease transition' {
        New-KeepAwakeLease -Label 'a' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        $r = Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.LiveCount | Should -Be 1
        $r.Armed | Should -BeTrue
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 0
    }

    It 'prunes a lease whose process is dead' {
        New-KeepAwakeLease -Label 'dead' -Mode 'pid-only' -ProcessId 999999 -CpuSample 0 | Out-Null
        $r = Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.LiveCount | Should -Be 0
        $r.Pruned | Should -Contain 'dead'
    }

    It 'restores on the 1 -> 0 lease transition' {
        New-KeepAwakeLease -Label 'a' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0 | Out-Null
        Remove-KeepAwakeLease -Label 'a' | Out-Null
        $r = Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.LiveCount | Should -Be 0
        $r.Armed | Should -BeFalse
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 1200
    }

    It 'stays armed at 2 -> 1 leases' {
        New-KeepAwakeLease -Label 'a' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        New-KeepAwakeLease -Label 'b' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0 | Out-Null
        Remove-KeepAwakeLease -Label 'a' | Out-Null
        $r = Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0
        $r.LiveCount | Should -Be 1
        $r.Armed | Should -BeTrue
        $script:FakeStore['238c9fa8-0aad-41ed-83f4-97be242c8f20|29f6c1db-86da-48c5-9fdb-f2b67b1f44da'] | Should -Be 0
    }

    It 'prunes an idle-expired lease even though its process is alive' {
        New-KeepAwakeLease -Label 'idle' -Mode 'idle-expiry' -ProcessId $PID -CpuSample 0 | Out-Null
        $future = $script:Now.AddHours(5)
        $r = Invoke-SupervisorPass -Now $future -IdleTimeoutMinutes 15 -CpuThreshold 999999
        $r.LiveCount | Should -Be 0
        $r.Pruned | Should -Contain 'idle'
    }

    It 'persists the refreshed cpu_sample back to the lease file' {
        New-KeepAwakeLease -Label 'a' -Mode 'pid-only' -ProcessId $PID -CpuSample 0 | Out-Null
        Invoke-SupervisorPass -Now $script:Now -IdleTimeoutMinutes 15 -CpuThreshold 2.0 | Out-Null
        (@(Get-KeepAwakeLeases)[0]).cpu_sample | Should -BeGreaterOrEqual 0
    }
}

Describe 'supervisor singleton' {
    It 'lets the first holder in and keeps the second out' {
        $name = 'Global\kb-keepawake-test-' + [guid]::NewGuid()
        $created = $false
        $m1 = New-Object System.Threading.Mutex($true, $name, [ref]$created)
        try {
            $created2 = $false
            $m2 = New-Object System.Threading.Mutex($true, $name, [ref]$created2)
            try { $m2.WaitOne(0, $false) | Should -BeFalse }
            finally { $m2.Dispose() }
        } finally { $m1.ReleaseMutex(); $m1.Dispose() }
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/KeepAwake/KeepAwake.Tests.ps1 -Output Detailed"`
Expected: FAIL — `Invoke-SupervisorPass` not recognized.

- [ ] **Step 3: Write the implementation**

Insert into `scripts/KeepAwake/KeepAwake.psm1` before `Export-ModuleMember`:

```powershell
Add-Type -Namespace KbPower -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@ -ErrorAction SilentlyContinue

# The L suffix is required: PowerShell 5.1 parses 0x80000000 as a negative
# Int32, and [uint32] on that throws at import time, taking the whole module
# down. 0x80000000L parses as Int64 and casts cleanly to 2147483648.
$script:ES_CONTINUOUS      = [uint32]0x80000000L
$script:ES_SYSTEM_REQUIRED = [uint32]0x00000001

function Set-ExecutionStateHold {
    # ES_SYSTEM_REQUIRED is OS-refcounted and released automatically when this
    # process dies -- which is exactly why the supervisor can never leak it.
    $r = [KbPower.Native]::SetThreadExecutionState($script:ES_CONTINUOUS -bor $script:ES_SYSTEM_REQUIRED)
    Write-KeepAwakeLog ("exec-state-hold result=$r")
    return ($r -ne 0)
}

function Clear-ExecutionStateHold {
    $r = [KbPower.Native]::SetThreadExecutionState($script:ES_CONTINUOUS)
    Write-KeepAwakeLog ("exec-state-clear result=$r")
    return ($r -ne 0)
}

# One supervisor iteration, extracted so refcount transitions are testable
# without a loop or a sleep.
function Invoke-SupervisorPass {
    param(
        [Parameter(Mandatory)][datetimeoffset]$Now,
        [int]$IdleTimeoutMinutes = 15,
        [double]$CpuThreshold = 2.0
    )
    $pruned = @()
    $live = 0
    foreach ($lease in (Get-KeepAwakeLeases)) {
        if (-not (Test-ProcessAlive -ProcessId $lease.pid)) {
            Remove-Item $lease.path -Force -ErrorAction SilentlyContinue
            Write-KeepAwakeLog ("lease-pruned label=$($lease.label) reason=process-dead pid=$($lease.pid)")
            $pruned += $lease.label
            continue
        }
        $cpuNow = Get-ProcessTreeCpu -ProcessId $lease.pid
        $res = Update-LeaseActivity -Lease $lease -CpuNow $cpuNow -Now $Now `
                   -IdleTimeoutMinutes $IdleTimeoutMinutes -CpuThreshold $CpuThreshold
        if (-not $res.Active) {
            Remove-Item $lease.path -Force -ErrorAction SilentlyContinue
            Write-KeepAwakeLog ("lease-pruned label=$($lease.label) reason=$($res.Reason)")
            $pruned += $lease.label
            continue
        }
        # Persist the refreshed heartbeat/cpu_sample so the next pass compares
        # against this pass's reading rather than the original acquisition value.
        $u = $res.Lease
        [ordered]@{
            pid = $u.pid; label = $u.label; mode = $u.mode
            acquired = $u.acquired; heartbeat = $u.heartbeat; cpu_sample = $u.cpu_sample
        } | ConvertTo-Json -Compress | Set-Content -Path $lease.path -Encoding utf8
        $live++
    }

    if ($live -gt 0 -and -not (Test-PowerArmed)) { Set-PowerArmed | Out-Null }
    elseif ($live -eq 0 -and (Test-PowerArmed)) { Restore-PowerBaseline | Out-Null }

    return @{ LiveCount = $live; Pruned = $pruned; Armed = (Test-PowerArmed) }
}

function Start-KeepAwakeSupervisor {
    param(
        [int]$PollSeconds = 60,
        [int]$MaxHours = 16,
        [int]$IdleTimeoutMinutes = 15,
        [double]$CpuThreshold = 2.0
    )
    # A PID file alone is racy: two -Acquire calls can both observe "no
    # supervisor" before either spawns. The named mutex is the authority.
    $created = $false
    $mutex = New-Object System.Threading.Mutex($true, 'Global\kb-keepawake-supervisor', [ref]$created)
    if (-not $created) {
        Write-KeepAwakeLog 'supervisor-exit reason=another-supervisor-holds-mutex'
        $mutex.Dispose()
        return 0
    }

    $pidFile = Join-Path (Get-KeepAwakeRoot) 'supervisor.pid'
    Set-Content -Path $pidFile -Value $PID -Encoding utf8
    Set-ExecutionStateHold | Out-Null
    Write-KeepAwakeLog ("supervisor-start pid=$PID poll=${PollSeconds}s cap=${MaxHours}h idle=${IdleTimeoutMinutes}m")

    $deadline = (Get-Date).AddHours($MaxHours)
    $exit = 0
    try {
        while ($true) {
            if ((Get-Date) -ge $deadline) {
                Write-KeepAwakeLog "supervisor-CAP-REACHED after ${MaxHours}h -- force-disarming"
                $exit = 3
                break
            }
            $pass = Invoke-SupervisorPass -Now ([datetimeoffset]::Now) `
                        -IdleTimeoutMinutes $IdleTimeoutMinutes -CpuThreshold $CpuThreshold
            if ($pass.LiveCount -eq 0) {
                Write-KeepAwakeLog 'supervisor-exit reason=no-live-leases'
                break
            }
            Start-Sleep -Seconds $PollSeconds
        }
    } finally {
        # Belt and braces: whatever happened above, never leave the machine armed.
        if (Test-PowerArmed) { Restore-PowerBaseline | Out-Null }
        Clear-ExecutionStateHold | Out-Null
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        Write-KeepAwakeLog ("supervisor-stop pid=$PID exit=$exit")
        $mutex.ReleaseMutex(); $mutex.Dispose()
    }
    return $exit
}
```

Update the export list to add: `Set-ExecutionStateHold, Clear-ExecutionStateHold, Invoke-SupervisorPass, Start-KeepAwakeSupervisor`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/KeepAwake/KeepAwake.Tests.ps1 -Output Detailed"`
Expected: PASS — 30 tests total.

- [ ] **Step 5: Commit**

```bash
git add scripts/KeepAwake/KeepAwake.psm1 scripts/KeepAwake/KeepAwake.Tests.ps1
git commit -m "feat(power): supervisor pass, mutex singleton and absolute cap"
```

---

### Task 5: CLI entry point

**Files:**
- Create: `scripts/keep_awake.ps1`

**Interfaces:**
- Consumes: the whole module from Tasks 1-4
- Produces: CLI contract `keep_awake.ps1 -Acquire -Label <s> [-Mode idle-expiry|pid-only] [-ProcessId <int>]`, `-Heartbeat -Label <s>`, `-Release -Label <s>`, `-Status`, `-Repair`, `-Supervise`. Exit 0 on success, 1 on failure.

- [ ] **Step 1: Write the implementation**

Create `scripts/keep_awake.ps1`:

```powershell
# keep_awake.ps1 -- CLI for the lease-based overnight keep-awake.
# Design: docs/specs/2026-07-20-overnight-keep-awake-design.md
#
# Called by Claude Code hooks (see ~/.claude/settings.json) and by
# scripts/agent_runner.ps1. Must stay fast and must never throw into a hook:
# a hook that errors would be noise on every single tool call.

[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'Acquire')][switch]$Acquire,
    [Parameter(ParameterSetName = 'Heartbeat')][switch]$Heartbeat,
    [Parameter(ParameterSetName = 'Release')][switch]$Release,
    [Parameter(ParameterSetName = 'Status')][switch]$Status,
    [Parameter(ParameterSetName = 'Repair')][switch]$Repair,
    [Parameter(ParameterSetName = 'Supervise')][switch]$Supervise,

    [Parameter(ParameterSetName = 'Acquire')]
    [Parameter(ParameterSetName = 'Heartbeat')]
    [Parameter(ParameterSetName = 'Release')]
    [string]$Label,

    [Parameter(ParameterSetName = 'Acquire')][ValidateSet('idle-expiry', 'pid-only')]
    [string]$Mode = 'idle-expiry',

    [Parameter(ParameterSetName = 'Acquire')][int]$ProcessId = 0,

    [int]$PollSeconds = 60,
    [int]$MaxHours = 16,
    [int]$IdleTimeoutMinutes = 15,
    [double]$CpuThreshold = 2.0
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'KeepAwake\KeepAwake.psm1') -Force

function Start-DetachedSupervisor {
    $self = Join-Path $PSScriptRoot 'keep_awake.ps1'
    # -WindowStyle Hidden so overnight work never pops a console window.
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$self`"", '-Supervise',
        '-PollSeconds', $PollSeconds, '-MaxHours', $MaxHours,
        '-IdleTimeoutMinutes', $IdleTimeoutMinutes, '-CpuThreshold', $CpuThreshold
    ) | Out-Null
}

try {
    switch ($PSCmdlet.ParameterSetName) {
        'Acquire' {
            if (-not $Label) { throw '-Label is required with -Acquire' }
            $target = if ($ProcessId -gt 0) { $ProcessId } else { $PID }
            $cpu = Get-ProcessTreeCpu -ProcessId $target
            New-KeepAwakeLease -Label $Label -Mode $Mode -ProcessId $target -CpuSample $cpu | Out-Null
            # Spawning is unconditional and cheap: a duplicate supervisor loses
            # the mutex race and exits immediately, so there is no need to check
            # first (and checking first is exactly the race we are avoiding).
            Start-DetachedSupervisor
            Write-Output "acquired label=$Label mode=$Mode pid=$target"
        }
        'Heartbeat' {
            if (-not $Label) { throw '-Label is required with -Heartbeat' }
            $path = Get-LeasePath -Label $Label
            if (Test-Path $path) {
                $lease = Get-Content $path -Raw | ConvertFrom-Json
                $lease.heartbeat = (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
                $lease | ConvertTo-Json -Compress | Set-Content -Path $path -Encoding utf8
            }
            # Silent no-op if the lease is gone -- a heartbeat for an expired
            # lease is normal and must not resurrect it or emit hook noise.
        }
        'Release' {
            if (-not $Label) { throw '-Label is required with -Release' }
            Remove-KeepAwakeLease -Label $Label | Out-Null
        }
        'Status' {
            $leases = @(Get-KeepAwakeLeases)
            Write-Output "armed: $(Test-PowerArmed)"
            $b = Get-PowerBaseline
            if ($b) { Write-Output "baseline: lid=$($b.original.lidaction_ac) standby=$($b.original.standbyidle_ac) hibernate=$($b.original.hibernateidle_ac) armed_at=$($b.armed_at)" }
            $pidFile = Join-Path (Get-KeepAwakeRoot) 'supervisor.pid'
            if (Test-Path $pidFile) {
                $sp = [int](Get-Content $pidFile -Raw).Trim()
                Write-Output "supervisor: pid=$sp alive=$(Test-ProcessAlive -ProcessId $sp)"
            } else { Write-Output 'supervisor: none' }
            Write-Output "leases: $($leases.Count)"
            foreach ($l in $leases) {
                Write-Output ("  {0} mode={1} pid={2} alive={3} heartbeat={4}" -f `
                    $l.label, $l.mode, $l.pid, (Test-ProcessAlive -ProcessId $l.pid), $l.heartbeat)
            }
            Write-Output 'note: powercfg /requests needs elevation and is not queried here'
        }
        'Repair' {
            if (Restore-PowerBaseline) { Write-Output 'repaired: original power settings restored' }
            else { Write-Output 'nothing to repair: no armed.json present' }
        }
        'Supervise' {
            exit (Start-KeepAwakeSupervisor -PollSeconds $PollSeconds -MaxHours $MaxHours `
                    -IdleTimeoutMinutes $IdleTimeoutMinutes -CpuThreshold $CpuThreshold)
        }
    }
    exit 0
} catch {
    Write-KeepAwakeLog ("cli-error mode=$($PSCmdlet.ParameterSetName) :: $_")
    Write-Error $_
    exit 1
}
```

- [ ] **Step 2: Smoke-test acquire and status against the real machine**

Run:
```
powershell -NoProfile -File scripts/keep_awake.ps1 -Acquire -Label smoke -Mode pid-only
powershell -NoProfile -File scripts/keep_awake.ps1 -Status
```
Expected: `acquired label=smoke mode=pid-only pid=<n>`, then `armed: True`, a baseline line showing `lid=1 standby=1200 hibernate=900`, a live supervisor pid, and `leases: 1`.

- [ ] **Step 3: Verify the real power settings actually changed**

Run: `powershell -NoProfile -Command "powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'Current AC'"`
Expected: `Current AC Power Setting Index: 0x00000000`

- [ ] **Step 4: Release and verify exact restore**

Run:
```
powershell -NoProfile -File scripts/keep_awake.ps1 -Release -Label smoke
```
Wait up to 60s for the supervisor's next pass, then:
```
powershell -NoProfile -File scripts/keep_awake.ps1 -Status
powershell -NoProfile -Command "powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'Current AC'"
```
Expected: `armed: False`, `leases: 0`, `supervisor: none`, and `Current AC Power Setting Index: 0x000004b0` (1200 — the original).

**If restore did not happen, run `powershell -NoProfile -File scripts/keep_awake.ps1 -Repair` before continuing.** Do not proceed to Task 6 with the machine left armed.

- [ ] **Step 5: Commit**

```bash
git add scripts/keep_awake.ps1
git commit -m "feat(power): keep_awake CLI entry point"
```

---

### Task 6: Wire the codex runner

**Files:**
- Modify: `scripts/agent_runner.ps1` (acquire after the preamble gate ~line 151; release before the final `exit` ~line 474)

**Interfaces:**
- Consumes: `scripts/keep_awake.ps1` CLI (Task 5)
- Produces: no new interfaces

- [ ] **Step 1: Add the acquire immediately after the preamble gate**

In `scripts/agent_runner.ps1`, find:

```powershell
Write-RunnerLog ("preamble=OK agent=$Agent interpreter=$py")
```

Insert directly after it:

```powershell
# --- step 4b: take a keep-awake lease so a closed lid cannot kill this run -----------
# pid-only mode: this runner is a bounded process that exits when its work is done,
# so PID liveness is the correct signal -- a long, quiet `codex exec` must never be
# idle-expired. Best-effort: a keep-awake failure must not block real work.
$keepAwake = Join-Path $RepoRoot 'scripts\keep_awake.ps1'
$keepAwakeLabel = "codex-$Agent-$PID"
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $keepAwake `
        -Acquire -Label $keepAwakeLabel -Mode pid-only -ProcessId $PID | Out-Null
    Write-RunnerLog ("keep-awake=acquired label=$keepAwakeLabel agent=$Agent")
} catch {
    Write-RunnerLog ("keep-awake=FAILED label=$keepAwakeLabel agent=$Agent :: $_ -- continuing unprotected")
}
```

- [ ] **Step 2: Add the release before the final exit**

Find the last two lines of `scripts/agent_runner.ps1`:

```powershell
Write-RunnerLog ("run-complete agent=$Agent branch=$workBranch overall-exit=$overallExit interpreter=$py")
exit $overallExit
```

Replace with:

```powershell
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $keepAwake `
        -Release -Label $keepAwakeLabel | Out-Null
    Write-RunnerLog ("keep-awake=released label=$keepAwakeLabel agent=$Agent")
} catch {
    # Not fatal: the supervisor prunes by PID liveness, so this process exiting
    # releases the lease within one poll regardless.
    Write-RunnerLog ("keep-awake=release-failed label=$keepAwakeLabel agent=$Agent :: $_")
}

Write-RunnerLog ("run-complete agent=$Agent branch=$workBranch overall-exit=$overallExit interpreter=$py")
exit $overallExit
```

- [ ] **Step 3: Verify the script still parses**

Run:
```
powershell -NoProfile -Command "$null = [ScriptBlock]::Create((Get-Content -Raw scripts/agent_runner.ps1)); 'parse OK'"
```
Expected: `parse OK`

- [ ] **Step 4: Verify the early-exit paths do not reference the lease**

Run: `powershell -NoProfile -Command "Select-String -Path scripts/agent_runner.ps1 -Pattern 'keepAwakeLabel' | Select-Object LineNumber,Line"`
Expected: exactly three hits — the assignment, the acquire, and the release. Confirm by eye that every `exit` statement occurring *before* the assignment line does not reference `$keepAwakeLabel` (the STOP-file, ops-fetch, ops-checkout and preamble-fail exits all precede it, which is correct — no lease exists yet at those points).

- [ ] **Step 5: Commit**

```bash
git add scripts/agent_runner.ps1
git commit -m "feat(power): agent_runner takes a pid-only keep-awake lease"
```

---

### Task 7: Wire Claude Code hooks

**Files:**
- Modify: `C:\Users\danie\.claude\settings.json` (add a `hooks` key; the file currently has none)

**Interfaces:**
- Consumes: `scripts/keep_awake.ps1` CLI (Task 5)
- Produces: no new interfaces

- [ ] **Step 1: Back up the existing settings**

Run:
```
powershell -NoProfile -Command "Copy-Item $env:USERPROFILE\.claude\settings.json $env:USERPROFILE\.claude\settings.json.bak-keepawake -Force; 'backed up'"
```
Expected: `backed up`. This file holds Daniel's permissions, model and plugin config — never hand-edit it without a backup.

- [ ] **Step 2: Add the hooks block**

Add this top-level `hooks` key to `C:\Users\danie\.claude\settings.json`, preserving every existing key (`permissions`, `model`, `enabledPlugins`, `extraKnownMarketplaces`, `autoUpdatesChannel`, `tui`, `voice`, `skipWorkflowUsageWarning`, `switchModelsOnFlag`, `voiceEnabled`):

```json
"hooks": {
  "SessionStart": [
    { "hooks": [ { "type": "command", "async": true,
      "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\danie\\kb\\scripts\\keep_awake.ps1 -Acquire -Label claude-$CLAUDE_SESSION_ID -Mode idle-expiry" } ] }
  ],
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command", "async": true,
      "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\danie\\kb\\scripts\\keep_awake.ps1 -Heartbeat -Label claude-$CLAUDE_SESSION_ID" } ] }
  ],
  "PreToolUse": [
    { "matcher": "*", "hooks": [ { "type": "command", "async": true,
      "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\danie\\kb\\scripts\\keep_awake.ps1 -Heartbeat -Label claude-$CLAUDE_SESSION_ID" } ] }
  ],
  "PostToolUse": [
    { "matcher": "*", "hooks": [ { "type": "command", "async": true,
      "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\danie\\kb\\scripts\\keep_awake.ps1 -Heartbeat -Label claude-$CLAUDE_SESSION_ID" } ] }
  ],
  "SubagentStart": [
    { "hooks": [ { "type": "command", "async": true,
      "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\danie\\kb\\scripts\\keep_awake.ps1 -Heartbeat -Label claude-$CLAUDE_SESSION_ID" } ] }
  ],
  "SubagentStop": [
    { "hooks": [ { "type": "command", "async": true,
      "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\danie\\kb\\scripts\\keep_awake.ps1 -Heartbeat -Label claude-$CLAUDE_SESSION_ID" } ] }
  ],
  "SessionEnd": [
    { "hooks": [ { "type": "command", "async": true,
      "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\danie\\kb\\scripts\\keep_awake.ps1 -Release -Label claude-$CLAUDE_SESSION_ID" } ] }
  ]
}
```

Every hook is `async: true` — `PreToolUse`/`PostToolUse` fire on every single tool call and must never gate the agent loop.

- [ ] **Step 3: Validate the JSON**

Run:
```
powershell -NoProfile -Command "$j = Get-Content $env:USERPROFILE\.claude\settings.json -Raw | ConvertFrom-Json; 'valid JSON'; 'hook events: ' + (($j.hooks.PSObject.Properties.Name) -join ', '); 'model still set: ' + ($null -ne $j.model)"
```
Expected: `valid JSON`; the seven event names; `model still set: True`. If `model` is False, the edit dropped existing keys — restore from the backup and redo.

- [ ] **Step 4: Verify the session-id variable actually expands**

Start a fresh Claude Code session in this repo, then run:
```
powershell -NoProfile -File scripts/keep_awake.ps1 -Status
```
Expected: `leases: 1` with a label like `claude-<uuid>` — **not** the literal string `claude-$CLAUDE_SESSION_ID`. If it is literal, the harness does not expand that variable in hook commands; fall back to a fixed label (`claude-session`) and note the limitation: two concurrent Claude sessions would then share one lease, and the earlier one's `SessionEnd` would drop it for both. In that case keep `-Mode idle-expiry` with the shared label, since CPU activity from either session will keep it refreshed.

- [ ] **Step 5: Commit**

The settings file lives outside the repo, so record the wiring in-repo instead:

```bash
git add docs/plans/2026-07-20-overnight-keep-awake.md
git commit -m "docs(power): record Claude hook wiring for keep-awake"
```

---

### Task 8: Full-system verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full unit suite**

Run: `powershell -NoProfile -Command "Invoke-Pester scripts/KeepAwake/KeepAwake.Tests.ps1 -Output Detailed"`
Expected: PASS, 30 tests, 0 failed.

- [ ] **Step 2: Confirm a live session holds a lease and the machine is armed**

Run: `powershell -NoProfile -File scripts/keep_awake.ps1 -Status`
Expected: `armed: True`, at least one lease, a live supervisor pid.

- [ ] **Step 3: Prove supervisor-crash recovery**

Run:
```
powershell -NoProfile -Command "$sp = [int](Get-Content \"$env:LOCALAPPDATA\kb-keepawake\supervisor.pid\" -Raw).Trim(); Stop-Process -Id $sp -Force; 'killed ' + $sp"
powershell -NoProfile -File scripts/keep_awake.ps1 -Status
powershell -NoProfile -File scripts/keep_awake.ps1 -Repair
powershell -NoProfile -Command "powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'Current AC'"
```
Expected: status reports `supervisor: none` with `armed: True`; `-Repair` reports restored; the final query shows `0x000004b0` (1200). This is the exact scenario where a naive design would strand the machine unable to sleep.

- [ ] **Step 4: Confirm the machine is left in a clean state**

Run:
```
powershell -NoProfile -File scripts/keep_awake.ps1 -Status
powershell -NoProfile -Command "powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'Current AC'"
```
Expected: `armed: False`, `leases: 0`, and standby back at `0x4b0`. For the lid setting, re-run the registry read from Task 3 Step 5 and confirm it reads `1` — the lid value is hidden and will not appear in `powercfg /query` output.

- [ ] **Step 5: Append the run's lessons to agent memory**

Per the constitution (`CLAUDE.md` → Memory), append what worked, what failed, and what remains to `memory/claude-<agent-id>.md`. Include the mutex-singleton rationale and the Modern-Standby root cause, since both are non-obvious and easy to regress.

- [ ] **Step 6: Commit**

```bash
git add memory/
git commit -m "chore(memory): record keep-awake build lessons"
```

- [ ] **Step 7: Hand off the overnight acceptance test**

The real acceptance test cannot be automated: Daniel must run work overnight with the lid closed on AC power and confirm it survives. Report to him:
- what to run and roughly how long,
- that `-Status` shows whether protection is live,
- that `-Repair` is the escape hatch if anything looks stuck,
- that **battery is deliberately out of scope** — the machine must stay plugged in.

---

## Notes for the implementing agent

- **Never leave the machine armed.** Any task that arms must restore before it ends. If a step fails midway, run `scripts/keep_awake.ps1 -Repair` before moving on.
- **PowerShell 5.1 only.** No `&&`/`||`, no ternary, no null-coalescing. Use `;` and `if ($?)`.
- **Do not add DC handling.** It is an explicit non-goal; battery must keep sleeping.
- **`powercfg /requests` requires elevation** — never add it to a code path that must work unelevated.
