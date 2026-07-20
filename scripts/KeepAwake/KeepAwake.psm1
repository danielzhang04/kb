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

# Shared atomic-write helper (I3 fix): every writer of a JSON state file in
# this module (lease files, armed.json) used a plain Set-Content, which is not
# atomic on Windows -- a crash or power loss mid-write leaves a truncated file
# that the next reader chokes on. Writing to a unique temp file first and
# renaming it into place with Move-Item -Force means any reader always sees
# either the fully-old or fully-new content, never a partial write. The PID +
# GUID suffix on the temp name means two writers racing for the same target
# path (e.g. a -Heartbeat CLI invocation and a concurrent supervisor pass,
# I3's exact scenario) never collide on the temp file itself -- only the final
# Move-Item -Destination is a race, and Move-Item -Force resolves that
# atomically at the filesystem level rather than via a torn read/write.
function Write-JsonFileAtomic {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Data
    )
    $tmp = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $Data | ConvertTo-Json -Compress -Depth 5 | Set-Content -Path $tmp -Encoding utf8
        Move-Item -Path $tmp -Destination $Path -Force
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
# file. Moved into the module (I3 fix) rather than living in keep_awake.ps1's
# -Heartbeat branch: this is the hottest path in the whole feature (a hook
# fires it on every single tool call) and it used to do a raw read-modify-write
# with no locking against Invoke-SupervisorPass's own rewrite of the same file
# -- a torn read from that race threw under the CLI's
# $ErrorActionPreference='Stop' into the top-level catch, which is exactly the
# "must never throw into a hook" failure the script's own header comment
# warns against. Containing the try/catch here means a torn/corrupt read is
# treated the same as "lease already gone": a silent no-op, never a thrown
# error. Projects every existing field forward rather than hand-listing them
# (same reasoning as Invoke-SupervisorPass's lease rewrite, M1) so a future
# field addition to New-KeepAwakeLease is never silently dropped here either.
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
            # M2 fix: a lease that fails to parse carries no recoverable
            # information -- the pid/label/heartbeat it would have contributed
            # are simply gone. Leaving the file in place meant it was skipped
            # forever (every single pass, logging one lease-corrupt line every
            # poll interval indefinitely) without ever being cleaned up.
            # Deleting it here is safe: at worst it drops one lease's
            # protection, exactly like any other corrupt/unparseable file
            # already handled defensively throughout this module.
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

# Process names that are themselves just launchers/shells rather than the
# real long-lived owner a lease should be pinned to. If a parent-walk lands
# on one of these it must keep going -- stopping here would just anchor the
# lease to another process that is itself gone the moment this invocation
# exits, reproducing the exact defect this seam exists to avoid.
#
# bash.exe/sh.exe added 2026-07-20 (Task 7) after being caught live: Claude
# Code runs Windows hook commands through Git Bash ("Using bash path: C:\
# Program Files\Git\bin\bash.exe" -- confirmed in --debug hooks output), so
# the real chain for a hook-invoked keep_awake.ps1 is
#   powershell.exe (this script) -> bash.exe (-c wrapper, one per hook firing)
#   -> claude.exe/node.exe (the real long-lived session)
# Before this fix, bash.exe was not on the list, so the walk stopped at hop 1
# and accepted the -c wrapper as the "owner" with Reason='ok' -- reproducing
# Finding A exactly. Confirmed by the supervisor pruning that lease as
# process-dead one second after acquiring it (see task-7-report.md).
$script:EphemeralHostProcessNames = @('powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash.exe', 'sh.exe')

function Get-DefaultProcessInfoProvider {
    return @{
        GetProcessInfo = {
            param([int]$ProcessId)
            $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
            if ($null -eq $p) { return $null }
            # StartTime rides along on the same CIM query used for Name/ParentProcessId
            # (Get-CimInstance auto-converts CreationDate to a real [datetime] -- verified
            # empirically 2026-07-20, unlike the legacy Get-WmiObject WMI-datetime string).
            # It feeds the freshly-spawned sanity check below; a second query per hop would
            # be wasted CIM round-trips for a value already sitting on this same object.
            return @{ Name = [string]$p.Name; ParentProcessId = [int]$p.ParentProcessId; StartTime = $p.CreationDate }
        }
    }
}

