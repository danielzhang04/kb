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
#     (the same "nothing left to resolve" gate the daemon's own archive route re-checks
#     server-side; this is a client-side pre-check, not a bypass of it - a stale local read still
#     gets the daemon's own refusal on the POST)
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
