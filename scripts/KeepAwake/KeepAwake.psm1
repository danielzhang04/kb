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
