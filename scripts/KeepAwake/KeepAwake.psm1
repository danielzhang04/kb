# KeepAwake.psm1 -- lease-based keep-awake for overnight agent work.
# Design: docs/specs/2026-07-20-overnight-keep-awake-design.md
#
# Two seams keep this testable without touching real machine state:
#   1. $env:KB_KEEPAWAKE_ROOT overrides the lease-store location.
#   2. $script:PowerProvider wraps every powercfg/registry mutation.

Set-StrictMode -Version Latest

$script:TimeFormat = 'yyyy-MM-ddTHH:mm:sszzz'

function Get-KeepAwakeRoot {
    if ($env:KB_KEEPAWAKE_ROOT) { return $env:KB_KEEPAWAKE_ROOT }
    return (Join-Path $env:LOCALAPPDATA 'kb-keepawake')
}

# Production keeps the historical fixed name. Under KB_KEEPAWAKE_ROOT (tests,
# parallel sandboxes) the name is suffixed with a hash of the root so a test
# supervisor can never collide with -- or be shadowed by -- the real one. A
# real supervisor runs on this machine at all times; this is the seam that
# keeps the test suite from ever touching it.
function Get-KeepAwakeMutexName {
    if (-not $env:KB_KEEPAWAKE_ROOT) { return 'Global\kb-keepawake-supervisor' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = [System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($env:KB_KEEPAWAKE_ROOT))).Replace('-', '').Substring(0, 16)
    return "Global\kb-keepawake-supervisor-$hash"
}

function Get-LeaseDir {
    $d = Join-Path (Get-KeepAwakeRoot) 'leases'
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    return $d
}

# One shared log file is written by every hook invocation, every spawn and the
# supervisor itself, so contention is the normal case, not the exception
# (~48% Add-Content failure measured at 3 writers x 200ms cadence). This
# function is called from inside the supervisor's own error path and from its
# `finally`, which is precisely how a lost log line escalated into a machine
# that slept overnight on 2026-08-12: a log line is NEVER worth a process.
# Hence: FileShare.ReadWrite append (concurrent writers are expected), a few
# quick retries, then swallow. The whole body is wrapped -- even Get-KeepAwakeRoot
# and the directory creation must not be able to throw out of here.
$script:LogMaxBytes = 1MB
$script:LogWriteAttempts = 3

# Single-generation size cap: the respawn-storm finding measured ~5.5 MB/day of
# log growth with nothing ever trimming the file. Best effort in every respect --
# a rotation that fails just means the file keeps growing this cycle, which is
# strictly better than a throw. MoveFileExW (not Move-Item) so replacing an
# existing .1 is one kernel call with no delete-then-create window.
function Invoke-KeepAwakeLogRotation {
    param([Parameter(Mandatory)][string]$Path)
    try {
        $fi = New-Object System.IO.FileInfo $Path
        if ($fi.Exists -and $fi.Length -gt $script:LogMaxBytes) {
            [KbPower.FileNative]::MoveFileExW($Path, "$Path.1", $script:MOVEFILE_REPLACE_EXISTING) | Out-Null
        }
    } catch { }
}

function Write-KeepAwakeLog {
    param([Parameter(Mandatory)][string]$Message)
    try {
        $root = Get-KeepAwakeRoot
        if (-not (Test-Path $root)) { New-Item -ItemType Directory -Path $root -Force -ErrorAction SilentlyContinue | Out-Null }
        # FileStream resolves relative paths against the process working
        # directory, not the PowerShell location -- normalize first.
        $path = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath((Join-Path $root 'keepawake.log'))
        Invoke-KeepAwakeLogRotation -Path $path
        $line = ('{0}  {1}{2}' -f (Get-Date -Format $script:TimeFormat), $Message, [Environment]::NewLine)
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($line)
        for ($attempt = 1; $attempt -le $script:LogWriteAttempts; $attempt++) {
            try {
                $fs = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
                try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Dispose() }
                return
            } catch {
                Start-Sleep -Milliseconds (5 + (Get-Random -Maximum 16))
            }
        }
    } catch { }
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

