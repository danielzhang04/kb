# prod-archive-run.ps1 - archive ONE dead/terminal run on prod (or rehearsal), audited.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prod\prod-archive-run.ps1 `
#     -Run run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5 -Reason "dead canary test run, cap-blocked"
#
# OPEN CLASS (scripts/hooks/prod_window_guard.js rule A4o, shape O4): no prod window needed - same
# posture as prod-respond.ps1's plain (no -Approval) shape. The daemon's
# POST /api/control/runs/:runRef/archive is an OPEN route (dashboard/server/authority/policy.ts:45),
# so the daemon is the real authority; this script's own pre-check exists so a mistaken run ref
# fails fast, in plain language, before it ever reaches the daemon.
#
# Refuses (exit 1) BEFORE calling archive unless the run's lifecycle is one `archive` can legally
# reach in one hop. The real vocabulary lives in dashboard/server/control/runLifecycle.ts's
# RUN_LIFECYCLE_SEMANTICS: every kind whose `transitions` set contains 'archived' -
#   succeeded / failed / stopped / interrupted  - unconditionally (each is terminal or, for
#     interrupted, quarantine:true with 'archived' in its own transitions set)
#   waiting-human                                - ONLY when it carries zero OPEN human requests
#     as of THIS script's own read (Step A).
#
# CORRECTED 2026-09-21 (review finding B-2 - the previous comment here was WRONG): the daemon's
# archiveRun (dashboard/server/control/store.ts) does NOT refuse a waiting-human run that still has
# open human requests. It FORCE-RESOLVES every open, non-iteration-gate-pinned request on that run
# as a side effect of archiving (decision: 'responded', this script's -Reason text standing in as
# the response) - there is no server-side refusal to fall back on. So if a human request opens
# between Step A's read and the Step C POST, a stale "zero open requests" read is NOT caught
# server-side; it is silently auto-resolved, closing out a live approval/intervention gate with no
# real decision made.
#
# Because there is no server-side backstop, this script re-reads the run immediately before the
# POST (Step B.1) and refuses if any request opened in the gap, narrowing the race to whatever
# elapses between that re-read and the POST itself rather than the whole Step A-to-C window.
# Closing the residual gap for real needs a server-side refusal in archiveRun; that is a filed
# follow-up (review finding B-2), not something a client-side pre-check can fully close.
# 'archived' itself has an EMPTY transitions set (nothing re-archives an archived run), and every
# other kind (planned/recovering/running/stopping/paused-for-deploy) has no 'archived' transition
# at all, so this script refuses those too.
#
# -Actor is recorded on the audit trail (the X-KB-Actor header) exactly like prod-respond.ps1's; it
# is never trusted for authority (spec 4.3 - same non-authority property everywhere else in kb).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Run,
  [Parameter(Mandatory = $true)][string]$Reason,
  [string]$Actor = 'boss',
  [string]$URL = 'https://kb.tail82dd4f.ts.net',
  [string[]]$CurlHeader = @()
)
$ErrorActionPreference = 'Stop'
. (Join-Path 'C:\Users\danie\kb-rehearsal\tooling\drain-v2' '_drain-common.ps1')
function Fail($m) { Write-Host ''; Write-Host "ABORT: $m" -ForegroundColor Red; exit 1 }
function Step($n, $m) { Write-Host ''; Write-Host "[$n] $m" -ForegroundColor Cyan }

if ($Reason.Trim().Length -lt 1 -or $Reason.Length -gt 300) { Fail '-Reason must be 1..300 characters' }
if ($Actor -notmatch '^(daniel|boss|worker:[a-z0-9][a-z0-9._-]{0,63})$') { Fail "-Actor '$Actor' is not a valid X-KB-Actor value" }

