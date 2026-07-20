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
function Set-ProcessInfoProvider { param([Parameter(Mandatory)][hashtable]$Provider) $script:ProcessInfoProvider = $Provider }
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

# Task 7 finding A: the name allowlist above can only ever catch KNOWN shell
# names. If Claude Code's real hook-spawn chain interposes a wrapper that is
# not on that list (bash.exe, wt.exe, a node helper, ...) the walk accepts it
# silently with Reason='ok' and no warning -- reproducing the original defect
# (lease pinned to a process about to exit) with no log line to diagnose it by.
# A process created moments ago is almost certainly such a wrapper, not a real
# long-lived owner, regardless of what it happens to be named -- so this is a
# second, name-independent signal layered on top of the walk's result. Pure
# function: just a duration comparison, no I/O, so it is trivially unit-testable.
function Test-KeepAwakeOwnerFreshlySpawned {
    param(
        [Parameter(Mandatory)][datetime]$StartTime,
        [Parameter(Mandatory)][datetime]$Now,
        [double]$ThresholdSeconds = 5.0
    )
    return (($Now - $StartTime).TotalSeconds -lt $ThresholdSeconds)
}

# Decision logic for keep_awake.ps1's -Acquire branch, moved into the module per
# Task 7 finding B: the CLI-invoked script has zero Pester coverage of its own,
# so the fallback-logging branch (Resolve-KeepAwakeOwnerPid failing) was never
# exercised by any test -- only the success path got a manual smoke test. Living
# here, the exact same logic the CLI runs is reachable with an injected
# GetProcessInfo/Now, so every branch (explicit PID, resolved walk, failed walk,
# freshly-spawned warning) is unit-testable without spawning a real process tree.
# Keeps scripts/keep_awake.ps1 itself thin, per the plan's stated architecture.
function Resolve-KeepAwakeAcquireTarget {
    param(
        [Parameter(Mandatory)][int]$SelfProcessId,
        [int]$ProcessId = 0,
        [string]$Label = '',
        [scriptblock]$GetProcessInfo = (Get-ProcessInfoProvider).GetProcessInfo,
        [datetime]$Now = (Get-Date),
        [double]$FreshnessThresholdSeconds = 5.0
    )
    if ($ProcessId -gt 0) {
        # Caller (e.g. agent_runner.ps1, Task 6) already knows its own long-lived
        # PID -- the ancestor walk and freshness heuristic both exist only to
        # guess this when the caller can't tell us directly, so skip both.
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

    if ($resolution.StartTime -and (Test-KeepAwakeOwnerFreshlySpawned -StartTime $resolution.StartTime -Now $Now -ThresholdSeconds $FreshnessThresholdSeconds)) {
        # Best-effort warning only -- per Task 7 finding A, a false positive here
        # must never stop a session being protected, so the resolved PID is kept
        # and used exactly as if this check hadn't run.
        Write-KeepAwakeLog ("pid-resolution-SUSPICIOUS reason=freshly-spawned label=$Label pid=$($resolution.ProcessId) name=$($resolution.Name) hops=$($resolution.Hops) started=$($resolution.StartTime.ToString('yyyy-MM-ddTHH:mm:ss')) -- resolved owner was created moments ago and may be an ephemeral wrapper rather than the real long-lived owner; continuing best-effort")
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
    Get-SafeLabel, Get-LeasePath, New-KeepAwakeLease, Get-KeepAwakeLeases, Remove-KeepAwakeLease,
    Test-ProcessAlive, Get-ProcessTreeCpu, Update-LeaseActivity,
    Set-ProcessInfoProvider, Get-ProcessInfoProvider, Resolve-KeepAwakeOwnerPid,
    Test-KeepAwakeOwnerFreshlySpawned, Resolve-KeepAwakeAcquireTarget, Resolve-KeepAwakeSessionLabel,
    Set-PowerProvider, Get-PowerProvider, Get-PowerBaseline, Save-PowerBaseline, Set-PowerArmed,
    Restore-PowerBaseline, Test-PowerArmed,
    Set-ExecutionStateHold, Clear-ExecutionStateHold, Invoke-SupervisorPass, Start-KeepAwakeSupervisor