# Shared atomic-write helper: a plain Set-Content is not atomic on Windows,
# so a crash or power loss mid-write leaves a truncated file that the next
# reader chokes on. Writing to a unique temp file then kernel-atomically
# replacing the destination means a reader always sees either the fully-old
# or fully-new content. The PID + GUID suffix keeps concurrent writers (e.g.
# a -Heartbeat CLI call racing the supervisor) from colliding on the temp
# file itself -- only the final replace is a race.
#
# 2026-08-12 incident: Move-Item -Force onto an existing destination is
# delete-then-create, not atomic -- a window in which a concurrent writer's
# own create can land and throw "Cannot create a file when that file already
# exists." That escaped into the supervisor's own lease rewrite (no
# try/catch there at the time) and killed a live supervisor with four leases
# still held. MoveFileExW with MOVEFILE_REPLACE_EXISTING is a single kernel
# call -- no delete-then-create window -- so this replaces Move-Item outright.
# Retried up to 3 times with a short jittered sleep for the residual sharing-
# violation case (another process has the destination open), then throws --
# callers decide (F2 catches it in the supervisor loop; the Heartbeat CLI
# already catches and exits 0).
function Write-JsonFileAtomic {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Data
    )
    $tmp = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $Data | ConvertTo-Json -Compress -Depth 5 | Set-Content -Path $tmp -Encoding utf8
        $lastWin32 = 0
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            if ([KbPower.FileNative]::MoveFileExW($tmp, $Path, $script:MOVEFILE_REPLACE_EXISTING)) { return }
            $lastWin32 = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
            Start-Sleep -Milliseconds (15 + (Get-Random -Maximum 26))
        }
        throw "Write-JsonFileAtomic: MoveFileExW failed for '$Path' after 3 attempts (win32=$lastWin32)"
    } finally {
        Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue
    }
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
    Write-JsonFileAtomic -Path $path -Data $lease
    Write-KeepAwakeLog ("lease-acquire label=$Label mode=$Mode pid=$ProcessId")
    return $lease
}

