# sentinel_watchdog.ps1 — Sentinel organ (c): liveness watchdog (Wave D).
#
# Task-Scheduler-shaped sibling of desktop_dispatch.ps1. Checks that the fleet's
# two always-on surfaces are alive:
#   * the dispatcher heartbeat — freshness of the newest ledgers/dispatch/*.tsv shard
#     (a cadence dispatch writes a dispatch row; a shard older than 26h means no
#     dispatcher beat landed for over a day);
#   * the dashboard — `pm2 jlist` reports the `kb-dashboard` process `online`.
#
# SUPREMACY: the FIRST thing this script does is check for the repo STOP file. If a
# human/guard froze the fleet, the watchdog does NOTHING and exits 0 — it must never
# resurrect a deliberately frozen fleet (the "watchdog fights the freeze" trap).
#
# BOUNDED + ASYMMETRIC recovery: at most ONE `pm2 restart kb-dashboard` per invocation,
# and ONLY for the dashboard. A dead dispatcher is REPORT-ONLY: restarting a cloud
# routine is not a desktop action, so the watchdog only records it (a human/dispatcher
# escalates from the audit row). All failures append a row to
# ledgers/audit/watchdog-<YYYY-MM-DD>.tsv.
#
# This script does NOT register itself. Registration is a human gate. To install once
# reviewed (run from an elevated PowerShell; adjust interval to taste):
#
#   $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
#              -Argument '-NonInteractive -ExecutionPolicy Bypass -File C:\Users\danie\kb\scripts\sentinel_watchdog.ps1'
#   $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
#              -RepetitionInterval (New-TimeSpan -Minutes 15)
#   Register-ScheduledTask -TaskName 'kb-sentinel-watchdog' -Action $action -Trigger $trigger `
#              -Description 'Sentinel liveness watchdog (dispatcher heartbeat + kb-dashboard)'
#
# (The Register-ScheduledTask line above lives in this COMMENT only — the script body
# never registers a task.)

$ErrorActionPreference = 'Continue'
$RepoRoot = 'C:\Users\danie\kb'
$StopFile = Join-Path $RepoRoot 'STOP'
$MaxDispatchAgeHours = 26

# --- SUPREMACY: a frozen fleet stays frozen. This MUST be the first action. ---
if (Test-Path $StopFile) {
    exit 0
}

$Today   = Get-Date -Format 'yyyy-MM-dd'
$AuditTsv = Join-Path $RepoRoot ("ledgers/audit/watchdog-{0}.tsv" -f $Today)

function Write-WatchdogRow([string]$check, [string]$status, [string]$detail) {
    $dir = Split-Path $AuditTsv -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    if (-not (Test-Path $AuditTsv)) {
        Add-Content -Path $AuditTsv -Value "ts`tcheck`tstatus`tdetail" -Encoding utf8
    }
    $ts = Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'
    Add-Content -Path $AuditTsv -Value ("{0}`t{1}`t{2}`t{3}" -f $ts, $check, $status, $detail) -Encoding utf8
}

Set-Location $RepoRoot

# --- Dispatcher heartbeat: freshness of the newest dispatch shard (report-only) ---
$dispatchDir = Join-Path $RepoRoot 'ledgers/dispatch'
$newest = $null
if (Test-Path $dispatchDir) {
    $newest = Get-ChildItem -Path $dispatchDir -Filter '*.tsv' -File -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if ($null -eq $newest) {
    Write-WatchdogRow 'dispatcher' 'dead' 'no dispatch shard found (report-only; a dead cloud routine is not a desktop restart)'
}
else {
    $ageHours = ((Get-Date) - $newest.LastWriteTime).TotalHours
    if ($ageHours -gt $MaxDispatchAgeHours) {
        Write-WatchdogRow 'dispatcher' 'stale' ("newest shard {0} is {1:N1}h old (> {2}h); report-only" -f $newest.Name, $ageHours, $MaxDispatchAgeHours)
    }
}

# --- Dashboard: pm2 kb-dashboard online; bounded single restart on failure ---
$dashboardOnline = $false
$pmErr = $null
try {
    $jlist = (pm2 jlist 2>$null | Out-String)
    if ($jlist) {
        $procs = $jlist | ConvertFrom-Json
        foreach ($p in $procs) {
            if ($p.name -eq 'kb-dashboard' -and $p.pm2_env.status -eq 'online') {
                $dashboardOnline = $true
            }
        }
    }
} catch {
    $pmErr = $_.Exception.Message
}

if (-not $dashboardOnline) {
    Write-WatchdogRow 'kb-dashboard' 'down' ("not online (pm2 err: {0}); attempting single restart" -f $pmErr)
    # BOUNDED: exactly one restart attempt per invocation.
    try {
        pm2 restart kb-dashboard | Out-Null
        Write-WatchdogRow 'kb-dashboard' 'restarted' 'restart issued for the dashboard (1/1 this invocation)'
    } catch {
        Write-WatchdogRow 'kb-dashboard' 'restart-failed' $_.Exception.Message
    }
}

exit 0
