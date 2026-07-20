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
    $ok = $true
    $ok = $ok -and (& $prov.SetAcValue $script:SUB_BUTTONS $script:LIDACTION 0)
    $ok = $ok -and (& $prov.SetAcValue $script:SUB_SLEEP $script:STANDBYIDLE 0)
    $ok = $ok -and (& $prov.SetAcValue $script:SUB_SLEEP $script:HIBERNATEIDLE 0)
    if ($ok) { Write-KeepAwakeLog 'power-armed lid=0 standby=0 hibernate=0 (AC only)' }
    else     { Write-KeepAwakeLog 'power-arm-FAILED one or more powercfg writes returned non-zero' }
    return $ok
}

function Restore-PowerBaseline {
    $b = Get-PowerBaseline
    if ($null -eq $b) { return $false }
    $prov = Get-PowerProvider
    $ok = $true
    $ok = $ok -and (& $prov.SetAcValue $script:SUB_BUTTONS $script:LIDACTION ([int]$b.original.lidaction_ac))
    $ok = $ok -and (& $prov.SetAcValue $script:SUB_SLEEP $script:STANDBYIDLE ([int]$b.original.standbyidle_ac))
    $ok = $ok -and (& $prov.SetAcValue $script:SUB_SLEEP $script:HIBERNATEIDLE ([int]$b.original.hibernateidle_ac))
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

Export-ModuleMember -Function Get-KeepAwakeRoot, Get-LeaseDir, Write-KeepAwakeLog,
    Get-SafeLabel, Get-LeasePath, New-KeepAwakeLease, Get-KeepAwakeLeases, Remove-KeepAwakeLease,
    Test-ProcessAlive, Get-ProcessTreeCpu, Update-LeaseActivity,
    Set-PowerProvider, Get-PowerProvider, Get-PowerBaseline, Save-PowerBaseline, Set-PowerArmed,
    Restore-PowerBaseline, Test-PowerArmed