Step 'A' "reading $Run"
$detailRaw = Invoke-Curl $CurlHeader @('-s', '--max-time', '30', "$URL/api/control/runs/$Run")
if ($LASTEXITCODE -ne 0) { Fail "could not reach $URL - is the tailnet up?" }
try { $detail = $detailRaw | ConvertFrom-Json } catch { Fail "run detail was not JSON: $detailRaw" }
if (-not $detail.run -and $detail.value) { $detail = $detail.value }
if (-not $detail.run) { Fail "run $Run not found (or the response had no run object): $detailRaw" }
$state = [string]$detail.run.state
$openRequests = @($detail.humanRequests | Where-Object { $_.state -eq 'open' })
Write-Host "state=$state  openHumanRequests=$($openRequests.Count)"

$ARCHIVABLE_UNCONDITIONAL = @('succeeded', 'failed', 'stopped', 'interrupted')
if ($ARCHIVABLE_UNCONDITIONAL -contains $state) {
  Step 'B' "state '$state' is archivable unconditionally"
} elseif ($state -eq 'waiting-human') {
  if ($openRequests.Count -ne 0) {
    Fail "run $Run is waiting-human with $($openRequests.Count) open human request(s) - resolve or abandon them (prod-respond.ps1) before archiving"
  }
  Step 'B' 'state is waiting-human with zero open human requests - archivable'
} elseif ($state -eq 'archived') {
  Fail "run $Run is already archived"
} else {
  Fail "run $Run is '$state', not a state this script archives from (need one of succeeded/failed/stopped/interrupted, or waiting-human with zero open requests)"
}

if ($state -eq 'waiting-human') {
  Step 'B.1' 're-reading immediately before the POST (the daemon force-resolves, it does not refuse, so this narrows that race client-side)'
  $reReadRaw = Invoke-Curl $CurlHeader @('-s', '--max-time', '30', "$URL/api/control/runs/$Run")
  if ($LASTEXITCODE -ne 0) { Fail "could not reach $URL for the pre-POST re-read - is the tailnet up?" }
  try { $reRead = $reReadRaw | ConvertFrom-Json } catch { Fail "pre-POST re-read was not JSON: $reReadRaw" }
  if (-not $reRead.run -and $reRead.value) { $reRead = $reRead.value }
  if (-not $reRead.run) { Fail "run $Run not found on the pre-POST re-read: $reReadRaw" }
  $reOpenRequests = @($reRead.humanRequests | Where-Object { $_.state -eq 'open' })
  if ($reOpenRequests.Count -ne 0) {
    Fail "run $Run picked up $($reOpenRequests.Count) new open human request(s) between the read and the archive POST - resolve or abandon them (prod-respond.ps1) before archiving. The daemon does NOT refuse this server-side on archive; it force-resolves open requests, so this script refuses instead."
  }
}

Step 'C' "archiving as $Actor : $Reason"
$body = [ordered]@{ idempotencyKey = [guid]::NewGuid().ToString(); reason = $Reason } | ConvertTo-Json -Compress
$tmp = [IO.Path]::GetTempFileName()
[IO.File]::WriteAllText($tmp, $body)
try {
  $raw = Invoke-Curl $CurlHeader @('-s', '-w', "`nHTTP %{http_code}", '-X', 'POST', '--max-time', '60',
    '-H', 'content-type: application/json', '-H', "x-kb-actor: $Actor",
    '--data-binary', "@$tmp", "$URL/api/control/runs/$Run/archive")
} finally { Remove-Item -Force -ErrorAction SilentlyContinue $tmp }
$text = ($raw -join "`n")
Write-Host $text
if ($text -notmatch 'HTTP 200') { Fail 'archive did not return 200 - read the body above' }

Step 'D' 'run state after archive'
$after = Invoke-Curl $CurlHeader @('-s', '--max-time', '30', "$URL/api/control/runs/$Run")
try {
  $a = $after | ConvertFrom-Json; if (-not $a.run -and $a.value) { $a = $a.value }
  Write-Host "state=$($a.run.state)"
} catch { Write-Host 'could not re-read the run' -ForegroundColor Yellow }
Write-Host ''
Write-Host 'DONE.' -ForegroundColor Green