$script:ProcessInfoProvider = Get-DefaultProcessInfoProvider
function Get-ProcessInfoProvider { return $script:ProcessInfoProvider }

# Resolves the real long-lived process a lease should be pinned to, walking
# up from the CLI's own (always-ephemeral) $PID rather than defaulting to it.
# The CLI process running -Acquire (whether spawned by a Claude Code hook or
# invoked by hand) does one write and exits almost immediately; a lease
# pinned to it is pruned by the supervisor's very first pass before the
# machine is ever armed (reproduced empirically in Task 5's smoke test --
# see task-5-report.md). Empirically walking this chain (2026-07-20) on this
# machine showed the immediate parent of such a CLI invocation can itself be
# an ephemeral wrapper shell (a `powershell.exe` process that exits with the
# single tool call that spawned it), with the real long-lived process
# (`claude.exe`) one hop further up -- so a fixed single-hop walk is not
# reliable and this instead walks past any number of recognized ephemeral
# shell hops, bounded by -MaxHops as a safety cap. Pure given an injected
# GetProcessInfo lookup, so the walk logic is unit-testable without touching
# real OS process state; the default provider (Get-ProcessInfoProvider) is
# the live seam used in production.
function Resolve-KeepAwakeOwnerPid {
    param(
        [Parameter(Mandatory)][int]$StartProcessId,
        [scriptblock]$GetProcessInfo = (Get-ProcessInfoProvider).GetProcessInfo,
        # 12, not 3: MaxHops is only a runaway/cycle guard, not a policy knob, so
        # sizing it generously costs nothing. Each hop is accepted as "keep
        # walking" ONLY when the parent's name is on $script:EphemeralHostProcessNames
        # (see the -notcontains check below) -- so a larger limit can never make
        # the walk overshoot past a genuine owner; it only allows deeper nesting
        # of recognized shells before giving up. The walk still stops at the
        # first non-ephemeral ancestor regardless of how large this is.
        # Raised 2026-07-20 (Task 7 fix-round) after the real observed chain for
        # a hook fired through nested Git Bash was measured empirically at 4 hops
        # (powershell.exe -> bash.exe -> bash.exe -> bash.exe -> claude.exe) --
        # see task-7-report.md fix-round section -- which exceeded the old
        # default of 3 and made resolution fail with max-hops-exceeded even
        # though the real long-lived owner was right there one hop further up.
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
            # StartTime rides along so a caller can layer a freshness sanity check on
            # top (Resolve-KeepAwakeAcquireTarget does this) without a second lookup.
            # Indexer access (not dot-notation) on purpose: this module runs under
            # Set-StrictMode -Version Latest, which throws PropertyNotFoundException
            # on dot-access to an absent hashtable key -- reproduced empirically
            # against the existing name-only fake maps in this test file, which
            # legitimately omit 'StartTime'. $h['StartTime'] returns $null for a
            # missing key under strict mode with no error either way.
            return @{ ProcessId = $parentId; Resolved = $true; Reason = 'ok'; Hops = $hop; StartTime = $parentInfo['StartTime']; Name = $parentInfo.Name }
        }
        $currentId = $parentId
        $currentInfo = $parentInfo
    }
    return @{ ProcessId = 0; Resolved = $false; Reason = 'max-hops-exceeded'; Hops = $MaxHops }
}

