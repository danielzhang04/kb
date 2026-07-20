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

    # Task 7: Claude Code hooks don't expose the session id as an env var (only
    # as `session_id` in the JSON payload piped to every hook command's stdin --
    # verified 2026-07-20). This switch reads that stdin JSON instead of
    # requiring -Label, deriving a per-session lease label so concurrent Claude
    # sessions don't collide on one shared lease. Falls back to a fixed
    # 'claude-session' label (logged) if stdin is empty/unparseable -- a hook
    # must never throw just because it couldn't identify its own session.
    [Parameter(ParameterSetName = 'Acquire')]
    [Parameter(ParameterSetName = 'Heartbeat')]
    [Parameter(ParameterSetName = 'Release')]
    [switch]$FromStdin,

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
    # -FromStdin resolution happens once, up front, for every parameter set
    # that accepts it -- Acquire/Heartbeat/Release all need the same label.
    # An explicit -Label always wins if somehow both are given.
    if ($FromStdin -and -not $Label) {
        $stdinText = [Console]::In.ReadToEnd()
        $labelResolution = Resolve-KeepAwakeSessionLabel -StdinJson $stdinText -FallbackLabel 'claude-session'
        $Label = $labelResolution.Label
        if ($labelResolution.Source -ne 'stdin-session-id') {
            Write-KeepAwakeLog ("session-label-fallback source=$($labelResolution.Source) label=$Label -- could not read a session id from hook stdin; concurrent Claude sessions will share this lease")
        }
    }

    switch ($PSCmdlet.ParameterSetName) {
        'Acquire' {
            if (-not $Label) { throw '-Label is required with -Acquire (or pass -FromStdin)' }
            # Decision logic (explicit-PID shortcut, ancestor-walk fallback
            # logging, freshly-spawned sanity warning) lives in the module --
            # see Resolve-KeepAwakeAcquireTarget -- so it is unit-testable
            # without spawning a real process tree. This CLI stays thin.
            $resolved = Resolve-KeepAwakeAcquireTarget -SelfProcessId $PID -ProcessId $ProcessId -Label $Label
            $target = $resolved.ProcessId
            $cpu = Get-ProcessTreeCpu -ProcessId $target
            New-KeepAwakeLease -Label $Label -Mode $Mode -ProcessId $target -CpuSample $cpu | Out-Null
            # Spawning is unconditional and cheap: a duplicate supervisor loses
            # the mutex race and exits immediately, so there is no need to check
            # first (and checking first is exactly the race we are avoiding).
            Start-DetachedSupervisor
            Write-Output "acquired label=$Label mode=$Mode pid=$target"
        }
        'Heartbeat' {
            if (-not $Label) { throw '-Label is required with -Heartbeat (or pass -FromStdin)' }
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
            if (-not $Label) { throw '-Label is required with -Release (or pass -FromStdin)' }
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
