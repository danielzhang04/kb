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
            if ($ProcessId -gt 0) {
                $target = $ProcessId
            } else {
                # Why: this CLI's own $PID is the ephemeral powershell.exe host
                # running -Acquire (a Claude Code hook, or a bare invocation) --
                # it writes the lease and exits within a second. A lease pinned
                # to it is pruned by the supervisor's very first pass, before
                # the machine is ever armed (reproduced empirically -- see
                # task-5-report.md). Resolve the real long-lived owner instead.
                $resolution = Resolve-KeepAwakeOwnerPid -StartProcessId $PID
                if ($resolution.Resolved) {
                    $target = $resolution.ProcessId
                } else {
                    # Failure case: no long-lived ancestor could be found. Fall
                    # back to $PID (a hook must never throw), but log loudly --
                    # this lease will very likely be pruned on the supervisor's
                    # first pass, silently defeating the whole feature.
                    $target = $PID
                    Write-KeepAwakeLog ("pid-resolution-FAILED reason=$($resolution.Reason) label=$Label -- falling back to ephemeral PID=$PID; lease will likely be pruned immediately")
                }
            }
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