# Decision logic for keep_awake.ps1's -Acquire branch, moved into the module per
# Task 7 finding B: the CLI-invoked script has zero Pester coverage of its own,
# so the fallback-logging branch (Resolve-KeepAwakeOwnerPid failing) was never
# exercised by any test -- only the success path got a manual smoke test. Living
# here, the exact same logic the CLI runs is reachable with an injected
# GetProcessInfo, so every branch (explicit PID, resolved walk, failed walk) is
# unit-testable without spawning a real process tree. Keeps
# scripts/keep_awake.ps1 itself thin, per the plan's stated architecture.
#
# No acquire-time freshness check here (removed in the Task 7 fix-round, see
# the comment above Resolve-KeepAwakeOwnerPid's ephemeral-name list) -- that is
# why this no longer takes a $Now.
function Resolve-KeepAwakeAcquireTarget {
    param(
        [Parameter(Mandatory)][int]$SelfProcessId,
        [int]$ProcessId = 0,
        [string]$Label = '',
        [scriptblock]$GetProcessInfo = (Get-ProcessInfoProvider).GetProcessInfo
    )
    if ($ProcessId -gt 0) {
        # Caller (e.g. agent_runner.ps1, Task 6) already knows its own long-lived
        # PID -- the ancestor walk exists only to guess this when the caller
        # can't tell us directly, so skip it.
        return @{ ProcessId = $ProcessId; Resolved = $true; Reason = 'explicit' }
    }

    $resolution = Resolve-KeepAwakeOwnerPid -StartProcessId $SelfProcessId -GetProcessInfo $GetProcessInfo
    if (-not $resolution.Resolved) {
        # Failure case: no long-lived ancestor could be found. Fall back to the
        # ephemeral self PID (a hook must never throw), but log loudly -- this
        # lease will very likely be pruned on the supervisor's first pass,
        # silently defeating the whole feature otherwise.
        Write-KeepAwakeLog ("pid-resolution-FAILED reason=$($resolution.Reason) label=$Label -- falling back to ephemeral PID=$SelfProcessId; lease will likely be pruned immediately")
        return @{ ProcessId = $SelfProcessId; Resolved = $false; Reason = $resolution.Reason }
    }

    return @{ ProcessId = $resolution.ProcessId; Resolved = $true; Reason = $resolution.Reason }
}

# Task 7: Claude Code does not expose the session id as an environment variable
# to hook subprocesses (verified 2026-07-20 -- see task-7-report.md); it is only
# available as `session_id` in the JSON payload every hook command receives on
# stdin. This parses that payload into a lease label. Pure given the JSON text,
# so it is testable with plain strings -- no real stdin plumbing needed in tests.
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
        # that genuinely lacks the property THROWS PropertyNotFoundException --
        # reproduced empirically -- which would misclassify a well-formed hook
        # payload missing session_id as a JSON-parse error instead of this
        # branch. Indexing into .PSObject.Properties is always safe.
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

# The three keys a usable baseline must have. Used by Get-PowerBaselineStatus
# to tell "absent" from "corrupt" from "valid" -- see that function.
$script:BaselineRequiredKeys = @('lidaction_ac', 'standbyidle_ac', 'hibernateidle_ac')

# C1 fix: Test-PowerArmed was path-existence only, so an armed.json that
# exists but does not parse (a crash or power loss mid-write, since the write
# used to be a plain non-atomic Set-Content) made Test-PowerArmed report
# "armed" while Get-PowerBaseline silently returned $null -- Restore-PowerBaseline
# then bailed immediately, -Repair said "nothing to repair", and the machine
# was permanently stuck with sleep disabled. This distinguishes the three
# states so callers can react correctly to each:
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
        # C1.2 fix: an unreadable/incomplete armed.json means the machine may
        # already be armed with the true originals lost. Capturing "now" would
        # read back the already-armed zeros and durably record THOSE as the
        # baseline, permanently destroying the real originals and defeating
        # the adopt-never-overwrite invariant this function exists to uphold.
        # Refuse; -Repair (Restore-PowerBaseline's corrupt-baseline path) is
        # the only safe way out of this state.
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
    # C1.3: atomic write (temp file + Move-Item -Force) rather than a direct
    # Set-Content -- a crash or power loss mid-write is exactly the scenario
    # that produced the corrupt-armed.json defect this whole fix addresses.
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
        # (corrupt armed.json present, C1.2) -- mutating power settings
        # without a trustworthy baseline on disk would make a future restore
        # impossible. Not reachable via the normal supervisor path today
        # (Test-PowerArmed already reports "armed" for a corrupt file, so
        # Invoke-SupervisorPass never calls this in that state), but guarded
        # here too as defense in depth for any other caller.
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