# Reads, updates only the heartbeat field, and atomically rewrites a lease
# file. This is the hottest path in the feature (a hook fires it on every
# tool call) and races against Invoke-SupervisorPass's own rewrite of the
# same file, so a torn/corrupt read must never throw into the hook -- treat
# it as "lease already gone". Projects every existing field forward rather
# than hand-listing them (same reasoning as the supervisor's rewrite below)
# so a future field on New-KeepAwakeLease is never silently dropped here.
function Update-KeepAwakeLeaseHeartbeat {
    param([Parameter(Mandatory)][string]$Label)
    $path = Get-LeasePath -Label $Label
    if (-not (Test-Path $path)) { return $false }
    try {
        $existing = Get-Content $path -Raw | ConvertFrom-Json
    } catch {
        return $false
    }
    $updated = [ordered]@{}
    foreach ($prop in $existing.PSObject.Properties) { $updated[$prop.Name] = $prop.Value }
    $updated.heartbeat = (Get-Date -Format $script:TimeFormat)
    Write-JsonFileAtomic -Path $path -Data $updated
    return $true
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
            # A lease that fails to parse carries no recoverable information,
            # so leaving it in place would just re-log the same corrupt-lease
            # line every poll interval forever. Delete it: at worst this
            # drops one lease's protection.
            Write-KeepAwakeLog ("lease-corrupt file=$($f.Name) -- deleting (unparseable, carries no recoverable state)")
            Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue
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

# Process names that are themselves just launchers/shells, not the real
# long-lived owner a lease should be pinned to -- a parent-walk landing on
# one of these must keep going, or it anchors the lease to a wrapper gone
# the moment this invocation exits. bash.exe/sh.exe are here because Claude
# Code runs Windows hook commands through Git Bash, so the real chain is
# powershell.exe -> bash.exe (-c wrapper) -> claude.exe/node.exe; without
# them the walk stops at hop 1 and pins to the wrapper, which the supervisor
# then prunes as process-dead a second later.
$script:EphemeralHostProcessNames = @('powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash.exe', 'sh.exe')

function Get-DefaultProcessInfoProvider {
    return @{
        GetProcessInfo = {
            param([int]$ProcessId)
            $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
            if ($null -eq $p) { return $null }
            # StartTime rides along on the same CIM query used for Name/ParentProcessId
            # (Get-CimInstance auto-converts CreationDate to a real [datetime], unlike
            # the legacy Get-WmiObject WMI-datetime string). A second query per hop
            # would be a wasted CIM round-trip for a value already on this object.
            return @{ Name = [string]$p.Name; ParentProcessId = [int]$p.ParentProcessId; StartTime = $p.CreationDate }
        }
    }
}

$script:ProcessInfoProvider = Get-DefaultProcessInfoProvider
function Get-ProcessInfoProvider { return $script:ProcessInfoProvider }

# Resolves the real long-lived process a lease should be pinned to, walking
# up from the CLI's own (always-ephemeral) $PID rather than defaulting to it:
# the -Acquire process does one write and exits almost immediately, and its
# immediate parent can itself be an ephemeral wrapper (e.g. a `powershell.exe`
# that exits with the single tool call that spawned it) with the real
# long-lived process (`claude.exe`) one hop further up. So a fixed
# single-hop walk is not reliable; this walks past any number of recognized
# ephemeral shell hops, bounded by -MaxHops as a safety cap. Pure given an
# injected GetProcessInfo lookup, so it is unit-testable without touching
# real OS process state; Get-ProcessInfoProvider is the live production seam.
function Resolve-KeepAwakeOwnerPid {
    param(
        [Parameter(Mandatory)][int]$StartProcessId,
        [scriptblock]$GetProcessInfo = (Get-ProcessInfoProvider).GetProcessInfo,
        # 12, not 3: MaxHops is only a runaway/cycle guard, not a policy knob.
        # A hop is accepted as "keep walking" ONLY when the parent's name is on
        # $script:EphemeralHostProcessNames, so a larger limit can never make
        # the walk overshoot a genuine owner -- it only allows deeper nesting
        # of recognized shells (a hook through nested Git Bash can chain 4+
        # hops: powershell.exe -> bash.exe -> bash.exe -> bash.exe -> claude.exe).
        [int]$MaxHops = 12
    )
    $currentId = $StartProcessId
    $currentInfo = & $GetProcessInfo $currentId
    if ($null -eq $currentInfo) {
        return @{ ProcessId = 0; Resolved = $false; Reason = 'start-process-not-found'; Hops = 0 }
    }
    for ($hop = 1; $hop -le $MaxHops; $hop++) {
        $parentId = [int]$currentInfo.ParentProcessId
        if ($parentId -le 0) {
            return @{ ProcessId = 0; Resolved = $false; Reason = 'no-parent'; Hops = $hop }
        }
        $parentInfo = & $GetProcessInfo $parentId
        if ($null -eq $parentInfo) {
            return @{ ProcessId = 0; Resolved = $false; Reason = 'parent-process-not-found'; Hops = $hop }
        }
        if ($script:EphemeralHostProcessNames -notcontains $parentInfo.Name) {
            # Indexer access (not dot-notation) on purpose: this module runs under
            # Set-StrictMode -Version Latest, which throws PropertyNotFoundException
            # on dot-access to an absent hashtable key. $h['StartTime'] returns
            # $null for a missing key under strict mode with no error either way.
            return @{ ProcessId = $parentId; Resolved = $true; Reason = 'ok'; Hops = $hop; StartTime = $parentInfo['StartTime']; Name = $parentInfo.Name }
        }
        $currentId = $parentId
        $currentInfo = $parentInfo
    }
    return @{ ProcessId = 0; Resolved = $false; Reason = 'max-hops-exceeded'; Hops = $MaxHops }
}

# Decision logic for keep_awake.ps1's -Acquire branch, kept in the module
# (rather than in the CLI script) so every branch -- explicit PID, resolved
# walk, failed walk -- is unit-testable with an injected GetProcessInfo.
# No acquire-time freshness check: a legitimate owner and an ephemeral
# wrapper are indistinguishable by freshness alone here (see
# Invoke-SupervisorPass's ImmediatePruneThresholdSeconds below for why that
# discriminator lives in the supervisor instead) -- hence no $Now param.
function Resolve-KeepAwakeAcquireTarget {
    param(
        [Parameter(Mandatory)][int]$SelfProcessId,
        [int]$ProcessId = 0,
        [string]$Label = '',
        [scriptblock]$GetProcessInfo = (Get-ProcessInfoProvider).GetProcessInfo
    )
    if ($ProcessId -gt 0) {
        # Caller (e.g. agent_runner.ps1) already knows its own long-lived PID
        # -- the ancestor walk exists only to guess this when the caller can't
        # tell us directly, so skip it.
        return @{ ProcessId = $ProcessId; Resolved = $true; Reason = 'explicit' }
    }

    $resolution = Resolve-KeepAwakeOwnerPid -StartProcessId $SelfProcessId -GetProcessInfo $GetProcessInfo
    if (-not $resolution.Resolved) {
        # No long-lived ancestor found. Fall back to the ephemeral self PID
        # (a hook must never throw), but log loudly -- this lease will very
        # likely be pruned on the supervisor's first pass.
        Write-KeepAwakeLog ("pid-resolution-FAILED reason=$($resolution.Reason) label=$Label -- falling back to ephemeral PID=$SelfProcessId; lease will likely be pruned immediately")
        return @{ ProcessId = $SelfProcessId; Resolved = $false; Reason = $resolution.Reason }
    }

    return @{ ProcessId = $resolution.ProcessId; Resolved = $true; Reason = $resolution.Reason }
}

# Claude Code does not expose the session id as an environment variable to
# hook subprocesses; it is only available as `session_id` in the JSON payload
# every hook command receives on stdin. Parses that payload into a lease
# label; pure given the JSON text, so it is testable with plain strings.
function Resolve-KeepAwakeSessionLabel {
    param(
        [string]$StdinJson = '',
        [string]$FallbackLabel = 'claude-session'
    )
    if ([string]::IsNullOrWhiteSpace($StdinJson)) {
        return @{ Label = $FallbackLabel; Source = 'fallback-empty-stdin' }
    }
    try {
        $obj = $StdinJson | ConvertFrom-Json
        # Property-collection indexer, not dot-access: under this module's
        # Set-StrictMode -Version Latest, `$obj.session_id` on a PSCustomObject
        # that genuinely lacks the property THROWS PropertyNotFoundException,
        # which would misclassify a well-formed hook payload missing
        # session_id as a JSON-parse error instead of this branch. Indexing
        # into .PSObject.Properties is always safe.
        if ($null -eq $obj.PSObject.Properties['session_id']) {
            return @{ Label = $FallbackLabel; Source = 'fallback-missing-session-id' }
        }
        $sid = [string]$obj.session_id
        if ([string]::IsNullOrWhiteSpace($sid)) {
            return @{ Label = $FallbackLabel; Source = 'fallback-missing-session-id' }
        }
        return @{ Label = "claude-$sid"; Source = 'stdin-session-id' }
    } catch {
        return @{ Label = $FallbackLabel; Source = 'fallback-json-parse-error' }
    }
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
        # action is a HIDDEN setting and does not appear in query output at
        # all, so query-parsing would silently miss it.
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

# The three keys a usable baseline must have. Used by Get-PowerBaselineStatus
# to tell "absent" from "corrupt" from "valid" -- see that function.
$script:BaselineRequiredKeys = @('lidaction_ac', 'standbyidle_ac', 'hibernateidle_ac')

# Path-existence alone can't distinguish a usable baseline from a corrupt
# one: an armed.json that exists but doesn't parse (e.g. a crash or power
# loss mid-write) would otherwise report "armed" while Get-PowerBaseline
# silently returns $null, and a caller that bails on $null leaves the
# machine permanently stuck with sleep disabled. Distinguish the three
# states so callers can react correctly:
#   'absent'  -- no armed.json at all; nothing is armed.
#   'corrupt' -- armed.json exists but doesn't parse, or parses without all
#                three required 'original' keys. Unusable as a baseline.
#   'valid'   -- armed.json exists, parses, and has everything needed to
#                restore.
function Get-PowerBaselineStatus {
    $p = Get-ArmedPath
    if (-not (Test-Path $p)) { return 'absent' }
    try {
        $obj = Get-Content $p -Raw | ConvertFrom-Json
        if ($null -eq $obj -or $null -eq $obj.original) { return 'corrupt' }
        foreach ($k in $script:BaselineRequiredKeys) {
            if ($null -eq $obj.original.PSObject.Properties[$k]) { return 'corrupt' }
        }
        return 'valid'
    } catch {
        return 'corrupt'
    }
}

function Get-PowerBaseline {
    if ((Get-PowerBaselineStatus) -ne 'valid') { return $null }
    try { return (Get-Content (Get-ArmedPath) -Raw | ConvertFrom-Json) } catch { return $null }
}

function Save-PowerBaseline {
    # Adopt rather than overwrite. If armed.json already exists, the machine is
    # already armed and its stored values are the ONLY record of the originals --
    # re-capturing now would record the armed zeros as the baseline and make the
    # real settings unrecoverable.
    $status = Get-PowerBaselineStatus
    if ($status -eq 'valid') {
        Write-KeepAwakeLog 'baseline-adopt existing armed.json found'
        return (Get-PowerBaseline)
    }
    if ($status -eq 'corrupt') {
        # An unreadable/incomplete armed.json means the machine may already
        # be armed with the true originals lost. Capturing "now" would
        # durably record the already-armed zeros as the baseline, defeating
        # the adopt-never-overwrite invariant this function exists to uphold.
        # Refuse; -Repair (Restore-PowerBaseline's corrupt-baseline path) is
        # the only safe way out.
        Write-KeepAwakeLog 'baseline-capture-REFUSED armed.json present but unreadable/incomplete -- refusing to recapture (would record already-armed values as if they were the originals); run -Repair'
        return $null
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
    # Atomic write (temp file + Move-Item -Force) rather than a direct
    # Set-Content -- a crash or power loss mid-write is exactly the scenario
    # that would otherwise leave a corrupt armed.json behind.
    Write-JsonFileAtomic -Path (Get-ArmedPath) -Data $baseline
    Write-KeepAwakeLog ("baseline-saved lid=$($baseline.original.lidaction_ac) standby=$($baseline.original.standbyidle_ac) hibernate=$($baseline.original.hibernateidle_ac)")
    return $baseline
}

function Set-PowerArmed {
    # Baseline FIRST, mutation second. If this dies half-way the originals are
    # already durable on disk and -Repair can put them back.
    $baseline = Save-PowerBaseline
    if ($null -eq $baseline) {
        # Save-PowerBaseline only returns $null when it refused to capture
        # (corrupt armed.json present) -- mutating power settings without a
        # trustworthy baseline would make a future restore impossible. Not
        # reachable via the normal supervisor path today, but guarded here
        # too as defense in depth for any other caller.
        Write-KeepAwakeLog 'power-arm-ABORTED baseline capture refused (corrupt armed.json present) -- not mutating power settings without a trustworthy baseline; run -Repair first'
        return $false
    }
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

# Returns a result hashtable rather than a bare bool: a bare bool would
# collapse "nothing to do" (fine), "restore attempted and failed" (stuck,
# operator must act), and "armed.json unreadable" (fine, this function
# repairs it -- see below) into the same "$false" for -Repair, the
# operator's last line of defence. Reason values:
#   'nothing-to-restore'       -- not armed; no-op, nothing wrong.
#   'restored'                 -- valid baseline found and reapplied.
#   'restored-from-corruption' -- armed.json was corrupt/unreadable; the
#                                  documented Windows defaults were reapplied
#                                  instead, and the corrupt file cleared.
#   'restore-failed'           -- a baseline (real or default) was known, but
#                                  one or more powercfg writes failed. The
#                                  machine may still be unable to sleep;
#                                  armed.json is retained for a retry.
function Restore-PowerBaseline {
    $status = Get-PowerBaselineStatus
    if ($status -eq 'absent') { return @{ Result = $false; Reason = 'nothing-to-restore' } }

    $prov = Get-PowerProvider
    if ($status -eq 'corrupt') {
        # armed.json exists but Get-PowerBaseline can't read a usable baseline
        # out of it. Bailing out here would leave the machine stuck at
        # lid=0/standby=0/hibernate=0 with NO automatic recovery path.
        # Save-PowerBaseline already trusts $script:PowerDefaults for any
        # individual value missing from a scheme, so falling back to the
        # full default set when the whole record is unusable is the same
        # assumption -- these are this machine's documented true originals
        # (lid=1, standby=1200, hibernate=900).
        Write-KeepAwakeLog 'baseline-CORRUPT armed.json present but unreadable/incomplete -- restoring documented defaults (lid=1 standby=1200 hibernate=900) instead of stranding the machine armed'
        $original = $script:PowerDefaults
    } else {
        $b = Get-PowerBaseline
        $original = @{
            lidaction_ac     = [int]$b.original.lidaction_ac
            standbyidle_ac   = [int]$b.original.standbyidle_ac
            hibernateidle_ac = [int]$b.original.hibernateidle_ac
        }
    }

    # Evaluate all three writes unconditionally, not with -and short-circuit
    # (same reasoning as Set-PowerArmed above): STANDBYIDLE/HIBERNATEIDLE
    # gate sleep and must still be attempted even if the lid write fails.
    $r1 = & $prov.SetAcValue $script:SUB_BUTTONS $script:LIDACTION ([int]$original.lidaction_ac)
    $r2 = & $prov.SetAcValue $script:SUB_SLEEP $script:STANDBYIDLE ([int]$original.standbyidle_ac)
    $r3 = & $prov.SetAcValue $script:SUB_SLEEP $script:HIBERNATEIDLE ([int]$original.hibernateidle_ac)
    $ok = $r1 -and $r2 -and $r3
    if ($ok) {
        Remove-Item (Get-ArmedPath) -Force -ErrorAction SilentlyContinue
        if ($status -eq 'corrupt') {
            Write-KeepAwakeLog 'power-restored-from-CORRUPTION defaults reapplied; armed.json cleared'
            return @{ Result = $true; Reason = 'restored-from-corruption' }
        }
        Write-KeepAwakeLog 'power-restored originals reapplied; armed.json cleared'
        return @{ Result = $true; Reason = 'restored' }
    }
    # Deliberately keep armed.json so a later -Repair can retry. Clearing it
    # on failure would strand the machine armed with no record of the originals.
    Write-KeepAwakeLog 'power-restore-FAILED armed.json retained for -Repair'
    return @{ Result = $false; Reason = 'restore-failed' }
}

# A hard-killed supervisor or a power loss can leave armed.json (and the
# armed power values) sitting across a reboot with nothing scheduled to
# reconcile them -- by design, nothing is installed in Task Scheduler for
# this feature. So -Acquire calls this at the top of every acquisition: if
# the machine is armed but no lease on disk is backed by a live process,
# that is unambiguously a stale arm, safe to restore before the new lease
# and a fresh supervisor take over.
function Resolve-StaleArmReconciliation {
    if (-not (Test-PowerArmed)) { return $false }
    $liveCount = 0
    foreach ($lease in (Get-KeepAwakeLeases)) {
        if (Test-ProcessAlive -ProcessId $lease.pid) { $liveCount++ }
    }
    if ($liveCount -gt 0) { return $false }
    Write-KeepAwakeLog 'stale-arm-detected armed.json present with zero live leases -- reconciling before acquire'
    Restore-PowerBaseline | Out-Null
    return $true
}

Add-Type -Namespace KbPower -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@ -ErrorAction SilentlyContinue

# Separate type from KbPower.Native above (not an added member on it): that
# type's -ErrorAction SilentlyContinue means a partial prior load (e.g. a
# stale in-process module from an earlier version) could otherwise hide this
# member never having been added. Used by Write-JsonFileAtomic, defined
# earlier in this file -- function bodies resolve at call time, after the
# whole module (including this Add-Type) has loaded, so definition order
# here does not matter.
Add-Type -Namespace KbPower -Name FileNative -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool MoveFileExW(string lpExistingFileName, string lpNewFileName, uint dwFlags);
'@ -ErrorAction SilentlyContinue
$script:MOVEFILE_REPLACE_EXISTING = [uint32]0x1

# Both Add-Type calls above use -ErrorAction SilentlyContinue so a duplicate
# load never takes the module down -- which also means a genuine load failure
# would otherwise be completely silent, and every atomic write would then fail
# at call time with a cryptic "type not found". Say so once, loudly, at import.
foreach ($requiredType in @('KbPower.FileNative', 'KbPower.Native')) {
    if ($null -eq ($requiredType -as [type])) {
        Write-KeepAwakeLog "FATAL module-load type '$requiredType' unavailable (Add-Type failed) -- atomic writes and/or the execution-state hold will not work"
    }
}

# The L suffix on 0x80000000 is required: PowerShell 5.1 parses a bare
# 0x80000000 literal as a negative Int32, and casting that to [uint32] throws
# at module-import time, taking down the whole module. The L suffix parses
# it as Int64 first, which casts cleanly to 2147483648.
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
        [double]$CpuThreshold = 2.0,
        # Acquire-time freshness cannot distinguish a legitimate owner from an
        # ephemeral wrapper -- both are young at the instant a lease is
        # acquired (claude.exe is genuinely only seconds old on every real
        # SessionStart too). The discriminator only exists once the resolved
        # PID survives or dies: a real owner lives for minutes to hours, so a
        # lease pruned as process-dead within one poll interval of its own
        # acquisition unambiguously means Resolve-KeepAwakeOwnerPid pinned it
        # to an ephemeral process instead. 60s = one poll interval.
        [double]$ImmediatePruneThresholdSeconds = 60
    )
    $pruned = @()
    $immediatePruned = @()
    $live = 0
    foreach ($lease in (Get-KeepAwakeLeases)) {
        if (-not (Test-ProcessAlive -ProcessId $lease.pid)) {
            Remove-Item $lease.path -Force -ErrorAction SilentlyContinue
            # A corrupt/missing 'acquired' value must never crash the supervisor
            # (same defensive stance as Get-KeepAwakeLeases above) -- treat it as
            # an ordinary prune rather than throwing.
            $ageSeconds = $null
            try { $ageSeconds = ($Now - [datetimeoffset]::Parse($lease.acquired)).TotalSeconds } catch { }
            if ($null -ne $ageSeconds -and $ageSeconds -lt $ImmediatePruneThresholdSeconds) {
                $ageRounded = [math]::Round($ageSeconds, 1)
                Write-KeepAwakeLog ("lease-pruned-IMMEDIATELY label=$($lease.label) pid=$($lease.pid) age=${ageRounded}s -- PID resolution likely picked an ephemeral process; the owning session is NOT protected")
                $immediatePruned += $lease.label
            } else {
                Write-KeepAwakeLog ("lease-pruned label=$($lease.label) reason=process-dead pid=$($lease.pid)")
            }
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
        # against this reading, not the original acquisition value. $u also
        # carries a 'path' key alongside the real lease fields; removing just
        # that (rather than hand-listing the real fields) means any field
        # later added to New-KeepAwakeLease survives here automatically.
        $u = $res.Lease.Clone()
        $u.Remove('path')
        Write-JsonFileAtomic -Path $lease.path -Data $u
        $live++
    }

    if ($live -gt 0 -and -not (Test-PowerArmed)) { Set-PowerArmed | Out-Null }
    elseif ($live -eq 0 -and (Test-PowerArmed)) { Restore-PowerBaseline | Out-Null }

    return @{ LiveCount = $live; Pruned = $pruned; Armed = (Test-PowerArmed); ImmediatePruned = $immediatePruned }
}

# Extracted as its own seam so the shutdown-race decision is unit-testable
# without a real loop, a real mutex, or a real sleep: breaking out of the
# loop the instant LiveCount hits 0 would still leave the rest of the
# `finally` block (three SetAcValue calls -> six powercfg.exe spawns,
# plausibly 1-3 seconds) holding the mutex before releasing it. A concurrent
# -Acquire landing in that window spawns a new supervisor that loses the
# mutex race and exits immediately, and nothing retries -- every other hook
# path only fires -Heartbeat, a no-op against a lease with no supervisor
# watching it, so that lease sits live with the machine unarmed. Re-checking
# for live leases immediately before committing to exit bounds that window
# to a single iteration: if one appeared, $GetLiveLeaseCount reports it and
# the loop resumes instead of tearing down.
function Test-SupervisorShouldContinueAfterEmptyPass {
    param(
        [scriptblock]$GetLiveLeaseCount = {
            $n = 0
            foreach ($lease in (Get-KeepAwakeLeases)) {
                if (Test-ProcessAlive -ProcessId $lease.pid) { $n++ }
            }
            return $n
        }
    )
    return ((& $GetLiveLeaseCount) -gt 0)
}

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

# Test seam for Start-KeepAwakeSupervisor's per-iteration work: F2's tests
# inject failure/success sequences here rather than driving the real
# Invoke-SupervisorPass (which needs real lease files and power provider
# plumbing to produce a given LiveCount on demand). Same style as
# $script:PowerProvider.
function Get-DefaultSupervisorPassInvoker {
    return {
        param($Now, $IdleTimeoutMinutes, $CpuThreshold)
        Invoke-SupervisorPass -Now $Now -IdleTimeoutMinutes $IdleTimeoutMinutes -CpuThreshold $CpuThreshold
    }
}
$script:SupervisorPassInvoker = Get-DefaultSupervisorPassInvoker
function Set-SupervisorPassInvoker { param([Parameter(Mandatory)][scriptblock]$Invoker) $script:SupervisorPassInvoker = $Invoker }
# Injecting a fake invoker is process-wide state: without a reset the next test
# file/block silently runs against the previous block's stub.
function Reset-SupervisorPassInvoker { $script:SupervisorPassInvoker = Get-DefaultSupervisorPassInvoker }

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
    $mutex = New-Object System.Threading.Mutex($true, (Get-KeepAwakeMutexName), [ref]$created)
    if (-not $created) {
        Write-KeepAwakeLog 'supervisor-exit reason=another-supervisor-holds-mutex'
        $mutex.Dispose()
        return 0
    }

    $root = Get-KeepAwakeRoot
    # Defensive: on a truly first-ever run nothing has created the root yet
    # (Get-LeaseDir only runs once a lease is written), so this write would
    # otherwise fail silently. The mutex above is the real singleton guard;
    # this just keeps -Status able to find the pid file on that first run.
    if (-not (Test-Path $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
    $pidFile = Join-Path $root 'supervisor.pid'

    $deadline = (Get-Date).AddHours($MaxHours)
    $exit = 0
    $consecutiveFailures = 0
    try {
        # Inside the try (review finding 8): the pidfile write used to sit
        # outside it, so a failure there killed the starting supervisor under
        # $ErrorActionPreference='Stop' before the `finally` could clean up.
        Set-Content -Path $pidFile -Value $PID -Encoding utf8
        Set-ExecutionStateHold | Out-Null
        Write-KeepAwakeLog ("supervisor-start pid=$PID poll=${PollSeconds}s cap=${MaxHours}h idle=${IdleTimeoutMinutes}m")
        while ($true) {
            # The ENTIRE body is inside this try, not just the pass invocation:
            # the review reproduced an escape through $pass.LiveCount (a result
            # missing that key throws PropertyNotFoundException under
            # Set-StrictMode Latest) and through
            # Test-SupervisorShouldContinueAfterEmptyPass, both of which used to
            # sit outside it. Anything that throws in here is a failed cycle,
            # never a dead supervisor.
            try {
                if ((Get-Date) -ge $deadline) {
                    Write-KeepAwakeLog "supervisor-CAP-REACHED after ${MaxHours}h -- force-disarming"
                    $exit = 3
                    break
                }
                $pass = & $script:SupervisorPassInvoker ([datetimeoffset]::Now) $IdleTimeoutMinutes $CpuThreshold
                $consecutiveFailures = 0
                if ($pass.LiveCount -eq 0) {
                    # Re-check for a lease that appeared in the tiny window since
                    # the pass invoker computed LiveCount, before committing
                    # to exit and releasing the mutex. `continue` (not
                    # Start-Sleep then continue) so the next loop iteration re-runs
                    # the pass invoker immediately and re-arms without delay.
                    if (Test-SupervisorShouldContinueAfterEmptyPass) {
                        Write-KeepAwakeLog 'supervisor-shutdown-race-AVOIDED lease appeared during final check -- resuming instead of exiting'
                        continue
                    }
                    Write-KeepAwakeLog 'supervisor-exit reason=no-live-leases'
                    break
                }
                Start-Sleep -Seconds $PollSeconds
            } catch {
                # One racy/failed cycle must never tear the supervisor down (the
                # 2026-08-12 overnight outage was exactly this: a single
                # lease-file write collision escaped the loop, and the
                # `finally` block disarmed with four live leases still held).
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
        }
    } finally {
        # Belt and braces: whatever happened above, never leave the machine armed.
        # Every step is guarded on its own -- the review proved that a throw in
        # any one of them (all of them touch powercfg, the log, or the disk)
        # skipped every later step, leaving the pidfile on disk and the mutex
        # held by a dying process.
        try { if (Test-PowerArmed) { Restore-PowerBaseline | Out-Null } } catch { }
        try { Clear-ExecutionStateHold | Out-Null } catch { }
        try { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue } catch { }
        try { Write-KeepAwakeLog ("supervisor-stop pid=$PID exit=$exit") } catch { }
        try {
            $mutex.ReleaseMutex()
        } catch {
        } finally {
            # Dispose on its own line in a nested finally: a failed ReleaseMutex
            # must still release the handle.
            try { $mutex.Dispose() } catch { }
        }
    }
    return $exit
}

Export-ModuleMember -Function Get-KeepAwakeRoot, Get-KeepAwakeMutexName, Get-LeaseDir, Write-KeepAwakeLog,
    Get-DefaultPowerProvider, Reset-SupervisorPassInvoker,
    Get-SafeLabel, Get-LeasePath, Write-JsonFileAtomic, New-KeepAwakeLease, Get-KeepAwakeLeases,
    Update-KeepAwakeLeaseHeartbeat, Remove-KeepAwakeLease,
    Test-ProcessAlive, Get-ProcessTreeCpu, Update-LeaseActivity,
    Get-ProcessInfoProvider, Resolve-KeepAwakeOwnerPid,
    Resolve-KeepAwakeAcquireTarget, Resolve-KeepAwakeSessionLabel,
    Set-PowerProvider, Get-PowerProvider, Get-PowerBaselineStatus, Get-PowerBaseline, Save-PowerBaseline,
    Set-PowerArmed, Restore-PowerBaseline, Test-PowerArmed, Resolve-StaleArmReconciliation,
    Set-ExecutionStateHold, Clear-ExecutionStateHold, Invoke-SupervisorPass,
    Test-SupervisorShouldContinueAfterEmptyPass, Set-SupervisorPassInvoker, Start-KeepAwakeSupervisor,
    Test-SupervisorRespawnNeeded