# Returns a result hashtable rather than a bare bool (I4 fix): a bare bool
# collapsed three very different situations into the same "$false" --
# "nothing to do" (fine), "restore attempted and failed" (stuck, operator
# must act), and "armed.json unreadable" (fine now, since this function
# repairs that itself -- see below) all looked identical to -Repair, which is
# the operator's last line of defence. Reason values:
#   'nothing-to-restore'       -- not armed; no-op, nothing wrong.
#   'restored'                 -- valid baseline found and reapplied.
#   'restored-from-corruption' -- armed.json was corrupt/unreadable; the
#                                  documented Windows defaults were reapplied
#                                  instead (C1.1) and the corrupt file cleared.
#   'restore-failed'           -- a baseline (real or default) was known, but
#                                  one or more powercfg writes failed. The
#                                  machine may still be unable to sleep;
#                                  armed.json is retained for a retry.
function Restore-PowerBaseline {
    $status = Get-PowerBaselineStatus
    if ($status -eq 'absent') { return @{ Result = $false; Reason = 'nothing-to-restore' } }

    $prov = Get-PowerProvider
    if ($status -eq 'corrupt') {
        # C1.1 fix: armed.json exists but Get-PowerBaseline can't read a usable
        # baseline out of it (non-atomic writes could previously be torn by a
        # crash or power loss). Bailing out here, as the old code did, left
        # the machine stuck at lid=0/standby=0/hibernate=0 with NO automatic
        # recovery path -- exactly what the paramount invariant forbids.
        # Save-PowerBaseline already trusts $script:PowerDefaults for any
        # individual value missing from a scheme, so falling back to the full
        # default set here when the whole record is unusable is the same
        # assumption, not a new one -- and these defaults are this machine's
        # documented true originals (lid=1, standby=1200, hibernate=900).
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

    # Evaluate all three writes unconditionally rather than chaining them with
    # PowerShell's short-circuiting -and: if restoring the lid setting fails,
    # STANDBYIDLE and HIBERNATEIDLE must still be attempted. Those two are what
    # actually gate sleep, so short-circuiting past them on an earlier failure
    # would silently strand the machine at "never sleep" -- exactly the outcome
    # the global constraint forbids.
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

# I2 fix: a hard-killed supervisor or a power loss can leave armed.json (and
# the armed power values) sitting across a reboot with nothing scheduled to
# reconcile them -- by design, nothing is installed in Task Scheduler for
# this feature. Rather than add that, -Acquire calls this at the top of every
# acquisition: if the machine is armed but not one single lease on disk is
# backed by a live process, that is unambiguously a stale arm (every session
# that could have justified it is gone), so it is safe to restore immediately
# before the new lease and a fresh supervisor take over.
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
        # Task 7 fix-round finding: acquire-time freshness cannot distinguish a
        # legitimate owner from an ephemeral wrapper -- both are young at the
        # instant a lease is acquired (claude.exe is genuinely only seconds old
        # on every real SessionStart too). The discriminator only exists once
        # the resolved PID either survives or dies: a real owner lives for
        # minutes to hours, so a lease pruned as process-dead within one poll
        # interval of its own acquisition is an unambiguous signature that
        # Resolve-KeepAwakeOwnerPid pinned the lease to an ephemeral process
        # instead of the real long-lived owner. 60s = one poll interval, so
        # this reliably catches the first-pass case.
        [double]$ImmediatePruneThresholdSeconds = 60
    )
    $pruned = @()
    $immediatePruned = @()
    $live = 0
    foreach ($lease in (Get-KeepAwakeLeases)) {
        if (-not (Test-ProcessAlive -ProcessId $lease.pid)) {
            Remove-Item $lease.path -Force -ErrorAction SilentlyContinue
            # A corrupt/missing 'acquired' value must never crash the supervisor
            # (same defensive stance as Get-KeepAwakeLeases below) -- treat it as
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
        # against this pass's reading rather than the original acquisition value.
        # M1 fix: $u is Update-LeaseActivity's copy of the Get-KeepAwakeLeases
        # hashtable, which carries a 'path' key alongside the real lease
        # fields (pid/label/mode/acquired/heartbeat/cpu_sample). The old code
        # hand-listed those six field names to exclude 'path' from what gets
        # written back to disk -- so any field later added to
        # New-KeepAwakeLease would silently vanish the very first time the
        # supervisor rewrote that lease. Removing 'path' and writing
        # everything else forward means new fields survive automatically.
        $u = $res.Lease.Clone()
        $u.Remove('path')
        Write-JsonFileAtomic -Path $lease.path -Data $u
        $live++
    }

    if ($live -gt 0 -and -not (Test-PowerArmed)) { Set-PowerArmed | Out-Null }
    elseif ($live -eq 0 -and (Test-PowerArmed)) { Restore-PowerBaseline | Out-Null }

    return @{ LiveCount = $live; Pruned = $pruned; Armed = (Test-PowerArmed); ImmediatePruned = $immediatePruned }
}

# I1 fix, extracted as its own seam so the shutdown-race decision is
# unit-testable without a real loop, a real mutex, or a real sleep: the
# supervisor used to break out of its loop the instant LiveCount hit 0, then
# spend the rest of the `finally` block (three SetAcValue calls -> six
# powercfg.exe spawns, plausibly 1-3 seconds) still holding the mutex before
# releasing it. A concurrent -Acquire landing in that window spawns a new
# supervisor that loses the mutex race and exits immediately -- and nothing
# retries, because every other hook path only fires -Heartbeat, which no-ops
# against a lease with no supervisor watching it. That lease then sits live
# on disk with the machine unarmed and nothing protecting the session.
# Re-checking for live leases immediately before committing to exit bounds
# that window to a single iteration: if one appeared, $GetLiveLeaseCount
# (the real Get-KeepAwakeLeases/Test-ProcessAlive combo by default) reports
# it and the loop resumes instead of tearing down.
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

    $root = Get-KeepAwakeRoot
    # Defensive: on a truly first-ever run nothing has created the root yet
    # (Get-LeaseDir only runs once a lease is written), so this write would
    # otherwise fail silently. The mutex above is the real singleton guard;
    # this just keeps -Status able to find the pid file on that first run.
    if (-not (Test-Path $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
    $pidFile = Join-Path $root 'supervisor.pid'
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
                # I1 fix: re-check for a lease that appeared in the tiny window
                # since Invoke-SupervisorPass computed LiveCount, before
                # committing to exit and releasing the mutex. `continue` (not
                # Start-Sleep then continue) so the next loop iteration re-runs
                # Invoke-SupervisorPass immediately and re-arms without delay.
                if (Test-SupervisorShouldContinueAfterEmptyPass) {
                    Write-KeepAwakeLog 'supervisor-shutdown-race-AVOIDED lease appeared during final check -- resuming instead of exiting'
                    continue
                }
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

Export-ModuleMember -Function Get-KeepAwakeRoot, Get-LeaseDir, Write-KeepAwakeLog,
    Get-SafeLabel, Get-LeasePath, Write-JsonFileAtomic, New-KeepAwakeLease, Get-KeepAwakeLeases,
    Update-KeepAwakeLeaseHeartbeat, Remove-KeepAwakeLease,
    Test-ProcessAlive, Get-ProcessTreeCpu, Update-LeaseActivity,
    Get-ProcessInfoProvider, Resolve-KeepAwakeOwnerPid,
    Resolve-KeepAwakeAcquireTarget, Resolve-KeepAwakeSessionLabel,
    Set-PowerProvider, Get-PowerProvider, Get-PowerBaselineStatus, Get-PowerBaseline, Save-PowerBaseline,
    Set-PowerArmed, Restore-PowerBaseline, Test-PowerArmed, Resolve-StaleArmReconciliation,
    Set-ExecutionStateHold, Clear-ExecutionStateHold, Invoke-SupervisorPass,
    Test-SupervisorShouldContinueAfterEmptyPass, Start-KeepAwakeSupervisor
